import { useEffect, useRef, useState } from 'react';

import {
  formatMonthYearDigitsForDisplay,
  isoToMonthYearDigits,
  monthYearDigitsToIso,
  parseLegacyMonthYear,
} from '../../vault/monthYearFormat';
import { CalendarIcon } from './icons';

/**
 * A month/year field's editor — Card's Expiry only, today. Structurally
 * `DateInput.tsx`'s own twin, one digit-pair narrower: type four digits
 * (`MMYY`, a slash inserted after the second), or tap the calendar button
 * for a native `<input type="month">` picker — either way the value this
 * reports is always ISO `YYYY-MM`, same reasoning `dateFormat.ts` gives for
 * `DateInput`'s own `YYYY-MM-DD`.
 *
 * Typing only ever commits in two cases: the field is emptied (reports
 * `''`), or all four digits have been typed *and* they name a real month
 * (01–12). A partial in-progress typed value never overwrites what was last
 * committed. Four digits with an out-of-range month show a red border
 * instead of silently discarding what was typed.
 *
 * Seeds itself leniently: a strict `YYYY-MM` value converts directly, but a
 * pre-existing Card entry's Expiry — saved back when this was still a bare
 * text field — seeds via `parseLegacyMonthYear` instead, so opening the
 * editor on an old entry shows its expiry pre-filled rather than blank. See
 * `monthYearFormat.ts` for both conversions.
 */
export function MonthYearInput({
  id,
  value,
  onChange,
}: {
  id: string;
  /** ISO `YYYY-MM`, or `''` for no month set. May also be a not-yet-resaved
   * legacy free-text value — see `seedDigits` below. */
  value: string;
  onChange: (isoValue: string) => void;
}) {
  const [digits, setDigits] = useState(() => seedDigits(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  // Resync if the value changes out from under this component — e.g. the
  // month picker's own `onChange` below, or (defensively) a parent that
  // reloads a different entry into an editor instance that didn't remount.
  useEffect(() => {
    setDigits(seedDigits(value));
  }, [value]);

  const invalid = digits.length === 4 && monthYearDigitsToIso(digits) === null;

  const handleTextChange = (raw: string) => {
    const nextDigits = raw.replace(/\D/g, '').slice(0, 4);
    setDigits(nextDigits);

    if (nextDigits.length === 0) {
      onChange('');
    } else if (nextDigits.length === 4) {
      const iso = monthYearDigitsToIso(nextDigits);
      if (iso) onChange(iso);
      // Four digits but not a real month: leave the last committed value
      // alone (the red border communicates why nothing saved yet).
    }
    // 1–3 digits: mid-edit, nothing committed either way.
  };

  // The native month picker only understands a strict `YYYY-MM` — a legacy
  // free-text value that hasn't been retyped yet has nothing valid to show
  // it, same as `DateInput`'s own picker would have nothing to show a
  // malformed stored value.
  const pickerValue = /^\d{4}-\d{2}$/.test(value) ? value : '';

  return (
    <div className="flex gap-2">
      <input
        id={id}
        className={`field min-w-0 flex-1 ${invalid ? 'border-bad' : ''}`}
        inputMode="numeric"
        placeholder="MM/YY"
        value={formatMonthYearDigitsForDisplay(digits)}
        onChange={(e) => handleTextChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
      />
      <button
        type="button"
        className="btn-secondary shrink-0 px-2.5"
        onClick={() => pickerRef.current?.showPicker?.()}
        aria-label="Pick a month"
        title="Pick a month"
      >
        <CalendarIcon />
      </button>
      {/* Visually hidden, not display:none — Chromium's `showPicker()`
          requires the element to actually be rendered. Its own `onChange`
          is a second, independent way to commit a value (always a
          complete, valid month, since the browser's picker can't produce
          anything else). */}
      <input
        ref={pickerRef}
        type="month"
        className="sr-only"
        value={pickerValue}
        onChange={(e) => {
          onChange(e.target.value);
          setDigits(isoToMonthYearDigits(e.target.value));
        }}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}

function seedDigits(value: string): string {
  const strict = isoToMonthYearDigits(value);
  if (strict) return strict;
  const legacy = parseLegacyMonthYear(value);
  return legacy ? isoToMonthYearDigits(legacy) : '';
}
