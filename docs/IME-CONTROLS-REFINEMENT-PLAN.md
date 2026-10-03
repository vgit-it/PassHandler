# IME controls refinement — plan

**Status: built** with every recommended decision (R1–R6); compiles, not
yet seen on a device (`VERIFICATION.md` §6). "As built" near the end lists
the details the build settled.

Four requested changes to the Android keyboard (`VaultKeyboardView.kt`),
plus the follow-on changes they imply elsewhere in the keyboard:

1. Lock and Clear get 8dp shorter.
2. The fill-format controls (card number in parts, expiry MM/YY) look like
   a **mode switch**, not text, and sit with the Fill button.
3. A generated password in the new-entry panel is **shown by default**.
4. The generator's character-class buttons use an **unfilled** look, so
   they read as settings rather than actions.

---

## A new button kind: "mode"

Items 2 and 4 are the same idea. They are settings that change what an
action does; they don't act themselves. Today they borrow the look of text
links (the fill formats) or of the primary button (character classes that
are on). Both get one shared look, added to the button table in
`IME-DETAIL-CREATE-VISUAL-PASS.md`:

| Kind | Look | Used for |
|---|---|---|
| **Mode** | no fill and no shadow; an outline pill. "On" is marked by an accent outline, accent text and a check, or, in a two-way switch, by the chosen half having a light fill. | Fill format (detail), character classes (generator) |

What sets it apart from what's already there:
- **Primary** (Fill, Generate, Save) is filled and, on the detail view,
  raised. A mode control is never filled or raised.
- **Secondary** (Grab, Pick) is an outline pill with one label that does
  something on tap. A mode control always shows its current state (a
  check, or which half is chosen).

## 1. Lock and Clear: 32dp rounded rectangles

- **Look:** each is drawn **32dp** tall (was 40), so the 44dp top bar
  shows **6dp** of bar above and below it (was 2dp).
- **Tap area stays 40dp.** The view keeps its 40dp height; only its
  background is inset 4dp top and bottom (an `InsetDrawable` around the
  gradient shape). The IME's 40dp touch-target floor is about where a
  finger can land, not about what's drawn, so it still holds.
- **Shape:** a rounded rectangle, radius 8dp (`TOP_BAR_BUTTON_RADIUS_DP`),
  by direct request — the one exception to "every action button outside
  the keypad is a pill" (visual pass V1). 8dp rather than a key's 5dp, so
  they still don't read as keys.
- **The bar stays 44dp**, so the keyboard's height, `BODY_HEIGHT_DP`, and
  every screen's layout are unchanged.
- **Content:** the Lock icon (18dp) and the 12sp labels fit in 32dp; the
  horizontal padding and the 40dp minimum width are unchanged.

## 2. Fill format as a mode switch, beside Fill

On the entry detail view, under the Fill button and right-aligned with it,
a **two-way switch** chooses how Fill types the value:

| Field | Switch | What Fill does |
|---|---|---|
| Card number | **Whole · 4 parts** | Whole: all 16 digits. 4 parts: one group of 4 per tap, labelled "Fill 1/4" … "Fill 4/4" |
| Expiry | **MM/YY · YY/MM** | types the digits in the chosen order |

- **Replaces** the text buttons "Fill part N of 4" and "Format: MM/YY"
  under the value. For the card number, "in parts" becomes a setting of
  Fill instead of a second fill action beside it, so each row has one fill
  action.
- **Placement:** below the Fill button (there isn't room beside it at
  320dp once the eye and Fill are there). It's a fixed 124dp wide
  (the eye plus Fill), right-aligned to the Fill button's right edge. The
  row's left column (label and value) stays top-aligned.
- **Look (mode kind):**
  - The track is a 1dp `BUTTON_BORDER` outline pill with no fill.
  - The chosen half has a light fill (`#3F4A55`) with `FOREGROUND` text in
    medium weight (7.1:1). The other half is plain, in `DETAIL_LABEL`
    text (4.8:1).
  - Text is 12sp; the expiry labels are monospace so the two orders line
    up.
  - Drawn 32dp tall inside a 40dp tap area, the same way as Lock and
    Clear.
- **Row height:** about 100dp for these two rows (8 + Fill 40 + 4 + switch
  40 + 8), up from 60. Only Card entries have them. A Login is unaffected,
  and a Card's detail may now scroll a little.
