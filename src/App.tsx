import { useEffect, useState } from 'react';

import { Phase, useApp } from './app/store';
import { HeaderGhost } from './ui/components/HeaderGhost';
import { VaultDoors } from './ui/components/VaultDoors';
import { UNLOCK_SEQUENCE_MS } from './ui/lockTransitionTiming';
import { OnboardingScreen } from './ui/screens/Onboarding';
import { UnlockScreen } from './ui/screens/Unlock';
import { VaultScreen } from './ui/screens/VaultScreen';

function Screen({ phase }: { phase: ReturnType<typeof useApp>['phase'] }) {
  switch (phase) {
    case 'loading':
      return (
        <div className="flex h-full items-center justify-center text-sm text-slate-400">
          Opening…
        </div>
      );

    case 'onboarding':
      return <OnboardingScreen />;

    case 'unlocked':
      return <VaultScreen />;

    case 'locked':
    default:
      // Anything unexpected lands on the lock screen. Failing closed means a
      // state we did not anticipate shows the vault locked, never open.
      return <UnlockScreen />;
  }
}

export function App() {
  const { phase, platform } = useApp();

  // Paints the Android safe-area gutter (`index.css`'s `.vault-gutter` —
  // read that rule's own doc for why it's load-bearing on Android 15+, not
  // cosmetic) for as long as a real vault screen, locked or unlocked, is
  // showing — `loading`/`onboarding` have no such seam, since neither
  // renders anything all the way to the screen edge the way `Unlock.tsx`/
  // `VaultScreen.tsx` do. Lives here rather than on either screen
  // individually so the class's own on/off window exactly brackets both,
  // with no gap between them for the seam to reappear in — was
  // `VaultScreen.tsx`'s own effect, bracketing only "unlocked," until the
  // lock screen picked up the identical `#292c2f` background (per
  // request) and needed the identical fix.
  useEffect(() => {
    if (!platform.isAndroid) return;
    const relevant = phase === 'locked' || phase === 'unlocked';
    if (!relevant) return;
    document.body.classList.add('vault-gutter');
    return () => document.body.classList.remove('vault-gutter');
  }, [platform.isAndroid, phase]);

  // The Unlock panel's exit fade, on a real unlock — the mirror image of
  // `VaultHeaderBar`'s float-in (`justTransitioned`, `VaultScreen.tsx`).
  // Unlike that one, this doesn't need to be ready in the SAME commit as a
  // child's first render (nothing downstream captures it into a one-time
  // `useState` the way `justUnlocked`/`justLocked` are), so a plain
  // `useEffect`-driven ref diff — the same technique `VaultDoors.tsx`
  // already uses for its own "did phase really just change" check — is
  // safe here, unlike it would have been for those.
  //
  // Renders a SECOND, purpose-built `<UnlockScreen exiting />` instance
  // alongside whatever `Screen` below is now showing (`VaultScreen`,
  // mounted immediately, same as always) rather than keeping the real
  // outgoing screen around — see `HeaderGhost.tsx`'s own doc for why the
  // lock direction avoids re-mounting a second live `VaultScreen` the same
  // way; `UnlockScreen` doesn't carry that same risk (no global listeners,
  // no dependency on state `lock()`/`unlock()` mutate elsewhere), so its
  // real component can safely play its own exit fade instead of needing an
  // equivalent lightweight ghost.
  //
  // `prevPhase` is tracked in state, not a ref, and compared against `phase`
  // DURING render (calling `setLingeringUnlock` right here, not from an
  // effect) — a real bug, found by actually instrumenting a real unlock
  // frame-by-frame rather than trusting the animation to be right: the old
  // version watched `[phase]` from a `useEffect`, which can only ever run
  // AFTER the commit where `phase` flips to `'unlocked'` has already
  // painted. `Screen` below unmounts the real (non-exiting) `UnlockScreen`
  // in that SAME commit (its own switch is unconditional on `phase`), so for
  // one full extra commit neither the real screen nor this echo existed —
  // the login panel visibly vanished, then "reappeared" (at full opacity, a
  // fresh mount with nothing to transition from) once the effect finally
  // fired a moment later, before immediately fading out again for real.
  // Three visible states where there should have been exactly one —
  // reported as the panel and logo "disappearing, reappearing, then
  // disappearing again" during the unlock animation, and confirmed via a
  // frame-by-frame trace showing the exact 0-instance gap between the real
  // screen's unmount and the echo's mount. Comparing a value tracked in
  // `useState` against the current render's own value, and calling
  // `setState` inline when they differ, is React's own documented pattern
  // for this: React discards this render and immediately re-renders with
  // the update BEFORE ever painting, so `lingeringUnlock` is already `true`
  // by the time this same commit reaches the screen. A `useRef` mutated
  // inline during render would dodge the extra commit too, but isn't safe
  // here — see `store.tsx`'s own `justTransitioned` doc for why diffing a
  // ref during render doesn't hold up under Strict Mode's double-invocation;
  // a matched `useState` pair, updated only through `setState`, does.
  const [lingeringUnlock, setLingeringUnlock] = useState(false);
  const [prevPhase, setPrevPhase] = useState<Phase>(phase);
  if (phase !== prevPhase) {
    setPrevPhase(phase);
    if (prevPhase === 'locked' && phase === 'unlocked') setLingeringUnlock(true);
  }
  useEffect(() => {
    if (!lingeringUnlock) return;
    const timeout = window.setTimeout(() => setLingeringUnlock(false), UNLOCK_SEQUENCE_MS);
    return () => window.clearTimeout(timeout);
  }, [lingeringUnlock]);

  return (
    <>
      <Screen phase={phase} />
      {lingeringUnlock && <UnlockScreen exiting />}
      {/* Always mounted, regardless of `phase` — see `VaultDoors.tsx`'s own
          doc for why it needs to outlive the screen switch above rather
          than being gated by `phase` itself. */}
      <VaultDoors />
      {/* Same reasoning, mirrored for the lock direction's header — see
          `HeaderGhost.tsx`'s own doc. */}
      <HeaderGhost />
    </>
  );
}
