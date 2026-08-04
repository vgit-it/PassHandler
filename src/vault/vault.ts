import * as kdbxweb from 'kdbxweb';

import { installArgon2 } from '../crypto/argon2';
import { EntryInput, VaultEntry, VaultError } from './types';

/**
 * The vault.
 *
 * All cryptography, key derivation and file-format handling is `kdbxweb`'s.
 * This class does no encryption of its own — it opens, mutates and serialises,
 * and every byte that reaches disk or the network came out of `kdbxweb.save()`.
 *
 * Platform-agnostic by construction: nothing here imports a Tauri API, which is
 * why the same code runs in the Windows webview, the Android webview and Node
 * under test. An ESLint rule enforces it.
 */

const DEFAULT_GROUP_NAME = 'Pass Handler';

/**
 * Argon2 work factors for vaults this app creates.
 *
 * `kdbxweb` defaults to 1 MiB of memory and 2 iterations, which is far too weak
 * to protect a master password against an attacker who has the file — the whole
 * point of a memory-hard KDF is defeated at 1 MiB. These values track what
 * KeePassXC uses by default, so a vault created here is as expensive to attack
 * as one created there.
 *
 * They are plain header parameters, so raising them costs nothing in
 * interoperability: any KeePass client reads them out of the file. Files
 * created elsewhere keep whatever settings they arrived with.
 */
const KDF = {
  /** Bytes. `kdbxweb` converts to kibibytes before calling Argon2. */
  memory: 64 * 1024 * 1024,
  iterations: 6,
  parallelism: 2,
} as const;

/** Field names as KeePass defines them. Using anything else breaks KeePassXC. */
const FIELD = {
  title: 'Title',
  username: 'UserName',
  password: 'Password',
  url: 'URL',
  notes: 'Notes',
} as const;

export interface UnlockedInfo {
  vaultId: string;
  entryCount: number;
}

/**
 * Overwrite the KDF work factors `setKdf` just installed with ours.
 *
 * `setKdf` rebuilds the parameter dictionary from `kdbxweb`'s own defaults, so
 * this has to run after it, not before.
 */
function applyKdfParameters(db: kdbxweb.Kdbx): void {
  const params = db.header.kdfParameters;
  if (!params) return;

  const { ValueType } = kdbxweb.VarDictionary;
  params.set('M', ValueType.UInt64, kdbxweb.Int64.from(KDF.memory));
  params.set('I', ValueType.UInt64, kdbxweb.Int64.from(KDF.iterations));
  params.set('P', ValueType.UInt32, KDF.parallelism);
}

function fieldToString(value: kdbxweb.KdbxEntryField | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  // A ProtectedValue is stored XOR-masked in memory; getText() unmasks a copy.
  return value.getText();
}

export class Vault {
  private db: kdbxweb.Kdbx | null = null;

  /**
   * SHA-256 of the master password, as `kdbxweb` computes it for the composite
   * key. Retained after a successful unlock only so that biometric enrolment
   * can hand it to OS secure storage; the master password itself is discarded
   * as soon as `kdbxweb` has hashed it.
   */
  private passwordHash: Uint8Array | null = null;

  get isUnlocked(): boolean {
    return this.db !== null;
  }

  private require(): kdbxweb.Kdbx {
    if (!this.db) throw new VaultError('no-vault');
    return this.db;
  }

  /**
   * A stable identifier for this vault, used to name the file on Drive.
   *
   * The root group's UUID rather than a value of our own: it already lives
   * inside the `.kdbx`, KeePassXC preserves it, and a merge never changes it.
   * Inventing a custom field would work too, but it would be one more thing
   * another KeePass client could drop.
   */
  get vaultId(): string {
    return this.require().getDefaultGroup().uuid.id;
  }

  // ------------------------------------------------------------ lifecycle

  static async create(masterPassword: string, name = DEFAULT_GROUP_NAME): Promise<Vault> {
    installArgon2();

    const credentials = new kdbxweb.Credentials(
      kdbxweb.ProtectedValue.fromString(masterPassword),
    );
    await credentials.ready;

    const db = kdbxweb.Kdbx.create(credentials, name);
    // KDBX4 with Argon2id. KDBX3 exists only for reading files other clients
    // wrote; nothing this app creates should use the older AES-KDF.
    db.setVersion(4);
    db.setKdf(kdbxweb.Consts.KdfId.Argon2id);
    applyKdfParameters(db);

    const vault = new Vault();
    vault.db = db;
    vault.passwordHash = credentials.passwordHash?.getBinary() ?? null;
    return vault;
  }

