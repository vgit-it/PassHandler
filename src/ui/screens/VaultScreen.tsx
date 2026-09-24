import { useCallback, useEffect, useRef, useState } from 'react';

import { useApp } from '../../app/store';
import { toFillText } from '../../vault/fillFormat';
import { EntryField, VaultEntry } from '../../vault/types';
import { SyncBadge } from '../components/SyncBadge';
import { HomeScreenLogo } from '../components/HomeScreenLogo';
import { ShelfOriginPanel } from '../components/ShelfOriginPanel';
import { VaultFrame } from '../components/VaultFrame';
import { AlertIcon, BackIcon, LockIcon, SettingsIcon } from '../components/icons';
import { useClipboard } from '../hooks/useClipboard';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { useUnlockReveal } from '../hooks/useUnlockReveal';
import {
  ANDROID_HEADER_HEIGHT_PX,
  HEADER_ENTER_DELAY_MS,
  HEADER_ENTER_MS,
  REVEAL_LIGHT_FROM_OPACITY,
} from '../lockTransitionTiming';
import { Platform } from '../../platform/ports';
import { SyncSnapshot } from '../../sync/types';
import { BottomTabBar, TabName } from './BottomTabBar';
import { EntryDetail } from './EntryDetail';
import { EntryEditor } from './EntryEditor';
import { EntryList } from './EntryList';
import { PickEntryDetail } from './PickEntryDetail';
import { SettingsScreen } from './Settings';
import { UpcomingScreen } from './UpcomingScreen';

/**
 * `detail` remembers the tab it was opened over (`from` — List or
 * Upcoming stays mounted, dimmed, underneath, and is where closing returns
 * to), the `data-shelf-key` of the card it grew out of (`source`, `null`
 * for an open with no card to grow from), and `seq`, a fresh number per
 * open so `ShelfOriginPanel` remounts even when the same entry is reopened
 * mid-close. `edit` carries `from` through so cancelling back to the
 * detail view still returns to the right tab afterwards.
 */
type View =
  | { name: 'list' }
  | { name: 'upcoming' }
  | { name: 'detail'; id: string; from: TabName; source: string | null; seq: number }
  | { name: 'edit'; id: string | null; from?: TabName }
  | { name: 'settings' };

/** A `switch`, not `{ name: tab }` — TS won't distribute a `TabName`-typed
 * value across `View`'s union members just because their `name` fields
 * happen to line up. */
function tabView(tab: TabName): View {
  switch (tab) {
    case 'list':
      return { name: 'list' };
    case 'upcoming':
      return { name: 'upcoming' };
  }
}

let openSeq = 0;
function detailView(id: string, from: TabName, source: string | null): View {
  openSeq += 1;
  return { name: 'detail', id, from, source, seq: openSeq };
}

/** The dim scrim over the list/tab bar while a detail box is open —
 * black at .58 is exactly `filter: brightness(.42)` (spec §4.6), but as an
 * opacity fade it's compositor-only and needs no filter on the list. Its
 * transition shares the box's own tokens so the two always move together:
 * `arrive` in, `depart` out. */
const SCRIM_OPACITY = 0.58;
function scrimTransition(dimmed: boolean): string {
  return dimmed
    ? 'opacity var(--vault-t-box) var(--vault-arrive)'
    : 'opacity var(--vault-t-box-close) var(--vault-depart)';
}

