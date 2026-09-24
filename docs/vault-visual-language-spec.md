# Vault Visual Language — Implementation Spec

Target: React webview shared by Tauri (Windows) and Android.
Reference prototype: `vault-ui-v9.html`.

This document is written to be handed to a coding agent. Follow it literally. Where it says
**never**, treat it as a hard constraint, not a preference.

**Implementation status, added during a later documentation audit — read before treating this
spec as current-state fact.** See `docs/vault-visual-overhaul-plan.md` for what's actually shipped
and its own status-correction notes for what's since drifted; in brief:

- **Token names differ.** Every token below is written unprefixed (`--fg`, `--accent`, `--bezel`,
  `--snap`, `--t-press`, …); the shipped CSS (`src/index.css`) uses identical values under
  `--vault-`-prefixed names (`--vault-fg`, `--vault-accent`, `--vault-bezel`, `--vault-snap`,
  `--vault-t-press`, …) instead — a deliberate rename so the new tokens coexist with the existing
  `ink-*` set rather than colliding with it.
- **There is no 3D Settings turn.** It was dropped for good (`vault-visual-overhaul-plan.md`'s
  decision 5); §6 says so and nothing else here describes it. Settings is an ordinary full-screen
  push on its `ink-*` card layout, with a colors-only pass.
- **No light theme is planned.** §8's/the app's own standing policy is dark-only;
  `tailwind.config.js` states this explicitly. Any light-palette re-derivation implied elsewhere is
  aspirational, not scheduled.
- **Android has since diverged from several of the shared recipes below** (§4.1 entry shelves,
  §4.3 section rails, §4.5 the tab panel) in a later Figma-parity pass not reflected in this spec —
  `vault-visual-overhaul-plan.md`'s own status-correction notes on those areas are more current
  than this document for Android specifically.

---

## 1. The core idea

The app is a physical vault. Everything on screen belongs to exactly one of four planes.
Which plane a thing is on determines every visual decision about it. There is no fifth plane
and no "floating" elements.

| Plane | What lives there | How it looks |
|---|---|---|
| **Outside** (z > 0) | App title, sync status, lock button, settings gear | Sits above the frame. Casts a shadow downward onto it. |
| **Frame** (z = 0) | The vault bezel, corner bolts, the doors | The reference plane. Casts nothing, receives everything. |
| **Inside** (z < 0) | Search shelf, section rails, entry shelves, entries, tab panel, `+` | Recessed. Clipped hard at the bezel. Darkest fills in the app. |
| **Elsewhere** | Settings, the entry editor | Separate full-screen pushes, outside the box entirely. |

**Consequences you must respect:**
- Nothing inside the vault may render outside the bezel. No overflow, no tooltip escaping, no popover.
- Nothing outside may appear to be inside. If a control acts on vault contents, it goes inside.
- When the doors are closed, everything inside is genuinely inaccessible — not just hidden.
  Search, tabs, and `+` are all inside, so a locked vault has no reachable vault actions.

---

## 2. Tokens

Define once. Never hardcode a hex outside this block.

```css
:root {
  /* surfaces — four distinct flat steps, brightest at the top of the stack */
  --vault-frame:  #242931;  /* the bezel */
  --vault-chrome: #1a1e24;  /* outside plane bars */
  --vault-wall:   #0a0d11;  /* interior back wall — darkest thing in the app */
  --vault-rail:   #131820;  /* section rails, search shelf, tab panel */
  --vault-shelf:  #1f252d;  /* entry platforms — brightest interior surface */
  --vault-door:   #272d35;

  /* edges */
  --edge-lip:   rgba(255,255,255,.055); /* 1px top edge of a shelf */
  --edge-front: #0e1217;                /* 4px front face of a shelf */
  --hairline:   #2a3039;

  /* text */
  --fg:    #e2e6ea;
  --muted: #8b949e;
  --dim:   #5f6871;

  /* accent — used for exactly three things: primary action, focus ring, dial indicator */
  --accent: #6b9dc6;
  --ok:     #6fbf8b;
  --warn:   #c9963f;

  /* geometry */
  --bezel: 9px;
  --vault-margin: 8px;
  --r-shelf: 0;      /* shelves are square — they span wall to wall */
  --r-inner: 9px;
  --r-frame: 16px;

  /* motion */
  --snap:   cubic-bezier(.2,0,0,1);
  --detent: cubic-bezier(.34,1.4,.64,1);
  --arrive: cubic-bezier(.25,.8,.25,1);  /* detail box opening */
  --depart: cubic-bezier(.4,0,.2,1);     /* detail box closing */
  --t-press: 70ms;
  --t-ui:    150ms;
  --t-box:   320ms;                      /* detail box open */
  --t-box-close: 240ms;                  /* detail box close */
  --t-door:  400ms;
}
```