- **4 parts mode:**
  - Each tap types the next group, and the label advances to "Fill 2/4".
  - After the fourth group: the Tab/password check, as today, then
    "Filled" (disabled) for `FILLED_REVERT_MS`, then back to "Fill 1/4".
  - Switching modes resets the count to part 1.
- **State:**
  - The card mode (`cardFillInParts`, new) and the expiry order
    (`expiryFormatSwapped`) are view state, never saved.
  - Both reset when another entry opens, as `cardChunkProgress` and
    `expiryFormatSwapped` do now.
  - Default: Whole, MM/YY.
- **Empty value:** no Fill, so no switch either.
- **Accessibility:**
  - Each half is its own control, announced as, for example, "Fill as 4
    parts, not selected".
  - It sets `isSelected`, and also `stateDescription` from API 30.

## 3. A generated draft password is shown

- When Generate (or Regenerate, a length change or a character-class
  change) produces a password, its row **shows it in plain text**
  (monospace), with the eye in its "hide" state. The user sees what was
  made; the host's password field only shows dots.
- **No auto-hide timer.** It stays shown while the user adjusts the
  generator. The eye hides it, and the next regeneration shows it again.
  The main app's generator (`PasswordField.tsx`, `setRevealed(true)` on
  every regenerate) behaves the same way.
- **Only generated values start shown.** A password that came from
  **Grab** or from grab on return was typed by the user, so it starts
  masked until the eye is tapped.
- **No draft reveal auto-hides.** The visual pass gave the draft eye a 10s
  auto-hide. That contradicts `ACCOUNT-CREATION-DESIGN.md`, which
  deliberately has none: a draft is being edited, not viewed, and the
  app's editor has no timeout either. The timer goes, so a draft value
  shown by generating and one shown with the eye behave alike.
- **Unchanged:**
  - The detail view's saved values stay masked by default. Those are
    stored secrets, looked up on demand; this is a password the user is
    in the middle of choosing.
  - The window is `FLAG_SECURE`, so neither shows in screenshots or
    recordings.
- **Code:**
  - `generateDraftPasswordField` and `applyPasswordOptions` add the field
    to `revealedDraftFields` when a password comes back.
  - `toggleDraftReveal` loses its delayed re-mask.
  - `revealedDraftFields` is still cleared wherever a draft ends or
    restarts, as now.

## 4. Character-class toggles: unfilled

In the generator panel, `A-Z` `a-z` `0-9` `!@#`:

| State | Look |
|---|---|
| On | 1.5dp `CREATE_ACCENT` outline, `CREATE_ACCENT` text (7.7:1 on the panel), a 14dp check before the label |
| Off | 1dp `CREATE_BORDER` outline, `CREATE_LABEL` text, no check |
| On, but the last one on | the On look at 70% opacity, not tappable (unchanged rule) |

- No gradient fill in any state. Filled coral is now only Save and
  Generate, the two things that act.
- Still 40dp tall, four to a row at equal widths; the check plus a
  three-character monospace label fits in ~68dp at 320dp.
- Announced as, for example, "Uppercase letters, on".

## Other places that follow from this

Checked across the keyboard:

- **Keypad `123`/`ABC` key:** also a mode switch, but it's a key, and keys
  keep the key shape (V1). No change.
- **Type list:** it already marks the current type with a check, which
  matches the mode look. No change.
- **Detail eye** and **draft eye:** icon buttons, which already show their
  state (eye / struck-through eye). No change beyond item 3's default.
- **Strength bar:** now sits under a visible password, which makes it
  easier to read. No change.
- **"Saved to this entry, tap Fill" notice** (a password generated while
  another field has focus): the password now shows in its row, so the
  notice is easier to act on. Wording unchanged.
- **`smallActionButton`'s `toggle` look:** nothing passed `toggle = true`
  any more, so the parameter and its styling were dead code. Removed.
- **Grab after Generate:** a Password row showing a generated value that
  is then replaced by Grab (or grab on return) goes back to masked, since
  the new value was typed by the user.
- **Height:** the top bar and `BODY_HEIGHT_DP` are unchanged, so nothing
  jumps between screens. Only a Card's detail rows get taller (item 2).

## Decisions (recommendation first)

