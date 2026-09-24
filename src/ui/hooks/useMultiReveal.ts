import { useCallback, useEffect, useRef, useState } from 'react';

import { REVEAL_SECONDS } from './useReveal';

/**
 * `useReveal`, generalized to an arbitrary set of fields identified by key.
 *
 * `useReveal` itself assumes exactly one revealable value on screen (Login's
 * password, in the pre-redesign `EntryDetail`). `EntryDetail`'s field card
 * can have anywhere from one to a dozen-plus sensitive fields at once (a
 * Card's Number *and* CVV, a Bank's Account #, …), each independently
 * revealable, each wanting its own `REVEAL_SECONDS` countdown — hence a
 * key-based map of timers here instead of one hook instance's worth of
 * single-value state. Same wall-clock-`expiresAt` approach as `useReveal`
 * (survives the tab being backgrounded better than a plain per-tick
 * decrement), just per key rather than implicitly singular.
 *
 * Closes a real gap this replaces, not just a refactor: before this, only
 * Login's password (via `useReveal`) ever auto-hid — every other type's
 * sensitive fields, revealed through `EntryDetail`'s old plain `Set`-based
 * toggle, stayed on screen indefinitely once shown. Every sensitive field
 * gets the same auto-hide now, matching what `PickEntryDetail.tsx` already
 * does independently for its own reveal-by-key problem.
 */
export function useMultiReveal(seconds = REVEAL_SECONDS) {
  // Key -> seconds remaining. A key's mere presence means "revealed" — no
  // separate boolean per key needed.
  const [revealed, setRevealed] = useState<Map<string, number>>(new Map());
  const timers = useRef<Map<string, number>>(new Map());

  const hide = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer !== undefined) {
      window.clearInterval(timer);
      timers.current.delete(key);
    }
    setRevealed((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const show = useCallback(
    (key: string) => {
      const expiresAt = Date.now() + seconds * 1000;
      setRevealed((prev) => new Map(prev).set(key, seconds));

      const existing = timers.current.get(key);
      if (existing !== undefined) window.clearInterval(existing);
      const timer = window.setInterval(() => {
        const left = Math.ceil((expiresAt - Date.now()) / 1000);
        if (left <= 0) hide(key);
        else setRevealed((prev) => new Map(prev).set(key, left));
      }, 250);
      timers.current.set(key, timer);
    },
    [seconds, hide],
  );

  const toggle = useCallback(
    (key: string) => {
      if (revealed.has(key)) hide(key);
      else show(key);
    },
    [revealed, hide, show],
  );

  // Clear every pending timer on unmount — same reasoning as `useReveal`'s
  // own unmount cleanup, just for however many keys are live at that point.
  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      pendingTimers.forEach((id) => window.clearInterval(id));
      pendingTimers.clear();
    };
  }, []);

  return {
    isRevealed: (key: string) => revealed.has(key),
    secondsLeft: (key: string) => revealed.get(key),
    toggle,
  };
}
