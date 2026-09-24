import { useMemo } from 'react';

import { useApp } from '../../app/store';
import { Platform } from '../../platform/ports';
import { addInterval, isoToDisplay } from '../../vault/dateFormat';
import { buildUpcoming, hasAnyTrackedField, UpcomingItem } from '../../vault/upcoming';
import { VaultEntry } from '../../vault/types';
import { AlertIcon } from '../components/icons';
import { EntrySiteIcon } from './EntryList';

/**
 * The "Upcoming" tab — every date field the user has opted into tracking
 * (see `EntryEditor.tsx`'s per-field `TrackToggle`), grouped by how soon
 * it's due. See `upcoming-tab-design.md` for the full original design (its
 * own "Later update" section at the end covers this pass); `vault/
 * upcoming.ts` for the actual bucketing logic this screen only renders.
 *
 * Reached two ways, same screen either way: the bottom tab bar on Android
 * (`BottomTabBar.tsx`), or a header toggle button next to Settings on
 * Windows (`VaultScreen.tsx`'s own `VaultHeaderBar`). Shares `VaultFrame`/
 * the header row with List/Detail (per request) — `VaultScreen.tsx` renders
 * the very same `VaultHeaderBar` above this component that List/Detail get,
 * not a header of this component's own, so Lock and Settings stay reachable
 * from here too (a separate Back-button-only header used to show here
 * instead, losing both — see `VaultHeaderBar`'s own doc for why that's
 * gone). This component now owns only what's actually "inside the vault"
 * for this tab: the bucketed list itself.
 *
 * Android: per the Figma "Upcoming" design (node 118:528) — the same
 * rounded-card recipe `EntryList.tsx`'s own Android `Row` uses
 * (`EntrySiteIcon`, imported from there rather than the now-deleted
 * `EntryPeg.tsx`, which duplicated the same hash-palette logic at a
 * different fixed size), replacing the `--vault-*` shelf/rail recipe an
 * earlier pass put here in the absence of any real reference for this
 * screen specifically. The section header below is shared across both
 * platforms unconditionally — plain text on the wall, not sticky, no rail
 * groove — matching `EntryList.tsx`'s own header exactly, which already
 * made that same cross-platform call for the same reason (see its own doc);
 * only the row/card body below it stays platform-split.
 *
 * One real content change on Android, not just a visual one: the
 * reference's card has a single subtitle line — "FIELD LABEL: DATE", no
 * relative wording — and no right-hand column at all; the bucket itself
 * (This Week/This Month/…) is the design's only "how soon" signal. Per
 * request, Android's `Row` now matches that exactly, dropping the separate
 * exact-date/relative-label column below. Windows keeps the original
 * two-column layout and shelf visuals completely unchanged — this Figma
 * node, like the Home screen's, has no Windows counterpart, so nothing
 * about Windows had a reason to change (`relativeLabel` below is now
 * Windows-only, not dead code).
 */
