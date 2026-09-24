import { useEffect, useState } from 'react';

import { Platform } from '../../platform/ports';
import { isoToDisplay } from '../../vault/dateFormat';
import { monthYearIsoToDisplay } from '../../vault/monthYearFormat';
import { EntryField } from '../../vault/types';
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon } from './icons';

/**
 * One field, displayed. Used identically for every field on every entry type
 * in `EntryDetail` — a type only decides which fields exist (via
 * `entryTypes.ts`) and never how one of them renders, per
 * `entry-type-expansion-spec.md`.
 *
 * Deliberately display-only: the editor's field inputs are a controlled
 * form, a different interaction model (typing into a field rather than
 * revealing/copying one), and live in `EntryEditor.tsx` as
 * `EntryFieldInputRow` instead of sharing this component. What *is* shared
 * between the two is the one thing that actually needs to be — the field
 * list itself, read off `entryTypes.ts` and a `VaultEntry`'s `fields`.
 */
export function FieldRow({
  field,
  revealed,
  revealedValue,
  onToggleReveal,
  revealHint,
  onCopy,
  trailingAction,
  onFill,
  alwaysShowActions,
  theme = 'card',
  platform,
}: {
  field: EntryField;
  /** Only meaningful when `field.sensitive`. */
  revealed?: boolean;
  /** The plaintext, once fetched — ignored unless `revealed`. */
  revealedValue?: string;
  onToggleReveal?: () => void;
  revealHint?: string;
  onCopy?: () => void;
  /** e.g. "open in browser" for a Login's URL — one extra button beyond
   * reveal/copy, specific to what this particular field means. */
  trailingAction?: { icon: React.ReactNode; label: string; onClick: () => void };
  /** Windows manual fill only (`PickEntryDetail`) — types this field's value
   * into whatever window had focus before the fill hotkey fired. Deliberately
   * never passed from `EntryDetail`: viewing an entry and filling one into
   * another window are two different screens, mirroring how the Android IME
   * keeps its own search/detail view (`buildDetailFieldRow`) separate from
   * this app's own. */
  onFill?: () => void;
  /** `PickEntryDetail` only — that screen's whole purpose is Fill/Show, so
   * its buttons stay visible up front rather than waiting on a hover the way
   * `EntryDetail`'s reveal/copy do (see `.field-row-action` in `index.css`;
   * this just skips that class). */
  alwaysShowActions?: boolean;
  /** `'card'` (default): this component's original look — the ink-system
   * `.label`/`text-slate-100`/`btn-ghost` this file has always used, still
   * what `PickEntryDetail` gets. `'vault'`: `EntryDetail`'s own restyle (the
   * Figma entry-detail redesign) — vault-token colors and larger value text.
   * An explicit per-caller opt-in, same pattern `alwaysShowActions` already
   * uses just above, so the two screens that share this component can keep
   * diverging without forking it. */
  theme?: 'card' | 'vault';
  /** `'vault'` only, and optional even there (`PickEntryDetail` never passes
   * it, since it always uses `'card'`) — per the Figma entry-detail design
   * (node 118:887), which has no Windows counterpart: Android gets that
   * design's own literal sizes/colors below; omitting this prop (or
   * `platform.isAndroid === false`) keeps this component's pre-existing
   * `'vault'` look, unchanged, for Windows. */
  platform?: Platform;
}) {
  // Hooks first, unconditionally — the early return just below would
  // otherwise skip them on some renders and not others, which breaks React's
  // rules of hooks.
  const [copied, setCopied] = useState(false);
  // Reset if the row unmounts mid-timeout (e.g. navigating away right after
  // copying) rather than firing setState on a gone component.
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  // Spec: an empty *optional* template field renders nothing rather than a
  // blank row. Sensitive fields always render (there's nothing to check
  // "empty" against — the value isn't in memory until revealed), and this
  // component has no way to tell "optional" from "required" on its own
  // (that's `entryTypes.ts`'s job) — callers only push an empty non-sensitive
  // field into the list at all when it should render, so an empty value here
  // simply doesn't happen for a non-sensitive field that got this far. This
  // guard is a second line of defence, not the mechanism.
  if (!field.sensitive && field.value.trim() === '') return null;

  const displayValue = field.sensitive
    ? revealed
      ? (revealedValue ?? '')
      : '••••••••••••'
    : field.dataType === 'date'
      ? isoToDisplay(field.value) || field.value
      : field.dataType === 'monthYear'
        ? monthYearIsoToDisplay(field.value) || field.value
        : field.value;
  const mono = field.sensitive || field.dataType === 'number';
  const multiline = field.dataType === 'multiline';

  const handleCopy = () => {
    onCopy?.();
    setCopied(true);
  };

  const isVault = theme === 'vault';
  // Per the Figma entry-detail design (node 118:887, Android only — see
  // this component's own `platform` doc): label 12px (no named step in
  // this project's remapped scale lands there, hence the arbitrary value),
  // same weight as before; value 16px `font-medium`, which DOES land
  // exactly on a named step (`text-sm` here, thanks to the same remap) —
  // see `tailwind.config.js`'s `fontSize` overrides. Both are `#d6e4ef`
  // (label at 50%, value full) — the home screen's own single "legible
  // foreground" hex, not 118:887's own literal pair (`#9da1a2`/white) this
  // originally read straight off the export — standardized per explicit
  // request, so Entry Detail's text reads as one palette with the rest of
  // the app rather than reproducing 118:887's own slightly different pair.
  const isAndroidVault = isVault && platform?.isAndroid;
  // `.btn-ghost` decomposed into its own base (`.btn`, theme-neutral) plus
  // explicit colors, rather than reused as-is — this is the one thing about
  // it that actually needs to vary by theme; everything else `.btn` already
  // provides (layout, transitions, disabled state) is shared.
  const actionColor = isVault
    ? 'text-vault-muted hover:bg-vault-rail hover:text-vault-fg'
    : 'text-slate-400 hover:bg-ink-700 hover:text-slate-200';
  const actionClass = `btn ${actionColor} ${alwaysShowActions ? '' : 'field-row-action'}`;

  return (
    <div
      className={`field-row group flex items-start gap-2 ${
        isAndroidVault ? 'px-4 py-4' : isVault ? 'px-3.5 py-3' : 'px-3 py-2.5'
      }`}
    >
      <div className="min-w-0 flex-1">
        <div
          className={
            isAndroidVault
              ? 'mb-1 text-[12px] font-semibold uppercase tracking-wide text-[#d6e4ef]/50'
              : isVault
                ? 'mb-1 text-xs font-semibold uppercase tracking-wide text-vault-muted'
                : 'label mb-0.5'
          }
        >
          {field.label}
          {revealHint && (
            <span className={`ml-2 normal-case ${isVault ? 'text-vault-dim' : 'text-slate-400'}`}>
              {revealHint}
            </span>
          )}
        </div>
        <div
          data-selectable
          // Windows vault theme: `text-base` (18px), not `text-lg` (20px) —
          // reduced 2px per an earlier request. Still the app's own upsized
          // `base` step (`tailwind.config.js` bumps every named size +2px
          // over Tailwind's stock scale), not a one-off arbitrary value —
          // 18px happens to land exactly on that existing named step, so
          // this stays a plain utility class rather than `text-[18px]`.
          className={`${
            isAndroidVault
              ? 'text-sm font-medium text-[#d6e4ef]'
              : isVault
                ? 'text-base font-semibold text-vault-fg'
                : 'text-sm text-slate-100'
          } ${mono ? 'font-mono tabular-nums tracking-wide' : ''} ${
            multiline ? 'whitespace-pre-wrap break-words' : 'truncate'
          }`}
        >
          {displayValue}
        </div>
      </div>

      {field.sensitive && onToggleReveal && (
        <button
          className={`${actionClass} shrink-0 px-2`}
          onClick={onToggleReveal}
          aria-label={revealed ? `Hide ${field.label}` : `Reveal ${field.label}`}
          title={revealed ? `Hide ${field.label}` : `Reveal ${field.label}`}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      )}

      {trailingAction && (
        <button
          className={`${actionClass} shrink-0 px-2`}
          onClick={trailingAction.onClick}
          aria-label={trailingAction.label}
          title={trailingAction.label}
        >
          {trailingAction.icon}
        </button>
      )}

      {field.fillable && onFill && (
        <button
          className={`${actionClass} shrink-0 px-2 text-xs font-semibold uppercase tracking-wide`}
          onClick={onFill}
          aria-label={`Fill ${field.label}`}
          title={`Fill ${field.label} into the target field`}
        >
          Fill
        </button>
      )}

      {field.copyable && onCopy && (
        <button
          className={`${alwaysShowActions ? '' : 'field-row-action '}shrink-0 px-2 btn ${
            copied ? (isVault ? 'text-vault-ok' : 'text-ok') : actionColor
          }`}
          onClick={handleCopy}
          aria-label={`Copy ${field.label}`}
          title={`Copy ${field.label}`}
        >
          {copied ? (
            <span className="flex items-center gap-1 text-xs font-medium">
              <CheckIcon className="h-4 w-4" />
              Copied!
            </span>
          ) : (
            <CopyIcon />
          )}
        </button>
      )}
    </div>
  );
}
