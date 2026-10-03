# IME new-entry panel — a more muted palette

**Status: built** with every recommended decision (M1–M4); compiles, not
yet seen on a device (`VERIFICATION.md` §6). The docs listed at the end
are updated to match.

The new-entry panel (`buildCreatePanel` and everything under it in
`VaultKeyboardView.kt`) reads as too strong. This plan keeps its warm,
coral identity — chosen deliberately, twice (see the palette comment in
`VaultKeyboardView.kt`) — but turns the saturation down so it sits
comfortably next to the neutral top bar and the entry detail view.

---

## Why it read as strong

Measured from the constants before this change (HSL):

| Token | Before | Saturation | Where it shows |
|---|---|---|---|
| `CREATE_BG` | `#241A16` | 24% | the whole panel, from the top bar down |
| `CREATE_CARD` | `#352620` | 25% | the field card |
| `CREATE_BORDER` | `#4A352D` | 24% | dividers, outlines, off toggles |
| `CREATE_ACCENT` | `#E0A087` | **59%** | text buttons, outline buttons, slider, on toggles, callout bar, saved ring, current type |
| `CREATE_GRADIENT_TOP/BOTTOM` | `#e8b49c` / `#cf8a6c` | **62% / 51%** | Save, Generate |
| `CREATE_LABEL` | `#B39488` | 22% | field labels, "Not set", helper text |
| `CREATE_FG` | `#FFFFFF` | — | titles and values (pure white) |

Three things add up:
1. **The whole panel is tinted brown.** A large, dark area at 24%
   saturation reads as a strong color, even though it's dark. It sits
   directly under the neutral, slightly cool top bar (`#292c2f`), so the
   change in hue is abrupt.
2. **The accent is near full strength**, and appears on up to ten
   controls per screen (every Fill, Grab and Pick, the slider, the
   toggles).
3. **Pure white text** on a warm surface looks harsher than the detail
   view's `#D6E4EF`.

## The palette: warm neutral

Keep the hue (~17–24°, coral) and the light/dark structure, and roughly
halve the saturation. The background drops the most, so the panel reads
as "warm grey" rather than "brown"; the accent keeps enough color to
still say "this is the create flow".

| Token | Before | Now | Saturation |
|---|---|---|---|
| `CREATE_BG` | `#241A16` | `#2A2725` | 24% → 6% |
| `CREATE_CARD` | `#352620` | `#36312E` | 25% → 8% |
| `CREATE_BORDER` | `#4A352D` | `#4D4541` | 24% → 8% |
| `CREATE_ACCENT` | `#E0A087` | `#D1A594` | 59% → 40% |
| `CREATE_GRADIENT_TOP` | `#e8b49c` | `#D6B0A0` | 62% → 40% |
| `CREATE_GRADIENT_BOTTOM` | `#cf8a6c` | `#BC907E` | 51% → 32% |
| `CREATE_ACCENT_TEXT` | `#241A16` | `#2A2725` (= new `CREATE_BG`) | — |
| `CREATE_LABEL` | `#B39488` | `#B3A69F` | 22% → 12% |
| `CREATE_FG` | `#FFFFFF` | `#F2EDEA` (warm off-white) | — |
| `CREATE_CALLOUT` | accent at 12% | new accent at 10% (`#1AD1A594`) | — |

The new background's lightness (15%) is close to the top bar's (17%), so
the seam between them softens too.

**Contrast (all still AA for text):**

| Pair | Before | Now |
|---|---|---|
| Label on card | 5.18 | 5.42 |
| Label on panel | 6.08 | 6.27 |
| Accent text on panel | 7.73 | 6.73 |
| Accent text on card | 6.59 | 5.82 |
| Title/value on card | 14.49 | 11.05 |
| Dark text on Save/Generate (darker stop) | 6.08 | 5.25 |
| Label on a callout | — | 5.16 |
| Discard (`DANGER`) on card / panel | 5.15 / 6.05 | 4.57 / 5.28 |

Discard sits on the panel background (the confirmation bar replaces the
header), so it's at 5.28 in practice.

## Follow-on changes

- **The "+" key's glyph** uses the old light coral (`#e8b49c`). It
  follows the new gradient top, `#D6B0A0` (6.1:1 on the key), so the key
  and the panel it opens match. Its faint warm gradient stays as is.
- **Strength label "Weak"**: `STRENGTH_BAD` (`#e05252`) is only 3.36:1 on
  the new card (and fails AA on the current one too). The label text uses
  `DANGER` (`#EC7777`, 4.57:1) instead. The bar keeps `STRENGTH_BAD`,
  since a bar only needs 3:1. "Fair" and "Strong" pass already.
- **`CREATE_MUTED` was unused** (only its definition and a comment
  referred to it). Removed.
- **Not changing:** the strength bar's colors (they carry meaning), the
  check in the Save confirmation (it follows the accent), `DANGER`, and
  the entry detail view.

## Decisions (recommendation first)

| # | Question | Recommendation |
|---|---|---|
| M1 | How far? (a) warm neutral, as above; (b) the panel goes fully neutral like the detail view, coral only on Save and Generate; (c) keep the brown background, mute only the accent | **(a)** — "a bit more muted" while keeping the create flow recognisable; (b) loses the identity that was chosen twice; (c) leaves the biggest cause (the brown area) |
| M2 | Pure white titles and values → warm off-white `#F2EDEA`? | **Yes** — softer, still 11:1 |
| M3 | The "+" glyph follows the new coral? | **Yes** — the key should match the panel it opens |
| M4 | Fix "Weak"'s contrast while here? | **Yes** — it's text, and fails today |

## Build

- **Code:** only the constants listed above change; every call site
  already uses the tokens. The strength label also changes (M4), and
  `CREATE_MUTED` is removed.
- **Check the result:**
  - Compile: run `npm run android:sync-ime`, then `./gradlew
    :app:compileArm64DebugKotlin -x rustBuildArm64Debug` in
    `src-tauri/gen/android`.
  - Look: `VaultImePreviewActivity` renders the panel with sample data.
- **Docs updated:**
  - `IME-DETAIL-CREATE-VISUAL-PASS.md` (card colour, label contrast)
  - `ACCOUNT-CREATION-DESIGN.md` (palette notes)
  - `ime-ux-redesign-proposal.md` (the sampled coral values)
  - `ime-visual-parity-plan.md`
  - `IME-CONTROLS-REFINEMENT-PLAN.md` ("The + key" colours)
  - `VERIFICATION.md` §6 (a check that the panel reads as warm grey,
    not brown)