  /**
   * Open an encrypted vault.
   *
   * Every failure below — bad password, truncated file, unknown cipher —
   * collapses into one error. The caller cannot tell them apart because the
   * user must not be able to either.
   */
  static async unlock(data: ArrayBuffer, masterPassword: string): Promise<Vault> {
    const credentials = new kdbxweb.Credentials(
      kdbxweb.ProtectedValue.fromString(masterPassword),
    );
    await credentials.ready;
    return Vault.open(data, credentials);
  }

  /**
   * Open using key material recovered from OS secure storage after a biometric
   * check, rather than a typed password.
   *
   * `kdbxweb`'s composite key is built from the SHA-256 of the password, and
   * `passwordHash` is a public field on `Credentials`, so the stored 32 bytes
   * can be installed directly. The master password itself is never persisted.
   */
  static async unlockWithKeyMaterial(
    data: ArrayBuffer,
    keyMaterial: Uint8Array,
  ): Promise<Vault> {
    if (keyMaterial.byteLength !== 32) {
      throw new VaultError('wrong-password-or-corrupt');
    }

    const credentials = new kdbxweb.Credentials(null);
    await credentials.ready;
    credentials.passwordHash = kdbxweb.ProtectedValue.fromBinary(
      keyMaterial.slice().buffer,
    );

    return Vault.open(data, credentials);
  }

  private static async open(
    data: ArrayBuffer,
    credentials: kdbxweb.Credentials,
  ): Promise<Vault> {
    installArgon2();

    let db: kdbxweb.Kdbx;
    try {
      db = await kdbxweb.Kdbx.load(data, credentials);
    } catch {
      // Nothing from the caught value is inspected, propagated or logged. It
      // can carry details about the file's contents, and the failure mode is
      // the same regardless of what it says.
      throw new VaultError('wrong-password-or-corrupt');
    }

    const vault = new Vault();
    vault.db = db;
    vault.passwordHash = credentials.passwordHash?.getBinary() ?? null;
    return vault;
  }

  /** Drop every decrypted byte. */
  lock(): void {
    if (this.passwordHash) {
      this.passwordHash.fill(0);
      this.passwordHash = null;
    }
    // `kdbxweb` holds protected values XOR-masked, and dropping the last
    // reference is what makes them collectable. There is no way to force a
    // JavaScript heap wipe, which is why the app also locks aggressively rather
    // than relying on memory hygiene alone.
    this.db = null;
  }

  /** The 32 bytes to hand to OS secure storage when enrolling biometrics. */
  keyMaterial(): Uint8Array | null {
    return this.passwordHash ? this.passwordHash.slice() : null;
  }

  info(): UnlockedInfo {
    return { vaultId: this.vaultId, entryCount: this.listEntries().length };
  }

  // --------------------------------------------------------------- entries

