/**
 * The `--vault-*` motion tokens in `index.css`, read at run time for Web
 * Animations API code (`ShelfOriginPanel.tsx`, `useUnlockReveal.ts`), which
 * can't reference CSS variables in its timing options directly. Reading
 * them here keeps `index.css` the single source of truth for the curves and
 * box durations that CSS transitions elsewhere (the dim scrim) also use.
 * The fallbacks only matter where no stylesheet is loaded.
 */
export interface VaultMotion {
  /** `--vault-t-box`: the detail box opening. */
  boxOpenMs: number;
  /** `--vault-t-box-close`: the detail box closing. */
  boxCloseMs: number;
  /** `--vault-arrive`: decelerate into place. */
  arrive: string;
  /** `--vault-depart`: ease in and out, settling at the far end. */
  depart: string;
}

export function readVaultMotion(): VaultMotion {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const ms = (name: string, fallback: number) => {
    const n = parseFloat(read(name));
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    boxOpenMs: ms('--vault-t-box', 320),
    boxCloseMs: ms('--vault-t-box-close', 240),
    arrive: read('--vault-arrive') || 'cubic-bezier(0.25, 0.8, 0.25, 1)',
    depart: read('--vault-depart') || 'cubic-bezier(0.4, 0, 0.2, 1)',
  };
}
