/**
 * Shared timing budget for the locked⇄unlocked screen handoff — the doors
 * opening/shutting (`VaultDoors.tsx`), the Unlock panel fading out/in
 * (`Unlock.tsx`), the header ghost fading out on lock (`HeaderGhost.tsx`),
 * and the real header floating in on unlock (`VaultScreen.tsx`), all
 * orchestrated from `App.tsx`.
 *
 * Pulled into one module rather than duplicated-with-a-comment the way
 * `VaultDoors.tsx`'s old `CLOSE_TOTAL_MS` used to be — this sequence has
 * enough independently moving values, read by enough different files, that
 * one source of truth is worth it here specifically. (The detail box's own
 * timing lives in `index.css` tokens instead — see `ShelfOriginPanel.tsx`.)
 *
 * The rough choreography these numbers are tuned for:
 *
 * Unlock:  a strict sequence, per the Figma lock-screen reference
 *          (node 144:254) and direct request — nothing overlaps. The Modal
 *          Container shrinks (0–`MODAL_SHRINK_MS`), then fades
 *          (`MODAL_SHRINK_MS`–`MODAL_EXIT_MS`). Only once that's fully done
 *          do the doors start their own existing bolts-then-part motion
 *          (`MODAL_EXIT_MS`–`MODAL_EXIT_MS + DOOR_MOTION_MS`, i.e. after
 *          `DOOR_OPEN_DELAY_MS`). `VaultScreen` itself still mounts
 *          immediately (unchanged) — it's simply hidden behind the shut
 *          doors until they clear — and its header stays hidden until
 *          `HEADER_ENTER_DELAY_MS` (now timed past the modal exit *and* the
 *          door motion, not just the door motion alone), then floats in
 *          over `HEADER_ENTER_MS`. `Unlock.tsx`'s own new top bar (the
 *          lock/settings buttons sitting invisible at their final Figma
 *          positions) fades to visible on that same `HEADER_ENTER_DELAY_MS`/
 *          `HEADER_ENTER_MS` schedule, so the handoff to the real header
 *          underneath reads as one continuous reveal rather than a visible
 *          swap. While the doors part, the vault's interior plays the
 *          unlock reveal (`REVEAL_*` below, `useUnlockReveal.ts`): the
 *          light comes up and the contents settle, all inside the time the
 *          doors and header already take — skipped for an unlock launched
 *          from the Android IME, onboarding, and reduced motion.
 *
 * Lock:    unchanged — the header ghost fades/floats out immediately
 *          (0–`HEADER_EXIT_MS`), then the real doors shut
 *          (`HEADER_EXIT_MS`–`HEADER_EXIT_MS + DOOR_MOTION_MS`) — `App.tsx`
 *          doesn't add an explicit delay to `VaultDoors` itself for this;
 *          the numbers just happen to leave a clean small gap. `Unlock`
 *          mounts immediately (the vault clears synchronously — see
 *          `VaultDoors.tsx`'s own doc on why that can never be delayed for
 *          a cosmetic animation), but its panel stays hidden until
 *          `PANEL_ENTER_DELAY_MS` (≈ once the doors are fully shut), then
 *          fades/settles in over `PANEL_ENTER_MS`. Only the unlock
 *          direction was asked to become strictly sequential; this
 *          direction's own overlap is deliberate and untouched.
 */

/** `VaultDoors.tsx`'s bolt retract, which always fires before the doors
 * move (its own 150ms transition/`transition-delay`). */
export const BOLT_RETRACT_MS = 150;
/** `VaultDoors.tsx`'s door-part slide (`--vault-t-door`). */
export const DOOR_PART_MS = 400;
/** The total time the door motion itself takes, either direction. */
export const DOOR_MOTION_MS = BOLT_RETRACT_MS + DOOR_PART_MS;

/** How long the Modal Container's scale-down takes, once a real unlock
 * succeeds — the first of the two strictly sequential exit steps. Figma's
 * static export doesn't carry prototype transition timing, so this (and
 * every other new duration below) is a reasonable choice matching this
 * app's existing `--vault-snap` motion feel, not a value pulled from the
 * design file itself. */