**Light theme:** invert the surface ramp, keep the ordering. Wall becomes the *lightest*
(`#eef1f4`), shelves slightly darker with a light top lip and a dark front edge. Shadows go from
`rgba(0,0,0,.9)` to `rgba(0,0,0,.18)`. Do not simply swap fg/bg — re-derive the four steps.

---

## 3. Hard visual rules

These are the rules that produce the look. Violating any one of them makes it read as a
generic dark theme.

1. **No gradients.** Every surface is a flat fill. If you reach for a gradient, you want a different
   flat token plus a shadow.
2. **No bevel highlights.** No `inset 0 1px 0 rgba(255,255,255,…)` except the single 1px shelf
   lip (`--edge-lip`). Layers are separated by *fill difference plus shadow*, never by a fake
   light edge.
3. **Shadows describe separation between layers, nothing else.** Every shadow must answer
   "which layer casts this onto which layer". Decorative glows, ambient drop shadows on flat
   elements, and colored shadows are all forbidden.
4. **Shadow shape:** large blur, large negative spread, opacity `.75–.9`.
   Good: `0 4px 8px -5px rgba(0,0,0,.9)`. Bad: `0 2px 4px rgba(0,0,0,.5)`.
5. **Press feedback is displacement, never scale and never opacity.** Elements move 1–3px
   toward the surface behind them and their shadow shrinks.
6. **No border radius on shelves.** They span wall to wall; rounding implies they float.
7. **Accent color appears at most three times on screen.** Primary action, focus ring, dial
   indicator. Never on text, never on a border, never as a status color.
8. **Monospace (`JetBrains Mono` or system mono) is reserved for credential values, secondary
   identifiers, and counts.** Never for labels or titles.

---

## 4. Component recipes

### 4.1 Entry shelf

The single most important component. It is a platform attached to the back wall.

```css
.shelf {
  display: flex; align-items: center; gap: 12px;
  padding: 9px 13px 10px;
  margin: 9px calc(var(--list-pad) * -1) 11px;  /* spans past the list padding, wall to wall */
  background: var(--vault-shelf);
  border-top: 1px solid var(--edge-lip);        /* the only bevel in the app */
  transition: background var(--t-press) var(--snap),
              transform  var(--t-press) var(--snap);
}
/* the 4px front face + the shadow it throws on the wall below */
.shelf::after {
  content:''; position:absolute; left:0; right:0; bottom:-4px; height:4px;
  background: var(--edge-front);
  box-shadow: 0 4px 8px -5px rgba(0,0,0,.9);
  transition: opacity var(--t-press);
}
.shelf:active { background:#262d36; transform: translateY(2px); }
.shelf:active::after { opacity:.35; }   /* pressed into the wall → less shadow */
```

**Content order:** peg → title/subtitle (flex:1, `min-width:0`) → nothing else.
Do not add a right-hand metadata column. It competes with the title and is usually sparse.

**Truncation:** both title and subtitle are single-line with `text-overflow: ellipsis`. The
shelf height must not vary with content length.

### 4.2 Peg (the entry anchor)

A token standing on the shelf. Flat plate, 34×34, `border-radius: 9px`, drop shadow only.

```css
.peg {
  width:34px; height:34px; flex:0 0 34px; border-radius:9px;
  display:grid; place-items:center; overflow:hidden;
  background: <entry color>;
  color:#0a0d10; font-size:13px; font-weight:700;
  box-shadow: 0 4px 8px -4px rgba(0,0,0,.75);
  transition: transform 110ms var(--snap), box-shadow 110ms var(--snap);
}
.shelf:active .peg { transform: translateY(3px); box-shadow: 0 1px 3px -1px rgba(0,0,0,.75); }
```

Contents, in priority order: cached favicon (20×20) → entry-type glyph → first letter.
The plate color comes from the favicon's dominant color when available, otherwise a stable
hash of the entry title. Never assign colors randomly per render.

