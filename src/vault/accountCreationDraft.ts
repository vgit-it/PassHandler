/**
 * Pure logic behind the streamlined account-creation flow's in-progress
 * draft — see `docs/ACCOUNT-CREATION-DESIGN.md`. Split out of `store.tsx`
 * (which still owns the actual `draftRef`/`window.__vaultCreate`
 * wiring) so this can be unit-tested under plain Node the same way
 * `entryTypes.ts`/`emailSuggestions.ts` already are — `store.tsx`
 * transitively imports `@tauri-apps/*` (via `platform/tauri`), which the
 * dependency rule this file follows anyway (no Tauri, no `console.*`) exists
 * specifically to keep out of a module a test can import directly.
 *
 * This split is also what makes the bug this file was born fixing
 * catchable next time: `store.tsx` had silently drifted back to a fixed
 * Login-only draft shape while the Kotlin IME side (`WebViewBridge.kt`,
 * `VaultKeyboardView.kt`) had already moved on to the generic
 * `type` + `fields` shape this file now defines — a cross-language contract
 * drift invisible to `typecheck`/`lint`/`test`/`build`, since the stale JS
 * shape was internally self-consistent and the Kotlin side isn't compiled
 * in this project's sandbox at all. `draftFieldDefsForType` returning a
 * non-empty list for every real registry type is exactly the assertion
 * that would have caught "the IME's new-entry panel shows no fields" before
 * it shipped.
 */

import { collectKnownEmails, isEmailFieldName } from './emailSuggestions';
import {
  DEFAULT_OPTIONS,
  GeneratorOptions,
  StrengthEstimate,
  estimateStrength,
} from '../crypto/generator';
import { ENTRY_TYPES, LOGIN_TYPE_ID, NOTES_FIELD, TemplateFieldDef, getEntryType } from './entryTypes';
import { EntryFieldInput, EntryInput, VaultEntry } from './types';

/**
 * One in-progress account-creation draft. Every field carries its real
 * value, unlike `VaultEntry`/`FillEntry`'s sensitive fields: nothing here is
 * vault-protected yet, since none of it is in the vault yet.
 *
 * `fields` is a generic `Record<string, string>`, keyed exactly like
 * `draftFieldDefsForType`'s own output for whichever `type` the draft is
 * currently on — not a fixed Login shape (`username`/`email`/`password`/
 * `url`/`notes` as flat properties). See this module's own top doc for why
 * that generalization matters.
 */
export interface DraftState {
  type: string;
  title: string;
  fields: Record<string, string>;
  passwordOptions: GeneratorOptions;
}

/** Login's own draft field list. Login isn't read off `entryTypes.ts`'s
 * registry here the way every other type is — its extra fields beyond
 * Username/Password (Email, URL, Notes) live in `vault.ts`'s own
 * `LOGIN_EXTRA_FIELDS`, outside the registry entirely, and
 * `getEntryType('login').templateFields` only has two of these five. Unlike
 * `EntryEditor.tsx` (which renders Login through its own dedicated form,
 * never a generic field-list loop — see that file's `isLogin ? [] : [...]`
 * split), the IME's creation panel has no such dedicated Login UI: every
 * type, Login included, renders through the same `buildDraftFieldRow` loop
 * on the Kotlin side, so Login needs an explicit list here the way no other
 * type does. */
export const LOGIN_DRAFT_FIELDS: TemplateFieldDef[] = [
  { key: 'username', label: 'Username', dataType: 'text', sensitive: false },
  { key: 'email', label: 'Email', dataType: 'text', sensitive: false },
  { key: 'password', label: 'Password', dataType: 'text', sensitive: true },
  { key: 'url', label: 'URL', dataType: 'text', sensitive: false },
  { key: 'notes', label: 'Notes', dataType: 'multiline', sensitive: false, optional: true },
];

/** Which fields a draft of `type` should show, in the order they render —
 * mirrors `EntryEditor.tsx`'s own `isLogin ? [] : [...typeDef.templateFields,
 * NOTES_FIELD]` split for every type but Login (see `LOGIN_DRAFT_FIELDS`'s
 * own doc for why Login needs its own list instead of reusing that split
 * directly). The one place that knows a type's field shapes — everything
 * downstream (`draftSnapshot`'s `canGenerate`/`canPickFromVault`,
 * `store.tsx`'s `setDraftField` validity check, `draftToEntryInput`) reads
 * off this instead of re-deriving it. */
export function draftFieldDefsForType(type: string): TemplateFieldDef[] {
  // Resolved through `getEntryType`, not a direct `type === LOGIN_TYPE_ID`
  // comparison — that function's own fallback (unknown id -> Login) needs
  // to land on `LOGIN_DRAFT_FIELDS` too, not fall through to the registry's
  // own bare Login `templateFields` (username/password only, silently
  // dropping email/url from the list) the way a direct comparison would.
  const resolved = getEntryType(type);
  if (resolved.id === LOGIN_TYPE_ID) return LOGIN_DRAFT_FIELDS;
  return [...resolved.templateFields, NOTES_FIELD];
}

export function emptyDraft(type: string = LOGIN_TYPE_ID, title = ''): DraftState {
  return { type, title, fields: {}, passwordOptions: DEFAULT_OPTIONS };
}

