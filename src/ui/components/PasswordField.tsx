import { useEffect, useRef, useState } from 'react';

import {
  CHARSETS,
  CHAR_CLASSES,
  DEFAULT_OPTIONS,
  GeneratorOptions,
  MAX_LENGTH,
  MIN_LENGTH,
  canDisable,
  estimateStrength,
  generatePassword,
} from '../../crypto/generator';
import { randomChoice } from '../../crypto/random';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { DiceIcon, EyeIcon, EyeOffIcon, RefreshIcon } from './icons';

const CLASS_LABELS: Record<(typeof CHAR_CLASSES)[number], string> = {
  uppercase: 'A-Z',
  lowercase: 'a-z',
  numbers: '0-9',
  symbols: '!@#',
};

/** Total run time of the generate/regenerate "slot machine" micro-interaction
 * — see `scrambleTo` below. */
const SCRAMBLE_DURATION_MS = 1500;
/** How often the still-unsettled characters get rerolled. Faster than this
 * just blurs into static noise; slower and it stops reading as a shuffle. */
const SCRAMBLE_FLICKER_MS = 45;
/** Characters lock in left-to-right, spread across this fraction of the
 * total duration — the last character lands here, and the remaining tail
 * is a brief settled hold (the landing flash lives in that hold). */
const SCRAMBLE_REVEAL_FRACTION = 0.82;

/** The noise glyphs the not-yet-landed characters flicker through, drawn
 * from whichever character classes the current options actually allow —
 * so the shuffle looks like it's genuinely searching the same character
 * space the real password comes from, not just generic static. */
function scrambleCharsetFor(options: GeneratorOptions): string {
  const pool = CHAR_CLASSES.filter((name) => options[name])
    .map((name) => CHARSETS[name])
    .join('');
  return pool || CHARSETS.lowercase;
}

function randomChar(charset: string): string {
  // Purely decorative noise — never the real generated password, which
  // `generatePassword` already produced from `crypto.getRandomValues`
  // before this animation starts. Still routed through the app's one
  // approved randomness source rather than `Math.random` (banned
  // repo-wide, see `crypto/random.ts`) for consistency.
  return randomChoice(charset.split(''));
}

