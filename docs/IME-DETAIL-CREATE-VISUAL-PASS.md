# IME entry detail and new-entry panel — visual pass

**Status: built** with every recommended decision (V1–V5); compiles, not
yet seen on a device (`VERIFICATION.md` §6). "As built" at the end lists
where the build differs from the proposal. A UI design pass on the two IME screens
that show fields: an entry's **detail** view (`buildDetailView`) and the
**new-entry** panel (`buildCreatePanel`). The goal: look like the main
app's entry screens without copying them, and be quicker to read and use.
Measurements below are from the code (320–360dp phone, `BODY_HEIGHT_DP`
492); nothing was seen on a device.

---

## What's wrong today

### Both screens

1. **Actions outweigh content.** Each field is a tall stack — label, value,
   then a row of 40–44dp buttons — so buttons take more area than the data.
   A detail field is ~122dp tall, a new-entry field ~127dp.
2. **They don't fit.** The detail region is 385dp: a Login (header plus
   three fields) needs ~425dp, so the password row sits half off-screen. The
   new-entry region is 431dp: a Login draft needs ~750dp, so it scrolls
   ~320dp.
3. **No hierarchy between actions.** On the detail view, "Show" and "Fill"
   are identical gradient buttons. On the new-entry panel, *every* action
   (Generate, Grab, Pick from Vault, Fill) is the same bright coral pill —
   up to three per row and 10+ on screen, which reads as noise.
4. **Flat table, not grouped.** Full-width 1px lines under the header and
   every field, on one flat surface. The main app groups fields in one
   rounded card with faint inset dividers, which reads calmer and more
   "designed".
5. **Misalignment.** Detail buttons carry `marginStart = 6dp`, so the first
   button sits 6dp right of the label and value above it.
6. **Two shape systems, used arbitrarily.** Detail buttons are 5dp rounded
   rectangles; new-entry buttons are full pills; the new-entry ✕ and Save are
   5dp squares next to pills.

### Detail view

7. The value (15sp regular) is smaller than the app's (16sp medium), and
   quieter than the buttons under it.
8. "Show"/"Hide" is a text button, where the app uses an eye icon; the "hides
   in N s" countdown the app shows isn't there.

### New-entry panel

9. **An empty field shows a large bold "—"** (18sp bold), which looks like
   data rather than "not filled yet".
10. **Values are 18sp bold** — louder than anything else in the keyboard.
11. **Cancel and Save sit side by side** at the right edge; the app's editor
    (and most apps) put Cancel left and Save right.
12. **The subtitle row is cramped**: a two-line hint squeezed beside an
    "Other keyboard" pill.
13. **Doc/code drift:** `ACCOUNT-CREATION-DESIGN.md` says the header has a
    "Type" row to switch the new entry's type (`buildDraftTypeRow`). It was
    never built — the bridge supports it (`listEntryTypes`/`setDraftType`),
    but nothing calls them. Every draft is a Login.

---

## Design principles for this pass

- **Content first.** Label and value are what the user reads; actions go
  to the right edge in a consistent column.
- **One primary action per row** (filled), secondary ones quieter (outline),
  tertiary as text. At most one filled accent button per row.
- **Group fields in a card**, like the app — rounded 10dp, a slightly
  lighter surface, faint dividers inset from the left.
- **Two shapes, with meaning:** keypad *keys* stay 5dp rounded rectangles;
  every *action button* outside the keypad is a pill (radius = half its
  height). That makes "this types" vs "this does something" visible. The
  one exception is the top bar's Lock and Clear, 8dp rounded rectangles by
  direct request (`IME-CONTROLS-REFINEMENT-PLAN.md` item 1).
- **Fit a whole Login without scrolling** on both screens.

## Shared system

**Type scale**

| Role | Size and weight | Color |
|---|---|---|
| Screen title | 16sp medium | `FOREGROUND` / `CREATE_FG` |
| Field label | 11sp semibold, uppercase, 0.06em tracking | detail: `FOREGROUND` at 65% (`#A6D6E4EF`, 4.82:1 on the card); new entry: `CREATE_LABEL` `#B3A69F` (5.42:1) |
| Field value | 16sp medium; monospace for sensitive values | `FOREGROUND` / `CREATE_FG` |
| Empty value | 16sp regular, "Not set" | the field-label color |
| Helper / meta | 12sp regular | label color |
| Button text | 13sp semibold | per button |

