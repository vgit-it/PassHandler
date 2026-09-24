import { VaultEntry } from './types';

/**
 * A conservative "is this whole value an email address" check — the
 * *entire* trimmed value has to look like one, not just contain an `@`
 * somewhere. That's deliberate: it's what keeps a Notes field that happens
 * to mention an address, or a multiline field with one buried in a longer
 * blob, from ever being offered as a suggestion. This only ever gates what
 * gets *offered*, never what's accepted as typed input, so it doesn't need
 * to be a fully correct RFC 5322 matcher — good enough to recognise a
 * plausible address is good enough here.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim());
}

/** Whether a field's own name (its `key`, which doubles as a custom field's
 * label) marks it as an email field — used only to decide which *inputs*
 * get the suggestion dropdown, not which *values* count as known emails
 * (that's `looksLikeEmail`, applied to values regardless of field name). A
 * plain substring match, case-insensitive, so "Email", "Recovery email" and
 * "email2" all qualify without a registry entry — see
 * `email-suggestions-design.md` for why matching on the name here, rather
 * than tagging fields with a dedicated `dataType`, was enough for v1. */
export function isEmailFieldName(name: string): boolean {
  return /email/i.test(name);
}

/**
 * Every distinct email-shaped value already stored anywhere in the vault —
 * Login's dedicated Email field, or any custom field a user has named
 * something like "Email" on any other entry type. Deliberately keyed off
 * *value shape*, not field name: an address typed into a field nobody
 * thought to call "Email" still counts, which is what makes this usable
 * from any entry type without a schema change. See
 * `email-suggestions-design.md`.
 *
 * Only ever looks at values already sitting on `VaultEntry.fields` — a
 * sensitive field's `value` there is always `''` (see `VaultEntry`'s own
 * doc comment), so this never calls `readField` or touches a decrypted
 * secret to build the list, and never suggests one either (an email address
 * is not normally marked sensitive, and this makes sure it can't leak
 * through here even if a user did).
 *
 * `excludeEntryId`, when given, skips that one entry's own fields — while
 * editing an entry, suggesting a value already sitting in one of its own
 * other fields back at it is never useful.
 *
 * Order: `entries` is assumed already newest-first (`Vault.listEntries()`'s
 * own order), so a more recently touched entry's address sorts earlier;
 * duplicates (the same address saved on more than one entry) keep only the
 * first — newest — occurrence, compared case-insensitively but returned in
 * whatever casing was first seen.
 */
export function collectKnownEmails(entries: VaultEntry[], excludeEntryId?: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.id === excludeEntryId) continue;
    for (const field of entry.fields) {
      const value = field.value.trim();
      if (value === '' || !looksLikeEmail(value)) continue;
      const dedupeKey = value.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      result.push(value);
    }
  }
  return result;
}

/**
 * Narrows `known` down to what a suggestion dropdown should actually show
 * for the current query: a case-insensitive substring match, addresses that
 * start with the query ranked before ones that merely contain it (both
 * groups otherwise keeping `known`'s own order, so recency — see
 * `collectKnownEmails` — still breaks ties), the query's own exact value
 * dropped (nothing useful about suggesting back what's already typed), and
 * capped at `limit`.
 *
 * An empty query matches everything — this is what lets the dropdown offer
 * the full recent list on focus, before anything's been typed, not just
 * once the user starts narrowing it down.
 */
export function filterEmailSuggestions(known: string[], query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase();
  const matching = q === '' ? known : known.filter((email) => email.toLowerCase().includes(q));
  const ranked =
    q === ''
      ? matching
      : [...matching].sort((a, b) => {
          const aStarts = a.toLowerCase().startsWith(q) ? 0 : 1;
          const bStarts = b.toLowerCase().startsWith(q) ? 0 : 1;
          return aStarts - bStarts;
        });
  return ranked.filter((email) => email.toLowerCase() !== q).slice(0, limit);
}