export const MODAL_SHRINK_MS = 150;
/** How long the Modal Container's fade takes, once the shrink above has
 * fully finished — the second sequential step. Starts at `MODAL_SHRINK_MS`,
 * not before: see `Unlock.tsx`'s own exit transition, which puts this on a
 * `transition-delay` of `MODAL_SHRINK_MS` rather than running it alongside
 * the scale. */
export const MODAL_FADE_MS = 150;
/** Total time the Modal Container's whole exit (shrink, then fade) takes.
 * Nothing else in the unlock sequence starts until this is done. */
export const MODAL_EXIT_MS = MODAL_SHRINK_MS + MODAL_FADE_MS;

/** How long `VaultDoors` waits, once a real unlock fires, before starting
 * its own bolts-then-part motion — timed to `MODAL_EXIT_MS` so the doors
 * never begin moving until the Modal Container has completely finished
 * shrinking and fading away, per the strictly-sequential request. The lock
 * direction adds no equivalent delay — see this file's own top doc. */
export const DOOR_OPEN_DELAY_MS = MODAL_EXIT_MS;

/** How long the header ghost (`HeaderGhost.tsx`) takes to fade/float out
 * once a real lock fires. `App.tsx` keeps it mounted for exactly this long. */
export const HEADER_EXIT_MS = 180;

/** How long `VaultHeaderBar` waits, once mounted after a real unlock,
 * before starting its own float-in — timed to when the doors actually
 * finish opening under the new sequential model (`DOOR_OPEN_DELAY_MS +
 * DOOR_MOTION_MS`), not just the door motion alone, so the header genuinely
 * arrives once the doors have cleared rather than mid-modal-exit. Also what
 * `Unlock.tsx`'s own top-bar lock/settings buttons wait for before fading
 * to visible, so the two hand off in sync — see this file's own top doc. */
export const HEADER_ENTER_DELAY_MS = DOOR_OPEN_DELAY_MS + DOOR_MOTION_MS;
/** The header's own float-in/fade-in duration once it starts — also reused
 * by `Unlock.tsx`'s top-bar buttons for their own fade-to-visible, so both
 * complete at the same instant. */
export const HEADER_ENTER_MS = 200;

/** How long `App.tsx` keeps the `exiting` `UnlockScreen` echo mounted past
 * a real unlock, before swapping it out for good — long enough to play the
 * modal's shrink-then-fade, the doors' delayed bolts-then-part motion, and
 * the top-bar buttons' own fade-in, so nothing is cut off mid-animation.
 * Replaces the old `PANEL_EXIT_MS` (which only covered the modal's own,
 * much shorter, overlapping fade under the previous non-sequential model). */
export const UNLOCK_SEQUENCE_MS = HEADER_ENTER_DELAY_MS + HEADER_ENTER_MS;

// --- Unlock reveal (`docs/vault-visual-language-spec.md` §5.1) ------------
// Every start below is measured from the unlock itself (= `VaultScreen`'s
// mount) and anchored to the moment the doors start to part, so retiming
// the doors moves the reveal with them. Everything must land by
// `UNLOCK_SEQUENCE_MS` — the reveal fills time the doors already take and
// never extends the sequence (`tests/lockTransitionTiming.test.ts` holds
// that line).

/** When the doors start to part: after the modal exit and the bolts. */
export const DOORS_PART_START_MS = DOOR_OPEN_DELAY_MS + BOLT_RETRACT_MS;

/** The interior "light coming on": a black layer over the frame interior
 * fading from `REVEAL_LIGHT_FROM_OPACITY` to 0 as the doors part. */
export const REVEAL_LIGHT_START_MS = DOORS_PART_START_MS;
export const REVEAL_LIGHT_MS = 500;
export const REVEAL_LIGHT_FROM_OPACITY = 0.45;

/** Windows' search shelf, at the top of the list — the first thing to
 * settle. (Android's search sits at the bottom, part of the control panel
 * with the tab bar, and moves with it instead.) */
export const REVEAL_SEARCH_START_MS = DOORS_PART_START_MS + 50;
export const REVEAL_SEARCH_MS = 260;
export const REVEAL_SEARCH_RISE_PX = 6;

/** List rows, top to bottom: row `i` starts at
 * `REVEAL_ROW_START_MS + min(i, REVEAL_ROW_MAX_STEPS) * REVEAL_ROW_STEP_MS`. */
