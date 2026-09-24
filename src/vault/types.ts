import { FieldDataType, LOGIN_TYPE_ID } from './entryTypes';

/**
 * Provenance for a renewal date produced by the "Calculate…" panel — see
 * `date-renewal-field-redesign.md`. Lives on a renewal-companion field
 * alongside `renewalOf`, only while the field's value still reflects what
 * the calculator last computed; typing over the value directly drops this
 * (but not `renewalOf` — the field stays linked, just no longer explains
 * itself) same as the calculator note it replaces used to.
 */
export interface RenewalCalc {
  /** 'original' anchors to the date field named by `renewalOf`; 'today'
   * anchors to the day the calculation was run. */
  anchor: 'today' | 'original';
  years: number;
  months: number;
  days: number;
  /** The `renewalOf` field's own value at calculation time. Only
   * meaningful when `anchor === 'original'` — compared against that
   * field's *current* value to detect drift (it was edited since this was
   * calculated) without re-deriving anything. `''` when `anchor ===
   * 'today'`, since today never drifts out from under a stored value the
   * way a field someone can edit does. */
  anchorSnapshot: string;
}

/**
 * One field on an entry, template or custom — the same shape either way, per
 * `entry-type-expansion-spec.md`: "custom fields use the identical structure
 * (no separate shape)". The type only decides which fields exist; nothing
 * about *how* a field is rendered depends on whether it came from the
 * registry or was added by hand.
 *
 * `value` is always `''` for a `sensitive` field — see the note on
 * `VaultEntry` below. Fetch the real value on demand with
 * `Vault.readField(entryId, field.key)`.
 */
export interface EntryField {
  key: string;
  label: string;
  value: string;
  dataType: FieldDataType;
  sensitive: boolean;
  copyable: boolean;
  fillable: boolean;
  /** False for a type's template fields (Username, Card Number, …), true for
   * a field the user added by hand via "Add field". Editor-only concern —
   * changes nothing about how a field is stored or displayed — but it is
   * cheap to carry here and saves every consumer from re-deriving it against
   * the registry. */
  custom: boolean;
  /** Present only on a renewal-companion date field — the `key` of the date
   * field (template or custom, on this same entry) that it renews. Absent
   * on every other field, including the original field itself; there is no
   * flag on the original side, a consumer that needs "does field X have a
   * renewal" finds it by scanning the entry's other fields for this. See
   * `date-renewal-field-redesign.md`. */
  renewalOf?: string;
  /** Present alongside `renewalOf` while this field's value still reflects
   * what the calculator last computed — see `RenewalCalc`'s own doc. */
  renewalCalc?: RenewalCalc;
  /** True once this `dataType: 'date'` field has been opted into the
   * Upcoming tab — see `upcoming-tab-design.md`. Meaningless (and never
   * set) on anything but a date field; independent per field, so a renewal
   * companion can be tracked without its original being tracked, or the
   * other way round. Absent, not `false`, when untracked — same
   * presence-as-boolean convention `needsReview`'s own storage key uses. */
  trackedInUpcoming?: boolean;
}

/**
 * The shape the UI sees.
 *
 * Note what is missing: sensitive field values. A field object for a
 * sensitive field (Password, CVV, a Secure Note's… no, Secure Note's Body is
 * not sensitive — but a card's Number is) is always present in `fields`, with
 * `value: ''`. Entries are never carried in React state, a component prop, or
 * a DevTools snapshot with a secret sitting in them; they are read one at a
 * time, on demand, straight out of the in-memory `kdbxweb` database — see
 * `Vault.readField`.
 */
export interface VaultEntry {
  id: string;
  /** An `entryTypes.ts` id. Always a known id — `Vault` resolves anything
   * unrecognised (including entries with no type at all, from before this
   * feature existed) to `login` before this ever reaches the UI. */
  type: string;
  title: string;
  fields: EntryField[];
  /** Epoch milliseconds. Used for sorting and for conflict explanations. */
  updatedAt: number;
  /** True for an entry auto-saved by the streamlined account-creation flow
   * that hasn't been looked over yet — `EntryList` pins these under a
   * "Review" section. Cleared automatically the next time this entry goes
   * through an ordinary edit+Save; see `Vault.setNeedsReview`'s doc. */
  needsReview: boolean;
}

/** Look up one field on an entry by key. */
export function findField(entry: VaultEntry, key: string): EntryField | undefined {
  return entry.fields.find((f) => f.key === key);
}

/** The field's value, or `''` if the entry has no such field (or it's
 * sensitive and unrevealed) — never `undefined`, so callers can use this
 * directly wherever they'd otherwise reach for a flat `entry.username`. */
export function fieldValue(entry: VaultEntry, key: string): string {
  return findField(entry, key)?.value ?? '';
}

/**
 * One field's worth of input to `EntryInput.fields`.
 *
 * `custom: true` marks a user-added field the type's registry does not know
 * about — those get a `label`, `dataType` and `sensitive` supplied by the
 * caller (the editor's "Add field" UI). Template fields omit all three:
 * `Vault` fills them in from `entryTypes.ts` at write time, so the same
 * field's label can never drift between the registry and what's on disk.
 */
export interface EntryFieldInput {
  key: string;
  value: string;
  custom?: boolean;
  label?: string;
  dataType?: FieldDataType;
  sensitive?: boolean;
  /** See `EntryField.renewalOf`/`renewalCalc` — carried through unchanged
   * from the editor's draft to storage. Only ever set on a `custom: true`
   * field. */
  renewalOf?: string;
  renewalCalc?: RenewalCalc;
  /** See `EntryField.trackedInUpcoming` — carried through unchanged from
   * the editor's draft to storage, template fields and custom fields alike. */
  trackedInUpcoming?: boolean;
}

/**
 * What the editor submits.
 *
 * `type` is optional so every pre-existing call site — tests included — that
 * only ever dealt with logins keeps compiling and behaving unchanged:
 * omitted, `Vault.addEntry` defaults it to `login` and `Vault.updateEntry`
 * keeps whatever type the entry already had.
 *
 * The flat `username`/`password`/`url`/`notes` fields exist for exactly one
 * type — `login` — which `Vault` keeps on KeePass's standard fields rather
 * than the generic scheme (see `vault.ts`). Every other type's fields travel
 * through `fields` instead. A `login` entry can carry `fields` too, for
 * user-added custom fields — custom fields are not type-specific.
 */
export interface EntryInput {
  type?: string;
  title: string;
  username?: string;
  email?: string;
  password?: string;
  url?: string;
  notes?: string;
  fields?: EntryFieldInput[];
}

export { LOGIN_TYPE_ID };

/**
 * Why an unlock failed.
 *
 * `wrong-password-or-corrupt` is one case on purpose. Telling the user which of
 * the two it was tells an attacker with the file whether a guess was close, and
 * the PRD is explicit that unlock failures are indistinguishable.
 */
export type UnlockFailure =
  | 'wrong-password-or-corrupt'
  | 'unsupported-format'
  | 'no-vault';

export class VaultError extends Error {
  constructor(public readonly reason: UnlockFailure) {
    // The message is a stable code, never a description of what went wrong
    // internally, because it may be rendered or logged by a caller.
    super(reason);
    this.name = 'VaultError';
  }
}
