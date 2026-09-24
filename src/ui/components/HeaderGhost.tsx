import { useEffect, useState } from 'react';

import { Phase, useApp } from '../../app/store';
import { HEADER_EXIT_MS } from '../lockTransitionTiming';
import { HomeScreenLogo } from './HomeScreenLogo';

/**
 * A brief, purely decorative echo of `VaultScreen.tsx`'s header — plays the
 * "floats/fades out" half of the lock-direction choreography (per request,
 * mirroring the unlock direction's header float-in). Mounted once, at the
 * top of `App.tsx`, next to `VaultDoors` — the same reason that component
 * has to live there: the real header (inside `VaultScreen`) unmounts in the
 * same commit `phase` flips to `'locked'` in, so nothing about the real
 * header itself can ever animate its own exit; something else has to
 * outlive that instant and fake it.
 *
 * Deliberately NOT a snapshot of the real header's live content — re-
 * mounting the actual `VaultHeaderBar` (or worse, `VaultScreen` itself)
 * a second time here to get pixel-accurate content would mean it re-runs
 * against a vault that `lock()` has already synchronously cleared
 * (`vaultRef.current = null`, `entries: []`) by the time this fires, and
 * would re-subscribe `VaultScreen`'s own global listeners (shortcuts,
 * activity tracking, the Android back button) a second time for no
 * reason. This renders a plain `bg-vault-chrome` bar matching the real
 * header's own shape/height per platform, with just the (static,
 * data-free) home-screen logo on Android — no live sync/entry-count state,
 * no Lock/Settings buttons (nothing here is real or clickable; showing
 * button-shaped things that don't work would be worse than showing none).
 *
 * `prevPhase` (not just watching `phase` directly) is what lets this tell
 * a REAL lock (`'unlocked'→'locked'`) — the only transition worth a
 * farewell fade — apart from every other phase change, the same technique
 * `VaultDoors.tsx` uses for the equivalent problem on its own side.
 *
 * `prevPhase` is tracked in state, not a ref, and compared against `phase`
 * DURING render (calling `setMounted`/`setVisible` right here, not from an
 * effect) — the same real bug `App.tsx`'s own `lingeringUnlock` had, and
 * fixed the same way once found there: a `useEffect` watching `[phase]` can
 * only run AFTER the commit where `phase` flips to `'locked'` has already
 * painted, but `Screen` (`App.tsx`) unmounts the real header (inside
 * `VaultScreen`) in that SAME commit — so for one full extra commit no
 * header existed at all, then this ghost "reappeared" at full opacity (a
 * fresh mount, nothing to transition from) once the effect finally fired,
 * before immediately fading out again for real. Comparing a value tracked
 * in `useState` against the current render's own value, and calling
 * `setState` inline when they differ, is React's own documented pattern for
 * this: React discards this render and immediately re-renders with the
 * update BEFORE ever painting, so this ghost is already mounted and visible
 * by the time the commit that removed the real header reaches the screen.
 * See `App.tsx`'s own doc on its `lingeringUnlock` for the longer version of
 * this, including why a `useRef` mutated inline during render doesn't hold
 * up here the way a matched `useState` pair does.
 */
export function HeaderGhost() {
  const { phase, platform } = useApp();
  const [prevPhase, setPrevPhase] = useState<Phase>(phase);
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);

  if (phase !== prevPhase) {
    setPrevPhase(phase);
    if (prevPhase === 'unlocked' && phase === 'locked') {
      setMounted(true);
      setVisible(true);
    }
  }

  useEffect(() => {
    if (!mounted) return;
    // `visible` is already `true` from the render-phase update above (or
    // from this same state's initial value) by the time this effect runs —
    // this rAF is only what starts the fade a frame later, same as before.
    const raf = requestAnimationFrame(() => setVisible(false));
    const timeout = window.setTimeout(() => setMounted(false), HEADER_EXIT_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timeout);
    };
  }, [mounted]);

  if (!mounted) return null;

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-shrink-0 items-center gap-2 bg-vault-chrome transition-[opacity,transform] ease-vault-snap ${
        platform.isAndroid ? 'min-h-[68px] px-5 py-3' : 'pl-3 pr-3 pt-3 pb-2.5'
      }`}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-10px)',
        transitionDuration: `${HEADER_EXIT_MS}ms`,
      }}
    >
      {platform.isAndroid ? (
        <HomeScreenLogo className="mx-auto h-8 w-auto" />
      ) : (
        <p className="text-[15px] font-semibold text-slate-300">Vault</p>
      )}
    </div>
  );
}
