import { useEffect, useRef, useState } from 'react';

import { Phase, useApp } from '../../app/store';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import {
  DOOR_OPEN_DELAY_MS,
  UNLOCK_SEQUENCE_MS,
  UNLOCK_TOP_BAR_HEIGHT_PX,
  UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID,
} from '../lockTransitionTiming';

/**
 * The Frame plane's doors (`docs/vault-visual-language-spec.md` §1, §5,
 * `docs/vault-visual-overhaul-plan.md` phase 8) — "the signature moment":
 * bolts retract, *then* the doors part, on unlock; the reverse on lock;
 * a subtle partial-close "creep" as auto-lock approaches. Mounted once, at
 * the top of `App.tsx`, outside the `phase` switch that mounts/unmounts
 * `UnlockScreen`/`VaultScreen` — a plain `phase` flip can't hold a closing
 * animation open long enough to play, since React would unmount everything
 * in the same commit.
 *
 * As of the Unlock-screen redesign (per request), this is no longer a
 * transition-only flash: the doors now render persistently, fully shut,
 * for the whole time `phase === 'locked'` — the resting backdrop
 * `Unlock.tsx`'s floating login panel sits in front of — not just a brief
 * animation that plays once and then unmounts. Only `'locked'` and
 * `'unlocked'` are ever "relevant" here; `'loading'` (nothing decrypted
 * yet) and `'onboarding'` (no vault exists yet) render no doors at all,
 * same as today — there is nothing to visualize as shut. Notably,
 * `createVault`/`adoptRemoteVault` (`app/store.tsx`) jump straight from
 * `'onboarding'` to `'unlocked'` with no `'locked'` phase in between (see
 * `afterUnlock`'s own call sites) — arriving at `'unlocked'` that way must
 * NOT play the open animation, since nothing was ever visibly closed to
 * open from. `prevPhase` (not just a `isUnlocked` boolean, as before)
 * tracks the actual phase this component last saw, specifically so it can
 * tell a real `'locked'→'unlocked'`/`'unlocked'→'locked'` transition
 * (animate) apart from an arrival at either from `'loading'`/`'onboarding'`
 * (snap straight to the resting state, no animation to play from).
 *
 * Deliberately decorative, never a real access gate — `lock()`
 * (`app/store.tsx`) already clears the decrypted vault and unmounts
 * `VaultScreen` synchronously, for real security reasons, before this
 * component's own close animation has moved a single pixel — and that stays
 * true here: nothing in this component ever delays when `phase` itself
 * changes, only how the door panels visually react to it having changed.
 * By the time the doors visually finish shutting, the real `UnlockScreen`
 * has already mounted behind them (immediately, per `App.tsx`'s own
 * `Screen` switch). `pointer-events-none` throughout — these panels must
 * never intercept a click meant for whatever's underneath, mid-animation
 * or not.
 *
 * No dialog, no countdown text anywhere in this component — per spec, the
 * doors closing (or creeping) *is* the warning.
 */
