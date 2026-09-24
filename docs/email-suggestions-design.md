# Email suggestions — design

`src/vault/emailSuggestions.ts` offers autocomplete on any field that looks
like an email field, suggesting addresses already used elsewhere in the
vault. Four files (`emailSuggestions.ts` itself, `EntryEditor.tsx`,
`EmailSuggestInput.tsx`) cite this doc for the two decisions below.

## Two separate questions, two separate checks

**Which *inputs* get the suggestion dropdown at all** is decided by
`isEmailFieldName` — a plain, case-insensitive substring match for `email`
against the field's own name (its `key`, which doubles as a custom field's
label). "Email", "Recovery email", and "email2" all qualify with no registry
entry needed.

**Which *values* count as a known email**, once a dropdown is showing, is a
completely separate question, decided by `looksLikeEmail` applied to field
*values* regardless of what the field is named: the entire trimmed value has
to look like an address (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), not just contain an
`@` somewhere — deliberately conservative, so a Notes field that happens to
mention an address, or a multiline field with one buried in a longer blob,
never gets offered as a suggestion. This regex only ever gates what's
*offered*; it never gates what's accepted as typed input, so it doesn't need
to be a fully correct RFC 5322 matcher.

Matching on value shape rather than requiring a dedicated `dataType: 'email'`
on the registry was enough for v1: an address typed into a field nobody
thought to name "Email" still gets collected and offered elsewhere, which is
what makes this work across every entry type with zero schema change.

## Collecting known addresses

`collectKnownEmails(entries, excludeEntryId?)` walks every entry's
already-decrypted `fields` array (never sensitive values — a sensitive
field's `.value` is always `''` on a `VaultEntry`, so this can't leak a
secret even if someone did mark an email field sensitive) and keeps every
distinct email-shaped value it finds, on any field of any type. `entries` is
assumed already newest-first, so a more recently touched entry's address
sorts earlier; a duplicate address (same value on more than one entry) keeps
only its first — newest — occurrence, compared case-insensitively but
returned in whatever casing was first seen. `excludeEntryId` skips the
entry currently being edited, since suggesting a value already sitting in
one of its own other fields back at it is never useful.

## Ranking a query

`filterEmailSuggestions(known, query, limit = 6)` narrows the known list to
what the dropdown shows for the current text: case-insensitive substring
match, addresses that *start with* the query ranked before ones that merely
contain it (both groups otherwise keeping `known`'s own recency order), the
query's own exact value dropped, capped at `limit`. An empty query matches
everything, which is what lets the dropdown show the full recent list on
focus, before anything's been typed.

## Android IME consumer

The IME's account-creation panel is the other consumer of
`collectKnownEmails`: `window.__vaultCreate.listKnownEmails` (installed by
`store.tsx`, wrapping `listKnownEmails` in `vault/accountCreationDraft.ts`)
returns the same newest-first, de-duplicated list, and the Email field's
"Pick from Vault" shows it as an inline list under the row — no query
filtering and no `limit` cap, unlike `filterEmailSuggestions`, since the
keypad has no text box to type a query into. Picking one replaces the host
field's text and records it in the draft. See
`docs/ACCOUNT-CREATION-DESIGN.md`, "Revision: inline email list and the full
generator panel".
