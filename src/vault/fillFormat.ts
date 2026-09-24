/**
 * What Manual Fill actually types for one field — as opposed to what
 * `FieldRow`/`monthYearIsoToDisplay`/`isoToDisplay` show the user. For most
 * `dataType`s the two are the same string. `'monthYear'` and `'date'` are
 * the exception: their canonical storage is ISO (`YYYY-MM` /
 * `YYYY-MM-DD`), and their *display* form inserts a `/` the user never
 * typed themselves — but a great many real-world card-expiry and date
 * inputs on the web insert that same `/` on their own as the user types
 * digits. Typing the display string's `/` into a field that also inserts
 * its own collides with it (a doubled or misplaced separator); typing the
 * raw ISO string is worse still (a `-`, and the wrong field order
 * entirely). Sending bare digits — `MMYY` / `DDMMYYYY` — sidesteps both:
 * a masked field formats them itself, and a plain unmasked one just shows
 * the digits with no separator, which is visibly wrong rather than subtly
 * corrupted.
 *
 * Used by both fill paths: `VaultScreen.fillField` (Windows) and the
 * `window.__vaultFill` bridge `VaultIme.kt` reads from
 * (Android) — see `docs/MANUAL-FILL-DESIGN.md`.
 */
import { isoToDigits } from './dateFormat';
import type { FieldDataType } from './entryTypes';
import { monthYearIsoToFillDigits } from './monthYearFormat';

export function toFillText(dataType: FieldDataType, raw: string): string {
  if (dataType === 'monthYear') return monthYearIsoToFillDigits(raw) || raw;
  if (dataType === 'date') return isoToDigits(raw) || raw;
  return raw;
}