The peg sinks *in addition to* the shelf sinking. Both animate on press. This double motion is
deliberate — it's what makes the peg read as resting on the shelf rather than glued to it.

### 4.3 Section rail

A channel cut into the wall. **Darker than the shelves.** Chrome must never outrank data.

```css
.rail {
  position: sticky; top: 0; z-index: 5;
  margin: 0 calc(var(--list-pad) * -1);
  padding: 7px 14px;
  background: var(--vault-rail);
  box-shadow: inset 0 3px 5px -4px #000,        /* it's a groove */
              0 5px 9px -7px rgba(0,0,0,.9);    /* it occludes what's behind */
  font-size: 9.5px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .17em;
  color: #8e98a2;
}
.rail::before, .rail::after {   /* lugs where it meets the side walls */
  content:''; position:absolute; top:0; bottom:0; width:4px; background:#252c35;
}
.rail::before { left:0 } .rail::after { right:0 }
```

Sticky is only physically plausible because it's a *groove*, not a board. A raised board cannot
slide over the shelves in front of it. Do not restyle this as a raised element and keep sticky.

Entry count goes right-aligned inside the rail, in `--dim`, monospace.

### 4.4 Search shelf

Mounted on the inner wall above the list. Its own `--vault-rail` band, casting a shadow
downward onto the first entry.

```css
.search-shelf { padding:8px; background:var(--vault-rail);
                box-shadow: 0 6px 12px -10px rgba(0,0,0,.9); }
.search { height:34px; border-radius:8px; border:1px solid #1c2128;
          background:#06080a;                        /* cut into the shelf */
          box-shadow: inset 0 1px 3px rgba(0,0,0,.6); }
.search:focus { box-shadow: inset 0 1px 3px rgba(0,0,0,.6),
                            0 0 0 2px color-mix(in srgb, var(--accent) 40%, transparent); }
```

### 4.5 Tab panel + primary action

Inside the vault, at the bottom, on the inner floor. Tabs are a recessed channel with a raised
sliding slug; the `+` sits beside it.

- Slug transition uses `--detent` (slight overshoot), 260ms. This is the only overshoot in the app
  — overshoot scales with distance, so it suits this short slide and nothing larger.
- The `+` is the only element using `--accent` as a fill.
- Both are inside, so both vanish behind the doors when locked. This is correct.

### 4.6 Detail view ("deposit box")

Opens **from the shelf that was tapped**, not from the center. Non-negotiable — it's the payoff
for the whole metaphor.

**It's a container transform: the box's outline morphs, its content never scales.** Never
`scale` the box itself (it squashes the text) and never put an overshoot curve on it (on a
full-screen move that reads as wobble). Implemented in `src/ui/components/ShelfOriginPanel.tsx`:

1. **Frame 0 is the card.** The box starts clipped to the tapped card's exact rect and corner
   radius — `clip-path: inset(top right bottom left round r)` — painted with the card's own face
   (its fill over the wall), with a copy of the card's contents on it. The real card is hidden
   (`visibility: hidden`) for as long as the box is out, so there is only ever one of it.
2. **The outline grows; content stays put.** The clip animates to the full area. The detail
   content is laid out at its final size throughout; only the window onto it moves.
3. **Icon and title fly.** Elements tagged `data-morph="icon"`/`"title"` in both the card and the
   detail view travel from one position to the other (translate + uniform scale). A copy of the
   card's element rides on top and hands off to the detail's own at about 55% of the way.
4. **The face lifts, contents settle.** The card's leftover contents (its subtitle) fade within
   the first 60ms. The face fades out from 100ms, when the window is most of the way open, so
   the detail is never seen through a small window. Then `data-stagger` elements (header, each
   field row, footer) fade in and rise 8px, 30ms apart.
5. **Close is the reverse**, shorter (`--t-box-close`) and on `--depart`, which eases in and out
   so the box decelerates into the slot rather than slamming into it. The card is re-measured
   first, in case the list moved. Content is covered first, the card's contents return only
   once the box is nearly card-sized, and the last frame is pixel-identical to the card. So the
   card is shown and the box removed with no fade.
6. **Interruptible.** Closing mid-open reverses the running animations from wherever they are.
   Tapping another card mid-close opens that one straight away.
7. **No card to grow from** (a keyboard open whose row is scrolled out of view, or a card that no
   longer exists): a 200ms fade with a 0.98→1 settle, and the reverse on close.

