/**
 * The first-run tips — `docs/ONBOARDING-TIPS-DESIGN.md`. Read that before
 * changing any text or rule here.
 *
 * Pure on purpose (no React, no platform calls), so every rule below is
 * unit-tested under Node in `tests/tips.test.ts`, including a word-count
 * guard over every sentence.
 */

/** Which screen a sequence belongs to. Home and Upcoming share the vault
 * frame's tip slot; Settings has its own. */
export type TipScreen = 'home' | 'upcoming' | 'settings';

export const MAX_TIPS_PER_SEQUENCE = 3;
/** Hard cap per tip sentence. Aim for 8. */
export const MAX_TIP_WORDS = 12;

export interface TipContext {
  isAndroid: boolean;
  /** Persisted, device-local (`Settings.tipsSeen`). */
  tipsSeen: readonly string[];
  /** Screens where a sequence already finished or was skipped in this
   * unlock session — nothing else shows there until the next unlock, so
   * two sequences never run back to back. */
  finishedThisSession: readonly TipScreen[];
  entryCount: number;
  /** The post-creation biometric offer (`EntryList.tsx`'s `EmptyState`) is
   * on screen. Tips wait for it so the two never stack. */
  welcomeOfferShowing: boolean;
  driveConfigured: boolean;
  driveConnected: boolean;
  /** The live manual-fill hotkey, already formatted ("Ctrl+Alt+H"). */
  hotkeyLabel: string;
}

export interface TipSequence {
  /** Versioned (`home.v1`): bump it only when a sequence's meaning changes,
   * so it shows once more; a wording tweak keeps the id. */
  id: string;
  screen: TipScreen;
  tips: string[];
}

interface TipSetDef {
  id: string;
  screen: TipScreen;
  eligible: (ctx: TipContext) => boolean;
  tips: (ctx: TipContext) => string[];
}

/** In priority order — the first eligible, unseen set for a screen wins. */
export const TIP_SETS: readonly TipSetDef[] = [
  {
    id: 'home.v1',
    screen: 'home',
    eligible: (ctx) => !ctx.welcomeOfferShowing,
    tips: (ctx) =>
      ctx.isAndroid
        ? [
            'Tap + to add a password.',
            'Tap the copy button to copy a password.',
            "The vault locks itself when you're away.",
          ]
        : [
            'Click + to add a password.',
            'Type to search. Enter copies the password.',
            "The vault locks itself when you're away.",
          ],
  },
  {
    // Same screen as `home.v1`, so the back-to-back rule already holds it
    // to a later unlock session than the one `home.v1` finished in.
    id: 'fill.v1',
    screen: 'home',
    eligible: (ctx) => ctx.tipsSeen.includes('home.v1') && ctx.entryCount > 0,
    tips: (ctx) =>
      ctx.isAndroid
        ? [
            'Vault has its own keyboard for filling apps.',
            'Turn it on in Settings.',
            'Switch to it with the globe key.',
          ]
        : [
            `Press ${ctx.hotkeyLabel} in any app to fill.`,
            'Pick an entry, then a field.',
            'Change the keys in Settings.',
          ],
  },
  {
    id: 'settings.v1',
    screen: 'settings',
    eligible: () => true,
    tips: (ctx) => {
      const tips = ['Set how fast the vault locks here.'];
      if (ctx.driveConfigured) {
        tips.push(
          ctx.driveConnected
            ? 'Drive only stores the locked file.'
            : 'Connect Google Drive to sync your devices.',
        );
      }
      tips.push('Export a backup copy now and then.');
      return tips;
    },
  },
  {
    id: 'upcoming.v1',
    screen: 'upcoming',
    eligible: () => true,
    tips: () => [
      'Dates you choose to track show up here.',
      'Turn on tracking on a date field when editing.',
    ],
  },
];

/** The sequence to show on `screen` right now, or `null`. */
export function nextTipSequence(screen: TipScreen, ctx: TipContext): TipSequence | null {
  if (ctx.finishedThisSession.includes(screen)) return null;
  for (const def of TIP_SETS) {
    if (def.screen !== screen || ctx.tipsSeen.includes(def.id) || !def.eligible(ctx)) continue;
    const tips = def.tips(ctx).slice(0, MAX_TIPS_PER_SEQUENCE);
    if (tips.length === 0) continue;
    return { id: def.id, screen, tips };
  }
  return null;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