| # | Question | Recommendation |
|---|---|---|
| R1 | Lock/Clear: draw 32dp but keep a 40dp tap area, or make the tap area 32dp too? | **Draw 32, tap 40** — keeps the documented floor; the bar stays 44dp |
| R2 | Lock/Clear shape? | **Rounded rectangle, 8dp** — by direct request (they were briefly full pills) |
| R3 | Card number: a Whole / 4 parts mode that changes Fill, or keep a separate "next part" button styled as a mode? | **A mode** — one fill action per row; the label shows progress |
| R4 | Mode switch below Fill, or beside it? | **Below** — beside doesn't fit at 320dp without squeezing the value |
| R5 | Generated password: shown until hidden, or shown for 10s? | **Until hidden** — matches the main app; the user is still choosing it |
| R6 | Drop the draft eye's 10s auto-hide too? | **Yes** — it contradicts the account-creation design's own reasoning, and one rule for the draft is simpler |

## Build order

1. Remove the unused `toggle` look from `smallActionButton` (no visible
   change).
2. Lock and Clear at 32dp.
3. The mode look, then use it for the character-class toggles.
4. The generated password shown by default.
5. The fill-format switch on the detail view.

After each step, run the Kotlin compile (`./gradlew
:app:compileArm64DebugKotlin -x rustBuildArm64Debug` in
`src-tauri/gen/android`, after `npm run android:sync-ime`). No JS or bridge
changes. Check on a device using the list in `VERIFICATION.md` §6.

## The + key

By direct request, the keypad's **+** (Add entry) key gets a light coral
hue, not too strong:
- **Gradient:** the neutral key gradient warmed toward coral (`ADD_KEY_TOP`
  `#4a4240` to `ADD_KEY_BOTTOM` `#3d3431`).
- **Border:** warm (`ADD_KEY_BORDER` `#6b5047`).
- **Glyph:** the create panel's light coral (`ADD_KEY_GLYPH` `#D6B0A0`,
  = `CREATE_GRADIENT_TOP`; 6.1:1 on the key).

It hints that "+" leads to the coral create panel. It stays the same size
and shape as any key, and is nothing like the old half-width, fully coral
"Add Entry" key (`IME-UX-REVIEW.md` C5), which was the most prominent
control on a screen whose job is filling. Don't strengthen the tint back
toward that.

## As built

- **Shared pieces:**
  - `COMPACT_PILL_HEIGHT_DP` (32) sets how tall these controls are drawn.
  - `insetPill` wraps a pill in an `InsetDrawable`, so it's drawn 32dp
    inside a 40dp view. The elevation shadow follows the drawn pill.
- **Lock and Clear:** 8dp corners. Clear's side padding is 12dp (was
  10dp).
- **Fill-format switch** (`buildModeSwitch`):
  - It's `MODE_SWITCH_WIDTH_DP` wide (40 + 84 = 124dp).
  - The chosen half is filled with `MODE_SELECTED_FILL` (`#3F4A55`), 2dp
    inside the track's outline.
  - Tapping the half that's already chosen does nothing.
  - On these two rows the label and value move to the top of the row, 2dp
    down so they're level with Fill; other rows stay centered as before.
  - In 4 parts, Fill's spoken label is "Fill part N of 4".
  - The card mode is `cardFillInParts`.
- **Character-class toggles** (`modeToggle`): a row holding a check icon
  and a label, not a `Button` with a compound drawable, so the check sits
  beside the label rather than at the chip's edge. `describeModeState`
  gives both mode controls their spoken state.
- **Generated password:**
  - `applyPasswordOptions` now takes the field key.
  - `revealedDraftFields` still clears when the keyboard is shown again
    (`start()` → `closeDraftPanels`), so a reopened keyboard starts
    masked.

## Docs

Updated to this design:
- `CLAUDE.md` (touch-target convention)
- `ime-ux-redesign-proposal.md` ("Touch targets", top bar)
- `IME-DETAIL-CREATE-VISUAL-PASS.md` (button table, detail rows,
  generator, as-built notes)
- `MANUAL-FILL-DESIGN.md` (field rows)
- `ime-layout-v2-and-grab-design.md` (card number)
- `ACCOUNT-CREATION-DESIGN.md` (show/hide, generator)
- `SECURITY.md` (generated password shown)
- `VERIFICATION.md` §6
