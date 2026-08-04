import { VaultEntry } from './types';

/**
 * Filter entries for the search box.
 *
 * Case-insensitive substring over title, username and URL — the PRD says that
 * is sufficient, and it is: this is a list of a few hundred entries that the
 * user already knows, not a corpus to be ranked. Fuzzy matching would make it
 * harder to type three characters and hit Enter with confidence.
 *
 * Notes are deliberately not searched. People keep recovery codes and security
 * answers there, and matching on them would surface entries for reasons the
 * user cannot see in the list row.
 */
export function filterEntries(entries: VaultEntry[], query: string): VaultEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return entries;

  // Every term must match somewhere, so "git hub work" narrows rather than
  // widens.
  const terms = needle.split(/\s+/);

  return entries.filter((entry) => {
    const haystack = `${entry.title}\n${entry.username}\n${entry.url}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
