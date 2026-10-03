# Quick-fill search improvements — design

The feature: `quick-fill-search-improvements.md` (the Project doc) proposed a
batch of changes to the manual-fill IME's search. This implements the subset
scoped in conversation — ranking, recents, session persistence, fuzzy
matching, search-label parity, per-row avatars, and a "fix a mistake" clear
key — keeping the existing tap-to-detail-screen model rather than the doc's
literal inline-chip-row expansion. Explicitly deferred: EditorInfo-based
search pre-ranking, and chunked-field fill/format variants (both need a
Kotlin-side type registry that doesn't exist yet). Explicitly out of scope:
a real pin/favorite feature (would need a new vault schema field and app UI).

**Status:** written but **not compiler-verified** — this sandbox has no
Android/Kotlin build toolchain, so it was checked by brace/paren
balance-counting only, the same caveat every other Kotlin change in this
project has carried. A real build is the first thing to run against it.

## What changed, and where

**Ranking — `QuickFillUsage.kt` (new) + `QuickFillRanking.kt` (new).**
`QuickFillUsage` is a plain (unencrypted — no secrets involved)
`SharedPreferences` store keyed `"$packageName/$entryId"`, holding a use
count and a last-used timestamp per key. `score()` returns
`count * 0.5^(age / 14 days)` — recency-and-frequency ("frecency"), scoped
per calling app so filling "Amazon" from the Amazon app doesn't rank it
first inside some unrelated app. `QuickFillRanking.rank()` buckets matches
by quality (title-prefix > exact > fuzzy), sorts each bucket by frecency
descending then title alphabetically, and returns the flattened list.
`performFill` in `VaultKeyboardView.kt` calls `QuickFillUsage
.recordUse` once a fill actually lands.

Pinning was scoped out: frecency alone, no user-facing pin/favorite toggle.

**Empty query: recents, then suggestions — `renderSearchResults` in
`VaultKeyboardView.kt`.** An empty query shows, in order:

- **Recent** (`QuickFillRanking.recents()`): up to 3 entries with nonzero
  frecency for the calling app. In a browser every site shares the
  browser's one package name, so the label reads "Recent in Chrome" rather
  than implying the entries match the open site.
- **Suggested for Netflix** (`QuickFillRanking.suggestions()`): up to 5
  entries matching the calling app, not already listed — so the very first
  use in an app isn't blank. It matches the app's display name ("Netflix",
  "Chase Mobile") and the meaningful segments of its package name
  (`com.netflix.mediaclient` → "netflix"; generic segments like `com`,
  `android`, `mobile` are dropped) against each entry's title and, for a
  Login, its URL host minus `www.` and the TLD. Everything is lower-cased
  with only letters and digits kept, and a match is either string containing
  the other, both at least 3 characters. Ordered by frecency, then title.
  **Native apps only:** a browser's name says nothing about the site.
- Neither: a one-line hint, "Type to search your vault".

The app's name comes from `VaultIme.resolveAppLabel` (unfiltered — "Chrome"
in a browser), passed with an `isBrowser` flag through `setDetectedContext`;
the account-creation title guess stays browser-filtered
(`resolveTitleGuess`). There is still no alphabetical fallback: an
unranked list would read as a relevance claim this data doesn't support.

**No matches.** A typed query with no results shows "No matches for 'xyz'"
and a **Save new login for 'xyz'** button, which starts a new entry titled
after the query (first letter capitalised) — creating the entry where the
user just found it missing.

**Session persistence — `start()`/`stop()`/`buildRootView()` in
`VaultKeyboardView.kt`.** Persistence is **per calling app**: reopening the
keyboard in the same app keeps `query`, `selectedEntryId`, `screen` and the
scroll position. A show from a *different* app (`callingPackage` differs
from `lastSessionPackage`) resets all of them to an empty search
(`resetSearchSession`), because resuming there would offer one app's entry,
Fill buttons live, inside another (`docs/IME-UX-REVIEW.md` P3). Either way,
`start()` forces `Screen.CREATE` when a draft is in progress (drafts survive
app switches by design, see `ACCOUNT-CREATION-DESIGN.md`'s "Session
lifetime") and leaves `Screen.CREATE` for search when the draft has ended
while the keyboard was closed. A stale
`selectedEntryId` (the entry got deleted or the vault relocked while the
keyboard was closed) is caught by `renderResultsArea`'s existing staleness
guard, unchanged. `revealedFields` still clears unconditionally on every
`start()` — a shown sensitive value is a shoulder-surf risk regardless of
whether the picker was ever actually closed, and `REVEAL_SECONDS` already
governs exposure within one show. Scroll position: `stop()` captures
`resultsScroll.scrollY` into `savedScrollY`; `buildRootView()` restores it
once, via `resultsScroll.post {}`, right after its own `renderResultsArea()`
call — not inside `renderResultsArea()` itself, since that runs on every
keystroke and must never fight active scrolling.

This reuses the exact mechanism the account-creation draft already relies
on: `VaultIme.kt`'s `keyboardView` is `by lazy`, so the same
`VaultKeyboardView` instance persists across `onStartInputView`/
`onFinishInputView` cycles for as long as the IME process stays alive.

**Fuzzy matching + label parity — `QuickFillRanking`'s `bucketFor`.**
Replaces the old `matchesQuery` (removed). Matches title, every field
*label* (new — the old function only matched values, since there was no
type-label registry on this side to look up a category label from; a
field's own `label` needed no registry and was just never wired up), and
every non-sensitive/non-multiline field *value* — this now mirrors
`src/vault/search.ts`'s rule exactly. Each whitespace-separated query term
must hit something — an exact substring or, failing that, a word within
Levenshtein distance 1 (terms ≤4 chars) or 2 (longer) — or the entry doesn't
match at all; this is AND-across-terms, same as the app-side rule.

**Rows — `buildResultRow`/`buildAvatar` in `VaultKeyboardView.kt`.** Every
result row shows the same icon the app's entry list does (a Login's
favicon, fetched by the app and handed over the bridge — the IME itself has
no network access — or the neutral plate with the entry type's glyph),
the title, and a one-line subtitle (a Login's username) so two accounts on
one site can be told apart. See `docs/MANUAL-FILL-DESIGN.md`'s "Picker UI"
and "Result-row icons".

**Fix a mistake — `onClearField` (new callback) + the bottom action rows.**
A new "✕" key sits next to Lock on every bottom action row (search/detail/
create) — `InputConnection.deleteSurroundingText` in both directions around
the cursor, clearing the focused host-app field regardless of which of the
picker's own screens is showing, since that field stays the same across all
of them. Row weights changed from 0.2/0.6/0.2 to 0.18/0.16/0.48/0.18 to fit
the fourth key. (Superseded by `docs/ime-ux-redesign-proposal.md`'s later
top-bar redesign: both Lock and clear-field moved off the bottom action row
onto the top bar, `onClearField` now wired to a text "Clear" label rather
than a "✕" key — the row-weight split above no longer applies.)

**Plumbing.** `setDetectedContext` gained a third `packageName: String`
parameter (`EditorInfo.packageName`, unfiltered — unlike the title-guess
signal, frecency scoping doesn't care whether the caller is a browser).
`VaultImePreviewActivity.kt` passes a fixed sample package name so the
preview's frecency tier and recents list have something to show once Fill
is tapped a few times.
