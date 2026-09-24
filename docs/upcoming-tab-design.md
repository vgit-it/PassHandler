# The Upcoming tab — scope & design

**Status: built end to end. `npm run typecheck`, `npm run lint`,
`npm run test` (156 tests, up from 137 — new coverage in
`tests/upcoming.test.ts` for the bucketing logic itself, plus additions to
`tests/fieldKeys.test.ts` and `tests/vault.test.ts` for the new tracking
storage keys) and `npm run build` all pass clean.** See "As built" at the
end for what actually landed and where it differs from this original design
pass. Pure TS/React + storage-layer feature, same footprint as
`date-renewal-field-redesign.md` and `card-expiry-derived-date.md` — no
Android/Kotlin code is touched (the manual-fill IME's `fillable` filtering
is unrelated to Upcoming-tracking, so nothing there needed to change), so
this is compiler-verified end to end.

## The ask

Surface important dates — a renewal, an expiry — that are coming up soon,
in the "Upcoming" tab. Three things you specified up front:

1. A date only shows up if you've told the app to track it. Nothing is
   automatic — you pick which entries, and which date field within an
   entry, count.
2. Nothing further out than 6 months from today is ever shown.
3. What does show is sorted into groups by how soon it is, not just one
   flat list.

Two follow-up questions, answered before writing the rest of this:

- **Windows too**, not just Android (the tab currently only exists there —
  see below).
- **Selection happens inline**, in the entry editor next to each date
  field — no separate "manage tracked dates" screen for v1.

## What's already in place

- `UpcomingScreen.tsx` exists today as a deliberate placeholder — its own
  doc comment says it's waiting for exactly this. `VaultScreen.tsx`'s `View`
  union already has an `'upcoming'` case wired to render it, and
  `useAndroidBackButton` already knows Upcoming collapses to Home on back
  press. None of that plumbing needs touching.
- Every date field is already stored as ISO `YYYY-MM-DD` — sortable as a
  plain string, no parsing library needed — specifically so a feature like
  this would need no schema change to the *dates themselves*. What's
  missing is only "which fields are opted in," which is new state.
- The renewal feature (this session, `date-renewal-field-redesign.md`)
  already built the pattern this one reuses almost exactly: a small
  per-field control in `EntryEditor`, a new `ph:`-prefixed storage key,
  read in `Vault.toVaultEntry`, written in `Vault.applyInput`.

## The one platform gap: Windows has no entry point yet