The 60%-alpha muted text used elsewhere measures only 4.38:1 on the new
card surface, hence 65% here.

**Spacing:** 4 / 8 / 12 / 16. Screen edge 12dp to the card, 16dp inside
it; the icon, labels and values share one left edge.

**Buttons (all 40dp tap areas — the IME floor)**

| Kind | Look | Used for |
|---|---|---|
| Primary | filled pill: neutral gradient on detail, coral on new entry | Fill (detail), Generate, Save |
| Secondary | outline pill, 1.5dp | Grab, Pick, Keep editing |
| Mode | outline pill, never filled or raised; "on" shown by an accent outline, accent text and a check, or, in a two-way switch, by the chosen half's light fill | Fill format (detail), character classes (generator) — `IME-CONTROLS-REFINEMENT-PLAN.md` |
| Tertiary | text only, accent color | Fill (new entry), Switch keyboard, Dismiss |
| Icon | 40×40, no background | Show/hide (eye), Cancel (✕) |
| Danger | outline pill, `#EC7777` (5.15:1+) | Discard |

Fixed-width primary pills in a row (e.g. detail "Fill", 64dp) so they line
up in a column down the card.

## Entry detail

- **Header** (56dp, no divider): icon 32dp, title 16sp medium, and under it
  "Login · paul@example.com" (type label plus the row subtitle, confirming
  which account it is).
- **Fields in one card:** 12dp from the edges, `#313942` (the app's
  `rgba(77,87,97,.4)` over `CARD`), 10dp radius, dividers 1dp at 8%
  foreground, inset 16dp from the left.
- **Row (60dp min):** label above value on the left; on the right, the eye
  icon button (sensitive fields only), then **Fill** (primary, 64dp wide).
  Revealing shows the value in monospace and "· hides in 8s" after the label.
