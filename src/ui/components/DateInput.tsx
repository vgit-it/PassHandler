import { useEffect, useRef, useState } from 'react';

import { digitsToIso, formatDigitsForDisplay, isoToDigits } from '../../vault/dateFormat';
import { CalendarIcon } from './icons';

/**
 * A date field's editor: type eight digits (`DDMMYYYY`, slashes inserted as
 * you go), or tap the calendar button for a native picker — either way the
 * value this reports is always ISO `YYYY-MM-DD` (see `dateFormat.ts`'s own
 * doc comment for why that storage format matters beyond just this field).
 *
 * Typing only ever commits in two cases: the field is emptied (reports
 * `''`), or all eight digits have been typed *and* they name a real
 * calendar date (reports the ISO string). A partial or invalid in-progress
 * typed date does not overwrite whatever was last committed — clearing
 * three digits of a date you're revising shouldn't blank it out from under
 * you before you've finished retyping it. Eight digits that don't name a
 * real date (a Feb 30) show a red border instead of silently discarding
 * what you typed or falling back to the old value.
 *
 * This is the plain single-field widget only — no renewal concept lives
 * here. A date field that wants "+ Renewal date" renders
 * `DateFieldWithRenewal` instead, which wraps this component and adds a
 * second, connected date field alongside it; see that component's own doc
 * and `date-renewal-field-redesign.md` for why the split.
 */
export function DateInput({
  id,
  value,
  onChange,
}: {
  id: string;
  /** ISO `YYYY-MM-DD`, or `''` for no date set. */
  value: string;
  onChange: (isoValue: string) => void;
}) {
  const [digits, setDigits] = useState(() => isoToDigits(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  // Resync if the value changes out from under this component — e.g. the
  // calendar picker's own `onChange` below, or (defensively) a parent that
  // reloads a different entry into an editor instance that didn't remount.
  useEffect(() => {
    setDigits(isoToDigits(value));
  }, [value]);

  const invalid = digits.length === 8 && digitsToIso(digits) === null;

  const handleTextChange = (raw: string) => {
    const nextDigits = raw.replace(/\D/g, '').slice(0, 8);
    setDigits(nextDigits);

    if (nextDigits.length === 0) {
      onChange('');
    } else if (nextDigits.length === 8) {
      const iso = digitsToIso(nextDigits);
      if (iso) onChange(iso);
      // Eight digits but not a real date: leave the last committed value
      // alone (the red border communicates why nothing saved yet).
    }
    // 1–7 digits: mid-edit, nothing committed either way.
  };

  return (
    <div className="flex gap-2">
      <input
        id={id}
        // `min-w-0 flex-1`, not just `.field`'s own `w-full` — the calendar
        // button is a sibling in this same row, and a plain text input's
        // default intrinsic min-width is wide enough to push it off
        // narrower screens without this.
        className={`field min-w-0 flex-1 ${invalid ? 'border-bad' : ''}`}
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        value={formatDigitsForDisplay(digits)}
        onChange={(e) => handleTextChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
      />
      <button
        type="button"
        className="btn-secondary shrink-0 px-2.5"
        onClick={() => pickerRef.current?.showPicker?.()}
        aria-label="Pick a date"
        title="Pick a date"
      >
        <CalendarIcon />
      </button>
      {/* Visually hidden, not display:none — Chromium's `showPicker()`
          requires the element to actually be rendered. Its own `onChange`
          is a second, independent way to commit a value (always a
          complete, valid date, since the browser's picker can't produce
          anything else). */}
      <input
        ref={pickerRef}
        type="date"
        className="sr-only"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setDigits(isoToDigits(e.target.value));
        }}
        tabIndex={-1}
        aria-hidden="true"
      />
    </div>
  );
}

/** One Y/M/D box in an interval row — a plain digit field with its unit as
 * a trailing suffix inside the same box, rather than a separate label, to
 * keep three of them fitting comfortably on one line next to a button.
 * Exported for `DateFieldWithRenewal`'s calculator panel, the one other
 * place an interval gets typed in. */
export function RenewUnitInput({
  value,
  suffix,
  unitLabel,
  onChange,
}: {
  value: string;
  suffix: string;
  unitLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <span className="flex items-center overflow-hidden rounded-md border border-ink-600 bg-ink-800">
      <input
        type="text"
        inputMode="numeric"
        className="w-9 bg-transparent px-1.5 py-1 text-right text-sm text-slate-100 outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 3))}
        aria-label={unitLabel}
      />
      <span className="pr-2 text-xs text-slate-400">{suffix}</span>
    </span>
  );
}
