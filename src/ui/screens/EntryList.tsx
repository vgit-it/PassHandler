import { useEffect, useMemo, useRef, useState } from 'react';

import { useApp } from '../../app/store';
import { filterEntries } from '../../vault/search';
import { VaultEntry } from '../../vault/types';
import { SyncBadge, SyncNotice } from '../components/SyncBadge';
import { CopyIcon, LockIcon, PlusIcon, SearchIcon, SettingsIcon } from '../components/icons';

/**
 * The screen the app exists for.
 *
 * Optimised for search → copy → paste in a couple of seconds. On Windows the
 * search box takes focus the moment the vault unlocks, arrow keys move the
 * selection and Enter copies the highlighted password without opening anything.
 * On Android every row has its own copy button, so a password is one tap away
 * from the list.
 */
export function EntryList({
  onOpen,
  onAdd,
  onSettings,
  onCopyPassword,
}: {
  onOpen: (entry: VaultEntry) => void;
  onAdd: () => void;
  onSettings: () => void;
  onCopyPassword: (entry: VaultEntry) => void;
}) {
  const { entries, sync, lock, syncNow, platform } = useApp();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = useMemo(() => filterEntries(entries, query), [entries, query]);

  // Auto-focus search on unlock — desktop only. Focusing it on Android would
  // throw the soft keyboard up over the list before the user has asked for it.
  useEffect(() => {
    if (platform.isDesktop) searchRef.current?.focus();
  }, [platform.isDesktop]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Keep the highlighted row on screen while arrowing through a long list.
  useEffect(() => {
    const node = listRef.current?.children[selected];
    node?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (filtered.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((i) => Math.min(i + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = filtered[selected];
      // Enter copies rather than opens: the overwhelmingly common intent is to
      // paste the password somewhere, not to look at the entry.
      if (entry) (event.shiftKey ? onOpen : onCopyPassword)(entry);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <h1 className="mr-auto text-sm font-semibold text-slate-300">Pass Handler</h1>
        <SyncBadge sync={sync} onClick={() => void syncNow()} />
        <button className="btn-ghost px-2" onClick={onSettings} aria-label="Settings" title="Settings">
          <SettingsIcon />
        </button>
        <button
          className="btn-ghost px-2"
          onClick={lock}
          aria-label="Lock vault"
          title={platform.isDesktop ? 'Lock vault (Ctrl+L)' : 'Lock vault'}
        >
          <LockIcon />
        </button>
      </header>

      <SyncNotice sync={sync} />

      <div className="px-3 pb-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            ref={searchRef}
            data-search-input
            className="field pl-9"
            placeholder={platform.isDesktop ? 'Search (Ctrl+F)' : 'Search'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            type="search"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasEntries={entries.length > 0} onAdd={onAdd} />
      ) : (
        <ul ref={listRef} className="flex-1 overflow-y-auto px-3 pb-24">
          {filtered.map((entry, index) => (
            <li key={entry.id}>
              <Row
                entry={entry}
                highlighted={index === selected && platform.isDesktop}
                onOpen={() => onOpen(entry)}
                onCopy={() => onCopyPassword(entry)}
              />
            </li>
          ))}
        </ul>
      )}

      <button
        className="btn-primary absolute bottom-5 right-5 h-12 w-12 rounded-full p-0 shadow-lg"
        onClick={onAdd}
        aria-label="Add entry"
        title="Add entry"
      >
        <PlusIcon className="h-5 w-5" />
      </button>
    </div>
  );
}

function Row({
  entry,
  highlighted,
  onOpen,
  onCopy,
}: {
  entry: VaultEntry;
  highlighted: boolean;
  onOpen: () => void;
  onCopy: () => void;
}) {
  return (
    <div
      className={`group mb-1 flex items-center gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
        highlighted
          ? 'border-accent/50 bg-accent/10'
          : 'border-transparent hover:border-ink-600 hover:bg-ink-800'
      }`}
    >
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <div className="truncate text-sm font-medium text-slate-100">
          {entry.title || 'Untitled'}
        </div>
        {entry.username && (
          <div className="truncate text-xs text-slate-400">{entry.username}</div>
        )}
      </button>

      <button
        className="btn-secondary shrink-0 px-2.5 py-2"
        onClick={onCopy}
        aria-label={`Copy password for ${entry.title || 'this entry'}`}
        title="Copy password"
      >
        <CopyIcon />
      </button>
    </div>
  );
}

function EmptyState({ hasEntries, onAdd }: { hasEntries: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <p className="text-sm text-slate-400">
        {hasEntries ? 'Nothing matches that search.' : 'This vault is empty.'}
      </p>
      {!hasEntries && (
        <button className="btn-secondary mt-4" onClick={onAdd}>
          <PlusIcon />
          Add your first entry
        </button>
      )}
    </div>
  );
}
