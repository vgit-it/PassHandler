/**
 * Date storage/display conversion for `dataType: 'date'` fields.
 *
 * Storage is always ISO 8601 (`YYYY-MM-DD`) — the same format the native
 * `<input type="date">` element already produced before `DateInput`
 * (`ui/components/DateInput.tsx`) existed, and the one every other client
 * (KeePassXC, a future non-JS tool) can sort and parse without guessing a
 * locale. Display is DD/MM/YYYY, typed as eight digits — see `DateInput`'s
 * own doc comment for why.
 *
 * Deliberately dependency-free, same as `entryTypes.ts` — plain data in,
 * plain data out, importable from a test with no setup. This file is also
 * where a future "what's coming up" feature would start: every entry's
 * date-typed fields are already stored in this one sortable format, so
 * scanning for "due soon" needs no schema change, just a reader of this
 * format.
 */

/** Inserts `/` as the user types eight digits — `"1"` → `"1"`, `"1506"` →
 * `"15/06"`, `"15062031"` → `"15/06/2031"`. Takes raw digits only; callers
 * strip non-digits first (see `DateInput`). */
export function formatDigitsForDisplay(digits: string): string {
  const d = digits.slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/**
 * Eight digits (`DDMMYYYY`) → ISO `YYYY-MM-DD`, or `null` if they don't name
 * a real calendar date (a wrong day-of-month for that month/year included —
 * `new Date(y, m, d)` rolling over to the next month is exactly how that's
 * caught below, not just a range check on `d`).
 */
export function digitsToIso(digits: string): string | null {
  if (!/^\d{8}$/.test(digits)) return null;

  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ISO `YYYY-MM-DD` → `DD/MM/YYYY` for display; `''` (or anything that
 * isn't a well-formed ISO date) → `''`. */
export function isoToDisplay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${day}/${month}/${year}`;
}

/** ISO `YYYY-MM-DD` → the eight raw digits `DateInput`'s text field edits
 * (`DDMMYYYY`) — the inverse of `digitsToIso`, used to seed the field from
 * a stored value. `''` for anything that isn't a well-formed ISO date. */
export function isoToDigits(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${day}${month}${year}`;
}

/**
 * `anchorIso` (or today, if `null` or not a well-formed ISO date) advanced
 * by a Y/M/D interval — the calculation behind the date-renewal feature's
 * "Calculate…" panel, see `date-renewal-field-redesign.md`. Uses `Date`'s
 * own field setters, not manual day arithmetic, so it normalises overflow
 * the way a calendar would (Jan 31 + 1 month lands on Mar 3, not an invalid
 * Feb 31) — unlike `digitsToIso`, there is no invalid result to guard
 * against here; whatever comes out is always a real date.
 */
export function addInterval(
  anchorIso: string | null,
  years: number,
  months: number,
  days: number,
): string {
  const match = anchorIso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(anchorIso) : null;
  const target = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date();
  target.setFullYear(target.getFullYear() + years);
  target.setMonth(target.getMonth() + months);
  target.setDate(target.getDate() + days);
  return `${String(target.getFullYear()).padStart(4, '0')}-${String(
    target.getMonth() + 1,
  ).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
}
