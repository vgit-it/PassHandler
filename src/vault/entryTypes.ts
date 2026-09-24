/**
 * The entry type registry.
 *
 * Source of truth for "what an entry of this type looks like" — the two-step
 * add-entry flow (type picker, then form), the field list an entry renders
 * with, and (eventually) the Android quick-fill chip row all read from this
 * one array instead of hardcoding field lists per screen. See the project doc
 * `entry-type-expansion-spec.md`.
 *
 * Deliberately dependency-free: no React import, no `vault/vault.ts` import,
 * nothing platform-specific. It is plain data plus pure lookup functions, so
 * it can be imported and asserted against in a test with no setup — and so
 * that a bug in, say, the storage-key scheme can never be a bug in this file.
 *
 * One type is not like the others: `login` is rendered here like every other
 * type (for the picker, the icon, search), but `Vault` deliberately keeps
 * `login` entries on KeePass's *standard* Title/UserName/Password/URL/Notes
 * fields rather than the generic `ph:f:`/`ph:c:` scme every other type uses —
 * see the comment on `LOGIN_TYPE_ID` in `vault.ts`. This registry has no
 * knowledge of that; it only describes shape, never storage.
 */

/** `'monthYear'` is Card's Expiry only, today — a genuinely day-less date
 * (a card's printed expiry has never had one). See
 * `vault/monthYearFormat.ts` and `docs/card-expiry-derived-date.md`. */
export type FieldDataType = 'text' | 'number' | 'date' | 'multiline' | 'monthYear';

export interface TemplateFieldDef {
  key: string;
  label: string;
  dataType: FieldDataType;
  sensitive: boolean;
  /** Hidden from display when empty, instead of rendering a blank row. */
  optional?: boolean;
}

export type EntryCategoryId =
  | 'logins'
  | 'financial'
  | 'identity'
  | 'access-security'
  | 'recurring-membership'
  | 'notes';

export interface EntryTypeDef {
  id: string;
  category: EntryCategoryId;
  label: string;
  /** Key into the icon lookup in `ui/components/entryTypeIcons.tsx`. Kept as
   * a string here rather than a component reference so this file stays free
   * of a React import. */
  icon: string;
  searchAliases: string[];
  templateFields: TemplateFieldDef[];
}

export const CATEGORY_LABELS: Record<EntryCategoryId, string> = {
  logins: 'Logins',
  financial: 'Financial',
  identity: 'Identity',
  'access-security': 'Access & Security',
  'recurring-membership': 'Recurring / Membership',
  notes: 'Notes',
};

/** Category display order — also the order categories appear in the picker. */
export const CATEGORY_ORDER: EntryCategoryId[] = [
  'logins',
  'financial',
  'identity',
  'access-security',
  'recurring-membership',
  'notes',
];

export const LOGIN_TYPE_ID = 'login';

