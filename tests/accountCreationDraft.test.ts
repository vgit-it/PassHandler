import { describe, expect, it } from 'vitest';

import { DEFAULT_OPTIONS } from '@/crypto/generator';
import { ENTRY_TYPES, LOGIN_TYPE_ID } from '@/vault/entryTypes';
import {
  DraftState,
  draftFieldDefsForType,
  draftSnapshot,
  draftToEntryInput,
  emptyDraft,
  hasDraftContent,
  listEntryTypeOptions,
} from '@/vault/accountCreationDraft';

describe('draftFieldDefsForType', () => {
  it('gives Login its own fixed five fields, not the registry pair', () => {
    const keys = draftFieldDefsForType(LOGIN_TYPE_ID).map((f) => f.key);
    expect(keys).toEqual(['username', 'email', 'password', 'url', 'notes']);
    expect(draftFieldDefsForType(LOGIN_TYPE_ID).find((f) => f.key === 'password')?.sensitive).toBe(true);
  });

  it("appends Notes to a non-Login type's own template fields", () => {
    const keys = draftFieldDefsForType('wifi').map((f) => f.key);
    expect(keys).toEqual(['ssid', 'password', 'notes']);
  });

  // The exact assertion that would have caught this file's own bug before
  // it shipped: `store.tsx` had silently drifted back to a fixed Login-only
  // draft shape, which left the IME's creation panel with nothing to render
  // for any draft of any type — see this module's own top doc.
  it('gives every registered entry type a non-empty draft field list', () => {
    for (const type of ENTRY_TYPES) {
      expect(draftFieldDefsForType(type.id).length).toBeGreaterThan(0);
    }
  });

  it('falls back to Login for an unrecognised type', () => {
    expect(draftFieldDefsForType('not-a-real-type')).toEqual(draftFieldDefsForType(LOGIN_TYPE_ID));
  });
});

describe('draftSnapshot', () => {
  it('marks only the password field as generatable', () => {
    const snapshot = draftSnapshot(emptyDraft(LOGIN_TYPE_ID));
    const byKey = new Map(snapshot.fields.map((f) => [f.key, f]));
    expect(byKey.get('password')?.canGenerate).toBe(true);
    expect(byKey.get('username')?.canGenerate).toBe(false);
    expect(byKey.get('email')?.canGenerate).toBe(false);
  });

  it('marks only email-named fields as pickable from the vault', () => {
    const snapshot = draftSnapshot(emptyDraft(LOGIN_TYPE_ID));
    const byKey = new Map(snapshot.fields.map((f) => [f.key, f]));
    expect(byKey.get('email')?.canPickFromVault).toBe(true);
    expect(byKey.get('username')?.canPickFromVault).toBe(false);
    expect(byKey.get('password')?.canPickFromVault).toBe(false);
  });

  it('round-trips field values already on the draft, defaulting untouched ones to empty', () => {
    const draft: DraftState = {
      type: LOGIN_TYPE_ID,
      title: 'Example',
      fields: { username: 'jdoe' },
      passwordOptions: DEFAULT_OPTIONS,
    };
    const byKey = new Map(draftSnapshot(draft).fields.map((f) => [f.key, f.value]));
    expect(byKey.get('username')).toBe('jdoe');
    expect(byKey.get('password')).toBe('');
  });

  it('reports password strength only once the password field has a value', () => {
    expect(draftSnapshot(emptyDraft(LOGIN_TYPE_ID)).passwordStrength).toBeNull();
    const draft: DraftState = {
      type: LOGIN_TYPE_ID,
      title: '',
      fields: { password: 'aaaa' },
      passwordOptions: DEFAULT_OPTIONS,
    };
    const strength = draftSnapshot(draft).passwordStrength;
    expect(strength).not.toBeNull();
    expect(strength?.score).toBeLessThanOrEqual(1);
  });

  it("labels the snapshot with the type's own registry label", () => {
    expect(draftSnapshot(emptyDraft('wifi')).typeLabel).toBe('WiFi');
  });
});

describe('hasDraftContent', () => {
  it('is false for a brand-new draft', () => {
    expect(hasDraftContent(emptyDraft())).toBe(false);
  });

  it('does not count a title-only draft — see the quiet-bias guess this guards against', () => {
    expect(hasDraftContent(emptyDraft(LOGIN_TYPE_ID, 'Some App'))).toBe(false);
  });

  it('is true once any field has a real value', () => {
    const draft: DraftState = { ...emptyDraft(), fields: { password: 'x' } };
    expect(hasDraftContent(draft)).toBe(true);
  });
});

describe('draftToEntryInput', () => {
  it("builds a Login draft's flat EntryInput properties, not a fields array", () => {
    const draft: DraftState = {
      type: LOGIN_TYPE_ID,
      title: 'Example',
      fields: { username: 'jdoe', password: 'secret' },
      passwordOptions: DEFAULT_OPTIONS,
    };
    const input = draftToEntryInput(draft);
    expect(input).toMatchObject({
      type: LOGIN_TYPE_ID,
      title: 'Example',
      username: 'jdoe',
      email: '',
      password: 'secret',
      url: '',
      notes: '',
    });
    expect(input.fields).toBeUndefined();
  });

  it("builds a non-Login draft's fields array, covering every field even when untouched", () => {
    const draft: DraftState = {
      type: 'wifi',
      title: 'Home network',
      fields: { ssid: 'MyWifi' },
      passwordOptions: DEFAULT_OPTIONS,
    };
    const input = draftToEntryInput(draft);
    expect(input.type).toBe('wifi');
    expect(input.username).toBeUndefined();
    expect(input.fields).toEqual([
      { key: 'ssid', value: 'MyWifi' },
      { key: 'password', value: '' },
      { key: 'notes', value: '' },
    ]);
  });

  it('falls back to "Untitled" when the draft has no title', () => {
    expect(draftToEntryInput(emptyDraft(LOGIN_TYPE_ID, '')).title).toBe('Untitled');
  });

  it('resolves an unrecognised type the same way draftFieldDefsForType does — flat Login shape, not a truncated fields array', () => {
    const draft: DraftState = {
      type: 'not-a-real-type',
      title: 'Example',
      fields: { username: 'jdoe', email: 'jdoe@example.com' },
      passwordOptions: DEFAULT_OPTIONS,
    };
    const input = draftToEntryInput(draft);
    expect(input.fields).toBeUndefined();
    expect(input).toMatchObject({ username: 'jdoe', email: 'jdoe@example.com' });
  });
});

describe('listEntryTypeOptions', () => {
  it('lists every registered type by id and label', () => {
    const options = listEntryTypeOptions();
    expect(options).toEqual(ENTRY_TYPES.map((t) => ({ id: t.id, label: t.label })));
  });
});