export function UpcomingScreen({
  onOpen,
}: {
  /** `shelfKey` is the tapped card's `data-shelf-key` — `VaultScreen.tsx`
   * opens the detail box out of that exact card (`ShelfOriginPanel.tsx`).
   * Per entry AND field, since one entry can have several tracked dates
   * and so several cards here. */
  onOpen: (entry: VaultEntry, shelfKey: string) => void;
}) {
  const { entries, platform, settings } = useApp();

  // `addInterval(null, 0, 0, 0)` is this app's own established way to read
  // "today" as ISO — the same call the renewal calculator's "Today" anchor
  // option already uses (`DateFieldWithRenewal.tsx`). Recomputed each
  // render rather than memoized against nothing: cheap, and correct across
  // midnight without needing a timer of its own.
  const todayIso = addInterval(null, 0, 0, 0);
  const buckets = useMemo(() => buildUpcoming(entries, todayIso), [entries, todayIso]);
  const anyTracked = useMemo(() => hasAnyTrackedField(entries), [entries]);

  return (
    <div className="flex h-full flex-col">
      {/* No header here any more — `VaultScreen.tsx` renders the shared
          `VaultHeaderBar` above `VaultFrame` instead (see this file's own
          top doc). `pt-3` on the list/empty-state below replaces the top
          spacing that header's own padding used to provide. */}
      {buckets.length === 0 ? (
        <EmptyState anyTracked={anyTracked} />
      ) : (
        <ul
          // Same `px-5`/`px-4` platform split `EntryList.tsx`'s own list
          // uses. Android: plain content inset now — its cards float with
          // their own margin, nothing needs to cancel this padding any
          // more. Windows: still has to match Windows' own `-mx-4`
          // wall-to-wall shelf trick on each row's `<li>` exactly, so that
          // trick lands flush at the wall.
          className={`no-scrollbar flex-1 overflow-y-auto pb-10 pt-3 ${
            platform.isAndroid ? 'px-5' : 'px-4'
          }`}
        >
          {buckets.map((bucket, index) => (
            <div
              key={bucket.id}
              className={index > 0 ? (platform.isAndroid ? 'mt-10' : 'mt-2.5') : ''}
            >
              {/* Plain text on the wall, not sticky, no rail groove —
                  `EntryList.tsx`'s own category-header recipe verbatim
                  (see that file's own doc for why it dropped the sticky
                  rail band this replaces), shared across both platforms
                  the same way it already is there. "Overdue" plays the
                  role `EntryList.tsx`'s pinned "Review" group plays there:
                  the one bucket that keeps its own warn coloring and alert
                  glyph instead of the neutral label color. The count
                  badge has no counterpart in the Figma reference's own
                  mock, same as `EntryList.tsx`'s — kept for the same
                  reason (that mock never has more than one entry per
                  group either, so it has nothing to say about this one
                  way or the other). */}
              <div className="mb-3 flex items-center gap-1 px-px">
                <span
                  className={`flex min-w-0 items-center gap-1 text-[12px] font-bold uppercase ${
                    bucket.id === 'overdue' ? 'text-warn' : 'text-primary/50'
                  }`}
                >
                  {bucket.id === 'overdue' && <AlertIcon className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{bucket.label}</span>
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-vault-dim">
                  {bucket.items.length}
                </span>
              </div>
              {bucket.items.map((item) => (
                // Android: no wall-to-wall trick any more — the reference's
                // rows are floating cards with their own margin on every
                // side, same reasoning as `EntryList.tsx`'s own `renderRow`
                // (see that file's own doc). `mb-3` (12px) matches the
                // reference's own `gap-[12px]` between cards. Windows keeps
                // the pre-existing `-mx-4` wall-to-wall shelf trick — lives
                // on the `<li>`, not `Row`'s own `<button>`, since a
                // `<button>` sizes to its own content when `width` is
                // `auto` and so can't block-stretch to fill a negative
                // margin's overshoot the way a plain element can.
                <li
                  key={`${item.entry.id}:${item.field.key}`}
                  className={platform.isAndroid ? 'mb-3' : '-mx-4'}
                >
                  <Row
                    item={item}
                    shelfKey={upcomingShelfKey(item)}
                    onOpen={() => onOpen(item.entry, upcomingShelfKey(item))}
                    platform={platform}
                    showIcon={settings.showSiteIcons}
                  />
                </li>
              ))}
            </div>
          ))}
        </ul>
      )}
    </div>
  );
}

function upcomingShelfKey(item: UpcomingItem): string {
  return `upcoming:${item.entry.id}:${item.field.key}`;
}

function Row({
  item,
  shelfKey,
  onOpen,
  platform,
  showIcon,
}: {
  item: UpcomingItem;
  shelfKey: string;
  onOpen: () => void;
  platform: Platform;
  showIcon: boolean;
}) {
  // Android: the reference's floating card — `EntryList.tsx`'s own Android
  // `Row` recipe verbatim (`rounded-[20px]`, `rgba(77,87,97,.4)`, `p-5`,
  // `EntrySiteIcon`, `text-actionbutton-foreground` title). Subtitle is a
  // single "FIELD LABEL: DATE" line, matching the reference's own Card
  // Content exactly (per request) — no separate right-hand column, no
  // relative wording; the bucket header above already carries "how soon."
  // `field.label` is uppercased to match the reference's own casing
  // ("EXPIRY DATE", not "Expiry Date") — this is just display casing on
  // whatever label the user gave the tracked field, not a hardcoded string.
  //
  // Windows: the untouched entry shelf (`docs/vault-visual-language-spec.md`
  // §4.1) — `EntryList.tsx`'s own Windows `Row` recipe (wall-to-wall, no
  // radius, the one-bevel shelf lip), plus the original right-aligned exact-
  // date/relative-label column (`relativeLabel` below). This Figma reference
  // has no Windows counterpart, so nothing here had a reason to change:
  // Windows keeps the deliberate divergence from `docs/vault-visual-
  // language-spec.md` §4.1's "no right-hand metadata column" rule that this
  // file's own top doc already explains.
  return (
    <button
      type="button"
      onClick={onOpen}
      // Same detail-box hooks as `EntryList.tsx`'s own `Row`: the card is
      // found by this key, and its icon/title fly as shared elements.
      data-shelf-key={shelfKey}
      className={
        platform.isAndroid
          ? 'group relative flex w-full items-center gap-3 rounded-[20px] bg-[rgba(77,87,97,.4)] p-5 text-left transition-[background-color,transform] duration-vault-press ease-vault-snap active:translate-y-[2px] active:bg-[rgba(77,87,97,.6)]'
          : 'group relative flex w-full items-center gap-3 border-t border-edge-lip bg-vault-shelf pb-[10px] pl-[13px] pr-[13px] pt-[9px] text-left transition-[background-color,transform] duration-vault-press ease-vault-snap active:translate-y-[2px] active:bg-[#262d36] mb-[11px] mt-[9px]'
      }
    >
      <EntrySiteIcon entry={item.entry} platform={platform} enabled={showIcon} />

      <div className="min-w-0 flex-1">
        <div
          data-morph="title"
          className={`truncate font-medium ${
            platform.isAndroid ? 'text-actionbutton-foreground text-[18px]' : 'text-vault-fg text-[14px]'
          }`}
        >
          {item.entry.title || 'Untitled'}
        </div>
        {platform.isAndroid ? (
          <div className="mt-1 truncate text-[12px] text-[#d6e4ef]/50">
            {item.field.label.toUpperCase()}: {isoToDisplay(item.field.value)}
          </div>
        ) : (
          <div className="mt-1 truncate text-[12px] text-vault-muted">{item.field.label}</div>
        )}
      </div>

      {!platform.isAndroid && (
        <div className="shrink-0 text-right">
          <div className="text-[13px] font-medium text-vault-fg">{isoToDisplay(item.field.value)}</div>
          <div className="mt-1 text-[11px] text-vault-dim">{relativeLabel(item.daysUntil)}</div>
        </div>
      )}

      {/* The shelf's front face + separation shadow (spec §4.1's
          `.shelf::after`) — Windows only now; a card (Android) has no
          separate front face to bevel. A real sibling element rather than
          a CSS pseudo-element, since Tailwind utilities can't target
          `::after` directly. */}
      {!platform.isAndroid && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -bottom-1 h-1 bg-edge-front shadow-vault-shelf transition-opacity duration-vault-press group-active:opacity-[.35]"
        />
      )}
    </button>
  );
}