export const ENTRY_TYPES: EntryTypeDef[] = [
  {
    id: LOGIN_TYPE_ID,
    category: 'logins',
    label: 'Login',
    icon: 'login',
    searchAliases: ['password', 'account', 'website', 'site'],
    templateFields: [
      { key: 'username', label: 'Username', dataType: 'text', sensitive: false },
      { key: 'password', label: 'Password', dataType: 'text', sensitive: true },
    ],
  },
  {
    id: 'card',
    category: 'financial',
    label: 'Card',
    icon: 'card',
    searchAliases: ['credit card', 'debit card', 'visa', 'mastercard'],
    templateFields: [
      { key: 'number', label: 'Number', dataType: 'text', sensitive: true },
      // 'monthYear', not 'date' — see `vault/monthYearFormat.ts`'s own doc
      // and `docs/card-expiry-derived-date.md`. `EntryEditor` derives a
      // real `dataType: 'date'` companion field from whatever's typed here
      // (the actual last day of the printed month), which is what
      // Upcoming tracks — this field itself only ever needs a month.
      { key: 'expiry', label: 'Expiry', dataType: 'monthYear', sensitive: false },
      { key: 'cvv', label: 'CVV', dataType: 'text', sensitive: true },
      { key: 'nameOnCard', label: 'Name on card', dataType: 'text', sensitive: false },
    ],
  },
  {
    id: 'bank',
    category: 'financial',
    label: 'Bank Account',
    icon: 'bank',
    searchAliases: ['bank account', 'ifsc', 'checking', 'savings'],
    templateFields: [
      { key: 'accountNumber', label: 'Account #', dataType: 'text', sensitive: true },
      { key: 'ifsc', label: 'IFSC Code', dataType: 'text', sensitive: false, optional: true },
      { key: 'bankName', label: 'Bank name', dataType: 'text', sensitive: false },
    ],
  },
  {
    id: 'identity',
    category: 'identity',
    label: 'Identity Doc',
    icon: 'identity',
    searchAliases: ['passport', 'license', 'id card', 'identity document'],
    templateFields: [
      { key: 'idNumber', label: 'ID Number', dataType: 'text', sensitive: true },
      { key: 'expiry', label: 'Expiry', dataType: 'date', sensitive: false, optional: true },
    ],
  },
  {
    id: 'phone',
    category: 'identity',
    label: 'Phone Number',
    icon: 'phone',
    searchAliases: ['phone', 'mobile', 'cell', 'telephone', 'number'],
    templateFields: [{ key: 'number', label: 'Number', dataType: 'text', sensitive: false }],
  },
  {
    id: 'address',
    category: 'identity',
    label: 'Address',
    icon: 'address',
    searchAliases: ['address', 'home', 'mailing address', 'shipping address'],
    templateFields: [
      { key: 'street', label: 'Street', dataType: 'text', sensitive: false },
      { key: 'street2', label: 'Apt / Unit', dataType: 'text', sensitive: false, optional: true },
      { key: 'city', label: 'City', dataType: 'text', sensitive: false },
      { key: 'state', label: 'State / Province', dataType: 'text', sensitive: false, optional: true },
      { key: 'postalCode', label: 'Postal Code', dataType: 'text', sensitive: false },
      { key: 'country', label: 'Country', dataType: 'text', sensitive: false, optional: true },
    ],
  },
  {
    id: 'wifi',
    category: 'access-security',
    label: 'WiFi',
    icon: 'wifi',
    searchAliases: ['wifi', 'wi-fi', 'network', 'router', 'ssid'],
    templateFields: [
      { key: 'ssid', label: 'SSID', dataType: 'text', sensitive: false },
      { key: 'password', label: 'Password', dataType: 'text', sensitive: true },
    ],
  },
  {
    id: 'licenseKey',
    category: 'access-security',
    label: 'License Key',
    icon: 'licenseKey',
    searchAliases: ['license', 'serial', 'activation', 'product key'],
    templateFields: [
      { key: 'key', label: 'Key', dataType: 'text', sensitive: true },
      { key: 'expiry', label: 'Expiry', dataType: 'date', sensitive: false, optional: true },
    ],
  },
  {
    id: 'sshKey',
    category: 'access-security',
    label: 'SSH/API Key',
    icon: 'sshKey',
    searchAliases: ['ssh', 'api key', 'token', 'access token', 'secret key'],
    templateFields: [{ key: 'key', label: 'Key / Token', dataType: 'multiline', sensitive: true }],
  },
  {
    id: 'backupCodes',
    category: 'access-security',
    label: '2FA Backup Codes',
    icon: 'backupCodes',
    searchAliases: ['2fa', 'mfa', 'backup codes', 'recovery codes', 'two factor'],
    templateFields: [
      { key: 'codes', label: 'Codes', dataType: 'multiline', sensitive: true },
    ],
  },
  {
    id: 'securityQa',
    category: 'access-security',
    label: 'Security Q&A',
    icon: 'securityQa',
    searchAliases: ['security question', 'secret question', 'recovery question'],
    templateFields: [
      { key: 'question', label: 'Question', dataType: 'text', sensitive: false },
      { key: 'answer', label: 'Answer', dataType: 'text', sensitive: true },
    ],
  },
  {
    id: 'loyalty',
    category: 'recurring-membership',
    label: 'Loyalty / Membership',
    icon: 'loyalty',
    searchAliases: ['loyalty', 'membership', 'rewards', 'points'],
    templateFields: [
      { key: 'memberNumber', label: 'Member #', dataType: 'text', sensitive: false },
      { key: 'tier', label: 'Tier', dataType: 'text', sensitive: false },
      { key: 'expiry', label: 'Expiry', dataType: 'date', sensitive: false, optional: true },
    ],
  },
  {
    id: 'vehicle',
    category: 'recurring-membership',
    label: 'Vehicle',
    icon: 'vehicle',
    searchAliases: ['car', 'vehicle', 'license plate', 'vin'],
    templateFields: [
      { key: 'plate', label: 'Plate #', dataType: 'text', sensitive: false },
      { key: 'vin', label: 'VIN', dataType: 'text', sensitive: false },
      // "Registration expiry", not a bare "Expiry" — unlike the other three
      // types this session added a date field to, Vehicle has more than one
      // plausible renewal in real life (registration, inspection, its own
      // separate Insurance entry) and a bare "Expiry" here wouldn't say
      // which. See `upcoming-tab-design.md`'s field audit.
      { key: 'registrationExpiry', label: 'Registration expiry', dataType: 'date', sensitive: false, optional: true },
    ],
  },
  {
    id: 'insurance',
    category: 'recurring-membership',
    label: 'Insurance',
    icon: 'insurance',
    searchAliases: ['insurance', 'policy', 'coverage'],
    templateFields: [
      { key: 'policyNumber', label: 'Policy #', dataType: 'text', sensitive: true },
      { key: 'provider', label: 'Provider', dataType: 'text', sensitive: false },
      { key: 'expiry', label: 'Expiry', dataType: 'date', sensitive: false, optional: true },
    ],
  },
  {
    id: 'secureNote',
    category: 'notes',
    label: 'Secure Note',
    icon: 'secureNote',
    searchAliases: ['note', 'text', 'memo'],
    templateFields: [{ key: 'body', label: 'Body', dataType: 'multiline', sensitive: false }],
  },
];

