import { useEffect, useRef, useState } from 'react';

import { BulbIcon } from './icons';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { ActiveTip } from '../hooks/useTipSequence';

/** Matches `--vault-t-ui`, the card's fade-out. */
const LEAVE_MS = 150;

/**
 * One first-run tip (`docs/ONBOARDING-TIPS-DESIGN.md`): the sentence, "1 of
 * 3" dots, Skip and Next/Done. A flex sibling in its screen's own layout,
 * never an overlay or a pointer anchored to a control — the vault frame,
 * doors and detail boxes move those around too much for an anchored
 * tooltip to stay put.
 *
 * Lavender (`--tip-*`, `index.css`) so it stands apart from every other
 * card — the one colour in the app that only ever means "tip". Same on
 * both platforms and both screens.
 */
export function TipCard({ tip }: { tip: ActiveTip }) {
  const reducedMotion = usePrefersReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  const last = tip.index + 1 === tip.count;
  // Fades out before the sequence actually ends, so the card doesn't just
  // vanish; a mid-sequence Next swaps only the sentence.
  const leaveThen = (done: () => void) => {
    if (reducedMotion) {
      done();
      return;
    }
    setLeaving(true);
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null;
      setLeaving(false);
      done();
    }, LEAVE_MS);
  };

  return (
    <div
      role="region"
      aria-label="Tip"
      className={`tip-card-in shrink-0 rounded-xl border border-tip-border bg-tip-fill px-4 pt-3 text-tip-fg transition-opacity duration-vault-ui ${
        leaving ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <div className="flex items-start gap-2">
        <BulbIcon className="mt-px h-4 w-4 shrink-0 text-tip-icon" />
        <div aria-live="polite">
          <p key={tip.index} className="tip-text-in text-[14px] leading-snug">
            {tip.text}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {tip.count > 1 && (
          <div className="flex gap-1.5" aria-label={`Tip ${tip.index + 1} of ${tip.count}`} role="img">
            {Array.from({ length: tip.count }, (_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full bg-tip-fg ${
                  i === tip.index ? '' : 'opacity-30'
                }`}
              />
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center">
          {!last && (
            <button
              type="button"
              className="min-h-[44px] px-3 text-[13px] text-tip-fg opacity-75 hover:opacity-100"
              onClick={() => leaveThen(tip.skip)}
            >
              Skip
            </button>
          )}
          {/* The 44px floor is the tap area; the drawn button sits inside
              it with room above and below. */}
          <button
            type="button"
            className="flex min-h-[44px] items-center"
            onClick={() => (last ? leaveThen(tip.next) : tip.next())}
          >
            <span className="rounded-lg bg-tip-button px-3.5 py-1.5 text-[13px] font-medium">
              {last ? 'Done' : 'Next'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
