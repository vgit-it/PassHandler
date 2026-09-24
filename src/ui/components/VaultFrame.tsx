import { ReactNode } from 'react';

/** The Figma home-screen design's own radial vignette (`Container BG`,
 * node 106:332 — see `radialWall`'s own doc below), as a literal CSS
 * `background-image` value. Exported so `EntryDetail.tsx` can paint it
 * directly on its own root as a defensive fallback — see that file's own
 * doc for why a plain background reported as not reliably showing through
 * three ancestors up (this component's wall, `ShelfOriginPanel`) is worth
 * a second, redundant, direct application rather than only ever trusting
 * inheritance. A shared constant rather than two copies of the same
 * comma-heavy string, so the two can never quietly drift apart. */
export const VAULT_WALL_RADIAL_GRADIENT =
  'radial-gradient(ellipse at center, rgba(38,41,45,1) 0%, rgba(27,29,32,1) 100%)';

/**
 * The Frame + Inside planes (`docs/vault-visual-language-spec.md` §1) — the
 * physical box the vault's contents sit inside: an 8px margin off the
 * screen edge on the left/right/bottom, a `--vault-frame` bezel (no corner
 * bolts any more — removed to match the Figma home-screen design's own
 * plain-bordered frame, though the spec itself still calls for them; see
 * this file's own doc further down — and on Android, transparent rather
 * than its own flat fill, per `transparentBezel`'s own doc below), and a
 * recessed `--vault-wall`
 * interior that clips its own content hard at the rounded corner
 * (`overflow-hidden` — "nothing inside the vault may render outside the
 * bezel," spec §1). No top margin by
 * default (per the original request behind this component) — the frame
 * sits flush against `VaultHeaderBar` above it rather than matching the
 * other three sides, so the box reads as symmetric on three edges and
 * deliberately not on the fourth. `flushTop={false}` opts a caller with no
 * header of its own out of that — see `Unlock.tsx`, the one other call
 * site, which needs the normal symmetric 8px on all four sides since it has
 * no "Outside" plane bar above it to sit flush under.
 *
 * This was the one piece of the spec's own core idea ("the app is a
 * physical vault") that phases 1–8 never actually built — every component
 * picked up `--vault-*` tokens and motion, but nothing gave them an actual
 * box to sit in. That's why the shelves read as floating flush against the
 * raw screen edge instead of the reference prototype's (`vault-ui-v9.html`)
 * contained, bezeled look — this component is that box.
 *
 * `VaultScreen.tsx` wraps the header (the "Outside" plane, `bg-vault-chrome`,
 * sits above this box, not inside it) around this, and this around the
 * search shelf / entry list / Upcoming's own content / detail overlays / the
 * bottom tab bar. Edit/Settings stay full-screen pushes outside the frame —
 * they're separate destinations in this app's real navigation, not "inside
 * the vault" the way the reference prototype's rotate-to-Settings side face
 * was. Upcoming used to be a third such push too; it moved in here (per
 * request) so the tab bar that switches between it and List can dock at one
 * consistent bottom edge rather than changing container between the two
 * tabs it switches between. `Unlock.tsx` (per a later request) reuses this
 * same component for its own bezel — literally "the same rounded
 * container" — with `VaultDoors` rendered as a separate, fixed,
 * identically-margined overlay meant to show through as the backdrop
 * behind whatever this frame's children are, rather than as this
 * component's own content; see `wallBackground` below and that file's own
 * doc for why the interior fill has to cooperate with that.
 *
 * The interior is a flex column, not just a plain box, so a caller can pass
 * two children: a `flex-1` content area (List/Upcoming plus their overlays)
 * and, after it, a bottom-docked fixture like the tab bar — a real flow
 * sibling that pushes the content area to make room, rather than an overlay
 * requiring the content to pad itself to avoid being covered. `Unlock.tsx`
 * only ever passes one child (its floating login panel, centered within
 * this same flex column) — the two-child layout simply isn't exercised
 * there, not something this component needs to special-case either way.
 */
