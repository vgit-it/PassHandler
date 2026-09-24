import { describe, expect, it } from 'vitest';

import { buildUpcoming, hasAnyTrackedField } from '@/vault/upcoming';
import { EntryField, VaultEntry } from '@/vault/types';

/**
 * `buildUpcoming`, tested in isolation from `Vault`/React — plain
 * `VaultEntry[]` in, buckets out, same reasoning `search.test.ts` and
 * `entryTypes.test.ts` give for their own pure helpers. `todayIso` is
 * always passed explicitly rather than read from the real clock, so every
 * case here is exact and reproducible regardless of when the suite runs.
 */

const TODAY = '2026-08-27';

function dateField(key: string, value: string, overrides: Partial<EntryField> = {}): EntryField {
  return {
    key,
    label: key,
    value,
    dataType: 'date',
    sensitive: false,
    copyable: true,
    fillable: true,
    custom: false,
    trackedInUpcoming: true,
    ...overrides,
  };
}

function entry(id: string, fields: EntryField[]): VaultEntry {
  return { id, type: 'identity', title: id, fields, updatedAt: 0, needsReview: false };
}

describe('buildUpcoming', () => {
  it('ignores an untracked date field entirely, however soon it is', () => {
    const entries = [entry('a', [dateField('expiry', '2026-08-28', { trackedInUpcoming: false })])];
    expect(buildUpcoming(entries, TODAY)).toEqual([]);
  });

  it('ignores a tracked field that is not a date, or has no value yet', () => {
    const entries = [
      entry('a', [
        dateField('notADate', 'hello', { dataType: 'text' }),
        dateField('empty', ''),
      ]),
    ];
    expect(buildUpcoming(entries, TODAY)).toEqual([]);
  });

  it('sorts a tracked field into the right bucket by whole days out', () => {
    const entries = [
      entry('overdue', [dateField('e', '2026-08-20')]), // 7 days ago
      entry('week', [dateField('e', '2026-09-03')]), // 7 days out
      entry('month', [dateField('e', '2026-09-04')]), // 8 days out
      entry('month2', [dateField('e', '2026-09-26')]), // 30 days out
      entry('quarter', [dateField('e', '2026-09-27')]), // 31 days out
      entry('quarter2', [dateField('e', '2026-11-25')]), // 90 days out
      entry('half-year', [dateField('e', '2026-11-26')]), // 91 days out
    ];
    const buckets = buildUpcoming(entries, TODAY);
    const bucketOf = (id: string) =>
      buckets.find((b) => b.items.some((item) => item.entry.id === id))?.id;

    expect(bucketOf('overdue')).toBe('overdue');
    expect(bucketOf('week')).toBe('week');
    expect(bucketOf('month')).toBe('month');
    expect(bucketOf('month2')).toBe('month');
    expect(bucketOf('quarter')).toBe('quarter');
    expect(bucketOf('quarter2')).toBe('quarter');
    expect(bucketOf('half-year')).toBe('half-year');
  });

  it('treats today itself as due, in "This week"', () => {
    const entries = [entry('a', [dateField('e', TODAY)])];
    const buckets = buildUpcoming(entries, TODAY);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.id).toBe('week');
    expect(buckets[0]!.items[0]!.daysUntil).toBe(0);
  });

  it('caps at exactly six calendar months out, inclusive of the cutoff date', () => {
    // addInterval('2026-08-27', 0, 6, 0) = '2027-02-27'.
    const entries = [
      entry('on-cutoff', [dateField('e', '2027-02-27')]),
      entry('past-cutoff', [dateField('e', '2027-02-28')]),
    ];
    const buckets = buildUpcoming(entries, TODAY);
    const ids = buckets.flatMap((b) => b.items.map((i) => i.entry.id));
    expect(ids).toEqual(['on-cutoff']);
  });

  it('never caps Overdue, however far in the past', () => {
    const entries = [entry('ancient', [dateField('e', '2010-01-01')])];
    const buckets = buildUpcoming(entries, TODAY);
    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.id).toBe('overdue');
  });

  it('produces one independent row per tracked field, even on the same entry', () => {
    const entries = [
      entry('policy', [
        dateField('start', '2026-08-28', { label: 'Start date' }),
        dateField('start-renewal', '2026-10-15', { label: 'Renewal date', renewalOf: 'start' }),
      ]),
    ];
    const buckets = buildUpcoming(entries, TODAY);
    const allItems = buckets.flatMap((b) => b.items);
    expect(allItems).toHaveLength(2);
    expect(allItems.map((i) => i.field.key).sort()).toEqual(['start', 'start-renewal']);
  });

  it('omits a bucket entirely when nothing lands in it', () => {
    const entries = [entry('a', [dateField('e', '2026-08-28')])]; // "This week"
    const buckets = buildUpcoming(entries, TODAY);
    expect(buckets.map((b) => b.id)).toEqual(['week']);
  });

  it('sorts within a bucket soonest first, and puts the longest-overdue item first in Overdue', () => {
    const entries = [
      entry('later', [dateField('e', '2026-09-01')]), // 5 days out
      entry('sooner', [dateField('e', '2026-08-29')]), // 2 days out
      entry('recently-overdue', [dateField('e', '2026-08-26')]), // 1 day overdue
      entry('long-overdue', [dateField('e', '2026-08-01')]), // 26 days overdue
    ];
    const buckets = buildUpcoming(entries, TODAY);
    const overdue = buckets.find((b) => b.id === 'overdue')!;
    expect(overdue.items.map((i) => i.entry.id)).toEqual(['long-overdue', 'recently-overdue']);
    const week = buckets.find((b) => b.id === 'week')!;
    expect(week.items.map((i) => i.entry.id)).toEqual(['sooner', 'later']);
  });

  it('returns nothing at all when there are no entries', () => {
    expect(buildUpcoming([], TODAY)).toEqual([]);
  });
});

describe('hasAnyTrackedField', () => {
  it('is false when nothing anywhere is tracked', () => {
    const entries = [entry('a', [dateField('e', '2026-08-28', { trackedInUpcoming: false })])];
    expect(hasAnyTrackedField(entries)).toBe(false);
  });

  it('is true if even one field on one entry is tracked, tracked field due or not', () => {
    const entries = [
      entry('a', [dateField('e', '2010-01-01', { trackedInUpcoming: false })]),
      entry('b', [dateField('e', '2099-01-01')]),
    ];
    expect(hasAnyTrackedField(entries)).toBe(true);
  });

  it('is false for an empty vault', () => {
    expect(hasAnyTrackedField([])).toBe(false);
  });
});
