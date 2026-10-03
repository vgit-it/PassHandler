# Vault visual overhaul — migration plan

**Status:** phases 1–8 shipped, plus a fix for a gap phases 1–8 all shared:
none of them ever built the actual **vault frame** (spec §1's Frame +
Inside planes — the bezeled box with corner bolts and a recessed interior
that every other component was supposed to sit inside). Every component
picked up `--vault-*` tokens and motion, but with no box to sit in, the
search shelf/entries/tab panel just floated flush against the raw screen
edge — reported back as "entries are off center, barely any animations
playing" once compared side-by-side against the reference prototype
(`vault-ui-v9.html`, added to this project after the fact). New
`VaultFrame.tsx` is that box; `VaultScreen.tsx`'s header moved out of
`EntryList.tsx` and now sits above it (spec's "Outside" plane,
`bg-vault-chrome` — a token that had been defined since phase 1 and never
actually used until now); `VaultDoors.tsx`'s geometry was reworked to align
with the same margin/bezel the frame uses, so the open/shut animation reads
as the vault itself rather than a full-screen wipe. See §6a below for the
full file-level breakdown. `npm run typecheck`/`lint`/`test` (164/164)/
`build` all clean; Playwright preview-harness screenshots confirmed the
frame renders boxed/bezeled/cornered matching the reference, and the
shut-doors geometry lines up with the frame's own margin. **Phase 9 (the 3D
Settings turn) is explicitly, permanently skipped for this app** — see
decision 5's update below, not merely deferred like the earlier phases
were.

Source: `docs/vault-visual-language-spec.md`, read literally per its own instruction.
Target: the shared React/Tailwind webview (`src/ui/`) used by both Tauri/Windows and the Android
WebView. **Not in scope: the native Android IME** (`VaultIme.kt`/`VaultKeyboardView.kt`)
— the spec itself scopes to "React webview shared by Tauri (Windows) and Android," and the IME is
a separate native Kotlin UI with its own recently-built visual language
(`docs/ime-layout-v2-and-grab-design.md`), untouched by this plan.

## 0. What this actually is

This is not a restyle — it's a different design system replacing the current one wholesale.
`claude/design-system-reference.md` (cards, `rounded-xl`, `bg-ink-700`/`border-ink-600`, the
Tailwind `ink-*` scale) is the *current* shipped system. This spec's own anti-patterns list
rejects that system by name: "Cards. Anything with a border-radius, a border on all four sides,
and a drop shadow is a card... reject these even if they seem reasonable in isolation." So this
plan supersedes `design-system-reference.md`, not extends it.

**Confirmed: this supersedes the header/tab-bar/FAB/illustration-panel redesign shipped earlier
in this same project's work** (`BottomTabBar.tsx`'s 198px floating pill, the `ListTopIllustration`
artwork panel, the entry cards' contrast-bumped fill) — Phases 3–6 below replace it. Not wasted
work: the underlying interaction/state (which tab is active, FAB opens the editor, Settings via
header gear) all carries forward unchanged; only the visual shell changes.

## 1. Decisions confirmed

1. **Staged delivery: phases 1–5 first**, per the spec's own §10 recommendation — the
   token/plane/shelf/peg rebuild shipped and was confirmed before rails/detail-animation/doors
   (phases 6–8, since shipped; phase 9 dropped, see decision 5).
2. **Supersedes the recent header/tab-bar/illustration work** — confirmed, see above.
3. **Peg color: hash-only for now.** No dominant-color-from-favicon extraction this round — that
   was flagged as genuinely new work (canvas pixel sampling or a library), not a restyle. The
   spec's own fallback path (a stable title hash) is what's built; real extraction is deferred,
   not abandoned.
4. **List virtualization: deferred.** Not present in the codebase today (no `react-window`/
   `react-virtual`); real added complexity, not worth building until entry counts actually
   approach the spec's own "~100 entries" threshold in practice.