export function VaultFrame({
  children,
  flushTop = true,
  wallBackground = true,
  radialWall = false,
  transparentBezel = false,
}: {
  children: ReactNode;
  /** `false` gives this frame a normal 8px top margin instead of sitting
   * flush against a header above it. Defaults to `true` — every existing
   * call site (Home's List/Detail/Upcoming) relies on the flush top edge,
   * so this only needs to be passed explicitly where it doesn't apply. */
  flushTop?: boolean;
  /** `false` drops the interior's own `bg-vault-wall` fill, leaving it
   * transparent instead. Defaults to `true` — Home's own call sites need
   * the opaque wall as the backdrop the search shelf/entries/tab bar sit
   * on. `Unlock.tsx` passes `false`: it needs `VaultDoors` (a separate,
   * fixed, identically-margined overlay sitting BEHIND this frame's own
   * z-index) to actually show through as the visible backdrop behind its
   * floating login panel. Found the hard way — `bg-vault-wall`
   * (`#0a0d11`, "darkest fill in the app") sitting in front of the real
   * doors (`VaultDoors.tsx`'s own door fill, a distinctly lighter slate)
   * painted over them completely: the doors were only ever visible for the
   * instant this frame itself unmounted mid-transition, never at rest
   * while actually locked, which is what this prop fixes. */
  wallBackground?: boolean;
  /** Layers the Figma home-screen design's own subtle radial vignette
   * (`Container BG`, node 106:332 — an ellipse from `rgba(38,41,45,1)` at
   * center to `rgba(27,29,32,1)` at the edge, both fully opaque) over the
   * flat `bg-vault-wall` fill instead of leaving it flat. Missed in the
   * first pass on this Figma-parity work, along with the "Outside" plane's
   * own gradient (`VaultScreen.tsx`) — asked about directly afterward, so
   * both are implemented now rather than staying a silent scoping call.
   * `VaultScreen.tsx` passes `platform.isAndroid` for its own List/Detail/
   * Upcoming call site; `Unlock.tsx` doesn't pass this at all (defaults to
   * `false`) since it already passes `wallBackground={false}`, and a
   * radial fill would have nothing to show through on top of either way. */
  radialWall?: boolean;
  /** Drops this frame's own `bg-vault-frame` fill, leaving its bezel
   * transparent so whatever sits behind it (a parent's own background)
   * shows through instead — for Android's Figma-parity match, where the
   * "Outside" plane is one continuous `#3a4148`→`#2a3036` gradient running
   * from the header all the way down BEHIND this frame (`VaultScreen.tsx`),
   * not a separate flat bezel color layered on top of it. A second real bug
   * from the same pass that added that gradient, caught the same way as
   * the header one (`VaultScreen.tsx`'s own doc): this bezel's flat fill
   * painted right over the gradient everywhere it's visible — the 9px ring
   * itself, and the corner gaps outside this frame's own rounded corners
   * but still inside its bounding box — so instead of one smooth surface,
   * the gradient visibly stopped dead at the frame's edges. Left `false`
   * by default (Detail/Upcoming share this same component but get here via
   * their own `VaultScreen.tsx` call site passing this the same way; direct
   * external callers and `Unlock.tsx` keep the opaque bezel, unaffected by
   * any of this Figma work). The interior wall's own `radialWall` gradient
   * still reads as a distinct, recessed plane against this now-transparent
   * bezel purely by being darker — no separate bezel fill is needed to
   * sell that contrast. */
  transparentBezel?: boolean;
}) {
  return (
    <div
      // Shadow made even and lighter per request — `0_0_24px_-2px` at `.7`
      // opacity, replacing `0_14px_34px_-10px` at `.92`: the `14px` Y-offset
      // was throwing the shadow almost entirely downward (a real, visible
      // directional bias, not just a technicality — the frame read as lit
      // from directly above rather than sitting evenly recessed on all
      // sides); dropping the offset to 0 is what actually fixes that, not
      // just a bigger blur, since offset and blur bias a shadow in
      // different ways. Also weaker across the board: less blur (24 vs 34),
      // a much smaller negative spread (-2 vs -10, since a small even glow
      // doesn't need to be pulled in from as far out as a long directional
      // one did), and lower opacity (.7 vs .92).
      className={`relative mx-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-vault-frame shadow-[0_0_24px_-2px_rgba(0,0,0,.7)] ${
        transparentBezel ? '' : 'bg-vault-frame'
      } ${flushTop ? '' : 'mt-2'}`}
      style={{ padding: 'var(--vault-bezel)' }}
    >
      {/* The frame's own inner hairline (spec's `.vault::after`) — a subtle
          ring 4px in from the bezel's outer edge, purely decorative. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-1 rounded-[13px] border border-white/[.03]"
      />
      {/* No corner bolts any more — the Figma home-screen design's own
          frame outline (`Container_Outline`, node 103:327) is a plain
          even-thickness border with no rivet ornament, unlike the spec's
          own §1 (which does call for them). Removing them here changes
          every caller of this shared component (Detail/Upcoming/Unlock,
          not just List/Home), which matches "the frame" reasonably being
          one consistent look everywhere rather than a look that changes
          per screen — flagged in case that blast radius wasn't intended. */}

      {/* The interior (§1's "Inside" plane) — recessed, darkest fill in the
          app (when `wallBackground` — see that prop's own doc for the one
          caller that turns it off), clipped hard at its own rounded corner
          so nothing inside can ever render past the bezel. `flex flex-col`
          so a bottom-docked child (the tab bar) lays out as a real sibling
          below the content area instead of needing absolute positioning of
          its own.

          Two shadows, both inset, describing the one real boundary here —
          `--vault-frame` (the lighter bezel) to `--vault-wall` (the darkest
          fill in the app) — per request: the hairline ring alone read as an
          edge, not a genuine recess. `0 0 0 1px` keeps that hairline doing
          its own job (a crisp line right at the corner, unaffected by any
          blur); the second layer is the actual depth, a soft all-around
          vignette (`0 0 18px`, no offset — a directional top-only recess
          already exists where it's earned, e.g. `EntryList.tsx`'s own
          scroll shadow right under the search shelf; this one has to read
          as recessed on every side, since the tab channel/bottom bezel
          border it too, not just the top). */}
      <div
        className={`relative flex h-full flex-col overflow-hidden rounded-vault-inner shadow-[inset_0_0_0_1px_rgba(0,0,0,.6),inset_0_0_18px_rgba(0,0,0,.55)] ${
          wallBackground ? 'bg-vault-wall' : ''
        }`}
        // A `radial-gradient()` here rather than a Tailwind arbitrary-value
        // class — the comma-heavy `ellipse at center, rgba(...), rgba(...)`
        // syntax is unwieldy to escape into a class name, and this
        // component already reaches for `style` for the bezel padding
        // above. Paints over `bg-vault-wall` entirely (both gradient stops
        // are fully opaque), so the two coexist harmlessly when both are
        // set — no need to make them mutually exclusive.
        style={
          wallBackground && radialWall ? { backgroundImage: VAULT_WALL_RADIAL_GRADIENT } : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}