The bottom tab bar (`BottomTabBar.tsx`) — Home / Upcoming / You — is
Android-only by design; its own doc comment says so explicitly ("Windows
has no equivalent: no mockup covers it, and it already has its own way into
Settings"). Windows reaches Settings and Lock from small icon buttons in
`EntryList`'s header instead.

Since you want Windows included, it needs its own way in: a small icon
button in that same header, next to Settings, opening the same
`{ name: 'upcoming' }` view Android's tab already routes to. The screen and
all of its logic are shared — only the *door into it* differs per platform,
same as Settings already works today (gear icon on Windows, "You" tab on
Android, one `SettingsScreen` behind both).

## The flow

1. **Opt in, per date field, while editing an entry.** Every date field —
   a template field like Identity Doc's Expiry, a custom date field, a
   renewal companion (see below) — gets a small toggle next to it in
   `EntryEditor`: *Track in Upcoming*. Off by default. Turning it on for a
   field with no value yet just means "start tracking once it has one" —
   an empty date field contributes nothing to Upcoming either way.
2. **The Upcoming tab lists every tracked field, on every entry, whose date
   is either overdue or due within 6 months** — nothing further out ever
   appears, and nothing untracked ever appears, no matter how soon it is.
3. **Grouped, nearest first** — see "Grouping" below for the exact buckets.
4. **Tapping a row opens that entry** (`EntryDetail`), the same as tapping
   a row on Home.
5. **Nothing tracked yet, or nothing due** → an empty state that says so,
   not a bare "Nothing here yet." (worth wording better than the
   placeholder's current text once this is real).

## Which fields can be tracked

Any field with `dataType === 'date'` — template or custom — including a
renewal companion, tracked independently of the field it renews (you can
track "Renewal date" without tracking "Policy start date," or both, or
neither).

### Full audit: every entry type, every field, is it a date

Went through `entryTypes.ts` field by field — all 15 entry types, every
`templateFieldDef`, plus the two universal extras (`NOTES_FIELD`, and
Login's own `url`/`notes`/`email`, which live in `vault.ts` rather than the
registry — see its "Login is a deliberate exception" comment). Nothing
skipped. Table below reflects the registry **after** the four additions
below were built — struck-through cells show what was there before.

| Entry type | Field | Current `dataType` | Date-related? |
|---|---|---|---|
| Login | Username, Password, Email, URL, Notes | text / text (sensitive) / text / text / multiline | No |
| Card | Number, **Expiry**, CVV, Name on card | text (sensitive) / **monthYear** / text (sensitive) / text | **Yes — via a derived companion**, see "Card's Expiry" below. |
| Bank Account | Account #, IFSC Code, Bank name | text (sensitive) / text / text | No |
| Identity Doc | ID Number, **Expiry** | text (sensitive) / **date** | **Yes — already usable as-is** |
| Phone Number | Number | text | No |
| Address | Street, Apt/Unit, City, State/Province, Postal Code, Country | all text | No |
| WiFi | SSID, Password | text / text (sensitive) | No |
| License Key | Key, **Expiry** | text (sensitive) / **date** | **Yes — added** |
| SSH/API Key | Key/Token | multiline (sensitive) | No |
| 2FA Backup Codes | Codes | multiline (sensitive) | No |
| Security Q&A | Question, Answer | text / text (sensitive) | No |
| Loyalty/Membership | Member #, Tier, **Expiry** | text / text / **date** | **Yes — added** |
| Vehicle | Plate #, VIN, **Registration expiry** | text / text / **date** | **Yes — added** |
| Insurance | Policy #, Provider, **Expiry** | text (sensitive) / text / **date** | **Yes — added** |
| Secure Note | Body | multiline | No |
| *(every non-login type)* | Notes | multiline | No |

**As built:** License Key, Loyalty/Membership, Vehicle, and Insurance each
got a new, optional, `dataType: 'date'` template field — `expiry` on the
first three, `registrationExpiry` (labelled "Registration expiry") on
Vehicle specifically, since unlike the other three it has more than one
plausible renewal in real life (registration, inspection, its own separate
Insurance entry) and a bare "Expiry" wouldn't say which. All four are
`optional: true`, same as Identity Doc's own Expiry — a blank one stays
hidden rather than rendering an empty row, and every existing saved entry
of these types is unaffected until edited (adding a field to the registry
never touches what's already on disk). Each is a plain addition to
`typeDef.templateFields` — `vault.ts`'s `toVaultEntry`/`applyInput` and
`EntryEditor.tsx`'s form-building are both already fully generic over
`templateFields`, so nothing else needed changing for these four to work
end to end, including getting the renewal-calculator treatment
(`TemplateFieldInput`'s date branch already renders `DateFieldWithRenewal`
for any `dataType: 'date'` template field, not just Identity Doc's).

**Card's Expiry — addressed, but not by making it `dataType: 'date'`.** The
migration weight flagged here (existing Card entries hold MM/YY-style free
text, and a full `DD/MM/YYYY` field would be a UX-shrinking change from
MM/YY — a card expiry has never needed a day) turned out not to require a
trade-off: Expiry now stores as `dataType: 'monthYear'` (new, `MM/YY` only),
and the app derives a real, always-in-sync `dataType: 'date'` companion
field behind it automatically — the day it's a day-typed field for Upcoming
to find, but the field the user actually sees and types into is still
day-less. Existing free-text values read in leniently rather than needing a
one-time conversion. See `card-expiry-derived-date.md` for the full design
and as-built details.

## Grouping

Buckets, computed from whole days between today and the field's date
(today resolved the same device-local way the renewal calculator's "Today"
anchor already is):

| Bucket | Range |
|---|---|
| Overdue | date already passed |
| This week | 0–7 days out |
| This month | 8–30 days out |
| Next 3 months | 31–90 days out |
| 3–6 months | 91 days out to the 6-month cutoff |

The outer cutoff itself — "6 months from today" — is computed with the
existing `addInterval(todayIso, 0, 6, 0)` calendar-month arithmetic
(already handles month-length overflow correctly; see `dateFormat.ts`),
not a flat day count, so it lands on the actual calendar date 6 months out
regardless of which months it spans. The day-based bucket boundaries above
are just round numbers for grouping *within* that precise outer limit.

**Overdue is pinned first and is *not* subject to the 6-month cap** — an
expiry that already passed should never quietly age out of the list just
because it's more than 6 months stale. Same reasoning `EntryList`'s pinned
"Review" group already uses for `needsReview` entries: the thing that needs
attention shouldn't be sorted away with everything else.

Within a bucket: soonest first. Each tracked field is its own row — an
entry with two tracked dates (say, a policy's start date and its renewal)
produces two independent rows, possibly in two different buckets.

Visually, reuse `EntryList`'s own sticky-header-with-count treatment for
each bucket, for the same reason `groupEntriesForHomeScreen` reuses the
type picker's grouping shape — one visual language for "a list broken into
labeled sections," not two.

## Data model

New storage keys, one for each field origin — mirroring the `ph:f:`/`ph:c:`
split that already exists for values, rather than one shared key, to avoid
a real (if obscure) collision: nothing today stops a custom field from
being named the same as one of its entry's own template fields (e.g. a
custom field literally called "Expiry" alongside Identity Doc's built-in
Expiry) — `Vault`'s uniqueness check only compares custom keys against each
other, not against template keys. A shared `ph:track:<key>` would conflate
the two in that case; two prefixes don't.

- `ph:f-track:<key>` — set to `'true'` when a **template** date field is
  tracked, absent otherwise.
- `ph:c-track:<key>` — same, for a **custom** date field (including a
  renewal companion, which is itself just a custom field — see
  `date-renewal-field-redesign.md`).

Presence-as-boolean (like `ph:review`), not a value to compare — there's
only one state worth encoding. `EntryField`/`EntryFieldInput` gain
`trackedInUpcoming?: boolean`. `Vault.toVaultEntry` reads the new key in
*both* the template-fields loop and the custom-fields loop (today, template
fields carry no per-instance metadata at all beyond their value — this is
the first thing that gives them any); `Vault.applyInput` writes it in both,
same place `dataType`/`renewalOf` are written for custom fields today.

**One simplification worth calling out:** unlike `renewalOf` (a field
pointing at a *different* field by name, which is why renaming or removing
a field needs cascade logic to keep that pointer valid — three separate
edge cases the renewal feature had to catch), "tracked" is a property of
the field itself, carried on the same draft object as its `key`. Renaming a
tracked custom field in the editor carries `tracked` along automatically,
for free, because it's the same object being renamed — no cascade code
needed at all here.

## What this touches, roughly

For a build estimate before committing to one:

- `vault/types.ts` — `trackedInUpcoming?: boolean` on both field types.
- `vault/fieldKeys.ts` — two new key helpers (template + custom), same
  shape as the existing `customFieldDataTypeKey`-style ones.
- `vault/vault.ts` — `toVaultEntry`/`applyInput`, both the template loop
  *and* the custom loop (new ground: the template loop has never read or
  written anything but a field's value before).
- `vault/upcoming.ts` (new) — pure, unit-testable: bucket a `VaultEntry[]`
  into the grouping above. No `Vault`/React dependency, same shape as
  `emailSuggestions.ts`/`search.ts`'s own pure helpers.
- `ui/screens/EntryEditor.tsx` — a toggle next to every date field
  (`TemplateFieldInput`'s date branch, `CustomFieldRow`'s date branch, and
  `DateFieldWithRenewal`'s own renewal block for the companion). No
  cascade logic needed, per above.
- `ui/screens/UpcomingScreen.tsx` — the real screen: grouped list, empty
  state, tap-to-open — same shape as `EntryList`'s own grouped rendering.
- `ui/screens/EntryList.tsx` — one new header icon button on the Windows
  branch only, wired to a new `onUpcoming` callback (mirrors `onSettings`).
- `ui/screens/VaultScreen.tsx` — thread that callback through; the routing
  itself already exists.
- Possibly one new icon (`icons.tsx`) for the per-field toggle — nothing
  existing fits "track this" without reusing `AlertIcon`, which already
  means something else (Review, the Upcoming tab icon itself).

Comparable in size to the renewal redesign, maybe a little larger — that
one stayed entirely inside the custom-field scheme; this one is the first
feature to also touch template fields' storage.

## Explicitly out of scope

- **OS-level push notifications or background reminders.** This is an
  in-app list, seen only when the Upcoming tab is opened. No app-icon
  badge, nothing while the app isn't running. A real follow-up, not this
  pass — flagged the same way the renewal doc flagged it for that feature.
- **Per-field custom lead time** (e.g. "remind me 30 days before *this
  one*"). Every tracked field uses the same fixed bucket scheme; nothing
  per-field to configure beyond on/off.
- **Dismiss, snooze, or "mark renewed" from the Upcoming list itself.**
  Tapping a row only opens the entry. Since this list is fully derived from
  live data rather than a separate stored list, updating the date the
  normal way (editing the entry) is what moves or removes it — there's
  nothing to separately "clear."
- **A dedicated bulk-management screen.** Declined this round, per your
  answer — inline-only for v1. Clean to add later if setting up many
  entries one at a time turns out to be tedious in practice.
- **Changing which template fields are `dataType: 'date'`** beyond what's
  already been built (the four additions above, plus Card's Expiry via a
  derived companion — see `card-expiry-derived-date.md`). Nothing else in
  the registry is flagged as a further gap right now.
- **Search or filtering within the Upcoming tab.** The 6-month cap plus
  opt-in keeps the list naturally short; not asked for.
- **A count badge** on the Windows header button or the Android tab icon
  (e.g. "3"). Easy to add later if wanted; not part of this pass.

## Migration

Nothing to migrate. Every existing date field starts untracked — no
`ph:f-track:`/`ph:c-track:` key present means "not tracked," which is
already what an entry saved before this feature exists looks like. No
entry silently starts appearing in Upcoming the moment this ships.

## As built

Followed the design above closely; the differences are noted inline below.

**`vault/fieldKeys.ts`** gained `templateFieldTrackKey`/`customFieldTrackKey`
(`ph:f-track:<key>`/`ph:c-track:<key>`) and their matching
`isTemplateFieldTrackName`/`isCustomFieldTrackName` checks, both folded into
`isVaultFieldName` — required, not optional, since `Vault.applyInput`'s
wipe-then-rewrite pass only clears keys that check recognises; skipping this
would have left a stale tracked flag on disk forever once a field stopped
being tracked.

**`vault/types.ts`**: `EntryField`/`EntryFieldInput` both gained
`trackedInUpcoming?: boolean`, presence-as-boolean like `needsReview`'s own
key — absent (not `false`) means untracked.

**`vault/vault.ts`**: `toVaultEntry`'s template loop reads
`templateFieldTrackKey(def.key)` for every field it pushes (sensitive or
not) — the first thing a template field has ever carried beyond its plain
value, exactly the "new ground" the original estimate flagged. The custom
loop reads `customFieldTrackKey(key)` right alongside the existing
sensitivity/dataType/renewal reads. `applyInput` writes both symmetrically;
neither ever writes `'false'`, only `'true'` or nothing.

**`vault/upcoming.ts`** (new) — `buildUpcoming(entries, todayIso)` and
`hasAnyTrackedField(entries)`, both pure and both exercised directly in
`tests/upcoming.test.ts` with a fixed `todayIso` rather than the real clock,
so every bucket-boundary case (the exact day a field crosses from "This
week" into "This month," the exact calendar date the 6-month cutoff lands
on, Overdue's exemption from that cutoff) is deterministic. `daysBetween`
computes via `Date.UTC` rather than local-time subtraction specifically so
a daylight-saving transition between "today" and a tracked date never
shifts the day count by one.

**The toggle itself — one difference from the original sketch.** The design
above said "a small toggle next to it" without committing to a shape;
built as a small bordered icon button (`TrackToggle`, in
`DateFieldWithRenewal.tsx`, using a new `BellIcon`) sitting inline in the
same row as the date input and its calendar button, rather than a full
`Toggle` switch on its own row (the style `CustomFieldRow`'s "Sensitive
field" control already uses) — a full-size switch would have been visually
heavier than the icon-button row it would have sat in. `DateFieldWithRenewal`
renders one for the original field and, independently, one for its renewal
companion if it has one; `EntryEditor.tsx`'s `TemplateFieldInput` threads
both through from `EntryForm`, and its `monthYear` branch (Card's Expiry —
see `card-expiry-derived-date.md`) renders a third copy next to the
always-derived Expiry-date companion, since that companion is a real
`dataType: 'date'` field like any other and is just as trackable, even
though the visible Expiry field above it isn't.

A template date field's own tracked state needed a new piece of
`EntryForm` state (`templateTracked`, a `Record<string, boolean>` keyed by
the field's own key) — `values` (a plain `Record<string, string>`) had
nowhere to put a boolean, and template fields never had any per-instance
state beyond `values` before this. A custom field's tracked state, by
contrast, needed nothing new: it's just another property on the same
`CustomFieldDraft` object `renewalOf`/`renewalCalc` already live on.

**`ui/screens/UpcomingScreen.tsx`** replaced the placeholder outright: reads
`entries` from `useApp()`, computes `todayIso` via
`addInterval(null, 0, 0, 0)` (the same "read today as ISO" call the renewal
calculator's own "Today" anchor option already uses), and renders
`buildUpcoming`'s buckets with the same sticky-header-with-count treatment
`EntryList` uses for its own category groups — same visual language for "a
list broken into labelled sections," per the original design's own
reasoning. One addition beyond the original sketch: the screen renders its
own header with an on-screen Back button, unconditionally on both
platforms — the same choice `SettingsScreen` already makes, and for the
same reason: Android reaches this screen with the bottom tab bar staying
visible (so Back is redundant but harmless there, exactly as it already is
on Settings), while Windows has no bottom tab bar at all and would
otherwise have no way out of a pushed screen. The empty state is two
distinct messages, gated on `hasAnyTrackedField` — "Nothing tracked yet"
(with a one-line hint on how to start) versus "Nothing due," rather than
one generic placeholder, per the original design's own note that this was
"worth wording better than the placeholder's current text."

**`ui/screens/EntryList.tsx`** gained the Windows-only header icon button
next to Settings, reusing `AlertIcon` — the same glyph
`BottomTabBar.tsx`'s Android Upcoming tab already uses, so the same icon
means the same thing in both places despite `AlertIcon` separately meaning
"needs review" as `EntryList`'s own pinned-group marker; the two contexts
never appear together, so there's no real ambiguity. `VaultScreen.tsx`
threads the new `onUpcoming` callback down through `ListView`, and passes
`onOpen`/`onBack` to `UpcomingScreen` the same way it already does for
Detail/Settings.

## Later update: Android card layout (Figma node 118:528)

A real Figma reference for this screen ("Upcoming," node 118:528) showed up
after the above was built, once the Home screen's own Figma-parity pass
(separate work) had already moved `EntryList.tsx`'s Android rows off the
`--vault-*` shelf/rail system this screen originally copied. Brought
Android here into line with that same reference:

- **Rows**: `EntryList.tsx`'s Android floating-card recipe
  (`rounded-[20px]`, `rgba(77,87,97,.4)`, `EntrySiteIcon`) replaces the
  shelf. `EntryPeg.tsx` — the fixed-34×34 icon component this screen used
  to import — was deleted; `EntrySiteIcon` (now exported from
  `EntryList.tsx`) covers both platforms' sizing on its own, so keeping a
  second, drifting copy of the same hash-palette logic around no longer
  had a reason to.
- **Section header**: switched to `EntryList.tsx`'s own current header
  (plain text on the wall, not sticky, no rail groove) instead of the
  sticky-rail-with-count band described above — `EntryList.tsx` itself had
  already moved on to that same header, on both its own platforms, by the
  time this update happened. Applied here the same way, on both platforms,
  for the same reason: one recipe for "a list broken into labelled
  sections," not two.
- **Row content — Android only, a real content change**: the reference's
  card carries one subtitle line, "FIELD LABEL: DATE," no relative wording,
  and no right-hand column — the bucket itself is the design's only "how
  soon" signal. Android's `Row` now matches that. **Windows keeps
  everything from the original design above completely unchanged** —
  shelf visuals, and the exact-date-plus-`relativeLabel` two-column
  layout — since this reference, like the Home screen's, has no Windows
  counterpart.
- Bucket-to-bucket gap on Android is `mt-10` (40px, this node's own
  precise value) rather than `EntryList.tsx`'s approximated `mt-8`
  (32px, chosen there because its own source reference didn't reduce to a
  clean flow-layout number) — two different Figma nodes, each followed at
  its own precision. Windows' gap is untouched.