| Phase | Open (`--t-box`, `--arrive`) | Close (`--t-box-close`, `--depart`) |
|---|---|---|
| Clip: card rect ⇄ full area | 0–320ms | 0–240ms |
| Icon/title flight | 0–320ms, hand-off at 55% | 0–240ms, card copy in by 45% |
| Card's own contents | out 0–60ms | in 170–240ms |
| Card face (surface) | out 100–280ms | in 0–110ms |
| `data-stagger` items | in from 120ms, +30ms each (max 6 steps), 220ms each | — (covered) |
| Scrim | 0 → .58, `--t-box`/`--arrive` | .58 → 0 from the start of the close |

While open, dim the list, search shelf, **and tab panel** with a black scrim at `.58` (the same
result as `filter: brightness(.42)`, but a compositor-only opacity fade with no filter on the
list). The tab panel stays in place under the box rather than being removed when the box
opens — removing it changed the content area's height mid-animation. The scrim starts
un-dimming the moment the close starts, not when it ends.

Upcoming's cards open the same way as the list's, and closing returns to whichever tab the box was
opened over.

Dismiss label is "Put back", not "Close" or "Back".

---

## 5. Motion

| Interaction | Duration | Easing | Behaviour |
|---|---|---|---|
| Press (shelf, button, peg) | 70–110ms | `--snap` | Displace 1–3px, shrink shadow |
| Tab slug | 260ms | `--detent` | Slides with slight overshoot |
| Detail open | 320ms | `--arrive` | Container transform out of the tapped card (§4.6) |
| Detail close | 240ms | `--depart` | Back into the card, re-measured; lands without overshoot |
| Door bolts retract | 150ms | `--snap` | Fires **before** the doors move |
| Doors part | 400ms | `--snap`, 150ms delay | Retract into the bezel |
| Unlock reveal | ~450–1050ms after unlock | `--arrive` | Interior lights up, contents settle (§5.1) |

**The two-stage unlock is the signature moment.** Bolts retract, *then* doors move. Collapsing
these into one animation removes the mechanical read entirely.

**Auto-lock is what makes the doors worth keeping.** They must be tied to idle state, otherwise
they animate once per session and the metaphor stops paying for its pixels.

- Idle at (timeout − 30s): add `creep` — doors ease back in 9px, bolts return to thrown position.
- Idle at timeout: full close, clear decrypted state.
- Any `pointerdown` / `keydown` / `wheel` resets both timers and removes `creep`.

No dialog, no countdown text. The doors closing *is* the warning.

### 5.1 Unlock reveal

Built: `src/ui/hooks/useUnlockReveal.ts`, timings in `src/ui/lockTransitionTiming.ts` (`REVEAL_*`),
see `vault-visual-overhaul-plan.md` §6h.

The doors open onto a dark vault; light spills in and the contents settle onto their shelves.
Without this, the doors part onto a room that is already fully arranged and motionless, and
the sequence's last beat reveals nothing.

**Rules:**

1. **Add no time.** Everything finishes by the header's existing float-in end (~1050ms after
   unlock, `UNLOCK_SEQUENCE_MS`). The reveal fills time the doors already take; it never extends
   the sequence.
2. **Never block.** Input works from the first frame (Windows keeps search focus). Any
   `pointerdown`, `keydown`, `wheel` or `touchstart` finishes every reveal animation instantly.
3. **Settle, don't fly.** Rises of 6–12px plus a fade, `transform`/`opacity` only. Nothing
   enters from off-screen.
4. **Only what's visible.** Only elements on screen when the reveal starts animate — a
   500-entry vault costs the same as a 5-entry one. Anything that appears later (the
   post-unlock sync adding entries) appears without animating.
5. **Reading order.** Top to bottom.

**Timeline** (t = 0 is the unlock succeeding; the modal exit, bolts, doors and header timings
are the existing ones from the table above and `lockTransitionTiming.ts`):

