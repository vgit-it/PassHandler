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

**Recents — `QuickFillRanking.recents()`.** An empty query now shows up to 3
entries with nonzero frecency for the calling app (under a small "Recent"
label), instead of a blank results region. Empty when nothing's ever been
filled from that app — no alphabetical fallback, since that would read as a
relevance claim this data doesn't support.

**Session persistence — `start()`/`stop()`/`buildRootView()` in
`VaultKeyboardView.kt`.** `start()` no longer clears `query` or
`selectedEntryId`, and no longer forces `screen` back to `SEARCH` — it only
forces `Screen.CREATE` when a draft is in progress, same as before. A stale
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

**Avatars — `buildAvatar`/`avatarColorFor` in `VaultKeyboardView.kt`.**
No favicon fetching on this side (no network access from the IME, and
`FillEntry` carries no icon URL). Every result/recents row gets the same
initial-letter, hash-colored-circle fallback the app itself uses when a
favicon isn't available — same six-color idea as `EntryList.tsx`'s
`avatarColor`, not guaranteed to produce the identical color per entry
(JS/Kotlin integer overflow differs), which is cosmetic, not a correctness
concern.

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
