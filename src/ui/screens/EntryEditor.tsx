import { useEffect, useMemo, useRef, useState } from 'react';

import { useApp } from '../../app/store';
import { isoToDisplay } from '../../vault/dateFormat';
import { collectKnownEmails, isEmailFieldName } from '../../vault/emailSuggestions';
import { FieldDataType, getEntryType, LOGIN_TYPE_ID, NOTES_FIELD } from '../../vault/entryTypes';
import { lastDayOfMonthIso, parseLegacyMonthYear } from '../../vault/monthYearFormat';
import { EntryFieldInput, fieldValue, RenewalCalc, VaultEntry } from '../../vault/types';
import { DateFieldWithRenewal, TrackToggle } from '../components/DateFieldWithRenewal';
import { EmailSuggestInput } from '../components/EmailSuggestInput';
import { MonthYearInput } from '../components/MonthYearInput';
import { PasswordField } from '../components/PasswordField';
import { Toggle } from '../components/Toggle';
import { BackIcon, EyeIcon, EyeOffIcon, PlusIcon, TrashIcon } from '../components/icons';
import { ENTRY_CREATION_WALL_GRADIENT, TypePicker } from './TypePicker';

interface CustomFieldDraft {
  /** Local-only React key — stable while the user edits the visible `key`
   * text, which doubles as the storage key on save. Never persisted. */
  uid: number;
  key: string;
  value: string;
  sensitive: boolean;
  /** Only ever `'date'` or `'text'` — a custom field's type choice is just
   * that one toggle, not the full `FieldDataType` range template fields
   * draw from. `'date'` only applies while `!sensitive` (see
   * `CustomFieldRow`): a sensitive custom field always keeps `'text'`,
   * matching how it's always rendered — masked, not date-picked. */
  dataType: 'text' | 'date';
  /** Present only on a renewal-companion field created via some other date
   * field's "+ Renewal date" — the `key` of that original field. Such a
   * field is auto-named, never shown in the generic "Custom fields" list
   * (see `visibleCustomFields` below), and rendered nested under its
   * original field by `DateFieldWithRenewal` instead. See
   * `date-renewal-field-redesign.md`. */
  renewalOf?: string;
  /** See `RenewalCalc`'s own doc — present alongside `renewalOf` only while
   * this field's value still reflects what the calculator last computed. */
  renewalCalc?: RenewalCalc;
  /** See `EntryField.trackedInUpcoming` — whether *this* field specifically
   * is opted into the Upcoming tab, independent of any other field it's
   * linked to (its original, if this is a renewal/derived companion; its
   * own companion, if it has one). Meaningless while `dataType !== 'date'`,
   * same as `dataType` itself is meaningless while `sensitive`. */
  trackedInUpcoming?: boolean;
}

/**
 * Add or edit an entry.
 *
 * Two steps, per `entry-type-expansion-spec.md`: pick a type, then fill in a
 * form built from that type's template fields. Editing an existing entry
 * skips straight to the form with its type locked — converting a saved
 * entry's type is out of scope, so there is nothing to pick.
 *
 * Sensitive values (a password, a card's CVV, a custom field marked
 * sensitive) are in component state here, unavoidably — they are being typed
 * or generated. They live for the duration of this screen and no longer: the
 * list model never carries them, and closing the editor drops them.
 */
