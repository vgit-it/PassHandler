import { describe, expect, it } from 'vitest';
import * as kdbxweb from 'kdbxweb';

import { installArgon2 } from '@/crypto/argon2';
import { Vault } from '@/vault/vault';
import { VaultError } from '@/vault/types';
import { filterEntries } from '@/vault/search';

/**
 * KeePassXC is not installable in CI, so interoperability is exercised against
 * files built with `kdbxweb` directly, in the formats KeePassXC actually
 * writes: KDBX4/Argon2d (its default), KDBX4/Argon2id, and KDBX3/AES-KDF for
 * older vaults. A true KeePassXC round-trip is a manual acceptance step — see
 * docs/VERIFICATION.md.
 */

const PASSWORD = 'correct horse battery staple';

async function buildForeignVault(options: {
  version: 3 | 4;
  kdf?: string;
  password?: string;
}): Promise<ArrayBuffer> {
  installArgon2();

  const credentials = new kdbxweb.Credentials(
    kdbxweb.ProtectedValue.fromString(options.password ?? PASSWORD),
  );
  await credentials.ready;

  const db = kdbxweb.Kdbx.create(credentials, 'Foreign');
  db.setVersion(options.version);
  if (options.kdf) db.setKdf(options.kdf);

  const entry = db.createEntry(db.getDefaultGroup());
  entry.fields.set('Title', 'GitHub');
  entry.fields.set('UserName', 'octocat');
  entry.fields.set('URL', 'https://github.com');
  entry.fields.set('Notes', 'made elsewhere');
  entry.fields.set('Password', kdbxweb.ProtectedValue.fromString('s3cret-from-keepass'));
  entry.times.update();

  return db.save();
}

describe('opening vaults written by another client', () => {
  const formats: Array<[string, { version: 3 | 4; kdf?: string }]> = [
    ['KDBX4 / Argon2d (KeePassXC default)', { version: 4, kdf: kdbxweb.Consts.KdfId.Argon2d }],
    ['KDBX4 / Argon2id', { version: 4, kdf: kdbxweb.Consts.KdfId.Argon2id }],
    ['KDBX3 / AES-KDF', { version: 3 }],
  ];

  for (const [name, options] of formats) {
    it(`reads ${name}`, async () => {
      const bytes = await buildForeignVault(options);
      const vault = await Vault.unlock(bytes, PASSWORD);

      const entries = vault.listEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.title).toBe('GitHub');
      expect(entries[0]!.username).toBe('octocat');
      expect(vault.readPassword(entries[0]!.id)).toBe('s3cret-from-keepass');
    });
  }

  it('round-trips a mutation back into a file another client can read', async () => {
    const original = await buildForeignVault({ version: 4 });
    const vault = await Vault.unlock(original, PASSWORD);

    vault.addEntry({ title: 'Added here', username: 'me', password: 'added-pw' });
    const saved = await vault.save();

    // Re-open with plain kdbxweb, standing in for a different KeePass client.
    const credentials = new kdbxweb.Credentials(kdbxweb.ProtectedValue.fromString(PASSWORD));
    await credentials.ready;
    const reopened = await kdbxweb.Kdbx.load(saved, credentials);

    const titles = reopened
      .getDefaultGroup()
      .entries.map((e) => e.fields.get('Title'));
    expect(titles).toContain('GitHub');
    expect(titles).toContain('Added here');
  });
});

describe('unlock failures', () => {
  it('reports the same reason for a wrong password and a corrupt file', async () => {
    const bytes = await buildForeignVault({ version: 4 });

    const wrongPassword = await Vault.unlock(bytes, 'not the password').catch((e) => e);
    const corrupt = await Vault.unlock(
      new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer,
      PASSWORD,
    ).catch((e) => e);

    expect(wrongPassword).toBeInstanceOf(VaultError);
    expect(corrupt).toBeInstanceOf(VaultError);
    // Indistinguishable on purpose: a distinguishable failure tells an attacker
    // holding the file whether a guess was structurally close.
    expect((wrongPassword as VaultError).reason).toBe('wrong-password-or-corrupt');
    expect((corrupt as VaultError).reason).toBe('wrong-password-or-corrupt');
  });
});

