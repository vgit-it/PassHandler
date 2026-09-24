/**
 * The `ph:`-prefixed custom-string key scheme every non-login entry type
 * stores its fields under.
 *
 * Split out from `vault.ts` on purpose: this is pure string manipulation with
 * no `kdbxweb` dependency, so it can be unit-tested (see
 * `tests/fieldKeys.test.ts`) without ever touching a real vault, and so the
 * "what key does field X live under" question has exactly one place to look
 * up or change the answer.
 *
 * `login` entries never use this scheme — see the comment on `LOGIN_TYPE_ID`
 * usage in `vault.ts`.
 */

const TYPE_META_KEY = 'ph:type';
const REVIEW_META_KEY = 'ph:review';
const TEMPLATE_PREFIX = 'ph:f:';
const TEMPLATE_TRACK_PREFIX = 'ph:f-track:';
const CUSTOM_PREFIX = 'ph:c:';
const CUSTOM_META_PREFIX = 'ph:c-meta:';
const CUSTOM_DATATYPE_PREFIX = 'ph:c-type:';
const CUSTOM_RENEWAL_PREFIX = 'ph:c-renewal:';
const CUSTOM_TRACK_PREFIX = 'ph:c-track:';

export function typeMetaKey(): string {
  return TYPE_META_KEY;
}

/** Marks an entry auto-created by the streamlined account-creation flow as
 * not yet looked over — see `Vault.setNeedsReview`. Deliberately outside
 * `EntryInput`/`applyInput`'s scheme: `applyInput` wipes every `ph:`-prefixed
 * key on any ordinary edit and rewrites only what it's given, so this key
 * being in `isVaultFieldName` but never rewritten by `applyInput` is
 * what makes an ordinary Save clear the flag for free — no separate "mark
 * reviewed" action needed anywhere. */
export function reviewMetaKey(): string {
  return REVIEW_META_KEY;
}

export function templateFieldKey(key: string): string {
  return `${TEMPLATE_PREFIX}${key}`;
}

/** Whether a **template** date field is opted into the Upcoming tab — see
 * `upcoming-tab-design.md`. Presence-as-boolean, same as `reviewMetaKey`:
 * set to `'true'` when tracked, absent otherwise, never `'false'`. A
 * sibling prefix to `templateFieldKey`'s own (`ph:f-track:` vs. `ph:f:`),
 * not a suffix on it — this is per-instance metadata *about* the field, the
 * first thing a template field has ever carried beyond its plain value. */
export function templateFieldTrackKey(key: string): string {
  return `${TEMPLATE_TRACK_PREFIX}${key}`;
}

export function customFieldKey(key: string): string {
  return `${CUSTOM_PREFIX}${key}`;
}

export function customFieldMetaKey(key: string): string {
  return `${CUSTOM_META_PREFIX}${key}`;
}

/** A custom field's `dataType` ('date' vs. the implicit default 'text') —
 * split from `customFieldMetaKey` (sensitivity) rather than folded into it,
 * so an old vault's existing `ph:c-meta:` value ("sensitive"/"plain") never
 * needs reparsing: this is a second, independent key, missing entirely on
 * any field saved before this existed (read back as 'text', the same
 * default it always behaved as). */
export function customFieldDataTypeKey(key: string): string {
  return `${CUSTOM_DATATYPE_PREFIX}${key}`;
}

/** A renewal-companion custom field's link back to the date field it
 * renews, plus optional calculator provenance — see
 * `date-renewal-field-redesign.md`. Only ever set on the companion field
 * itself, never on the original. Value is a small JSON blob (`{of, calc?}`)
 * — everything else in this file is a plain enum-ish string because that's
 * all it ever needed to hold; this key's job is different enough (a
 * relationship plus an optional multi-part calculation) to warrant one. */
export function customFieldRenewalKey(key: string): string {
  return `${CUSTOM_RENEWAL_PREFIX}${key}`;
}

/** The **custom**-field twin of `templateFieldTrackKey` — a separate
 * `ph:c-track:` prefix rather than folding into `ph:c-meta:`, mirroring why
 * every other custom-field metadata piece here (`dataType`, the renewal
 * link) already got its own prefix instead of being crammed into one. Also
 * distinct from `templateFieldTrackKey` by more than just `f`/`c`: nothing
 * stops a custom field from being named the same as a template field on the
 * same entry (e.g. a custom field literally called "Expiry" alongside a
 * type's own built-in Expiry), so a single shared `ph:track:<key>` would
 * conflate the two — see `upcoming-tab-design.md`'s "Data model" section. */
export function customFieldTrackKey(key: string): string {
  return `${CUSTOM_TRACK_PREFIX}${key}`;
}

export function isTemplateFieldName(name: string): boolean {
  return name.startsWith(TEMPLATE_PREFIX);
}

/** Never confused with `isTemplateFieldName` despite the shared `ph:f`
 * lead-in — `ph:f-track:` has a `-` where `ph:f:`'s own check requires a
 * `:`, the same separation `isCustomFieldName`'s own doc comment explains
 * for `ph:c:` vs. `ph:c-meta:`. */
export function isTemplateFieldTrackName(name: string): boolean {
  return name.startsWith(TEMPLATE_TRACK_PREFIX);
}

/** True only for the value key, not the sibling `ph:c-meta:` sensitivity key
 * — order matters if you swap the prefix check, since `ph:c-meta:` also
 * starts with `ph:c`. */
export function isCustomFieldName(name: string): boolean {
  return name.startsWith(CUSTOM_PREFIX) && !name.startsWith(CUSTOM_META_PREFIX);
}

export function isCustomFieldMetaName(name: string): boolean {
  return name.startsWith(CUSTOM_META_PREFIX);
}

export function isCustomFieldDataTypeName(name: string): boolean {
  return name.startsWith(CUSTOM_DATATYPE_PREFIX);
}

export function isCustomFieldRenewalName(name: string): boolean {
  return name.startsWith(CUSTOM_RENEWAL_PREFIX);
}

export function isCustomFieldTrackName(name: string): boolean {
  return name.startsWith(CUSTOM_TRACK_PREFIX);
}

export function isVaultFieldName(name: string): boolean {
  return (
    name === TYPE_META_KEY ||
    name === REVIEW_META_KEY ||
    isTemplateFieldName(name) ||
    isTemplateFieldTrackName(name) ||
    isCustomFieldName(name) ||
    isCustomFieldMetaName(name) ||
    isCustomFieldDataTypeName(name) ||
    isCustomFieldRenewalName(name) ||
    isCustomFieldTrackName(name)
  );
}

export function templateKeyFromFieldName(name: string): string {
  return name.slice(TEMPLATE_PREFIX.length);
}

export function customKeyFromFieldName(name: string): string {
  return name.slice(CUSTOM_PREFIX.length);
}

export function customKeyFromMetaName(name: string): string {
  return name.slice(CUSTOM_META_PREFIX.length);
}

export function customKeyFromDataTypeName(name: string): string {
  return name.slice(CUSTOM_DATATYPE_PREFIX.length);
}

export function customKeyFromRenewalName(name: string): string {
  return name.slice(CUSTOM_RENEWAL_PREFIX.length);
}
