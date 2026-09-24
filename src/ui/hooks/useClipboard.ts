import { useCallback, useEffect, useRef, useState } from 'react';

import { Clipboard } from '../../platform/ports';

export interface ClipboardCountdown {
  /** What was copied, for the UI to name it ("Password for GitHub"). */
  label: string;
  secondsLeft: number;
}

/**
 * Copy-with-auto-clear.
 *
 * Two mechanisms run side by side, because no single one is reliable on every
 * platform:
 *
 * 1. This hook's own interval drives `clipboard.clearIfMatches` on expiry,
 *    clearing **only if the clipboard still holds what we wrote** — anything
 *    the user copied since is theirs. This is the sole mechanism on desktop,
 *    where it is reliable.
 * 2. `clipboard.scheduleClear`, called once up front, is a native, timer-free
 *    guarantee for Android: the OS refuses clipboard reads from a
 *    backgrounded app (so rule 1's compare-then-clear silently does nothing
 *    there) and throttles JS intervals once the page is hidden (so even the
 *    interval above may never fire). It clears unconditionally instead,
 *    accepting the small risk of clearing something else copied in the same
 *    window — a no-op on desktop, where rule 1 already covers it.
 *
 * Locking clears immediately either way. The whole point of locking is that
 * nothing is left lying around, and a password sitting in the clipboard is
 * exactly that.
 */
export function useClipboard(clipboard: Clipboard, seconds: number) {
  const [countdown, setCountdown] = useState<ClipboardCountdown | null>(null);

  // Held in a ref, not state: this is the value we may later clear, and it must
  // not end up in a render trace.
  const copiedRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const clearNow = useCallback(async () => {
    stopTimer();
    setCountdown(null);

    const value = copiedRef.current;
    copiedRef.current = null;

    // Cancel any pending native clear regardless of `value`: this runs on
    // every unmount (see the effect below), not just after an actual copy,
    // and a stale scheduled clear left behind would fire later and wipe
    // whatever the clipboard holds by then.
    void clipboard.cancelScheduledClear().catch(() => {});

    if (value === null) return;

    try {
      await clipboard.clearIfMatches(value);
    } catch {
      // A clipboard the host will not let us read or write is not a reason to
      // break the app. The value simply stays until the user overwrites it.
    }
  }, [clipboard, stopTimer]);

  const copy = useCallback(
    async (value: string, label: string) => {
      if (value === '') return false;

      try {
        await clipboard.writeSensitive(value);
      } catch {
        return false;
      }

      copiedRef.current = value;
      stopTimer();

      // The real guarantee on Android — runs natively, so it still fires if
      // the app is backgrounded before the JS interval below ever gets a
      // chance to. A no-op on desktop, where the interval's own
      // `clearIfMatches` call is already reliable. Best-effort: nothing here
      // depends on it resolving before the function returns.
      void clipboard.scheduleClear(seconds).catch(() => {});

      const expiresAt = Date.now() + seconds * 1000;
      setCountdown({ label, secondsLeft: seconds });

      timerRef.current = window.setInterval(() => {
        const left = Math.ceil((expiresAt - Date.now()) / 1000);
        if (left <= 0) {
          void clearNow();
        } else {
          setCountdown({ label, secondsLeft: left });
        }
      }, 250);

      return true;
    },
    [clipboard, seconds, stopTimer, clearNow],
  );

  useEffect(() => stopTimer, [stopTimer]);

  return { copy, clearNow, countdown };
}
