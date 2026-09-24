import { useMemo, useState } from 'react';

import { useApp } from '../../app/store';
import { Platform } from '../../platform/ports';
import { EntryTypeDef, entryTypesForPicker, searchEntryTypes } from '../../vault/entryTypes';
import { EntryTypeIcon } from '../components/entryTypeIcons';
import { BackIcon, SearchIcon } from '../components/icons';

/** The entry-creation flow's own wall tint — per the Figma type-picker
 * design (node 118:1068, `Container BG`): a warm brown-black radial
 * gradient, not the cool grey `VAULT_WALL_RADIAL_GRADIENT` (`VaultFrame.tsx`)
 * every other screen's wall uses. `#241a16` (this gradient's own center
 * stop) isn't a new color chosen for this — it's the exact hex already
 * pixel-sampled from the "+" button's own icon (`BottomTabBar.tsx`), so
 * the screen "+" leads into now visually echoes "+" itself. Exported so
 * `EntryEditor.tsx`'s own form step can reuse the identical value on its
 * own container (per request — background only there, no reference was
 * given for that step's own fields/components, unlike this one). */
export const ENTRY_CREATION_WALL_GRADIENT =
  'radial-gradient(ellipse at center, rgba(36,26,22,1) 0%, rgba(25,21,19,1) 100%)';

/**
 * Step 1 of adding an entry: pick a type.
 *
 * Mandatory per `entry-type-expansion-spec.md` — there is no "skip, decide
 * later". Login, Card, Bank Account and Identity Doc lead the list with no
 * header (the four common enough that a category label just adds a scan
 * step); everything else sits under one "OTHERS" group — see
 * `entryTypesForPicker`'s doc comment for why this isn't the registry's
 * full category breakdown. Search sits below the list rather than above it,
 * so browsing the list is the default action and searching is what you
 * reach for once you don't see what you want.
 *
 * Recently-used types floated to the top of the no-search view is in the
 * spec too, but there is no usage-tracking of any kind in this codebase yet
 * (confirmed absent from `vault.ts` while scoping this feature) — building
 * that just for this one screen was cut from v1 rather than bolted on here;
 * see the project's conflict-analysis doc.
 *
 * Deliberately its own screen component with no knowledge of `EntryEditor`'s
 * form state — it only ever calls back with a chosen type id, which keeps
 * the picker's search/group logic testable and swappable on its own.
 *
 * Android: restyled per the Figma type-picker design (node 118:1068) —
 * bare list rows (no card/button chrome, no hover fill — just an icon and
 * a label sitting directly on the wall), bigger per-type icons, larger
 * text, plain (non-sticky, no rail) section titles, and this screen's own
 * warm wall gradient (`ENTRY_CREATION_WALL_GRADIENT` above). Two things the
 * reference itself doesn't speak to, kept rather than dropped:
 * - **The search box below the list.** Not in the static mock at all (a
 *   frozen frame can't show it either way) — same reasoning as every other
 *   "the mock doesn't show X" call this project has made (Upcoming's
 *   Overdue bucket, Home's section counts). Restyled to the same pill
 *   recipe `EntryList.tsx`'s own Android search bar already uses, for one
 *   consistent search-field look across the app, not dropped.
 * - **The real type/group content.** The reference's own sample data
 *   (Password/Identity/Passport/Driver License/Social Security/Crypto
 *   Wallet, grouped as an unlabeled lead + "PERSONAL" + "FINANCIAL") is
 *   illustrative — none of Passport/Driver License/Social Security/Crypto
 *   Wallet exist in this app's real registry, and the real grouping
 *   (`entryTypesForPicker`) is lead (Login/Card/Bank Account/Identity Doc)
 *   + "Access & Security" + "OTHERS". The row/section-header STYLING below
 *   is the reference's; the DATA it's applied to is this app's own.
 * - Per-type icons (`EntryTypeIcon`, already this component's own), not
 *   the reference's own exported asset — every `Type_Item` in the export
 *   points at the literal same repeated card-shape SVG (confirmed by
 *   downloading it), a mock convenience, not a real per-type asset set.
 *
 * Explicitly NOT adopted (per request): the reference also shows the same
 * shared logo/Lock/Settings header and bezeled `Container_Outline` frame
 * every other screen's `VaultFrame` provides. This screen stays a plain
 * full-screen push with its own simple back+title header, as it already
 * was — wrapping it in that shared chrome would mean Lock/Settings stay
 * live (and draft-discarding) mid-creation, which is a real behavior
 * change, not just a visual one, and wasn't asked for.
 *
 * Windows is untouched — this reference, like every Figma pull this
 * project has used so far, has no Windows counterpart.
 */
