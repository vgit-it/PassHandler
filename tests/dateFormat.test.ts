import { describe, expect, it } from 'vitest';

import {
  addInterval,
  digitsToIso,
  formatDigitsForDisplay,
  isoToDigits,
  isoToDisplay,
} from '@/vault/dateFormat';

/**
 * `DateInput`'s conversion logic, tested in isolation — plain string/date
 * manipulation, same reasoning as `fieldKeys.test.ts`.
 */
describe('dateFormat', () => {
  describe('formatDigitsForDisplay', () => {
    it('inserts slashes as digits accumulate', () => {
      expect(formatDigitsForDisplay('1')).toBe('1');
      expect(formatDigitsForDisplay('15')).toBe('15');
      expect(formatDigitsForDisplay('1506')).toBe('15/06');
      expect(formatDigitsForDisplay('15062031')).toBe('15/06/2031');
    });

    it('truncates past eight digits', () => {
      expect(formatDigitsForDisplay('150620319999')).toBe('15/06/2031');
    });
  });

  describe('digitsToIso', () => {
    it('converts a valid DDMMYYYY to ISO', () => {
      expect(digitsToIso('15062031')).toBe('2031-06-15');
      expect(digitsToIso('01012000')).toBe('2000-01-01');
    });

    it('rejects an out-of-range month or day', () => {
      expect(digitsToIso('15132031')).toBeNull(); // month 13
      expect(digitsToIso('32062031')).toBeNull(); // day 32
      expect(digitsToIso('00062031')).toBeNull(); // day 0
    });

    it('rejects a day that does not exist in that month (rollover check)', () => {
      expect(digitsToIso('30022031')).toBeNull(); // Feb 30
      expect(digitsToIso('31042031')).toBeNull(); // Apr 31
      expect(digitsToIso('29022000')).toBe('2000-02-29'); // 2000 is a leap year
      expect(digitsToIso('29022001')).toBeNull(); // 2001 is not
    });

    it('rejects anything that is not exactly eight digits', () => {
      expect(digitsToIso('1506203')).toBeNull();
      expect(digitsToIso('150620311')).toBeNull();
      expect(digitsToIso('')).toBeNull();
    });
  });

  describe('isoToDisplay / isoToDigits', () => {
    it('round-trips through digits and back', () => {
      const iso = '2031-06-15';
      const digits = isoToDigits(iso);
      expect(digits).toBe('15062031');
      expect(digitsToIso(digits)).toBe(iso);
      expect(isoToDisplay(iso)).toBe('15/06/2031');
    });

    it('returns empty string for anything that is not a well-formed ISO date', () => {
      expect(isoToDisplay('')).toBe('');
      expect(isoToDisplay('not-a-date')).toBe('');
      expect(isoToDigits('')).toBe('');
      expect(isoToDigits('2031/06/15')).toBe('');
    });
  });

  describe('addInterval', () => {
    it('advances a given anchor by years/months/days', () => {
      expect(addInterval('2025-03-12', 1, 0, 0)).toBe('2026-03-12');
      expect(addInterval('2025-03-12', 0, 6, 0)).toBe('2025-09-12');
      expect(addInterval('2025-03-12', 0, 0, 10)).toBe('2025-03-22');
      expect(addInterval('2025-03-12', 1, 2, 3)).toBe('2026-05-15');
    });

    it('normalises calendar overflow the way a real calendar would', () => {
      // Jan 31 + 1 month: February doesn't have 31 days, so this rolls into
      // March rather than landing on an invalid Feb 31 — same reasoning
      // `digitsToIso`'s own rollover test documents for typed dates.
      expect(addInterval('2025-01-31', 0, 1, 0)).toBe('2025-03-03');
      // 2024 is a leap year — Feb has 29 days, one day less overflow.
      expect(addInterval('2024-01-31', 0, 1, 0)).toBe('2024-03-02');
    });

    it('anchors to today when given null or a malformed anchor', () => {
      const expected = addInterval('', 0, 0, 5); // '' is not a well-formed ISO date
      expect(addInterval(null, 0, 0, 5)).toBe(expected);
      expect(addInterval('not-a-date', 0, 0, 5)).toBe(expected);
    });

    it('a zero interval returns the anchor date unchanged', () => {
      expect(addInterval('2025-03-12', 0, 0, 0)).toBe('2025-03-12');
    });
  });
});
