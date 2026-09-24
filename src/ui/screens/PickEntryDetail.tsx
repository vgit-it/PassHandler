import { useEffect, useRef, useState } from 'react';

import { useApp } from '../../app/store';
import { getEntryType, LOGIN_TYPE_ID } from '../../vault/entryTypes';
import { EntryField, VaultEntry } from '../../vault/types';
import { FieldRow } from '../components/FieldRow';
import { BackIcon } from '../components/icons';
import { REVEAL_SECONDS } from '../hooks/useReveal';

/**
 * Windows manual fill's per-entry step — shown once a hotkey pick has
 * selected one entry from the list (`EntryList`'s `onPickSelect`). One row
 * per fillable field, each with its own Fill button and, for a sensitive
 * field, its own Show/Hide toggle — the same shape as the Android IME's
 * `buildDetailView`/`buildDetailFieldRow`, so "search, select, then fill or
 * show a field" behaves the same on both platforms.
 *
 * Deliberately not `EntryDetail`: that screen's job is viewing/editing an
 * entry (Copy, Edit, Delete); this one's only job is handing a value to
 * whatever window had focus before the hotkey fired, so it carries none of
 * that. `entry.fields` already lists every field this entry has, in the
 * right order — the same list `EntryDetail` renders — filtered down to the
 * ones marked `fillable` (see `vault.ts`'s `plainField`/`sensitiveField`;
 * currently every field on every type qualifies).
 */
export function PickEntryDetail({
  entry,
  onBack,
  onFill,
}: {
  entry: VaultEntry;
  onBack: () => void;
  onFill: (field: EntryField) => void;
}) {
  const { readField } = useApp();
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, number>>(new Map());

  // A fresh entry starts with nothing revealed, and drops any reveal timers
  // left over from the one before it — same as the Android IME's
  // `revealedFields.clear()` on every selection change. Also the unmount
  // cleanup, since this component goes away the moment a fill (or Back)
  // leaves this screen.
  useEffect(() => {
    setRevealedKeys(new Set());
    const pendingTimers = timers.current;
    return () => {
      pendingTimers.forEach((id) => window.clearTimeout(id));
      pendingTimers.clear();
    };
  }, [entry.id]);

  const toggleReveal = (key: string) => {
    const existingTimer = timers.current.get(key);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
      timers.current.delete(key);
    }

    setRevealedKeys((keys) => {
      const next = new Set(keys);
      if (next.has(key)) {
        next.delete(key);
        return next;
      }
      next.add(key);
      // Same auto-hide window as `useReveal` — a revealed value on this
      // screen is exactly as visible-on-a-shared-screen a risk as one on
      // `EntryDetail`.
      const id = window.setTimeout(() => {
        timers.current.delete(key);
        setRevealedKeys((keys2) => {
          const next2 = new Set(keys2);
          next2.delete(key);
          return next2;
        });
      }, REVEAL_SECONDS * 1000);
      timers.current.set(key, id);
      return next;
    });
  };

  const isLogin = entry.type === LOGIN_TYPE_ID;
  const typeLabel = getEntryType(entry.type).label;
  const fillableFields = entry.fields.filter((f) => f.fillable);

  return (
    <div className="flex h-full flex-col">
      {/* aria-label "Put back" — same spec wording as `EntryDetail`'s own
          back control (`docs/vault-visual-language-spec.md` §4.6); this
          header has always been the whole tap target, just unlabelled as
          such until now. */}
      <header
        className="flex w-full items-center gap-2 border-b border-ink-600 px-4 pb-3 pt-3 text-left"
        role="button"
        tabIndex={0}
        aria-label="Put back"
        onClick={onBack}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onBack();
        }}
      >
        <BackIcon />
        <div className="min-w-0">
          {/* Flies in from the picked row's own title — see
              `ShelfOriginPanel.tsx`. */}
          <div data-morph="title" className="truncate text-sm font-semibold text-slate-200">
            {entry.title || 'Untitled'}
          </div>
          {!isLogin && <div className="text-xs text-slate-400">{typeLabel}</div>}
        </div>
      </header>

      {/* px-2, not this app's usual px-4 screen-edge inset — `FieldRow`
          (below, and the "nothing fillable" message's own px-3) already
          carries its own px-3 of left/right padding since it has no `.card`
          wrapper here to provide it, so this only needs to add the
          remainder up to the same total. */}
      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {fillableFields.length === 0 ? (
          <p className="mt-4 px-3 text-center text-sm text-slate-400">
            Nothing on this entry can be filled.
          </p>
        ) : (
          <div className="divide-y divide-ink-600">
            {fillableFields.map((field) => (
              <PickFieldRow
                key={field.key}
                entryId={entry.id}
                field={field}
                revealed={revealedKeys.has(field.key)}
                onToggleReveal={() => toggleReveal(field.key)}
                readField={readField}
                onFill={() => onFill(field)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PickFieldRow({
  entryId,
  field,
  revealed,
  onToggleReveal,
  readField,
  onFill,
}: {
  entryId: string;
  field: EntryField;
  revealed: boolean;
  onToggleReveal: () => void;
  readField: (id: string, key: string) => string | null;
  onFill: () => void;
}) {
  const revealedValue = field.sensitive && revealed ? (readField(entryId, field.key) ?? '') : undefined;

  return (
    <FieldRow
      field={field}
      revealed={revealed}
      revealedValue={revealedValue}
      onToggleReveal={field.sensitive ? onToggleReveal : undefined}
      onFill={onFill}
      alwaysShowActions
    />
  );
}
