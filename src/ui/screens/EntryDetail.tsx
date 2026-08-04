import { useState } from 'react';

import { useApp } from '../../app/store';
import { VaultEntry } from '../../vault/types';
import { useReveal } from '../hooks/useReveal';
import {
  BackIcon,
  CopyIcon,
  ExternalIcon,
  EyeIcon,
  EyeOffIcon,
  TrashIcon,
} from '../components/icons';

export function EntryDetail({
  entry,
  onBack,
  onEdit,
  onCopy,
}: {
  entry: VaultEntry;
  onBack: () => void;
  onEdit: () => void;
  onCopy: (value: string, label: string) => void;
}) {
  const { readPassword, deleteEntry, platform } = useApp();
  const { revealed, secondsLeft, toggle } = useReveal();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Read on each render while revealed, and never stored in state — the
  // plaintext exists only for as long as this render needs it.
  const password = revealed ? (readPassword(entry.id) ?? '') : '';

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <button className="btn-ghost px-2" onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <h1 className="mr-auto min-w-0 truncate text-sm font-semibold text-slate-200">
          {entry.title || 'Untitled'}
        </h1>
        <button className="btn-secondary" onClick={onEdit}>
          Edit
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 pb-6">
        <button
          className="btn-primary mt-2 w-full py-3"
          onClick={() => {
            const value = readPassword(entry.id);
            if (value) onCopy(value, `Password for ${entry.title || 'entry'}`);
          }}
        >
          <CopyIcon />
          Copy password
        </button>

        <div className="card mt-4 divide-y divide-ink-600">
          {entry.username && (
            <Field label="Username" value={entry.username}>
              <button
                className="btn-ghost px-2"
                onClick={() => onCopy(entry.username, 'Username')}
                aria-label="Copy username"
                title="Copy username"
              >
                <CopyIcon />
              </button>
            </Field>
          )}

          <Field
            label="Password"
            value={revealed ? password : '••••••••••••'}
            mono
            hint={revealed ? `Hiding in ${secondsLeft}s` : undefined}
          >
            <button
              className="btn-ghost px-2"
              onClick={toggle}
              aria-label={revealed ? 'Hide password' : 'Reveal password'}
              title={revealed ? 'Hide password' : 'Reveal password'}
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </Field>

          {entry.url && (
            <Field label="URL" value={entry.url}>
              <button
                className="btn-ghost px-2"
                onClick={() => void platform.openExternal(entry.url)}
                aria-label="Open in browser"
                title="Open in browser"
              >
                <ExternalIcon />
              </button>
            </Field>
          )}
        </div>

        {entry.notes && (
          <div className="card mt-3 p-3">
            <div className="label">Notes</div>
            <p
              data-selectable
              className="whitespace-pre-wrap break-words text-sm text-slate-300"
            >
              {entry.notes}
            </p>
          </div>
        )}

        <p className="mt-4 text-center text-xs text-slate-500">
          Last changed {new Date(entry.updatedAt).toLocaleString()}
        </p>

        <div className="mt-6">
          {confirmingDelete ? (
            <div className="card border-bad/30 p-3">
              <p className="text-sm text-slate-300">
                Delete <strong>{entry.title || 'this entry'}</strong>? This will also
                remove it from your other devices the next time they sync.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-danger flex-1"
                  onClick={() => {
                    void deleteEntry(entry.id);
                    onBack();
                  }}
                >
                  Delete
                </button>
                <button
                  className="btn-secondary flex-1"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="btn-ghost w-full text-bad" onClick={() => setConfirmingDelete(true)}>
              <TrashIcon />
              Delete entry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  children,
  mono,
  hint,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="label mb-0.5">
          {label}
          {hint && <span className="ml-2 normal-case text-slate-500">{hint}</span>}
        </div>
        <div
          data-selectable
          className={`truncate text-sm text-slate-100 ${mono ? 'font-mono' : ''}`}
        >
          {value}
        </div>
      </div>
      {children}
    </div>
  );
}
