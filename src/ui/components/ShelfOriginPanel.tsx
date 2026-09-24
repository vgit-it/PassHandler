import { ReactNode, useEffect, useLayoutEffect, useRef } from 'react';

import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { readVaultMotion } from '../motionTokens';

/**
 * The vault's "deposit box" open/close motion
 * (`docs/vault-visual-language-spec.md` §4.6/§5). Wraps `EntryDetail`/
 * `PickEntryDetail`: the panel opens out of the card that was tapped to
 * reach it, and closes back into it.
 *
 * It's a container transform, not a scale — never `scale` this panel (it
 * squashes the text) or give it an overshoot curve (a full-screen move
 * reads as wobble). Content is never distorted:
 *
 * - The panel's **clip** (`clip-path: inset(... round r)`) morphs from the
 *   card's exact rect and corner radius to the full area. Content is laid
 *   out at its final size the whole time; only the window onto it moves.
 * - A **surface** layer (the card's own fill over the wall) sits on top of
 *   the content while the window is small, with a snapshot of the card's
 *   own contents (subtitle, etc.) in it, so frame one looks exactly like
 *   the card. It fades out once the window is mostly open.
 * - **Shared elements**: any `[data-morph="…"]` element inside the card
 *   with a same-named twin in the panel (the icon and the title) flies from
 *   one position to the other. A ghost copy of the card's version rides on
 *   top and hands off to the panel's own element partway through.
 * - `[data-stagger]` elements in the panel fade and rise in one after
 *   another once the window is open.
 * - The tapped card itself is hidden (`visibility: hidden`) while the box is
 *   out, so there is only ever one copy of it on screen.
 *
 * Close runs the same steps in reverse, faster, on an ease-in-out curve that
 * settles into the card's slot rather than slamming into it, after
 * re-measuring the card (the list may have moved underneath). Its
 * last frame is pixel-identical to the card, so the card is revealed and
 * the panel is unmounted with no fade. Closing while the open is still
 * running reverses the running animations from wherever they are.
 *
 * Timing and curves are read from the CSS tokens in `index.css` via
 * `readVaultMotion()` (`--vault-t-box`, `--vault-t-box-close`,
 * `--vault-arrive`, `--vault-depart`), the same ones `VaultScreen.tsx`'s dim
 * scrim uses, so the two can't drift apart.
 *
 * `sourceKey` names the tapped card by its `data-shelf-key`. With no key,
 * a key that no longer matches anything, a card that's scrolled out of
 * view, or reduced motion, this falls back to a short fade (plus a slight
 * scale when motion is allowed) instead of inventing an origin.
 *
 * This component owns the close timing: the parent flips `closing`, and
 * `onClosed` fires once the close has actually finished. Don't add a
 * parent-side `setTimeout` guessing its length.
 *
 * `transparent` (default false, so `PickEntryDetail`/Windows are
 * unaffected): drops this panel's own `bg-ink-950` so the shared
 * `VaultFrame` wall shows through on Android, per the Figma entry-detail
 * design (node 118:887).
 *
 * Uses the Web Animations API rather than CSS transitions: the geometry is
 * measured at run time, and the close needs a real "finished" signal plus
 * the ability to reverse an open mid-flight.
 */
export function ShelfOriginPanel({
  sourceKey,
  closing,
  onClosed,
  transparent = false,
  children,
}: {
  sourceKey: string | null;
  closing: boolean;
  onClosed: () => void;
  transparent?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const morphRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const boxRef = useRef<BoxMotion | null>(null);
  const onClosedRef = useRef(onClosed);
  useEffect(() => {
    onClosedRef.current = onClosed;
  });

  // A layout effect, not a plain one, so the first painted frame is already
  // the start of the animation (the card), never a flash of the open panel.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const surface = surfaceRef.current;
    const morph = morphRef.current;
    if (!panel || !surface || !morph) return;
    const box = openBox({ panel, surface, morph }, sourceKey, reducedMotion);
    boxRef.current = box;
    return () => {
      box.dispose();
      boxRef.current = null;
    };
    // Deliberately runs once per mount — `VaultScreen.tsx` remounts this
    // component (via `key`) for every new open, so the source is captured
    // once, at the moment of opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (closing) boxRef.current?.close(() => onClosedRef.current());
  }, [closing]);

  return (
    <div
      ref={panelRef}
      className={`absolute inset-0 z-20 ${transparent ? '' : 'bg-ink-950'}`}
      style={closing ? { pointerEvents: 'none' } : undefined}
    >
      {children}
      {/* Filled in imperatively by `openBox` only while an animation needs
          them; empty and invisible at rest. */}
      <div
        ref={surfaceRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-0"
        style={{ zIndex: 30 }}
      />
      <div
        ref={morphRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{ zIndex: 31 }}
      />
    </div>
  );
}

