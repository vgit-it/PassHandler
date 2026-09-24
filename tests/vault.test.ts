import { describe, expect, it } from 'vitest';
import * as kdbxweb from 'kdbxweb';

import { installArgon2 } from '@/crypto/argon2';
import { Vault } from '@/vault/vault';
import { fieldValue, VaultEntry, VaultError } from '@/vault/types';
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
      expect(fieldValue(entries[0]!, 'username')).toBe('octocat');
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

describe('needs review', () => {
  it('is false for an entry created normally', async () => {
    const vault = await Vault.create(PASSWORD);
    vault.addEntry({ title: 'Thing', password: 'x' });
    expect(vault.listEntries()[0]!.needsReview).toBe(false);
  });

  it('flags an entry, and an ordinary edit clears the flag again', async () => {
    // The whole point of keeping this outside `EntryInput`/`applyInput`'s
    // scheme (see `fieldKeys.ts`'s `reviewMetaKey` doc) — a plain Save
    // through the normal edit path must drop the flag without any
    // dedicated "mark reviewed" call.
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({ title: 'Draft', password: 'generated-pw' });

    vault.setNeedsReview(id, true);
    expect(vault.listEntries()[0]!.needsReview).toBe(true);
    // The password itself is untouched by flagging it.
    expect(vault.readPassword(id)).toBe('generated-pw');

    vault.updateEntry(id, { title: 'Draft', password: 'generated-pw' });
    expect(vault.listEntries()[0]!.needsReview).toBe(false);
  });

  it('survives a save/reload cycle', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({ title: 'Draft', password: 'x' });
    vault.setNeedsReview(id, true);

    const bytes = await vault.save();
    const reopened = await Vault.unlock(bytes, PASSWORD);
    expect(reopened.listEntries()[0]!.needsReview).toBe(true);
  });
});

