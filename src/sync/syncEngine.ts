import { Vault } from '../vault/vault';
import { VaultError } from '../vault/types';
import {
  ConflictReason,
  DriveClient,
  DriveFileMeta,
  EMPTY_SYNC_STATE,
  LocalVaultStore,
  NetworkError,
  SyncSnapshot,
  SyncState,
  SyncStateStore,
  SyncStatus,
} from './types';

/**
 * Sync.
 *
 * ## The problem this is shaped around
 *
 * The Drive API has no conditional write. There is no way to say "replace this
 * file only if its revision is still X" and have the server atomically reject a
 * stale write; Dropbox offers that, Drive does not. So two devices can both
 * decide to upload, and the second one wins outright.
 *
 * The response is not to build a lock. It is to make losing the race harmless:
 *
 * 1. Read `headRevisionId` immediately before uploading.
 * 2. If it moved, pull and merge before writing anything.
 * 3. Upload.
 * 4. Read the revision again and confirm the file is the one *we* just created.
 *
 * If step 4 disagrees, another device wrote concurrently. Nothing is
 * overwritten and nothing is panicked about: the vault is marked dirty and the
 * next cycle pulls and merges. Because KeePass carries per-entry UUIDs and
 * modification timestamps, a conflict noticed one cycle late still resolves
 * without data loss.
 *
 * There is a small race window left, between step 3 and step 4. It is accepted.
 * Closing it would mean distributed locking across devices that are frequently
 * offline, which is a much worse trade than a merge one cycle later.
 *
 * ## What this never does
 *
 * - Never resolves a conflict by silently picking a winner.
 * - Never deletes the local vault because the remote is missing.
 * - Never uploads without checking before and verifying afterwards.
 * - Never reports "Synced" unless a verified exchange says so.
 */

export interface SyncEngineDeps {
  drive: DriveClient;
  local: LocalVaultStore;
  stateStore: SyncStateStore;
  /** Returns the unlocked vault, or null when locked. */
  getVault: () => Vault | null;
  now?: () => number;
  onChange?: (snapshot: SyncSnapshot) => void;
}

/**
 * How many times one `sync()` call will re-pull after discovering the remote
 * moved under it. Bounded so a device caught in a busy period gives up and
 * shows Offline rather than looping; the next cycle picks it up.
 */
const MAX_PULL_ROUNDS = 3;

export class SyncEngine {
  private status: SyncStatus = 'disabled';
  private conflict: ConflictReason | null = null;
  private state: SyncState = { ...EMPTY_SYNC_STATE };
  private lastSyncAt: number | null = null;
  private running: Promise<SyncSnapshot> | null = null;
  /** A mutation that arrived while a sync was in flight. */
  private resyncQueued = false;