interface BoxMotion {
  /** Plays the close, then calls `done`. */
  close(done: () => void): void;
  /** Stops everything and restores the source card, for unmount. */
  dispose(): void;
}

interface BoxElements {
  panel: HTMLDivElement;
  surface: HTMLDivElement;
  morph: HTMLDivElement;
}

const FULL_CLIP = 'inset(0px 0px 0px 0px round 0px)';
/** Per-item delay step for `[data-stagger]`, and how many items get their
 * own step before the rest share the last one (so a long entry doesn't
 * trickle in for half a second). */
const STAGGER_STEP_MS = 30;
const STAGGER_MAX_STEPS = 6;

function findSource(container: HTMLElement, key: string | null): HTMLElement | null {
  if (!key) return null;
  const el = container.querySelector<HTMLElement>(`[data-shelf-key="${CSS.escape(key)}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const box = container.getBoundingClientRect();
  const onScreen = rect.height > 0 && rect.bottom > box.top && rect.top < box.bottom;
  return onScreen ? el : null;
}

/** The clip that shows exactly `rect` (with corner radius `radius`) out of
 * a panel covering `box`. */
function clipTo(rect: DOMRect, box: DOMRect, radius: number): string {
  return `inset(${rect.top - box.top}px ${box.right - rect.right}px ${box.bottom - rect.bottom}px ${
    rect.left - box.left
  }px round ${radius}px)`;
}

/** The transform that makes an element laid out at `at` appear at `over`
 * (uniform scale by height, `transform-origin: 0 0`). */
function mapRect(at: DOMRect, over: DOMRect): string {
  const scale = at.height > 0 ? over.height / at.height : 1;
  return `translate(${over.left - at.left}px, ${over.top - at.top}px) scale(${scale})`;
}

/** Absolutely positions a copy of `el` at its current on-screen rect,
 * relative to `box`. */
function copyAt(el: HTMLElement, box: DOMRect): HTMLElement {
  const rect = el.getBoundingClientRect();
  const copy = el.cloneNode(true) as HTMLElement;
  copy.removeAttribute('data-shelf-key');
  copy.setAttribute('aria-hidden', 'true');
  copy.tabIndex = -1;
  Object.assign(copy.style, {
    position: 'absolute',
    left: `${rect.left - box.left}px`,
    top: `${rect.top - box.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    transform: 'none',
    transformOrigin: '0 0',
    transition: 'none',
    visibility: 'visible',
  });
  return copy;
}

/** Every `[data-morph]` name present in both the card and the panel,
 * paired up. */
function morphPairs(source: HTMLElement, panel: HTMLElement) {
  const pairs: { from: HTMLElement; to: HTMLElement }[] = [];
  for (const from of source.querySelectorAll<HTMLElement>('[data-morph]')) {
    const name = from.dataset.morph;
    if (!name) continue;
    const to = panel.querySelector<HTMLElement>(`[data-morph="${CSS.escape(name)}"]`);
    if (to) pairs.push({ from, to });
  }
  return pairs;
}

/** Paints the surface layer as the card's own face — its fill over the
 * wall behind it — and drops a copy of the card's contents into it, minus
 * whatever is flying separately as a shared element. */
