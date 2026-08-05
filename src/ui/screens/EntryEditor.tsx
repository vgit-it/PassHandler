import { useState } from 'react';

import { useApp } from '../../app/store';
import { VaultEntry } from '../../vault/types';
import { PasswordField } from '../components/PasswordField';
import { BackIcon } from '../components/icons';

/**
 * Add or edit an entry.
 *
 * The password is in component state here, unavoidably — it is being typed or
 * generated. It lives for the duration of this screen and no longer: the list
 * model never carries it, and closing the editor drops it.
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
  const { addEntry, updateEntry, readPassword } = useApp();

  const [title, setTitle] = useState(entry?.title ?? '');
  const [username, setUsername] = useState(entry?.username ?? '');
  const [password, setPassword] = useState(() =>
    entry ? (readPassword(entry.id) ?? '') : '',
  );
  const [url, setUrl] = useState(entry?.url ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (title.trim() === '') {
      setError('A title is required — it is how you will find this entry.');
      return;
    }

    setSaving(true);
    setError(null);

    const input = { title: title.trim(), username, password, url, notes };
    try {
      if (entry) await updateEntry(entry.id, input);
      else await addEntry(input);
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <button type="button" className="btn-ghost px-2" onClick={onCancel} aria-label="Cancel">
          <BackIcon />
        </button>
        <h1 className="mr-auto text-sm font-semibold text-slate-200">
          {entry ? 'Edit entry' : 'New entry'}
        </h1>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 pb-8">
        <label className="label mt-2" htmlFor="entry-title">
          Title
        </label>
        <input
          id="entry-title"
          className="field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          autoComplete="off"
          spellCheck={false}
        />

        <label className="label mt-4" htmlFor="entry-username">
          Username
        </label>
        <input
          id="entry-username"
          className="field"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        <label className="label mt-4" htmlFor="password">
          Password
        </label>
        <PasswordField value={password} onChange={setPassword} />

        <label className="label mt-4" htmlFor="entry-url">
          URL
        </label>
        <input
          id="entry-url"
          className="field"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
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
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          spellCheck={false}
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-bad">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