describe('entry types', () => {
  it('stores a non-login type under ph: custom strings, template fields in registry order', async () => {
    const vault = await Vault.create(PASSWORD);

    const id = vault.addEntry({
      type: 'card',
      title: 'Groceries card',
      fields: [
        { key: 'number', value: '4111111111111111' },
        { key: 'expiry', value: '12/29' },
        { key: 'cvv', value: '123' },
        { key: 'nameOnCard', value: 'P Jacob' },
      ],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    expect(entry.type).toBe('card');
    // Sensitive template fields never carry a value on the list model.
    const number = entry.fields.find((f) => f.key === 'number')!;
    expect(number.sensitive).toBe(true);
    expect(number.value).toBe('');
    expect(vault.readField(id, 'number')).toBe('4111111111111111');
    expect(vault.readField(id, 'cvv')).toBe('123');
    // Non-sensitive template fields are on the list model already.
    expect(entry.fields.find((f) => f.key === 'expiry')!.value).toBe('12/29');
    expect(entry.fields.find((f) => f.key === 'nameOnCard')!.value).toBe('P Jacob');
  });

  it('hides an empty optional template field instead of rendering it blank', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      type: 'identity',
      title: 'Passport',
      fields: [{ key: 'idNumber', value: 'X1234567' }],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    // 'expiry' is marked optional on the Identity Doc template and was left
    // blank — it should not appear in the field list at all.
    expect(entry.fields.some((f) => f.key === 'expiry')).toBe(false);
  });

  it('round-trips a custom field, including its sensitivity, on any type', async () => {
    const vault = await Vault.create(PASSWORD);

    const loginId = vault.addEntry({
      title: 'Example',
      username: 'me',
      password: 'pw',
      fields: [{ key: 'PIN', value: '4242', custom: true, sensitive: true }],
    });

    const entry = vault.listEntries().find((e) => e.id === loginId)!;
    const pin = entry.fields.find((f) => f.key === 'PIN')!;
    expect(pin.custom).toBe(true);
    expect(pin.sensitive).toBe(true);
    expect(pin.value).toBe('');
    expect(vault.readField(loginId, 'PIN')).toBe('4242');
  });

  it('round-trips a custom field\'s dataType, including "date"', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      title: 'Example',
      username: 'me',
      password: 'pw',
      fields: [
        { key: 'note', value: 'a plain note', custom: true, dataType: 'text' },
        { key: 'expiry', value: '2026-03-12', custom: true, dataType: 'date' },
      ],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    expect(entry.fields.find((f) => f.key === 'note')!.dataType).toBe('text');
    expect(entry.fields.find((f) => f.key === 'expiry')!.dataType).toBe('date');
  });

  it('round-trips a tracked template date field, and leaves an untracked one absent', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      type: 'identity',
      title: 'Passport',
      fields: [
        { key: 'idNumber', value: 'X1234567' },
        { key: 'expiry', value: '2027-05-01', trackedInUpcoming: true },
      ],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    expect(entry.fields.find((f) => f.key === 'expiry')!.trackedInUpcoming).toBe(true);
    // idNumber was never given `trackedInUpcoming` — presence-as-boolean,
    // same as `needsReview`'s own storage key, so it comes back `undefined`
    // rather than an explicit `false`.
    expect(entry.fields.find((f) => f.key === 'idNumber')!.trackedInUpcoming).toBeUndefined();
  });

  it('round-trips a tracked custom date field, distinctly from a same-named template field', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      type: 'identity',
      title: 'Passport',
      fields: [
        { key: 'idNumber', value: 'X1234567' },
        { key: 'expiry', value: '2027-05-01' }, // template Expiry, untracked
        {
          key: 'expiry', // a custom field, deliberately same key as the template one
          value: '2028-01-01',
          custom: true,
          dataType: 'date',
          trackedInUpcoming: true,
        },
      ],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    const templateExpiry = entry.fields.find((f) => f.key === 'expiry' && !f.custom)!;
    const customExpiry = entry.fields.find((f) => f.key === 'expiry' && f.custom)!;
    expect(templateExpiry.trackedInUpcoming).toBeUndefined();
    expect(customExpiry.trackedInUpcoming).toBe(true);
  });

  it('drops a tracked flag once an edit stops tracking that field, same as any other ph: key', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      type: 'identity',
      title: 'Passport',
      fields: [
        { key: 'idNumber', value: 'X1234567' },
        { key: 'expiry', value: '2027-05-01', trackedInUpcoming: true },
      ],
    });
    expect(vault.listEntries().find((e) => e.id === id)!.fields.find((f) => f.key === 'expiry')!.trackedInUpcoming).toBe(true);

    vault.updateEntry(id, {
      type: 'identity',
      title: 'Passport',
      fields: [
        { key: 'idNumber', value: 'X1234567' },
        { key: 'expiry', value: '2027-05-01' }, // trackedInUpcoming omitted this time
      ],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    expect(entry.fields.find((f) => f.key === 'expiry')!.trackedInUpcoming).toBeUndefined();
  });

  it('round-trips a renewal-companion field, with its calculator provenance', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      title: 'Example',
      username: 'me',
      password: 'pw',
      fields: [
        { key: 'expiry', value: '2025-03-12', custom: true, dataType: 'date' },
        {
          key: 'expiry-renewal',
          value: '2026-03-12',
          custom: true,
          dataType: 'date',
          renewalOf: 'expiry',
          renewalCalc: { anchor: 'original', years: 1, months: 0, days: 0, anchorSnapshot: '2025-03-12' },
        },
      ],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    const renewal = entry.fields.find((f) => f.key === 'expiry-renewal')!;
    expect(renewal.dataType).toBe('date');
    expect(renewal.value).toBe('2026-03-12');
    expect(renewal.renewalOf).toBe('expiry');
    expect(renewal.renewalCalc).toEqual({
      anchor: 'original',
      years: 1,
      months: 0,
      days: 0,
      anchorSnapshot: '2025-03-12',
    });

    // The original field itself carries no trace of being renewed — a
    // consumer finds the link by scanning for `renewalOf`, not by a flag on
    // this side. See `EntryField.renewalOf`'s own doc.
    const original = entry.fields.find((f) => f.key === 'expiry')!;
    expect(original.renewalOf).toBeUndefined();
    expect(original.renewalCalc).toBeUndefined();
  });

  it('marks a renewal-companion field as not fillable, so it never appears as its own extra field in a manual-fill picker', async () => {
    // Regression test: before `fillable` was set here, both `PickEntryDetail`
    // (Windows) and `VaultKeyboardView.kt` (Android) — which both
    // filter their pickable field list down to `fillable` fields — showed
    // the renewal companion as its own separate, unattached field alongside
    // the original, which is what "one more date field" was.
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      title: 'Example',
      username: 'me',
      password: 'pw',
      fields: [
        { key: 'expiry', value: '2025-03-12', custom: true, dataType: 'date' },
        { key: 'expiry-renewal', value: '2026-03-12', custom: true, dataType: 'date', renewalOf: 'expiry' },
      ],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    expect(entry.fields.find((f) => f.key === 'expiry')!.fillable).toBe(true);
    expect(entry.fields.find((f) => f.key === 'expiry-renewal')!.fillable).toBe(false);
  });

  it('round-trips a renewal-companion field with no calculator provenance (typed/picked directly)', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      title: 'Example',
      username: 'me',
      password: 'pw',
      fields: [
        { key: 'expiry', value: '2025-03-12', custom: true, dataType: 'date' },
        { key: 'expiry-renewal', value: '2026-01-01', custom: true, dataType: 'date', renewalOf: 'expiry' },
      ],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    const renewal = entry.fields.find((f) => f.key === 'expiry-renewal')!;
    expect(renewal.renewalOf).toBe('expiry');
    expect(renewal.renewalCalc).toBeUndefined();
  });

  it('drops a renewal link entirely once an edit removes it, same as any other stale ph: key', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      title: 'Example',
      username: 'me',
      password: 'pw',
      fields: [
        { key: 'expiry', value: '2025-03-12', custom: true, dataType: 'date' },
        {
          key: 'expiry-renewal',
          value: '2026-03-12',
          custom: true,
          dataType: 'date',
          renewalOf: 'expiry',
          renewalCalc: { anchor: 'today', years: 0, months: 6, days: 0, anchorSnapshot: '' },
        },
      ],
    });

    // "Remove renewal date": the companion field is simply gone from the
    // next save, same as any other removed custom field.
    vault.updateEntry(id, {
      title: 'Example',
      username: 'me',
      password: 'pw',
      fields: [{ key: 'expiry', value: '2025-03-12', custom: true, dataType: 'date' }],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    expect(entry.fields.some((f) => f.key === 'expiry-renewal')).toBe(false);
  });

  it('treats an entry with no stored type as login (migration)', async () => {
    // Built directly with kdbxweb, standing in for a vault written before
    // this feature existed — no `ph:type` custom string anywhere.
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({ title: 'Old entry', username: 'me', password: 'pw' });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    expect(entry.type).toBe('login');
  });

  it('clears stale ph: keys when an edit removes a custom field', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      title: 'Example',
      username: 'me',
      password: 'pw',
      fields: [{ key: 'note', value: 'temp', custom: true }],
    });

    vault.updateEntry(id, { title: 'Example', username: 'me', password: 'pw', fields: [] });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    expect(entry.fields.some((f) => f.key === 'note')).toBe(false);
  });

  it('gives a non-login type a universal, optional Notes field', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      type: 'card',
      title: 'Groceries card',
      fields: [
        { key: 'number', value: '4111111111111111' },
        { key: 'notes', value: 'PIN reminder in email' },
      ],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    const notes = entry.fields.find((f) => f.key === 'notes')!;
    expect(notes.sensitive).toBe(false);
    expect(notes.dataType).toBe('multiline');
    expect(notes.value).toBe('PIN reminder in email');
  });

  it('hides an unset Notes field, same as any other empty optional field', async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({ type: 'card', title: 'No notes', fields: [{ key: 'number', value: '1' }] });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    expect(entry.fields.some((f) => f.key === 'notes')).toBe(false);
  });

  it("replaces Bank Account's routing field with an optional IFSC Code", async () => {
    const vault = await Vault.create(PASSWORD);
    const id = vault.addEntry({
      type: 'bank',
      title: 'Savings',
      fields: [
        { key: 'accountNumber', value: '000111222' },
        { key: 'ifsc', value: 'HDFC0001234' },
        { key: 'bankName', value: 'Example Bank' },
      ],
    });

    const entry = vault.listEntries().find((e) => e.id === id)!;
    expect(entry.fields.some((f) => f.key === 'routingNumber')).toBe(false);
    const ifsc = entry.fields.find((f) => f.key === 'ifsc')!;
    expect(ifsc.label).toBe('IFSC Code');
    expect(ifsc.sensitive).toBe(false);
    expect(ifsc.value).toBe('HDFC0001234');
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
  function loginEntry(
    id: string,
    title: string,
    username: string,
    url: string,
    notes: string,
    updatedAt: number,
  ): VaultEntry {
    return {
      id,
      type: 'login',
      title,
      updatedAt,
      needsReview: false,
      fields: [
        { key: 'username', label: 'Username', value: username, dataType: 'text', sensitive: false, copyable: true, fillable: true, custom: false },
        { key: 'password', label: 'Password', value: '', dataType: 'text', sensitive: true, copyable: true, fillable: true, custom: false },
        { key: 'url', label: 'URL', value: url, dataType: 'text', sensitive: false, copyable: true, fillable: true, custom: false },
        { key: 'notes', label: 'Notes', value: notes, dataType: 'multiline', sensitive: false, copyable: true, fillable: true, custom: false },
      ],
    };
  }

  const entries = [
    loginEntry('1', 'GitHub', 'octocat', 'https://github.com', 'token abc', 3),
    loginEntry('2', 'Bank of Example', 'me@example.com', 'https://bank.example', '', 2),
    loginEntry('3', 'Email', 'someone@github.com', '', '', 1),
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

  it('matches the type label', () => {
    expect(filterEntries(entries, 'login').map((e) => e.id).sort()).toEqual(['1', '2', '3']);
  });

  it('returns everything for an empty query', () => {
    expect(filterEntries(entries, '   ')).toHaveLength(3);
  });
});
