import { useState } from 'react';

import { useApp } from '../../app/store';
import { Platform } from '../../platform/ports';
import { getEntryType } from '../../vault/entryTypes';
import { EntryField, LOGIN_TYPE_ID, VaultEntry, fieldValue } from '../../vault/types';
import { VAULT_WALL_RADIAL_GRADIENT } from '../components/VaultFrame';
import { useFavicon } from '../hooks/useFavicon';
import { useMultiReveal } from '../hooks/useMultiReveal';
import { REVEAL_SECONDS } from '../hooks/useReveal';
import { formatIntervalShort } from '../components/DateFieldWithRenewal';
import { FieldRow } from '../components/FieldRow';
import { EntryTypeIcon } from '../components/entryTypeIcons';
import { BackIcon, EditIcon, ExternalIcon, TrashIcon } from '../components/icons';

/**
 * The entry-detail screen.
 *
 * Windows: restyled per an earlier Figma entry-detail redesign (`node-
 * id=93-210` — a static reference screenshot, not a live Figma pull; that
 * session's Figma connector wasn't authorized, so exact pixel values were
 * read off the image, not extracted). Untouched by the pass below — see
 * that pass's own note on why.
 *
 * Android: per the Figma entry-detail design (node 118:887, a live pull —
 * exact values, not screenshot estimates). This has no Windows counterpart
 * (same as the Home/Upcoming tabs' own Figma sources), so Windows keeps the
 * 93-210-based styling above rather than adopting this one; every platform
 * split below follows from that. Real changes from the 93-210-based look,
 * beyond literal colors/sizes:
 * - Back is a bare icon now, no badge/border — 118:887 shows only an
 *   invisible tap target around it, not the bordered pill this screen used
 *   to share with `VaultHeaderBar`'s Lock/Settings (that was itself a
 *   118:887-less guess).
 * - Edit now comes before Delete (was reversed), and Edit is colored
 *   `text-primary` — both read directly off 118:887, where the previous
 *   guess had them the other way with Edit uncolored.
 *   `ShelfOriginPanel`'s `transparent` prop (Android-only, its own doc has
 *   the story) is what makes it visible again.
 * - Every sensitive field's Reveal/Copy buttons are always visible now,
 *   not hover-gated (`alwaysShowActions`, threaded down to `FieldRow`) —
 *   118:887 shows them at rest with no hover state, and hover-only actions
 *   were a real, independent bug on a touch platform with no reliable
 *   `:hover` in the first place, not just a Figma mismatch.
 *
 * Carried over from the original pass, both platforms: Login's own layout
 * — a big "Copy password" hero button above a hand-picked Username/Email/
 * Password/URL subset, predating entry types entirely — is gone. Every
 * type, including Login, renders through one uniform field-row card.
 * `entry.fields` already carries Login's Username/Email/Password/URL/Notes
 * in the right shape (`LOGIN_EXTRA_FIELDS`, `vault.ts`) — the only thing
 * genuinely Login-specific was the URL field's "open in browser" button,
 * kept below but keyed off `field.key === 'url'`, not off entry type.
 * Folding Login into the uniform path is also where every sensitive
 * field's reveal picked up an auto-hide timer (`useMultiReveal`) — before,
 * only Login's password had one (`useReveal`); every other type's
 * sensitive fields stayed revealed indefinitely once toggled. Matches what
 * `PickEntryDetail.tsx` already does independently for the same problem;
 * `PickEntryDetail` itself is untouched by either pass (a different
 * screen, still `theme="card"` throughout).
 *
 * `FieldRow` (shared with `PickEntryDetail`) has a `theme` prop for this —
 * `'vault'` here, `'card'` (its original ink-system look, unchanged) still
 * the default everywhere else — and, new this pass, an optional `platform`
 * prop consulted only within `theme="vault"`, so Windows' half of that
 * theme stays exactly as the original pass left it. See that component's
 * own doc.
 */
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
  const { deleteEntry, platform, settings } = useApp();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const isAndroid = platform.isAndroid;

  return (
    <div
      className={`flex h-full flex-col ${isAndroid ? '' : 'bg-vault-wall'}`}
      // Android: the same radial gradient `VaultFrame`'s own wall already
      // paints, applied a second time, directly, rather than only ever
      // trusting it to show through `ShelfOriginPanel` and this div's own
      // (otherwise-empty) background three ancestors up. Reported as not
      // reliably visible in practice; re-verified the whole chain — every
      // class matches, and a from-scratch reproduction of the exact same
      // structure renders it correctly — so rather than keep guessing at
      // an unreproduced cause, this makes the screen correct on its own
      // regardless of what that chain does. Harmless where the chain DOES
      // work too: both gradients are pixel-identical, so there's nothing
      // to visually double up.
      style={isAndroid ? { backgroundImage: VAULT_WALL_RADIAL_GRADIENT } : undefined}
    >
      {/* `data-stagger` (here, each field row, and the footer) and
          `data-morph` (the icon and title below) are the open animation's
          hooks — see `ShelfOriginPanel.tsx`: morph elements fly in from the
          tapped card, stagger elements fade and rise in one after another
          once the box is open. */}
      <header
        data-stagger
        className={`flex items-center gap-2 pb-2 pt-3 ${isAndroid ? 'px-5' : 'px-4'}`}
      >
        {/* aria-label is "Put back", not "Back" — the spec's own dismiss
            wording for this view (`docs/vault-visual-language-spec.md`
            §4.6). All three of this header's icons (this one, Delete, Edit
            below) are `h-6 w-6`, not `h-5 w-5` — +4px per an earlier
            request, landing exactly on Tailwind's next named step (5=20px,
            6=24px), so a plain utility class rather than an arbitrary
            value. Each button's own padding is unchanged, so the taller
            icon grows the button's whole footprint too, not just the
            glyph inside it. Windows: bordered badge, border/bg/icon-color
            literals copied verbatim from `VaultHeaderBar`'s own Lock/
            Settings badges (`VaultScreen.tsx`) — the pre-118:887 guess,
            left as-is. Android: bare icon, no badge — 118:887 shows only
            an invisible tap target here; `active:opacity-60` is this
            file's own addition for basic touch feedback, since a frozen
            mock can't show a pressed state either way. The icon's own
            color, though, is no longer `#6C7681` — that hex is the old
            pre-118:887 Windows guess (still correct THERE, hence left
            alone below), reused here seemingly by copy-paste rather than
            anything Android-specific; nothing on the home screen's own
            Android header uses it. `#d6e4ef` at 50% opacity replaces it —
            the same "present but secondary" treatment Home's own search
            icon uses (`EntryList.tsx`). */}
        <button
          className={
            isAndroid
              ? 'p-2 text-[#d6e4ef]/50 transition-opacity active:opacity-60'
              : 'rounded-[10px] border border-[#3C4A56] bg-[#242C34] p-2 hover:bg-[#242C34]'
          }
          onClick={onBack}
          aria-label="Put back"
          title="Put back"
        >
          <BackIcon className={`h-6 w-6 ${isAndroid ? 'text-[#d6e4ef]/50' : 'text-[#6C7681]'}`} />
        </button>
        <div className="ml-auto flex items-center gap-1">
          {/* Android: Edit before Delete, Edit colored `text-primary` —
              both per 118:887, reversed and uncolored (respectively) in
              the pre-118:887 Windows version below. */}
          {isAndroid && (
            <button
              className="btn-ghost px-2 text-primary"
              onClick={onEdit}
              aria-label="Edit entry"
              title="Edit entry"
            >
              <EditIcon className="h-6 w-6" />
            </button>
          )}
          <button
            className="btn-ghost px-2 text-bad"
            onClick={() => setConfirmingDelete(true)}
            aria-label="Delete entry"
            title="Delete entry"
          >
            <TrashIcon className="h-6 w-6" />
          </button>
          {!isAndroid && (
            <button
              className="btn-ghost px-2"
              onClick={onEdit}
              aria-label="Edit entry"
              title="Edit entry"
            >
              <EditIcon className="h-6 w-6" />
            </button>
          )}
        </div>
      </header>

      <div
        className={`flex-1 overflow-y-auto pb-6 ${isAndroid ? 'px-5 pt-2' : 'px-4'}`}
      >
        {/* 20px clearance above and below this row, both platforms (per
            request), verified by measuring the actual rendered gap in a
            browser, not just by reading the class values off — the header's
            own `pb-2` does NOT add to the gap below it the way it first
            looks like it should: that padding is already baked into where
            the header's own bottom edge renders, so measuring from there
            only ever picks up whatever comes AFTER it. Below is fully this
            row's own — `mb-5` (20px) already was on Windows; Android's
            `mb-3` (12px) is bumped to match, and nothing after this row
            (`confirmingDelete`'s block, `EntryFieldsCard`'s own root) has a
            competing top margin, so this row's `mb-5` is the whole gap on
            both platforms. Above: the content wrapper's own top padding is
            the only OTHER real contributor (Android's `pt-2`, 8px; Windows
            has none) — `overflow-y-auto` gives the wrapper its own block-
            formatting context, so the row's `mt-*` here doesn't collapse
            into it. So this row supplies the rest itself: `mt-5` (20px) on
            Windows (wrapper contributes 0), `mt-3` (12px) on Android
            (wrapper's `pt-2` contributes 8px, 8+12=20). */}
        <div className={`flex items-center gap-3 ${isAndroid ? 'mt-3 mb-5' : 'mt-5 mb-5'}`}>
          {/* `flex` so the wrapper hugs the icon exactly (no inline-SVG
              baseline gap) — its rect is what the shared-element flight
              measures. */}
          <div data-morph="icon" className="flex shrink-0">
            <EntryDetailIcon entry={entry} platform={platform} showSiteIcons={settings.showSiteIcons} />
          </div>
          <h1
            data-morph="title"
            className={`min-w-0 truncate ${
              isAndroid ? 'text-lg font-medium text-[#d6e4ef]' : 'text-2xl font-bold text-vault-fg'
            }`}
          >
            {entry.title || 'Untitled'}
          </h1>
        </div>

        {confirmingDelete && (
          // Same `bg-vault-shelf`-vs-Android-card fork as `EntryFieldsCard`
          // below — see that component's own doc for why the solid
          // Windows-vault-token fill was never adapted to Android's own
          // translucent card language.
          <div
            className={`mb-4 rounded-vault-inner border border-bad/30 p-3.5 ${
              isAndroid ? 'bg-[rgba(77,87,97,.4)]' : 'bg-vault-shelf'
            }`}
          >
            <p className={`text-sm ${isAndroid ? 'text-[#d6e4ef]' : 'text-vault-fg'}`}>
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
        )}

        <EntryFieldsCard entry={entry} onCopy={onCopy} />

        {/* Size was already right (`text-xs` is 14px in this project's
            remapped scale, matching 118:887's literal 14px exactly).
            Android color is `#d6e4ef` at 80% opacity, `font-light` — was
            118:887's own literal `#9da1a2`, standardized to the home
            screen's `#d6e4ef` family per explicit request (see the
            icon+title row's own doc above for the fuller reasoning).
            Windows keeps `text-vault-dim` (`#5f6871`) and the default
            (normal) weight, the pre-118:887 choice, unaffected by any of
            this. */}
        <p
          data-stagger
          className={`mt-4 text-center text-xs ${
            isAndroid ? 'font-light text-[#d6e4ef]/80' : 'text-vault-dim'
          }`}
        >
          Last changed {new Date(entry.updatedAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

/**
 * The icon beside the entry title — the fetched site favicon once one's
 * available, the entry-type glyph otherwise. No badge/box around either
 * variant — this screen deliberately shows just the icon itself, unlike
 * `EntryList.tsx`'s own `EntrySiteIcon` (a neutral plate with row-press
 * states tied to an ancestor `group` class on a clickable row), which is
 * why this isn't just that component reused here: nothing about this row is
 * clickable, and the plate/press treatment has no meaning on it. Reuses
 * `useFavicon` directly instead — the same hook `EntrySiteIcon` itself
 * calls — so the fetch logic (and its "isolated, no cache, `null` covers
 * loading/disabled/failed alike" contract) isn't duplicated a second time.
 *
 * Favicon fetching only ever applies to a Login entry (the only type with a
 * URL field), and only while Settings' "show site icons" is on — same
 * `showSiteIcons` gate `EntryList`/`UpcomingScreen` already read off
 * `useApp()`. `sizeClass` is shared by both variants so swapping from the
 * glyph to a loaded favicon (or falling back after a broken one) never
 * shifts this row's layout — 20% smaller than this row used to render,
 * per request (23px/51px → 18px/41px, same rounding-to-the-nearest-pixel
 * this file already used to land the pre-existing 23px). The favicon image
 * gets a small `rounded-[6px]` the bare glyph doesn't — a raw square
 * favicon bitmap (often with its own baked-in background) reads harshly
 * against this screen's minimal look otherwise, and every other favicon in
 * this app is already rounded; not matched to `EntryList`'s own 9-10px
 * radius, since that's tuned for a box roughly twice this one's size and
 * would look disproportionate here.
 */
function EntryDetailIcon({
  entry,
  platform,
  showSiteIcons,
}: {
  entry: VaultEntry;
  platform: Platform;
  showSiteIcons: boolean;
}) {
  const isAndroid = platform.isAndroid;
  const isLogin = entry.type === LOGIN_TYPE_ID;
  const url = isLogin ? fieldValue(entry, 'url') : '';
  // Calling the hook unconditionally either way keeps hook order stable
  // across renders; `showSiteIcons && isLogin` alone gates the actual fetch
  // — same split `EntrySiteIcon` uses for itself.
  const iconUrl = useFavicon(platform, url, showSiteIcons && isLogin);
  const [broken, setBroken] = useState(false);

  const sizeClass = isAndroid ? 'h-[41px] w-[41px]' : 'h-[18px] w-[18px]';

  if (iconUrl && !broken) {
    return (
      <img
        src={iconUrl}
        alt=""
        className={`${sizeClass} shrink-0 rounded-[6px] object-contain`}
        // A malformed or truncated image falls back to the type glyph
        // rather than the browser's broken-image icon — same reasoning
        // `EntrySiteIcon`'s own `onError` has.
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <EntryTypeIcon
      icon={getEntryType(entry.type).icon}
      className={`${sizeClass} shrink-0 ${isAndroid ? 'text-[#d6e4ef]' : 'text-vault-fg'}`}
    />
  );
}

/**
 * Every entry type's field list, in registry order (template fields first,
 * then custom fields in add-order — the same order `Vault.listEntries()`
 * already builds `entry.fields` in) — one shared card. See this file's own
 * top doc for why Login renders through here too now, and for the auto-hide
 * behavior every sensitive field picked up as part of that.
 *
 * Multiline fields (a Secure Note's Body, 2FA Backup Codes, Login's own
 * Notes) get their own block below the card, same visual treatment every
 * multiline field has always had.
 */
function EntryFieldsCard({
  entry,
  onCopy,
}: {
  entry: VaultEntry;
  onCopy: (value: string, label: string) => void;
}) {
  const { readField, platform } = useApp();
  const { isRevealed, secondsLeft, toggle } = useMultiReveal();

  // A renewal-companion field (see `date-renewal-field-redesign.md`) is
  // never shown at its own natural position in the list — it's always a
  // custom field, so left alone it would land in the custom-fields tail,
  // nowhere near the date field it's actually about. `renewalByOriginal`
  // looks it up by the original field's key instead, so it can be nested
  // directly under that field below, matching the editor's own layout.
  const renewalByOriginal = new Map(
    entry.fields.filter((f) => f.renewalOf).map((f) => [f.renewalOf as string, f]),
  );
  const inline = entry.fields.filter((f) => f.dataType !== 'multiline' && !f.renewalOf);
  const multiline = entry.fields.filter((f) => f.dataType === 'multiline' && !f.renewalOf);

  // `bg-vault-shelf` (`#1f252d` solid) vs. Android's own translucent
  // `rgba(77,87,97,.4)` card fill — this card's background had never been
  // split by platform at all until now, unlike almost every other piece of
  // this file; it's the dominant background behind most of the screen's
  // actual content, so it's the highest-impact one of the two real gaps
  // found comparing this screen to the home screen's own Android palette.
  const isAndroid = platform.isAndroid;

  return (
    <>
      {inline.length > 0 && (
        <div
          className={`divide-y divide-hairline rounded-vault-inner shadow-vault-shelf ${
            isAndroid ? 'bg-[rgba(77,87,97,.4)]' : 'bg-vault-shelf'
          }`}
        >
          {inline.map((field) => {
            const renewal = renewalByOriginal.get(field.key);
            const revealed = isRevealed(field.key);
            return (
              <div key={field.key} data-stagger>
                <SingleFieldRow
                  entryId={entry.id}
                  field={field}
                  revealed={revealed}
                  revealHint={revealed ? `Hiding in ${secondsLeft(field.key)}s` : undefined}
                  onToggleReveal={() => toggle(field.key)}
                  readField={readField}
                  onCopy={onCopy}
                  platform={platform}
                  // The only field genuinely specific to Login (see this
                  // file's top doc) — keyed off `field.key`, not entry type,
                  // so it applies automatically if another type ever grows
                  // its own `url` field too.
                  onOpenExternal={
                    field.key === 'url' && field.value
                      ? () => void platform.openExternal(field.value)
                      : undefined
                  }
                />
                {renewal && (
                  <div className="ml-3 border-l-2 border-hairline pb-2 pl-2 pr-3">
                    <SingleFieldRow
                      entryId={entry.id}
                      // Renewal companions are always plain, and their own
                      // `label` is an auto-generated storage key (see
                      // `renewalKeyFor`/`derivedKeyFor` in `EntryEditor.tsx`),
                      // not something to show — the label shown here is
                      // fixed instead, matching the editor's own label for
                      // this same block. A `monthYear` original (Card's
                      // Expiry, today) means this companion is the always-
                      // derived Expiry-date field, not a real renewal — see
                      // `setDerivedExpiry`.
                      field={{
                        ...renewal,
                        label: field.dataType === 'monthYear' ? 'Expiry date' : 'Renewal date',
                      }}
                      revealed={false}
                      onToggleReveal={() => {}}
                      readField={readField}
                      onCopy={onCopy}
                      platform={platform}
                    />
                    {renewal.renewalCalc && (
                      <p className="-mt-1.5 px-3 text-xs text-vault-dim">
                        Calculated: {formatIntervalShort(renewal.renewalCalc)} from{' '}
                        {renewal.renewalCalc.anchor === 'original' ? "this entry's date" : 'today'}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {multiline.map((field) => (
        <MultilineFieldBlock
          key={field.key}
          entryId={entry.id}
          field={field}
          revealed={isRevealed(field.key)}
          secondsLeft={secondsLeft(field.key)}
          onToggleReveal={() => toggle(field.key)}
          readField={readField}
          platform={platform}
        />
      ))}
    </>
  );
}

function SingleFieldRow({
  entryId,
  field,
  revealed,
  revealHint,
  onToggleReveal,
  readField,
  onCopy,
  onOpenExternal,
  platform,
}: {
  entryId: string;
  field: EntryField;
  revealed: boolean;
  revealHint?: string;
  onToggleReveal: () => void;
  readField: (id: string, key: string) => string | null;
  onCopy: (value: string, label: string) => void;
  /** Set only for the `url` key — see `EntryFieldsCard`'s own doc. */
  onOpenExternal?: () => void;
  platform: Platform;
}) {
  const revealedValue = field.sensitive && revealed ? (readField(entryId, field.key) ?? '') : undefined;

  return (
    <FieldRow
      theme="vault"
      platform={platform}
      field={field}
      revealed={revealed}
      revealedValue={revealedValue}
      revealHint={revealHint}
      onToggleReveal={field.sensitive ? onToggleReveal : undefined}
      // Per 118:887: Reveal/Copy are always visible on Android, not
      // hover-gated — see this file's own top doc for why that's a real
      // fix, not just a style match. `alwaysShowActions` already existed
      // for exactly this (`PickEntryDetail` always passes it); Windows
      // still doesn't, so its hover-only behavior is unchanged.
      alwaysShowActions={platform.isAndroid}
      trailingAction={
        onOpenExternal
          ? { icon: <ExternalIcon />, label: 'Open in browser', onClick: onOpenExternal }
          : undefined
      }
      onCopy={
        field.sensitive
          ? () => {
              const value = readField(entryId, field.key);
              if (value) onCopy(value, field.label);
            }
          : field.value
            ? () => onCopy(field.value, field.label)
            : undefined
      }
    />
  );
}

function MultilineFieldBlock({
  entryId,
  field,
  revealed,
  secondsLeft,
  onToggleReveal,
  readField,
  platform,
}: {
  entryId: string;
  field: EntryField;
  revealed: boolean;
  /** Only meaningful while `revealed` — the same `useMultiReveal` countdown
   * `SingleFieldRow`'s `revealHint` shows, folded into the Hide button's own
   * label here instead of a separate hint slot (this block has no dedicated
   * one). */
  secondsLeft: number | undefined;
  onToggleReveal: () => void;
  readField: (id: string, key: string) => string | null;
  platform: Platform;
}) {
  if (!field.sensitive && field.value.trim() === '') return null;

  const text = field.sensitive ? (revealed ? (readField(entryId, field.key) ?? '') : '') : field.value;
  // Not itself in 118:887 (its one example entry has no multiline field) —
  // matched to `SingleFieldRow`'s own label/value treatment above instead,
  // on Android, so a screen with both kinds of field still reads as one
  // consistent card rather than two conventions. Card fill: same
  // `bg-vault-shelf`-vs-Android-card fork as `EntryFieldsCard`'s own card
  // above — see that component's own doc.
  const isAndroid = platform.isAndroid;

  return (
    <div
      data-stagger
      className={`mt-3 rounded-vault-inner p-3.5 shadow-vault-shelf ${
        isAndroid ? 'bg-[rgba(77,87,97,.4)]' : 'bg-vault-shelf'
      }`}
    >
      <div className="flex items-center justify-between">
        <div
          className={
            isAndroid
              ? 'text-[12px] font-semibold uppercase tracking-wide text-[#d6e4ef]/50'
              : 'text-xs font-semibold uppercase tracking-wide text-vault-muted'
          }
        >
          {field.label}
        </div>
        {field.sensitive && (
          <button
            className="btn px-2 text-xs text-vault-muted hover:bg-vault-rail hover:text-vault-fg"
            onClick={onToggleReveal}
          >
            {revealed ? `Hide (${secondsLeft}s)` : 'Reveal'}
          </button>
        )}
      </div>
      <p
        data-selectable
        className={`mt-1 whitespace-pre-wrap break-words text-sm ${
          isAndroid ? 'text-[#d6e4ef]' : 'text-vault-fg'
        }`}
      >
        {field.sensitive && !revealed ? `•••••••• (${REVEAL_SECONDS}s reveal)` : text}
      </p>
    </div>
  );
}