function dressSurface(
  surface: HTMLElement,
  source: HTMLElement,
  container: HTMLElement,
  box: DOMRect,
  morphing: Set<string>,
): HTMLElement {
  const cardStyle = getComputedStyle(source);
  const wallStyle = getComputedStyle(container);
  const tint = cardStyle.backgroundColor;
  const wallImage = wallStyle.backgroundImage !== 'none' ? `, ${wallStyle.backgroundImage}` : '';
  surface.style.backgroundColor = wallStyle.backgroundColor;
  surface.style.backgroundImage = `linear-gradient(${tint}, ${tint})${wallImage}`;

  const card = copyAt(source, box);
  card.style.background = 'transparent';
  for (const el of card.querySelectorAll<HTMLElement>('[data-morph]')) {
    if (el.dataset.morph && morphing.has(el.dataset.morph)) el.style.visibility = 'hidden';
  }
  surface.appendChild(card);
  return card;
}

function undressSurface(surface: HTMLElement) {
  surface.replaceChildren();
  surface.style.backgroundColor = '';
  surface.style.backgroundImage = '';
}

function openBox(els: BoxElements, sourceKey: string | null, reducedMotion: boolean): BoxMotion {
  const { panel, surface, morph } = els;
  const container = panel.parentElement;
  const tokens = readVaultMotion();
  const source = container && !reducedMotion ? findSource(container, sourceKey) : null;

  let running: Animation[] = [];
  let hiddenSource: HTMLElement | null = null;
  let disposed = false;

  const hide = (el: HTMLElement) => {
    hiddenSource = el;
    el.style.visibility = 'hidden';
  };
  const unhide = () => {
    if (hiddenSource) hiddenSource.style.visibility = '';
    hiddenSource = null;
  };
  const cleanup = () => {
    for (const a of running) a.cancel();
    running = [];
    undressSurface(surface);
    morph.replaceChildren();
  };
  const isRunning = () => running.some((a) => a.playState === 'running');

  // ---- Open ---------------------------------------------------------------

  if (!container || !source) {
    // Fallback: no origin to grow from. A short fade, plus a slight settle
    // when motion is allowed.
    running = [
      panel.animate(
        reducedMotion
          ? [{ opacity: 0 }, { opacity: 1 }]
          : [
              { opacity: 0, transform: 'scale(0.98)' },
              { opacity: 1, transform: 'none' },
            ],
        { duration: reducedMotion ? 150 : 200, easing: tokens.arrive, fill: 'both' },
      ),
    ];
  } else {
    const box = container.getBoundingClientRect();
    const cardRect = source.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(source).borderTopLeftRadius) || 0;
    const pairs = morphPairs(source, panel);
    const card = dressSurface(surface, source, container, box, new Set(pairs.map((p) => p.to.dataset.morph ?? '')));
    hide(source);

    const opts = (extra: KeyframeAnimationOptions = {}): KeyframeAnimationOptions => ({
      duration: tokens.boxOpenMs,
      easing: tokens.arrive,
      fill: 'both',
      ...extra,
    });

    running.push(panel.animate([{ clipPath: clipTo(cardRect, box, radius) }, { clipPath: FULL_CLIP }], opts()));
    // The card's own leftover contents (its subtitle) go almost at once —
    // left any longer they float, detached, mid-box. The face itself goes
    // once the window is ~3/4 open, so the detail content is never seen
    // through a small window at the card's position.
    running.push(card.animate([{ opacity: 1 }, { opacity: 0 }], opts({ duration: 60, easing: 'linear' })));
    running.push(surface.animate([{ opacity: 1 }, { opacity: 0 }], opts({ duration: 180, delay: 100, easing: 'linear' })));

    for (const { from, to } of pairs) {
      const fromRect = from.getBoundingClientRect();
      const toRect = to.getBoundingClientRect();
      const ghost = copyAt(from, box);
      morph.appendChild(ghost);
      // Position eases; the hand-off (ghost fading out over the panel's own
      // element, which is under the surface until then) runs on linear
      // time so "55%" means 55% of the real duration.
      running.push(
        ghost.animate([{ transform: 'none' }, { transform: mapRect(fromRect, toRect) }], opts()),
        ghost.animate([{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0 }], opts({ easing: 'linear' })),
        to.animate(
          [
            { transformOrigin: '0 0', transform: mapRect(toRect, fromRect) },
            { transformOrigin: '0 0', transform: 'none' },
          ],
          opts(),
        ),
      );
    }

    panel.querySelectorAll<HTMLElement>('[data-stagger]').forEach((el, i) => {
      running.push(
        el.animate(
          [
            { opacity: 0, transform: 'translateY(8px)' },
            { opacity: 1, transform: 'none' },
          ],
          opts({ duration: 220, delay: 120 + Math.min(i, STAGGER_MAX_STEPS) * STAGGER_STEP_MS }),
        ),
      );
    });
  }

  // Once the open has fully played, drop every animation so the panel is
  // just ordinary, unanimated DOM at rest. Not when a close has already
  // reversed them — those must hold their end state until unmount.
  const openAnimations = running;
  let reversed = false;
  void Promise.all(openAnimations.map((a) => a.finished))
    .then(() => {
      if (!disposed && !reversed) cleanup();
    })
    .catch(() => {
      // Cancelled by `dispose`/`cleanup` — nothing left to do.
    });

  // ---- Close --------------------------------------------------------------

  const close = (done: () => void) => {
    const finish = (anims: Animation[]) => {
      void Promise.all(anims.map((a) => a.finished))
        .then(() => {
          if (disposed) return;
          unhide();
          done();
        })
        .catch(() => {
          // Cancelled by `dispose` — the parent is already unmounting us.
        });
    };

    // Interrupted mid-open: run what's playing backwards from where it is.
    if (isRunning()) {
      reversed = true;
      for (const a of running) a.reverse();
      finish(running);
      return;
    }

    cleanup();
    const target = container && !reducedMotion ? findSource(container, sourceKey) : null;

    if (!container || !target) {
      running = [
        panel.animate(
          reducedMotion
            ? [{ opacity: 1 }, { opacity: 0 }]
            : [
                { opacity: 1, transform: 'none' },
                { opacity: 0, transform: 'scale(0.98)' },
              ],
          { duration: reducedMotion ? 150 : 160, easing: tokens.depart, fill: 'forwards' },
        ),
      ];
      finish(running);
      return;
    }

    const box = container.getBoundingClientRect();
    const cardRect = target.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
    const pairs = morphPairs(target, panel);
    const card = dressSurface(surface, target, container, box, new Set(pairs.map((p) => p.to.dataset.morph ?? '')));
    hide(target);

    const opts = (extra: KeyframeAnimationOptions = {}): KeyframeAnimationOptions => ({
      duration: tokens.boxCloseMs,
      easing: tokens.depart,
      fill: 'both',
      ...extra,
    });

    const clip = panel.animate([{ clipPath: FULL_CLIP }, { clipPath: clipTo(cardRect, box, radius) }], opts());
    running = [
      clip,
      // Content goes first (covered by the card's face), then the card's
      // own contents come back only once the window is nearly card-sized.
      surface.animate([{ opacity: 0 }, { opacity: 1 }], opts({ duration: 110, easing: 'linear' })),
      card.animate([{ opacity: 0 }, { opacity: 1 }], opts({ duration: 70, delay: tokens.boxCloseMs - 70, easing: 'linear' })),
    ];

    for (const { from, to } of pairs) {
      const fromRect = from.getBoundingClientRect();
      const toRect = to.getBoundingClientRect();
      const ghost = copyAt(from, box);
      morph.appendChild(ghost);
      running.push(
        ghost.animate([{ transform: mapRect(fromRect, toRect) }, { transform: 'none' }], opts()),
        ghost.animate([{ opacity: 0 }, { opacity: 1, offset: 0.45 }, { opacity: 1 }], opts({ easing: 'linear' })),
        to.animate(
          [
            { transformOrigin: '0 0', transform: 'none' },
            { transformOrigin: '0 0', transform: mapRect(toRect, fromRect) },
          ],
          opts(),
        ),
      );
    }

    finish([clip]);
  };

  return {
    close,
    dispose() {
      disposed = true;
      cleanup();
      unhide();
    },
  };
}
