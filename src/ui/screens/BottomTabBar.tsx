import { CalendarIcon, HomeIcon, PlusIcon } from '../components/icons';

export type TabName = 'list' | 'upcoming';

const TABS: { name: TabName; label: string; Icon: typeof HomeIcon }[] = [
  // Home, then Upcoming (per request — was the reverse order). Profile is
  // gone entirely as of this pass: Settings now lives behind the header
  // gear on both platforms (see `EntryList.tsx`), so there's no third tab
  // left to represent it. The slug's own `left` offset below is computed
  // from `activeIndex` (this array's order), not hardcoded per tab name, so
  // reordering this array is the only change reordering the tabs needs.
  { name: 'list', label: 'Home', Icon: HomeIcon },
  { name: 'upcoming', label: 'Upcoming', Icon: CalendarIcon },
];

/**
 * The vault's inner floor, bottom band. Only ever rendered on Android, and
 * only over the two top-level screens (`VaultScreen.tsx`'s `showTabBar`) —
 * Detail/Edit/PickEntryDetail/Settings stay full-screen pushes with no tab
 * bar, same as they always have been.
 *
 * Per the Figma home-screen design (node 103:175) — this and `EntryList.tsx`'s
 * search band are deliberately styled as two adjacent pieces of the same
 * `#3b424a`→`#292f37` gradient "ControlPanel" (split at a `#323840`
 * midpoint across the two pieces, not repeated whole on each — see this
 * file's own `className` doc below for why), sharing its drop shadow
 * (which lives on the search band, the topmost piece). This supersedes the
 * previous design (`docs/vault-visual-
 * language-spec.md` §4.5's recessed channel + sliding "slug" nav, ported
 * from a different, non-Figma reference prototype) — that spec's own scope
 * table never actually covered this exact Figma frame, which turns out to
 * predate it.
 *
 * Nested inside `VaultFrame` (`VaultScreen.tsx`, per an earlier request) —
 * a real flex sibling of the content area, docked at the frame's own
 * bottom edge, rather than a screen-wide overlay. This bar switches
 * between List and Upcoming, so both share `VaultFrame`/`VaultHeaderBar`
 * for exactly this reason.
 *
 * Tabs are icon-only now (Figma has no text label under either one) inside
 * one shared `rgba(0,0,0,.35)` housing — no more sliding slug behind
 * whichever tab is active; instead each tab carries its own small pill
 * (`bg-primary/50`, `text-primary` is `#8fadc7`, a literal so `/50` can
 * alpha-blend it at build time) directly behind its own icon, toggled by
 * opacity rather than repositioned, matching the reference's own per-tab
 * `opacity-50`/`opacity-0` pair exactly (found via `get_design_context`,
 * not guessed from the screenshot alone — the low-res screenshot alone
 * read as two fully independent buttons with no shared housing at all,
 * which turned out to be wrong).
 *
 * `+` still docks at the channel's own right end, as the reference's own
 * glossy gradient button shape (bordered, two-layer drop-shadow — the same
 * shadow recipe `Unlock.tsx`'s two buttons use) rather than a flat
 * `--vault-accent` fill — this Figma frame shares `Unlock.tsx`'s older
 * design system rather than the flat vault-shelf one (see `EntryList.tsx`'s
 * row card doc). Its colors are the entry-creation flow's soft coral — the
 * IME new-entry panel's Save/Generate gradient, `#D6B0A0`→`#BC907E` — so
 * "+" matches the screens it opens (`docs/ENTRY-CREATION-PALETTE-DESIGN.md`).
 * It was a stronger `#bb8c7a`→`#ac6e55`.
 */
export function BottomTabBar({
  active,
  onSelect,
  onAdd,
}: {
  active: TabName;
  onSelect: (tab: TabName) => void;
  onAdd: () => void;
}) {
  return (
    <div
      // `flex-shrink-0` — as `VaultFrame`'s inner flex column's second
      // child (after the content area's own `flex-1 min-h-0`, whose
      // basis is 0%), this bar would otherwise be the one absorbing any
      // shrink pressure instead of the content area doing so, backwards
      // from the intent: the channel should never compress, the scrollable
      // content above it should.
      // `from-[#323840]`, not the panel's own full `#3b424a` — the BOTTOM
      // half of the one continuous gradient that starts in
      // `EntryList.tsx`'s search band (`to-[#323840]`, the same
      // midpoint) — see that file's own doc for why splitting the stops
      // instead of repeating the full range on both pieces matters (a
      // visible seam at the boundary otherwise, found by actually
      // rendering this). `px-3` (12px), not the reference's own literal
      // `px-[10px]` — matches the side-clearance fix in `EntryList.tsx`'s
      // search band and entry list (see that file's own doc for why), so
      // the nav/+ button stay aligned with the search pill and cards above
      // them.
      className="pointer-events-auto flex flex-shrink-0 items-center gap-[12px] bg-gradient-to-b from-[#323840] to-[#292f37] px-3 pb-[11px] pt-[7px]"
      // Rises with `EntryList.tsx`'s search band during the unlock reveal
      // (`useUnlockReveal.ts`) — the two halves of one control panel.
      data-reveal="panel"
      aria-label="Primary"
    >
      <nav className="relative flex h-[56px] flex-1 items-center justify-around rounded-[10px] bg-black/35">
        {TABS.map(({ name, Icon, label }) => {
          const isActive = name === active;
          return (
            <button
              key={name}
              type="button"
              className="relative flex h-full flex-1 items-center justify-center transition-colors duration-vault-ui"
              onClick={() => onSelect(name)}
              aria-current={isActive ? 'page' : undefined}
              aria-label={label}
              title={label}
            >
              {/* `h-[42px] w-[72px] rounded-[10px]` — the reference's own
                  literal active-pill dimensions (a wide rounded rectangle,
                  not a circle — corrected from an earlier `h-9 w-9
                  rounded-full` simplification, per request). `rounded-[10px]`
                  confirmed directly against node 103:175's own active pill
                  (`I118:782;118:683`) — was `rounded-[20px]` from an
                  earlier, less precise pass. */}
              <span
                aria-hidden="true"
                className={`absolute h-[42px] w-[72px] rounded-[10px] bg-primary/50 transition-opacity duration-vault-ui ${
                  isActive ? 'opacity-100' : 'opacity-0'
                }`}
              />
              {/* `text-[#d6e4ef]`, not `text-vault-fg` (`#e2e6ea`) — Figma
                  gives no literal color for these icons (exported assets),
                  but every other "active/legible" foreground this pass
                  touched turned out to be `#d6e4ef` specifically (row
                  title, search text), so this matches that rather than a
                  close-but-different vault token, for internal consistency
                  within this one redesign. The inactive color has no such
                  precedent to match — `text-vault-muted` stands as a
                  reasonable default. */}
              <Icon className={`relative h-[18px] w-[18px] ${isActive ? 'text-[#d6e4ef]' : 'text-vault-muted'}`} />
            </button>
          );
        })}
      </nav>

      {/* The glyph is the creation flow's dark warm grey, `#2A2725`
          (5.25:1 on the gradient's darker stop). */}
      <button
        type="button"
        className="flex h-14 w-[60px] shrink-0 items-center justify-center rounded-[12px] border border-[#C9A291] bg-gradient-to-b from-[#D6B0A0] to-[#BC907E] text-[#2A2725] shadow-[0_2px_4px_rgba(0,0,0,.35),0_1px_1px_rgba(0,0,0,.2)] transition-transform duration-vault-press ease-vault-snap active:translate-y-[2px]"
        onClick={onAdd}
        aria-label="Add entry"
        title="Add entry"
      >
        <PlusIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