- **Card number and expiry:** a two-way mode switch under Fill,
  right-aligned with it: "Whole · 4 parts" (in parts, Fill reads "Fill
  1/4" … "Fill 4/4") and "MM/YY · YY/MM". Spec in
  `IME-CONTROLS-REFINEMENT-PLAN.md` item 2.
- **Empty value:** "Not set"; its Fill is hidden rather than shown disabled.
- **More fields:** the last row of the card, 44dp, "More fields (2)" with a
  chevron that rotates when open.
- **Budget:** header 56 + card (3 × 60 + 44 + dividers) ≈ 290dp of 385 —
  a Login fits with room to spare.

## New entry

- **Header** (56dp): **✕** icon button on the left (Cancel); title (the
  guessed name, 16sp medium) with the **type** under it as a tappable "Login
  ⌄" (opens the type list — see below); **Save** (coral primary pill) on the
  right.
- **Helper line** (44dp): "Type the rest with your usual keyboard." and a
  tertiary **Switch** (keyboard icon) — replaces the cramped subtitle plus
  "Other keyboard" pill.
- **Fields in one warm card:** `CREATE_CARD` `#36312E`, a step lighter
  than the panel (colors from `IME-CREATE-PALETTE-MUTE-PLAN.md`), 10dp radius, `CREATE_BORDER` dividers inset 16dp.
- **Row (60dp min):** label and value on the left ("Not set" when empty);
  on the right, one primary or secondary action plus at most one tertiary:

| Field | Right side |
|---|---|
| Password | **Generate** (coral primary); **Fill** (text) once it has a value |
| Email | **Pick** (outline); **Fill** (text) once set; Grab moves into the Pick list as its first row, "Use what's in the field" |
| Other text fields | **Grab** (outline); **Fill** (text) once set |

- **Password strength:** a 3dp bar under the value (full row width, color by
  score) with the word at its right — replaces the separate five-segment
  block. "Weak" is in `DANGER` rather than the bar's red, which is too dark
  for text (3.4:1).
- **Generator panel:** opens inside the card under the Password row, on a
  slightly darker inset (`CREATE_BG`), 12dp padding: "Length 20" with the
  slider; the four character-class toggles (40dp mode controls: accent
  outline and a check when on, plain outline when off, never filled); **Regenerate** as a text button with a refresh icon; "Done" top right.
- **Saved-email list:** inside the card under the Email row, 44dp rows with
  inset dividers, at most four visible. First row "Use what's in the field"
  (Grab).
- **Type list:** tapping "Login ⌄" opens the entry types inline in the card
  area (same pattern as the email list), picking one calls `setDraftType`
  (which resets the fields, per `ACCOUNT-CREATION-DESIGN.md`) — this builds
  the Type selector that doc already describes.
- **Callouts** (grab-on-return offer, "saved to this entry, tap Fill"
  notice): a tinted strip above the card — coral at 10% with a 3dp coral
  bar on the left (square corners) — instead of another full-width bordered
  row. The offer's field choices are outline pills; Dismiss is text.
- **Discard confirmation:** replaces the header — the question on one line,
  **Keep editing** (secondary) and **Discard** (danger outline).
- **Save confirmation:** centered in the panel — a 40dp check in a coral
  ring, then the message.
- **Budget:** header 56 + helper 44 + card (4 × 60 + 68 + dividers) ≈
  415dp of 431 — a Login draft fits; opening the generator or email list
  scrolls, as it should.

## Decisions (recommendation first)

| # | Question | Recommendation |
|---|---|---|
| V1 | Pills for every action outside the keypad (detail's Fill included), 5dp rectangles only for keys? | **Yes** — shape then signals "action" vs "key" |
| V2 | Build the new entry's type selector (documented, never built)? | **Yes**, inline list as above |
| V3 | Move Cancel (✕) to the left of the new-entry header, away from Save? | **Yes** — convention, and it separates the destructive control from the confirm |
| V4 | Detail "Show/Hide" becomes an eye icon (spoken label kept)? | **Yes** — matches the app, frees width for the Fill column |
| V5 | Email's Grab moves into its Pick list? | **Yes** — keeps one visible action per row; the alternative is two outline pills on that row |

## As built

Where the implementation differs from, or adds to, the proposal above:

- **Detail Fill pills are 84dp wide, not 64** — wide enough for the
  "Filled!" state with its check glyph, so the column doesn't jump.
- **Card number and expiry** get a mode switch under Fill (see above; no
  "⇄" glyph — text characters render differently per device). Once all
  four card parts are in, Fill reads "Filled" (disabled) for 1.5s.
- **An empty value's Fill is hidden** (not shown disabled).
- **The reveal countdown** ("· hides in Ns") counts down with the
  keyboard's 2-second refresh, so in 2-second steps.
- **The new entry's Password row also has an eye** to show or hide the
  draft value, with no auto-hide. A generated password starts shown
  (`IME-CONTROLS-REFINEMENT-PLAN.md` item 3). `ACCOUNT-CREATION-DESIGN.md`
  listed this Show/Hide as lost from the Kotlin; it's back, as the same
  eye the detail view uses.
- **The type list replaces the field card while open** (tap the type under
  the title again, or pick one, to close it). The current type is checked;
  a note warns that changing the type clears what's filled in, when
  anything is.
- **"Switch keyboard"** (keyboard glyph) replaces the "Other keyboard"
  pill; it returns to the keyboard the user came from.
- **Callouts** also carry the "Nothing to grab…" and "saved to this entry,
  tap Fill" notices.
- **Button builders:** `smallActionButton` (result-row Fill, "Save new
  login…") is now a pill too; new `detailFillButton`, `textButton`,
  `iconButton`, `createOutlineButton(color)`, `fieldCard`, `cardDivider`,
  `fieldLabel`, `buildCallout`; `withCreateBorder` is gone. New drawables
  `ic_eye`, `ic_eye_off`, `ic_keyboard`, `ic_chevron_down`.

## Scope and verification

Only `VaultKeyboardView.kt`'s detail/new-entry builders, their button
helpers (`smallActionButton`, `createPillButton`, `createOutlineButton`,
and the generator's character-class toggle, now `modeToggle`), and two small drawables (`ic_eye`, `ic_eye_off`,
transcribed from `icons.tsx`). No bridge changes except wiring the existing
`listEntryTypes`/`setDraftType`. Keypad, search screen and top bar are
untouched. `MANUAL-FILL-DESIGN.md`, `ACCOUNT-CREATION-DESIGN.md`,
`ime-ux-redesign-proposal.md`, `ime-visual-parity-plan.md`,
`ime-layout-v2-and-grab-design.md`, `email-suggestions-design.md` and
`VERIFICATION.md` are updated to match. Needs an on-device look before it's
called done.