export function VaultDoors() {
  const { phase, autoLockCreeping, platform } = useApp();
  const relevant = phase === 'locked' || phase === 'unlocked';
  const isUnlocked = phase === 'unlocked';
  // `Unlock.tsx`'s own top bar is taller on Android than on Windows/desktop
  // (see `UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID`'s own doc) — this has to match
  // whichever one that screen is actually rendering, so the `top` inset
  // below lines this box up with the real container sitting below it
  // rather than the wrong platform's number.
  const unlockTopBarHeightPx = platform.isAndroid
    ? UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID
    : UNLOCK_TOP_BAR_HEIGHT_PX;

  const [mounted, setMounted] = useState(relevant);
  const [bolted, setBolted] = useState(!isUnlocked);
  const [partsOpen, setPartsOpen] = useState(isUnlocked);
  // Whether `Unlock.tsx`'s own top bar (`UNLOCK_TOP_BAR_HEIGHT_PX` tall) is
  // the header currently sitting above this component's own doors — vs.
  // `VaultScreen`'s real, differently-sized `VaultHeaderBar`, or no header
  // at all (loading/onboarding). Drives the door height/top-inset below —
  // see that style's own doc — kept as a separate flag from `bolted`/
  // `partsOpen` because it has its own lifetime: it has to stay true for
  // the *entire* unlock reveal (`UNLOCK_SEQUENCE_MS`, matching how long
  // `App.tsx` keeps `Unlock.tsx`'s `exiting` echo — and its top bar —
  // mounted), not just until `phase` itself flips to `'unlocked'` (which
  // happens immediately on a real unlock, well before the doors have
  // actually moved). Flipping this the instant `phase` changes instead
  // would yank the still-motionless, still-shut doors to a new height with
  // no transition to soften it. Once it does go false, the doors are fully
  // open and off-screen, so their height no longer shows — except during the
  // auto-lock creep, where they start at the bare margin behind
  // `VaultHeaderBar` rather than below it.
  const [unlockTopBarShowing, setUnlockTopBarShowing] = useState(!isUnlocked);
  const prevPhase = useRef<Phase>(phase);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const from = prevPhase.current;
    prevPhase.current = phase;
    if (phase === from) return;

    if (phase === 'unlocked') {
      if (from !== 'locked') {
        // Reached 'unlocked' from 'onboarding' (a brand-new vault) or
        // 'loading' — nothing was ever visibly shut to open from, so show
        // nothing rather than a snap-to-open. `Unlock.tsx` never showed its
        // top bar on this path either, so its height never applied here.
        setMounted(false);
        setUnlockTopBarShowing(false);
        return;
      }
      // A real unlock: start from a fully shut, bolted state — even on the
      // very first unlock of the session — so there is always a real
      // close-to-open transition to play.
      setMounted(true);
      setBolted(true);
      setPartsOpen(false);
      // Waits for the Modal Container's own shrink-then-fade exit to
      // finish first (`DOOR_OPEN_DELAY_MS`) — per the Figma lock-screen
      // reference and direct request, the whole unlock reveal is a strict
      // sequence (modal gone, *then* doors), not the overlap this used to
      // play (and which the lock direction below still does — see
      // `lockTransitionTiming.ts`'s own top doc). Bolts retract and the
      // doors begin parting from the same state flip once this timer
      // fires; the doors' own `transition-delay` (below) is what produces
      // the "bolts, then doors" stagger within that, rather than two
      // chained timers doing it in JS.
      const timeout = window.setTimeout(() => {
        setBolted(false);
        setPartsOpen(true);
      }, DOOR_OPEN_DELAY_MS);
      // `unlockTopBarShowing` stays true (already was, from the 'locked'
      // state this transitioned from) for the rest of the real unlock
      // sequence — see this flag's own doc above for why that's a separate,
      // longer timer rather than flipping alongside `bolted`/`partsOpen`.
      const topBarTimeout = window.setTimeout(() => {
        setUnlockTopBarShowing(false);
      }, UNLOCK_SEQUENCE_MS);
      return () => {
        window.clearTimeout(timeout);
        window.clearTimeout(topBarTimeout);
      };
    }

    if (phase === 'locked') {
      // Whether arriving here from a real unlocked session (play the close
      // motion) or straight from 'loading' (nothing to animate from, just
      // show the resting shut state immediately) — either way the target
      // state is the same fully-bolted, fully-shut one, and CSS transitions
      // simply don't run when there's no prior value to transition FROM
      // (the very first render), so no separate branch is needed here the
      // way 'unlocked' above needs one. `Unlock.tsx`'s own top bar is
      // mounted immediately too (same `Screen` switch), so this flag
      // follows suit with no delay of its own.
      setMounted(true);
      setBolted(true);
      setPartsOpen(false);
      setUnlockTopBarShowing(true);
      return;
    }

    // 'loading' / 'onboarding' — nothing to show. Unlike the old
    // transition-only version of this component, there's no close
    // animation to wait out here: 'locked' is now itself a persistent
    // rendered state (see above), not a brief flash this component used to
    // unmount itself out of after `CLOSE_TOTAL_MS`.
    setMounted(false);
    setUnlockTopBarShowing(false);
  }, [phase]);

  if (!mounted) return null;

  // Creep only applies once the doors are actually open and settled — a
  // warning about closing makes no sense mid-open or while already bolted
  // shut for a real lock.
  const creeping = autoLockCreeping && partsOpen && !bolted;

  // Normal motion: the panels are opaque and never fade — they reveal/hide
  // content purely by sliding fully into the bezel (`translateX(±100%)`)
  // or partway back in for creep (`spec §5: "doors ease back in 9px"`).
  // Reduced motion: spec §7 — "drop the door animation to a 120ms fade" —
  // the panels stay put and opacity alone shows/hides them instead; creep
  // has no panel-position analogue there, so only the bolt indicators
  // (a plain opacity change either way) carry the warning under reduced
  // motion.
  // Not a flat -100%/100%, and NOT a flat -101%/101% either (tried that
  // first — measured it in a real browser and it still left a ~15px
  // sliver on screen; see below for why). `translateX(±100%)` moves an
  // element by its OWN width, which fully clears a door that starts flush
  // at `left/right: 0` — but this door starts already inset from the
  // viewport edge by `var(--vault-margin)` (this box's own margin, 8px —
  // plus `env(safe-area-inset-*)` on Android, see this box's own style
  // below) PLUS `var(--vault-bezel)` (9px, this door's own `left`/`right`)
  // = 17px+ of fixed offset that `±100%` never accounts for at all, since percent
  // is relative to the door's own (viewport-width-dependent) width, not to
  // that fixed gap. A same-percent overshoot (`101%`) only adds 1% of the
  // door's width — a couple px, nowhere near the 17px needed — which is
  // why that first attempt still showed a visible strip along both edges.
  // Adding the real fixed pixel amount clears it exactly regardless of
  // viewport width. The buffer is 8px, not 2px — `DoorHinge` below sticks
  // its nubs 5px past the door's OWN edge on purpose (matching the
  // reference's `.tb` position), so the door itself has to travel that
  // extra 5px further before the nubs riding along with it (they're a
  // child, so they inherit this same transform) actually clear too;
  // measured this in a real browser after adding the hinges — a 2px
  // buffer left a ~3px sliver of hinge nub on screen. 8px covers the 5px
  // overhang plus a little slack for sub-pixel rounding.
  // `env(safe-area-inset-left/right)` added on top of the existing budget —
  // see this component's own outer `<div>` below for why: on Android's
  // edge-to-edge window, this box's own left/right edges now sit that much
  // further in from the true screen edge than they used to, so a door has
  // that much further left/right to travel before it's actually clear.
  // Resolves to 0 on Windows (no notch to report), so this changes nothing
  // there — same reasoning `index.css`'s own `#root` padding rule uses.
  const leftOpenX = creeping
    ? 'calc(-100% - env(safe-area-inset-left) - var(--vault-margin) - var(--vault-bezel) - 8px + 9px)'
    : 'calc(-100% - env(safe-area-inset-left) - var(--vault-margin) - var(--vault-bezel) - 8px)';
  const rightOpenX = creeping
    ? 'calc(100% + env(safe-area-inset-right) + var(--vault-margin) + var(--vault-bezel) + 8px - 9px)'
    : 'calc(100% + env(safe-area-inset-right) + var(--vault-margin) + var(--vault-bezel) + 8px)';
  const panelTransform = (openX: string) =>
    reducedMotion ? 'translateX(0)' : `translateX(${partsOpen ? openX : '0'})`;
  const panelOpacity = reducedMotion ? (partsOpen ? 0 : 1) : 1;
  const panelTransition = reducedMotion
    ? 'opacity 120ms var(--vault-snap)'
    // 150ms delay: fires after the 150ms bolt-retract stage, per spec's
    // own motion table ("Doors part: 400ms, --snap, 150ms delay").
    : 'transform var(--vault-t-door) var(--vault-snap) 150ms';

  const boltOpacity = bolted ? 1 : creeping ? 0.55 : 0;
  const boltTransition = `opacity ${reducedMotion ? 120 : 150}ms var(--vault-snap)`;
  const boltStyle = { opacity: boltOpacity, transition: boltTransition } as const;

  return (
    // 8px (`--vault-margin`), not a flat `inset-2`/`inset-0` — matches
    // `VaultFrame.tsx`'s own outer margin exactly, so the doors read as
    // shutting over THAT box rather than wiping across the raw screen
    // edge. Written as explicit `env(safe-area-inset-*) + 8px` per side
    // (not the `inset-2` Tailwind utility this used to be) because this
    // box is `fixed` — positioned relative to the true viewport — while
    // `VaultFrame` is a normal-flow descendant of `#root`, which
    // `index.css` already insets by `env(safe-area-inset-*)` on Android's
    // edge-to-edge window. Without matching that here too, this box's
    // margin was measured from the true screen edge while `VaultFrame`'s
    // was measured from the safe-area edge — on a phone with a real status
    // bar, that gap left the doors covering the status-bar strip and
    // reaching past where `VaultFrame` (and its own bezel/corner bolts)
    // actually sit — visibly more than just "the vault container" (per
    // request) — while a desktop browser (env() always 0 there) could
    // never catch this, since nothing to compensate for ever existed to
    // test against. The two components stay decoupled (this one has to
    // outlive `VaultFrame`'s own mount — see this file's own doc — so it
    // can't just live inside it), but sharing the same margin/bezel
    // geometry is what makes them read as the same physical object rather
    // than two unrelated overlays.
    //
    // `top` grows by `UNLOCK_TOP_BAR_HEIGHT_PX` on top of the usual margin
    // while `unlockTopBarShowing` — per the Figma lock-screen reference,
    // the doors' own height matches the *container* sitting below
    // `Unlock.tsx`'s top bar, not the full screen behind that bar too (see
    // that flag's own doc above for the timing this switches on). No
    // equivalent adjustment for `VaultHeaderBar`'s height once this flag
    // goes false (see that doc for the one case where it shows).
    <div
      className="pointer-events-none fixed z-40"
      style={{
        top: unlockTopBarShowing
          ? `calc(env(safe-area-inset-top) + var(--vault-margin) + ${unlockTopBarHeightPx}px)`
          : 'calc(env(safe-area-inset-top) + var(--vault-margin))',
        right: 'calc(env(safe-area-inset-right) + var(--vault-margin))',
        bottom: 'calc(env(safe-area-inset-bottom) + var(--vault-margin))',
        left: 'calc(env(safe-area-inset-left) + var(--vault-margin))',
      }}
      aria-hidden="true"
    >
      {/* Each door is inset from THIS box's edges by the bezel — same
          `var(--vault-bezel)` `VaultFrame.tsx` pads itself with — so a shut
          door's outer edge lines up with the frame's own bezel ring
          instead of covering it. Rounded only on the outer corner (10px,
          matching the frame's own corner radius on that side).
          Colors/border/shadow ported exactly from the Figma lock-screen
          reference (node 144:254, `VaultDoorLeft`/`VaultDoor_Right`) — a
          `#4d5761` 5px border and a `#35383c`→`#2b3035` gradient fill, both
          doors reading the same direction (top lighter, bottom darker):
          Figma authors the left door as the right door's own asset rotated
          180°, which flips its `to-b` gradient's visual direction back to
          matching the right door's — reproduced here by just writing the
          same final gradient on both directly, rather than replicating the
          rotation trick. Was a flat `bg-vault-door` (`#272d35`) with a much
          softer ambient shadow before this pass; `--vault-door` itself is
          now unused (only this file ever read it) and has been dropped
          from `index.css`. */}
      <div
        className="absolute border-[5px] border-[#4d5761] bg-gradient-to-b from-[#35383c] to-[#2b3035] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.25)]"
        style={{
          top: 'var(--vault-bezel)',
          bottom: 'var(--vault-bezel)',
          left: 'var(--vault-bezel)',
          width: 'calc(50% - var(--vault-bezel) + 1px)',
          borderRadius: '10px 2px 2px 10px',
          transform: panelTransform(leftOpenX),
          opacity: panelOpacity,
          transition: panelTransition,
        }}
      >
        <DoorHinge top="20.0%" side="right" />
        <DoorHinge top="32.5%" side="right" />
        <DoorHinge top="46.0%" side="right" />
      </div>
      <div
        className="absolute border-[5px] border-[#4d5761] bg-gradient-to-b from-[#35383c] to-[#2b3035] shadow-[0px_4px_4px_0px_rgba(0,0,0,0.25)]"
        style={{
          top: 'var(--vault-bezel)',
          bottom: 'var(--vault-bezel)',
          right: 'var(--vault-bezel)',
          width: 'calc(50% - var(--vault-bezel) + 1px)',
          borderRadius: '2px 10px 10px 2px',
          transform: panelTransform(rightOpenX),
          opacity: panelOpacity,
          transition: panelTransition,
        }}
      >
        <DoorHinge top="85.7%" side="left" />
        <DoorHinge top="98.0%" side="left" />
      </div>
      {/* Corner bolts (spec §1's Frame-plane table: "the vault bezel,
          corner bolts, the doors") — four small flat plates, thrown
          (fully opaque) while shut, faded to the creep opacity while
          idle-warning, hidden while genuinely open. Same `left-1`/`top-1`
          (4px) positions `VaultFrame.tsx`'s own (always-visible, static)
          corner bolts use — as of the Unlock-screen redesign the two DO
          render at once while locked (`Unlock.tsx` now mounts its own
          `VaultFrame` there too, per request), but since both sit at the
          exact same position/size/color, the overlap is invisible: it
          reads as one set of bolts, not two, whether this box's own
          (fading in/out with `boltStyle`) or the frame's own static ones
          happen to be the one actually on top at a given instant. */}
      <div className="absolute left-1 top-1 h-1.5 w-1.5 rounded-full bg-vault-frame shadow-vault-peg" style={boltStyle} />
      <div className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-vault-frame shadow-vault-peg" style={boltStyle} />
      <div className="absolute bottom-1 left-1 h-1.5 w-1.5 rounded-full bg-vault-frame shadow-vault-peg" style={boltStyle} />
      <div className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-vault-frame shadow-vault-peg" style={boltStyle} />
    </div>
  );
}

