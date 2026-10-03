import { useEffect, useState } from 'react';

import { useApp } from '../../app/store';
import { describeHotkey } from '../hotkeyLabel';
import { TipScreen, TipSequence, nextTipSequence } from '../tips/tipSets';

export interface ActiveTip {
  text: string;
  index: number;
  count: number;
  next: () => void;
  skip: () => void;
}

/**
 * The first-run tip sequence for one screen (`docs/ONBOARDING-TIPS-DESIGN.md`).
 *
 * `ready` is the screen's own "nothing is animating, the user can read
 * this" gate. The sequence is picked once, the first time `ready` is true,
 * and then frozen until Done/Skip — so a mid-sequence change (an entry
 * added, Drive connected) never rewrites the tip being read. Unmounting
 * (locking, leaving the screen) drops it unmarked, so it starts again from
 * tip 1 next time; only Done or Skip marks it seen.
 */
export function useTipSequence(screen: TipScreen, ready: boolean): ActiveTip | null {
  const {
    platform,
    settings,
    entries,
    justOnboarded,
    biometricAvailable,
    biometricEnrolled,
    driveConfigured,
    driveConnected,
    tipsFinishedThisSession,
    markTipsSeen,
  } = useApp();
  const [sequence, setSequence] = useState<TipSequence | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!ready || sequence) return;
    const next = nextTipSequence(screen, {
      isAndroid: platform.isAndroid,
      tipsSeen: settings.tipsSeen,
      finishedThisSession: tipsFinishedThisSession,
      entryCount: entries.length,
      // Mirrors `EmptyState`'s own condition for showing `BiometricOffer`.
      welcomeOfferShowing:
        justOnboarded && entries.length === 0 && biometricAvailable && !biometricEnrolled,
      driveConfigured,
      driveConnected,
      hotkeyLabel: describeHotkey(settings.manualFillHotkey),
    });
    if (next) {
      setSequence(next);
      setIndex(0);
    }
  }, [
    ready,
    sequence,
    screen,
    platform.isAndroid,
    settings.tipsSeen,
    settings.manualFillHotkey,
    tipsFinishedThisSession,
    entries.length,
    justOnboarded,
    biometricAvailable,
    biometricEnrolled,
    driveConfigured,
    driveConnected,
  ]);

  const text = sequence?.tips[index];
  if (!ready || !sequence || text === undefined) return null;

  const finish = () => {
    setSequence(null);
    void markTipsSeen(sequence.id, sequence.screen);
  };

  return {
    text,
    index,
    count: sequence.tips.length,
    next: () => {
      if (index + 1 < sequence.tips.length) setIndex(index + 1);
      else finish();
    },
    skip: finish,
  };
}
