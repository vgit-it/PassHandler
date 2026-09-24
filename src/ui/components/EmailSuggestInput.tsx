import { useMemo, useRef, useState } from 'react';

import { filterEmailSuggestions } from '../../vault/emailSuggestions';

/**
 * A plain text input for an email-shaped field, plus a dropdown of
 * already-used addresses from elsewhere in the vault — narrowed as you
 * type, so re-using "the same few addresses I always sign up with" never
 * means retyping one from memory. See `email-suggestions-design.md`.
 *
 * `knownEmails` is handed in by the caller (already deduped, already
 * excluding the entry currently being edited — see
 * `collectKnownEmails`), not gathered in here — this component only ever
 * filters and renders a list it's given, so it stays free of any
 * `Vault`/`useApp` dependency and is trivial to drop into either the
 * Login-specific Email field or a matching custom field.
 *
 * Closing on blur and picking with a click race, the same way any combobox
 * does — solved the usual way: each suggestion button calls
 * `preventDefault()` on its own `mousedown`, so the input never actually
 * loses focus (and never fires `onBlur`) on the click that picks it.
 */
export function EmailSuggestInput({
  id,
  value,
  onChange,
  knownEmails,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Already computed by the caller — see `collectKnownEmails`. */
  knownEmails: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(
    () => (knownEmails.length === 0 ? [] : filterEmailSuggestions(knownEmails, value)),
    [knownEmails, value],
  );
  const showDropdown = open && suggestions.length > 0;
  const listboxId = `${id}-suggestions`;

  const pick = (email: string) => {
    onChange(email);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        className="field"
        type="email"
        inputMode="email"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!showDropdown) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlighted((i) => (i + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted((i) => (i - 1 + suggestions.length) % suggestions.length);
          } else if (e.key === 'Enter') {
            // Only steal Enter once a suggestion is actually showing — this
            // sits inside a `<form>` (the entry editor), and Enter has to
            // keep submitting it the rest of the time.
            const chosen = suggestions[highlighted];
            if (chosen) {
              e.preventDefault();
              pick(chosen);
            }
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-controls={listboxId}
      />

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-lg border border-ink-600 bg-ink-800 py-1 shadow-lg"
        >
          {suggestions.map((email, i) => (
            <li key={email}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlighted}
                className={`block w-full truncate px-3 py-1.5 text-left text-sm ${
                  i === highlighted ? 'bg-ink-700 text-slate-100' : 'text-slate-300'
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => pick(email)}
              >
                {email}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
