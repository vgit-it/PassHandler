import { RefObject, useEffect, useLayoutEffect, useRef } from 'react';

import {
  REVEAL_LIGHT_FROM_OPACITY,
  REVEAL_LIGHT_MS,
  REVEAL_LIGHT_START_MS,
  REVEAL_PANEL_MS,
  REVEAL_PANEL_RISE_PX,
  REVEAL_PANEL_START_MS,
  REVEAL_ROW_MAX_STEPS,
  REVEAL_ROW_MS,
  REVEAL_ROW_RISE_PX,
  REVEAL_ROW_START_MS,
  REVEAL_ROW_STEP_MS,
  REVEAL_SEARCH_MS,
  REVEAL_SEARCH_RISE_PX,
  REVEAL_SEARCH_START_MS,
} from '../lockTransitionTiming';
import { readVaultMotion } from '../motionTokens';

/**
 * The unlock reveal (`docs/vault-visual-language-spec.md` §5.1): as the
 * vault doors part, the interior's light comes up and its contents settle
 * onto their shelves. Timing lives in `lockTransitionTiming.ts`.
 *
 * Runs once, on the mount of the screen that owns `rootRef` (`VaultScreen`),
 * when `play` is true — the caller decides that (the store's
 * `playUnlockReveal`, plus reduced motion). A layout effect, so the first
 * painted frame already has everything at its starting point.
 *
 * What moves, found by `data-reveal` inside `rootRef`, in DOM order:
 * - `"search"` — Windows' search shelf, the first thing to settle.
 * - `"row"` — list rows and top-of-list items (sync notice, empty-state
 *   text, biometric offer), top to bottom, one slot each.
 * - `"heading"` — a section heading; shares the slot of the row after it.
 * - `"panel"` — Android's bottom control panel (search pill + tab bar),
 *   rising together.
 * Plus `lightRef`: a black layer over the frame interior that fades out.
 *
 * Rules the spec sets, enforced here:
 * - only elements on screen when it starts animate (a long vault costs the
 *   same as a short one), and anything rendered later doesn't animate;
 * - `transform`/`opacity` only;
 * - any `pointerdown`/`keydown`/`wheel`/`touchstart` finishes everything
 *   instantly — input is never blocked or delayed.
 *
 * Row/heading/search/panel animations use `fill: 'backwards'`, so they leave
 * nothing behind once finished; `onDone` fires when all of it has finished
 * (or been finished early), which is when the caller removes the light layer.
 */
export function useUnlockReveal({
  rootRef,
  lightRef,
  play,
  onDone,
}: {
  rootRef: RefObject<HTMLElement | null>;
  lightRef: RefObject<HTMLElement | null>;
  play: boolean;
  onDone: () => void;
}) {
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!play || !root) return;

    const { arrive } = readVaultMotion();
    const viewportHeight = window.innerHeight;
    const onScreen = (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      return rect.height > 0 && rect.bottom > 0 && rect.top < viewportHeight;
    };
    const settle = (el: HTMLElement, risePx: number, delay: number, duration: number) =>
      el.animate(
        [
          { opacity: 0, transform: `translateY(${risePx}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { delay, duration, easing: arrive, fill: 'backwards' },
      );
    const rowDelay = (slot: number) =>
      REVEAL_ROW_START_MS + Math.min(slot, REVEAL_ROW_MAX_STEPS) * REVEAL_ROW_STEP_MS;

    const animations: Animation[] = [];
    let slot = 0;
    for (const el of root.querySelectorAll<HTMLElement>('[data-reveal]')) {
      if (!onScreen(el)) continue;
      switch (el.dataset.reveal) {
        case 'search':
          animations.push(settle(el, REVEAL_SEARCH_RISE_PX, REVEAL_SEARCH_START_MS, REVEAL_SEARCH_MS));
          break;
        case 'panel':
          animations.push(settle(el, REVEAL_PANEL_RISE_PX, REVEAL_PANEL_START_MS, REVEAL_PANEL_MS));
          break;
        case 'heading':
          animations.push(settle(el, REVEAL_ROW_RISE_PX, rowDelay(slot), REVEAL_ROW_MS));
          break;
        case 'row':
          animations.push(settle(el, REVEAL_ROW_RISE_PX, rowDelay(slot), REVEAL_ROW_MS));
          slot += 1;
          break;
      }
    }
    const light = lightRef.current;
    if (light) {
      animations.push(
        light.animate([{ opacity: REVEAL_LIGHT_FROM_OPACITY }, { opacity: 0 }], {
          delay: REVEAL_LIGHT_START_MS,
          duration: REVEAL_LIGHT_MS,
          easing: arrive,
          fill: 'both',
        }),
      );
    }

    const finishAll = () => {
      for (const animation of animations) animation.finish();
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of events) window.addEventListener(name, finishAll, { capture: true, passive: true });
    const stopListening = () => {
      for (const name of events) window.removeEventListener(name, finishAll, { capture: true });
    };

    let cancelled = false;
    void Promise.all(animations.map((animation) => animation.finished))
      .then(() => {
        stopListening();
        if (!cancelled) onDoneRef.current();
      })
      .catch(() => {
        // Cancelled by the cleanup below — nothing left to do.
      });

    return () => {
      cancelled = true;
      stopListening();
      for (const animation of animations) animation.cancel();
    };
    // Deliberately once per mount: the reveal belongs to the moment of
    // unlocking, and `play` only ever turns off (via `onDone`) afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
