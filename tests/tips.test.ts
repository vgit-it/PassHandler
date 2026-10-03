import { describe, expect, it } from 'vitest';

import {
  MAX_TIPS_PER_SEQUENCE,
  MAX_TIP_WORDS,
  TIP_SETS,
  TipContext,
  countWords,
  nextTipSequence,
} from '../src/ui/tips/tipSets';

// docs/ONBOARDING-TIPS-DESIGN.md
function ctx(overrides: Partial<TipContext> = {}): TipContext {
  return {
    isAndroid: false,
    tipsSeen: [],
    finishedThisSession: [],
    entryCount: 0,
    welcomeOfferShowing: false,
    driveConfigured: true,
    driveConnected: false,
    hotkeyLabel: 'Ctrl+Alt+H',
    ...overrides,
  };
}

/** Every context shape that changes any tip's text. */
function allContexts(): TipContext[] {
  const out: TipContext[] = [];
  for (const isAndroid of [false, true])
    for (const driveConfigured of [false, true])
      for (const driveConnected of [false, true])
        out.push(ctx({ isAndroid, driveConfigured, driveConnected, hotkeyLabel: 'Ctrl+Shift+Alt+F12' }));
  return out;
}

describe('tip copy', () => {
  it('never has more than three tips in a sequence', () => {
    for (const c of allContexts())
      for (const def of TIP_SETS) {
        expect(def.tips(c).length).toBeGreaterThan(0);
        expect(def.tips(c).length).toBeLessThanOrEqual(MAX_TIPS_PER_SEQUENCE);
      }
  });

  it('keeps every tip to one short sentence', () => {
    for (const c of allContexts())
      for (const def of TIP_SETS)
        for (const tip of def.tips(c)) {
          expect(countWords(tip), tip).toBeLessThanOrEqual(MAX_TIP_WORDS);
        }
  });

  it('has unique, versioned ids', () => {
    const ids = TIP_SETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+\.v\d+$/);
  });

  it('names the live hotkey on Windows', () => {
    const seq = nextTipSequence('home', ctx({ tipsSeen: ['home.v1'], entryCount: 1, hotkeyLabel: 'Ctrl+Alt+K' }));
    expect(seq?.tips[0]).toContain('Ctrl+Alt+K');
  });
});

describe('nextTipSequence', () => {
  it('shows home first', () => {
    expect(nextTipSequence('home', ctx())?.id).toBe('home.v1');
  });

  it('waits for the post-creation biometric offer', () => {
    expect(nextTipSequence('home', ctx({ welcomeOfferShowing: true }))).toBeNull();
  });

  it('never runs two sequences back to back on one screen', () => {
    const c = ctx({ tipsSeen: ['home.v1'], entryCount: 3, finishedThisSession: ['home'] });
    expect(nextTipSequence('home', c)).toBeNull();
    // ...but another screen is fine in the same session.
    expect(nextTipSequence('settings', c)?.id).toBe('settings.v1');
  });

  it('shows fill in a later session, only once there is an entry', () => {
    expect(nextTipSequence('home', ctx({ tipsSeen: ['home.v1'], entryCount: 0 }))).toBeNull();
    expect(nextTipSequence('home', ctx({ tipsSeen: ['home.v1'], entryCount: 1 }))?.id).toBe('fill.v1');
  });

  it('never repeats a seen sequence', () => {
    const seen = TIP_SETS.map((d) => d.id);
    for (const screen of ['home', 'upcoming', 'settings'] as const)
      expect(nextTipSequence(screen, ctx({ tipsSeen: seen, entryCount: 5 }))).toBeNull();
  });

  it('fits the Drive tip to Drive state', () => {
    expect(nextTipSequence('settings', ctx({ driveConfigured: false }))?.tips).toHaveLength(2);
    expect(nextTipSequence('settings', ctx({ driveConnected: false }))?.tips[1]).toMatch(/Connect/);
    expect(nextTipSequence('settings', ctx({ driveConnected: true }))?.tips[1]).toMatch(/locked file/);
  });

  it('uses platform wording', () => {
    expect(nextTipSequence('home', ctx({ isAndroid: true }))?.tips[0]).toMatch(/^Tap/);
    expect(nextTipSequence('home', ctx({ isAndroid: false }))?.tips[0]).toMatch(/^Click/);
  });
});
