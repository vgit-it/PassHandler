import { useCallback, useEffect, useRef, useState } from 'react';

/** How long a revealed password stays on screen before re-masking. */
export const REVEAL_SECONDS = 10;

/**
 * Show a secret, then hide it again on a timer.
 *
 * The timer exists for the case the app cannot otherwise defend against:
 * someone walks away with the password on screen. Ten seconds is long enough to
 * read a password aloud and short enough that a forgotten window does not leave
 * one on display.
 */
export function useReveal(seconds = REVEAL_SECONDS) {
  const [revealed, setRevealed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef<number | null>(null);

  const hide = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRevealed(false);
    setSecondsLeft(0);
  }, []);

  const show = useCallback(() => {
    const expiresAt = Date.now() + seconds * 1000;
    setRevealed(true);
    setSecondsLeft(seconds);

    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      const left = Math.ceil((expiresAt - Date.now()) / 1000);
      if (left <= 0) hide();
      else setSecondsLeft(left);
    }, 250);
  }, [seconds, hide]);

  const toggle = useCallback(() => {
    if (revealed) hide();
    else show();
  }, [revealed, hide, show]);

  useEffect(() => hide, [hide]);

  return { revealed, secondsLeft, toggle, hide };
}