  /**
   * Every entry in the vault, newest first.
   *
   * Groups are flattened. The PRD puts folders and tags out of scope, but other
   * KeePass clients create them, so entries are gathered from the whole tree
   * rather than from the default group only — otherwise a vault organised in
   * KeePassXC would look half empty here.
   */
  listEntries(): VaultEntry[] {
    const db = this.require();
    const recycleBinId = db.meta.recycleBinUuid?.id;
    const entries: VaultEntry[] = [];

    for (const group of db.groups) {
      this.collectEntries(group, recycleBinId, entries);
    }

    return entries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private collectEntries(
    group: kdbxweb.KdbxGroup,
    recycleBinId: string | undefined,
    out: VaultEntry[],
  ): void {
    // Deleted entries live in the recycle bin until KeePassXC empties it.
    // Showing them would be showing the user things they deleted.
    if (recycleBinId && group.uuid.id === recycleBinId) return;

    for (const entry of group.entries) {
      out.push(this.toVaultEntry(entry));
    }
    for (const child of group.groups) {
      this.collectEntries(child, recycleBinId, out);
    }
  }

  private toVaultEntry(entry: kdbxweb.KdbxEntry): VaultEntry {
    return {
      id: entry.uuid.id,
      title: fieldToString(entry.fields.get(FIELD.title)),
      username: fieldToString(entry.fields.get(FIELD.username)),
      url: fieldToString(entry.fields.get(FIELD.url)),
      notes: fieldToString(entry.fields.get(FIELD.notes)),
      updatedAt: entry.times.lastModTime?.getTime() ?? 0,
    };
  }

  private findEntry(id: string): kdbxweb.KdbxEntry | undefined {
    const db = this.require();
    for (const group of db.groups) {
      const found = this.searchGroup(group, id);
      if (found) return found;
    }
    return undefined;
  }

  private searchGroup(
    group: kdbxweb.KdbxGroup,
    id: string,
  ): kdbxweb.KdbxEntry | undefined {
    for (const entry of group.entries) {
      if (entry.uuid.id === id) return entry;
    }
    for (const child of group.groups) {
      const found = this.searchGroup(child, id);
      if (found) return found;
    }
    return undefined;
  }

  /**
   * The plaintext password for one entry.
   *
   * The single place a decrypted password is produced. Callers use it and drop
   * it — copy to clipboard, or render behind a reveal toggle that re-masks
   * itself. It is never stored in component state.
   */
  readPassword(id: string): string | null {
    const entry = this.findEntry(id);
    if (!entry) return null;
    return fieldToString(entry.fields.get(FIELD.password));
  }

  addEntry(input: EntryInput): string {
    const db = this.require();
    const entry = db.createEntry(db.getDefaultGroup());
    this.applyInput(entry, input);
    return entry.uuid.id;
  }

  updateEntry(id: string, input: EntryInput): void {
    const entry = this.findEntry(id);
    if (!entry) throw new VaultError('no-vault');

    // KeePass keeps a history record per edit. Pushing before mutating is what
    // makes per-entry merge resolve by timestamp instead of guessing.
    entry.pushHistory();
    this.applyInput(entry, input);
  }

  private applyInput(entry: kdbxweb.KdbxEntry, input: EntryInput): void {
    entry.fields.set(FIELD.title, input.title);
    entry.fields.set(FIELD.username, input.username ?? '');
    entry.fields.set(FIELD.url, input.url ?? '');
    entry.fields.set(FIELD.notes, input.notes ?? '');

    // The password is the one field stored protected, matching what KeePassXC
    // does — it stays masked in memory and is written to the encrypted inner
    // stream rather than as plain XML.
    entry.fields.set(
      FIELD.password,
      kdbxweb.ProtectedValue.fromString(input.password ?? ''),
    );

    entry.times.update();
  }

  /**
   * Delete an entry.
   *
   * `kdbxweb.remove` moves to the recycle bin when the vault has one and
   * records a deleted-object tombstone otherwise. Either way the deletion
   * carries a timestamp, which is what lets a merge propagate it to the other
   * device instead of resurrecting the entry.
   */
  deleteEntry(id: string): void {
    const entry = this.findEntry(id);
    if (!entry) return;
    this.require().remove(entry);
  }

  // -------------------------------------------------------- persistence

  async save(): Promise<ArrayBuffer> {
    return this.require().save();
  }

  /**
   * Re-key the vault.
   *
   * Every other device will need the new password before it can sync, because
   * a database encrypted with a different key cannot be merged — the remote
   * simply will not decrypt. The UI says so before calling this.
   */
  async changeMasterPassword(newPassword: string): Promise<void> {
    const db = this.require();
    const protectedValue = kdbxweb.ProtectedValue.fromString(newPassword);

    await db.credentials.setPassword(protectedValue);
    // Recorded in the file so other clients can tell the key changed and when.
    db.meta.keyChanged = new Date();

    if (this.passwordHash) this.passwordHash.fill(0);
    this.passwordHash = db.credentials.passwordHash?.getBinary() ?? null;
  }

  // -------------------------------------------------------------- merging

  /**
   * Merge a remote copy of this vault into the local one.
   *
   * `kdbxweb` merges at entry granularity using per-entry UUIDs and
   * modification timestamps, so two devices editing different entries both keep
   * their work, and two devices editing the same entry resolve by time rather
   * than one silently clobbering the other.
   *
   * The remote must open with the *current* credentials. If it does not, the
   * master password was changed elsewhere and merging is not attempted — the
   * caller surfaces that as its own error rather than treating it as a corrupt
   * file.
   */
  async merge(remoteData: ArrayBuffer): Promise<void> {
    const db = this.require();

    let remote: kdbxweb.Kdbx;
    try {
      remote = await kdbxweb.Kdbx.load(remoteData, db.credentials);
    } catch {
      throw new VaultError('wrong-password-or-corrupt');
    }

    db.merge(remote);
  }

  /**
   * Edit state, for persisting across restarts.
   *
   * Without it a merge cannot tell "this entry was deleted here" from "this
   * entry has not arrived here yet", and deletions come back from the dead.
   * It holds UUIDs and timestamps only — no titles, usernames or passwords —
   * which is why it is safe to store unencrypted alongside the vault.
   */
  getEditState(): unknown {
    return this.require().getLocalEditState();
  }

  setEditState(state: unknown): void {
    if (!state) return;
    this.require().setLocalEditState(state as kdbxweb.KdbxEditState);
  }

  /** Called after a push is confirmed: local and remote now agree. */
  clearEditState(): void {
    this.require().removeLocalEditState();
  }
}