/**
 * A hinge/rivet nub — the Figma lock-screen reference's own "Background
 * Element" decoration (node 144:254, five of them, `#4d5761`, 20×11px),
 * purely cosmetic (never a real hinge; these doors don't rotate). Figma
 * positions all five straddling the shut seam, each centered on it rather
 * than belonging to one door or the other — reproduced here the same way
 * this component always has (one per door, protruding past that door's own
 * inner edge by roughly its own half-width so two together read as one nub
 * at rest, `-10px` for a 20px-wide nub) since that's what lets a nub
 * visually split and slide away with its own door on open, rather than one
 * fixed 20px block vanishing all at once. Figma's own five positions
 * (161/262/371/691/805 of an 806px-tall reference) are split 3/2 across
 * the two doors below, converted to percentages — which specific door
 * "owns" which position is arbitrary (Figma doesn't disambiguate this
 * either, authoring all five under one door's layer group despite the
 * straddling position), so this just keeps the existing left-leads/
 * right-follows split rather than introducing a new one.
 */
function DoorHinge({ top, side }: { top: string; side: 'left' | 'right' }) {
  return (
    <span
      aria-hidden="true"
      className="absolute h-[11px] w-5 rounded-[2px] bg-[#4d5761] shadow-[0_0_4px_2px_rgba(0,0,0,.25)]"
      style={{ top, [side]: '-10px' }}
    />
  );
}
