# Entry types — design

Vault started as a login-only manager. This is the design for what it grew
into: fifteen typed entry kinds — Card, Bank Account, WiFi, SSH/API Key,
Vehicle, and more — each with fields that fit what it's actually storing,
instead of one generic Title/Username/Password/URL/Notes form stretched over
everything. `src/vault/entryTypes.ts` is the registry this doc describes; six
other files cite this doc by name (`entryTypes.ts`, `vault.ts`, `types.ts`,
`search.ts`, `EntryEditor.tsx`, `TypePicker.tsx`, `FieldRow.tsx`) because they
each implement one piece of it and point back here for the reasoning.

## The registry is the only source of truth

`entryTypes.ts` is deliberately dependency-free — no React import, no
`vault/vault.ts` import, nothing platform-specific. It's plain data
(`ENTRY_TYPES: EntryTypeDef[]`) plus pure lookup functions, so it can be
imported and asserted against in a test with no setup, and so a storage-layer
bug can never also be a bug in this file.

Every consumer reads from it instead of hardcoding a field list per screen:
the type picker (`entryTypesForPicker`, `searchEntryTypes`), the editor's
form (`EntryTypeDef.templateFields`), the detail view's field list
(`FieldRow`, driven by the same `templateFields`), and — via the Android
bridge — the quick-fill chip row. A type only decides *which* fields exist;
it never decides *how* one renders. `FieldRow` renders every field on every
entry type identically for that reason.

## Fifteen types, six categories

```
logins                Login
financial              Card, Bank Account
identity                Identity Doc, Phone Number, Address
access-security          WiFi, License Key, SSH/API Key, 2FA Backup Codes, Security Q&A
recurring-membership       Loyalty / Membership, Vehicle, Insurance
notes                        Secure Note
```

`CATEGORY_ORDER` fixes the display order everywhere a full category
breakdown is shown (`entryTypesByCategory` — the picker's default,
no-search-text view, and the home screen's section headers via
`vault/search.ts`'s `groupEntriesForHomeScreen`, which buckets actual entries
the same way this buckets types so the two never drift apart).

The type picker itself uses a second, simplified grouping
(`entryTypesForPicker`, backed by `PICKER_LEAD_TYPE_IDS` and
`PICKER_KEPT_CATEGORY`) rather than the full category breakdown: Login, Card,
Bank Account and Identity Doc lead with no header — common enough that a
category label just adds a scan step — Access & Security keeps its own
header unchanged, and everything else (Loyalty, Vehicle, Insurance, Secure
Note) falls into one "OTHERS" group in registry order. This is a UI
simplification of the picker specifically; `entryTypesByCategory` still
describes every type's real category everywhere else.

Adding a type means adding one `EntryTypeDef` entry to `ENTRY_TYPES` with an
id, category, label, icon key, search aliases, and `templateFields` — nothing
else needs to change for it to show up in the picker, the editor, the detail
view, and search.

## Picking a type is mandatory, and permanent

Step 1 of add-entry is always "pick a type" (`TypePicker.tsx`) — there is no
"skip, decide later". Step 2 is a form built from that type's
`templateFields` (`EntryEditor.tsx`). Editing an existing entry skips
straight to the form with its type locked; converting a saved entry's type is
out of scope.

## Storage: the `ph:f:`/`ph:c:` scheme, and Login's exception

Every field lives under a `ph:`-prefixed custom-string key in the underlying
`.kdbx` file (`src/vault/fieldKeys.ts` owns the exact prefixes: `ph:f:` for a
type's template fields, `ph:c:` for user-added custom fields, plus sibling
prefixes for per-field metadata — sensitivity, data type, a renewal link, and
Upcoming-tracking — each split into its own prefix rather than packed into
one, so an older vault's existing values never need reparsing when a new kind
of metadata is added).

`login` is the one deliberate exception: it stays on KeePass's own standard
Title/UserName/Password/URL/Notes fields (`vault.ts`'s `FIELD` constant)
rather than the generic scheme every other type uses. A literal reading of
this spec would move Login's Username/Password onto `ph:f:` too, but Login is
the overwhelming majority of real entries — today's and every existing
vault's — and keeping it on the fields KeePassXC already gives first-class UI
to means no migration risk for a single existing entry, KeePassXC keeps
showing Login entries the way it always has, and the URL-driven favicon
lookup and Notes field keep working with zero new code. Every other type uses
this scheme exactly as specified.

## Custom fields use the identical structure

A user-added custom field ("+ Add field" in the editor) is not a different
shape from a template field — `EntryField` (`src/vault/types.ts`) is the same
interface either way, distinguished only by a `custom: boolean` flag that
exists purely so a consumer doesn't have to re-derive it against the
registry. Nothing about how a field is rendered, copied, revealed, or filled
depends on whether it came from `templateFields` or was typed in by hand.

A custom field's own type choice is deliberately narrow — just a `'text'` /
`'date'` toggle, not the full `FieldDataType` range template fields draw
from — and a sensitive custom field always stays `'text'` (masked, never
date-picked). Custom field keys are free-text and can be renamed mid-edit;
`EntryEditor.tsx` rejects a save if two custom fields on the same entry end
up with the same name, since the key is also the display label and there's
no registry entry to disambiguate them.

Every type also gets one universal, always-available Notes field
(`NOTES_FIELD` in `entryTypes.ts`) on top of its own `templateFields`, rather
than that field being copy-pasted into all fifteen `templateFields` arrays.
`login` has its own pre-existing equivalent (`LOGIN_EXTRA_FIELDS` in
`vault.ts`) predating entry types entirely.

## Search: labels are fair game, sensitive values never are

`vault/search.ts`'s `filterEntries` matches case-insensitively over an
entry's title, its type label, and every **non-sensitive** field's label and
value. A sensitive field's value (a password, a card number, a security
answer) is never matched — surfacing an entry because a search guess happened
to match a hidden value would mean content the user thinks is protected is
discoverable by typing guesses into search, which for a password manager is a
worse failure than a search box that occasionally misses a result. A
sensitive field's *label* ("CVV") is searched like any other label, since
it's a fixed, small vocabulary from the type registry, not user data.
Multiline values (Notes, a Secure Note's Body) are excluded too regardless of
sensitivity, since free-text fields are where people tend to paste recovery
codes and security answers.

Matching itself is substring-only, ranked so a label match beats an alias
match and a prefix match beats a mid-string match
(`entryTypes.ts`'s `searchEntryTypes`, used by the type picker's own search
box). True fuzzy matching is out of scope for v1 — this is a picker of a
dozen-odd types and a list of a few hundred entries the user already knows,
not a corpus that needs ranking, and fuzzy matching would make it harder to
type three characters and hit Enter with confidence.

## What's deliberately out of scope for v1

- **Recently-used types floated to the top of the picker.** There is no
  usage-tracking of any kind in this codebase — building it just for this
  one screen was cut rather than bolted on.
- **Converting an existing entry's type after creation.**
- **Fuzzy matching**, in either the type picker or entry search — see above.
- **User-defined entry types.** The fifteen types are fixed; a "custom
  field" on any of them is the escape hatch for anything a type doesn't
  already cover.
