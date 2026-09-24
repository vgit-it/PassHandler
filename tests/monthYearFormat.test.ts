import { describe, expect, it } from 'vitest';

import {
  formatMonthYearDigitsForDisplay,
  isoToMonthYearDigits,
  lastDayOfMonthIso,
  monthYearDigitsToIso,
  monthYearIsoToDisplay,
  monthYearIsoToFillDigits,
  parseLegacyMonthYear,
} from '@/vault/monthYearFormat';

/**
 * `MonthYearInput`'s conversion logic, tested in isolation — same reasoning
 * `dateFormat.test.ts` documents, one digit-pair narrower.
 */
describe('monthYearFormat', () => {
  describe('formatMonthYearDigitsForDisplay', () => {
    it('inserts a slash after two digits', () => {
      expect(formatMonthYearDigitsForDisplay('0')).toBe('0');
      expect(formatMonthYearDigitsForDisplay('08')).toBe('08');
      expect(formatMonthYearDigitsForDisplay('0827')).toBe('08/27');
    });

    it('truncates past four digits', () => {
      expect(formatMonthYearDigitsForDisplay('08279999')).toBe('08/27');
    });
  });

  describe('monthYearDigitsToIso', () => {
    it('converts a valid MMYY to ISO, reading the year as 20YY', () => {
      expect(monthYearDigitsToIso('0827')).toBe('2027-08');
      expect(monthYearDigitsToIso('0100')).toBe('2000-01');
      expect(monthYearDigitsToIso('1299')).toBe('2099-12');
    });

    it('rejects an out-of-range month', () => {
      expect(monthYearDigitsToIso('1327')).toBeNull(); // month 13
      expect(monthYearDigitsToIso('0027')).toBeNull(); // month 0
    });

    it('rejects anything that is not exactly four digits', () => {
      expect(monthYearDigitsToIso('082')).toBeNull();
      expect(monthYearDigitsToIso('08277')).toBeNull();
      expect(monthYearDigitsToIso('')).toBeNull();
    });
  });

  describe('isoToMonthYearDigits', () => {
    it('round-trips through digits and back', () => {
      const iso = '2027-08';
      const digits = isoToMonthYearDigits(iso);
      expect(digits).toBe('0827');
      expect(monthYearDigitsToIso(digits)).toBe(iso);
    });

    it('returns empty string for anything that is not a well-formed YYYY-MM', () => {
      expect(isoToMonthYearDigits('')).toBe('');
      expect(isoToMonthYearDigits('not-a-date')).toBe('');
      expect(isoToMonthYearDigits('2027-08-15')).toBe('');
    });
  });

  describe('parseLegacyMonthYear', () => {
    it('reads MM/YY and MM/YYYY', () => {
      expect(parseLegacyMonthYear('08/27')).toBe('2027-08');
      expect(parseLegacyMonthYear('8/27')).toBe('2027-08');
      expect(parseLegacyMonthYear('08/2027')).toBe('2027-08');
      expect(parseLegacyMonthYear(' 08 / 27 ')).toBe('2027-08');
    });

    it('reads bare MMYY and MMYYYY digit runs', () => {
      expect(parseLegacyMonthYear('0827')).toBe('2027-08');
      expect(parseLegacyMonthYear('082027')).toBe('2027-08');
    });

    it('rejects an out-of-range month or an unreasonable year', () => {
      expect(parseLegacyMonthYear('13/27')).toBeNull();
      expect(parseLegacyMonthYear('08/1999')).toBeNull();
      expect(parseLegacyMonthYear('08/2100')).toBeNull();
    });

    it('rejects free text — a card network name, "N/A", and the like', () => {
      expect(parseLegacyMonthYear('Visa')).toBeNull();
      expect(parseLegacyMonthYear('N/A')).toBeNull();
      expect(parseLegacyMonthYear('')).toBeNull();
      expect(parseLegacyMonthYear('   ')).toBeNull();
    });
  });

  describe('monthYearIsoToDisplay', () => {
    it('formats a strict YYYY-MM as MM/YY', () => {
      expect(monthYearIsoToDisplay('2027-08')).toBe('08/27');
    });

    it('falls back to the legacy parse for a pre-existing free-text value', () => {
      expect(monthYearIsoToDisplay('08/27')).toBe('08/27');
      expect(monthYearIsoToDisplay('0827')).toBe('08/27');
    });

    it('returns empty string when neither parse can make sense of the value', () => {
      expect(monthYearIsoToDisplay('')).toBe('');
      expect(monthYearIsoToDisplay('Visa')).toBe('');
    });
  });

  describe('monthYearIsoToFillDigits', () => {
    it('formats a strict YYYY-MM as bare MMYY digits, no slash', () => {
      expect(monthYearIsoToFillDigits('2027-08')).toBe('0827');
    });

    it('falls back to the legacy parse for a pre-existing free-text value', () => {
      expect(monthYearIsoToFillDigits('08/27')).toBe('0827');
      expect(monthYearIsoToFillDigits('082027')).toBe('0827');
    });

    it('returns empty string when neither parse can make sense of the value', () => {
      expect(monthYearIsoToFillDigits('')).toBe('');
      expect(monthYearIsoToFillDigits('Visa')).toBe('');
    });
  });

  describe('lastDayOfMonthIso', () => {
    it('lands on the real last day of the named month', () => {
      expect(lastDayOfMonthIso('2027-08')).toBe('2027-08-31'); // 31-day month
      expect(lastDayOfMonthIso('2027-04')).toBe('2027-04-30'); // 30-day month
      expect(lastDayOfMonthIso('2027-02')).toBe('2027-02-28'); // non-leap February
    });

    it('is leap-year aware', () => {
      expect(lastDayOfMonthIso('2028-02')).toBe('2028-02-29'); // 2028 is a leap year
      expect(lastDayOfMonthIso('2000-02')).toBe('2000-02-29'); // divisible by 400
      expect(lastDayOfMonthIso('1900-02')).toBe('1900-02-28'); // divisible by 100, not 400
    });

    it('returns empty string for a malformed or out-of-range value', () => {
      expect(lastDayOfMonthIso('')).toBe('');
      expect(lastDayOfMonthIso('not-a-date')).toBe('');
      expect(lastDayOfMonthIso('2027-13')).toBe('');
      expect(lastDayOfMonthIso('2027-08-15')).toBe('');
    });
  });
});