  constructor(private readonly deps: SyncEngineDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)();
  }

  snapshot(): SyncSnapshot {
    return {
      status: this.status,
      lastSyncAt: this.lastSyncAt,
      pendingChanges: this.state.dirty,
      conflict: this.conflict,
    };
  }

  private emit(status: SyncStatus, conflict: ConflictReason | null = null): SyncSnapshot {
    this.status = status;
    this.conflict = conflict;
    const snapshot = this.snapshot();
    this.deps.onChange?.(snapshot);
    return snapshot;
  }

  async load(): Promise<void> {
    this.state = { ...EMPTY_SYNC_STATE, ...(await this.deps.stateStore.load()) };
    this.lastSyncAt = this.state.lastSyncAt;
    this.emit(this.state.dirty ? 'offline' : 'disabled');
  }

  private async persist(): Promise<void> {
    this.state.lastSyncAt = this.lastSyncAt;
    await this.deps.stateStore.save(this.state);
  }

  /**
   * Record that the vault changed locally, and save it.
   *
   * The dirty flag is set *before* the write, not after: if the process dies
   * between the two, the next run must still know there is unpushed work.
   */
  async markDirtyAndSave(): Promise<void> {
    const vault = this.deps.getVault();
    if (!vault) return;

    this.state.dirty = true;
    this.state.vaultId = vault.vaultId;
    await this.persist();

    await this.deps.local.write(await vault.save());

    // `kdbxweb` needs the edit state that was current at save time to merge
    // correctly later. Without it, deletions made here are indistinguishable
    // from entries that simply have not arrived yet, and they come back.
    this.state.editState = vault.getEditState();
    await this.persist();

    if (this.status !== 'syncing') {
      this.emit(this.status === 'disabled' ? 'disabled' : 'offline');
    } else {
      this.resyncQueued = true;
    }
  }

  /**
   * Restore edit state onto a freshly opened vault.
   *
   * Called once after unlock, before any merge.
   */
  restoreEditState(): void {
    const vault = this.deps.getVault();
    if (!vault || !this.state.editState) return;
    try {
      vault.setEditState(this.state.editState);
    } catch {
      // Edit state from an older version of the file, or from a different
      // vault. Dropping it is safe: the worst case is that a deletion made on
      // this device before the last sync has to be made again.
      this.state.editState = null;
    }
  }

  /**
   * Run one full sync cycle.
   *
   * Concurrent calls collapse into the running one, so a manual "Sync now"
   * during an automatic cycle does not produce two uploads.
   */
  async sync(): Promise<SyncSnapshot> {
    if (this.running) return this.running;

    this.running = this.runSync().finally(() => {
      this.running = null;
    });

    const result = await this.running;

    // A save landed mid-cycle, so what we just pushed is already stale.
    if (this.resyncQueued) {
      this.resyncQueued = false;
      return this.sync();
    }
    return result;
  }

  private async runSync(): Promise<SyncSnapshot> {
    const vault = this.deps.getVault();
    if (!vault) return this.emit('disabled');

    if (!(await this.deps.drive.isConnected())) {
      return this.emit(this.state.dirty ? 'offline' : 'disabled');
    }

    this.emit('syncing');

    try {
      return await this.exchange(vault);
    } catch (error) {
      if (error instanceof NetworkError) {
        // Offline is a normal state, not a failure. Local edits stay, and the
        // next cycle picks them up.
        return this.emit('offline');
      }
      if (error instanceof VaultError) {
        // The only VaultError reachable from here is a remote that will not
        // decrypt, which means the key changed elsewhere.
        return this.emit('conflict', 'different-master-password');
      }
      return this.emit('offline');
    }
  }

  private async exchange(vault: Vault): Promise<SyncSnapshot> {
    const vaultId = vault.vaultId;
    this.state.vaultId = vaultId;

    let remote = await this.locateRemote(vaultId);

    // Nothing on Drive yet. Create it; there is nothing to merge with.
    if (!remote) {
      const created = await this.deps.drive.create(vaultId, await vault.save());
      return this.acceptPushed(vault, created);
    }

    let wasDirty = this.state.dirty;

    for (let round = 0; round < MAX_PULL_ROUNDS; round++) {
      // Step 2: the remote moved since we last agreed, so merge before writing.
      if (remote.headRevisionId !== this.state.lastKnownRevision) {
        await this.pullAndMerge(vault, remote);

        if (!wasDirty) {
          // We had nothing of our own to contribute, so adopting the merged
          // result *is* agreement. Pushing here would only churn revisions and
          // could ping-pong with the other device.
          return this.acceptPulled(remote);
        }
      }

      // Step 1: revision check immediately before the upload.
      const beforeUpload = await this.deps.drive.getMetadata(remote.id);
      if (beforeUpload.headRevisionId !== remote.headRevisionId) {
        // It moved again while we were merging. Go round once more.
        remote = beforeUpload;
        wasDirty = true;
        continue;
      }

      if (!wasDirty) {
        return this.acceptPulled(remote);
      }

      // Step 3.
      const pushed = await this.deps.drive.update(remote.id, await vault.save());

      // Step 4: confirm the file is the one we just wrote.
      const afterUpload = await this.deps.drive.getMetadata(remote.id);
      if (
        pushed.headRevisionId === null ||
        afterUpload.headRevisionId !== pushed.headRevisionId
      ) {
        // Someone wrote between our upload and this check. Do not overwrite and
        // do not panic — stay dirty so the next cycle pulls and merges. Entry
        // UUIDs and timestamps make a one-cycle-late resolution lossless.
        //
        // `lastKnownRevision` is deliberately *not* advanced to what is on Drive
        // now. It means "the revision whose contents we have incorporated", and
        // we have not incorporated theirs. Recording it here would tell the next
        // cycle the two sides already agree, and their write would be lost on
        // our next push.
        this.state.dirty = true;
        await this.persist();
        return this.emit('conflict', 'concurrent-write');
      }

      return this.acceptPushed(vault, pushed);
    }

    // Too many rounds: another device is writing continuously. Keep the local
    // changes and try again next cycle.
    this.state.dirty = true;
    await this.persist();
    return this.emit('conflict', 'concurrent-write');
  }

  private async locateRemote(vaultId: string): Promise<DriveFileMeta | null> {
    if (this.state.driveFileId) {
      try {
        return await this.deps.drive.getMetadata(this.state.driveFileId);
      } catch (error) {
        if (error instanceof NetworkError) throw error;
        // The id is stale — the file was removed, or this is a different
        // account. Fall through to a lookup by name rather than assuming the
        // vault is gone.
        this.state.driveFileId = null;
      }
    }

    const found = await this.deps.drive.findFile(vaultId);
    if (found) {
      this.state.driveFileId = found.id;
    }
    return found;
  }

  private async pullAndMerge(vault: Vault, remote: DriveFileMeta): Promise<void> {
    const remoteBytes = await this.deps.drive.download(remote.id);

    // Throws VaultError when the remote will not open with the current key,
    // which `runSync` turns into the different-master-password conflict. It is
    // important that this is *not* treated as a corrupt remote: overwriting it
    // would destroy the other device's vault.
    await vault.merge(remoteBytes);

    // The merged result is the new local truth, so persist it before anything
    // else can fail. If the upload never happens, the merge is still not lost.
    await this.deps.local.write(await vault.save());
    this.state.editState = vault.getEditState();
    await this.persist();
  }

  private async acceptPulled(remote: DriveFileMeta): Promise<SyncSnapshot> {
    this.state.lastKnownRevision = remote.headRevisionId;
    this.state.dirty = false;
    this.lastSyncAt = this.now;
    await this.persist();
    return this.emit('synced');
  }

  private async acceptPushed(vault: Vault, pushed: DriveFileMeta): Promise<SyncSnapshot> {
    this.state.driveFileId = pushed.id;
    this.state.lastKnownRevision = pushed.headRevisionId;
    this.state.dirty = false;
    this.lastSyncAt = this.now;

    // Both sides now agree, so the record of local-only edits is spent.
    vault.clearEditState();
    this.state.editState = vault.getEditState();

    await this.persist();
    return this.emit('synced');
  }

  /**
   * Push the local vault over whatever is on Drive, unconditionally.
   *
   * The single legitimate use is a master-password change: the remote can no
   * longer be decrypted or merged, so there is nothing to preserve from it and
   * the user has already been told that every other device will need the new
   * password. Never call this to "resolve" an ordinary conflict.
   */
  async forcePush(): Promise<SyncSnapshot> {
    const vault = this.deps.getVault();
    if (!vault) return this.emit('disabled');
    if (!(await this.deps.drive.isConnected())) return this.emit('offline');

    this.emit('syncing');

    try {
      const vaultId = vault.vaultId;
      const remote = await this.locateRemote(vaultId);
      const bytes = await vault.save();

      const pushed = remote
        ? await this.deps.drive.update(remote.id, bytes)
        : await this.deps.drive.create(vaultId, bytes);

      return this.acceptPushed(vault, pushed);
    } catch (error) {
      return this.emit(error instanceof NetworkError ? 'offline' : 'conflict', 'concurrent-write');
    }
  }

  /** Forget the Drive association without touching the local vault. */
  async disconnect(): Promise<void> {
    this.state.driveFileId = null;
    this.state.lastKnownRevision = null;
    this.lastSyncAt = null;
    await this.persist();
    this.emit('disabled');
  }
}