| t (ms) | Element | Motion |
|---|---|---|
| 0–300 | Unlock panel | Existing shrink, then fade |
| 300–450 | Bolts | Existing retract |
| 450–850 | Doors | Existing part into the bezel |
| 450–950 | **Interior light** | A black layer over the frame interior, `.45` → `0`, `--arrive` |
| 500–760 | **Search shelf** (Windows — at the top) | Rise 6px + fade in, `--arrive` |
| 540 + 30·i, 280 each | **Rows**, i = 0…7 | Rise 12px + fade in, `--arrive`; rows past the 8th visible one share i = 7 |
| 620–920 | **Control panel** (Android — search pill + tab bar at the bottom) | Both halves rise 12px out of the bottom bezel together + fade in, `--arrive` |
| 850–1050 | Header | Existing float-in |

Section headings move with the row below them. Whatever sits at the top of the list — the
empty-state message, the new-vault welcome, the biometric nudge, the sync notice — takes the
first row slots.

**When it plays:**

| How the vault unlocked | Reveal |
|---|---|
| Password or biometric, on the lock screen | Plays |
| Re-unlock after an auto-lock | Plays |
| The Android IME's "Unlock Vault" link | **Skipped** — the app backgrounds itself within ~500ms of unlocking, so it would play to nobody. Detected via a launch flag; see `MANUAL-FILL-DESIGN.md`'s "Open Vault to unlock" |
| Creating or adopting a vault (onboarding) | Skipped — there are no doors to open either |
| `prefers-reduced-motion` | Skipped (§7) |
| Returning to an app that is still unlocked | Nothing unlocked, nothing plays |

---

## 6. Settings

Settings is a separate full-screen push, not a face of the box. The 3D "turn the box" treatment
this section once specified is permanently out of scope — do not build it, and don't add
`preserve-3d`, slab elements or a rotate transition for Settings.

---

## 7. Accessibility & robustness

- The shelf/wall contrast step is deliberately wide (`#1f252d` on `#0a0d11`) so the shelving
  survives low screen brightness without depending on shadows. Do not narrow it.
- Body text ≥ 4.5:1 against its own surface. `--dim` is for counts and timestamps only, never
  for anything the user must read.
- Under `prefers-reduced-motion`: keep press displacement, drop the door animation to a 120ms
  fade, drop the detail box to a 150ms cross-fade (no clip
  morph, no flying icon/title, no stagger), and skip the unlock reveal (§5.1) entirely — the
  contents are simply there when the doors fade. Large-area motion (a full-screen surface
  growing, a whole list settling) is exactly what reduced-motion users need removed.
- Every interactive element has a ≥44px touch target. The peg is 34px but is not independently
  tappable — the whole shelf is the target.
- Empty state lives on the wall, not on a shelf. No container, centered, `--dim`.

---

## 8. Performance

Each shelf costs one background, one border, one pseudo-element, and two shadows. That is the
budget. Before adding anything per-row, profile a 300-entry list scroll on the slowest Android
target you support.

- Virtualize the list beyond ~100 entries.
- Animate `transform` and `opacity` only. Never animate `box-shadow` on scroll-adjacent elements
  (the press-state shadow change is fine — it's a discrete, non-scrolling interaction).
- Favicons: cache to disk, never fetch during render, always ship the letter fallback.

---

## 9. Anti-patterns

Reject these even if they seem reasonable in isolation.

- Cards. Anything with a border-radius, a border on all four sides, and a drop shadow is a card,
  and a card floats *on* a surface. Vault contents are *of* the vault.
- Multi-stop gradients on any surface.
- Bevel highlights to separate layers.
- Elevation used for emphasis rather than for actual layer position.
- Accent color as a text or border color.
- Section headers that outshine the entries beneath them.
- A metadata column on the right of each shelf.
- Modals, popovers, or toasts that render outside the bezel.
- Scale or opacity transforms as press feedback.
- Any animation that fires more than once per session without carrying state (the doors are
  allowed only because they're tied to auto-lock).

---

## 10. Migration order

1. Tokens. Replace every hardcoded color with a token. Nothing else changes yet.
2. Strip gradients and bevel highlights globally. The app will look flat and slightly wrong.
3. Restructure planes — move search, tabs, and `+` inside the vault container.
4. Rebuild the entry row as a shelf. Delete the card component.
5. Peg with favicon plus fallback.
6. Section rails, sticky, darker than shelves.
7. Detail view origin animation.
8. Doors plus two-stage unlock plus auto-lock creep.
9. Unlock reveal (§5.1).

Steps 1–5 deliver most of the visual identity. Steps 6–9 are the metaphor. Ship 1–5 first and
confirm the list still reads well at 300 entries before starting 6.