export function EntryEditor({
  entry,
  onDone,
  onCancel,
}: {
  entry: VaultEntry | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [typeId, setTypeId] = useState<string | null>(entry?.type ?? null);

  // No type chosen yet only happens when adding a new entry — editing always
  // arrives with `entry.type` already set.
  if (typeId === null) {
    return <TypePicker onSelect={setTypeId} onCancel={onCancel} />;
  }

  return <EntryForm entry={entry} typeId={typeId} onDone={onDone} onCancel={onCancel} />;
}

function EntryForm({
  entry,
  typeId,
  onDone,
  onCancel,
}: {
  entry: VaultEntry | null;
  typeId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { addEntry, updateEntry, readField, entries, platform } = useApp();
  const typeDef = getEntryType(typeId);
  const isLogin = typeId === LOGIN_TYPE_ID;
  const uidCounter = useRef(0);
  // Where the Title input itself lives, so a title-required error can move
  // focus back there (`submit` below) — `docs/UI-UX-REVIEW.md` finding #4:
  // the error used to only ever render once, at the very bottom of the
  // form, disconnected from the field it was actually about.
  const titleRef = useRef<HTMLInputElement>(null);

  // Every already-saved email-shaped value, for the "+ Renewal date"-style
  // suggestion dropdown on any email field — see
  // `email-suggestions-design.md`. Excludes this entry's own fields (see
  // `collectKnownEmails`'s doc); recomputed only when the vault's entry list
  // or which entry is being edited actually changes, not on every keystroke.
  const knownEmails = useMemo(() => collectKnownEmails(entries, entry?.id), [entries, entry?.id]);

  // Every non-login type's own template fields, plus the universal Notes
  // field every type gets — see `NOTES_FIELD`'s doc comment. Login has its
  // own Notes input already, as part of `LoginFields` below, so this is
  // empty (and unused) for it.
  const formFields = isLogin ? [] : [...typeDef.templateFields, NOTES_FIELD];

  const [title, setTitle] = useState(entry?.title ?? '');

  // One flat map covers both Login's fixed fields (username/password/url/
  // notes) and every other type's template fields, keyed by field key —
  // there is nothing meaningfully different about typing into one versus the
  // other once the initial values are loaded.
  const [values, setValues] = useState<Record<string, string>>(() => {
    if (!entry) return {};
    const initial: Record<string, string> = {};
    if (isLogin) {
      initial.username = fieldValue(entry, 'username');
      initial.email = fieldValue(entry, 'email');
      initial.password = readField(entry.id, 'password') ?? '';
      initial.url = fieldValue(entry, 'url');
      initial.notes = fieldValue(entry, 'notes');
    } else {
      for (const def of formFields) {
        initial[def.key] = def.sensitive ? (readField(entry.id, def.key) ?? '') : fieldValue(entry, def.key);
      }
    }
    return initial;
  });

  const [customFields, setCustomFields] = useState<CustomFieldDraft[]>(() => {
    if (!entry) return [];
    return entry.fields
      .filter((f) => f.custom)
      .map((f) => ({
        uid: uidCounter.current++,
        key: f.key,
        value: f.sensitive ? (readField(entry.id, f.key) ?? '') : f.value,
        sensitive: f.sensitive,
        dataType: !f.sensitive && f.dataType === 'date' ? ('date' as const) : ('text' as const),
        renewalOf: f.renewalOf,
        renewalCalc: f.renewalCalc,
        trackedInUpcoming: f.trackedInUpcoming,
      }));
  });

  // A template date field's own Upcoming-tracking state — kept separately
  // from `values` (a plain `Record<string, string>`, with no room for a
  // per-field boolean) rather than folded into it. Keyed by the template
  // field's own `key`, same as `values` itself. See
  // `upcoming-tab-design.md`'s "Data model" section for why template
  // fields need this at all — before this feature, they carried no
  // per-instance metadata whatsoever, only a value.
  const [templateTracked, setTemplateTracked] = useState<Record<string, boolean>>(() => {
    if (!entry) return {};
    const initial: Record<string, boolean> = {};
    for (const def of formFields) {
      const field = entry.fields.find((f) => f.key === def.key && !f.custom);
      if (field?.trackedInUpcoming) initial[def.key] = true;
    }
    return initial;
  });

  // The generic "Custom fields" list never shows a renewal companion — it's
  // rendered nested under its original field by `DateFieldWithRenewal`
  // instead. Checked against `undefined` specifically, not truthiness: a
  // custom field added blank, switched to Date, and given a renewal before
  // it's ever named produces a companion with `renewalOf: ''` (empty, but
  // still a real link — see `addRenewalField`) — `''` is falsy, so a plain
  // `!f.renewalOf` check would wrongly let it slip back into this list as
  // its own floating row, on top of the correctly nested one
  // `DateFieldWithRenewal` already renders under the blank field. The rename
  // cascade in `updateCustomField` fixes the link itself up the moment the
  // field is named; this is what keeps the list honest in the meantime.
  const visibleCustomFields = customFields.filter((f) => f.renewalOf === undefined);

  /** Finds the renewal companion for the date field named `originalKey`, if
   * one has been added — at most one is ever created per original field
   * (see `addRenewalField`). */
  const renewalFor = (originalKey: string) => customFields.find((f) => f.renewalOf === originalKey);

  /** Generates a storage key for a new renewal companion that can't collide
   * with any field already on this entry — `<originalKey>-renewal`, or that
   * with a numeric suffix in the vanishingly unlikely case a field already
   * has that exact name. Custom field keys are free-text, so this can't
   * simply assume the natural name is free. */
  const renewalKeyFor = (originalKey: string): string => {
    const taken = new Set([
      ...formFields.map((def) => def.key),
      ...(isLogin ? ['username', 'email', 'password', 'url', 'notes'] : []),
      ...customFields.map((f) => f.key),
    ]);
    let candidate = `${originalKey}-renewal`;
    let n = 2;
    while (taken.has(candidate)) {
      candidate = `${originalKey}-renewal-${n}`;
      n += 1;
    }
    return candidate;
  };

  const addRenewalField = (originalKey: string) => {
    setCustomFields((fields) => [
      ...fields,
      {
        uid: uidCounter.current++,
        key: renewalKeyFor(originalKey),
        value: '',
        sensitive: false,
        dataType: 'date',
        renewalOf: originalKey,
      },
    ]);
  };

  const updateRenewalField = (originalKey: string, patch: Partial<CustomFieldDraft>) => {
    setCustomFields((fields) =>
      fields.map((f) => (f.renewalOf === originalKey ? { ...f, ...patch } : f)),
    );
  };

  const removeRenewalField = (originalKey: string) => {
    setCustomFields((fields) => fields.filter((f) => f.renewalOf !== originalKey));
  };

  /** Generates a storage key for Card Expiry's derived companion — same
   * collision-avoidance as `renewalKeyFor`, but a distinct `-date` suffix
   * rather than `-renewal`: this isn't a renewal (nothing is being renewed),
   * it's the same month restated at day granularity so Upcoming has a real
   * `dataType: 'date'` field to track. See `card-expiry-derived-date.md`. */
  const derivedKeyFor = (originalKey: string): string => {
    const taken = new Set([
      ...formFields.map((def) => def.key),
      ...(isLogin ? ['username', 'email', 'password', 'url', 'notes'] : []),
      ...customFields.map((f) => f.key),
    ]);
    let candidate = `${originalKey}-date`;
    let n = 2;
    while (taken.has(candidate)) {
      candidate = `${originalKey}-date-${n}`;
      n += 1;
    }
    return candidate;
  };

  /**
   * Keeps a `monthYear` template field's derived `dataType: 'date'`
   * companion in sync with `derivedIso` — added if missing, updated in
   * place if present, dropped if `derivedIso` is `''` (the month field was
   * cleared). Reuses the renewal-companion link (`renewalOf`) purely as a
   * storage mechanism, not as an actual renewal: `EntryDetail` tells the two
   * apart by the *original* field's `dataType` (`monthYear`, never `date`),
   * and this companion never gets a calculator or manual edits the way a
   * real renewal does. A no-op (returns the same array reference) when
   * nothing actually changed, so the auto-sync effect below doesn't churn
   * state on every unrelated keystroke.
   */
  const setDerivedExpiry = (originalKey: string, derivedIso: string) => {
    setCustomFields((fields) => {
      const existing = fields.find((f) => f.renewalOf === originalKey);
      if (derivedIso === '') {
        return existing ? fields.filter((f) => f.renewalOf !== originalKey) : fields;
      }
      if (existing) {
        return existing.value === derivedIso
          ? fields
          : fields.map((f) => (f === existing ? { ...f, value: derivedIso } : f));
      }
      return [
        ...fields,
        {
          uid: uidCounter.current++,
          key: derivedKeyFor(originalKey),
          value: derivedIso,
          sensitive: false,
          dataType: 'date',
          renewalOf: originalKey,
        },
      ];
    });
  };

  // Card's Expiry (and any other `monthYear` template field, should one ever
  // exist) always keeps its derived companion in sync with its own current
  // value — this covers both a value just typed and an existing entry's
  // already-saved Expiry, so a legacy, pre-this-feature entry (still
  // holding whatever free text it always did — `MonthYearInput` itself
  // hasn't necessarily normalised it yet; that only happens once the user
  // actually retypes or repicks it) starts feeding Upcoming the moment this
  // screen is opened and saved, not only after the user retypes the month.
  // The lenient `parseLegacyMonthYear` fallback is what makes that work for
  // a value that isn't canonical `YYYY-MM` yet — same parse
  // `MonthYearInput`'s own seeding and `monthYearIsoToDisplay` already fall
  // back to. `setDerivedExpiry` is a no-op once the two already agree, so
  // this doesn't fight the calculator or any other state.
  useEffect(() => {
    for (const def of formFields) {
      if (def.dataType !== 'monthYear') continue;
      const raw = values[def.key] ?? '';
      const monthYearIso = /^\d{4}-\d{2}$/.test(raw) ? raw : parseLegacyMonthYear(raw);
      setDerivedExpiry(def.key, monthYearIso ? lastDayOfMonthIso(monthYearIso) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, formFields]);

  // Which field the current error is actually about — `null` field means
  // "no error"; tracked instead of a plain `string | null` so the error can
  // render inline, next to the field it describes, rather than as one
  // generic banner at the bottom of a long form (`docs/UI-UX-REVIEW.md`
  // finding #4). Only two validation errors exist today, each tied to
  // exactly one place in the form: a missing title (the Title input, the
  // very first field) and a duplicate custom-field name (the "Custom
  // fields" section as a whole — it's inherently about more than one row,
  // so there's no single input to attach it to the way Title's error has).
  const [error, setError] = useState<{ field: 'title' | 'customFields'; message: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  const setValue = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  const addCustomField = () => {
    setCustomFields((fields) => [
      ...fields,
      { uid: uidCounter.current++, key: '', value: '', sensitive: false, dataType: 'text' },
    ]);
  };

  const updateCustomField = (uid: number, patch: Partial<CustomFieldDraft>) => {
    setCustomFields((fields) => {
      const current = fields.find((f) => f.uid === uid);
      // A custom field's key is free-text and can be renamed mid-edit — if
      // it has a renewal companion (linked by that exact key string, see
      // `CustomFieldDraft.renewalOf`), the rename has to carry the link
      // along, or the companion silently orphans: still saved, but with no
      // original field left for `renewalFor` to match it against, so it'd
      // render nowhere.
      const renamed = current && patch.key !== undefined && patch.key !== current.key;
      return fields.map((f) => {
        if (f.uid === uid) return { ...f, ...patch };
        if (renamed && f.renewalOf === current.key) return { ...f, renewalOf: patch.key };
        return f;
      });
    });
  };

  const removeCustomField = (uid: number) => {
    setCustomFields((fields) => {
      const removed = fields.find((f) => f.uid === uid);
      // Cascade: a removed field's renewal companion (if any) has nothing
      // left to be a renewal *of* — same orphaning risk as the rename case
      // in `updateCustomField` above, but with no field left to reattach
      // to, so it's dropped rather than relinked.
      return fields.filter((f) => f.uid !== uid && !(removed && f.renewalOf === removed.key));
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (title.trim() === '') {
      setError({ field: 'title', message: 'A title is required — it is how you will find this entry.' });
      titleRef.current?.focus();
      return;
    }

    const namedCustomFields = customFields.filter((f) => f.key.trim() !== '');
    const keys = namedCustomFields.map((f) => f.key.trim());
    if (new Set(keys).size !== keys.length) {
      setError({
        field: 'customFields',
        message: 'Two custom fields have the same name — give each one a unique name.',
      });
      return;
    }

    setSaving(true);
    setError(null);

    const customFieldInputs: EntryFieldInput[] = namedCustomFields.map((f) => ({
      key: f.key.trim(),
      value: f.value,
      custom: true,
      sensitive: f.sensitive,
      dataType: f.sensitive ? 'text' : f.dataType,
      renewalOf: f.renewalOf,
      renewalCalc: f.renewalCalc,
      trackedInUpcoming: f.trackedInUpcoming,
    }));

    const input = isLogin
      ? {
          type: LOGIN_TYPE_ID,
          title: title.trim(),
          username: values.username ?? '',
          email: values.email ?? '',
          password: values.password ?? '',
          url: values.url ?? '',
          notes: values.notes ?? '',
          fields: customFieldInputs,
        }
      : {
          type: typeId,
          title: title.trim(),
          fields: [
            ...formFields.map((def) => ({
              key: def.key,
              value: values[def.key] ?? '',
              trackedInUpcoming: templateTracked[def.key],
            })),
            ...customFieldInputs,
          ],
        };

    try {
      if (entry) await updateEntry(entry.id, input);
      else await addEntry(input);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    // Android: background only, per request — this step's own fields/
    // labels/buttons below are untouched; only the container's wall gets
    // `TypePicker.tsx`'s own `ENTRY_CREATION_WALL_GRADIENT` (that file's
    // own doc has the full story — the same warm tint step 1 uses, so the
    // two steps of one flow read as one continuous space rather than a
    // wall color that changes hand-off).
    <form
      onSubmit={submit}
      className={`flex h-full flex-col ${platform.isAndroid ? '' : 'bg-ink-950'}`}
      style={platform.isAndroid ? { backgroundImage: ENTRY_CREATION_WALL_GRADIENT } : undefined}
    >
      <header className="flex items-center gap-2 px-4 pb-2 pt-3">
        <button type="button" className="btn-ghost px-2" onClick={onCancel} aria-label="Cancel">
          <BackIcon />
        </button>
        <h1 className="mr-auto text-sm font-semibold text-slate-200">
          {entry ? `Edit ${typeDef.label.toLowerCase()}` : `New ${typeDef.label.toLowerCase()}`}
        </h1>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-8">
        <label className="label mt-2" htmlFor="entry-title">
          Title
        </label>
        <input
          id="entry-title"
          ref={titleRef}
          className={`field ${error?.field === 'title' ? 'border-bad focus:border-bad' : ''}`}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            // Clears the moment the user starts fixing it, rather than
            // leaving a stale red border/message sitting there while
            // they're actively typing a real title.
            if (error?.field === 'title') setError(null);
          }}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error?.field === 'title'}
          aria-describedby={error?.field === 'title' ? 'entry-title-error' : undefined}
        />
        {error?.field === 'title' && (
          <p id="entry-title-error" role="alert" className="mt-1 text-sm text-bad">
            {error.message}
          </p>
        )}

        {isLogin ? (
          <LoginFields values={values} setValue={setValue} knownEmails={knownEmails} />
        ) : (
          formFields.map((def) => (
            <TemplateFieldInput
              key={def.key}
              label={def.label}
              dataType={def.dataType}
              sensitive={def.sensitive}
              value={values[def.key] ?? ''}
              onChange={(v) => setValue(def.key, v)}
              tracked={!!templateTracked[def.key]}
              onTrackedChange={(v) => setTemplateTracked((t) => ({ ...t, [def.key]: v }))}
              renewal={renewalFor(def.key)}
              onAddRenewal={() => addRenewalField(def.key)}
              onRenewalManualChange={(v) => updateRenewalField(def.key, { value: v, renewalCalc: undefined })}
              onRenewalCalcApply={(v, calc) => updateRenewalField(def.key, { value: v, renewalCalc: calc })}
              onRenewalCalcSnapshotUpdate={(calc) => updateRenewalField(def.key, { renewalCalc: calc })}
              onRenewalTrackedChange={(v) => updateRenewalField(def.key, { trackedInUpcoming: v })}
              onRemoveRenewal={() => removeRenewalField(def.key)}
            />
          ))
        )}

        <div className="mt-6 flex items-center justify-between">
          <span className="label">Custom fields</span>
          <button type="button" className="btn-ghost px-2 text-xs" onClick={addCustomField}>
            <PlusIcon className="h-3.5 w-3.5" />
            Add field
          </button>
        </div>
        {error?.field === 'customFields' && (
          <p role="alert" className="-mt-2 mb-2 text-sm text-bad">
            {error.message}
          </p>
        )}

        {visibleCustomFields.map((f) => (
          <CustomFieldRow
            key={f.uid}
            field={f}
            onChange={(patch) => updateCustomField(f.uid, patch)}
            onRemove={() => removeCustomField(f.uid)}
            renewal={renewalFor(f.key)}
            onAddRenewal={() => addRenewalField(f.key)}
            onRenewalManualChange={(v) => updateRenewalField(f.key, { value: v, renewalCalc: undefined })}
            onRenewalCalcApply={(v, calc) => updateRenewalField(f.key, { value: v, renewalCalc: calc })}
            onRenewalCalcSnapshotUpdate={(calc) => updateRenewalField(f.key, { renewalCalc: calc })}
            onRenewalTrackedChange={(v) => updateRenewalField(f.key, { trackedInUpcoming: v })}
            onRemoveRenewal={() => removeRenewalField(f.key)}
            knownEmails={knownEmails}
          />
        ))}
      </div>
    </form>
  );
}

function LoginFields({
  values,
  setValue,
  knownEmails,
}: {
  values: Record<string, string>;
  setValue: (key: string, value: string) => void;
  knownEmails: string[];
}) {
  return (
    <>
      <label className="label mt-4" htmlFor="entry-username">
        Username
      </label>
      <input
        id="entry-username"
        className="field"
        value={values.username ?? ''}
        onChange={(e) => setValue('username', e.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />

      <label className="label mt-4" htmlFor="entry-email">
        Email
      </label>
      <EmailSuggestInput
        id="entry-email"
        value={values.email ?? ''}
        onChange={(v) => setValue('email', v)}
        knownEmails={knownEmails}
      />

      <label className="label mt-4" htmlFor="password">
        Password
      </label>
      <PasswordField value={values.password ?? ''} onChange={(v) => setValue('password', v)} />

      <label className="label mt-4" htmlFor="entry-url">
        URL
      </label>
      <input
        id="entry-url"
        className="field"
        value={values.url ?? ''}
        onChange={(e) => setValue('url', e.target.value)}
        inputMode="url"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
      />

      <label className="label mt-4" htmlFor="entry-notes">
        Notes
      </label>
      <textarea
        id="entry-notes"
        className="field min-h-24 resize-y"
        value={values.notes ?? ''}
        onChange={(e) => setValue('notes', e.target.value)}
        spellCheck={false}
      />
    </>
  );
}

/** One template field's input, shaped by its registry `dataType`/`sensitive`
 * — a plain text input, a textarea for `multiline`, or a mask-toggle text
 * input for a sensitive field that isn't Login's password (which keeps its
 * own richer `PasswordField` with the generator). */
function TemplateFieldInput({
  label,
  dataType,
  sensitive,
  value,
  onChange,
  tracked,
  onTrackedChange,
  renewal,
  onAddRenewal,
  onRenewalManualChange,
  onRenewalCalcApply,
  onRenewalCalcSnapshotUpdate,
  onRenewalTrackedChange,
  onRemoveRenewal,
}: {
  label: string;
  dataType: FieldDataType;
  sensitive: boolean;
  value: string;
  onChange: (value: string) => void;
  /** Meaningful only while `dataType === 'date'` — whether *this* field
   * itself (not any renewal companion) is opted into the Upcoming tab. See
   * `DateFieldWithRenewal`'s own `tracked`/`onTrackedChange`. */
  tracked?: boolean;
  onTrackedChange?: (value: boolean) => void;
  /** Meaningful while `dataType === 'date'` (a real, user-managed renewal —
   * see `DateFieldWithRenewal`) or `dataType === 'monthYear'` (the
   * always-derived, read-only Expiry-date companion — see
   * `setDerivedExpiry`). Unused for every other `dataType`. */
  renewal?: CustomFieldDraft;
  onAddRenewal?: () => void;
  onRenewalManualChange?: (value: string) => void;
  onRenewalCalcApply?: (value: string, calc: RenewalCalc) => void;
  onRenewalCalcSnapshotUpdate?: (calc: RenewalCalc) => void;
  /** The renewal/derived companion's own tracking toggle — see
   * `DateFieldWithRenewal.onRenewalTrackedChange`. Used by both the
   * `'date'` branch (a real renewal) and the `'monthYear'` branch (Card
   * Expiry's derived companion). */
  onRenewalTrackedChange?: (value: boolean) => void;
  onRemoveRenewal?: () => void;
}) {
  const id = `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

  if (sensitive) {
    return (
      <>
        <label className="label mt-4" htmlFor={id}>
          {label}
        </label>
        <MaskedInput id={id} value={value} onChange={onChange} />
      </>
    );
  }

  if (dataType === 'multiline') {
    return (
      <>
        <label className="label mt-4" htmlFor={id}>
          {label}
        </label>
        <textarea
          id={id}
          className="field min-h-24 resize-y"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      </>
    );
  }

  if (dataType === 'monthYear') {
    // No "+ Renewal date" button here, and no calculator — this isn't an
    // opt-in the way a real renewal is. The derived companion (`renewal`,
    // reusing that same prop purely as a link — see `setDerivedExpiry`) is
    // kept in sync automatically the moment a valid month is typed, and
    // shown here only as a read-only preview of what Upcoming will track.
    return (
      <>
        <label className="label mt-4" htmlFor={id}>
          {label}
        </label>
        <MonthYearInput id={id} value={value} onChange={onChange} />
        {renewal && (
          <div className="mt-2 border-l-2 border-ink-500 pl-3">
            <span className="label">Expiry date</span>
            <div className="flex items-start gap-2">
              <p className="field flex min-h-[2.375rem] flex-1 items-center text-slate-300">
                {isoToDisplay(renewal.value)}
              </p>
              <TrackToggle
                tracked={!!renewal.trackedInUpcoming}
                onChange={(v) => onRenewalTrackedChange?.(v)}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  if (dataType === 'date') {
    // The five `onRenewal*`/`onAddRenewal` callbacks are always passed by
    // both call sites that ever reach this branch (`formFields.map` above,
    // `CustomFieldRow` below) — optional only because they're meaningless
    // (and omitted) for this component's non-date branches.
    return (
      <>
        <label className="label mt-4" htmlFor={id}>
          {label}
        </label>
        <DateFieldWithRenewal
          id={id}
          value={value}
          onChange={onChange}
          tracked={!!tracked}
          onTrackedChange={onTrackedChange!}
          renewal={renewal}
          onAddRenewal={onAddRenewal!}
          onRenewalManualChange={onRenewalManualChange!}
          onRenewalCalcApply={onRenewalCalcApply!}
          onRenewalCalcSnapshotUpdate={onRenewalCalcSnapshotUpdate!}
          onRenewalTrackedChange={onRenewalTrackedChange!}
          onRemoveRenewal={onRemoveRenewal!}
        />
      </>
    );
  }

  return (
    <>
      <label className="label mt-4" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={dataType === 'number' ? 'numeric' : undefined}
        type="text"
        autoComplete="off"
        spellCheck={false}
      />
    </>
  );
}

/** A plain reveal-toggle text input — the sensitive-field equivalent of
 * `TemplateFieldInput`'s text branch, for every sensitive field that isn't
 * Login's password. */
function MaskedInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex gap-2">
      <input
        id={id}
        className="field font-mono tabular-nums tracking-wide"
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <button
        type="button"
        className="btn-secondary px-2.5"
        onClick={() => setRevealed((r) => !r)}
        aria-label={revealed ? 'Hide' : 'Show'}
        title={revealed ? 'Hide' : 'Show'}
      >
        {revealed ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

/** A small two-way "Text | Date" chip pair — `CustomFieldRow`'s only type
 * choice, so a full `<select>` would be more chrome than the decision
 * warrants. */
function TypeChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-accent/20 text-accent' : 'bg-ink-800 text-slate-400 hover:text-slate-200'
      }`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function CustomFieldRow({
  field,
  onChange,
  onRemove,
  renewal,
  onAddRenewal,
  onRenewalManualChange,
  onRenewalCalcApply,
  onRenewalCalcSnapshotUpdate,
  onRenewalTrackedChange,
  onRemoveRenewal,
  knownEmails,
}: {
  field: CustomFieldDraft;
  onChange: (patch: Partial<CustomFieldDraft>) => void;
  onRemove: () => void;
  /** Only meaningful while `field.dataType === 'date'` — see
   * `DateFieldWithRenewal`. A custom date field can have its own renewal
   * companion exactly like a template date field can. */
  renewal: CustomFieldDraft | undefined;
  onAddRenewal: () => void;
  onRenewalManualChange: (value: string) => void;
  onRenewalCalcApply: (value: string, calc: RenewalCalc) => void;
  onRenewalCalcSnapshotUpdate: (calc: RenewalCalc) => void;
  onRenewalTrackedChange: (value: boolean) => void;
  onRemoveRenewal: () => void;
  /** See `EmailSuggestInput` — only rendered through when this field's own
   * name looks like an email field (`isEmailFieldName`), same idea as
   * `dataType === 'date'` gating `DateFieldWithRenewal` below. */
  knownEmails: string[];
}) {
  return (
    <div className="card mt-2 p-3">
      <div className="flex items-center gap-2">
        <input
          className="field flex-1"
          placeholder="Field name"
          value={field.key}
          onChange={(e) => onChange({ key: e.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="btn-ghost px-2 text-bad"
          onClick={onRemove}
          aria-label="Remove field"
          title="Remove field"
        >
          <TrashIcon />
        </button>
      </div>

      {/* Date only ever applies to a non-sensitive field — a sensitive one
          always renders through `MaskedInput` below regardless, so there's
          nothing for the choice to affect while `sensitive` is on. */}
      {!field.sensitive && (
        <div className="mt-2 flex gap-1.5">
          <TypeChip
            label="Text"
            active={field.dataType === 'text'}
            onClick={() => {
              // Switching a date field with a renewal companion back to
              // Text would otherwise orphan that companion — same risk as
              // renaming or removing the field it belongs to, see
              // `updateCustomField`/`removeCustomField`'s own comments.
              if (renewal) onRemoveRenewal();
              onChange({ dataType: 'text' });
            }}
          />
          <TypeChip
            label="Date"
            active={field.dataType === 'date'}
            onClick={() => onChange({ dataType: 'date', value: '' })}
          />
        </div>
      )}

      <div className="mt-2">
        {field.sensitive ? (
          <MaskedInput
            id={`custom-${field.uid}`}
            value={field.value}
            onChange={(v) => onChange({ value: v })}
          />
        ) : field.dataType === 'date' ? (
          <DateFieldWithRenewal
            id={`custom-${field.uid}`}
            value={field.value}
            onChange={(v) => onChange({ value: v })}
            tracked={!!field.trackedInUpcoming}
            onTrackedChange={(v) => onChange({ trackedInUpcoming: v })}
            renewal={renewal}
            onAddRenewal={onAddRenewal}
            onRenewalManualChange={onRenewalManualChange}
            onRenewalCalcApply={onRenewalCalcApply}
            onRenewalCalcSnapshotUpdate={onRenewalCalcSnapshotUpdate}
            onRenewalTrackedChange={onRenewalTrackedChange}
            onRemoveRenewal={onRemoveRenewal}
          />
        ) : isEmailFieldName(field.key) ? (
          <EmailSuggestInput
            id={`custom-${field.uid}`}
            value={field.value}
            onChange={(v) => onChange({ value: v })}
            knownEmails={knownEmails}
            placeholder="Value"
          />
        ) : (
          <input
            className="field"
            placeholder="Value"
            value={field.value}
            onChange={(e) => onChange({ value: e.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">Sensitive</span>
        <Toggle
          checked={field.sensitive}
          onChange={(v) => {
            // Turning Sensitive on forces dataType back to 'text' (a
            // sensitive field is always masked text, never date-picked) —
            // same renewal-orphaning risk as the Text chip above, and the
            // same fix.
            if (v && renewal) onRemoveRenewal();
            onChange({ sensitive: v, dataType: v ? 'text' : field.dataType });
          }}
          label="Sensitive field"
        />
      </div>
    </div>
  );
}