/** "3 days ago" / "Today" / "in 12 days" — a plain-language companion to
 * the exact date already shown next to it, so a bucket's rows don't all
 * read identically at a glance ("Overdue" alone doesn't say *how* overdue,
 * the way this does). */
function relativeLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil === -1) return 'Yesterday';
  return daysUntil < 0 ? `${-daysUntil} days ago` : `in ${daysUntil} days`;
}

/** Two distinct messages, not one generic "Nothing here yet" — "you never
 * turned tracking on" and "you did, but nothing's due" call for different
 * next actions (go opt something in, vs. just check back later), so
 * `hasAnyTrackedField` tells this screen which one it's looking at. */
function EmptyState({ anyTracked }: { anyTracked: boolean }) {
  return (
    // Same recipe as `EntryList.tsx`'s own `EmptyState` — spec §7: "Empty
    // state lives on the wall, not on a shelf. No container, centered,
    // `--dim`." 13px/`text-vault-dim`, `46px 20px` padding, was still on
    // the older ink-system's slate-400/text-sm(16px, remapped) until now.
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-[46px] text-center">
      <p className="text-[13px] leading-relaxed text-vault-dim">
        {anyTracked
          ? "Nothing due in the next 6 months, and nothing's overdue."
          : 'Nothing tracked yet.'}
      </p>
      {!anyTracked && (
        <p className="mt-2 max-w-[260px] text-[12px] leading-relaxed text-vault-dim">
          Open a date field on any entry and turn on tracking to see it here as it comes due.
        </p>
      )}
    </div>
  );
}
