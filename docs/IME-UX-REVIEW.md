# Android IME — UX, layout and controls review

Scope: the manual-fill keyboard (`VaultKeyboardView.kt`, `VaultIme.kt`,
`QuickFillRanking.kt`) in every state: loading, locked, search, entry detail,
account creation. Reviewed as an interaction/visual designer (is each
screen clear, well-proportioned, accessible?) and as a product designer
(does the flow get the user from "I'm on a login form" to "I'm signed in"
with as little friction and risk as possible?).

**Method, and its limit.** No device or emulator was available, so nothing
here was *seen*. Visual findings come from the layout code: heights are
summed from the dp constants and padding, and contrast ratios are computed
(WCAG 2.1) from the palette constants. Anything that depends on rendering
should be checked in `VaultImePreviewActivity` before acting on it.

Severity: **Critical** (can lose data or leak credentials), **High**
(breaks or badly slows the main task), **Medium** (friction or confusion),
**Low** (polish).

The implementation plan for every finding here is
[IME-UX-IMPROVEMENT-PLAN.md](./IME-UX-IMPROVEMENT-PLAN.md). ✅ marks a finding
that's been built (not yet device-verified — see `VERIFICATION.md`).

---

## Layout anatomy (measured from code)

| State | Parts, top to bottom | Approx. height |
|---|---|---|
| Loading | "Loading…" text, 32dp padding top and bottom | ~83dp |
| Locked | "Vault" header (~34) · Unlock strip (90) · bottom inset (48) | ~172dp |
| Search | top bar (45) · results (120) · search box (65) · divider (5) · keypad (208) · bottom inset (48) | **~491dp** |
| Detail | top bar (45) · results (300) · "New search" row plus padding (66) · inset (48) | ~459dp |
| Create | top bar (45) · results (340) · empty keypad padding (16) · inset (48) | ~449dp |

For reference, Gboard with its suggestion strip is about 260–300dp.

- ✅ **L1 — High. The results area shows about 1.3 rows.**
  `SEARCH_HEIGHT_DP = 120` (commented "~2.5 rows"), but a result row is
  16 + 36 + 16 = 68dp tall plus 5dp margins, so each takes 78dp. Under the
  "Recent" label (~25dp) you see one row and a 17dp sliver; `RECENTS_LIMIT
  = 3` is never fully visible.
- ✅ (partly — see the plan's Phase 3 notes: the keypad is compact and the results area three times bigger, but the total is about the same) **L2 — High. The keyboard is about 491dp tall.** That's roughly 60% of a
  typical phone. It hides the form being filled and the submit button.
- ✅ **L3 — Medium. The bottom inset is hard-coded.** `BOTTOM_INSET_DP = 48`
  instead of reading the real value from `WindowInsets`. Now read from
  `WindowInsets`, but floored at 48dp (`BOTTOM_CLEARANCE_DP`): the 48dp was
  not wasted with gesture navigation, since Android draws its
  hide-keyboard and switch-keyboard buttons in that strip while a keyboard
  is up. The floor only matters where the reported inset is smaller.
- ✅ **L4 — Medium. The height jumps on every open and screen change.** Each
  open goes Loading ~83 → ~491; opening an entry, Add Entry and Lock each
  change it again. Every jump makes the host app re-lay out its page, so the
  form moves under the user.
- ✅ **L5 — Low. Rounded shapes don't agree.** Circle plates beside
  rounded-square favicons; corner radii of 5, 10 and 18dp on neighbouring
  controls.

## Product and flow

- ✅ **P1 — High. Result rows show only a title.** The app shows the username
  under it (`rowSubtitle`); two accounts on one site can't be told apart.
- ✅ **P2 — High. The first use in any app shows nothing.** "Recent" needs a
  previous fill *from this app*. The app's name is already resolved
  (`resolveTitleGuess`) but only the create flow uses it. In browsers, every
  site shares one list.
- ✅ **P3 — High. The open entry carries over between apps.** Session
  persistence ignores `callingPackage`, so another app's entry opens with
  its Fill buttons live.
- ✅ **P4 — Critical. Cancelling a draft orphans a password already written to
  the site.** Generate types into the host field right away. "‹" and "✕"
  both discard the draft with no confirmation, and "‹" looks like "back".
- ✅ **P5 — High. Generate, the generator settings and pick-email write into
  whatever field has focus.** Focus on the username field means it gets
  wiped and the password is typed there in plain view.
- ✅ **P6 — Medium. The locked view is small and unexplained.** There's no
  message and no way to switch keyboards, and its height differs from every
  other state.
- ✅ (switch key, "Other keyboard" and grab on return; typing into the page stays rejected) **P7 — High. You can't type into the page.** Signing up means switching
  keyboards, typing, switching back, and tapping Grab, for every field.
- ✅ **P8 — Medium. "Done" saves silently.** It saves and switches the
  keyboard away with no confirmation.
- ✅ **P9 — Medium. The automatic password fill after Tab is invisible.** Tab
  also fires after the last field. There's no one-tap "fill login".
- ✅ **P10 — Medium. The keyboard never shows which app it's filling into.**
  The top bar's centre is decoration only.
- ✅ (evaluated — [AUTOFILL-FRAMEWORK-EVALUATION.md](./AUTOFILL-FRAMEWORK-EVALUATION.md); not adopted) **P11 — Strategic.** Most of the remaining friction comes from not using
  the Android Autofill Framework. Worth evaluating, with the IME as a
  fallback.

## Controls

- ✅ **C1 — Medium. The keypad costs 208dp and has no symbols.** There's no
  `@ . - _`, so "t-mobile" or an email address can't be searched. (Mixing
  digits and letters does work, via the 123/ABC toggle, which keeps the
  query.)
