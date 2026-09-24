import { describe, expect, it } from 'vitest';

import { groupEntriesForHomeScreen } from '@/vault/search';
import { VaultEntry } from '@/vault/types';

/**
 * `groupEntriesForHomeScreen`, tested in isolation from `Vault` — a plain
 * function over already-loaded `VaultEntry[]`, same reasoning
 * `entryTypes.test.ts` documents for `entryTypesForPicker`, which this
 * mirrors on the entries side rather than the types side.
 */

function entry(id: string, type: string): VaultEntry {
  return { id, type, title: id, fields: [], updatedAt: 0, needsReview: false };
}

describe('groupEntriesForHomeScreen', () => {
  it('buckets the same way entryTypesForPicker buckets types: lead (no label), Access & Security, Others, Notes', () => {
    const entries = [
      entry('login-1', 'login'),
      entry('card-1', 'card'),
      entry('wifi-1', 'wifi'),
      entry('phone-1', 'phone'),
      entry('note-1', 'secureNote'),
    ];

    const groups = groupEntriesForHomeScreen(entries);
    expect(groups.map((g) => g.category)).toEqual(['lead', 'access-security', 'others', 'notes']);
    expect(groups.map((g) => g.label)).toEqual(['', 'Access & Security', 'Others', 'Notes']);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['login-1', 'card-1']);
    expect(groups[1]!.entries.map((e) => e.id)).toEqual(['wifi-1']);
    expect(groups[2]!.entries.map((e) => e.id)).toEqual(['phone-1']);
    expect(groups[3]!.entries.map((e) => e.id)).toEqual(['note-1']);
  });

  it('puts every lead type — Login, Card, Bank Account, Identity Doc — in the same unlabeled group', () => {
    const entries = [entry('a', 'login'), entry('b', 'card'), entry('c', 'bank'), entry('d', 'identity')];
    const groups = groupEntriesForHomeScreen(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe('');
    expect(groups[0]!.entries).toHaveLength(4);
  });

  it('drops a bucket entirely when nothing lands in it, rather than rendering it empty', () => {
    const groups = groupEntriesForHomeScreen([entry('a', 'login')]);
    expect(groups).toEqual([{ category: 'lead', label: '', entries: [entry('a', 'login')] }]);
  });

  it('returns nothing at all for an empty entry list', () => {
    expect(groupEntriesForHomeScreen([])).toEqual([]);
  });

  it('keeps every non-lead, non-access-security, non-notes type together under "Others"', () => {
    const entries = [
      entry('phone-1', 'phone'),
      entry('address-1', 'address'),
      entry('loyalty-1', 'loyalty'),
      entry('vehicle-1', 'vehicle'),
      entry('insurance-1', 'insurance'),
    ];
    const groups = groupEntriesForHomeScreen(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe('others');
    expect(groups[0]!.entries).toHaveLength(5);
  });

  it('treats an entry with no recognised type as login (the same migration fallback Vault applies), landing it in the lead group', () => {
    const groups = groupEntriesForHomeScreen([entry('mystery', 'not-a-real-type')]);
    expect(groups).toEqual([
      { category: 'lead', label: '', entries: [entry('mystery', 'not-a-real-type')] },
    ]);
  });

  it('preserves each bucket\'s input order rather than re-sorting it', () => {
    const entries = [entry('z-wifi', 'wifi'), entry('a-license', 'licenseKey'), entry('m-ssh', 'sshKey')];
    const groups = groupEntriesForHomeScreen(entries);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['z-wifi', 'a-license', 'm-ssh']);
  });
});
