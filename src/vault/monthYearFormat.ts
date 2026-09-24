/**
 * Month/year storage, display, and legacy-value conversion for Card's
 * Expiry (`dataType: 'monthYear'`) — the one field in the registry that's
 * genuinely just a month and a year, never a day; a card's printed expiry
 * has never had one. Mirrors `dateFormat.ts`'s own storage/display split
 * exactly, one digit-pair narrower: storage is ISO `YYYY-MM` (a valid ISO
 * 8601 partial date, sortable as a plain string like every other date this
 * app stores), typed and displayed as `MM/YY`.
 *
 * See `docs/card-expiry-derived-date.md` for why Card's Expiry stays this
 * narrow MM/YY field rather than becoming a full `dataType: 'date'` field
 * outright — the short version: a derived, full `YYYY-MM-DD` companion
 * field (`lastDayOfMonthIso`, below) is what actually feeds the Upcoming
 * feature, so nothing here needs a day of its own.
 */

/** Inserts `/` after two digits — `"0"` → `"0"`, `"08"` → `"08"`,
 * `"0827"` → `"08/27"`. Four digits total (`MMYY`), one pair narrower than
 * `formatDigitsForDisplay`'s eight. */
export function formatMonthYearDigitsForDisplay(digits: string): string {
  const d = digits.slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}/${d.slice(2)}`;
}

/** Four digits (`MMYY`) → ISO `YYYY-MM`, or `null` if the month isn't
 * 01–12. The year is always read as 20YY — no card issued before 2000 has
 * ever been valid, and none will hit the 2-digit-year ambiguity a full
 * century out for a very long time. */
export function monthYearDigitsToIso(digits: string): string | null {
  if (!/^\d{4}$/.test(digits)) return null;
  const month = Number(digits.slice(0, 2));
  const year = 2000 + Number(digits.slice(2, 4));
  if (month < 1 || month > 12) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
}

/** ISO `YYYY-MM` → the four raw digits (`MMYY`) the input edits — the
 * inverse of `monthYearDigitsToIso`, used to seed the field from a stored
 * value already in the canonical form. `''` for anything that isn't a
 * well-formed `YYYY-MM`. */
export function isoToMonthYearDigits(iso: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(iso);
  if (!match) return '';
  const [, year, month] = match;
  return `${month}${year!.slice(2)}`;
}

/**
 * Best-effort reading of whatever a pre-existing Card entry's Expiry
 * already holds, from before this field was `dataType: 'monthYear'` (it
 * used to be plain, unconstrained free text). Tries the shapes someone
 * would plausibly have typed into a bare text box for a card expiry —
 * `MM/YY`, `MM/YYYY`, `MMYY`, `MMYYYY` — before giving up and returning
 * `null`, which is what leaves a value like "N/A" or a card network's name
 * unparsed rather than guessed at. Never needed for a value already in the
 * new `YYYY-MM` form; callers reach for this only once that's already
 * failed to match — see `monthYearIsoToDisplay` and `MonthYearInput`.
 */
export function parseLegacyMonthYear(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const slash = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(trimmed);
  if (slash) {
    const month = Number(slash[1]);
    const yearPart = slash[2]!;
    const year = yearPart.length === 4 ? Number(yearPart) : 2000 + Number(yearPart);
    return month >= 1 && month <= 12 && year >= 2000 && year <= 2099
      ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
      : null;
  }

  if (/^\d{4}$/.test(trimmed)) return monthYearDigitsToIso(trimmed);

  if (/^\d{6}$/.test(trimmed)) {
    const month = Number(trimmed.slice(0, 2));
    const year = Number(trimmed.slice(2, 6));
    return month >= 1 && month <= 12 && year >= 2000 && year <= 2099
      ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
      : null;
  }

  return null;
}

/** ISO `YYYY-MM` → `MM/YY` for display. Falls back to `parseLegacyMonthYear`
 * before giving up, so a pre-existing Card entry's Expiry — still holding
 * whatever free text it always did, until the user next edits and saves it
 * — displays sensibly in read-only views too, not just in the editor's own
 * widget (which seeds itself the same lenient way). `''` only when neither
 * the strict nor the lenient parse can make sense of the value at all. */
export function monthYearIsoToDisplay(value: string): string {
  const strict = /^(\d{4})-(\d{2})$/.exec(value);
  if (strict) return `${strict[2]}/${strict[1]!.slice(2)}`;

  const legacy = parseLegacyMonthYear(value);
  if (!legacy) return '';
  const [year, month] = legacy.split('-');
  return `${month}/${year!.slice(2)}`;
}

/** ISO `YYYY-MM` → the four raw digits (`MMYY`), for typing into a target
 * field rather than displaying to the user — see `fillFormat.ts`. Skips the
 * `/` that `monthYearIsoToDisplay` inserts on purpose: a great many
 * real-world card-expiry inputs auto-insert their own `/` as the user
 * types, and typing ours into the same field collides with theirs (a
 * doubled or misplaced separator, sometimes silently dropped keystrokes).
 * Sending bare digits instead lets a field like that format them itself;
 * a plain unmasked field just ends up showing "0827" with no slash — wrong,
 * but visibly so, and easy for the user to fix by hand, unlike the
 * corruption a doubled separator causes. Falls back through
 * `parseLegacyMonthYear` the same way `monthYearIsoToDisplay` does, so a
 * pre-migration free-text Expiry still fills sensibly. `''` only when
 * neither parse can make sense of the value at all. */
export function monthYearIsoToFillDigits(value: string): string {
  const strict = isoToMonthYearDigits(value);
  if (strict) return strict;

  const legacy = parseLegacyMonthYear(value);
  return legacy ? isoToMonthYearDigits(legacy) : '';
}

/**
 * The last calendar day of the month `monthYearIso` (`YYYY-MM`) names, as a
 * full `YYYY-MM-DD` — a card printed "08/27" is valid *through* the end of
 * August 2027, not from the 1st, so this is the date that actually means
 * "expired" once it's passed. This is the value written to Card's derived
 * Expiry-date companion field — see `docs/card-expiry-derived-date.md`.
 *
 * `''` for anything that isn't a well-formed `YYYY-MM` with a real month.
 * Calendar-aware the same way `addInterval` is: `new Date(year, month, 0)`
 * — day 0 of the month *after* the target — is the standard way to land on
 * the target month's real last day without hand-coding each month's length
 * or leap-year February.
 */
export function lastDayOfMonthIso(monthYearIso: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(monthYearIso);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';

  const date = new Date(year, month, 0);
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