export const REVEAL_ROW_START_MS = DOORS_PART_START_MS + 90;
export const REVEAL_ROW_STEP_MS = 30;
export const REVEAL_ROW_MAX_STEPS = 7;
export const REVEAL_ROW_MS = 280;
export const REVEAL_ROW_RISE_PX = 12;

/** Android's bottom control panel (search pill + tab bar) rising out of
 * the bottom bezel. */
export const REVEAL_PANEL_START_MS = DOORS_PART_START_MS + 170;
export const REVEAL_PANEL_MS = 300;
export const REVEAL_PANEL_RISE_PX = 12;

/** When the last piece of the reveal lands. */
export const REVEAL_END_MS = Math.max(
  REVEAL_LIGHT_START_MS + REVEAL_LIGHT_MS,
  REVEAL_SEARCH_START_MS + REVEAL_SEARCH_MS,
  REVEAL_ROW_START_MS + REVEAL_ROW_MAX_STEPS * REVEAL_ROW_STEP_MS + REVEAL_ROW_MS,
  REVEAL_PANEL_START_MS + REVEAL_PANEL_MS,
);

/** How long `UnlockScreen`'s panel waits, once mounted after a real lock,
 * before starting its own fade-in — timed to roughly match the ghost
 * header's exit plus the doors finishing their shut motion. */
export const PANEL_ENTER_DELAY_MS = HEADER_EXIT_MS + DOOR_MOTION_MS;
/** The panel's own fade-in/settle duration once it starts. */
export const PANEL_ENTER_MS = 200;

/** `Unlock.tsx`'s own top-bar height on Windows/desktop — a layout value,
 * not a timing one, but shared here rather than in that file specifically
 * so `VaultDoors.tsx` can import it without reaching into a screen
 * component: `VaultDoors` needs it to size itself to match the container
 * sitting below that bar (the Figma lock-screen reference's own
 * door-height-equals-container-height geometry, node 144:254) rather than
 * extending up behind the bar too. See `VaultDoors.tsx`'s own doc for how
 * (and how long) it applies this.
 *
 * Android uses `UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID` instead — see that
 * constant's own doc for why one shared number across both platforms isn't
 * right here, unlike everywhere else this file exports a single value. */
export const UNLOCK_TOP_BAR_HEIGHT_PX = 50;

/** `VaultHeaderBar`'s own real height on Android (`VaultScreen.tsx`'s own
 * `minHeight`, kept in sync with this constant rather than a duplicated
 * literal — see that file's own use of it). The single source of truth for
 * it, so `UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID` below can be derived from it
 * instead of drifting from it the way the two used to (see that constant's
 * own doc). */
export const ANDROID_HEADER_HEIGHT_PX = 68;

/** `Unlock.tsx`'s own top-bar height on Android — sized so that, plus
 * `VaultFrame`'s own 8px top margin there (`flushTop={false}`, this app's
 * `--vault-margin`), it totals `ANDROID_HEADER_HEIGHT_PX` exactly: the same
 * total top offset Home's container sits at below its own flush
 * (`flushTop={true}`) header. The user's own explicit ask — "the container
 * behind the doors should be the same size and position as the container
 * in the home screen" — this constant (and `VaultDoors.tsx`'s matching use
 * of it) is what makes that literally true on Android, not just
 * approximately close.
 *
 * Before this, both platforms shared the one `UNLOCK_TOP_BAR_HEIGHT_PX`
 * above (50, calibrated for Windows' own, shorter, content-driven header)
 * — on Android, where `VaultHeaderBar` is a full 18px taller
 * (`ANDROID_HEADER_HEIGHT_PX`, a fixed `min-h-[68px]` rather than
 * padding-around-content), that left the locked screen's container
 * rendering 10px higher and 10px taller than Home's, a real, measurable
 * mismatch — the "known remaining seam" `docs/vault-visual-overhaul-
 * plan.md` §6a already flagged (`VaultDoors.tsx`'s own doc on
 * `unlockTopBarShowing`), now closed for the two platforms' resting states
 * rather than merely documented. */
export const UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID = ANDROID_HEADER_HEIGHT_PX - 8;
