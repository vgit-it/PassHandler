# IME UX redesign — grouping by mental model, not by row-fit

**Status: built.** See "Status: built" near the end for exactly what changed.
This document still keeps "what's wrong and why" separate from "what to
build," per the request that prompted it — the mental-model reasoning below
is what the implementation follows, not an afterthought bolted onto a diff.

## The complaint, confirmed against the actual code

Two specific placements were flagged as illogical. Both check out exactly as
described, in `buildBottomActionRow` and `buildSearchBoxRow`:

- **Lock sits immediately left of Clear-field**, on every bottom action row
  the keypad shows (`spaceRow`/`detailActionsRow`/`createActionsRow`, all
  built by the same `buildBottomActionRow`): `row.addView(iconKey(ic_lock,
  ... onLock))` immediately followed by `row.addView(specialKey("✕", ...
  onClearField))`. Same row, adjacent, same icon-button visual treatment.
- **"+" (new entry) sits directly beside the search pill**, inside
  `buildSearchBoxRow`: the search field and `buildNewEntryButton()` are the
  row's only two children, side by side.

Neither placement was arbitrary — both were deliberate engineering decisions
recorded in `docs/ime-layout-v2-and-grab-design.md` ("+ reachability: dropped
from Screen.DETAIL... moved onto its own persistent button beside the search
box"). But "where it fits in the row" and "where it makes sense to the
person tapping it" are different questions, and this design only ever
answered the first one.

## Why it misfires: three different kinds of action, one visual language

Everything on this keypad falls into one of three categories, and they have
almost nothing in common except that they're all buttons:

1. **Vault/session state.** Lock. Global, rare, protective (locking never
   destroys anything — worst case it's a mild interruption), same regardless
   of which screen is showing.
2. **Target-field actions.** Clear-field (and, less visibly, Grab and the
   auto-Tab after a fill). These reach *outside* Vault entirely, into
   whatever field is focused in the host app. Clear-field specifically is
   rare and destructive — it erases content in an app Vault doesn't
   control and can't undo.
3. **Vault content / the search-and-fill loop.** Search, pick an entry, pick
   a field, fill it. This is the overwhelming majority of real usage — the
   reason the keyboard exists at all.
4. A fourth, smaller category: **starting something new.** "+"/new entry
   isn't a search result and isn't a fill target — it's a branch into an
   entirely separate screen (`Screen.CREATE`), with its own draft state,
   its own action row, no relationship to whatever's in the search box.

Lock (category 1) and Clear-field (category 2) ended up adjacent because
both happened to be the icon-based keys `buildBottomActionRow` puts on the
left, not because a person forming an intent — "I want to lock the vault" or
"I want to wipe this field" — would ever group them. Worse, they're
opposite in what a mis-tap costs: locking mid-fill is a shrug and a
re-unlock; clearing the wrong field could erase something the user typed by
hand and can't get back. Sitting side by side, indistinguishable in size and
color, invites exactly the mis-tap the complaint describes.

There's a second, sharper version of the same mismatch, worth calling out on
its own: everything else in `buildBottomActionRow`/`refreshKeysArea` — the
letter/number rows, space, "New search", Cancel, Done — writes into `query`
(the local search string) or flips local screen state
(`returnToSearch`/`cancelDraftFlow`/`finishDraft`). None of it ever touches
`currentInputConnection`. Visually it's all styled as one uniform row of
"keys," which tells the person forming a mental model "these type into
whatever I'm interacting with here." Clear-field is the one key in that
entire area whose effect happens somewhere else — it calls
`currentInputConnection.deleteSurroundingText` on the *host app's* field,
never anything on screen in the picker. Moving it to a different row of the
same keypad (further from Lock) would still leave it lying about what kind
of control it is. The fix has to take it out of "the keys" entirely, not
just relocate it within them.

"+" (category 4) sits inside the search row because that's literally the
only row visible in `Screen.SEARCH` with spare width — not because starting
a new entry is a kind of searching. The moment it's tapped, the entire
search UI it's sitting inside disappears and a different screen replaces
it. Placing a mode switch inside the very control it's about to hide reads
as "a modifier on search" (a filter, a search option) when it's actually
"stop searching, do something else."

## The user's mental model, situation by situation

- **Filling a saved credential into some other app (the 95% case).** Tap
  into a field elsewhere, switch to Vault, type a few letters, tap
  the right result, tap Fill on the field that's needed. The person's
  attention the whole time is on the search box and the result/detail list
  above it. Nothing about Lock or "+" is relevant here at all — they should
  be quiet enough not to compete for attention with search/results/fill.
- **Realizing a fill was wrong (typo, wrong field, wrong entry).** This
  happens *after* a Fill, when the person is looking at the Detail screen
  they just filled from. The natural place to reach for "undo that" is
  right there, not buried under a security control that has nothing to do
  with what just happened.
- **Stepping away / done with the phone for a moment.** A deliberate,
  occasional decision, made independent of whatever screen happens to be
  showing — the person isn't thinking "which screen am I on," they're
  thinking "lock this now." That's exactly the job of persistent chrome
  (visible no matter what screen shows), not a key that only exists because
  the keypad node tree needed a third row.
- **Starting a new entry from a signup page.** A conscious "I'm not looking
  anything up" decision, usually made *before* touching the search box at
  all. It should read as its own starting point, the way "add" always does
  next to a list of existing items in other Android apps, not as an
  accessory hanging off the text field.

## Proposed layout

**Lock moves to the top bar, and becomes the tap target instead of just a
status label.** `buildTopBar()` already renders "Vault" / "Unlocked"
and is the one piece of chrome present on every screen
(`updateBottomRowsForScreen` never touches it) — the correct, already-built
home for something global and screen-independent. The static "Unlocked"
`TextView` becomes a tappable pill (icon + "Unlocked", same success-green)
that calls `lockVault()` directly. This is a familiar pattern (a status
indicator that's also the control — a mute icon, a connectivity icon) and
puts Lock somewhere it's never sitting next to Clear-field, Fill, or
anything else content-related. Keep the tap target's touchable area at least
44dp even if the visible pill is smaller, same accessibility floor the
current icon keys already meet via their row-height sizing.

**Clear-field moves out of the keypad entirely and joins Lock in the top
bar — not next to it, and not styled like it.** The keypad's own rows
(letters, numbers, space, "New search", Cancel, Done) all write into
`query` or flip local screen state; none of them ever touch
`currentInputConnection`. Clear-field is the only key in that whole area
that reaches into the *host app's* field instead — visually presenting it
as just another key tells the person "this types," which is exactly wrong.
Pulling it out of the keys area fixes that lie, not just the adjacency to
Lock.

Concretely: the top bar (`buildTopBar`) gains a small, icon-only,
muted/outlined button — no colored fill, no text label — sitting between
the "Vault" label and the Lock pill on the right, rather than flush
against it. The asymmetry is deliberate: Lock stays the prominent, colored,
labeled control (it's the vault's own status, glanced at constantly);
Clear-field stays visually minor (it's a rare, destructive utility, and
should look like one) but is still always present, since — same as Lock —
the host field it acts on doesn't depend on which screen the picker happens
to be showing. `spaceRow`/`detailActionsRow`/`createActionsRow` drop the
Lock/Clear pair entirely and keep only the keys that actually belong to
"the keypad": space, "New search", Cancel, Done.

Stop using a bare "✕" for it, wherever it lands. That glyph reads as
close/cancel/dismiss in essentially every other UI a person has used, which
risks a second confusion on top of the placement one — an eraser-style icon
communicates "erase," not "cancel/dismiss," without relying on the wrong
existing convention for "✕".

**"+" moves off the search row and into its own strip above the results
list (`buildResultsHeaderRow`), visible only in `Screen.SEARCH` — same
visibility rule as today, different position.** Puts it at "the top of the
list of things," not "beside the box you type into" — the same "list + add
button" shape practically every Android list screen already uses (Contacts,
Keep, Gmail), so it carries a mental model the person already has from the
rest of their phone. It also keeps every constraint the last redesign pass
deliberately set: still one call site, still hidden the instant an entry or
the create panel takes over (`onPlusKeyTapped`'s existing screen checks
don't need to change), still absent from `Screen.DETAIL`.

Built as a plain static row that takes its own layout space, not a button
floating on top of `resultsScroll`'s own scrolling content — a typed
query's top result can start right at the results region's own y=0, and a
button overlaid there would risk covering part of whichever entry ranks
first. A dedicated row costs a little fixed vertical space instead, but
never overlaps anything inside the scroll. Also deliberately not folded
into the top bar alongside Lock/Clear-field: that bar is compact and stays
the same height regardless of `screen`, and the "+" button's own
established 44dp touch target would force it taller just to fit a control
that's only ever relevant on one screen anyway. `CARD` background, matching
the results panel below it, so the strip reads as the top edge of one
continuous list rather than a fourth separate bar of chrome.

## What isn't changing

Grab (draft rows only), reveal/hide, the per-field Fill chips, the chunked
card-number and expiry-format controls, the letter/number keyboard rows —
none of these were part of the complaint, and each already only appears on
the one screen where it's relevant. Re-litigating them here would be solving
a problem that wasn't raised.

## Net effect on each row

- Top bar: `Vault` · small muted Clear-field icon · tappable
  `🔒 Unlocked` pill (was: label + static "Unlocked" text only — Clear-field
  is new here, moved off the keypad).
- Search row: search pill only (was: search pill + "+").
- New: a thin `CARD`-colored strip between the top bar and the results
  list, holding just "+", visible only in `Screen.SEARCH`.
- `spaceRow` (Screen.SEARCH default): space, full width (was: Lock / ✕ /
  space).
- `detailActionsRow`: "New search", full width (was: Lock / ✕ / "New
  search").
- `createActionsRow`: Cancel / Done (was: Lock / ✕ / Cancel / Done).

Every action row in the keypad now does exactly one kind of thing — type
into search, or navigate the picker's own screens. Lock and Clear-field
both moved to the top bar, where "always relevant regardless of screen" is
already how that chrome behaves — without deleting a single capability,
and without recreating an adjacent-icon-pair the way a shared bottom row
would have.

## Status: built

Applied directly to `VaultKeyboardView.kt` — `buildTopBar` now builds
`buildTopBarClearFieldButton`/`buildLockStatusPill` instead of a static
status `TextView`; `buildBottomActionRow` dropped the `onLock` parameter and
its two fixed icon keys entirely; `buildResultsHeaderRow` is new and sits
between `buildTopBar()` and `resultsScroll` in `buildRootView`;
`buildSearchBoxRow`/`buildNewEntryButton` lost the "+" button and gained it
back respectively, per the sections above. `updateBottomRowsForScreen` gained
one more `newEntryRow` visibility toggle, same pattern as `searchBoxRow`'s
existing one. A new drawable, `res/drawable/ic_clear_field.xml` (a circled
X, same stroke recipe as `ic_lock.xml` but in `MUTED_FOREGROUND`), replaces
the old bare "✕". The old `iconKey()` helper had exactly one call site (the
removed Lock key) and was deleted along with it — nothing else used it.

No `onLock`/`iconKey`/`ic_lock`-in-the-keypad references remain — checked
directly, not assumed. `VaultIme.kt`/`VaultImePreviewActivity.kt`
needed no changes: both only ever passed constructor parameters
(`onClearField`, etc.) that didn't change shape, never called into the
functions rewritten here.

## Verification

Same footprint as every other Kotlin-only change in this project's docs: no
compiler or Android SDK in this sandbox. Every new API used
(`ImageView.setColorFilter`, `View.contentDescription`) is ordinary and
long-standing (API 1/4 respectively), well under this app's
`minSdkVersion = 26`. A machine brace/paren/bracket balance check ran clean
across the changed file. The one part of this whole change worth double-
checking on a real device: whether the top bar's fixed 40dp height and the
Lock/logo/Clear-field clearances inside it actually render at the sizes
requested (`FrameLayout` gravity/margin math is straightforward, but this
sandbox can't render it).

## Revision: a direct layout spec superseded the top-bar/"Add Entry" part

The sections above (through "Net effect on each row") describe the
*reasoning* that got Lock and Clear-field off the keypad and into the top
bar, and got "+" off the search row — that reasoning still holds and is
still what's built. What changed is the top bar's own contents and where
"+"/"Add Entry" landed, per an explicit follow-up spec that superseded the
"prominent Lock pill + muted Clear-field icon + a dedicated header row for
+" specifics above:

- The "Vault" label and the "Unlocked" text are both gone from the
  top bar entirely — not just restyled.
- The top bar is now a fixed 40dp (`TOP_BAR_HEIGHT_DP`), not `WRAP_CONTENT`.
- Lock is icon-only now (no text), 20dp from the screen's left edge, 4dp
  clearance above/below.
- The vault logo (`R.drawable.ic_vault_logo` — the same mark the
  login screen and app icon use, already in this project from an earlier,
  separate request) sits dead center. Centering it precisely, independent
  of however wide Lock/Clear-field end up, is why `buildTopBar` is a
  `FrameLayout` now rather than the weighted `LinearLayout` described
  above.
- Clear-field is a text "Clear" label now, not the circled-X icon
  (`ic_clear_field.xml` is still in the repo but no longer referenced from
  Kotlin) — top right, 20dp from the screen's right edge, same 4dp
  clearance as Lock.
- **Superseded since (top-bar chrome only; the layout above still stands):**
  the bar is 44dp now, not 40dp, and Lock/Clear are full-height 44dp boxes
  with no 4dp clearance. Both are visible gradient pills — the same recipe
  as the main app's Android home-header Lock/Settings buttons — instead of a
  bare icon and bare text. The centered logo is the home-screen wordmark
  (`R.drawable.ic_home_logo`, 101 by 42dp, same as `HomeScreenLogo`), not
  `ic_vault_logo`, which no code references any more. See
  `docs/ime-visual-parity-plan.md`, item 10.
- "+"/"Add Entry" moved again — off the dedicated header row above the
  results list, back onto `spaceRow` beside "space" (its original spot,
  before `docs/ime-layout-v2-and-grab-design.md` first relocated it), now
  labeled "Add Entry" on a rounded-rectangle key rather than a round "+".
  `buildResultsHeaderRow` and `buildNewEntryButton` were both deleted —
  `buildBottomActionRow`'s existing optional right-hand key (built for
  Cancel/Done) already renders exactly this shape, so `spaceRow` just
  passes `rightLabel = "Add Entry"` into that same, unchanged mechanism.

All of this is built, in the same pass as the rest of this document.

### Resolved: colors, sourced from the connected "Design System for Vault" project

The color question above was left open pending the actual values — this
session's own search of this file, `docs/ACCOUNT-CREATION-DESIGN.md`,
`docs/ime-layout-v2-and-grab-design.md`, and `CLAUDE.md` found no second
scheme defined anywhere, only a stray old comment nicknaming the create
flow "the create/coral branch" (a label for the screen, never a color).

The actual source turned out to be a separate connected project,
`Design System for Vault` (a Figma Make export, `src/` holding
React reference components and its own `index.css`) — not something
committed inside this repo's own `docs/`, which is why the earlier search
came up empty. Read directly rather than assumed: `src/index.css`'s
`.dark` block defines the exact same blue-navy palette already in
`VaultKeyboardView`'s companion object, token-for-token
(`--background`/`--card`/`--border`/`--secondary`/`--secondary-foreground`/
`--muted-foreground`/`--foreground`/`--success` all match
`BACKGROUND`/`CARD`/`BORDER`/`SECONDARY`/`SECONDARY_FOREGROUND`/
`MUTED_FOREGROUND`/`FOREGROUND`/`SUCCESS` exactly) — confirming the Kotlin
palette was never wrong, just missing the one token it never picked up:
`--accent: #4a9ee0` / `--accent-foreground: #0c1827`.

That reference project's own "new entry" flow —
`src/components/TypePicker.tsx` (choosing an entry type) and
`src/components/EntryEditor.tsx` (the title/fields screen, literally
titled "New Entry") — colors exactly the actions that move the flow
forward with `--accent`: `EntryEditor`'s "Save," its "+ Add field" row,
its sensitivity toggle when active. Everything neutral in those same
files — "Cancel," the reveal-eye icon, a custom field's delete "×" — stays
on `--muted-foreground`, no accent at all. Not a second, separate palette
after all; one additional token, applied narrowly to "the thing that moves
this flow forward," exactly where the reference does it.

**Applied**: `ACCENT`/`ACCENT_FOREGROUND` added to
`VaultKeyboardView`'s companion object (`#4A9EE0`/`#0C1827`, sourced
directly from that file). `specialKey` gained an `accent: Boolean = false`
parameter (default keeps every existing call site unchanged);
`buildBottomActionRow`'s optional right-hand key — the only slot in this
flow that's ever "Add Entry" or "Done," i.e. this flow's own "Save" — now
passes `accent = true`. Nothing else in the create flow changed color:
Cancel, Generate, Search, Grab, and the detail view's Show/Hide/Fill chips
all stay on the existing neutral `SECONDARY`, matching the reference's own
restraint (only Save/Add-field get the accent treatment there; everything
else stays neutral).

### Resolved: `Screen.CREATE`'s header now matches `EntryEditor.tsx` exactly

The question above — whether "use this layout" meant just the color, or
the reference's literal header placement and objects too — was answered
directly: **"Use this as the layout — including the placement and
objects."**

`EntryEditor.tsx`'s header is Cancel (muted text, left) / "New Entry"
(bold, centered) / Save (accent text, right), no keypad row at all (it's a
full web screen, not an IME dock). `buildCreatePanel`'s header used to
keep Cancel/Done down on the keypad's bottom row (`createActionsRow`)
instead, with the panel's own header carrying just a title and subtitle —
right color, wrong placement. That's what changed:

- `buildCreatePanel`'s header is now horizontal — Cancel (plain text,
  `MUTED_FOREGROUND`, left) / title (bold, centered, unchanged text logic)
  / Done (plain text, `ACCENT` — not `ACCENT_FOREGROUND`, since there's no
  fill behind it here, same as `EntryEditor.tsx` colors its "Save" text
  directly with `var(--accent)`) — wired straight to the existing
  `cancelDraftFlow()`/`finishDraft()` functions, same behavior as before,
  just relocated.
- The quiet-bias subtitle (`likelySignupField`) has no equivalent in
  `EntryEditor.tsx`'s own header — that component doesn't have this app's
  "why you're here" messaging at all — so it wasn't dropped, just moved to
  its own row directly under the header, same shape as the
  `draftGrabMessage` notice already below it.
- `createActionsRow` — the lateinit var, its construction and `addView` in
  `buildKeyboard()`, and its visibility line in `updateBottomRowsForScreen`
  — is gone entirely. `Screen.CREATE` now leaves the whole keypad hidden
  (no row takes its old slot), the same way `Screen.DETAIL` briefly did
  before `detailActionsRow` existed.
- New `CREATE_HEIGHT_DP = 340` (up from sharing `DETAIL_HEIGHT_DP`'s 300):
  with no action row left occupying keypad space for this screen,
  `Screen.CREATE` gets back the same ~40dp `DETAIL_HEIGHT_DP`'s own
  comment describes losing when `detailActionsRow` was added — the
  original, pre-reduction 340.

Verified: grep for `createActionsRow` turns up only historical comments
explaining what moved and why, no live code; the usual brace/paren/bracket
balance check (see "Verification" above — still no compiler in this
sandbox) passed clean.

Still separately open, not implied by any of the above: whether the real
web app's own entry-creation screens — still on the older `ink-*` token
system per `CLAUDE.md` ("Settings and the entry editor are still on the
older ink-*/card-based system") — should eventually move onto this same
`--accent`-based design system too. A real, boundable follow-up on its
own, not something "use this as the layout" for the IME's Create panel
settles one way or the other.

### Update: the `EntryEditor.tsx` match above was wrong — a screenshot of the actual design showed a different palette entirely

Direct feedback: **"the mplemented ide looks nothing like the attached
image. *IME new entry flow, I mean"** — a screenshot of the actual
intended `Screen.CREATE` design, and it matches neither the blue-accented
`EntryEditor.tsx` header this doc's previous section just described nor
any color already in this codebase. Checked against every candidate
connected to this session before concluding that: the "Design System for
Vault" project's `index.css`/`EntryEditor.tsx` (blue `#4a9ee0`),
the real repo's own `--vault-*` tokens in `src/index.css`
(blue-gray `--vault-accent: #6b9dc6`), and both HTML mockups already in
the claude.ai Project (`pass-handler-ime-mock.html`,
`vault-ui-v9.html` — blue accents, `#8fb4d9`/`#6b9dc6`) all use some
shade of blue. The screenshot is warm dark-brown/coral instead. No file
connected to this session is its source — it was pixel-sampled directly
from the attached image:

| Element | Sampled value |
| --- | --- |
| Panel background | `#241A16` |
| Row/header divider | `#4A352D` |
| Accent (filled pills, filled "✓" button, "✕" outline) | `#E0A087` |
| Text/glyph color on an accent fill | `#241A16` (same as background) |
| "TITLE"-style field label | `#A8887C` |
| Back chevron | `#A7A3A2` |
| Title / field value text | `#FFFFFF` |

What changed in `VaultKeyboardView.kt`, scoped deliberately to just
`buildCreatePanel`/`buildDraftFieldRow` — "the IME new entry flow," not
the rest of the IME, which keeps the existing blue-navy palette
untouched:

- New `CREATE_BG`/`CREATE_BORDER`/`CREATE_ACCENT`/`CREATE_ACCENT_TEXT`/
  `CREATE_MUTED`/`CREATE_CHEVRON`/`CREATE_FG` constants, holding exactly
  the sampled values above. `ACCENT`/`ACCENT_FOREGROUND` (the blue pair
  from the previous section) are untouched and still used elsewhere
  (`buildBottomActionRow`'s "Add Entry") — this screen just stopped being
  one of their callers.
- The header is no longer Cancel/title/Done as plain text. It's now: a
  "‹" chevron (same glyph/size `buildDetailView`'s own back arrow already
  uses) at far left, the title left-aligned right after it (not
  centered — the screenshot's title sits flush against the chevron, not
  centered in the bar), then an outline-only "✕" button and a filled "✓"
  button, both 40×40dp rounded squares, at far right. The screenshot
  shows three controls where this flow only has two real actions
  (cancel the draft, commit it) — resolved by wiring *both* the chevron
  and the "✕" to `cancelDraftFlow()` and the "✓" to `finishDraft()`,
  rather than inventing a third, distinct behavior nothing in this flow
  needs. Flagged here in case that assumption is wrong — the screenshot
  doesn't disambiguate it, and it's a real behavioral choice, not just a
  visual one.
- Each field row is restructured to match the screenshot's stack —
  all-caps muted label, then a large bold value, then a row of
  fully-rounded (pill-shaped) accent buttons underneath — replacing the
  previous label-left/actions-right split. New `createPillButton` helper
  (36dp tall, 18dp corner radius = a true pill) is `buildDraftFieldRow`'s
  own, separate from `smallActionButton` (the small rounded-*rect* chip
  every other field row, including the DETAIL screen's, still uses) —
  so this change doesn't leak into `buildDetailView`, matching "the IME
  new entry flow" scope exactly.
- The non-password populate action is relabeled "Pick from Vault" (was
  "Search"), matching the screenshot's own label — the function it calls,
  `startPickingForDraftField`, is unchanged. (Since narrowed to Email and
  replaced by an inline saved-emails list, with `startPickingForDraftField`
  deleted — see `docs/ACCOUNT-CREATION-DESIGN.md`, "Revision: inline email
  list and the full generator panel".)
- New `withCreateBorder` (a `CREATE_BORDER`-colored copy of
  `withBottomBorder`) and `strokedRoundedRect` (an outline-only
  `GradientDrawable`, for the "✕" button — `filledRoundedRect` already
  covered the filled "✓") helpers.

Verified: brace/paren/bracket balance check passed clean; grepped that
`smallActionButton` and `buildDetailFieldRow` (the DETAIL screen's own
field-row code) are unchanged and still on the blue-navy palette, and
that `createPillButton`/`CREATE_*` constants are only ever referenced
from `buildCreatePanel`/`buildDraftFieldRow`.

**Later revision — DETAIL rows adopted this stack too.** The paragraphs
above describe `buildDetailFieldRow` as it was at the time: still
label-left/actions-right, on `smallActionButton`'s original 10dp side
padding. It has since been restructured to the same label → value →
chips-below stack, with `smallActionButton` widened to 20dp of clearance
either side (height, 5dp radius and gradient recipe unchanged) — see
`docs/MANUAL-FILL-DESIGN.md`'s "Detail-view field rows — current layout and
fill feedback". The create panel keeps its own `createPillButton`; that
change didn't touch it.

## Revision: shared chrome switched from ink tokens to the vault palette

**Status correction, found during a later documentation audit: the
eleven-constant switch described below was never actually applied.**
`VaultKeyboardView.kt`'s `BACKGROUND`/`CARD`/`BORDER`/`SECONDARY`/
`SECONDARY_FOREGROUND`/`MUTED_FOREGROUND`/`FOREGROUND`/`SUCCESS`/`ACCENT`/
`ACCENT_FOREGROUND` constants still hold every one of the "Old (ink)" values
in the table below, not the "New (vault)" ones — despite this section's own
closing paragraph claiming a grep confirmed the switch was complete. The
three *derived* updates below it (the two `ic_lock.xml`/
`VaultImePreviewActivity.kt` hand-duplicated literals, and leaving
`ic_vault_logo.xml` alone) **were** genuinely applied — confirmed directly
against the current files — so this was a partial migration: everything
that copies a value from the shared constants moved to the new palette,
but the constants themselves, the actual subject of this section, did not.
**Second correction, superseding the first: the design below is *not*
accurate as a target either**, despite what the line above used to claim.
It targets the original `--vault-*` CSS tokens, and the real Android app
has since drifted from several of those (per
`vault-visual-language-spec.md`'s own later status-correction note) —
`docs/ime-visual-parity-plan.md` re-verified every constant directly
against current Android-branch source and is the authoritative target now.
The table below is kept only as history — do not implement against it.

The "Resolved: colors, sourced from the connected 'Design System for
Vault' project" section above set `BACKGROUND`/`CARD`/`BORDER`/
`SECONDARY`/`SECONDARY_FOREGROUND`/`MUTED_FOREGROUND`/`FOREGROUND`/
`PLACEHOLDER`/`SUCCESS`/`ACCENT`/`ACCENT_FOREGROUND` to that project's
`ink-*`/`--accent`/`--success` tokens. Those are still Settings' and the
entry editor's own palette — but they're the *older* of the app's two
coexisting palettes. The newer "vault" visual-language redesign
(`docs/vault-visual-language-spec.md`) has since shipped to the Entry
List and entry detail screens, which is what a user actually sees when
they open the app today — and is what "the main app's colors," on a
direct follow-up request, turned out to mean.

Every one of the eleven constants above keeps its name and role; only the
value changed, sourced from `index.css`'s `--vault-*`/`--hairline` custom
properties instead:

| Constant | Old (ink) | New (vault) | Source token |
|---|---|---|---|
| `BACKGROUND` | `#0C1827` | `#0A0D11` | `--vault-wall` |
| `CARD` | `#111E2E` | `#1F252D` | `--vault-shelf` |
| `BORDER` | `#1E3457` | `#2A3039` | `--hairline` |
| `SECONDARY` | `#1A2D44` | `#131820` | `--vault-rail` |
| `SECONDARY_FOREGROUND` | `#B8CEDF` | `#E2E6EA` | `--vault-fg` |
| `MUTED_FOREGROUND` | `#6B90B0` | `#8B949E` | `--vault-muted` |
| `FOREGROUND` | `#D6E4EF` | `#E2E6EA` | `--vault-fg` |
| `PLACEHOLDER` | `#80D6E4EF` | `#80E2E6EA` | `FOREGROUND` @ ~50% alpha |
| `SUCCESS` | `#4ADE80` | `#6FBF8B` | `--vault-ok` |
| `ACCENT` | `#4A9EE0` | `#6B9DC6` | `--vault-accent` |
| `ACCENT_FOREGROUND` | `#0C1827` | `#0A0D11` | `--vault-wall` |

`ACCENT`'s one call site (`buildBottomActionRow`'s "Add Entry" key)
already satisfied the spec's own "exactly three uses" rule for
`--vault-accent` (primary action, focus ring, dial indicator) before this
switch, so no call site needed to move off it.

**Was explicitly out of scope, by direct request, at the time this was
written**: the account-creation panel (`buildCreatePanel`/
`buildDraftFieldRow`/`buildPasswordOptionsPanel` and the `CREATE_*`
constants two sections up) — "the new entry creation flow screens and
colors should be left as is." That's since been revisited: see
`docs/ime-visual-parity-plan.md`, which brings this panel's *chrome*
(buttons) into the same gradient-pill system as the rest of the IME while
keeping its coral hue family — not "left as is" any more, but also not
dropped to the neutral palette either.

**Two baked-in drawable colors needed a manual, separate update**, since
they don't read from the Kotlin constants at build time:

- `ic_lock.xml`'s stroke — baked in as a literal `#B8CEDF` matching the
  old `SECONDARY_FOREGROUND` by hand, not a live tint — updated to
  `#E2E6EA` to match. Left un-synced, the Lock icon and the "Vault"
  wordmark label beside it (which *does* read `SECONDARY_FOREGROUND`
  live) would have visibly split into two different tones.
- `ic_vault_logo.xml`'s keyhole color, `#8FADC7`, was **not**
  touched — same reasoning the main app's own `HomeScreenLogo.tsx` gives
  for leaving that identical asset alone: it's supplied brand artwork,
  not a themed UI element, and was never really "on" either token set to
  begin with. It happened to read as part of one coherent wordmark under
  the old ink tokens (`SECONDARY_FOREGROUND` `#B8CEDF` being a close blue
  to `#8FADC7`); under the vault tokens it doesn't (`#E2E6EA` is a
  neutral, not a blue) — accepted as a small, expected step down rather
  than worked around, since the vault spec explicitly keeps its own
  accent blue (`--vault-accent`) off of text.
- `VaultImePreviewActivity.kt`'s own wrapper background/hint-text
  (two more hand-duplicated literals, `private` in
  `VaultKeyboardView`'s companion object so this separate Activity
  can't reference them directly) updated the same way, so the preview
  screen's own chrome doesn't show a seam of the old palette around the
  real keyboard view it hosts.

`ic_clear_field.xml`, which at the time still carried the old
`MUTED_FOREGROUND` value baked in but was dead code, has since been
deleted entirely — it no longer exists in the drawable tree.

The "Verified: ... grepped the whole `com/passhandler/app` tree for every
old hex value to confirm no other silent duplicate was missed" claim that
originally closed this section did not hold — see the status correction at
the top of this section. No real Android/Kotlin compile is possible in
this sandbox, which remains the recommended real-world check before
trusting any Kotlin change here, this one included.
