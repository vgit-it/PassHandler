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
 * Two rules make this correct rather than merely convenient:
 *
 * 1. On expiry, the clipboard is cleared **only if it still holds what we
 *    wrote**. Blindly clearing would destroy whatever the user copied in the
 *    meantime, which is their data and none of our business.
 * 2. Locking clears immediately. The whole point of locking is that nothing is
 *    left lying around, and a password sitting in the clipboard is exactly
 *    that.
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