5. **3D Settings turn: permanently skipped.** Confirmed explicitly after phases 6–8 shipped:
   asked directly whether phase 9 should now be included, answer was to keep skipping it. The 3D
   cube turn itself stays permanently off the table — not "until a later pass decides." That's
   narrower than "zero visual change, ever": a later, separate "colors only" pass did move many of
   Settings' text/background colors onto `--vault-*` tokens while keeping its ink-based card layout
   entirely intact (`Settings.tsx`'s own doc comment notes this explicitly). Its controls
   (fields, buttons, toggles) then moved onto Home's palette too, through the `.palette-grey`/
   `.palette-vault` scope classes that recolor the `ink-*` tokens
   (`docs/SETTINGS-VISUAL-PASS.md`). Settings is still not migrated to the vault visual language
   (no shelves, rails or frame): it keeps its card layout in Home's colors.

**Also decided, not asked separately (matches this app's own existing, explicit policy):**
no light-theme re-derivation. `tailwind.config.js` already states "Dark is the only theme...
so the app commits to one look rather than carrying an untested second palette" — the new
`--vault-*` tokens are dark-only for the same reason, consistent with (not a new decision
against) that standing policy.

## 2. Scope map — spec concept → real file → work required

| Spec concept | Current file/component | Work |
|---|---|---|
| Tokens (`--vault-*`, `--edge-*`, `--accent`, `--bezel`, motion vars) | `tailwind.config.js` (`ink-*` scale), `src/index.css` | New token set, dark-only, namespaced `--vault-*`/`--edge-*`/`--hairline`/`--vault-fg`/`--vault-muted`/`--vault-dim`/`--vault-accent`/`--vault-ok`/`--vault-warn` so it coexists with the existing `ink-*`/`accent`/`ok`/`warn`/`bad` tokens still used by every screen this pass doesn't touch (Settings, the editor) |
| Inside plane: search shelf | `EntryList.tsx`'s search bar (Android: inline `w-[280px]` pill in the header; Windows: already its own full-width row below the header) | Android: pull search out of the header into its own full-width band above the list, matching Windows' existing structural pattern. Both: restyle to `.search-shelf`/`.search` |
| Inside plane: entry shelves | `Row` component in `EntryList.tsx` | Full rebuild per spec §4.1 — delete the card, no border-radius, wall-to-wall |
| Peg (avatar) | `EntrySiteIcon` | Restyle to 34×34 flat plate + drop shadow; hash-color only this round (see decision 3) |
| Inside plane: tab panel + `+` | `BottomTabBar.tsx` (floating pill, 22px gap above the bottom edge) + `VaultScreen.tsx`'s independently-positioned FAB | Move inside the vault's recessed floor, flush (no gap, no floating pill shadow); tab slug becomes a sliding raised element; `+` becomes the one `--vault-accent`-filled element |
| No gradients / no bevel highlights | Checked: zero gradient usage anywhere in `src/ui/` or `index.css`. | Confirmed no-op, not a rewrite |
| Section rails (phase 6) | `EntryList.tsx`'s sticky category header | Rebuilt as one `bg-vault-rail` wall-groove recipe per spec §4.3 (inset+drop shadow, lug spans, uppercase label, mono count) |
| Detail-view open animation (phase 7) | `EntryDetail.tsx` / `PickEntryDetail.tsx`, opened via `VaultScreen.tsx` | `ShelfOriginPanel.tsx` "deposit box": a container transform out of the tapped card (clip morph, shared icon/title, stagger), list stays mounted and dims behind it — see §6g |
| Doors / two-stage unlock / auto-lock creep (phase 8) | `App.tsx`, `app/store.tsx`'s auto-lock timer | New `VaultDoors.tsx`, always mounted; bolts retract then doors part on unlock (spec §5); creep at (timeout − 30s) via new `autoLockCreeping` state |
| 3D Settings cube (phase 9) | Settings screen | Permanently skipped — see decision 5 |
| Unlock reveal (spec §5.1) | `VaultScreen.tsx`, `lockTransitionTiming.ts`, `store.tsx`, `MainActivity.kt` | New `useUnlockReveal.ts`: interior light comes up and contents settle while the doors part — see §6h |
| Frame + Outside planes (the vault box itself) | Nowhere — missing from every phase above until found and fixed post-phase-8, see §6a | New `VaultFrame.tsx` (margin/bezel/corner bolts/interior), header lifted out of `EntryList.tsx` into `VaultScreen.tsx` as the Outside plane, `VaultDoors.tsx` geometry aligned to match |

**Explicitly not touched, permanently:** the 3D Settings cube (phase 9 — skipped per decision 5;
Settings did later get a separate colors-only pass, see decision 5's note).
Everything else the spec describes (phases 1–8, plus the frame fix in §6a) has shipped — though see
§5/§6/§6a/§6b/§6f below for several pieces that shipped here and then changed again in a later,
undocumented-in-this-plan Figma-parity pass; those sections now carry status-correction notes.

## 3. Carries forward, unaffected

- Every non-visual behavior: search/filter logic, entry grouping, sync status, the account-
  creation review flow, Settings' actual functionality, auto-lock's real timer and the IME's
  independent enforcement of it (`enforceAutoLockOnBridgeCall`).
- Entry-type icon glyphs (`entryTypeIcons.tsx`) — reused inside the new peg, not redrawn.
- The Android quick-fill IME — out of scope entirely, per the spec's own "React webview" scoping.

## 4. Verification

No component-test harness exists in this project — verification stays
`npm run typecheck`/`lint`/`test`/`build` plus the established scratch Playwright preview-harness
screenshot method, covering both `platform.isAndroid` true/false.

## 5. What actually shipped

- **`src/index.css` / `tailwind.config.js`** — the full `--vault-*`/`--edge-*` token set (§2 of the
  spec) plus `vault-*` color/shadow/radius/timing Tailwind utilities. Dark-only, coexists with the
  existing `ink-*`/`accent`/`ok`/`warn`/`bad` tokens untouched screens still use.
- **`EntryList.tsx`** — `Row` rebuilt as one shared shelf recipe for both platforms (the old
  Android-card/Windows-card fork is gone — **status correction: it's back.** A later pass
  reintroduced a `platform.isAndroid` fork in `Row` between a `rounded-[20px]`/translucent
  "floating card" on Android and this shelf recipe on Windows, with its own comment explaining the
  reintroduction was deliberate — despite spec §9 rejecting cards by name. Everything else in this
  bullet still describes the shared shelf recipe Windows uses): the whole shelf is a single
  `<button>` (fixes a real bug
  — only the text half was tappable before), `group`/`group-active:` drives the peg's independent
  press motion, a sibling `<span>` stands in for the spec's `.shelf::after` front-face+shadow since
  Tailwind can't target `::after` directly. `EntrySiteIcon` rebuilt as the peg — one 34×34 size on
  both platforms, one neutral plate for every entry (spec §4.2 — per-entry colours were dropped as too strong).
  The search bar moved out of Android's header into one shared full-width "search shelf" band above
  the list on both platforms (`.search-shelf`/`.search`, spec §4.4) — Android's header lost its
  inline pill and its long-dead invisible "Vault" wordmark placeholder along with it.
- **`BottomTabBar.tsx`** — rebuilt as the flush, full-width tab channel (spec §4.5): a sliding
  `--vault-shelf` slug (hardcoded left-offset math for exactly two tabs, not a runtime measurement)
  and a `--vault-accent`-filled "+" docked at the channel's own right end, replacing the old 198px
  floating pill + separately-floating FAB. **Status correction: superseded again**, by the same
  later Figma-parity pass noted throughout this section — see §6b below for what shipped there, and
  note that pass has itself since been superseded once more: tabs are icon-only (no
  `Upcoming`/`Home` labels), each with its own opacity-toggled pill instead of a sliding slug, and
  the "+" is a soft coral gradient fill (`#D6B0A0`→`#BC907E`, the entry-creation flow's palette —
  `docs/ENTRY-CREATION-PALETTE-DESIGN.md`), not `bg-vault-accent`. Read
  `BottomTabBar.tsx`'s own current doc comment rather than trusting this plan for its exact recipe.
- **`VaultScreen.tsx`** — the tab-bar wrapper is now `inset-x-0 bottom-0` (flush) instead of a
  centered pill lifted 22px off the edge; the standalone Android "+" button is gone (it lives inside
  `BottomTabBar` now); `onAdd` threads through to it instead.
- **Windows' own floating "+"** (`EntryList.tsx`, no tab bar to dock into on that platform) recolored
  to `bg-vault-accent`/`rounded-vault-inner`/`shadow-vault-peg` to match — spec §3.7's "+ is the only
  accent fill" holds on both platforms, just via two different housings.
- Colors computed at runtime (peg hash, the search focus ring's accent tint) are inline `style`, not
  template-literal Tailwind classes — Tailwind's JIT compiler can only generate classes that appear
  literally in source, so a `bg-[${var}]` would silently produce no CSS.

## 6. What shipped — phases 6-8

- **`EntryList.tsx` section rails (phase 6)** — the sticky category-header block rebuilt per spec
  §4.3 as one shared `bg-vault-rail` groove recipe (inset+drop shadow, two sibling "lug" spans),
  replacing the old Android-opaque/Windows-blurred fork. Label is `text-[9.5px] font-semibold
  uppercase tracking-[.17em]`, `text-[#8e98a2]` normally or `text-warn` for the review section; a
  separate right-aligned `font-mono text-[9.5px] text-vault-dim` span carries the entry count.
  **Status correction: removed entirely, on both platforms**, by the same later pass noted
  elsewhere in this doc. `EntryList.tsx` has no `bg-vault-rail`/sticky/lug markup left at all —
  its own current comment explains the header row lost the sticky-while-scrolling affordance the
  rail gave for free, as an accepted tradeoff.
- **Detail-view "deposit box" (phase 7)** — `ShelfOriginPanel.tsx` opens `EntryDetail`/
  `PickEntryDetail` out of the tapped card and closes them back into it, with the list staying
  mounted and dimmed underneath; `closeDetail`/`closePick` start the close and the panel reports
  when it has finished. The Android back button and Esc route through the same close. Back
  actions are labeled "Put back" per spec §4.6. The current implementation (a container
  transform) is described in §6g.
- **Doors, two-stage unlock, auto-lock creep (phase 8)** — new `VaultDoors.tsx`, mounted once at
  the top of `App.tsx` (as a sibling of the screen switch, not gated by `phase`, so its close
  animation isn't cut off by an unmount) implementing spec §5's "signature moment": bolts retract
  (150ms) then the doors part (400ms, 150ms delay) on unlock, reversed on lock, via a single state
  flip plus a CSS `transition-delay` rather than chained JS timers. Purely decorative — `lock()` in
  `app/store.tsx` still clears the decrypted vault synchronously before any door pixel moves; the
  doors never gate real security state. `prefers-reduced-motion` drops the slide to a 120ms fade
  per spec §7. New `autoLockCreeping` state in `app/store.tsx`: the auto-lock timer now also flags
  when idle time crosses (timeout − 30s), which `VaultDoors` reads to ease the doors back in 9px and
  fade the corner bolts to partial opacity — no dialog, no countdown text, the doors' own motion is
  the warning — and any activity (via the existing `noteActivity`) clears the flag immediately.

## 6a. The missing vault frame — found and fixed after phases 6-8

Diagnosed by comparing the running app against the reference prototype
(`vault-ui-v9.html`) side by side via the Playwright preview-harness method:
the app had no bezeled box at all — the header, search shelf, and entries
rendered flush against the true screen edges, on the plain page background,
with none of the reference's margin/bezel/corner-bolts/rounded-interior
container. `--vault-frame`/`--vault-chrome` had been tokens since phase 1
but neither was ever applied anywhere real. This wasn't a regression from
phases 6-8 specifically — it was a gap in the very first scope map (§2
above), which listed tokens/search-shelf/entry-shelves/peg/tab-panel but
never listed the frame itself as a work item, so it was simply never built
across any phase.

- **New `src/ui/components/VaultFrame.tsx`** — the Frame + Inside planes
  (spec §1): an 8px outer margin, a `--vault-frame` bezel box (**status
  correction: no longer has its own corner bolts** — a later Figma-parity
  pass made it a plain even-thickness border with no rivet ornament,
  per `VaultFrame.tsx`'s own current comment, diverging from spec §1 on
  this one point; `VaultDoors.tsx` still draws its own four corner bolts
  independently, so bolts are still visible while the doors are shut, just
  not painted by the frame itself) and a subtle inner hairline ring, wrapping a
  `rounded-vault-inner`/`overflow-hidden`/`bg-vault-wall` interior that
  clips its own content hard at the corner, matching the reference's
  `.vault`/`.interior` recipe. Used by `VaultScreen.tsx` and `Unlock.tsx`
  (see the end of this section).
- **`VaultScreen.tsx`** — restructured so the header sits above `VaultFrame`
  (spec's "Outside" plane) rather than inside it, and the search shelf/
  list/detail overlays render as `VaultFrame`'s children instead of
  spanning the raw screen. New local `VaultHeaderBar` component holds the
  header JSX that used to live in `EntryList.tsx` — same content on both
  platforms, just relocated and now actually painted with
  `bg-vault-chrome`. Gated the same way the list already was (only for
  List/Detail) — Upcoming/Edit/Settings stay full-screen pushes outside the
  frame, unchanged.
- **`EntryList.tsx`** — the `<header>` block and its `onSettings`/
  `onUpcoming` props are gone; the component now only owns what's actually
  "inside the vault" (search shelf, list, rows). `SyncNotice` stayed here,
  now sitting inside the frame's interior above the search shelf.
- **`VaultDoors.tsx`** — reworked from `fixed inset-0` (covering the raw
  viewport) to `fixed inset-2`, matching `VaultFrame`'s own outer margin,
  with each door panel inset from that box by `var(--vault-bezel)` (the
  same custom property the frame pads itself with) rather than spanning
  half the full screen. The corner bolts moved from `left-2.5`/`top-2.5` to
  `left-1`/`top-1` to land on the exact same pixels as `VaultFrame`'s own
  static corner bolts. The two components stay separately mounted
  (`VaultDoors` still has to outlive `VaultFrame`'s own mount to finish its
  close animation — see that file's own doc) but now share the same box
  geometry, so the open/shut animation reads as the vault itself instead of
  a color panel wiping across the whole screen.
**Follow-up bug, found after shipping the above:** the reworked doors above
did not actually clear the screen edge at "open." Hand-copied preview HTML
had missed this because it wasn't running the real component tree; catching
it took building a proper harness (`AppProvider`/`App` mounted against a real
in-memory vault via a scratch Vite entry) and measuring the door elements'
actual `getBoundingClientRect()` in a headless browser — visual screenshots
alone were ambiguous at the pixel widths involved. `translateX(±100%)` moves
a door by its own width only, which clears a door starting flush at
`left/right: 0`, but these doors start inset by `var(--vault-margin)` (8px,
the wrapper's own `inset-2`) plus `var(--vault-bezel)` (9px, the door's own
`left`/`right`) — 17px of fixed offset that a percent-based transform never
accounts for, since percent is relative to the door's own (viewport-width-
dependent) width, not to that fixed gap. A first attempt at `±101%` (a same-
percent overshoot, matching a figure in the reference prototype's own CSS)
still left a ~15px sliver of `--vault-door` on screen — 1% of a ~190px-wide
door is only ~2px, nowhere near the 17px gap — measured and confirmed via
`getBoundingClientRect()` before landing on the real fix: add the fixed
pixel offset directly, `calc(±100% ± var(--vault-margin) ± var(--vault-
bezel) ± 2px)`, which clears the edge exactly regardless of viewport width.
Re-measured after the fix: both doors' bounding rects sit fully off-screen
(2px to spare) at 412px and 1000px viewport widths.

**The lock screen shares this frame, and on Android its box must match Home's exactly.**
`Unlock.tsx` renders the same `VaultFrame`, with `VaultDoors` shut inside it
and the login panel above the doors (`z-50`). At the lock → Home hand-off the
two boxes have to sit on the same pixels, or the container visibly jumps.
Three things have to agree, and each one was once wrong:

- **Top offset.** Unlock's top bar (`UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID`) plus
  the frame's 8px top margin equals `ANDROID_HEADER_HEIGHT_PX` (68), Home's
  header height (`lockTransitionTiming.ts`). The header only really *is* 68px
  if its contents fit, so its Lock/Settings pills have a fixed `h-11 w-11`
  (44×44 including the border), the same size as Unlock's top-bar copies.
  Sized by padding alone they measured 46×46, which made the header 70px.
- **Bezel.** Both screens pass `transparentBezel` on Android. Home's visible
  box is the interior; an opaque bezel on the lock screen alone made its box
  9px bigger on every side.
- **Safe-area insets.** Unlock's root is `absolute` against the viewport, so
  it's inset by `env(safe-area-inset-*)` itself, the same way `#root` pads
  Home and `VaultDoors` insets the doors. At `inset-0` its frame ran under
  the status and gesture bars.

Check any change here by measuring both frames with `getBoundingClientRect()`
in the real `App` harness, with `#root` padded to stand in for the system
bars. After this fix, at 412×900 with no insets, both frames are 8,68 396×824
and the lock screen's doors sit exactly on Home's interior (17,77 378×806).
With 30px/40px insets, both frames are 8,98 396×754. The top bar's contents
follow the same rule: Unlock's top bar has `pt-2` on Android, so its buttons
and logo centre at 34px like Home's header, not 4px higher. Windows wasn't
part of this fix. It keeps the opaque bezel on both screens, and its
header-height match wasn't measured.

One known gap remains: once the unlock sequence ends, `VaultDoors` drops the
top-bar offset and starts at the bare margin, so the auto-lock creep's door
slivers run up behind `VaultHeaderBar` rather than stopping below it.

## 6b. Exact-match pass against `vault-ui-v9.html`

**Status correction: superseded.** The `BottomTabBar.tsx` recipe this
section ports (icon-plus-label tabs, the `#333b45` slug, etc.) was itself
replaced by a later Figma-parity pass — see the status-correction note on
§5's `BottomTabBar.tsx` bullet above for what's actually live now
(icon-only tabs, no slug, a coral/bronze "+"). The rest of this section
(the Windows header/search-input/row-typography literals it ported) is not
known to be affected and is left as written.

A follow-up request ("implement it just like the reference — layout and
positioning have to be exactly like the reference") after 6a's frame fix
landed. Went through the reference's CSS rule by rule against every vault
component and ported every literal value that diverged, not just the ones
that read as visibly wrong. Three scope decisions made upfront (asked, not
guessed):

- **Bottom bar stays Home/Upcoming**, not the reference's All/Logins/Cards/
  Docs category filter — restyled its chrome to match the reference's
  `.tabpanel`/`.tabs`/`.slug`/`.tab`/`.plus` recipe exactly, kept the two-tab
  navigation semantics.
- **The Android decorative illustration above the list is removed** — it
  was a separate, earlier request with no equivalent in this reference at
  all; entries now start right below the search shelf, matching the
  reference's own `.scroll` structure.
- **Android's header stays icon-only** (lock + gear, no title/count/Synced
  pill) — an earlier, deliberate simplification (see §5's "Android's header
  lost its inline pill and its long-dead invisible 'Vault' wordmark
  placeholder" note), kept as-is rather than reverted to match the
  reference's fuller `.top` content.

What actually changed, file by file:

- **`VaultScreen.tsx`** — Windows header padding ported to the reference's
  own `.top{padding:12px 12px 10px}` exactly (was `px-4 pb-2 pt-3`); title
  font-size to the literal 15px the reference's `.brand` uses (was the
  app's own remapped `text-sm`, 16px). Android's header left untouched per
  the decision above.
- **`EntryList.tsx`** — search input: radius 8px (was 9px/`vault-inner`),
  14px text (was 15px), uniform 11px padding (was an asymmetric 36px/12px
  split for a search-glyph icon), literal `#6b747d` placeholder color (was
  `vault-dim`) — and the icon itself is gone entirely, matching the
  reference's `.search`, which has no glyph at all, just the placeholder
  text. Row title/subtitle font-size corrected to the reference's own
  `.rt`/`.rs` values, 14px/12px (was 13px/11px — had never actually matched,
  independent of this pass). Added the reference's `.recess` inset shadow
  (`inset 0 8px 14px -12px #000`) to the scrollable list/empty-state area —
  a detail no earlier phase had ported. Removed the Android-only decorative
  illustration per the decision above. `EmptyState` — never migrated off
  the older ink-system's slate-400/text-sm — ported to the reference's own
  `.empty` recipe (13px, `#5f6871`/`vault-dim`, `46px 20px` padding).
- **`BottomTabBar.tsx`** — every literal the reference's `.tabpanel`/
  `.tabs`/`.slug`/`.tab`/`.plus` rules specify, ported exactly: `#141920`
  panel fill (was `vault-rail`, a different color — the reference
  deliberately doesn't reuse its own `--rail` variable here either), the
  tabs container's sunken `#06080a`+border+inset-shadow groove (was flat
  `vault-wall`, no border/shadow — the same recipe the search box already
  used, just never carried over here), 3px padding with no gap between tabs
  (was 4px padding + 4px gap — the slug's own left-offset math updated to
  match), the slug's own `#333b45`/7px-radius/`0 2px 6px -4px rgba(0,0,0,.8)`
  recipe (was `vault-shelf`/9px/`vault-peg`'s shadow) at 260ms (was 300ms),
  44px "+" (was 46px) with the reference's own shadow. Tabs gained a text
  label under the icon (`Upcoming`/`Home`, 10.5px) — the reference's own
  `.tab` is icon-plus-label, not icon-only — and inactive-tab color switched
  from `vault-dim` to `vault-muted`, matching `.tab{color:var(--muted)}`.
  Stayed a viewport-relative overlay rather than nesting inside `VaultFrame`
  the way the reference nests `.tabpanel` inside `.interior` — see that
  file's own updated doc comment for why (this bar also has to work on the
  Upcoming screen, which has no vault frame of its own; nesting it would
  either break that or resurrect the "detached hardware" floating-pill look
  phase 3 deliberately rejected).
- **`VaultDoors.tsx`** — added the reference's decorative hinge nubs
  (`.tb`): small `#454d58` rounded rectangles at fixed points along each
  door's inner edge (left door: 24%/50%/76%; right door: 37%/63%), a detail
  no earlier phase had ported. Adding them exposed a real regression in the
  door-clearance math from §6a's own fix: the nubs stick 5px past their
  door's own edge on purpose (matching the reference), and since they're a
  child of the door they inherit its transform — the existing 2px clearance
  buffer was tuned to the door's own box, not the nub's overhang, so the
  nubs left a ~3px sliver on screen at "open." Caught by the same
  `getBoundingClientRect()` measurement method §6a's fix used, before
  trusting it visually. Fixed by widening the buffer from 2px to 8px.
  Re-measured after: both doors and all five hinge nubs sit fully
  off-screen at "open," 3px+ to spare.

Verified throughout with the same real-component-tree preview harness
§6a's investigation built (mounts `<App/>` against a real in-memory vault,
Playwright screenshots + `getBoundingClientRect()` measurements — never
trusted a screenshot alone for the door/hinge geometry specifically, given
§6a's own history of a plausible-looking fix that measured out wrong).
`npm run typecheck`/`lint`/`build`/`test` (164/164) all clean on the final
state.

## 6c. Search-box focus ring bleeding the ink-system's global ring

Found while doing the 6b comparison, fixed separately once confirmed:
focusing the vault search box (e.g. Ctrl+F on Windows) showed a much
harsher, brighter ring than the box's own intended subtle accent glow.
Root cause — `index.css`'s global `:focus-visible` rule (`ring-2
ring-accent ring-offset-2 ring-offset-ink-950`, written for the *older*
ink-system's screens, which have no focus style of their own) applies to
every focusable element with no exception, including this input, which
already carries its own complete two-layer `focus:shadow-[...]` ring.
Tailwind's `ring`/`ring-offset` utilities and a plain `shadow-[...]` both
resolve to `box-shadow` via separate `--tw-ring-shadow`/`--tw-shadow`
custom properties that get concatenated together in the same declaration,
not two competing rules where the later cascade simply wins — confirmed via
`getComputedStyle` on the focused input in a real browser: the resolved
`box-shadow` had four layers, the global rule's ink-accent ring-offset pair
stacked in front of the input's own two.

Fixed by excluding the search input specifically —
`:focus-visible:not([data-search-input])` — rather than removing or
touching the global rule itself, which is still every other focusable
element's *only* focus indicator (header buttons, entry rows, the tab bar
— none of them define their own). Re-verified via `getComputedStyle`: the
focused input's resolved `box-shadow` is back to its own intended two
layers only. `npm run typecheck`/`lint`/`build`/`test` (164/164) clean.

## 6d. The actual "entries are off-center" root cause

The user's very first message this whole thread was "the entries are off
center" — §6a's missing-frame fix and §6b's exact-match pass both narrowed
the visible symptom without ever landing on the actual mechanism, because
neither investigation measured an individual row's own box. Found only
after the user asked whether visual checks could happen here instead of on
a real Android build, which led to sending real screenshots and getting a
"why are these off-center" question back in response to looking closely at
one.

Root cause: `Row`'s `<button>` (`EntryList.tsx`) combined `w-full` with the
`-mx-5`/`-mx-4` wall-to-wall negative-margin trick — same trick the search
shelf and section rail already used successfully. The difference is that a
`<button>` doesn't behave like a plain block box for `width: auto`: form
controls size to their own content regardless of `display`, they don't
participate in the CSS2.1 auto-margin-balancing algorithm a `<div>` does.
`w-full` (100% of the button's own, un-expanded containing block) pinned
the box to a fixed width, so the negative margin could only slide that
fixed box sideways rather than stretch it — the left edge landed flush at
the frame's edge as designed, but the right edge fell exactly as far
short, leaving a growing gap that read as everything shifted left. Confirmed
first via `getBoundingClientRect()` (row: 338px wide inside a 378px-wide
list, left edge flush at 17px but right edge 40px short of the frame's own
right edge at 395px) before touching any code — same discipline as §6a/6b's
door-geometry fixes.

First fix attempt (removing `w-full` outright, expecting the button to
block-stretch the same way the search shelf `<div>` does) made it worse —
measured a 180px-wide button, shrunk to fit its own icon+text content,
confirming buttons really don't auto-stretch. Real fix: moved the
`-mx-5`/`-mx-4` off the button and onto its parent `<li>` (a plain,
non-form-control block element, which DOES block-stretch correctly), and
kept `w-full` on the button — now 100% of the `<li>`'s own
already-expanded box, not fighting it. Re-measured: row's rect now matches
the list's own border-box edges exactly (17px to 395px), same as the
search shelf. Screenshotted before and after to confirm visually, not just
numerically. `npm run typecheck`/`lint`/`build`/`test` (164/164) clean.

## 6f. The peg's Login fallback: first letter → globe icon

*(`EntryPeg.tsx`, named throughout this section, was later deleted — its
logic merged into `EntrySiteIcon`/`EntryList.tsx` directly. See
`upcoming-tab-design.md`'s "Later update" section for that deletion; this
section's description of the fallback-tier logic itself is otherwise still
accurate, just relocated.)*

§2's scope map listed "Peg with favicon plus fallback" as shipped in phase
5, but the peg's own fallback chain only ever built two of the spec's three
documented tiers (§4.2: "cached favicon → entry-type glyph → first
letter") — `EntryPeg.tsx` skipped straight from favicon to first letter for
Login specifically, never falling back to an entry-type glyph the way every
other type's peg already does. Closed per request: a new `GlobeIcon`
(`icons.tsx`) is now that middle tier for Login — the same neutral plate
as every other type, just a globe glyph instead of a letter. No more first-letter tier at all; the two `EntryPeg` return paths
(favicon `<img>` vs. glyph-on-plate) collapsed into one shared plate path
that only branches on which glyph (`GlobeIcon` for Login, the entry's own
`EntryTypeIcon` for everything else), rather than keeping a separate
non-Login branch and a separate letter-computing Login branch side by side.
`npm run typecheck`/`lint` clean.

## 6g. The detail box, rebuilt as a container transform

The full choreography and timing table live in spec §4.6. **Don't reintroduce** any of these —
each was a real defect of the earlier scale-based version:

- scaling the panel (`scaleY`) — it squashes the content; morph the clip instead;
- growing from the card's top/height only — use its full rect and corner radius;
- `--detent` (or any overshoot) on the box — on a full-screen move it reads as wobble;
- a short opacity fade running alongside the close — it hides the "put back" motion;
- a `filter` dim on the list, or un-dimming only after the close ends — use the scrim, and
  un-dim when the close starts;
- leaving the tapped card visible under the box — hide it while the box is out;
- a parent-side `setTimeout` guessing the close duration — the panel reports `onClosed`.

What's built:

- **`ShelfOriginPanel.tsx`** — rewritten on the Web Animations API:
  - **Clip morph:** `clip-path: inset(... round r)` morphs from the card's exact rect and radius
    to the full area.
  - **Card face on top:** a surface layer (the card's fill over the wall, plus a copy of the
    card's contents) covers the box until it's mostly open.
  - **Shared elements:** `data-morph` icon/title travel between card and detail.
  - **Stagger:** `data-stagger` items fade and rise in.
  - **Source handling:** the source card is hidden while the box is out and re-measured on close.
    The component calls `onClosed` when the close has really finished.
  - **Interruptible:** closing mid-open reverses the running animations.
  - **Fallbacks:** a short fade (plus a 0.98 settle when motion is allowed) when there's no card
    to grow from, and a cross-fade under reduced motion.
- **`VaultScreen.tsx`**:
  - **State:** `CLOSE_MS`, `detailOrigin` and `pickOrigin` are gone. `detail` view state now
    carries `from` (the tab it opened over), `source` (the card's `data-shelf-key`) and `seq` (a
    fresh key per open).
  - **Upcoming:** it stays mounted under an Upcoming-opened box and gets the same motion.
  - **Layering:** a black `.58` scrim replaces the filter. Scrim and panels sit at `VaultFrame`'s
    interior level, covering the tab bar, which now stays mounted under the box instead of
    vanishing mid-animation. The content area is `isolate`, so the list's sticky headers and
    z-20 FAB stay below the scrim and panels.
- **Card markup:** `EntryList.tsx`/`UpcomingScreen.tsx` rows carry `data-shelf-key` and
  `data-morph="title"`, and `EntrySiteIcon` carries `data-morph="icon"`. The old
  `originRect: DOMRect` parameter is gone. A Shift+Enter open on Windows now grows out of the
  highlighted row too.
- **Detail markup:** `EntryDetail.tsx`/`PickEntryDetail.tsx` carry the matching `data-morph`
  targets, and `EntryDetail` carries `data-stagger` on its header, field rows, multiline blocks
  and footer.
- **Tokens:** new `--vault-arrive`, `--vault-depart` and `--vault-t-box-close` in `index.css`;
  `--vault-t-box` changed from 300ms to 320ms. The panel reads them at run time and the scrim
  uses them in CSS, so the two stay in step.

Verified in a Chromium browser with a temporary harness page (real `ShelfOriginPanel`, cards
built from `EntryList`'s Android recipe), by pausing the animations at chosen timestamps and
screenshotting:
- Frame 0 is indistinguishable from the list at rest.
- Mid-open frames show an undistorted clip growing with the icon/title in flight.
- At rest, no animations, clip or leftover clones remain.
- The close lands on the card, unmounts the panel and un-hides the card.
- A close issued 120ms into an open reverses and unmounts cleanly.

The harness was deleted afterwards. Not checked on a device: frame pacing of `clip-path`
animation on low-end Android WebView. It is not a compositor-only property, so it's the one
thing to watch on real hardware.

## 6h. Unlock reveal

Spec §5.1 has the choreography, timeline and when-it-plays table. What's built:

- **`lockTransitionTiming.ts`** — `REVEAL_*` start times, durations and rise distances, all
  anchored to `DOORS_PART_START_MS` (itself derived from `DOOR_OPEN_DELAY_MS` and the new
  `BOLT_RETRACT_MS`/`DOOR_PART_MS`), and `REVEAL_END_MS`. `tests/lockTransitionTiming.test.ts`
  fails if the reveal ever ends after `UNLOCK_SEQUENCE_MS` or starts before the doors part.
- **`store.tsx`** — `playUnlockReveal`: set from `consumeFillLaunch()` (reads and deletes
  `window.__vaultLaunchContext`) at a successful `unlock`/`unlockWithBiometrics`, before the
  phase flips; forced false by `lock()` and by onboarding's `createVault`/`adoptRemoteVault`.
- **`hooks/useUnlockReveal.ts`** — Web Animations API, one layout effect on `VaultScreen`'s
  mount. Collects on-screen `[data-reveal]` elements in DOM order: `search` (Windows' top search
  shelf), `row` (list rows and top-of-list items, one slot each), `heading` (shares the next
  row's slot), `panel` (Android's bottom search pill and tab bar, rising together). Uses
  `fill: 'backwards'` so nothing lingers; any `pointerdown`/`keydown`/`wheel`/`touchstart`
  calls `finish()` on everything.
- **`motionTokens.ts`** — `readVaultMotion()`, the shared reader for the `--vault-*` motion
  tokens, used by both this hook and `ShelfOriginPanel.tsx`.
- **`VaultScreen.tsx`** — `revealing` state (`playUnlockReveal && !reducedMotion`, decided at
  mount) and the light layer: a `pointer-events-none` black `z-30` layer over the whole frame
  interior, mounted only until the reveal finishes.
- **Markers** — `data-reveal` on `EntryList.tsx`'s rows, section headings, search band and
  empty-state items, `SyncBadge.tsx`'s `SyncNotice`, and `BottomTabBar.tsx`'s root.
- **Android** — `MainActivity.kt` (`src-tauri/android-ime/`): `setFillLaunchFlag` sets the flag
  on every unlock poll and deletes it on success, on the poll timeout, and when an ordinary
  launch cancels a pending wait. See `MANUAL-FILL-DESIGN.md`'s "Launch flag for the web side".
- **`Unlock.tsx` / `VaultFrame.tsx`** — the exiting Unlock echo (`App.tsx`'s `lingeringUnlock`,
  mounted over `VaultScreen` for `UNLOCK_SEQUENCE_MS`) is transparent below its top bar, and draws
  its frame `bare` (VaultFrame's new prop: layout only, no bezel, shadow or rings). **Don't give
  the exiting echo's root a background again**: it's an opaque full-screen layer above the vault
  for the entire sequence, so the doors open onto its empty frame and the whole reveal plays out
  of sight. That shipped once — the first device build showed no reveal at all — because the
  reveal had only been checked on a page without the Unlock screen and doors layered over it.


Verified in Chromium with a temporary harness running the real `App` (Unlock screen, doors,
`VaultScreen`) on an in-memory fake `Platform`, the sequence slowed 10×, and the doors hidden
with the animations frozen at chosen moments: before the fix, the vault was mounted with every row
in the DOM but only the echo's empty frame was visible; after it, the rows show mid-cascade
under the dimmed interior, and the frame just before the echo is removed matches the one right
after it (no doubled frame shadow, no jump in the header). Also checked with the hook alone: only
on-screen rows animate, and a `keydown` mid-reveal finishes everything with nothing left behind.
**Anything that plays during the unlock sequence must be checked with those real layers stacked
together, not in isolation.** Not verified: the Kotlin (no Android toolchain here — balance-checked
and synced only) and the phone itself — unlock once from the launcher (reveal plays) and once
from the IME's "Unlock Vault" link (it doesn't).