export function VaultScreen() {
  const {
    entries,
    settings,
    platform,
    lock,
    sync,
    syncNow,
    noteActivity,
    readField,
    justTransitioned,
    playUnlockReveal,
  } = useApp();
  const [view, setView] = useState<View>({ name: 'list' });
  // Whether `VaultHeaderBar`'s NEXT mount should play its float-in entrance
  // — starts at `justTransitioned`'s captured value (true only right after
  // a real unlock), then gets cleared, once, after this component's first
  // commit (the effect below). `VaultScreen` itself only ever mounts once
  // per unlock (it's the direct target of `App.tsx`'s `phase` switch), but
  // the header BLOCK inside it mounts and unmounts repeatedly as `view`
  // moves to/from `'settings'`/`'edit'` — a ref (not state) here is what
  // lets those later remounts see the entrance already "used up" without
  // needing `VaultHeaderBar` itself to somehow know it's not the first one.
  // Read (passed as a prop) during render, mutated only from the effect —
  // never both in the same pass — so there's no risk of a stale read under
  // Strict Mode's double-render the way mutating it inline during render
  // would have (see `justTransitioned`'s own doc on `AppState` for the
  // longer version of this same reasoning, applied there to why the flag
  // lives in the store in the first place).
  const justUnlockedRef = useRef(justTransitioned);
  useEffect(() => {
    justUnlockedRef.current = false;
  }, []);

  // The unlock reveal (`docs/vault-visual-language-spec.md` §5.1,
  // `useUnlockReveal.ts`): the interior light comes up and the contents
  // settle while the doors part. Decided once, at mount — `playUnlockReveal`
  // is only true right after a lock-screen unlock (not an IME-launched one,
  // not onboarding). `revealing` also keeps the light layer mounted until the
  // reveal has finished.
  const reducedMotion = usePrefersReducedMotion();
  const [revealing, setRevealing] = useState(() => playUnlockReveal && !reducedMotion);
  const rootRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  useUnlockReveal({ rootRef, lightRef, play: revealing, onDone: () => setRevealing(false) });

  // Whether each of the two detail-ish overlays this screen can show — the
  // normal entry detail view, and pick-mode's per-field Fill/Show view — is
  // mid-close. Where each one opened from lives in `view` (detail) and
  // `pickOpen` (pick). See `closeDetail`/`closePick` below.
  const [detailClosing, setDetailClosing] = useState(false);
  const [pickClosing, setPickClosing] = useState(false);
  /** Pick mode's equivalent of `view`'s `source`/`seq` for the detail box. */
  const [pickOpen, setPickOpen] = useState<{ source: string | null; seq: number }>({
    source: null,
    seq: 0,
  });
  const [pickMode, setPickMode] = useState(false);
  /** Which entry (if any) the picker has drilled into, once `pickMode` is
   * active — `null` shows the searchable list, set shows `PickEntryDetail`'s
   * per-field Fill/Show view instead. Reset any time picking starts, is
   * cancelled, or backs out a level, same as the Android IME's own
   * `showingDetail`/`selectedEntryId` pair. */
  const [pickEntryId, setPickEntryId] = useState<string | null>(null);

  // "Put back": `closeDetail` only starts the close — `ShelfOriginPanel`
  // plays it and calls `finishDetailClose` when it has actually finished,
  // which is what clears the view state and unmounts the panel. An instant
  // unmount would cut the close off before it moved at all. The functional
  // `setView` update only leaves 'detail' — if something else already
  // changed `view` in the meantime (Edit, say, or another card tapped
  // mid-close), it leaves that newer navigation alone.
  const closeDetail = useCallback(() => setDetailClosing(true), []);
  const finishDetailClose = useCallback(() => {
    setView((v) => (v.name === 'detail' ? tabView(v.from) : v));
    setDetailClosing(false);
  }, []);
  const openDetail = useCallback((entry: VaultEntry, from: TabName, source: string | null) => {
    setDetailClosing(false);
    setView(detailView(entry.id, from, source));
  }, []);

  const closePick = useCallback(() => setPickClosing(true), []);
  const finishPickClose = useCallback(() => {
    setPickEntryId(null);
    setPickClosing(false);
  }, []);

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

  // Shared by `ListView`'s own FAB (Windows, and Android when the tab bar
  // isn't showing — e.g. mid pick-mode) and the "add entry" button docked
  // beside the Android tab bar below, per the Figma home-screen design.
  const openAddEntry = useCallback(() => {
    setPickMode(false);
    setPickEntryId(null);
    setView({ name: 'edit', id: null });
  }, []);

  useShortcuts({ enabled: platform.isDesktop, onLock: lockNow });
  useAndroidBackButton({ enabled: platform.isAndroid, view, setView, closeDetail });

  const cancelEdit = (current: { id: string | null; from?: TabName }) =>
    setView(current.id ? detailView(current.id, current.from ?? 'list', null) : { name: 'list' });

  // Windows manual fill: the hotkey has already shown/focused this window by
  // the time this fires. Switching to the list and into pick mode is all
  // that's needed — the existing search/list UI does the rest. See
  // `docs/MANUAL-FILL-DESIGN.md`. A no-op on Android, where the event is
  // never emitted because nothing registers the hotkey.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void platform.onEnterPickMode(() => {
      setView({ name: 'list' });
      setPickMode(true);
      setPickEntryId(null);
    }).then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
  }, [platform]);

  // Esc backs out one level without filling anything: out of
  // `PickEntryDetail` back to the list first if an entry is selected, then
  // out of pick mode entirely on a second press — the same depth Back/the
  // Cancel button already back out of.
  useEffect(() => {
    if (!pickMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (pickEntryId) closePick();
      else setPickMode(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickMode, pickEntryId, closePick]);

  // Fill, then Tab, then — if this entry has a password (`key === 'password'`,
  // same convention `vault.ts` already uses to special-case Login's
  // password) — offer it too. The Tab always happens, for every fill;
  // whether the follow-up password type happens is the only conditional
  // part.
  //
  // `platform.focusedFieldIsPassword()` asks Windows UI Automation for a
  // real answer (see `docs/MANUAL-FILL-DESIGN.md`'s "Fill, then Tab"
  // section) — `false` means Tab landed somewhere that is definitely not a
  // password field, and the follow-up type is skipped. `null` means UI
  // Automation couldn't tell (no UIA support on the control, a COM
  // failure, …), and the detection call itself throwing is treated the
  // same way — both fall back to the old Username → Tab → Password
  // heuristic rather than skipping a fill that might genuinely belong
  // there. An unusual form can still occasionally get a password typed
  // into the wrong visible field when detection comes back unknown; that
  // residual heuristic case is the accepted trade-off, same as before this
  // real check existed.
  //
  // Best-effort and quiet on failure — the field `fillField` was actually
  // asked to fill has already succeeded by the time this runs, so a Tab or
  // follow-up type failure here (the target window closed in the gap, focus
  // not restorable) shouldn't leave the picker sitting open over a fill
  // that, from the user's perspective, already worked.
  const tabThenMaybeFillPassword = useCallback(
    async (entry: VaultEntry) => {
      try {
        await platform.pressTab();
        const passwordField = entry.fields.find((f) => f.key === 'password' && f.fillable);
        if (!passwordField) return;

        let isDefinitelyNotPassword = false;
        try {
          isDefinitelyNotPassword = (await platform.focusedFieldIsPassword()) === false;
        } catch {
          // Detection itself failing is exactly the "unknown" case above —
          // isDefinitelyNotPassword stays false, so the heuristic still
          // runs below.
        }
        if (isDefinitelyNotPassword) return;

        const password = passwordField.sensitive
          ? readField(entry.id, passwordField.key)
          : passwordField.value;
        if (password) await platform.typeText(password);
      } catch {
        // See this function's own doc — quiet on purpose.
      }
    },
    [platform, readField],
  );

  // One field at a time: `field` is whichever `PickEntryDetail` row's Fill
  // button was pressed — its identity (username, a Card's CVV, an SSH key's
  // Body, …) is entirely type-dependent now, so this just resolves whatever
  // field it's handed to a string and types that. See
  // `docs/MANUAL-FILL-DESIGN.md`.
  const fillField = useCallback(
    async (entry: VaultEntry, field: EntryField) => {
      const raw = field.sensitive ? readField(entry.id, field.key) : field.value;
      if (!raw) {
        setPickMode(false);
        setPickEntryId(null);
        return;
      }
      // See `fillFormat.ts`: a `monthYear`/`date` field types bare digits,
      // not the display string with its `/` — the target field may well
      // insert its own as the user types, and typing ours too collides
      // with it.
      const value = toFillText(field.dataType, raw);
      try {
        await platform.typeText(value);
        // Only on success — a failed fill leaves the window up so the user
        // can see it didn't work and copy the value manually instead.
        await tabThenMaybeFillPassword(entry);
        void platform.minimizeMainWindow();
      } catch {
        // The target window may have closed or lost the ability to take
        // focus back in the meantime. Nothing more specific to show for it
        // — same fail-quiet posture as the rest of this screen's
        // clipboard/biometric fallbacks.
      } finally {
        setPickMode(false);
        setPickEntryId(null);
      }
    },
    [platform, readField, tabThenMaybeFillPassword],
  );

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

  const pickEntry = pickMode && pickEntryId ? entries.find((e) => e.id === pickEntryId) ?? null : null;

  // An entry can disappear underneath a detail view: a sync merges in a
  // deletion from another device, or Delete on the detail view itself. The
  // panel unmounts the moment `selected` goes null, so there's nothing left
  // to animate — finish the close directly (it would never report back on
  // its own), whether or not a close had already started.
  useEffect(() => {
    if (view.name === 'detail' && !selected) finishDetailClose();
  }, [view, selected, finishDetailClose]);
  useEffect(() => {
    if (pickEntryId && !pickEntry) finishPickClose();
  }, [pickEntryId, pickEntry, finishPickClose]);

  // The tab whose content sits in the frame: the one showing, or — while a
  // detail box is open — the one it was opened over, which stays mounted
  // and dimmed underneath it.
  const baseTab: TabName | null =
    view.name === 'list' || view.name === 'upcoming'
      ? view.name
      : view.name === 'detail'
        ? view.from
        : null;
  // Android-only: Windows has no mockup for this and already has its own
  // way into Settings/sync status (see `EntryList.tsx`'s header). Stays
  // mounted under an open detail box too (dimmed with the list, covered
  // once the box is fully open) instead of vanishing the instant the box
  // starts to grow — removing it changed the content area's height mid-
  // animation. Edit/Settings still replace the whole frame, tab bar and all.
  const showTabBar = platform.isAndroid && baseTab !== null;

  // Dimmed while either box is open, and un-dimmed the moment its close
  // starts (not once it ends), so the list brightens in step with the box
  // shrinking back into it (`docs/vault-visual-language-spec.md` §4.6).
  const dimmed =
    (view.name === 'detail' && selected !== null && !detailClosing) || (pickEntry !== null && !pickClosing);

  return (
    <div ref={rootRef} className="relative flex h-full flex-col">
      {/* The list/Upcoming content stays mounted (list dimmed, when an
          overlay is open) rather than being replaced outright — that's
          what makes "grows from THIS shelf, with the rest of the vault
          dimmed behind it" legible. It only fully unmounts for Edit/
          Settings, which replace the whole screen rather than opening a
          box on top of it.

          The header (spec's "Outside" plane, `bg-vault-chrome`) sits above
          `VaultFrame` — the bezeled box (spec's Frame + Inside planes) that
          was the one piece of the physical-vault metaphor phases 1–8 never
          actually built. Without it the search shelf/entries/tab panel just
          floated flush against the raw screen edge instead of sitting in a
          contained, bezeled box like the reference prototype
          (`vault-ui-v9.html`) — that's what read as "off center." Both are
          gated the same way the content itself already was: only for
          List/Detail/Upcoming — Edit/Settings stay separate full-screen
          destinations in this app's real navigation, not "inside the vault"
          the way the reference's rotate-to-Settings side face was. Upcoming
          joined this group (per request), specifically so the bottom tab
          bar that switches between it and List can dock inside one
          consistent frame instead of changing container between the two
          tabs it switches between — see `VaultFrame.tsx`'s own doc. */}
      {(view.name === 'list' || view.name === 'detail' || view.name === 'upcoming') && (
        // `bg-vault-chrome` here, not just on the header itself — without a
        // background on this wrapping div, the margin strip around
        // `VaultFrame` (its own `mx-2 mb-2`, left/right/bottom only now that
        // the top margin was dropped to sit flush under the header) showed
        // the app's page background (`body`'s `bg-ink-900`, a distinctly
        // BLUE navy — the *older* ink-design-system's page color, unrelated
        // to and never updated for the vault palette) instead of a neutral
        // dark tone. Matches the header's own color exactly (per request) —
        // both are the spec's "Outside" plane (`docs/vault-visual-language-
        // spec.md` §1), so the header and the margin around the frame now
        // read as one continuous surface rather than two different dark
        // greys butted up against each other. Scoped to just this block,
        // not `body` itself, so Settings/the editor (still on the ink
        // system) keep their own background unchanged.
        //
        // Android: `#292c2f`, the Figma home-screen design's own root frame
        // background — a flat fill as of the design's latest revision (an
        // earlier revision had this as a `#3a4148`→`#2a3036` gradient,
        // which is what this was first implemented as; re-fetched after
        // the user repainted it in Figma directly, so this is the exact
        // current value, not the earlier one). `src-tauri/android-ime`'s
        // own `colors.xml`/`MainActivity.kt` use this identical literal
        // for the native window background and the system status/nav bar
        // color too (see that file's own doc), so all three surfaces stay
        // in lockstep by construction. Windows keeps the flat
        // `bg-vault-chrome` (no Figma counterpart to match).
        <div
          className={`flex h-full flex-col ${platform.isAndroid ? 'bg-[#292c2f]' : 'bg-vault-chrome'}`}
        >
          {/* Rendered for List, Detail, AND Upcoming alike now (per
              request) — see this bar's own top doc for why `onUpcoming`
              below is a toggle rather than a one-way door, and why that's
              enough to keep "back to Home" working on both platforms
              without a second, dedicated Back control. */}
          <VaultHeaderBar
            platform={platform}
            sync={sync}
            onSyncNow={() => void syncNow()}
            onSettings={() => {
              setPickMode(false);
              setPickEntryId(null);
              setView({ name: 'settings' });
            }}
            onUpcoming={() => {
              setPickMode(false);
              setPickEntryId(null);
              // `baseTab`, not `view.name` — a detail box opened over
              // Upcoming still counts as "on Upcoming" for this toggle.
              setView(tabView(baseTab === 'upcoming' ? 'list' : 'upcoming'));
            }}
            upcomingActive={baseTab === 'upcoming'}
            onLock={lockNow}
            justUnlocked={justUnlockedRef.current}
          />
          <VaultFrame radialWall={platform.isAndroid} transparentBezel={platform.isAndroid}>
            {/* The content area — `flex-1`, so `BottomTabBar` below it (a
                real sibling, not an overlay) keeps its own space rather
                than being drawn over. `isolate` keeps everything inside it
                (the list's sticky headers, its z-20 FAB) in its own
                stacking context, below the dim scrim and the detail boxes
                that sit after the tab bar (outside this div, so they cover
                the tab bar too). Don't remove `isolate`: without it the
                FAB and sticky headers draw over an open detail box. */}
            <div className="relative isolate min-h-0 flex-1">
              {baseTab === 'upcoming' ? (
                <UpcomingScreen onOpen={(entry, shelfKey) => openDetail(entry, 'upcoming', shelfKey)} />
              ) : (
                <ListView
                  // The row is found again by its `data-shelf-key` (the
                  // entry id) — see `EntryList.tsx`'s `Row`.
                  onOpen={(entry) => openDetail(entry, 'list', entry.id)}
                  onAdd={openAddEntry}
                  onCopyPassword={copyPassword}
                  pickMode={pickMode}
                  onPickSelect={(entry) => {
                    setPickClosing(false);
                    setPickOpen((p) => ({ source: entry.id, seq: p.seq + 1 }));
                    setPickEntryId(entry.id);
                  }}
                />
              )}
            </div>

            {showTabBar && (
              // Inside `VaultFrame` now (per request) — a real flex sibling
              // of the content area above, docked at the frame's own
              // bottom edge, rather than a screen-wide overlay pinned flush
              // to the true screen edge, ignoring the frame's own bottom
              // margin/bezel entirely. "+" lives inside `BottomTabBar` too
              // (docked at the channel's right end) — see that file's doc.
              <BottomTabBar
                active={baseTab ?? 'list'}
                onSelect={(tab) => {
                  setPickMode(false);
                  setPickEntryId(null);
                  setView(tabView(tab));
                }}
                onAdd={openAddEntry}
              />
            )}

            {/* The unlock reveal's interior light: black over the whole
                interior (content and tab bar), fading out as the doors
                part. Only mounted while the reveal runs. */}
            {revealing && (
              <div
                ref={lightRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 z-30 bg-black"
                style={{ opacity: REVEAL_LIGHT_FROM_OPACITY }}
              />
            )}

            {/* The dim scrim, then the two detail boxes — all `absolute
                inset-0` against `VaultFrame`'s interior, so they cover the
                tab bar as well as the content area. The scrim never takes
                taps: a card tapped mid-close opens straight away. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 z-10 bg-black"
              style={{ opacity: dimmed ? SCRIM_OPACITY : 0, transition: scrimTransition(dimmed) }}
            />

            {pickEntry && (
              <ShelfOriginPanel
                key={pickOpen.seq}
                sourceKey={pickOpen.source}
                closing={pickClosing}
                onClosed={finishPickClose}
              >
                <PickEntryDetail
                  entry={pickEntry}
                  onBack={closePick}
                  onFill={(field) => void fillField(pickEntry, field)}
                />
              </ShelfOriginPanel>
            )}

            {view.name === 'detail' && selected && (
              <ShelfOriginPanel
                key={view.seq}
                sourceKey={view.source}
                closing={detailClosing}
                onClosed={finishDetailClose}
                transparent={platform.isAndroid}
              >
                <EntryDetail
                  entry={selected}
                  onBack={closeDetail}
                  onEdit={() => setView({ name: 'edit', id: selected.id, from: view.from })}
                  onCopy={(value, label) => void copy(value, label)}
                />
              </ShelfOriginPanel>
            )}
          </VaultFrame>
        </div>
      )}

      {view.name === 'edit' && (
        <EntryEditor
          entry={selected}
          onDone={() => setView({ name: 'list' })}
          onCancel={() => cancelEdit(view)}
        />
      )}

      {view.name === 'settings' && <SettingsScreen onBack={() => setView({ name: 'list' })} />}

      {(pickMode || countdown) && (
        // `z-20` beats `EntryList`'s sticky category headers (`z-10`) — the
        // same fix as the FAB's own `z-20`, for the same reason: without an
        // explicit z-index here, a header scrolling past would draw over
        // this stack despite sitting later in the DOM, because explicit
        // z-index always beats `auto` regardless of document order. No
        // longer wraps the tab bar too — that moved inside `VaultFrame`
        // (per request) as a real flex sibling of the content area, so it
        // needs no z-index game of its own any more.
        <div
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-2 p-3 ${
            showTabBar && view.name !== 'detail' ? 'pb-32' : ''
          }`}
        >
          {/* pb bumped to clear the tab channel, which now sits inside
              `VaultFrame`'s own bottom margin + bezel padding (`mb-2` +
              `--vault-bezel`, ~17px) rather than flush against the true
              screen edge — pb-32 (128px) leaves the same kind of generous
              slack over the channel's ~60-65px height that pb-28 gave the
              old flush position, just with that extra ~17px folded in.
              Only applied when the tab bar is actually visible — p-3 alone
              (unchanged) is enough on Windows or on the Edit/Settings
              screens, which have no tab bar, and on Detail, where the tab
              bar is still mounted but covered by the detail box. */}
          {pickMode && (
            <PickModeBanner
              onCancel={() => {
                setPickMode(false);
                setPickEntryId(null);
              }}
            />
          )}
          {countdown && (
            <ClipboardBar
              label={countdown.label}
              secondsLeft={countdown.secondsLeft}
              total={settings.clipboardClearSeconds}
              onClear={() => void clearNow()}
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Shown at the bottom of the screen for as long as a manual-fill hotkey
 * press is being worked through — over the searchable list, and again over
 * `PickEntryDetail` once an entry's been selected. Cancelling from either
 * step exits picking entirely, same as Esc.
 */
function PickModeBanner({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-accent/50 bg-ink-700 px-3 py-2.5 shadow-lg">
      <div className="text-sm text-slate-100">Pick from the list</div>
      <button className="btn-secondary shrink-0" onClick={onCancel}>
        Cancel (Esc)
      </button>
    </div>
  );
}

/** Split out so the list can read `readPassword` without prop-drilling it. */
function ListView({
  onOpen,
  onAdd,
  onCopyPassword,
  pickMode,
  onPickSelect,
}: {
  onOpen: (entry: VaultEntry) => void;
  onAdd: () => void;
  onCopyPassword: (entry: VaultEntry, readPassword: (id: string) => string | null) => void;
  pickMode: boolean;
  onPickSelect: (entry: VaultEntry) => void;
}) {
  const { readPassword } = useApp();
  return (
    <EntryList
      onOpen={onOpen}
      onAdd={onAdd}
      onCopyPassword={(entry) => onCopyPassword(entry, readPassword)}
      pickMode={pickMode}
      onPickSelect={onPickSelect}
    />
  );
}

/**
 * The header — spec's "Outside" plane (`docs/vault-visual-language-spec.md`
 * §1): title/sync/lock/gear, `bg-vault-chrome`, sitting above `VaultFrame`
 * rather than inside its bezel. Moved out of `EntryList.tsx` (which used to
 * render this itself) so the frame can wrap only what's actually "inside
 * the vault" — the search shelf, the list, its rows — matching the
 * reference prototype's own structure (`.top` outside `.vault`).
 *
 * Shared by List, Detail, AND Upcoming now (per request) — a dedicated
 * `UpcomingHeaderBar` (Back button + "Upcoming" title) used to render in
 * this bar's place while on that tab, losing the Lock/Settings row
 * entirely; that's gone, replaced by this same bar throughout, so Lock and
 * Settings stay reachable no matter which of the three is showing. Android
 * gets lock + a settings gear (no title, no sync badge — the design hides
 * both there, `SyncNotice` still surfaces a conflict regardless of
 * platform); Windows gets the app title, the sync badge, an Upcoming/Back
 * toggle, Settings, and Lock. Android needs no such toggle of its own:
 * `BottomTabBar`'s own "List" tab already stays on screen and already
 * doubles as the way back (`VaultScreen`'s `showTabBar` covers 'upcoming'
 * same as 'list'), so unifying the header there costs it nothing — it
 * already had that path back before this bar was ever the one showing.
 * Windows has no such tab bar, so `upcomingActive` is what keeps that path
 * alive: the same button that opens Upcoming from List becomes the way
 * back once already there (see its own render branch below), rather than
 * a second, separately-drawn Back control needing to fit into this bar too.
 *
 * `justUnlocked` (see `VaultScreen`'s own doc on `justUnlockedRef`) drives
 * a one-shot float-in-from-the-top entrance (per request) the very first
 * time this bar appears after a real unlock — animating the whole `<header>`
 * element (background and content together), not just an inner wrapper: a
 * `transform` on it doesn't disturb the Android logo's own `absolute`
 * centering (still relative to this same element's normal layout box,
 * unaffected by its own transform) or the `ml-auto`/`-ml-3` flex tricks
 * either side uses, so the whole bar just slides down/fades in as one
 * unit. Every OTHER mount of this bar (returning from Settings/Edit) renders
 * already-settled, no animation — see `VaultScreen`'s own doc for how
 * that's guaranteed. Switching to/from Upcoming isn't a mount at all any
 * more (see above), so there was never anything for that case to animate.
 */
function VaultHeaderBar({
  platform,
  sync,
  onSyncNow,
  onSettings,
  onUpcoming,
  upcomingActive,
  onLock,
  justUnlocked,
}: {
  platform: Platform;
  sync: SyncSnapshot;
  onSyncNow: () => void;
  onSettings: () => void;
  onUpcoming: () => void;
  /** True while Upcoming is the tab actually showing — Windows-only (see
   * this function's own doc): swaps the button's icon/label from "Upcoming"
   * to "Back" and repurposes its same `onUpcoming` click into the way back
   * to List, rather than adding a second control for it. */
  upcomingActive: boolean;
  onLock: () => void;
  justUnlocked: boolean;
}) {
  // Captured once, at this bar's own mount — immune to `justUnlocked`
  // changing later (it never does within one mount, but see
  // `VaultScreen`'s own doc for why the prop itself is only meaningful at
  // the instant a fresh instance of this bar mounts).
  const [enter] = useState(justUnlocked);
  const [visible, setVisible] = useState(!enter);
  useEffect(() => {
    if (!enter) return;
    const timeout = window.setTimeout(() => setVisible(true), HEADER_ENTER_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [enter]);
  return (
    <header
      // No bottom margin here, and `VaultFrame` drops its own top margin to
      // match (see that component's doc) — the frame now sits flush against
      // this bar (per request), rather than the two 8px gaps (this bar's own
      // `mb-2` plus the frame's uniform `m-2`) that used to separate them.
      //
      // Android: NO background of its own — a real bug from the previous
      // pass, caught by actually looking at the render rather than reading
      // the class names: this `<header>` had `bg-vault-chrome` hardcoded
      // regardless of platform, so when the PARENT wrapping div
      // (`OnboardingScreen`... no — `VaultScreen`'s own render, just below)
      // switched to the `#3a4148`→`#2a3036` gradient, this header kept
      // painting its own OLD flat `bg-vault-chrome` on top of it, cutting
      // the gradient off in a hard, visible line exactly at the header/
      // frame boundary instead of letting it run continuously from the top
      // of the screen down through the margin around the frame — which was
      // the entire point of adding it. Leaving this transparent lets the
      // one gradient on the parent show through underneath it. Windows
      // keeps its own opaque `bg-vault-chrome` (unaffected by any of this
      // Figma work).
      className={`flex flex-shrink-0 items-center gap-2 ${platform.isAndroid ? '' : 'bg-vault-chrome'} ${
        // Windows: matches the reference prototype's own `.top` recipe
        // exactly (`padding:12px 12px 10px`) — `pl-3 pr-3 pt-3 pb-2.5` is
        // 12/12/12/10px. Android keeps its own established sizing (a taller
        // min-height for a comfortable touch target, wider side padding) —
        // not something the reference (a desktop-shaped mockup with a text
        // "Lock" button, no icon-only mobile header) speaks to directly.
        // `min-h-[68px]` (was 78px, per request, -10px), now driven by
        // `ANDROID_HEADER_HEIGHT_PX` via inline `style` below rather than a
        // Tailwind arbitrary-value class — `Unlock.tsx`'s own top bar has
        // to render at this exact same height (see
        // `UNLOCK_TOP_BAR_HEIGHT_PX_ANDROID`'s own doc in
        // `lockTransitionTiming.ts`), and a literal baked into a class name
        // here has no way to stay in sync with that. Nothing to keep in
        // sync with any more on the tab-bar side (see this component's own
        // top doc) — it's the one header now, so its height simply can't
        // jump when the tab bar switches between List and Upcoming.
        platform.isAndroid ? 'relative px-5 py-3' : 'pl-3 pr-3 pt-3 pb-2.5'
      } ${enter ? 'transition-[opacity,transform] ease-vault-snap' : ''}`}
      style={{
        ...(platform.isAndroid ? { minHeight: ANDROID_HEADER_HEIGHT_PX } : {}),
        ...(enter
          ? {
              opacity: visible ? 1 : 0,
              transform: visible ? 'translateY(0)' : 'translateY(-10px)',
              transitionDuration: `${HEADER_ENTER_MS}ms`,
            }
          : {}),
      }}
    >
      {platform.isAndroid ? (
        <>
          <button
            // Per the Figma home-screen design: a metallic gradient pill
            // (`#3f454a`→`#32373d`, 1px `#565656` border — re-fetched after
            // the user repainted these directly in Figma; was
            // `#65727f`→`#525d68`/`#727272` at first implementation, a
            // visibly bluer, lighter grey than this darker, more neutral
            // one), a soft drop shadow, 5px radius rather than the flat
            // `#242C34`/10px pill this replaces — `px-3`/`.btn-ghost`'s own
            // `py-3` already total exactly 44×44 around a 20px icon with no
            // explicit size needed, so this only swaps chrome, not
            // dimensions. The icon stays pure white either way (see its own
            // doc below) — nothing suggested the glyph itself changed, and
            // white still reads cleanly against this darker background,
            // if anything with more contrast than before.
            //
            // No `-ml-3` any more — a real asymmetry, caught on request:
            // that negative margin predates this whole Figma pass, from
            // when this was a bare, borderless icon (no visible pill), and
            // was meant to optically align the GLYPH with the header's own
            // `px-5` edge by cancelling `.btn-ghost`'s own `px-3` padding,
            // letting the (invisible) tap target extend further left than
            // the header's padding boundary. Now that the button is a
            // visible bordered pill, that only pushed the PILL itself 12px
            // closer to the screen edge than Settings' own pill on the
            // right (which has no matching `-mr-3` and so sits flush with
            // the header's own `px-5` instead) — an asymmetry easy to miss
            // reading the class names side by side, but obvious once
            // actually measured. Dropping it makes both pills sit the same
            // 20px off their respective edges.
            className="btn-ghost rounded-[5px] border border-[#565656] bg-gradient-to-b from-[#3f454a] to-[#32373d] px-3 shadow-[0_0_4.3px_rgba(0,0,0,.25)] hover:brightness-110"
            onClick={onLock}
            aria-label="Lock vault"
            title="Lock vault"
          >
            {/* Pure white, not the earlier `#e8edf2` near-white guess —
                the reference's own icon is an exported asset with no
                extractable color in the design data, so this was confirmed
                by rendering the actual PNG to a canvas and sampling its
                pixels directly: ~4400 pixels of exactly `rgb(255,255,255)`
                versus a few hundred anti-aliased edge blends, an
                unambiguous result. That dim grey `#6C7681` from before this
                whole pass was calibrated for the old near-black `#242C34`
                fill and nearly disappears against this lighter metallic
                gradient either way. */}
            <LockIcon className="h-5 w-5 text-white" />
          </button>
          {/* Centered in the header (per request) — this bar is already
              `relative` on Android, so an absolutely-positioned, centered
              element sits independently of the Lock/Settings buttons'
              own flex flow rather than needing a three-column layout.
              `pointer-events-none`: it's a brand mark, not a control, and
              sits well clear of both buttons regardless (this header's own
              `gap-2` plus their own `ml-auto`/flex order push them to the
              true edges), but this rules out ever intercepting a tap meant
              for something else. Centering is size-independent (`left-1/2
              top-1/2` plus a translate by the element's OWN half-size), so
              `h-[42px]` (was `h-8`/32px, +30% per request — 32×1.3=41.6,
              rounded) needed no other change to stay centered. */}
          <HomeScreenLogo className="pointer-events-none absolute left-1/2 top-1/2 h-[42px] w-auto -translate-x-1/2 -translate-y-1/2" />
          <button
            // `px-3`, not the old edge-flush `pr-1` — that nudged the bare
            // icon toward the true screen edge, but now that the icon sits
            // in its own visible pill (per request), symmetric padding is
            // what keeps it centered in that box; `ml-auto` alone still
            // pushes the whole pill to the header's right edge.
            className="btn-ghost ml-auto rounded-[5px] border border-[#565656] bg-gradient-to-b from-[#3f454a] to-[#32373d] px-3 shadow-[0_0_4.3px_rgba(0,0,0,.25)] hover:brightness-110"
            onClick={onSettings}
            aria-label="Settings"
            title="Settings"
          >
            {/* Same gradient pill + pure-white icon as the Lock button
                above — see its own doc. */}
            <SettingsIcon className="h-5 w-5 text-white" />
          </button>
        </>
      ) : (
        <>
          {/* text-[15px], not the app's remapped `text-sm` (16px) — matches
              the reference's own `.brand{font-size:15px;font-weight:600}`
              exactly. */}
          <h1 className="mr-auto text-[15px] font-semibold text-slate-300">Vault</h1>
          <SyncBadge sync={sync} onClick={onSyncNow} />
          {/* Doubles as the way back once already on Upcoming (see this
              component's own top doc) — same click target, icon/label swap
              to `BackIcon`/"Back" rather than a second, separately-drawn
              control sharing the row with it. */}
          <button
            className="btn-ghost px-2"
            onClick={onUpcoming}
            aria-label={upcomingActive ? 'Back' : 'Upcoming'}
            title={upcomingActive ? 'Back' : 'Upcoming'}
          >
            {upcomingActive ? <BackIcon /> : <AlertIcon />}
          </button>
          <button
            className="btn-ghost rounded-[10px] border border-[#3C4A56] bg-[#242C34] px-2 hover:bg-[#242C34]"
            onClick={onSettings}
            aria-label="Settings"
            title="Settings"
          >
            {/* Explicit size/color now, not the bare default (`base`,
                16px, inherited `.btn-ghost` text color) — `h-3 w-3` (was
                the implicit 16px, -4px per request) and `text-[#6C7681]`
                (per request) on the icon itself. */}
            <SettingsIcon className="h-3 w-3 text-[#6C7681]" />
          </button>
          <button
            className="btn-ghost rounded-[10px] border border-[#3C4A56] bg-[#242C34] px-2 hover:bg-[#242C34]"
            onClick={onLock}
            aria-label="Lock vault"
            title={platform.isDesktop ? 'Lock vault (Ctrl+L)' : 'Lock vault'}
          >
            {/* Explicit size/color now, not the bare default — see the
                Settings icon just above for why. */}
            <LockIcon className="h-3 w-3 text-[#6C7681]" />
          </button>
        </>
      )}
    </header>
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

/**
 * Android's hardware/gesture back button.
 *
 * Tauri does not wire it to the webview's own history by default — pressing
 * back exits the app unconditionally, from any screen, because there is
 * nothing for it to do otherwise. `MainActivity.kt` opts back into the
 * webview-history behaviour (`handleBackNavigation = true`); this hook's job
 * is to keep the history at exactly the right depth for that to do the right
 * thing, and to decide the target screen when it fires.
 *
 * The mapping matches each screen's own on-screen Back button exactly:
 * Settings and Detail collapse to Home; Edit collapses to Detail if it was
 * editing an existing entry, Home if it was adding a new one; Home has
 * nothing left to collapse to, so back from there falls through to Android's
 * own default and exits — the same thing that happens today, just now scoped
 * to only the one screen where it should. Upcoming has no on-screen Back of
 * its own (it's a tab, not a push) but collapses to Home the same way, for
 * the same reason every other bottom-tab screen would: back always lands on
 * the tab bar's Home tab, matching the usual Android convention.
 *
 * Not registered on Windows, which has no hardware back button — some mice
 * have a back button of their own that fires the same `popstate` event, and
 * there is no reason for that to start navigating a desktop app that already
 * has explicit on-screen buttons and its own keyboard shortcuts for this.
 */
function useAndroidBackButton({
  enabled,
  view,
  setView,
  closeDetail,
}: {
  enabled: boolean;
  view: View;
  setView: (view: View) => void;
  /** Routes a back-out of Detail through the same close-into-the-card
   * animation every other dismissal uses (`ShelfOriginPanel.tsx`) instead
   * of the instant `setView` swap Settings/Upcoming still get — those never
   * opened as a "box" out of a card, so there's nothing for them to
   * animate closed. Detail returns to whichever tab it was opened over. */
  closeDetail: () => void;
}) {
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // Keeps the webview's history at depth 1 while any non-Home screen shows,
  // and depth 0 on Home — never more, no matter how many screens were
  // visited along the way, so one back press always returns to Home in one
  // step rather than needing to be pressed once per screen visited.
  useEffect(() => {
    if (!enabled) return;

    const pushed = (window.history.state as { vault?: boolean } | null)?.vault;
    if (view.name === 'list') {
      // Unwound via a real navigation, rather than discarded outright, so the
      // matching `popstate` fires and history stays consistent afterwards.
      // Harmless when Home was reached by pressing back in the first place —
      // see that handler's early return below.
      if (pushed) window.history.back();
    } else if (!pushed) {
      window.history.pushState({ vault: true }, '');
    }
  }, [enabled, view]);

  useEffect(() => {
    if (!enabled) return;

    const onPopState = () => {
      const current = viewRef.current;
      if (current.name === 'detail') {
        closeDetail();
      } else if (current.name === 'settings' || current.name === 'upcoming') {
        setView({ name: 'list' });
      } else if (current.name === 'edit') {
        setView(current.id ? detailView(current.id, current.from ?? 'list', null) : { name: 'list' });
      }
      // Already on Home: nothing was ever pushed, so Android never delivered
      // this event to the webview at all — it went straight to its own
      // default and exited, exactly as it does today.
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [enabled, setView, closeDetail]);
}