export function TypePicker({
  onSelect,
  onCancel,
}: {
  onSelect: (typeId: string) => void;
  onCancel: () => void;
}) {
  const { platform } = useApp();
  const [query, setQuery] = useState('');

  const groups = useMemo(() => entryTypesForPicker(), []);
  const searchResults = useMemo(() => searchEntryTypes(query), [query]);
  const searching = query.trim() !== '';
  const isAndroid = platform.isAndroid;

  return (
    <div
      className={`flex h-full flex-col ${isAndroid ? '' : 'bg-ink-950'}`}
      style={isAndroid ? { backgroundImage: ENTRY_CREATION_WALL_GRADIENT } : undefined}
    >
      <header
        className={`flex items-center gap-2 pb-2 pt-3 ${isAndroid ? 'px-5' : 'px-4'}`}
      >
        {/* Android: bare icon, no badge — same treatment as `EntryDetail`'s
            own Back button (that file's own doc has the fuller story on
            why). "Cancel" is kept as the aria-label rather than borrowing
            `EntryDetail`'s "Put back" — this action abandons a not-yet-
            created entry, it doesn't return an existing one.

            Every Android text/icon color on this screen was originally a
            second, distinct off-white family (`#6C7681` here, `#9da1a2`/
            plain `white` further down) rather than the home screen's own
            single "legible foreground" hex, `#d6e4ef` — the same
            inconsistency `EntryDetail.tsx` had and was standardized away
            from, per the same explicit request applied here too, so this
            screen reads as one palette with the rest of the app instead of
            a third, slightly-different grey family of its own. */}
        <button
          className={
            isAndroid
              ? 'p-2 text-[#d6e4ef]/50 transition-opacity active:opacity-60'
              : 'btn-ghost px-2'
          }
          onClick={onCancel}
          aria-label="Cancel"
        >
          <BackIcon className={isAndroid ? 'h-6 w-6 text-[#d6e4ef]/50' : undefined} />
        </button>
        <h1
          className={
            isAndroid
              ? 'text-lg font-medium text-[#d6e4ef]/80'
              : 'text-sm font-semibold text-slate-200'
          }
        >
          {isAndroid ? 'Select Entry Type' : 'Select entry type'}
        </h1>
      </header>

      {/* no-scrollbar — same reasoning as `EntryList.tsx`'s/`Settings.tsx`'s
          own scrollable panes: the persistent 10px thumb (`index.css`'s
          base `::-webkit-scrollbar` rule) reads as clutter on a plain list
          like this, not a useful affordance — hidden here without making
          the pane any less scrollable. */}
      <div className={`no-scrollbar flex-1 overflow-y-auto pb-3 ${isAndroid ? 'px-5 pt-2' : 'px-4'}`}>
        {searching ? (
          searchResults.length === 0 ? (
            <p
              className={`mt-6 text-center text-sm ${isAndroid ? 'text-[#d6e4ef]' : 'text-slate-400'}`}
            >
              No matching entry type.
            </p>
          ) : (
            <ul className={isAndroid ? 'flex flex-col gap-5' : 'flex flex-col gap-1'}>
              {searchResults.map((type) => (
                <TypeRow key={type.id} type={type} onSelect={onSelect} platform={platform} />
              ))}
            </ul>
          )
        ) : (
          groups.map((group) => (
            <div key={group.label || 'lead'} className={isAndroid ? 'mb-6' : 'mb-4'}>
              {group.label && (
                <div
                  className={
                    isAndroid
                      ? 'mb-2 flex h-6 items-center text-[14px] font-medium uppercase text-[#d6e4ef]/60'
                      : 'sticky top-0 bg-ink-950 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400'
                  }
                >
                  {group.label}
                </div>
              )}
              <ul className={isAndroid ? 'flex flex-col gap-5' : 'flex flex-col gap-1'}>
                {group.types.map((type) => (
                  <TypeRow key={type.id} type={type} onSelect={onSelect} platform={platform} />
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className={`pb-3 pt-1 ${isAndroid ? 'px-5' : 'px-4'}`}>
        {isAndroid ? (
          // Same search-pill recipe `EntryList.tsx`'s own Android search bar
          // uses (see that file's own doc) — not in the reference at all
          // (this file's own top doc explains why it's kept anyway), but
          // reusing the app's one established search-field look rather
          // than inventing a second.
          <div className="flex h-[42px] items-center gap-[6px] rounded-[20px] border border-[#4d5761]/70 bg-[#1f252d]/70 px-[20px]">
            <SearchIcon className="h-4 w-4 shrink-0 text-[#d6e4ef]/50" />
            <input
              className="h-full w-full bg-transparent text-[16px] text-[#d6e4ef] placeholder:text-[#d6e4ef]/50 focus:outline-none"
              placeholder="Search entry types"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              type="search"
            />
          </div>
        ) : (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              className="field pl-9"
              placeholder="Search entry types"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              type="search"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function TypeRow({
  type,
  onSelect,
  platform,
}: {
  type: EntryTypeDef;
  onSelect: (typeId: string) => void;
  platform: Platform;
}) {
  const isAndroid = platform.isAndroid;

  if (isAndroid) {
    // Bare row — per 118:1068's own `Type_Item`: no card, no border, no
    // hover/press background, just an icon and a label sitting directly on
    // the wall. `active:opacity-70` is this component's own addition for
    // basic touch feedback (a frozen mock can't show a pressed state
    // either way) — same reasoning as `EntryDetail`'s bare Back button.
    // 41×41 icon, `#d6e4ef` — confirmed via the reference's own exported
    // SVG (`stroke="#D6E4EF"`, no fill), not eyeballed off the screenshot.
    // The label itself is `#d6e4ef` too now, not plain `white` — the same
    // off-white-family standardization as this file's header (see that
    // block's own doc) applied to the actual list content, which is the
    // most visible instance of the pattern on this whole screen.
    return (
      <li>
        <button
          className="flex w-full items-center gap-[13px] py-0.5 text-left transition-opacity active:opacity-70"
          onClick={() => onSelect(type.id)}
        >
          <EntryTypeIcon icon={type.icon} className="h-[41px] w-[41px] shrink-0 text-[#d6e4ef]" />
          <span className="truncate text-[18px] font-medium text-[#d6e4ef]">{type.label}</span>
        </button>
      </li>
    );
  }

  return (
    <li>
      <button
        className="flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-ink-600 hover:bg-ink-800"
        onClick={() => onSelect(type.id)}
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-ink-800 text-slate-300">
          <EntryTypeIcon icon={type.icon} className="h-4 w-4" />
        </div>
        <span className="truncate text-sm font-medium text-slate-100">{type.label}</span>
      </button>
    </li>
  );
}