/**
 * A universal, always-available Notes field — every type gets one, on top of
 * its own `templateFields`, not just as a per-type registry entry. `login`
 * has its own equivalent already (see `LOGIN_EXTRA_FIELDS` in `vault.ts`,
 * carried over from before entry types existed); this is the same idea
 * generalised to every other type, kept here rather than copy-pasted into
 * all twelve `templateFields` arrays. `optional: true` — hidden from display
 * when empty, exactly like Identity Doc's `expiry`.
 */
export const NOTES_FIELD: TemplateFieldDef = {
  key: 'notes',
  label: 'Notes',
  dataType: 'multiline',
  sensitive: false,
  optional: true,
};

const BY_ID = new Map(ENTRY_TYPES.map((t) => [t.id, t]));

/** Falls back to Login for an unknown id — matches the migration rule that an
 * entry with no recognised type is treated as Login. */
export function getEntryType(id: string): EntryTypeDef {
  return BY_ID.get(id) ?? BY_ID.get(LOGIN_TYPE_ID)!;
}

export function isKnownEntryType(id: string): boolean {
  return BY_ID.has(id);
}

export interface EntryCategoryGroup {
  category: EntryCategoryId;
  label: string;
  types: EntryTypeDef[];
}

/** Every type, grouped by category in display order — the picker's default
 * (no search text) view. */
export function entryTypesByCategory(): EntryCategoryGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    types: ENTRY_TYPES.filter((t) => t.category === category),
  })).filter((group) => group.types.length > 0);
}

export interface PickerGroup {
  /** '' for the ungrouped lead-in group — the picker renders no header for
   * one, distinct from a group whose header text happens to be blank. */
  label: string;
  types: EntryTypeDef[];
}

/** Login, Card, Bank Account, and Identity Doc lead the type picker with no
 * category header — the four types picked as common enough that grouping
 * them under a label just adds a scan step. Access & Security keeps its own
 * header, unchanged from the registry's category breakdown
 * (`entryTypesByCategory`). Everything left over — Loyalty, Vehicle,
 * Insurance, Secure Note — falls into one "OTHERS" group, in registry
 * order. A deliberate UI simplification of the picker specifically, not a
 * replacement for `entryTypesByCategory`, which still describes every
 * type's actual category.
 *
 * Exported — `vault/search.ts`'s `groupEntriesForHomeScreen` buckets actual
 * entries the same way this buckets types, so the home screen's category
 * headers match what was seen picking a type. Shared rather than
 * re-declared there, so the two groupings can't quietly drift apart. */
export const PICKER_LEAD_TYPE_IDS = ['login', 'card', 'bank', 'identity'];
export const PICKER_KEPT_CATEGORY: EntryCategoryId = 'access-security';

/** The type picker's grouping: a no-header lead-in group, then Access &
 * Security (kept as its own category), then "OTHERS" for the rest — see
 * `PICKER_LEAD_TYPE_IDS`/`PICKER_KEPT_CATEGORY`. This is what
 * `TypePicker.tsx` renders when there's no search text; `searchEntryTypes`
 * takes over once the user types. */
export function entryTypesForPicker(): PickerGroup[] {
  const lead = PICKER_LEAD_TYPE_IDS.map((id) => getEntryType(id));
  const keptCategory = ENTRY_TYPES.filter(
    (t) => !PICKER_LEAD_TYPE_IDS.includes(t.id) && t.category === PICKER_KEPT_CATEGORY,
  );
  const others = ENTRY_TYPES.filter(
    (t) => !PICKER_LEAD_TYPE_IDS.includes(t.id) && t.category !== PICKER_KEPT_CATEGORY,
  );
  return [
    { label: '', types: lead },
    { label: CATEGORY_LABELS[PICKER_KEPT_CATEGORY], types: keptCategory },
    { label: 'OTHERS', types: others },
  ];
}

/**
 * Substring match on label + aliases, ranked so a label match beats an alias
 * match and a prefix match beats a mid-string match. Good enough for a
 * picker of a dozen-odd types; true fuzzy matching is out of scope for v1 —
 * see `entry-type-expansion-spec.md`'s note on the app-side search box, which
 * makes the same call.
 */
export function searchEntryTypes(query: string): EntryTypeDef[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return ENTRY_TYPES;

  const scored = ENTRY_TYPES.map((type) => ({ type, score: matchScore(type, needle) })).filter(
    (s) => s.score > 0,
  );
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.type);
}

function matchScore(type: EntryTypeDef, needle: string): number {
  const label = type.label.toLowerCase();
  if (label === needle) return 4;
  if (label.startsWith(needle)) return 3;
  if (label.includes(needle)) return 2;
  if (type.searchAliases.some((alias) => alias.toLowerCase().includes(needle))) return 1;
  return 0;
}
