# Settings — visual pass

**Status: built** with every recommended decision (S1–S5). Typecheck, lint
and tests pass, the compiled CSS was diffed, and both platforms were
rendered. Not yet seen in the running app (`VERIFICATION.md`).

Settings had a colors-only pass earlier (`Settings.tsx`'s top doc): the page,
the section cards and the row text moved to Home's palette (Android: `#292c2f`,
`#d6e4ef`, `rgba(77,87,97,.4)` cards; Windows: the `--vault-*` tokens). That
pass deliberately left the shared controls alone (`.field`, `.btn-*`, `Toggle`,
the warning banner, the strength bar). Those are still the old navy-and-blue
`ink` system, and they're most of what's on the screen.

This review rendered Settings' own markup with the compiled CSS on both
platforms, closed and with every expandable row open (Change master password,
Restore backup, Restore vault). The app itself can't run in a plain browser.

---

## Findings

Most severe first.

| # | Finding | Where | Evidence |
|---|---|---|---|
| F1 | **Two palettes on one screen.** Every control (the two selects, every button, the password fields) is a navy block (`ink-800` `#111e2e`, `ink-700` `#1a2d44`, border `ink-500` `#264670`) sitting on a neutral grey card (Android) or the vault shelf (Windows). The primary "Change password" button is a pale blue fill (`primary` `#8fadc7`), a button color used nowhere on Home. Same problem the entry-creation flow had before its palette pass | `.field`, `.btn-secondary`, `.btn-primary` | Visual |
| F2 | **An off toggle is nearly invisible.** The off track (`ink-600` `#1e3457`) against the card is 1.14:1 on Android and 1.24:1 on Windows. Only the white knob shows; "Show site icons" (off by default) reads as a stray dot | `Toggle` | WCAG 1.4.11 asks 3:1 |
| F3 | **Section titles fail contrast.** `text-primary/50` is 2.61:1 on Android and 2.87:1 on Windows, for 14px uppercase text | `Section` | AA asks 4.5:1 |
| F4 | **Android hints fail contrast.** `#d6e4ef` at 50% on the card is 3.40:1. Windows' `vault-muted` is 5.02:1, fine | `Row` hint, the "Choose a destination…" and Drive-list captions | AA 4.5:1 |
| F5 | **Error and warning text on Android.** `bad` `#e05252` on the grey card is 2.87:1; the amber warning banner is 4.33:1. Both fine on Windows (4.04 is borderline for `bad`) | Error lines, the master-password banner | AA 4.5:1 |
| F6 | **Control borders vanish.** `ink-500` borders are 1.14:1 on the Android card (1.61:1 Windows), so buttons and fields read as dark navy patches rather than outlined controls | `.field`, `.btn-secondary` | Visual |
| F7 | **The header is the odd one out.** A 20px slate-grey chevron in a ghost button and a 16px semibold title, at `px-4`. Entry Detail and the Type Picker (the other full-screen pushes on Android) use a 24px `#d6e4ef`/50 back icon, `px-5` and an 18px medium title | `SettingsScreen` header | Visual |
| F8 | **112px of dead space at the bottom on Android.** `pb-28` was sized to clear the bottom tab bar, but Settings no longer shows a tab bar (`BottomTabBar.tsx`: Settings is a full-screen push). The comment explaining it is stale too | Scroll container | Code |
| F9 | **Two identical "Restore" buttons**, one under the other, doing different things (this session's backup vs. a file or Drive) | Recovery | Visual |
| F10 | **A disabled button with no visible reason on Android.** "Google Drive" under Restore vault is disabled when Drive isn't connected; the only explanation is a `title` tooltip, which touch never shows | `RestoreVaultRow` | Code |
| F11 | **The toggle's tap area is 24px tall**, under the app's 44px floor. Only the switch itself is clickable, not its row | `Toggle` | Code |

Not problems: the card layout and grouping, the row structure, the danger
treatment on the two Restore confirmations, `vault-ok` success text (4.95:1
Android), Windows' text colors, the select and button heights (48px, above the
floor).

## Proposal

### 1. One scoped palette per platform (F1–F6)

The same mechanism the entry-creation flow uses
(`ENTRY-CREATION-PALETTE-DESIGN.md`): the `ink`/`slate`/`accent`/`primary`/`bad`
tokens are already CSS variables, so a scope class on Settings' root recolors
every shared control inside it, with no per-element branches and nothing changed
anywhere else.

- **Android: `.palette-grey`**, Home's neutral grey with the steel-blue accent
  the Windows vault already uses.
- **Windows: `.palette-vault`**, the `--vault-*` values the rest of Settings
  and Home already use.

| Role | Token | Android `.palette-grey` | Windows `.palette-vault` |
|---|---|---|---|
| Field fill (recessed) | `ink-800` | `#22262A` | `#131820` (`vault-rail`) |
| Panel fill | `ink-750` | `#2B2F33` | `#181D25` |
| Button fill | `ink-700` | `#454C54` | `#2A3039` |
| Hover fill | `ink-600` | `#4F5760` | `#343B45` |
| Borders, toggle-off track | `ink-500` | `#808A94` | `#6B7580` |
| Focus-ring offset, page | `ink-950` / `ink-900` | `#1F2225` / `#24272A` | `#0A0D11` / `#0F1318` |
| Text | `slate-100` / `slate-200` | `#D6E4EF` | `#E2E6EA` (`vault-fg`) |
| Secondary text | `slate-300` | `#C0CCD6` | `#B4BCC4` |
| Labels, ghost buttons | `slate-400` | `#AAB4BD` | `#8B949E` (`vault-muted`) |
| Accent (toggle on, focus) | `accent` / `accent-muted` | `#6B9DC6` / `#5682A8` | same |
| Primary button | `primary` / `primary-foreground` | `#6B9DC6` / `#14181C` | `#6B9DC6` / `#0A0D11` |
| Error | `bad` | `#F28B8B` | `#EC7777` |
| Warning | `warn` | `#F7B23B` | unchanged `#F59E0B` |

