import { describe, expect, it } from 'vitest';

import {
  collectKnownEmails,
  filterEmailSuggestions,
  isEmailFieldName,
  looksLikeEmail,
} from '@/vault/emailSuggestions';
import { EntryField, VaultEntry } from '@/vault/types';

/**
 * `collectKnownEmails`/`filterEmailSuggestions`, tested in isolation from
 * `Vault` — both are plain functions over already-loaded `VaultEntry[]`, the
 * same reasoning `fieldKeys.test.ts`/`dateFormat.test.ts` document for their
 * own pure helpers.
 */

function field(overrides: Partial<EntryField> & Pick<EntryField, 'key' | 'value'>): EntryField {
  return {
    label: overrides.key,
    dataType: 'text',
    sensitive: false,
    copyable: true,
    fillable: true,
    custom: true,
    ...overrides,
  };
}

function entry(id: string, fields: EntryField[], updatedAt = 0): VaultEntry {
  return { id, type: 'login', title: id, fields, updatedAt, needsReview: false };
}

describe('looksLikeEmail', () => {
  it('accepts a plausible address', () => {
    expect(looksLikeEmail('me@example.com')).toBe(true);
    expect(looksLikeEmail('  me@example.com  ')).toBe(true); // trims first
  });

  it('rejects anything that is not the whole value looking like an address', () => {
    expect(looksLikeEmail('')).toBe(false);
    expect(looksLikeEmail('not an email')).toBe(false);
    expect(looksLikeEmail('contact me at me@example.com please')).toBe(false);
    expect(looksLikeEmail('me@example')).toBe(false); // no TLD
    expect(looksLikeEmail('@example.com')).toBe(false); // no local part
  });
});

describe('isEmailFieldName', () => {
  it('matches "email" case-insensitively, anywhere in the name', () => {
    expect(isEmailFieldName('Email')).toBe(true);
    expect(isEmailFieldName('email')).toBe(true);
    expect(isEmailFieldName('Recovery Email')).toBe(true);
    expect(isEmailFieldName('EMAIL2')).toBe(true);
  });

  it('does not match an unrelated name', () => {
    expect(isEmailFieldName('Username')).toBe(false);
    expect(isEmailFieldName('SSID')).toBe(false);
  });
});

describe('collectKnownEmails', () => {
  it('gathers email-shaped values from any field on any entry, not just ones named "Email"', () => {
    const entries = [
      entry('a', [field({ key: 'email', value: 'work@example.com' })]),
      entry('b', [field({ key: 'RecoveryContact', value: 'personal@example.com' })]),
      entry('c', [field({ key: 'notes', value: 'call me about work@example.com sometime' })]),
    ];

    const known = collectKnownEmails(entries);
    expect(known).toContain('work@example.com');
    expect(known).toContain('personal@example.com');
    // The notes field's value isn't itself a bare email address, so it's not offered.
    expect(known).not.toContain('call me about work@example.com sometime');
  });

  it('dedupes case-insensitively, keeping the first-seen casing', () => {
    const entries = [
      entry('a', [field({ key: 'email', value: 'Me@Example.com' })]),
      entry('b', [field({ key: 'email', value: 'me@example.com' })]),
    ];

    expect(collectKnownEmails(entries)).toEqual(['Me@Example.com']);
  });

  it('excludes the given entry id — its own fields should never suggest back to themselves', () => {
    const entries = [
      entry('a', [field({ key: 'email', value: 'a@example.com' })]),
      entry('b', [field({ key: 'email', value: 'b@example.com' })]),
    ];

    expect(collectKnownEmails(entries, 'a')).toEqual(['b@example.com']);
  });

  it('never reads a sensitive field\'s value, since it is always \'\' on VaultEntry', () => {
    const entries = [entry('a', [field({ key: 'email', value: '', sensitive: true })])];
    expect(collectKnownEmails(entries)).toEqual([]);
  });
});

describe('filterEmailSuggestions', () => {
  const known = ['work@example.com', 'personal@example.com', 'other@sample.org'];

  it('returns everything (up to the limit) for an empty query', () => {
    expect(filterEmailSuggestions(known, '')).toEqual(known);
  });

  it('matches case-insensitively by substring', () => {
    expect(filterEmailSuggestions(known, 'EXAMPLE')).toEqual([
      'work@example.com',
      'personal@example.com',
    ]);
  });

  it('ranks prefix matches ahead of mid-string matches, otherwise preserving order', () => {
    // "personal@example.com" starts with "personal"; "work@example.com"
    // only contains "example" — a query of "example" itself should not
    // prefer one over the other by prefix (neither starts with it), but a
    // query that IS a prefix of one and not the other should promote it.
    expect(filterEmailSuggestions(['other@sample.org', 'sample@work.com'], 'sample')).toEqual([
      'sample@work.com',
      'other@sample.org',
    ]);
  });

  it('drops an exact match to the query itself', () => {
    expect(filterEmailSuggestions(known, 'work@example.com')).toEqual([]);
  });

  it('caps the result at the given limit', () => {
    const many = ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'];
    expect(filterEmailSuggestions(many, '', 2)).toEqual(['a@x.com', 'b@x.com']);
  });
});
