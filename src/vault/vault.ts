import * as kdbxweb from 'kdbxweb';

import { installArgon2 } from '../crypto/argon2';
import { getEntryType, LOGIN_TYPE_ID, NOTES_FIELD } from './entryTypes';
import {
  customFieldDataTypeKey,
  customFieldKey,
  customFieldMetaKey,
  customFieldRenewalKey,
  customFieldTrackKey,
  customKeyFromFieldName,
  isCustomFieldName,
  isVaultFieldName,
  reviewMetaKey,
  templateFieldKey,
  templateFieldTrackKey,
  typeMetaKey,
} from './fieldKeys';
import { EntryField, EntryInput, RenewalCalc, VaultEntry, VaultError } from './types';

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

const DEFAULT_GROUP_NAME = 'Vault';

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

/** Field names as KeePass defines them. Using anything else breaks KeePassXC.
 *
 * These are the fields `login`-type entries live on — and, deliberately,
 * *only* `login`-type entries. Every other entry type stores its fields under
 * the generic `ph:f:`/`ph:c:` scheme in `fieldKeys.ts`. A literal reading of
 * `entry-type-expansion-spec.md` would move Login's Username/Password onto
 * that scheme too, but Login is the overwhelming majority of real entries —
 * today's and every existing vault's — and keeping it on the fields KeePassXC
 * already gives first-class UI to means: no migration risk for a single
 * existing entry, KeePassXC keeps showing Login entries the way it always
 * has, and the URL-driven favicon lookup and Notes field keep working with
 * zero new code. Every other type uses the spec's scheme exactly as written. */
const FIELD = {
  title: 'Title',
  username: 'UserName',
  password: 'Password',
  url: 'URL',
  notes: 'Notes',
  // Not one of KeePass's five dedicated fields (Title/UserName/Password/URL/
  // Notes) — there is no such slot in the format. This is a plain extra
  // string attribute, same as any custom field, except stored under its own
  // readable name (`'Email'`) rather than the `ph:c:` custom-field prefix, so
  // it round-trips as a normal named attribute in another KeePass client
  // rather than as an opaque `ph:c:Email`. See the Login branch of
  // `applyInput`/`toVaultEntry` for how it's written and read.
  email: 'Email',
} as const;

/** Login entries also get a URL and Notes field, in addition to the two
 * `entryTypes.ts` lists for Login (Username, Password) — not because the
 * registry says so, but because that is what a "Login" has always meant in
 * this app, and changing it would be a regression, not an improvement. Kept
 * as one small, explicit exception rather than folded into the registry, so
 * the registry stays an honest description of what a type's *storage*
 * doesn't decide — see the `entryTypes.ts` file comment. */
const LOGIN_EXTRA_FIELDS: Array<{ key: string; label: string; kdbxField: string; multiline?: boolean }> = [
  { key: 'url', label: 'URL', kdbxField: FIELD.url },
  { key: 'notes', label: 'Notes', kdbxField: FIELD.notes, multiline: true },
];

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

/** Reads a presence-as-boolean `ph:f-track:`/`ph:c-track:` key — `'true'`
 * means tracked, anything else (usually absence) means not. See
 * `upcoming-tab-design.md`'s "Data model" section. */
function readTracked(entry: kdbxweb.KdbxEntry, trackKey: string): boolean {
  return fieldToString(entry.fields.get(trackKey)) === 'true';
}

/** A non-sensitive field, its value already known. */
function plainField(
  key: string,
  label: string,
  value: string,
  dataType: EntryField['dataType'],
  custom: boolean,
): EntryField {
  return { key, label, value, dataType, sensitive: false, copyable: true, fillable: true, custom };
}

/** A sensitive field. `value` is always `''` here — see `VaultEntry`'s doc
 * comment on why a sensitive value never sits in this object. */
function sensitiveField(
  key: string,
  label: string,
  dataType: EntryField['dataType'],
  custom: boolean,
): EntryField {
  return { key, label, value: '', dataType, sensitive: true, copyable: true, fillable: true, custom };
}

/** Parses a `customFieldRenewalKey` value (`{"of": string, "calc"?: {...}}`)
 * back into `EntryField.renewalOf`/`renewalCalc`. Anything malformed —
 * missing/empty `of`, a `calc` with the wrong shape, or not JSON at all
 * (hand-edited in another KeePass client, or simply absent) — is treated as
 * "not a renewal field", never thrown: this runs on every entry read, and a
 * foreign or corrupted value here must degrade to an ordinary field, not
 * break the vault open. */
