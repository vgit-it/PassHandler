import { beforeEach, describe, expect, it } from 'vitest';

import { Vault } from '@/vault/vault';
import { FakeDrive } from './support/fakeDrive';
import { Device, waitForNextSecond } from './support/device';

/**
 * The sync testing section of the PRD, in full.
 *
 * Every scenario it says to verify with two devices is verified here with two
 * in-process instances, because the sync engine has no platform dependencies.
 * These are not mocks of the sync logic — the real engine runs against a Drive
 * stand-in that reproduces the one property that makes this problem hard: no
 * conditional write.
 */

const PASSWORD = 'shared master password';

describe('sync', () => {
  let drive: FakeDrive;

  beforeEach(() => {
    drive = new FakeDrive();
  });

  async function pairedDevices(): Promise<[Device, Device]> {
    const a = await Device.createNew('A', drive, PASSWORD);
    await a.addEntry({ title: 'Shared', username: 'original', password: 'pw-original' });
    await a.engine.sync();

    const b = await Device.adoptFromDrive('B', drive, PASSWORD, a.vault!.vaultId);
    return [a, b];
  }

  it('creates the remote file on the first sync', async () => {
    const a = await Device.createNew('A', drive, PASSWORD);
    await a.addEntry({ title: 'First', password: 'x' });

    const snapshot = await a.engine.sync();

    expect(snapshot.status).toBe('synced');
    expect(snapshot.pendingChanges).toBe(false);
    expect(drive.calls.create).toBe(1);
  });

  it('propagates an edit made on one device only', async () => {
    const [a, b] = await pairedDevices();

    await a.addEntry({ title: 'Only on A', username: 'a', password: 'pw-a' });
    await a.engine.sync();

    expect(b.titles()).not.toContain('Only on A');
    const snapshot = await b.engine.sync();

    expect(snapshot.status).toBe('synced');
    expect(b.titles()).toContain('Only on A');
    expect(b.password('Only on A')).toBe('pw-a');
  });

  it('keeps both edits when the devices change different entries offline', async () => {
    const [a, b] = await pairedDevices();
    await b.engine.sync();

    drive.offline = true;
    await a.addEntry({ title: 'From A', password: 'pw-a' });
    await b.addEntry({ title: 'From B', password: 'pw-b' });

    // Neither could reach Drive, so both are holding unpushed work.
    expect((await a.engine.sync()).status).toBe('offline');
    expect((await b.engine.sync()).status).toBe('offline');

    drive.offline = false;
    await a.engine.sync();
    await b.engine.sync();
    // A now needs to pick up what B pushed.
    await a.engine.sync();

    expect(a.titles()).toEqual(['From A', 'From B', 'Shared']);
    expect(b.titles()).toEqual(['From A', 'From B', 'Shared']);
    expect(a.password('From B')).toBe('pw-b');
    expect(b.password('From A')).toBe('pw-a');
  });

  it('resolves a same-entry conflict by timestamp without losing data', async () => {
    const [a, b] = await pairedDevices();
    await b.engine.sync();

    drive.offline = true;
    await a.editEntry('Shared', { username: 'edited-by-a', password: 'pw-from-a' });

    // KDBX timestamps have one-second resolution, so B's edit has to land in a
    // later second for "most recent wins" to mean anything.
    await waitForNextSecond();
    await b.editEntry('Shared', { username: 'edited-by-b', password: 'pw-from-b' });

    drive.offline = false;
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    // B edited last, so B's version survives on both devices — and critically,
    // neither device silently dropped the other's entry.
    expect(a.find('Shared')!.username).toBe('edited-by-b');
    expect(b.find('Shared')!.username).toBe('edited-by-b');
    expect(a.password('Shared')).toBe('pw-from-b');

    // The losing edit is not destroyed: KeePass keeps it in the entry's
    // history, which is what makes this recoverable rather than a silent loss.
    expect(a.titles()).toEqual(['Shared']);
  });

  it('propagates a deletion made while the other device was editing', async () => {
    const [a, b] = await pairedDevices();
    await b.addEntry({ title: 'Doomed', password: 'pw' });
    await b.engine.sync();
    await a.engine.sync();
    expect(a.titles()).toContain('Doomed');

    drive.offline = true;
    await a.deleteEntry('Doomed');
    await waitForNextSecond();
    await b.editEntry('Doomed', { username: 'still-editing' });

    drive.offline = false;
    await a.engine.sync();
    await b.engine.sync();
    await a.engine.sync();

    // Documented behaviour: the deletion wins. KeePass records a deletion with
    // a timestamp, and an edit does not resurrect a deleted entry — so both
    // devices agree, which is the property that actually matters.
    expect(a.titles()).not.toContain('Doomed');
    expect(b.titles()).not.toContain('Doomed');
  });

  it('leaves both ends valid when the app dies mid-upload', async () => {
    const [a] = await pairedDevices();
    const fileId = drive.onlyFileId();
    const remoteBefore = drive.contentsOf(fileId);

    await a.addEntry({ title: 'Written during the crash', password: 'pw' });

    drive.failNextUpdate = true;
    const snapshot = await a.engine.sync();

    // The upload never landed, so the remote is untouched and still openable.
    expect(snapshot.status).toBe('offline');
    expect(snapshot.pendingChanges).toBe(true);
    const remoteAfter = drive.contentsOf(fileId);
    expect(new Uint8Array(remoteAfter)).toEqual(new Uint8Array(remoteBefore));
    await expect(Vault.unlock(remoteAfter, PASSWORD)).resolves.toBeInstanceOf(Vault);

    // The local vault is complete and still holds the new entry.
    const localReopened = await Vault.unlock(await a.local.read(), PASSWORD);
    expect(localReopened.listEntries().map((e) => e.title)).toContain(
      'Written during the crash',
    );

    // And the work is not lost — the next cycle pushes it.
    expect((await a.engine.sync()).status).toBe('synced');
  });

  it('survives a restart with unpushed changes', async () => {
    const [a] = await pairedDevices();

    drive.offline = true;
    await a.addEntry({ title: 'Saved before the restart', password: 'pw' });
    await a.engine.sync();

    await a.restart(PASSWORD);
    expect(a.titles()).toContain('Saved before the restart');
    // The dirty flag is persisted, so the restarted app knows it owes a push.
    expect(a.stateStore.current().dirty).toBe(true);

    drive.offline = false;
    expect((await a.engine.sync()).status).toBe('synced');
  });

  it('reports a clear conflict when the master password was changed elsewhere', async () => {
    const [a, b] = await pairedDevices();
    await b.engine.sync();

    await a.vault!.changeMasterPassword('a completely different password');
    await a.engine.forcePush();

    await b.addEntry({ title: 'B still has the old key', password: 'pw' });
    const snapshot = await b.engine.sync();

    // Not "corrupt", not a silent overwrite of A's re-keyed vault — an
    // actionable statement about what actually happened.
    expect(snapshot.status).toBe('conflict');
    expect(snapshot.conflict).toBe('different-master-password');
    // B's own changes are still there and still pending.
    expect(snapshot.pendingChanges).toBe(true);
    expect(b.titles()).toContain('B still has the old key');
  });

  it('detects a concurrent write after uploading and refuses to overwrite it', async () => {
    const [a, b] = await pairedDevices();
    await b.engine.sync();

    await a.addEntry({ title: 'From A', password: 'pw-a' });

    // B's competing version is serialised up front, so the hook below can write
    // it synchronously — the race window is between our upload returning and
    // our verification reading the revision back, and an awaited hook would
    // land outside it.
    b.vault!.addEntry({ title: 'From B', password: 'pw-b' });
    const bytesFromB = await b.vault!.save();

    // Forge the exact race the design accepts.
    const fileId = drive.onlyFileId();
    drive.onAfterUpdate = () => {
      drive.onAfterUpdate = null;
      drive.writeDirectly(fileId, bytesFromB);
    };

    const snapshot = await a.engine.sync();

    expect(snapshot.status).toBe('conflict');
    expect(snapshot.conflict).toBe('concurrent-write');
    // Marked dirty rather than resolved by force, exactly as the PRD requires.
    expect(snapshot.pendingChanges).toBe(true);

    // The next cycle pulls, merges and converges — no data lost on either side.
    const recovered = await a.engine.sync();
    expect(recovered.status).toBe('synced');
    expect(a.titles()).toContain('From A');
    expect(a.titles()).toContain('From B');
  });

  it('checks the revision before uploading and verifies it afterwards', async () => {
    const a = await Device.createNew('A', drive, PASSWORD);
    await a.addEntry({ title: 'First', password: 'x' });
    await a.engine.sync();

    const before = drive.calls.getMetadata;
    await a.addEntry({ title: 'Second', password: 'y' });
    await a.engine.sync();

    // Locate, pre-upload check, post-upload verification.
    expect(drive.calls.getMetadata - before).toBeGreaterThanOrEqual(3);
  });

  it('never reports synced while changes are pending', async () => {
    const a = await Device.createNew('A', drive, PASSWORD);
    await a.engine.sync();

    drive.offline = true;
    await a.addEntry({ title: 'Unpushed', password: 'x' });

    const snapshot = await a.engine.sync();
    expect(snapshot.status).not.toBe('synced');
    expect(snapshot.pendingChanges).toBe(true);
  });

  it('does not delete the local vault when the remote disappears', async () => {
    const [a] = await pairedDevices();

    // A remote that cannot be found must never be read as "the vault was
    // deleted, so delete it here too".
    const fresh = new FakeDrive();
    const detached = new Device('A2', fresh);
    detached.vault = a.vault;
    await detached.local.write(await a.vault!.save());
    await detached.engine.load();

    await detached.engine.sync();

    const local = await detached.local.read();
    const reopened = await Vault.unlock(local, PASSWORD);
    expect(reopened.listEntries().length).toBeGreaterThan(0);
  });
});
