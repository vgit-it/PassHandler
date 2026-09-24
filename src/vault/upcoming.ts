/**
 * The Upcoming tab's own logic — bucketing tracked date fields by how soon
 * they're due. See `upcoming-tab-design.md` for the full design.
 *
 * Deliberately dependency-free, same reasoning `emailSuggestions.ts` and
 * `search.ts`'s own pure helpers give: plain `VaultEntry[]` in, a rendering
 * shape out, no `Vault`/React/`kdbxweb` import, so this is fully
 * unit-testable without a real vault and without mocking the clock —
 * `todayIso` is a parameter, not read internally.
 */

import { addInterval } from './dateFormat';
import { EntryField, VaultEntry } from './types';

/** One tracked field, due or overdue. Each is its own row — an entry with
 * two tracked dates (its own date, plus a renewal companion) produces two
 * independent items, possibly landing in two different buckets. */
export interface UpcomingItem {
  entry: VaultEntry;
  field: EntryField;
  /** Whole calendar days from `todayIso` to `field.value`. Negative means
   * overdue; `0` means due today. */
  daysUntil: number;
}

export type UpcomingBucketId = 'overdue' | 'week' | 'month' | 'quarter' | 'half-year';

export interface UpcomingBucket {
  id: UpcomingBucketId;
  label: string;
  items: UpcomingItem[];
}

const BUCKET_ORDER: UpcomingBucketId[] = ['overdue', 'week', 'month', 'quarter', 'half-year'];

const BUCKET_LABELS: Record<UpcomingBucketId, string> = {
  overdue: 'Overdue',
  week: 'This week',
  month: 'This month',
  quarter: 'Next 3 months',
  'half-year': '3–6 months',
};

/** Whole calendar days from `fromIso` to `toIso` (both `YYYY-MM-DD`) — `''`
 * or a malformed value on either side yields `null`. Computed via UTC
 * midnight rather than local-time subtraction so a daylight-saving
 * transition between the two dates never shifts the count by a day —
 * `Date.UTC` always reads its year/month/day arguments as UTC, so there is
 * no local offset to cross in the first place. */
function daysBetween(fromIso: string, toIso: string): number | null {
  const from = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fromIso);
  const to = /^(\d{4})-(\d{2})-(\d{2})$/.exec(toIso);
  if (!from || !to) return null;
  const fromUtc = Date.UTC(Number(from[1]), Number(from[2]) - 1, Number(from[3]));
  const toUtc = Date.UTC(Number(to[1]), Number(to[2]) - 1, Number(to[3]));
  return Math.round((toUtc - fromUtc) / 86_400_000);
}

/** The bucket boundaries from `upcoming-tab-design.md`'s "Grouping" table —
 * round day counts for grouping *within* the precise calendar cutoff
 * `buildUpcoming` applies separately. Only ever called with a `daysUntil`
 * that's already known to belong somewhere (overdue, or within the
 * cutoff) — there is no "too far out" bucket here, because a too-far-out
 * item is filtered out entirely before this runs. */
function bucketFor(daysUntil: number): UpcomingBucketId {
  if (daysUntil < 0) return 'overdue';
  if (daysUntil <= 7) return 'week';
  if (daysUntil <= 30) return 'month';
  if (daysUntil <= 90) return 'quarter';
  return 'half-year';
}

/**
 * Every tracked, `dataType: 'date'` field across `entries` that's either
 * overdue or due within six calendar months of `todayIso`, grouped into
 * buckets nearest-first, each bucket's own items sorted soonest-first (so
 * Overdue's most-negative — longest overdue — item sorts to the top of
 * that bucket, the same "most urgent first" reading the rest of the
 * buckets already give).
 *
 * The six-month cutoff is `addInterval(todayIso, 0, 6, 0)` — real calendar
 * arithmetic, not a flat 183-day count, so "6 months from March 31" lands
 * on September 30 the way a person means it, overflow and all (see
 * `addInterval`'s own doc). **Overdue is exempt from this cutoff** — an
 * expiry that already passed never ages out of the list just because it's
 * more than six months stale, same reasoning `EntryList`'s pinned "Review"
 * group already applies to `needsReview` entries: the thing that needs
 * attention doesn't get sorted away with everything else.
 *
 * A bucket with nothing in it is omitted from the result entirely, rather
 * than returned empty — same convention `groupEntriesForHomeScreen` follows
 * for its own buckets.
 */
export function buildUpcoming(entries: VaultEntry[], todayIso: string): UpcomingBucket[] {
  const cutoffIso = addInterval(todayIso, 0, 6, 0);
  const items: UpcomingItem[] = [];

  for (const entry of entries) {
    for (const field of entry.fields) {
      if (!field.trackedInUpcoming || field.dataType !== 'date' || field.value === '') continue;

      const daysUntil = daysBetween(todayIso, field.value);
      if (daysUntil === null) continue;
      // ISO `YYYY-MM-DD` compares lexicographically the same as
      // chronologically (see `dateFormat.ts`'s own doc), so this cutoff
      // check needs no parsing beyond what `daysBetween` already did.
      if (daysUntil >= 0 && field.value > cutoffIso) continue;

      items.push({ entry, field, daysUntil });
    }
  }

  items.sort((a, b) => a.daysUntil - b.daysUntil);

  const byBucket = new Map<UpcomingBucketId, UpcomingItem[]>();
  for (const item of items) {
    const id = bucketFor(item.daysUntil);
    const list = byBucket.get(id);
    if (list) list.push(item);
    else byBucket.set(id, [item]);
  }

  return BUCKET_ORDER.filter((id) => byBucket.has(id)).map((id) => ({
    id,
    label: BUCKET_LABELS[id],
    items: byBucket.get(id)!,
  }));
}

/** Whether *any* field, anywhere in `entries`, is opted into tracking —
 * independent of whether anything currently due exists. `UpcomingScreen`
 * uses this to tell "you haven't turned tracking on for anything yet" apart
 * from "you have, but nothing's due right now," which need different empty
 * states. */
export function hasAnyTrackedField(entries: VaultEntry[]): boolean {
  return entries.some((entry) => entry.fields.some((field) => field.trackedInUpcoming));
}
