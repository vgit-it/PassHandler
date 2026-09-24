import { CATEGORY_LABELS, PICKER_KEPT_CATEGORY, PICKER_LEAD_TYPE_IDS, getEntryType } from './entryTypes';
import { VaultEntry } from './types';

/**
 * Filter entries for the search box.
 *
 * Case-insensitive substring over title, the entry's type label, and every
 * non-sensitive field's label *and* value — e.g. a Login's Username value
 * ("octocat"), a Loyalty entry's Tier value ("Gold"), or the field label
 * itself ("Provider"). This is a list of a few hundred entries the user
 * already knows, not a corpus to be ranked; fuzzy matching would make it
 * harder to type three characters and hit Enter with confidence.
 *
 * Sensitive field values — a password, a card number, a security answer —
 * are never searched, per `entry-type-expansion-spec.md`. Matching on one
 * would surface an entry for a reason invisible in the list row, which for a
 * password manager is a bigger problem than a search box that misses a
 * result: it means content the user thinks is protected is discoverable by
 * typing guesses into search. A sensitive field's *label* ("CVV") is
 * searched like any other label — it's a fixed, small vocabulary from the
 * type registry, not user data.
 *
 * Multiline field values (Notes, a Secure Note's Body, …) are excluded too,
 * sensitive or not — carried over from the original rule here, which existed
 * specifically because "people keep recovery codes and security answers" in
 * free-text fields like Notes, and matching on them would be the same
 * invisible-surfacing problem as matching a password.
 */
export function filterEntries(entries: VaultEntry[], query: string): VaultEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return entries;

  // Every term must match somewhere, so "git hub work" narrows rather than
  // widens.
  const terms = needle.split(/\s+/);

  return entries.filter((entry) => {
    const haystack = searchableText(entry);
    return terms.every((term) => haystack.includes(term));
  });
}

function searchableText(entry: VaultEntry): string {
  const typeLabel = getEntryType(entry.type).label;
  const fieldText = entry.fields
    .map((f) => (f.sensitive || f.dataType === 'multiline' ? f.label : `${f.label}\n${f.value}`))
    .join('\n');
  return `${entry.title}\n${typeLabel}\n${fieldText}`.toLowerCase();
}

export interface EntryCategoryGroup {
  /** `EntryCategoryId` for a real registry category, plus the synthetic
   * `'lead'`/`'others'` buckets `groupEntriesForHomeScreen` introduces —
   * widened to `string` rather than narrowed to a union of both, since
   * nothing here switches on it beyond the `'review'` check `EntryList.tsx`
   * already does its own way. */
  category: string;
  label: string;
  entries: VaultEntry[];
}

/** Types shown up front in the type picker with no header at all — see
 * `PICKER_LEAD_TYPE_IDS`'s own doc. Precomputed once as a `Set` rather than
 * re-deriving it per call, the same reasoning `entryTypesForPicker` doesn't
 * need (it only ever runs once per picker visit; this runs on every
 * `EntryList` render while browsing). */
const HOME_LEAD_TYPE_IDS = new Set<string>(PICKER_LEAD_TYPE_IDS);

/**
 * Buckets entries the same way `entryTypesForPicker` buckets *types* for the
 * add-entry screen — Login/Card/Bank Account/Identity Doc first with no
 * header, then "Access & Security", then everything else as "Others" — plus
 * one difference the picker doesn't have: Notes (Secure Note, and anything
 * else the registry ever puts in the `notes` category) carved out into its
 * own group instead of folded into "Others", per request. Empty groups are
 * dropped, same as `entryTypesForPicker`'s own groups can be.
 *
 * Used by `EntryList` for its sticky category headers while the user isn't
 * searching — so the categories browsing the vault shows match the ones
 * seen picking a type to add, rather than the finer 6-way split
 * `entryTypesByCategory` still gives its own callers. Order: lead, Access &
 * Security, Others, Notes — Notes deliberately last, matching where it sits
 * in `CATEGORY_ORDER` today.
 */
export function groupEntriesForHomeScreen(entries: VaultEntry[]): EntryCategoryGroup[] {
  const lead: VaultEntry[] = [];
  const accessSecurity: VaultEntry[] = [];
  const notes: VaultEntry[] = [];
  const others: VaultEntry[] = [];

  for (const entry of entries) {
    const typeDef = getEntryType(entry.type);
    if (HOME_LEAD_TYPE_IDS.has(typeDef.id)) lead.push(entry);
    else if (typeDef.category === PICKER_KEPT_CATEGORY) accessSecurity.push(entry);
    else if (typeDef.category === 'notes') notes.push(entry);
    else others.push(entry);
  }

  const groups: EntryCategoryGroup[] = [];
  if (lead.length > 0) groups.push({ category: 'lead', label: '', entries: lead });
  if (accessSecurity.length > 0) {
    groups.push({
      category: PICKER_KEPT_CATEGORY,
      label: CATEGORY_LABELS[PICKER_KEPT_CATEGORY],
      entries: accessSecurity,
    });
  }
  if (others.length > 0) groups.push({ category: 'others', label: 'Others', entries: others });
  if (notes.length > 0) groups.push({ category: 'notes', label: CATEGORY_LABELS.notes, entries: notes });

  return groups;
}