function parseRenewalLink(raw: string): Pick<EntryField, 'renewalOf' | 'renewalCalc'> {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const of = (parsed as { of?: unknown }).of;
  if (typeof of !== 'string' || of === '') return {};

  const result: Pick<EntryField, 'renewalOf' | 'renewalCalc'> = { renewalOf: of };
  const calc = (parsed as { calc?: unknown }).calc;
  if (typeof calc === 'object' && calc !== null) {
    const c = calc as Partial<RenewalCalc>;
    if (
      (c.anchor === 'today' || c.anchor === 'original') &&
      typeof c.years === 'number' &&
      typeof c.months === 'number' &&
      typeof c.days === 'number' &&
      typeof c.anchorSnapshot === 'string'
    ) {
      result.renewalCalc = {
        anchor: c.anchor,
        years: c.years,
        months: c.months,
        days: c.days,
        anchorSnapshot: c.anchorSnapshot,
      };
    }
  }
  return result;
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

  /** The type id stored on an entry, or `login` for one with none — the
   * migration rule: an entry with no `ph:type` (every entry that existed
   * before this feature, and every Login entry created since — see the
   * `FIELD` comment above) is treated as Login in memory. The vault file is
   * never rewritten just to add that tag; it only changes if and when the
   * entry itself is next edited. */
  private entryTypeId(entry: kdbxweb.KdbxEntry): string {
    return fieldToString(entry.fields.get(typeMetaKey())) || LOGIN_TYPE_ID;
  }

  private toVaultEntry(entry: kdbxweb.KdbxEntry): VaultEntry {
    const typeId = this.entryTypeId(entry);
    const fields: EntryField[] = [];

    if (typeId === LOGIN_TYPE_ID) {
      fields.push(plainField('username', 'Username', fieldToString(entry.fields.get(FIELD.username)), 'text', false));
      // Between Username and Password, not folded into `LOGIN_EXTRA_FIELDS`
      // below (which only ever runs after Password) — a lot of logins are
      // "email address, then password", and the field order here is what
      // the fill flows and `EntryDetail` render in.
      fields.push(plainField('email', 'Email', fieldToString(entry.fields.get(FIELD.email)), 'text', false));
      fields.push(sensitiveField('password', 'Password', 'text', false));
      for (const extra of LOGIN_EXTRA_FIELDS) {
        fields.push(
          plainField(extra.key, extra.label, fieldToString(entry.fields.get(extra.kdbxField)), extra.multiline ? 'multiline' : 'text', false),
        );
      }
    } else {
      const typeDef = getEntryType(typeId);
      // NOTES_FIELD rides along after the type's own template fields — every
      // non-login type gets a Notes field, not just the ones whose registry
      // entry happens to list one. See its doc comment in `entryTypes.ts`.
      for (const def of [...typeDef.templateFields, NOTES_FIELD]) {
        if (def.sensitive) {
          const field = sensitiveField(def.key, def.label, def.dataType, false);
          if (readTracked(entry, templateFieldTrackKey(def.key))) field.trackedInUpcoming = true;
          fields.push(field);
          continue;
        }
        const value = fieldToString(entry.fields.get(templateFieldKey(def.key)));
        if (def.optional && value === '') continue;
        const field = plainField(def.key, def.label, value, def.dataType, false);
        if (readTracked(entry, templateFieldTrackKey(def.key))) field.trackedInUpcoming = true;
        fields.push(field);
      }
    }

    // Custom fields — added by hand, so not in any registry — for any type,
    // including Login. `entry.fields` is a `Map`, which iterates in
    // insertion order, so this naturally yields "in the order they were
    // added" without any bookkeeping of our own.
    for (const [name, raw] of entry.fields) {
      if (typeof name !== 'string' || !isCustomFieldName(name)) continue;
      const key = customKeyFromFieldName(name);
      const sensitive = fieldToString(entry.fields.get(customFieldMetaKey(key))) === 'sensitive';
      // A sensitive custom field is always rendered as plain masked text —
      // see `CustomFieldRow`'s "Date only ever applies to a non-sensitive
      // field" comment — so its dataType is never read back from storage,
      // same as it was never given a choice going in.
      const dataType: EntryField['dataType'] =
        !sensitive && fieldToString(entry.fields.get(customFieldDataTypeKey(key))) === 'date'
          ? 'date'
          : 'text';
      const field = sensitive
        ? sensitiveField(key, key, 'text', true)
        : plainField(key, key, fieldToString(raw), dataType, true);

      if (readTracked(entry, customFieldTrackKey(key))) field.trackedInUpcoming = true;

      const { renewalOf, renewalCalc } = parseRenewalLink(
        fieldToString(entry.fields.get(customFieldRenewalKey(key))),
      );
      if (renewalOf) {
        field.renewalOf = renewalOf;
        // A renewal companion is never its own fill target — it is not the
        // credential a site's date field wants, it is metadata about when
        // the *original* field needs replacing. Left `fillable` (`plainField`
        // defaults every field to `true`), it shows up as its own separate,
        // unattached entry in both manual-fill pickers — `PickEntryDetail`'s
        // `fillableFields` filter on Windows, and `VaultKeyboardView.
        // kt`'s `entry.fields.filter { it.fillable }` on Android — which is
        // exactly the "one more date field, aside from the one attached to
        // the main field" a renewal produced before this was set. Both
        // pickers already respect `fillable`; this is the one place that
        // needed to say so.
        field.fillable = false;
      }
      if (renewalCalc) field.renewalCalc = renewalCalc;

      fields.push(field);
    }

    return {
      id: entry.uuid.id,
      type: typeId,
      title: fieldToString(entry.fields.get(FIELD.title)),
      fields,
      updatedAt: entry.times.lastModTime?.getTime() ?? 0,
      needsReview: fieldToString(entry.fields.get(reviewMetaKey())) === 'true',
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
   * The plaintext value for one sensitive field on one entry — Login's
   * Password, a Card's Number or CVV, a custom field marked sensitive, and
   * so on. The single place a decrypted sensitive value is produced. Callers
   * use it and drop it — copy to clipboard, or render behind a reveal toggle
   * that re-masks itself. It is never stored in component state.
   *
   * Also answers for a non-sensitive field, for callers that don't already
   * know which a given key is — though every non-sensitive value is already
   * on the `VaultEntry` from `listEntries()`, so there is rarely a reason to.
   */
  readField(id: string, key: string): string | null {
    const entry = this.findEntry(id);
    if (!entry) return null;

    if (key === 'password' && this.entryTypeId(entry) === LOGIN_TYPE_ID) {
      return fieldToString(entry.fields.get(FIELD.password));
    }
    if (this.entryTypeId(entry) === LOGIN_TYPE_ID) {
      const extra = LOGIN_EXTRA_FIELDS.find((e) => e.key === key);
      if (extra) return fieldToString(entry.fields.get(extra.kdbxField));
      if (key === 'username') return fieldToString(entry.fields.get(FIELD.username));
      if (key === 'email') return fieldToString(entry.fields.get(FIELD.email));
    }

    const templateValue = entry.fields.get(templateFieldKey(key));
    if (templateValue !== undefined) return fieldToString(templateValue);

    const customValue = entry.fields.get(customFieldKey(key));
    if (customValue !== undefined) return fieldToString(customValue);

    return null;
  }

  /** Thin, backward-compatible alias for `readField(id, 'password')` — the
   * one sensitive field every pre-existing caller (Android manual fill,
   * `EntryDetail`'s "Copy password" button) already knows by name. */
  readPassword(id: string): string | null {
    return this.readField(id, 'password');
  }

  addEntry(input: EntryInput): string {
    const db = this.require();
    const entry = db.createEntry(db.getDefaultGroup());
    this.applyInput(entry, input, input.type ?? LOGIN_TYPE_ID);
    return entry.uuid.id;
  }

  updateEntry(id: string, input: EntryInput): void {
    const entry = this.findEntry(id);
    if (!entry) throw new VaultError('no-vault');

    // KeePass keeps a history record per edit. Pushing before mutating is what
    // makes per-entry merge resolve by timestamp instead of guessing.
    entry.pushHistory();
    this.applyInput(entry, input, input.type ?? this.entryTypeId(entry));
  }

  private applyInput(entry: kdbxweb.KdbxEntry, input: EntryInput, typeId: string): void {
    entry.fields.set(FIELD.title, input.title);

    // Every `ph:` key this entry might currently hold is cleared and
    // rewritten from scratch below, rather than diffed. An edit that removes
    // a custom field, or changes which template fields have values, must
    // never leave an orphaned `ph:f:`/`ph:c:`/`ph:c-meta:` key behind — and a
    // full rewrite is the only way to guarantee that without tracking what
    // was there before.
    for (const name of [...entry.fields.keys()]) {
      if (typeof name === 'string' && isVaultFieldName(name)) entry.fields.delete(name);
    }

    if (typeId === LOGIN_TYPE_ID) {
      entry.fields.set(FIELD.username, input.username ?? '');
      entry.fields.set(FIELD.email, input.email ?? '');
      entry.fields.set(FIELD.url, input.url ?? '');
      entry.fields.set(FIELD.notes, input.notes ?? '');
      entry.fields.set(FIELD.password, kdbxweb.ProtectedValue.fromString(input.password ?? ''));
    } else {
      // Not a login (any more, if this is an edit) — the standard fields
      // Login uses are meaningless for any other type, so they're dropped
      // rather than left stale. Type changes on a saved entry are out of
      // scope per the spec, but `addEntry` for a fresh non-login entry passes
      // through here too, and must not inherit stray standard fields.
      entry.fields.delete(FIELD.username);
      entry.fields.delete(FIELD.email);
      entry.fields.delete(FIELD.password);
      entry.fields.delete(FIELD.url);
      entry.fields.delete(FIELD.notes);

      entry.fields.set(typeMetaKey(), typeId);

      const typeDef = getEntryType(typeId);
      // NOTES_FIELD alongside the type's own fields — see the matching
      // comment in `toVaultEntry`.
      for (const def of [...typeDef.templateFields, NOTES_FIELD]) {
        const provided = input.fields?.find((f) => f.key === def.key && !f.custom);
        const value = provided?.value ?? '';
        entry.fields.set(
          templateFieldKey(def.key),
          def.sensitive ? kdbxweb.ProtectedValue.fromString(value) : value,
        );
        // Presence-as-boolean, same as every other `ph:track:`-style key —
        // the blanket delete pass above already dropped whatever was here
        // before, so an untracked field simply never gets this key back.
        if (provided?.trackedInUpcoming) entry.fields.set(templateFieldTrackKey(def.key), 'true');
      }
    }

    // Custom fields — user-added, not in any registry — apply to any type,
    // Login included.
    for (const f of input.fields ?? []) {
      if (!f.custom) continue;
      entry.fields.set(
        customFieldKey(f.key),
        f.sensitive ? kdbxweb.ProtectedValue.fromString(f.value) : f.value,
      );
      entry.fields.set(customFieldMetaKey(f.key), f.sensitive ? 'sensitive' : 'plain');
      // Written even for a sensitive field (as 'text', its only possible
      // value there) rather than skipped — so this key's mere presence
      // never has to be cross-checked against sensitivity elsewhere; every
      // custom field always has one.
      entry.fields.set(customFieldDataTypeKey(f.key), f.dataType === 'date' ? 'date' : 'text');
      if (f.trackedInUpcoming) entry.fields.set(customFieldTrackKey(f.key), 'true');
      if (f.renewalOf) {
        const link: { of: string; calc?: RenewalCalc } = { of: f.renewalOf };
        if (f.renewalCalc) link.calc = f.renewalCalc;
        entry.fields.set(customFieldRenewalKey(f.key), JSON.stringify(link));
      }
      // No `renewalOf` → no `ph:c-renewal:` key is set here at all, and the
      // blanket delete-every-`ph:`-key pass above already removed whatever
      // was there before this edit — same "full rewrite, not a diff" rule
      // every other `ph:` key on this entry follows.
    }

    entry.times.update();
  }

  /**
   * Flags (or unflags) an entry as not yet looked over — used only by the
   * streamlined account-creation flow, right after it commits a draft entry
   * built up in the IME. Deliberately not part of `EntryInput`/`applyInput`:
   * that path wipes every `ph:`-prefixed key on any ordinary edit and
   * rewrites only what it's given, so calling this once right after
   * `addEntry` — rather than threading a "review" flag through `EntryInput`
   * itself — is what lets the very next ordinary Save clear the flag simply
   * by never being asked to restore it. Bumps `updatedAt` like any other
   * mutation, so a freshly-drafted entry sorts as recently touched.
   */
  setNeedsReview(id: string, needsReview: boolean): void {
    const entry = this.findEntry(id);
    if (!entry) throw new VaultError('no-vault');
    if (needsReview) entry.fields.set(reviewMetaKey(), 'true');
    else entry.fields.delete(reviewMetaKey());
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
