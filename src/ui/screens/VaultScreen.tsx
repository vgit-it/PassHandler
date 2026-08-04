import { useCallback, useEffect, useState } from 'react';

import { useApp } from '../../app/store';
import { VaultEntry } from '../../vault/types';
import { useClipboard } from '../hooks/useClipboard';
import { EntryDetail } from './EntryDetail';
import { EntryEditor } from './EntryEditor';
import { EntryList } from './EntryList';
import { SettingsScreen } from './Settings';

type View =
  | { name: 'list' }
  | { name: 'detail'; id: string }
  | { name: 'edit'; id: string | null }
  | { name: 'settings' };

export function VaultScreen() {
  const { entries, settings, platform, lock, noteActivity } = useApp();
  const [view, setView] = useState<View>({ name: 'list' });

  const { copy, clearNow, countdown } = useClipboard(
    platform.clipboard,
    settings.clipboardClearSeconds,
  );

  // Locking must take the clipboard with it. Leaving a copied password behind
  // would undo the point of locking.
  useEffect(() => () => void clearNow(), [clearNow]);

  const copyPassword = useCallback(
    (entry: VaultEntry, readPassword: (id: string) => string | null) => {
      const value = readPassword(entry.id);
      if (value) void copy(value, `Password for ${entry.title || 'entry'}`);
    },
    [copy],
  );

  const lockNow = useCallback(() => {
    void clearNow();
    lock();
  }, [clearNow, lock]);

  useShortcuts({ enabled: platform.isDesktop, onLock: lockNow });

  // Any interaction counts against the idle timer.
  useEffect(() => {
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const name of events) window.addEventListener(name, noteActivity, { passive: true });
    return () => {
      for (const name of events) window.removeEventListener(name, noteActivity);
    };
  }, [noteActivity]);

  const selected = view.name === 'detail' || (view.name === 'edit' && view.id)
    ? entries.find((e) => e.id === (view as { id: string }).id) ?? null
    : null;

  // An entry can disappear underneath a detail view when a sync merges in a
  // deletion from another device.
  useEffect(() => {
    if (view.name === 'detail' && !selected) setView({ name: 'list' });
  }, [view, selected]);

  return (
    <div className="relative h-full">
      {view.name === 'list' && (
        <ListView
          onOpen={(entry) => setView({ name: 'detail', id: entry.id })}
          onAdd={() => setView({ name: 'edit', id: null })}
          onSettings={() => setView({ name: 'settings' })}
          onCopyPassword={copyPassword}
        />
      )}

      {view.name === 'detail' && selected && (
        <EntryDetail
          entry={selected}
          onBack={() => setView({ name: 'list' })}
          onEdit={() => setView({ name: 'edit', id: selected.id })}
          onCopy={(value, label) => void copy(value, label)}
        />
      )}

      {view.name === 'edit' && (
        <EntryEditor
          entry={selected}
          onDone={() => setView({ name: 'list' })}
          onCancel={() =>
            setView(view.id ? { name: 'detail', id: view.id } : { name: 'list' })
          }
        />
      )}

      {view.name === 'settings' && <SettingsScreen onBack={() => setView({ name: 'list' })} />}

      {countdown && (
        <ClipboardBar
          label={countdown.label}
          secondsLeft={countdown.secondsLeft}
          total={settings.clipboardClearSeconds}
          onClear={() => void clearNow()}
        />
      )}
    </div>
  );
}

/** Split out so the list can read `readPassword` without prop-drilling it. */
function ListView({
  onOpen,
  onAdd,
  onSettings,
  onCopyPassword,
}: {
  onOpen: (entry: VaultEntry) => void;
  onAdd: () => void;
  onSettings: () => void;
  onCopyPassword: (entry: VaultEntry, readPassword: (id: string) => string | null) => void;
}) {
  const { readPassword } = useApp();
  return (
    <EntryList
      onOpen={onOpen}
      onAdd={onAdd}
      onSettings={onSettings}
      onCopyPassword={(entry) => onCopyPassword(entry, readPassword)}
    />
  );
}

/**
 * The visible countdown.
 *
 * Without it, "the clipboard clears itself eventually" is folklore. With it the
 * user can see exactly how long they have to paste, and clear it early.
 */
function ClipboardBar({
  label,
  secondsLeft,
  total,
  onClear,
}: {
  label: string;
  secondsLeft: number;
  total: number;
  onClear: () => void;
}) {
  const progress = Math.max(0, Math.min(1, secondsLeft / total));

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 p-3">
      <div className="pointer-events-auto overflow-hidden rounded-xl border border-ink-500 bg-ink-700 shadow-lg">
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-slate-100">{label} copied</div>
            <div className="text-xs text-slate-400">
              Clipboard clears in {secondsLeft}s
            </div>
          </div>
          <button className="btn-secondary shrink-0" onClick={onClear}>
            Clear now
          </button>
        </div>
        <div className="h-0.5 bg-ink-600">
          <div
            className="h-full bg-accent transition-[width] duration-200 ease-linear"
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Windows keyboard shortcuts.
 *
 * Not registered on Android, where there is no keyboard to serve and the
 * listeners would only fire on the soft keyboard's behalf.
 */
function useShortcuts({ enabled, onLock }: { enabled: boolean; onLock: () => void }) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey) return;

      if (event.key === 'l' || event.key === 'L') {
        event.preventDefault();
        onLock();
      } else if (event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        const search = document.querySelector<HTMLInputElement>('[data-search-input]');
        search?.focus();
        search?.select();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, onLock]);
}
