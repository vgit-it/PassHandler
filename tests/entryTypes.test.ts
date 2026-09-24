import { describe, expect, it } from 'vitest';

import {
  ENTRY_TYPES,
  entryTypesByCategory,
  entryTypesForPicker,
  getEntryType,
  isKnownEntryType,
  LOGIN_TYPE_ID,
  NOTES_FIELD,
  searchEntryTypes,
} from '@/vault/entryTypes';

describe('entryTypes registry', () => {
  it('gives every type a unique id', () => {
    const ids = ENTRY_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every type at least one template field', () => {
    for (const type of ENTRY_TYPES) {
      expect(type.templateFields.length).toBeGreaterThan(0);
    }
  });

  it('falls back to Login for an unknown id', () => {
    expect(getEntryType('not-a-real-type').id).toBe(LOGIN_TYPE_ID);
  });

  it('reports known ids correctly', () => {
    expect(isKnownEntryType('card')).toBe(true);
    expect(isKnownEntryType('not-a-real-type')).toBe(false);
  });

  it('groups every type into exactly one category', () => {
    const grouped = entryTypesByCategory();
    const total = grouped.reduce((sum, g) => sum + g.types.length, 0);
    expect(total).toBe(ENTRY_TYPES.length);
  });

  it('exposes a universal, optional, multiline Notes field', () => {
    expect(NOTES_FIELD.key).toBe('notes');
    expect(NOTES_FIELD.sensitive).toBe(false);
    expect(NOTES_FIELD.dataType).toBe('multiline');
    expect(NOTES_FIELD.optional).toBe(true);
  });

  // See `upcoming-tab-design.md`'s field audit — before this, Identity
  // Doc's Expiry was the only `dataType: 'date'` template field in the
  // whole registry. These four are the gap types it named, each given an
  // optional (so a blank one stays hidden, same as Identity Doc's own)
  // date field so the Upcoming feature has something built-in to track on
  // them, not just user-added custom fields.
  describe('the four date fields added for Upcoming', () => {
    it.each([
      ['licenseKey', 'expiry', 'Expiry'],
      ['loyalty', 'expiry', 'Expiry'],
      ['vehicle', 'registrationExpiry', 'Registration expiry'],
      ['insurance', 'expiry', 'Expiry'],
    ])('%s gets an optional date field (%s)', (typeId, key, label) => {
      const field = getEntryType(typeId).templateFields.find((f) => f.key === key);
      expect(field).toBeDefined();
      expect(field!.label).toBe(label);
      expect(field!.dataType).toBe('date');
      expect(field!.sensitive).toBe(false);
      expect(field!.optional).toBe(true);
    });
  });

  // See `card-expiry-derived-date.md` — Card's Expiry is deliberately the
  // one `monthYear` field in the registry, not `date`: it's genuinely
  // day-less, and `EntryEditor` derives a real `date` companion from it
  // rather than storing a day of its own here.
  it("gives Card's Expiry dataType 'monthYear', not 'date'", () => {
    const field = getEntryType('card').templateFields.find((f) => f.key === 'expiry');
    expect(field).toBeDefined();
    expect(field!.dataType).toBe('monthYear');
  });

  describe('entryTypesForPicker', () => {
    it('leads with Login, Card, Bank Account and Identity Doc, ungrouped', () => {
      const [lead] = entryTypesForPicker();
      expect(lead!.label).toBe('');
      expect(lead!.types.map((t) => t.id)).toEqual(['login', 'card', 'bank', 'identity']);
    });

    it('keeps Access & Security as its own group', () => {
      const [, accessSecurity] = entryTypesForPicker();
      expect(accessSecurity!.label).toBe('Access & Security');
      expect(accessSecurity!.types.map((t) => t.id)).toEqual([
        'wifi',
        'licenseKey',
        'sshKey',
        'backupCodes',
        'securityQa',
      ]);
    });

    it('puts every remaining type under one OTHERS group', () => {
      const [, , others] = entryTypesForPicker();
      expect(others!.label).toBe('OTHERS');
      expect(others!.types.map((t) => t.id)).toEqual([
        'phone',
        'address',
        'loyalty',
        'vehicle',
        'insurance',
        'secureNote',
      ]);
    });

    it('accounts for every registered type exactly once', () => {
      const total = entryTypesForPicker().reduce((sum, g) => sum + g.types.length, 0);
      expect(total).toBe(ENTRY_TYPES.length);
    });
  });

  describe('search', () => {
    it('matches by label', () => {
      expect(searchEntryTypes('card').some((t) => t.id === 'card')).toBe(true);
    });

    it('matches by alias', () => {
      expect(searchEntryTypes('wi-fi').some((t) => t.id === 'wifi')).toBe(true);
    });

    it('ranks an exact label match first', () => {
      const results = searchEntryTypes('login');
      expect(results[0]!.id).toBe(LOGIN_TYPE_ID);
    });

    it('returns everything for an empty query', () => {
      expect(searchEntryTypes('   ')).toHaveLength(ENTRY_TYPES.length);
    });
  });
});
