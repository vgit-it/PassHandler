/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Dark is the only theme. The PRD asks for dark by default and specifies no
  // light-mode behaviour, so the app commits to one look rather than carrying
  // an untested second palette.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Values match the Vault design system's dark-theme semantic
        // tokens (--background/--card/--secondary/--border/--ph-navy-400,
        // --primary, --accent, --success, --warning, --destructive). Names
        // are kept as ink/primary/accent/ok/warn/bad — the tokens already
        // used at every call site across the app — so this is a value swap,
        // not a rename; nothing outside this file and index.css needed to
        // change.
        ink: {
          // ink-950: the app's page background — one step darker than
          // ink-900, per the Figma home-screen redesign (`--darkbg`
          // there). ink-900 itself is UNCHANGED and now doubles as the
          // reusable elevated-surface color (cards, panels) that sits on
          // top of it, since its value happens to already equal the
          // design's own card color — see `index.css`'s `body` doc.
          950: '#070e19',
          900: '#0c1827', // --background (now also: card/surface color)
          800: '#111e2e', // --card
          // ink-750: card/panel border color, from the same redesign —
          // sits between ink-800 and ink-700 in actual lightness, hence
          // the step number. No prior token matched this exact value.
          750: '#142238',
          700: '#1a2d44', // --secondary
          600: '#1e3457', // --border
          500: '#264670', // --ph-navy-400 (lightest navy step; stronger borders, scrollbar thumb)
        },
        // Primary button surfaces only (design system --primary). Distinct
        // from `accent`, which covers links/focus rings/selected rows.
        primary: {
          DEFAULT: '#8fadc7',
          foreground: '#0c1827',
        },
        accent: {
          DEFAULT: '#4a9ee0', // --accent
          muted: '#3d6ebc',
        },
        ok: '#4ade80', // --success (unchanged — already matched)
        warn: '#f59e0b', // --warning
        bad: '#e05252', // --destructive
        // Unlock screen's submit/biometric buttons only. Backed by CSS
        // custom properties (index.css `:root`) rather than a flat hex, so
        // the color can be swapped in one place later without touching
        // Unlock.tsx — `bg-actionbutton` / `text-actionbutton-foreground`.
        actionbutton: {
          DEFAULT: 'var(--actionbutton-bg)',
          foreground: 'var(--actionbutton-text)',
        },
        // Vault visual-language tokens (`docs/vault-visual-language-spec.md`,
        // `docs/vault-visual-overhaul-plan.md`) — `bg-vault-shelf`,
        // `border-vault-rail`, etc. Backed by the `--vault-*`/`--edge-*`
        // CSS custom properties in `index.css`'s `:root`, same pattern as
        // `actionbutton` above. NEVER attach a Tailwind opacity modifier
        // (`/50` etc.) to any of these — Tailwind can't alpha-blend an
        // opacity modifier onto a `var()`-based color at build time; it
        // silently generates no CSS at all (found and fixed once already
        // this project, `bg-actionbutton/50` in `BottomTabBar.tsx` — see
        // that file's own doc). Every place the spec itself needs a
        // pressed-state shade uses a separate literal color instead of an
        // alpha of the base token (e.g. `.shelf:active { background:
        // #262d36 }`), which is exactly how the recipes below are ported.
        vault: {
          frame: 'var(--vault-frame)',
          chrome: 'var(--vault-chrome)',
          wall: 'var(--vault-wall)',
          rail: 'var(--vault-rail)',
          shelf: 'var(--vault-shelf)',
          fg: 'var(--vault-fg)',
          muted: 'var(--vault-muted)',
          dim: 'var(--vault-dim)',
          accent: 'var(--vault-accent)',
          ok: 'var(--vault-ok)',
          warn: 'var(--vault-warn)',
        },
        edge: {
          lip: 'var(--edge-lip)', // already carries its own alpha (rgba) — safe to use directly, no modifier needed
          front: 'var(--edge-front)',
        },
        hairline: 'var(--hairline)',
      },
      borderRadius: {
        // Vault geometry (`docs/vault-visual-language-spec.md` §2) — `rounded-vault-inner`
        // (9px, pegs/search box), `rounded-vault-frame` (16px, the bezel —
        // not used until the frame wrapper itself is built). Shelves use
        // `rounded-none` (Tailwind's own default utility) rather than a
        // named `vault-shelf` token — the spec's own `--r-shelf: 0` is a
        // literal zero, not a value worth a named utility.
        'vault-inner': 'var(--vault-r-inner)',
        'vault-frame': 'var(--vault-r-frame)',
      },
      transitionTimingFunction: {
        // `ease-vault-snap`/`ease-vault-detent` — the spec's own two easings
        // (§2, §5). `--vault-detent`'s slight overshoot is reserved for the
        // tab slug — never press feedback (always `snap`) or the detail box
        // (its own `arrive`/`depart` pair).
        'vault-snap': 'var(--vault-snap)',
        'vault-detent': 'var(--vault-detent)',
        'vault-arrive': 'var(--vault-arrive)',
        'vault-depart': 'var(--vault-depart)',
      },
      transitionDuration: {
        // `duration-vault-press`/`-ui`/`-box` (§5's table). The doors set
        // their own durations inline (`VaultDoors.tsx`), so there's no
        // `-door` utility.
        'vault-press': '70ms',
        'vault-ui': '150ms',
        'vault-box': '320ms', // must match `--vault-t-box` in index.css
        'vault-box-close': '240ms', // must match `--vault-t-box-close`
      },
      boxShadow: {
        // The spec's own shadow shape (§3.4): "large blur, large negative
        // spread, opacity .75-.9" — named so call sites read as intent
        // ("this is a shelf's separation shadow") rather than a bespoke
        // arbitrary value at every use site.
        'vault-shelf': '0 4px 8px -5px rgba(0,0,0,.9)',
        'vault-peg': '0 4px 8px -4px rgba(0,0,0,.75)',
        'vault-peg-pressed': '0 1px 3px -1px rgba(0,0,0,.75)',
      },
      // Every named size bumped +2px over Tailwind's own defaults (line-height
      // bumped along with it, same ratio) — the whole app read as too small
      // at the stock scale. Only the tiers actually used in this app
      // (xs/sm/base/lg/xl/2xl/3xl) are listed; `extend` merges these over
      // the defaults rather than replacing the scale, so anything above 3xl
      // — none of it in use today — still falls back to Tailwind's own
      // values instead of silently going unstyled.
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.125rem' }], // 14px / 18px (was 12/16)
        sm: ['1rem', { lineHeight: '1.375rem' }], // 16px / 22px (was 14/20)
        base: ['1.125rem', { lineHeight: '1.625rem' }], // 18px / 26px (was 16/24)
        lg: ['1.25rem', { lineHeight: '1.875rem' }], // 20px / 30px (was 18/28)
        xl: ['1.375rem', { lineHeight: '1.875rem' }], // 22px / 30px (was 20/28)
        '2xl': ['1.625rem', { lineHeight: '2.125rem' }], // 26px / 34px (was 24/32)
        '3xl': ['2rem', { lineHeight: '2.375rem' }], // 32px / 38px (was 30/36)
      },
      fontFamily: {
        // Inter for UI text, JetBrains Mono for anything sensitive or
        // structured (masked/revealed passwords, license keys, SSH
        // fingerprints, 2FA codes, WiFi passwords) — per the design system's
        // typography rules. Loaded via @import in index.css; system stacks
        // stay as the fallback chain.
        sans: ['Inter', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Cascadia Mono', 'Consolas', 'Roboto Mono', 'ui-monospace', 'monospace'],
        // The unlock screen's "Vault" title only — kept out of `sans` on
        // purpose so nothing else in the app picks it up by accident.
        // Backed by a CSS custom property (index.css `:root`) so the
        // typeface can be swapped in one place later.
        title: ['var(--font-title)', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
        // The Android home header's small "Vault" wordmark only — see
        // `--font-title-nav` in index.css. Distinct from `title` above
        // (a different typeface, a different, smaller context).
        'title-nav': ['var(--font-title-nav)', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
