import { useEffect, useMemo, useRef, useState } from 'react';

import { useApp } from '../../app/store';
import { Platform } from '../../platform/ports';
import { LOGIN_TYPE_ID, getEntryType } from '../../vault/entryTypes';
import { filterEntries, groupEntriesForHomeScreen } from '../../vault/search';
import { fieldValue, VaultEntry } from '../../vault/types';
import { SyncNotice } from '../components/SyncBadge';
import { EntryTypeIcon } from '../components/entryTypeIcons';
import { AlertIcon, GlobeIcon, PlusIcon, SearchIcon } from '../components/icons';
import { useFavicon } from '../hooks/useFavicon';

/** A group of rows under one sticky header — the same shape
 * `groupEntriesForHomeScreen`'s own `EntryCategoryGroup` returns, plus room
 * for the pinned "Review" group, which isn't one of its buckets either. */
interface RenderGroup {
  category: string;
  label: string;
  entries: VaultEntry[];
}

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
  onCopyPassword,
  pickMode,
  onPickSelect,
}: {
  /** Clicks and Shift+Enter (Windows) both land here. `VaultScreen.tsx`
   * opens the detail box out of this entry's row by its `data-shelf-key`
   * (the entry id) — see `Row` and `ShelfOriginPanel.tsx`. A keyboard open
   * grows out of the highlighted row too; if that row is scrolled out of
   * view the panel falls back to a plain fade on its own. */
  onOpen: (entry: VaultEntry) => void;
  onAdd: () => void;
  onCopyPassword: (entry: VaultEntry) => void;
  /** Windows manual fill: a hotkey press is waiting on an entry. See
   * `docs/MANUAL-FILL-DESIGN.md`. */
  pickMode: boolean;
  /** Selects an entry into `PickEntryDetail`'s per-field Fill/Show view —
   * the same "pick an entry, then pick a field" shape as the Android IME's
   * own search results. Opens out of the row the same way `onOpen` does. */
  onPickSelect: (entry: VaultEntry) => void;
}) {
  // `lock`/`sync`/`syncNow`/`onSettings`/`onUpcoming` moved out with the
  // header — `VaultScreen.tsx` renders that now, as the "Outside" plane
  // above `VaultFrame` (`docs/vault-visual-language-spec.md` §1). `sync` is
  // still needed here for `SyncNotice`, which stays inside the frame with
  // the list it's actually reporting on.
  const {
    entries,
    sync,
    platform,
    settings,
    justOnboarded,
    dismissOnboardingWelcome,
    biometricAvailable,
    biometricEnrolled,
    enrolBiometrics,
  } = useApp();

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const searchResults = useMemo(() => filterEntries(entries, query), [entries, query]);
  const isSearching = query.trim() !== '';

  // Grouped by category with sticky headers, but only while the box is
  // empty — once the user is searching, results stay in relevance order
  // instead (grouping would fight ranking). `filtered` is always the flat,
  // top-to-bottom render order either way, so the keyboard-nav code below
  // (which indexes into it by position) doesn't need to know which mode
  // produced it.
  //
  // `groupEntriesForHomeScreen` — the same lead/Access & Security/Others/
  // Notes buckets the type picker groups types into, per request, rather
  // than the registry's finer 6-way category split — see that function's
  // own doc.
  //
  // A `needsReview` entry (streamlined account creation, auto-saved without
  // a full look-over — see `Vault.setNeedsReview`) is pulled out of its
  // normal category and pinned in its own "Review" group first, rather than
  // sitting wherever it'd otherwise land — same reasoning as Upcoming's
  // Overdue bucket: the thing that needs attention shouldn't be buried
  // alphabetically among everything that doesn't. Search deliberately
  // ignores this split; while typing, a review entry is just an entry.
  const groups = useMemo((): RenderGroup[] | null => {
    if (isSearching) return null;
    const needsReview = searchResults.filter((e) => e.needsReview);
    const rest = searchResults.filter((e) => !e.needsReview);
    const categoryGroups = groupEntriesForHomeScreen(rest);
    return needsReview.length > 0
      ? [{ category: 'review', label: 'Review', entries: needsReview }, ...categoryGroups]
      : categoryGroups;
  }, [searchResults, isSearching]);
  const filtered = useMemo(
    () => (groups ? groups.flatMap((g) => g.entries) : searchResults),
    [groups, searchResults],
  );

  // Auto-focus search on unlock — desktop only. Focusing it on Android would
  // throw the soft keyboard up over the list before the user has asked for it.
  //
  // `pickMode` is also a dependency, not just an initial-mount concern: a
  // manual-fill hotkey press while this screen is already showing the list
  // (rather than detail/edit/settings) never remounts this component, so
  // without it the search box would only ever get focus the very first time
  // the vault was unlocked, not on every hotkey-triggered pick.
  useEffect(() => {
    if (platform.isDesktop) searchRef.current?.focus();
  }, [platform.isDesktop, pickMode]);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Keep the highlighted row on screen while arrowing through a long list.
  // Looked up by a `data-index` attribute rather than DOM child position —
  // grouped mode interleaves non-selectable header elements between rows, so
  // `children[selected]` would no longer land on the selected-th *entry*.
  useEffect(() => {
    const node = listRef.current?.querySelector(`[data-index="${selected}"]`);
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

      // Android: this field is `type="search"`, so the soft keyboard's own
      // action key reads "Search" instead of a generic "Enter" — and
      // pressing it fires this exact same `Enter` keydown, with nothing in
      // the event to tell it apart from a physical Enter press. Results are
      // already live-filtered as the user types (`searchResults` above), so
      // "submit" here only ever needs to mean "get the keyboard out of the
      // way," never trigger an action on an entry. The shortcut below —
      // copying the top result's password — is a deliberate desktop
      // power-user path (see this component's own top doc); it was firing
      // from a bare tap of the keyboard's search key too, a real reported
      // bug, not a desktop-only edge case leaking somewhere harmless.
      if (platform.isAndroid) {
        (event.target as HTMLInputElement).blur();
        return;
      }

      const entry = filtered[selected];
      if (!entry) return;

      if (pickMode) {
        // Selects into the per-field Fill/Show view — which field to fill is
        // type-dependent now (not always just username/password), so there's
        // no single "the" field left for Enter to fill directly. Opens out of
        // the highlighted row, same as a click would.
        onPickSelect(entry);
      } else {
        // Enter copies rather than opens: the overwhelmingly common intent is
        // to paste the password somewhere, not to view the entry.
        if (event.shiftKey) onOpen(entry);
        else onCopyPassword(entry);
      }
    }
  };

  // `index` is this entry's position in `filtered` — the flat, top-to-bottom
  // render order shared by both grouped and search-flat rendering — so it
  // lines up with keyboard-nav's `selected` and the `data-index` the
  // scroll-into-view effect above looks for.
  const renderRow = (entry: VaultEntry, index: number) => (
    // Android: no wall-to-wall trick any more — the Figma home-screen
    // design's rows are floating cards with their own margin on every
    // side, not a shelf flush against the frame's own wall, so this just
    // inherits the list's own `px-5` padding like any other block content
    // would. Windows keeps the pre-existing `-mx-4` wall-to-wall shelf
    // (this Figma frame has no desktop counterpart to match, and the old
    // `Row`'s doc below still explains why that trick has to live here
    // rather than on `Row`'s own `<button>`, for the platform that still
    // uses it).
    // `data-reveal` marks this for the unlock reveal (`useUnlockReveal.ts`),
    // as do the section headings, the search band and the empty state.
    <li key={entry.id} data-index={index} data-reveal="row" className={platform.isAndroid ? 'mb-3' : '-mx-4'}>
      <Row
        entry={entry}
        highlighted={index === selected && platform.isDesktop}
        onOpen={() => onOpen(entry)}
        pickMode={pickMode}
        onPickSelect={() => onPickSelect(entry)}
        platform={platform}
        showIcon={settings.showSiteIcons}
      />
    </li>
  );

  // Android: bottom, right above the tab bar (`VaultScreen.tsx` renders
  // `BottomTabBar` as this whole component's next sibling, so this sitting
  // last in this component's own output is what puts it directly above the
  // tab row on screen) — matching the Figma home-screen design's own
  // "ControlPanel" (search, then a hairline, then the tab row, all in one
  // group at the bottom). Windows keeps it at the top, where it's always
  // been (this Figma frame has no desktop counterpart, and top-of-list is
  // where a keyboard-driven search box belongs regardless).
  const searchBand = (
    <>
      {/* Per the Figma home-screen design (node 103:175) — supersedes the
          vault-spec's own §4.4 groove recipe on Android specifically (kept
          on Windows, which that Figma frame never speaks to): the
          reference's "ControlPanel" is a single gradient panel housing the
          search pill then the tab row — see `BottomTabBar.tsx` for the
          other half of that panel, which this wrapper's gradient is
          deliberately made to continue into (two adjacent elements, not
          one shared container — lifting the search box's own state up
          into `VaultScreen.tsx` just to share one DOM node wasn't worth
          the risk this pass). The reference's own hairline between the two
          halves is deliberately NOT reproduced, per request. Windows keeps
          the old `vault-rail` groove untouched. */}
      <div
        // Unlock reveal: Windows' search leads the list; Android's is half of
        // the bottom control panel and rises with the tab bar.
        data-reveal={platform.isAndroid ? 'panel' : 'search'}
        className={
          // `to-[#323840]`, not the panel's own full `#292f37` — this is
          // the TOP half of one continuous gradient that finishes in
          // `BottomTabBar.tsx` (`from-[#323840]`, the same midpoint),
          // not two independent copies of the full range. Splitting the
          // stops instead of repeating them is what keeps the seam where
          // the two elements meet from reading as a visible hard edge —
          // caught by actually rendering this, not obvious from the class
          // names alone.
          //
          // `px-3` (12px) — matches the row cards' own clearance from the
          // wall (`px-3` on this component's own `<ul>` below, and that
          // same 12px the lead section header's own `mb-3` already gives
          // the top edge — per request, brought in line rather than left at
          // the old 20px), rather than the reference's own literal
          // `px-[10px]` (its `SearchBar` doesn't actually fill its parent
          // `ControlPanel`'s full padded width, so matching that bare
          // value alone would have undershot the cards' own inset).
          // `BottomTabBar.tsx`'s own outer padding matches this too, so
          // the tab row/+ button line up as well.
          //
          // Deliberately NO `-mx-5` here — a real bug, caught by actually
          // measuring the rendered position rather than trusting the class
          // names: this wrapper's direct parent (this component's own root
          // `<div>`) has no padding of its own to cancel, unlike `Row`'s
          // `<li>` or the section header below, where `-mx-5` cancels a
          // real ancestor `px-5`. Adding `-mx-5` AND `px-5` to the SAME
          // element nets to zero — the margin pushes the box 20px past the
          // wall, then the padding pushes its content 20px back in,
          // landing exactly back at the wall with no clearance at all
          // (confirmed by measuring `getBoundingClientRect()`, not by
          // eyeballing a screenshot — the same category of margin/padding
          // trap `Row`'s own doc already warns about, just reproduced in a
          // new spot). Dropping the margin is enough: with no margin, this
          // div already naturally spans the full wall width on its own
          // (same as the `<ul>` below), so its `bg-gradient-to-b`/shadow
          // still bleed wall-to-wall (background paints the full padding
          // box regardless of padding), while `px-5` now gives its
          // children a real, uncancelled 20px inset.
          //
          // Shadow is directional now — `0_-8px_12px_-10px`, not the
          // reference's own literal `0_0_9.55px` (no offset/spread at
          // all) — per request: the reference's panel is one self-
          // contained floating element with nothing directly adjacent
          // below it, so an omnidirectional glow reads fine there, but
          // this panel sits immediately atop `BottomTabBar.tsx` with zero
          // gap between them, so that same glow visibly fell onto the tab
          // row underneath. The negative offset (shifts the shadow up 8px)
          // combined with the negative spread (shrinks the shadow's own
          // rect by 10px on every side before that shift) keeps its
          // blurred rect entirely above this element's own bottom edge, so
          // it fades into the scrollable list above rather than bleeding
          // down onto the tab bar.
          platform.isAndroid
            ? 'flex flex-col bg-gradient-to-b from-[#3b424a] to-[#323840] px-3 pb-[7px] pt-[11px] shadow-[0_-8px_12px_-10px_rgba(0,0,0,.65)]'
            : 'bg-vault-rail p-2 shadow-[0_6px_12px_-10px_rgba(0,0,0,.9)] -mx-4'
        }
      >
        {/* The reference's own `SearchBar`: a 10px radius (not the vault
            spec's 8px, and not the 20px this had before a color-audit-style
            re-check against `get_design_context` directly on node 103:175
            found the reference's own `SearchBar` is `rounded-[10px]`, not a
            full pill), `#1f252d`, 1px `#4d5761`, a leading `SearchIcon`
            (the reference has one after all — an earlier pass read a
            different, non-Figma reference prototype that omits it), 16px
            placeholder text. The reference's own fill/border are lifted to
            70% opacity as a literal `/70` alpha (safe — these are flat
            hexes, not the `--vault-*` custom properties Tailwind can't
            alpha-blend) rather than a real CSS `opacity` on the `<input>`
            itself, which would also fade a value the user actually typed —
            the reference never has to answer that question since its own
            field is always empty. Text/placeholder/icon are `#d6e4ef`
            (`text-vault-fg`'s `#e2e6ea` was a close-but-wrong substitute
            caught on a color audit — the reference's row text and this
            field's placeholder are both literally `#d6e4ef`, the same hex
            already named `--actionbutton-text` in `index.css`, not a
            `--vault-*` one). Windows keeps its own unrelated recipe (this
            Figma frame has no desktop counterpart to match). */}
        <div
          className={
            // The pill's own internal text padding — unchanged from the
            // reference's own literal `px-[20px]`, not the wrapper-level
            // clearance fixed above.
            platform.isAndroid
              ? 'flex h-[42px] items-center gap-[6px] rounded-[10px] border border-[#4d5761]/70 bg-[#1f252d]/70 px-[20px]'
              : ''
          }
        >
          {platform.isAndroid && <SearchIcon className="h-4 w-4 shrink-0 text-[#d6e4ef]/50" />}
          <input
            ref={searchRef}
            data-search-input
            className={
              platform.isAndroid
                ? 'h-full w-full bg-transparent text-[16px] text-[#d6e4ef] placeholder:text-[#d6e4ef]/50 focus:outline-none'
                : 'h-[34px] w-full rounded-[8px] border border-[#1c2128] bg-[#06080a] px-[11px] text-[14px] text-vault-fg shadow-[inset_0_1px_3px_rgba(0,0,0,.6)] placeholder:text-[#6b747d] focus:outline-none focus:shadow-[inset_0_1px_3px_rgba(0,0,0,.6),0_0_0_2px_rgba(107,157,198,0.4)]'
            }
            placeholder={platform.isAndroid ? 'Search entries…' : 'Search (Ctrl+F)'}
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
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {/* The header (title/sync/lock/gear — spec's "Outside" plane) now
          lives in `VaultScreen.tsx`, rendered above `VaultFrame` rather
          than inside it — this component only owns what's actually inside
          the vault box now: the search shelf, the list, its rows. */}
      <SyncNotice sync={sync} />

      {!platform.isAndroid && searchBand}

      {filtered.length === 0 ? (
        <EmptyState
          hasEntries={entries.length > 0}
          onAdd={onAdd}
          justOnboarded={justOnboarded}
          onDismissWelcome={dismissOnboardingWelcome}
          biometricAvailable={biometricAvailable}
          biometricEnrolled={biometricEnrolled}
          onEnableBiometrics={enrolBiometrics}
          isAndroid={platform.isAndroid}
        />
      ) : (
        <ul
          ref={listRef}
          // Extra bottom padding on Android clears the tab channel + "+"
          // band docked flush at the screen bottom (see `BottomTabBar.tsx`,
          // `VaultScreen.tsx`) — that band is roughly 60-65px tall now that
          // it sits flush with no gap below it (down from the old floating
          // pill's 92px offset, which had to clear both its own height AND
          // a 22px gap). pb-28 (112px) is generous rather than exact —
          // there's no exact figure to hit any more since the band's
          // height is CSS-driven, not a fixed design export, so this stays
          // comfortably above it rather than trimmed to match. px-5 on
          // Android (20px, the Figma home-screen design's own side margin
          // for the search bar/cards — was 32px in an earlier pass) vs the
          // original px-4 elsewhere.
          //
          // Android, while actively searching: `flex-col-reverse` instead
          // of normal top-down flow, per request — the soft keyboard
          // compresses this list down to a sliver, and the best (first)
          // match needs to be the thing still visible in that sliver, not
          // scrolled off above it. `filtered` itself stays in its own
          // normal best-first order below (`filtered.map`, unchanged) —
          // flipping the *container's* direction is what puts the
          // first-rendered (best) result at the main-axis start, which
          // `column-reverse` redefines as the bottom, with no scroll
          // needed to reach it: an ordinary reordering of the array itself
          // would only have changed which entry LOOKS best, not solved
          // anything about where the scroll position starts. `pb-28`
          // drops to `pb-3` here too — that 112px reservation is real
          // space inside this box's own bottom edge regardless of
          // direction, so left at 112px it would sit as a dead gap between
          // the now-bottom-anchored best result and the search pill right
          // below it, undermining the exact adjacency this is for.
          //
          // no-scrollbar — this list scrolls constantly as the vault
          // grows; the persistent 10px thumb (this app's default, see
          // index.css) read as clutter here, per request.
          // The reference prototype's own `.recess` inset shadow — a
          // subtle top-down shade cast onto the scroll area right below
          // the search shelf, `box-shadow:inset 0 8px 14px -12px #000`
          // verbatim.
          //
          // `px-3` (12px), not the old `px-5`/`px-4` (20px/16px) — per
          // request, matches the lead section header's own `mb-3` (12px)
          // top clearance, on both platforms. Close to (not identical to)
          // the Figma home-screen reference's own ~11px card-to-wall inset
          // (node 103:175's `Card List`, 332px wide inside a 353px
          // container) — 12px is the nearest value on this app's 4px
          // spacing grid and what was actually asked for; Figma's own
          // figure isn't on that grid either.
          className={`no-scrollbar flex-1 overflow-y-auto shadow-[inset_0_8px_14px_-12px_#000] ${
            platform.isAndroid
              ? isSearching
                ? 'flex flex-col-reverse px-3 pb-3'
                : 'px-3 pb-28'
              : 'px-3 pb-24'
          }`}
        >
          {groups
            ? (() => {
                let index = -1;
                return groups.map((group, groupIndex) => (
                  // Per the Figma home-screen design: a section break is a
                  // noticeably bigger gap than the 12px between ordinary
                  // rows, not the old rail's own fixed 10px — mt-8 (32px)
                  // approximates the reference's ~59px break without
                  // chasing its exact figure, which doesn't map cleanly
                  // onto normal document flow anyway (the reference gets
                  // there via two overlapping absolutely-positioned layers,
                  // not a margin). The lead group's own header below (empty
                  // for it, but still present) gives the first section its
                  // own top gap now, so this `mt-8` is only needed on
                  // groups after the first.
                  <div key={group.category} className={groupIndex > 0 ? 'mt-8' : ''}>
                    {/* The "lead" group (Login/Card/Bank Account/Identity
                        Doc) has `label: ''` — the type picker shows this
                        same set of types with no category label either, and
                        this used to skip the header <div> entirely to match
                        (`group.label !== '' && <div>...`), which also meant
                        the first section sat flush against the top of the
                        list with no gap at all. Per request, the header
                        itself is unconditional now — every group gets one,
                        including the lead group's — with only its CONTENT
                        (the label text, the review icon, the count) gated
                        on having a real label to show. An empty label
                        renders no text node at all, so this collapses to a
                        zero-height `<div>` contributing only its own `mb-3`
                        margin — a plain top-of-list spacer, not a
                        placeholder anyone would mistake for a real
                        (equally invisible) section title. */}
                    <div data-reveal="heading" className="mb-3 flex items-center gap-1 px-px">
                      {group.label !== '' && (
                        // Per the Figma home-screen design: "SECTION TITLE"
                        // is bare text sitting directly on the wall — no
                        // rail groove, no side lugs, not sticky (a
                        // transparent sticky label would just overlap
                        // whatever scrolls under it with nothing to read
                        // against, which the reference's own static text
                        // never has to answer either). This drops the
                        // always-visible-while-scrolling affordance the old
                        // rail gave for free — worth knowing if that's
                        // missed in practice. `text-primary` (`#8fadc7`, a
                        // literal, alpha-safe token) at 50% opacity plus
                        // Inter Bold 12px are the reference's own exact
                        // values. The review group keeps its own warn
                        // coloring (no equivalent group exists in the
                        // reference) and its `AlertIcon`.
                        <>
                          <span
                            className={`flex min-w-0 items-center gap-1 text-[12px] font-bold uppercase ${
                              group.category === 'review' ? 'text-warn' : 'text-primary/50'
                            }`}
                          >
                            {group.category === 'review' && <AlertIcon className="h-3 w-3 shrink-0" />}
                            <span className="truncate">{group.label}</span>
                          </span>
                          {/* Entry count, right-aligned, `--vault-dim`,
                              monospace — spec §4.3's own instruction (kept —
                              the reference's own mock never has more than
                              one entry per group, so it has nothing to say
                              about this either way), and §3.8's "monospace
                              is reserved for credential values,
                              identifiers, and counts." */}
                          <span className="ml-auto shrink-0 font-mono text-[11px] text-vault-dim">
                            {group.entries.length}
                          </span>
                        </>
                      )}
                    </div>
                    {group.entries.map((entry) => {
                      index += 1;
                      return renderRow(entry, index);
                    })}
                  </div>
                ));
              })()
            : filtered.map((entry, index) => renderRow(entry, index))}
        </ul>
      )}

      {platform.isAndroid && searchBand}

      {/* Windows only — Android's "+" lives inside the bottom tab channel
          itself now (`BottomTabBar.tsx`). Windows has no tab bar to dock
          into, so this stays its own floating button, but recolored to
          match: `bg-vault-accent` + `rounded-vault-inner` +
          `shadow-vault-peg`, the same peg-family shape/press language as
          everything else this pass touched, rather than the old
          `btn-primary`/`rounded-full` treatment — spec §3.7's "+ is the
          only element using accent as a fill" holds on both platforms,
          just via two different housings. `z-20` beats the sticky section
          headers' `z-10` below, so a header scrolling past never draws
          over this. */}
      {!platform.isAndroid && (
        <button
          type="button"
          className="absolute bottom-5 right-5 z-20 flex h-12 w-12 items-center justify-center rounded-vault-inner bg-vault-accent text-[#0a0d10] shadow-vault-peg transition-transform duration-vault-press ease-vault-snap active:translate-y-[2px] active:shadow-vault-peg-pressed"
          onClick={onAdd}
          aria-label="Add entry"
          title="Add entry"
        >
          <PlusIcon className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

function Row({
  entry,
  highlighted,
  onOpen,
  pickMode,
  onPickSelect,
  platform,
  showIcon,
}: {
  entry: VaultEntry;
  highlighted: boolean;
  onOpen: () => void;
  pickMode: boolean;
  onPickSelect: () => void;
  platform: Platform;
  showIcon: boolean;
}) {
  const subtitleText = rowSubtitle(entry);

  // Android: the Figma home-screen design's floating card (§9 of
  // `docs/vault-visual-language-spec.md` names this exact look — rounded,
  // individually gapped, background distinct from the wall — as the
  // anti-pattern the shelf redesign was meant to replace; this Figma frame
  // predates that redesign and was never reconciled with it, so per
  // request this reverts Android specifically back to it). `rounded-[20px]`
  // + `rgba(77,87,97,.4)` are the reference's own literal card values;
  // `p-5` (20px all around) reproduces its exact 90px row height as a side
  // effect of wrapping a 50px icon in 20px padding, rather than a
  // hardcoded height that would fight real (variable-length) title/
  // subtitle text. No border, no separate front-face bevel — a card has
  // one flat face, not a shelf's lip-plus-front construction.
  //
  // Windows keeps the untouched shelf (`docs/vault-visual-language-spec.md`
  // §4.1) — flush, square-cornered, wall-to-wall, its own bevel/front-face/
  // press-darken recipe exactly as before. This Figma frame has no desktop
  // counterpart, so there's nothing here for Windows to match.
  //
  // The WHOLE row (icon + text) is a single `<button>` on both platforms —
  // spec §7: "the whole shelf is the target," not just the text portion.
  //
  // Keyboard highlight (Windows arrow-key nav, `highlighted` is always
  // `false` on Android — see this component's own caller) uses
  // `--vault-accent` as a focus ring rather than a background swap either
  // way.
  //
  // Android text color, caught on a color audit: the reference's title AND
  // subtitle are both literally `#d6e4ef` (title full-opacity, subtitle the
  // same hex at 50% via the reference's own `opacity-50` on that whole
  // `<p>`) — not two different colors, and not `--vault-fg`/`--vault-muted`
  // (`#e2e6ea`/`#8b949e`), which are each a close but distinct substitute
  // this pass reached for first. `#d6e4ef` is already named
  // `--actionbutton-text` in `index.css`, so the title reuses that token
  // directly; the subtitle needs the literal hex instead of
  // `text-actionbutton-foreground/50` — Tailwind can't alpha-blend an
  // opacity modifier onto a `var()`-based color at build time (the same
  // gotcha `tailwind.config.js` already documents for the `vault-*`
  // tokens), so the token only works where no modifier is needed.
  const title = (
    <div
      data-morph="title"
      className={`truncate font-medium ${
        platform.isAndroid ? 'text-actionbutton-foreground text-[18px]' : 'text-vault-fg text-[14px]'
      }`}
    >
      {entry.title || 'Untitled'}
    </div>
  );
  const subtitle = subtitleText && (
    <div
      className={`mt-1 truncate text-[12px] ${platform.isAndroid ? 'text-[#d6e4ef]/50' : 'text-vault-muted'}`}
    >
      {subtitleText}
    </div>
  );

  return (
    <button
      type="button"
      onClick={pickMode ? onPickSelect : onOpen}
      // What `ShelfOriginPanel.tsx` finds this card by, to open the detail
      // box out of it (and close back into it) — `VaultScreen.tsx` passes
      // the entry id as the panel's `sourceKey`. The title and the icon
      // plate inside carry `data-morph` for the shared-element flight.
      data-shelf-key={entry.id}
      // `w-full` here is safe — see this function's own top doc for why:
      // Windows' wall-to-wall negative margin lives on the parent `<li>`
      // (`renderRow`'s own comment), so this is just 100% of that already-
      // expanded box, not fighting a fixed width against its own negative
      // margin. Android has no such margin to fight in the first place
      // (its `<li>` carries a plain `mb-3` now, not a negative margin), so
      // `w-full` there is just "fill the list's own padded width," exactly
      // what a floating card wants.
      className={
        platform.isAndroid
          ? `group relative flex w-full items-center gap-3 rounded-[20px] bg-[rgba(77,87,97,.4)] p-5 text-left transition-[background-color,transform] duration-vault-press ease-vault-snap active:translate-y-[2px] active:bg-[rgba(77,87,97,.6)]`
          : `group relative flex w-full items-center gap-3 border-t border-edge-lip bg-vault-shelf pb-[10px] pl-[13px] pr-[13px] pt-[9px] text-left transition-[background-color,transform] duration-vault-press ease-vault-snap active:translate-y-[2px] active:bg-[#262d36] mb-[11px] mt-[9px] ${highlighted ? 'ring-1 ring-inset ring-vault-accent' : ''}`
      }
    >
      <EntrySiteIcon entry={entry} platform={platform} enabled={showIcon} />
      <div className="min-w-0 flex-1">
        {title}
        {subtitle}
      </div>
      {/* The shelf's front face + separation shadow (spec §4.1's
          `.shelf::after`) — Windows only now; a card (Android) has no
          separate front face to bevel. A real sibling element rather than
          a CSS pseudo-element, since Tailwind utilities can't target
          `::after` directly. Fades to .35 on press, same as the spec,
          since the shelf itself has moved 2px toward it by then. */}
      {!platform.isAndroid && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -bottom-1 h-1 bg-edge-front shadow-vault-shelf transition-opacity duration-vault-press group-active:opacity-[.35]"
        />
      )}
    </button>
  );
}

/** Username for a Login; otherwise the first non-sensitive, non-multiline
 * field with a value — a lightweight per-type "second line" (a WiFi's SSID,
 * a Bank's name, a Card's expiry) without a per-type subtitle rule for each
 * of the dozen-odd types. */
function rowSubtitle(entry: VaultEntry): string {
  if (entry.type === LOGIN_TYPE_ID) return fieldValue(entry, 'username') || fieldValue(entry, 'email');
  const field = entry.fields.find((f) => !f.sensitive && f.dataType !== 'multiline' && f.value.trim() !== '');
  return field?.value ?? '';
}

// Used on both platforms (spec §4.2: "Plate color = favicon dominant color
// when available, else stable hash of title. Never random per render.") —
// an earlier pass in this redesign made Android's plate one uniform
// `bg-actionbutton` blue instead, matching the Figma home-screen design's
// own mock literally; reverted per request (every entry there uses the
// exact same placeholder icon/color, so the mock never actually spoke to
// per-entry variety one way or the other) — entries keep their
// at-a-glance color distinction on both platforms, only the plate's own
// size/radius still differs (see `EntrySiteIcon` below).
// Dominant-color-from-favicon extraction is deferred (user's decision,
// `docs/vault-visual-overhaul-plan.md` §1.3) — every peg uses the hash
// fallback for now. Eight solid, opaque, muted hues, deliberately NOT
// including anything blue-ish close to `--vault-accent` (#6b9dc6) — the
// spec reserves accent for exactly three uses (§3.7) and a peg color that
// reads as "the accent" would blur that. Paired with a fixed near-black
// `#0a0d10` glyph/text color (spec §4.2) rather than each color's own
// Tailwind `text-*` pairing — every peg's foreground is identical, only
// the plate hue varies.
const PEG_COLORS = [
  '#c9835f', // terracotta
  '#c7a23f', // brass
  '#8caf5f', // moss
  '#5fac93', // teal-green
  '#9a8fc9', // steel violet
  '#c97ba3', // rose plum
  '#9aa3ad', // slate
  '#c9955f', // ochre amber
];
const PEG_FOREGROUND = '#0a0d10';

function pegColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PEG_COLORS[hash % PEG_COLORS.length] ?? '#9aa3ad';
}

/**
 * The peg (`docs/vault-visual-language-spec.md` §4.2) — a site's favicon
 * when one can be fetched, otherwise a colored plate. The plate is not just
 * a loading state — a fetch failure or a site with no icon lands here too,
 * so there is never a blank space where an icon would be.
 *
 * Exported for `UpcomingScreen.tsx` too (per the Figma "Upcoming" design,
 * node 118:528, which uses this exact card/icon recipe on Android) —
 * that screen used to import a separate `EntryPeg.tsx`, a fixed-34×34
 * component carrying the same `PEG_COLORS`/`pegColor` hash logic as a
 * second, drifting copy. Deleted rather than kept alongside this: grep
 * confirmed it had no other consumers once `UpcomingScreen.tsx` switched
 * over, and one shared implementation of "how an entry gets its icon
 * plate" is worth more than a Windows-only size difference that this
 * component already handles via `platform` anyway.
 *
 * Android: per the Figma home-screen design — 50×50, `rounded-[10px]`,
 * rather than the spec's 34×34 `rounded-vault-inner`. Color is still the
 * hash palette on both platforms (see `PEG_COLORS`'s own doc for why an
 * earlier uniform-blue pass here was reverted) — only the box size/radius
 * and the glyph size (`h-7 w-7` vs `h-5 w-5`) differ by platform.
 *
 * The non-favicon fallback is `GlobeIcon` on both platforms now, not a
 * plain letter — an inconsistency found while rewriting this, unrelated to
 * the Figma match itself: every other "no icon available" path in the app
 * (the type picker, `EntryDetail`, the IME) already fell back to
 * `GlobeIcon`; this was the one spot that never got updated when that
 * convention was set.
 *
 * `shadow-vault-peg` at rest; `group-active:` (reading the parent row
 * `<button>`'s own press state — see `Row`) drops it to
 * `shadow-vault-peg-pressed` and sinks the peg 3px, deliberately further
 * than the 2px the row itself moves, per spec §4.2's "double motion" — kept
 * on Android's card too, not just Windows' shelf: it's a plate-vs-button
 * relationship, not something specific to the shelf metaphor.
 *
 * Every variant carries `data-morph="icon"`: when a row is opened, this
 * plate flies to the detail view's own icon as a shared element
 * (`ShelfOriginPanel.tsx`).
 *
 * Colors are inline `style`, not Tailwind classes — `pegColor` values are
 * computed at runtime from a hash, and Tailwind's JIT compiler can only
 * generate classes that appear literally in source, so a template-literal
 * `bg-[${color}]` would silently produce no CSS.
 */
export function EntrySiteIcon({
  entry,
  platform,
  enabled,
}: {
  entry: VaultEntry;
  platform: Platform;
  enabled: boolean;
}) {
  const isLogin = entry.type === LOGIN_TYPE_ID;
  const url = isLogin ? fieldValue(entry, 'url') : '';
  // Favicon only makes sense for a Login (it's the only type with a URL) —
  // calling the hook unconditionally either way keeps the hook order stable
  // across renders; `enabled` alone (not `isLogin`) gates the actual fetch.
  const iconUrl = useFavicon(platform, url, enabled && isLogin);
  const [broken, setBroken] = useState(false);

  const boxClass = platform.isAndroid
    ? 'h-[50px] w-[50px] shrink-0 rounded-[10px] shadow-vault-peg transition-[transform,box-shadow] duration-vault-press ease-vault-snap group-active:translate-y-[3px] group-active:shadow-vault-peg-pressed'
    : 'h-[34px] w-[34px] shrink-0 rounded-vault-inner shadow-vault-peg transition-[transform,box-shadow] duration-vault-press ease-vault-snap group-active:translate-y-[3px] group-active:shadow-vault-peg-pressed';
  const glyphClass = platform.isAndroid ? 'h-7 w-7' : 'h-5 w-5';

  if (!isLogin) {
    return (
      <div
        data-morph="icon"
        className={`flex items-center justify-center ${boxClass}`}
        style={{ backgroundColor: pegColor(entry.title || entry.id), color: PEG_FOREGROUND }}
        aria-hidden="true"
      >
        <EntryTypeIcon icon={getEntryType(entry.type).icon} className={glyphClass} />
      </div>
    );
  }

  if (iconUrl && !broken) {
    return (
      <img
        data-morph="icon"
        src={iconUrl}
        alt=""
        className={`object-contain ${boxClass}`}
        // A malformed or truncated image (the 2MB cap can cut one off
        // mid-stream) falls back to the plate rather than the browser's
        // broken-image glyph.
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div
      data-morph="icon"
      className={`flex items-center justify-center ${boxClass}`}
      style={{ backgroundColor: pegColor(entry.title || url || entry.id), color: PEG_FOREGROUND }}
      aria-hidden="true"
    >
      <GlobeIcon className={glyphClass} />
    </div>
  );
}

function EmptyState({
  hasEntries,
  onAdd,
  justOnboarded,
  onDismissWelcome,
  biometricAvailable,
  biometricEnrolled,
  onEnableBiometrics,
  isAndroid,
}: {
  hasEntries: boolean;
  onAdd: () => void;
  /** True for exactly one render of this component: the empty vault right
   * after account creation. See `store.tsx`'s `justOnboarded` doc. */
  justOnboarded: boolean;
  onDismissWelcome: () => void;
  biometricAvailable: boolean;
  biometricEnrolled: boolean;
  onEnableBiometrics: () => Promise<boolean>;
  isAndroid: boolean;
}) {
  const showWelcome = justOnboarded && !hasEntries;

  return (
    // The reference's own `.empty` recipe: 13px, `#5f6871` (`--vault-dim`),
    // `padding:46px 20px` — was still on the older ink-system's slate-400/
    // text-sm(16px, remapped), never migrated when this list's other
    // pieces were.
    <div className="flex flex-1 flex-col items-center justify-center px-5 py-[46px] text-center shadow-[inset_0_8px_14px_-12px_#000]">
      {showWelcome ? (
        <p data-reveal="row" className="text-[13px] font-medium leading-relaxed text-vault-ok">
          Vault created.
        </p>
      ) : (
        <p data-reveal="row" className="text-[13px] leading-relaxed text-vault-dim">
          {hasEntries ? 'Nothing matches that search.' : 'This vault is empty.'}
        </p>
      )}

      {showWelcome && biometricAvailable && !biometricEnrolled && (
        <BiometricOffer
          isAndroid={isAndroid}
          onEnable={onEnableBiometrics}
          onDismiss={onDismissWelcome}
        />
      )}

      {!hasEntries && (
        <button data-reveal="row" className="btn-secondary mt-4" onClick={onAdd}>
          <PlusIcon />
          Add your first entry
        </button>
      )}
    </div>
  );
}

/**
 * The one-time nudge to turn on biometric unlock, shown right under the
 * "Vault created" welcome — see `store.tsx`'s `justOnboarded` doc for why
 * this lives here rather than as its own onboarding step (the account is
 * already unlocked by the time there's anywhere to show it). Only ever
 * rendered when `biometricAvailable && !biometricEnrolled`, so it
 * disappears on its own the moment enrolling actually succeeds — "Skip" is
 * the only path that needs to explicitly close it.
 */
function BiometricOffer({
  isAndroid,
  onEnable,
  onDismiss,
}: {
  isAndroid: boolean;
  onEnable: () => Promise<boolean>;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const label = isAndroid ? 'fingerprint or face unlock' : 'Windows Hello unlock';

  const enable = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const ok = await onEnable();
      if (!ok) setFailed(true);
      // On success `biometricEnrolled` flips true and this whole offer
      // unmounts on the next render — nothing further to do here.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-reveal="row" className="mt-4 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-3 text-left">
      <p className="text-xs text-slate-300">
        Turn on {label}? Your master password is still required after restarting the app.
      </p>
      {failed && (
        <p className="mt-1.5 text-xs text-bad">
          Couldn&apos;t turn it on. You can try again later in Settings.
        </p>
      )}
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          className="btn-secondary flex-1 text-xs"
          onClick={() => void enable()}
          disabled={busy}
        >
          {busy ? 'Enabling…' : 'Enable'}
        </button>
        <button type="button" className="btn-ghost flex-1 text-xs" onClick={onDismiss} disabled={busy}>
          Skip
        </button>
      </div>
    </div>
  );
}
