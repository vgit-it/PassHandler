# Main app entry creation — the IME's muted palette

**Status: built** with every recommended decision (P1–P5). Typecheck,
lint and tests pass. The compiled CSS was diffed to confirm the rest of
the app is unchanged (see "As built"). Not yet seen in the running Android
app (`VERIFICATION.md`).

The keyboard's new-entry panel now uses a muted warm-grey and soft-coral
palette (`IME-CREATE-PALETTE-MUTE-PLAN.md`). This brings the main app's
own entry-creation flow onto the same palette, so creating an entry looks
the same in the app and in the keyboard. **Colors only:** no layout,
spacing, size, shape, type or behavior changes.

---

## The flow, and what it looked like before (Android)

| Step | Where | Before |
|---|---|---|
| 1. "+" on Home | `BottomTabBar.tsx` | strong coral/bronze gradient `#bb8c7a`→`#ac6e55`, border `#b98d7c`, glyph `#241a16` |
| 2. Pick a type | `TypePicker.tsx` | warm brown wall (`ENTRY_CREATION_WALL_GRADIENT`, `#241a16`→`#191513`, the IME's *old* background); cool `#d6e4ef` text and icons; a navy search pill (`#1f252d`, `#4d5761`) |
| 3. Fill in the entry | `EntryEditor.tsx` plus its fields: `PasswordField`, `EmailSuggestInput`, `DateFieldWithRenewal`, `DateInput`, `MonthYearInput`, `Toggle` | the same warm brown wall, but every field, label and button is the app's navy-and-blue system (`ink-*`, `slate-*`, `accent` `#4a9ee0`, `primary` `#8fadc7`) |

So the flow was three palettes at once: a strong coral button, a brown
wall, and navy/blue controls on top of it.

## Target palette

The IME's values, mapped onto the app's own color roles:

| Role | App token(s) | App default | In the creation flow |
|---|---|---|---|
| Wall | `ENTRY_CREATION_WALL_GRADIENT` | `#241a16` → `#191513` | `#2A2725` → `#201E1D` |
| Page background, focus-ring offset | `ink-950` / `ink-900` | `#070e19` / `#0c1827` | `#201E1D` / `#262321` |
| Field and panel surface | `ink-800` / `ink-750` | `#111e2e` / `#142238` | `#36312E` / `#3A3532` (the IME's card) |
| Raised and hover surface | `ink-700` / `ink-600` | `#1a2d44` / `#1e3457` | `#403A37` / `#4A433F` |
| Field border | `ink-500` | `#264670` | `#5A514C` |
| Title and value text | `slate-100` / `slate-200` | cool greys | `#F2EDEA` / `#E6DFDB` (the IME's off-white) |
| Secondary text | `slate-300` | | `#D2C8C3` |
| Labels, placeholders, ghost buttons | `slate-400` | | `#B3A69F` (the IME's label) |
| Accent (links, focus ring, on toggles, selected, checkboxes, slider) | `accent` / `accent-muted` | `#4a9ee0` / `#3d6ebc` | `#D1A594` / `#A88576` |
| Primary button (Save) | `primary` / `primary-foreground` | `#8fadc7` / `#0c1827` | `#D1A594` / `#2A2725` |
| Error text and borders | `bad` | `#e05252` | `#EC7777` (the IME's `DANGER`) |
| Type-picker text and icons | literal `#d6e4ef` (at 100/80/60/50%) | cool off-white | `#F2EDEA` at the same opacities |
| Type-picker search pill | literal `#1f252d`/70, `#4d5761`/70 | navy | `#36312E`/70, `#5A514C`/70 |
| Password field focus glow | literal `rgba(74,158,224,.35)` | blue | accent at 35% |

`ok` and `warn` are unchanged: they carry meaning (strength, renewal
warnings), as in the IME.

**The "+" button** (the user asked for this first) gets the IME's Save and
Generate gradient, `#D6B0A0` → `#BC907E`, with a `#C9A291` border and a
`#2A2725` glyph (5.25:1). Same shape, shadow and press motion as today.

**Contrast (text, AA):**

| Pair | Ratio |
|---|---|
| `slate-100` on a field (`#F2EDEA` on `#36312E`) | 11.0 |
| `slate-400` label on the wall (`#B3A69F` on `#2A2725`) | 6.3 |
| `slate-400` on a field | 5.4 |
| `accent` link on the wall | 6.7 |
| Save text on `primary` (`#2A2725` on `#D1A594`) | 6.7 |
| `bad` error text on the wall | 5.3 (today's `#e05252` would be 3.9) |
| "+" glyph on the gradient's darker stop | 5.25 |

The final contrast check is part of the build.

## How: one scoped palette, not per-element edits

The flow's fields are shared components that use the app's Tailwind
tokens everywhere (`bg-ink-800`, `text-slate-400`, `ring-accent`, …), and
the editor screen is also used to edit existing entries. Recoloring them
class by class would mean dozens of `isAndroid ? … : …` branches across
eight files, and would drift as soon as someone adds a field.

Instead:
1. **The colors become CSS variables.** In `tailwind.config.js`, `ink`,
   `primary`, `accent`, `bad` and the `slate` steps the flow uses
   (100–400) become `rgb(var(--…) / <alpha-value>)`. Opacity modifiers
   like `bg-accent/15` keep working. `:root` in `index.css` holds today's
   exact values, so **nothing outside the flow changes**: every other
   screen compiles to the same colors.
2. **One class switches the palette.** A `.palette-create` rule in
   `index.css` redefines those variables with the values above. The Type
   Picker's and the editor's root elements get it on Android, so
   everything inside picks up the warm palette, including future fields.
3. **The literal hexes inside the flow** (the Type Picker's `#d6e4ef`
   family and search pill, the password field's focus glow, the wall
   gradient) switch to the new values directly, or to the variables.
4. **The "+" buttons** change their literal gradient classes.

The `--vault-*` tokens are already CSS variables and aren't used inside
the flow, so they're untouched.

## Decisions (recommendation first)

| # | Question | Recommendation |
|---|---|---|
| P1 | Android only, or Windows too? | **Android only.** The warm wall and the coral "+" are Android-only today. Windows' flow is on the `ink` system and its "+" follows the vault spec's single accent (§3.7). Moving Windows over is the same switch later, if wanted |
| P2 | The editor is also the *edit existing entry* screen. Recolor it there too? | **Yes.** It's one screen, and on Android it already shares the creation wall in both modes. Making only new entries warm would give editing a warm wall with navy fields, as now |
| P3 | The pick-mode "+" (`EntryList.tsx` FAB) matches the Home "+"? | **Nothing to change**: building it showed the FAB is Windows-only (`EntryList.tsx` renders it only off Android; a comment in `VaultScreen.tsx` said otherwise and is corrected). Android's only "+" is the tab bar's |
| P4 | How to apply it: CSS variables plus one scope class, or per-element Android branches? | **CSS variables plus one scope class**, as above: colors only, no drift, and no change anywhere else |
| P5 | Error red becomes `#EC7777` inside the flow? | **Yes.** `#e05252` is ~3.8:1 on the warm wall, too low for error text |

## As built

- **Proving the rest of the app didn't change:**
  - The CSS was compiled before and after the change.
  - In the new build, each new variable was replaced with its `:root`
    value, color spellings were normalized, and the two builds were
    diffed.
  - Outside `.palette-create`, the only differences are the intended
    literal classes: the "+" gradient, the Type Picker's off-white and
    search pill, and the password glow, which now reads `--accent`.
  - A deliberate one-digit change to a variable showed up in the diff, so
    the check does catch changes.
- **Visual check:** a static page using the compiled CSS and the
  components' own markup (Home "+", Type Picker, editor with an error, the
  password generator, a toggle). The app can't run in a plain browser, and
  the Windows build isn't recolored (P1).
- **Names:**
  - `ENTRY_CREATION_PALETTE_CLASS` (`'palette-create'`, exported from
    `TypePicker.tsx` next to `ENTRY_CREATION_WALL_GRADIENT`).
  - The CSS variables `--ink-*`, `--primary`, `--primary-foreground`,
    `--accent`, `--accent-muted`, `--bad`, `--slate-100`…`--slate-400`.
- **The "+" border** is `#C9A291`, between the two gradient stops, like
  the old border sat relative to its stops.

## Build

- **Files:**
  - `tailwind.config.js` and `index.css`: the variables, `:root` values
    and the `.palette-create` rule.
  - `TypePicker.tsx`: the scope class, the wall, the literal hexes.
  - `EntryEditor.tsx`: the scope class.
  - `PasswordField.tsx`: the focus glow.
  - `BottomTabBar.tsx`: the "+" button. `VaultScreen.tsx`: a stale comment about the FAB.
- **Checks:**
  - `npm run typecheck`, `npm run lint`, `npm run test`.
  - Build the CSS and confirm that, outside the scope, every changed
    utility compiles to the same color as before.
  - A visual pass in the running app: Home "+", the Type Picker, a new
    Login, a Card (month/year), an entry with a renewal date, the password
    generator, an email suggestion list, a validation error, and editing
    an existing entry.
- **Docs updated:**
  - This one is now marked built.
  - `CLAUDE.md` (the variable-backed tokens and the scope class).
  - `vault-visual-overhaul-plan.md` (the "+" recipe).
  - `TypePicker.tsx` and `BottomTabBar.tsx` doc comments (their "pixel-sampled
    `#241a16`" history).
  - `VERIFICATION.md` (a visual check of the flow).
