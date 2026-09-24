import { describe, expect, it } from 'vitest';

import {
  customFieldDataTypeKey,
  customFieldKey,
  customFieldMetaKey,
  customFieldRenewalKey,
  customFieldTrackKey,
  customKeyFromDataTypeName,
  customKeyFromFieldName,
  customKeyFromMetaName,
  customKeyFromRenewalName,
  isCustomFieldDataTypeName,
  isCustomFieldMetaName,
  isCustomFieldName,
  isCustomFieldRenewalName,
  isCustomFieldTrackName,
  isVaultFieldName,
  isTemplateFieldName,
  isTemplateFieldTrackName,
  reviewMetaKey,
  templateFieldKey,
  templateFieldTrackKey,
  templateKeyFromFieldName,
  typeMetaKey,
} from '@/vault/fieldKeys';

/**
 * The `ph:` storage-key scheme, tested in isolation from `Vault`/`kdbxweb` —
 * this is plain string manipulation and should never need a real vault to
 * verify.
 */
describe('fieldKeys', () => {
  it('round-trips a template field key', () => {
    const kdbxKey = templateFieldKey('expiry');
    expect(kdbxKey).toBe('ph:f:expiry');
    expect(isTemplateFieldName(kdbxKey)).toBe(true);
    expect(templateKeyFromFieldName(kdbxKey)).toBe('expiry');
  });

  it('round-trips a custom field key and its sensitivity-meta key', () => {
    const kdbxKey = customFieldKey('PIN');
    const metaKey = customFieldMetaKey('PIN');

    expect(kdbxKey).toBe('ph:c:PIN');
    expect(metaKey).toBe('ph:c-meta:PIN');
    expect(isCustomFieldName(kdbxKey)).toBe(true);
    expect(isCustomFieldMetaName(metaKey)).toBe(true);
    expect(customKeyFromFieldName(kdbxKey)).toBe('PIN');
    expect(customKeyFromMetaName(metaKey)).toBe('PIN');
  });

  it('never classifies a custom-meta key as a plain custom-field key', () => {
    // The two prefixes overlap ("ph:c:" is a prefix of "ph:c-meta:"), which
    // is exactly the case a naive `startsWith` check gets wrong.
    const metaKey = customFieldMetaKey('PIN');
    expect(isCustomFieldName(metaKey)).toBe(false);
  });

  it('round-trips a custom field key and its dataType-meta key', () => {
    const kdbxKey = customFieldDataTypeKey('expiry-renewal');
    expect(kdbxKey).toBe('ph:c-type:expiry-renewal');
    expect(isCustomFieldDataTypeName(kdbxKey)).toBe(true);
    expect(customKeyFromDataTypeName(kdbxKey)).toBe('expiry-renewal');
  });

  it('round-trips a renewal-link key', () => {
    const kdbxKey = customFieldRenewalKey('expiry-renewal');
    expect(kdbxKey).toBe('ph:c-renewal:expiry-renewal');
    expect(isCustomFieldRenewalName(kdbxKey)).toBe(true);
    expect(customKeyFromRenewalName(kdbxKey)).toBe('expiry-renewal');
  });

  it('never confuses the dataType-meta and renewal-link keys with the plain custom-field key or each other', () => {
    // All four prefixes share "ph:c" — none of them may accidentally match
    // another's `is*Name` check.
    const plain = customFieldKey('expiry');
    const meta = customFieldMetaKey('expiry');
    const dataType = customFieldDataTypeKey('expiry');
    const renewal = customFieldRenewalKey('expiry');

    expect(isCustomFieldName(dataType)).toBe(false);
    expect(isCustomFieldName(renewal)).toBe(false);
    expect(isCustomFieldMetaName(dataType)).toBe(false);
    expect(isCustomFieldMetaName(renewal)).toBe(false);
    expect(isCustomFieldDataTypeName(plain)).toBe(false);
    expect(isCustomFieldDataTypeName(meta)).toBe(false);
    expect(isCustomFieldDataTypeName(renewal)).toBe(false);
    expect(isCustomFieldRenewalName(plain)).toBe(false);
    expect(isCustomFieldRenewalName(meta)).toBe(false);
    expect(isCustomFieldRenewalName(dataType)).toBe(false);
  });

  it('round-trips a template field\'s Upcoming-track key, never confused with its value key', () => {
    const valueKey = templateFieldKey('expiry');
    const trackKey = templateFieldTrackKey('expiry');
    expect(trackKey).toBe('ph:f-track:expiry');
    expect(isTemplateFieldTrackName(trackKey)).toBe(true);
    // The shared "ph:f" lead-in is exactly the case a naive `startsWith`
    // check gets wrong — same reasoning the custom-field prefixes below are
    // tested for.
    expect(isTemplateFieldName(trackKey)).toBe(false);
    expect(isTemplateFieldTrackName(valueKey)).toBe(false);
  });

  it('round-trips a custom field\'s Upcoming-track key, never confused with its plain value key', () => {
    const valueKey = customFieldKey('expiry');
    const trackKey = customFieldTrackKey('expiry');
    expect(trackKey).toBe('ph:c-track:expiry');
    expect(isCustomFieldTrackName(trackKey)).toBe(true);
    expect(isCustomFieldName(trackKey)).toBe(false);
    expect(isCustomFieldTrackName(valueKey)).toBe(false);
  });

  it('keeps a template field\'s and a same-named custom field\'s track keys distinct', () => {
    // Nothing stops a custom field from being named the same as a template
    // field on the same entry — the whole reason `upcoming-tab-design.md`
    // gives for using two prefixes here instead of one shared `ph:track:`.
    expect(templateFieldTrackKey('expiry')).not.toBe(customFieldTrackKey('expiry'));
  });

  it('recognises the type-metadata key', () => {
    expect(typeMetaKey()).toBe('ph:type');
  });

  it('recognises the review-metadata key', () => {
    expect(reviewMetaKey()).toBe('ph:review');
  });

  it('isVaultFieldName recognises every ph: kind and rejects ordinary KeePass fields', () => {
    expect(isVaultFieldName('ph:type')).toBe(true);
    expect(isVaultFieldName('ph:review')).toBe(true);
    expect(isVaultFieldName(templateFieldKey('number'))).toBe(true);
    expect(isVaultFieldName(customFieldKey('PIN'))).toBe(true);
    expect(isVaultFieldName(customFieldMetaKey('PIN'))).toBe(true);
    expect(isVaultFieldName(customFieldDataTypeKey('expiry'))).toBe(true);
    expect(isVaultFieldName(customFieldRenewalKey('expiry-renewal'))).toBe(true);
    expect(isVaultFieldName(templateFieldTrackKey('expiry'))).toBe(true);
    expect(isVaultFieldName(customFieldTrackKey('expiry'))).toBe(true);
    expect(isVaultFieldName('Title')).toBe(false);
    expect(isVaultFieldName('UserName')).toBe(false);
  });
});