describe('biometric key material', () => {
  it('re-opens the vault from the stored password hash', async () => {
    const bytes = await buildForeignVault({ version: 4 });
    const vault = await Vault.unlock(bytes, PASSWORD);

    const material = vault.keyMaterial();
    expect(material).not.toBeNull();
    expect(material!.byteLength).toBe(32);

    const viaBiometric = await Vault.unlockWithKeyMaterial(bytes, material!);
    expect(viaBiometric.listEntries()).toHaveLength(1);
  });

  it('rejects key material of the wrong size instead of guessing', async () => {
    const bytes = await buildForeignVault({ version: 4 });
    await expect(
      Vault.unlockWithKeyMaterial(bytes, new Uint8Array(16)),
    ).rejects.toBeInstanceOf(VaultError);
  });
});

describe('entry lifecycle', () => {
  it('creates, edits and deletes', async () => {
    const vault = await Vault.create(PASSWORD);

    const id = vault.addEntry({
      title: 'Bank',
      username: 'me@example.com',
      password: 'first',
      url: 'https://bank.example',
      notes: 'hello',
    });

    expect(vault.readPassword(id)).toBe('first');

    vault.updateEntry(id, { title: 'Bank', username: 'me@example.com', password: 'second' });
    expect(vault.readPassword(id)).toBe('second');
    expect(vault.listEntries()[0]!.title).toBe('Bank');

    vault.deleteEntry(id);
    expect(vault.listEntries()).toHaveLength(0);
  });

  it('survives a save/reload cycle with the password intact', async () => {
    const vault = await Vault.create(PASSWORD);
    vault.addEntry({ title: 'Mail', username: 'a@b.c', password: 'p@ss w0rd "quoted"' });

    const bytes = await vault.save();
    const reopened = await Vault.unlock(bytes, PASSWORD);
    const entry = reopened.listEntries()[0]!;

    expect(entry.title).toBe('Mail');
    expect(reopened.readPassword(entry.id)).toBe('p@ss w0rd "quoted"');
  });

  it('drops decrypted state on lock', async () => {
    const vault = await Vault.create(PASSWORD);
    vault.addEntry({ title: 'Thing', password: 'x' });

    expect(vault.isUnlocked).toBe(true);
    vault.lock();

    expect(vault.isUnlocked).toBe(false);
    expect(vault.keyMaterial()).toBeNull();
    expect(() => vault.listEntries()).toThrow(VaultError);
  });
});

describe('changing the master password', () => {
  it('re-encrypts so only the new password opens the vault', async () => {
    const vault = await Vault.create(PASSWORD);
    vault.addEntry({ title: 'Thing', password: 'x' });

    await vault.changeMasterPassword('a brand new passphrase');
    const bytes = await vault.save();

    await expect(Vault.unlock(bytes, PASSWORD)).rejects.toBeInstanceOf(VaultError);
    const reopened = await Vault.unlock(bytes, 'a brand new passphrase');
    expect(reopened.listEntries()).toHaveLength(1);
  });
});

describe('vault identity', () => {
  it('is stable across save and reload', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.vaultId;

    const bytes = await vault.save();
    const reopened = await Vault.unlock(bytes, PASSWORD);

    expect(reopened.vaultId).toBe(id);
    expect(id).toMatch(/^[A-Za-z0-9+/=]{20,}$/);
  });
});

describe('search', () => {
  const entries = [
    { id: '1', title: 'GitHub', username: 'octocat', url: 'https://github.com', notes: 'token abc', updatedAt: 3 },
    { id: '2', title: 'Bank of Example', username: 'me@example.com', url: 'https://bank.example', notes: '', updatedAt: 2 },
    { id: '3', title: 'Email', username: 'someone@github.com', url: '', notes: '', updatedAt: 1 },
  ];

  it('matches case-insensitively across title, username and url', () => {
    expect(filterEntries(entries, 'GITHUB').map((e) => e.id)).toEqual(['1', '3']);
    expect(filterEntries(entries, 'bank').map((e) => e.id)).toEqual(['2']);
    expect(filterEntries(entries, 'octo').map((e) => e.id)).toEqual(['1']);
  });

  it('narrows with each additional term', () => {
    expect(filterEntries(entries, 'github octocat').map((e) => e.id)).toEqual(['1']);
  });

  it('does not match on notes', () => {
    // "token abc" is in entry 1's notes; matching it would surface the entry
    // for a reason invisible in the list row.
    expect(filterEntries(entries, 'token')).toHaveLength(0);
  });

  it('returns everything for an empty query', () => {
    expect(filterEntries(entries, '   ')).toHaveLength(3);
  });
});