/**
 * Whether a draft is worth saving. `title` deliberately doesn't count on its
 * own — it's only ever a quiet-bias guess seeded by `startDraft` (see that
 * method's doc on `store.tsx`), not something the user did — so tapping "+"
 * and walking away without filling in a single field leaves nothing here
 * worth an entry.
 */
export function hasDraftContent(draft: DraftState): boolean {
  return Object.values(draft.fields).some((value) => value !== '');
}

/** One field of `getDraft()`'s wire shape — mirrors `WebViewBridge.kt`'s
 * `DraftFieldSnapshot` one-to-one. `canGenerate`/`canPickFromVault` are
 * resolved here, not on the Kotlin side, since this is the one place that
 * knows a type's field shapes — the Kotlin panel only ever renders whichever
 * of them come back `true`. */
export interface DraftFieldSnapshot {
  key: string;
  label: string;
  value: string;
  sensitive: boolean;
  canGenerate: boolean;
  canPickFromVault: boolean;
}

/** `getDraft()`'s actual wire shape — mirrors `WebViewBridge.kt`'s
 * `DraftSnapshot` one-to-one. Built fresh from `DraftState` on every call
 * (`draftSnapshot` below) rather than stored this way directly, so the
 * in-memory draft itself can stay the smaller, simpler `Record<string,
 * string>` shape. */
export interface DraftSnapshot {
  type: string;
  typeLabel: string;
  title: string;
  fields: DraftFieldSnapshot[];
  passwordOptions: GeneratorOptions;
  /** `estimateStrength` of the draft's `password` field, or `null` while it
   * is empty (or the type has no such field) — computed here so the IME's
   * strength bar never reimplements the estimator. */
  passwordStrength: StrengthEstimate | null;
}

/** Builds `getDraft()`'s wire shape from the in-memory `DraftState`. "Generate"
 * is exactly `key === 'password'` (the one key, across every type in the
 * registry, whose value is meaningfully "a random secret that still works");
 * "Pick from Vault" is whether the field's own name looks like an email
 * field (`isEmailFieldName`) — the same two rules
 * `docs/ACCOUNT-CREATION-DESIGN.md`'s "Any entry type" revision settled on. */
export function draftSnapshot(draft: DraftState): DraftSnapshot {
  const password = draft.fields.password ?? '';
  return {
    type: draft.type,
    typeLabel: getEntryType(draft.type).label,
    title: draft.title,
    fields: draftFieldDefsForType(draft.type).map((def) => ({
      key: def.key,
      label: def.label,
      value: draft.fields[def.key] ?? '',
      sensitive: def.sensitive,
      canGenerate: def.key === 'password',
      canPickFromVault: isEmailFieldName(def.key),
    })),
    passwordOptions: draft.passwordOptions,
    passwordStrength: password === '' ? null : estimateStrength(password),
  };
}

/** One selectable entry type, for the creation panel's "Type" row — mirrors
 * `WebViewBridge.kt`'s `EntryTypeOption` one-to-one. */
export interface EntryTypeOption {
  id: string;
  label: string;
}

export function listEntryTypeOptions(): EntryTypeOption[] {
  return ENTRY_TYPES.map((t) => ({ id: t.id, label: t.label }));
}

/**
 * What `Vault.addEntry` should be called with to commit `draft`. Login stays
 * on `EntryInput`'s flat properties (KeePass's standard fields — see
 * `vault.ts`'s own doc on why); every other type goes through
 * `fields: EntryFieldInput[]` instead, one entry per that type's own field
 * defs, template fields only (no `custom: true` — the draft has no "add a
 * field" affordance, see `docs/ACCOUNT-CREATION-DESIGN.md`'s "Not done as
 * part of this pass"). Both branches read off `draft.fields[key] ?? ''`, the
 * same fallback `draftSnapshot` already uses, so a field the user never
 * touched commits as an empty value rather than being omitted.
 *
 * The Login-or-not branch is decided the same way `draftFieldDefsForType`
 * resolves it (through `getEntryType`, not a direct `=== LOGIN_TYPE_ID`
 * comparison) — the two have to agree on an unrecognised `draft.type`, or
 * this would build a `fields:` array shaped for `LOGIN_DRAFT_FIELDS`
 * (5 entries) while telling `Vault.addEntry` to treat it as a non-Login
 * type, whose own `getEntryType` fallback only recognises 2 of those 5 keys
 * and silently drops the rest.
 */
export function draftToEntryInput(draft: DraftState): EntryInput {
  if (getEntryType(draft.type).id === LOGIN_TYPE_ID) {
    return {
      type: LOGIN_TYPE_ID,
      title: draft.title || 'Untitled',
      username: draft.fields.username ?? '',
      email: draft.fields.email ?? '',
      password: draft.fields.password ?? '',
      url: draft.fields.url ?? '',
      notes: draft.fields.notes ?? '',
    };
  }
  return {
    type: draft.type,
    title: draft.title || 'Untitled',
    fields: draftFieldDefsForType(draft.type).map(
      (def): EntryFieldInput => ({ key: def.key, value: draft.fields[def.key] ?? '' }),
    ),
  };
}

/** Every distinct email-shaped value already stored anywhere in the vault —
 * thin re-export of `collectKnownEmails` under this module's own naming, so
 * `store.tsx`'s bridge can import everything the creation flow needs from
 * one place. */
export function listKnownEmails(entries: VaultEntry[]): string[] {
  return collectKnownEmails(entries);
}
