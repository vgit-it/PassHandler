import { useState } from 'react';

import {
  CHAR_CLASSES,
  DEFAULT_OPTIONS,
  GeneratorOptions,
  MAX_LENGTH,
  MIN_LENGTH,
  canDisable,
  estimateStrength,
  generatePassword,
} from '../../crypto/generator';
import { DiceIcon, EyeIcon, EyeOffIcon, RefreshIcon } from './icons';

const CLASS_LABELS: Record<(typeof CHAR_CLASSES)[number], string> = {
  uppercase: 'A-Z',
  lowercase: 'a-z',
  numbers: '0-9',
  symbols: '!@#',
};

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

  const regenerate = (next: GeneratorOptions) => {
    setOptions(next);
    onChange(generatePassword(next));
  };

  return (
    <div>
      <div className="flex gap-2">
        <input
          id={id}
          className="field font-mono"
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
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
          onClick={() => {
            setShowGenerator(true);
            regenerate(options);
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
          onChange={regenerate}
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
  onChange,
  onClose,
}: {
  options: GeneratorOptions;
  onChange: (next: GeneratorOptions) => void;
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
          onClick={() => onChange({ ...options })}
        >
          <RefreshIcon />
          Regenerate
        </button>
      </div>
    </div>
  );
}