`warn` becomes variable-backed for this, the same way the others were; its
`:root` value is today's, so nothing else changes.

**Contrast with these values:**

| Pair | Android | Windows |
|---|---|---|
| Borders and toggle-off track vs. card (non-text, 3:1) | 3.12 | 3.29 |
| Toggle-on accent vs. card (non-text) | 3.79 | 5.34 |
| Text on a button | 6.71 | 10.59 |
| Label (`slate-400`) on card | 5.20 | 5.02 |
| Primary button text | 6.17 | 6.73 |
| Error text on card | 4.61 | 5.49 |
| Warning text on its banner | 4.90 | 6.03 |

The white knob on the accent track is 2.89:1, the same as today's (white on
`#4A9EE0`); the track itself carries the state, so this is left as is.

### 2. Toggle off state reads the border token (F2)

`Toggle`'s off track is `bg-ink-600`, the token that's also every button's hover
fill, so it can't be made visible without making hovers glaring. Move the off
track to `bg-ink-500` (the border token). This is a shared component, so it also
changes the off toggle in the editor:

- **Default palette:** `#264670` instead of `#1E3457`, slightly brighter.
- **Creation palette:** `#5A514C` instead of `#4A433F`, likewise.

Both stay within their palettes.

### 3. Text fixes (F3, F4)

- **Section titles:** `text-primary/50` → `#d6e4ef`/70 on Android (6.13:1) and
  `text-vault-muted` on Windows (6.33:1). These are literal classes in `Section`,
  not tokens.
- **Android hints and captions:** `#d6e4ef`/50 → `/70` (5.07:1). Six places in
  `Settings.tsx`.

### 4. Header matches the other pushes (F7)

Android: the back button and title take Entry Detail's treatment:
- a bare 24px back icon in `#d6e4ef`/50, with `p-2` and `active:opacity-60`;
- `px-5`;
- an 18px medium title;
- the content below moves to `px-5` too, so it lines up with the header.

Windows: the 24px icon only, keeping its ghost button. This is the one finding
that touches size rather than color.

### 5. Small fixes (F8–F11)

- **F8:** `pb-28` → `pb-10` on both platforms, and drop the stale comment.
- **F9:** rename the buttons by what they restore: "Restore backup" → **"Undo
  session"**, and "Restore vault" → **"Replace…"**. The row labels stay as they
  are.
- **F10:** when Drive isn't connected, show "Connect Google Drive first." as a
  caption under the two buttons, instead of only the tooltip.
- **F11:** give `Toggle` a 44px tap area with an invisible inset (`::before`),
  without changing the drawn switch.

## Decisions (recommendation first)

| # | Question | Recommendation |
|---|---|---|
| S1 | Recolor the controls, or leave Settings as it is? | **Recolor.** It's the last screen still mixing the two systems, after the entry-creation pass |
| S2 | Android accent: steel blue `#6B9DC6`, or keep the bright `#4A9EE0`? | **Steel blue.** It's Windows' vault accent; `#4A9EE0` is the old navy system's |
| S3 | Toggle off track moves to the border token everywhere (§2)? | **Yes.** Otherwise it needs a second Toggle style for Settings |
| S4 | Header size change (§4)? | **Yes**, so all three full-screen pushes share one header |
| S5 | Button renames (F9)? | **Yes**, but say if you'd rather keep the wording and only change the layout |

## As built

- **Rest of the app:** the CSS was compiled before and after, every color
  variable was resolved to its `:root` value on both sides, and the
  `.palette-*` blocks were dropped. The only differences are new classes:
  - `bg-ink-500` (the toggle's off track);
  - `text-[#d6e4ef]/70`;
  - the toggle's `before:` tap-area utilities.

  `warn` compiles to the same color everywhere.
- **Visual check:** Settings' own markup rendered with the compiled CSS, on
  Android and Windows, closed and with the master-password form and both
  restores open. Both read as one palette. The off toggle shows its track.
- **Tap area:** a tap 9px above or below the drawn switch reaches it.
- **Names:**
  - The scope classes are `palette-grey` (Android) and `palette-vault`
    (Windows), on `SettingsScreen`'s root.
  - `warn`'s variable is `--warn`.
- **Header and title:** the Android title is `#d6e4ef` at 80%, the same
  as the Type Picker's.

## Build

- **Files:**
  - `tailwind.config.js` and `index.css`: `warn` becomes variable-backed, plus
    the `.palette-grey` and `.palette-vault` rules.
  - `Settings.tsx`: the scope class on the root, section titles, hints, header,
    bottom padding, button names, the Drive caption.
  - `Toggle.tsx`: the off track and the tap area.
- **Checks:**
  - `npm run typecheck`, `npm run lint`, `npm run test`.
  - The same compiled-CSS diff as the creation palette: outside the two new
    scopes, only `Toggle`'s off track and the `warn` variable change, and
    `warn` compiles to the same color.
  - The static render of both platforms, closed and expanded.
  - On a device: `VERIFICATION.md`.
- **Docs:**
  - This one, marked built.
  - `CLAUDE.md` (the token list gains `warn` and the two scope classes).
  - `vault-visual-overhaul-plan.md` (decision 5's note about Settings).
  - `Settings.tsx`'s top doc.
  - `VERIFICATION.md`.
