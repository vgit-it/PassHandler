import { describe, expect, it } from 'vitest';

import { toFillText } from '@/vault/fillFormat';

/**
 * `toFillText`'s dispatch — the actual conversion logic is already covered
 * by `monthYearFormat.test.ts`'s `monthYearIsoToFillDigits` suite and
 * `dateFormat.test.ts`'s `isoToDigits` suite; this just checks each
 * `dataType` routes to the right one (or passes through untouched) and that
 * the raw-value fallback holds when a value can't be parsed at all.
 */
describe('toFillText', () => {
  it('converts a monthYear ISO value to bare MMYY digits', () => {
    expect(toFillText('monthYear', '2027-08')).toBe('0827');
  });

  it('converts a date ISO value to bare DDMMYYYY digits', () => {
    expect(toFillText('date', '2027-08-31')).toBe('31082027');
  });

  it('passes text, number, and multiline values through unchanged', () => {
    expect(toFillText('text', 'jane.doe')).toBe('jane.doe');
    expect(toFillText('number', '123')).toBe('123');
    expect(toFillText('multiline', 'line one\nline two')).toBe('line one\nline two');
  });

  it('falls back to the raw value when a monthYear/date value cannot be parsed at all', () => {
    expect(toFillText('monthYear', 'Visa')).toBe('Visa');
    expect(toFillText('date', 'not-a-date')).toBe('not-a-date');
  });

  it('still fills sensibly from a pre-migration free-text monthYear value', () => {
    expect(toFillText('monthYear', '08/27')).toBe('0827');
  });
});