/** A password input with an inline generator. */
export function PasswordField({
  value,
  onChange,
  id = 'password',
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [options, setOptions] = useState<GeneratorOptions>(DEFAULT_OPTIONS);
  // `docs/UI-UX-REVIEW.md` finding #5: this component had no reduced-motion
  // check at all, unlike `VaultDoors.tsx`'s door-slide (same hook, same
  // codebase) — the scramble's whole point is the flicker itself, so unlike
  // a slide there's no shortened-but-still-animated middle ground; "reduced"
  // here means skipping it outright and landing on the real value straight
  // away, same as a settings-drag's existing non-animated path already does.
  const prefersReducedMotion = usePrefersReducedMotion();

  // The scramble animation's own transient display text — kept separate
  // from `value` so a keystroke the user types mid-edit never has to round-
  // trip through this component's state (the input reads straight from
  // `value` whenever `animating` is false, same as before this feature).
  const [animating, setAnimating] = useState(false);
  const [displayValue, setDisplayValue] = useState('');
  // A brief true right as the animation lands, driving the input's landing
  // glow — see the `className` below. Cleared on its own short timer.
  const [justLanded, setJustLanded] = useState(false);
  const rafRef = useRef<number | null>(null);
  const glowTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (glowTimeoutRef.current !== null) window.clearTimeout(glowTimeoutRef.current);
    },
    [],
  );

  const scrambleTo = (target: string, charset: string) => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (glowTimeoutRef.current !== null) window.clearTimeout(glowTimeoutRef.current);

    const chars = target.split('');
    const startTime = performance.now();
    let lastFlicker = 0;

    const step = (now: number) => {
      const t = Math.min((now - startTime) / SCRAMBLE_DURATION_MS, 1);

      // Throttled independently of the animation frame rate — see
      // `SCRAMBLE_FLICKER_MS`'s doc.
      if (now - lastFlicker >= SCRAMBLE_FLICKER_MS || t >= 1) {
        lastFlicker = now;
        let out = '';
        for (let i = 0; i < chars.length; i++) {
          const lockAt = ((i + 1) / chars.length) * SCRAMBLE_REVEAL_FRACTION;
          out += t >= lockAt ? chars[i] : randomChar(charset);
        }
        setDisplayValue(out);
      }

      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
        return;
      }

      setDisplayValue(target);
      setAnimating(false);
      rafRef.current = null;
      setJustLanded(true);
      glowTimeoutRef.current = window.setTimeout(() => setJustLanded(false), 450);
    };

    setJustLanded(false);
    setAnimating(true);
    rafRef.current = requestAnimationFrame(step);
  };

  // `animate` is false for a length-slider drag or a character-class
  // toggle — those already regenerate as a side effect of the setting
  // changing, but firing the full 1.5s shuffle on every drag tick would be
  // chaotic rather than delightful. The dice button and the panel's own
  // "Regenerate" pass `animate: true`. Either way the freshly generated
  // password is shown, not hidden — see the `setRevealed(true)` below.
  const regenerate = (next: GeneratorOptions, animate = false) => {
    setOptions(next);
    const password = generatePassword(next);
    setRevealed(true);
    onChange(password);

    if (animate && !prefersReducedMotion) {
      scrambleTo(password, scrambleCharsetFor(next));
    } else if (rafRef.current !== null) {
      // A settings tweak landed mid-shuffle — let the new value win
      // outright rather than have two sequences fight over the field.
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      setAnimating(false);
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          id={id}
          className={`field font-mono tabular-nums tracking-wide transition-shadow duration-300 ${
            justLanded ? 'shadow-[0_0_0_3px_rgb(var(--accent)/0.35)]' : ''
          }`}
          type={revealed ? 'text' : 'password'}
          value={animating ? displayValue : value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={animating}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn-secondary px-2.5"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          title={revealed ? 'Hide password' : 'Show password'}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
        <button
          type="button"
          className="btn-secondary px-2.5"
          disabled={animating}
          onClick={() => {
            setShowGenerator(true);
            regenerate(options, true);
          }}
          aria-label="Generate a password"
          title="Generate a password"
        >
          <DiceIcon />
        </button>
      </div>

      {value !== '' && <StrengthBar password={value} />}

      {showGenerator && (
        <GeneratorPanel
          options={options}
          animating={animating}
          onChange={(next) => regenerate(next, false)}
          onRegenerate={() => regenerate({ ...options }, true)}
          onClose={() => setShowGenerator(false)}
        />
      )}
    </div>
  );
}

export function StrengthBar({ password }: { password: string }) {
  const { score, label } = estimateStrength(password);
  const tones = ['bg-bad', 'bg-bad', 'bg-warn', 'bg-ok', 'bg-ok'];

  return (
    <div className="mt-2 flex items-center gap-2">
      <div className="flex h-1 flex-1 gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-full flex-1 rounded-full ${
              i <= score ? tones[score] : 'bg-ink-600'
            }`}
          />
        ))}
      </div>
      <span className="w-20 text-right text-xs text-slate-400">{label}</span>
    </div>
  );
}

function GeneratorPanel({
  options,
  animating,
  onChange,
  onRegenerate,
  onClose,
}: {
  options: GeneratorOptions;
  animating: boolean;
  onChange: (next: GeneratorOptions) => void;
  onRegenerate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="card mt-2 p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Generator
        </span>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onClose}>
          Done
        </button>
      </div>

      <label className="mb-3 block">
        <span className="mb-1 flex items-center justify-between text-xs text-slate-400">
          Length
          <span className="font-mono text-slate-200">{options.length}</span>
        </span>
        <input
          type="range"
          min={MIN_LENGTH}
          max={MAX_LENGTH}
          value={options.length}
          onChange={(e) => onChange({ ...options, length: Number(e.target.value) })}
          className="w-full accent-accent"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        {CHAR_CLASSES.map((name) => {
          const enabled = options[name];
          // The last enabled class cannot be turned off — there would be
          // nothing to generate from, so the button is disabled rather than
          // silently doing nothing.
          const locked = enabled && !canDisable(options, name);

          return (
            <button
              key={name}
              type="button"
              disabled={locked}
              title={locked ? 'At least one character type must stay on' : undefined}
              onClick={() => onChange({ ...options, [name]: !enabled })}
              className={`rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
                enabled
                  ? 'border-accent/40 bg-accent/15 text-accent'
                  : 'border-ink-500 bg-ink-700 text-slate-400'
              } ${locked ? 'cursor-not-allowed opacity-70' : ''}`}
            >
              {CLASS_LABELS[name]}
            </button>
          );
        })}

        <button
          type="button"
          className="btn-secondary ml-auto"
          disabled={animating}
          onClick={onRegenerate}
        >
          <RefreshIcon />
          Regenerate
        </button>
      </div>
    </div>
  );
}