- ✅ **C2 — Medium. Clearing a search is tedious.** Backspace doesn't repeat
  when held, and there's no ✕ in the search box.
- ✅ **C3 — Low/Medium. "New search" returns to the *old* search.** There are
  also three ways back from an entry.
- ✅ **C4 — Medium. There's no switch-keyboard key in any state.**
- ✅ **C5 — Medium. "Add Entry" is the most prominent control on a screen whose
  job is filling.**
- ✅ **C6 — Low/Medium. Clear wipes the host field with no undo.**
- ✅ **C7 — Low/Medium. The green closed padlock mixes up state ("unlocked")
  and action ("tap to lock").**
- ✅ **C8 — Low. Some labels are unclear.** "Split 0/4" reads as a counter;
  the "MM/YY" toggle is drawn like an action button.
- ✅ **C9 — Low. Disabled buttons barely look disabled.**
- ✅ **C10 — Low. ‹ ✕ ✓ ⌫ are font characters, not icons.** They render
  differently from one manufacturer to another.

## Content

- ✅ **The detail header shows internal type ids** ("SecureNote",
  "LicenseKey"). Bug.
- ✅ **Capitalisation is mixed** ("Add Entry" vs "New search").
- ✅ **The create subtitle says "then Done"** for an unlabelled ✓ button.
- ✅ **"No matches." is a dead end.**
- ✅ **URL and Notes sit among the fields you'd actually fill,** below the
  visible area.

## Accessibility

- ✅ **A1 — Medium. Muted 11–12sp text fails AA contrast.** Measured:

  | Text | Contrast | Needs |
  |---|---|---|
  | Muted text on `CARD` | 4.11:1 | 4.5:1 |
  | Placeholder on `BACKGROUND` | 3.90:1 | 4.5:1 |
  | "Add Entry" label | 4.14:1 | 4.5:1 |

  This contradicts `UI-UX-REVIEW.md`'s older "all pass AA", measured before
  muted text became 50% alpha.
- ✅ **A2 — Low. Missing labels and small key text.** The detail "‹" and "⌫"
  have no spoken label; key labels are 14sp.
- ✅ **A3 — Low. Some create-panel controls are under the 40dp floor.** The
  generator toggles and pill buttons are 36dp.

## Trust and safety

- ✅ **T1 — High. The IME window lacks `FLAG_SECURE`.** Values revealed with
  "Show" and the entry list can be screenshotted or recorded.
- ✅ **T2 — High. The cross-app carry-over (P3) is a privacy leak.**
- ✅ **T3 — Medium. P5 can leave a password in plain view in a non-password
  field,** where the site may save it to its own autofill history.

## Working well — keep

- **Fails closed** when the vault is locked, and the 2s poll notices a lock
  quickly.
- **Secrets are fetched only when used** and hidden again after 10s.
- **Clear fill feedback** ("✓ Filled!").
- **Masked fields fill correctly** (character by character, card numbers in
  groups, the expiry format toggle).
- **Forgiving search** with per-app frecency and typo tolerance.
- **Creating the entry at signup time** is a strong idea.
- **Lock and Clear on every screen.**
- **Visual parity with the app.**
