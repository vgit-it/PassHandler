import { describe, expect, it } from 'vitest';

import {
  DOORS_PART_START_MS,
  HEADER_ENTER_DELAY_MS,
  REVEAL_END_MS,
  REVEAL_LIGHT_START_MS,
  REVEAL_PANEL_START_MS,
  REVEAL_ROW_START_MS,
  REVEAL_SEARCH_START_MS,
  UNLOCK_SEQUENCE_MS,
} from '../src/ui/lockTransitionTiming';

// The unlock reveal (docs/vault-visual-language-spec.md §5.1) must fill time
// the unlock sequence already takes, never extend it.
describe('unlock reveal timing', () => {
  it('lands before the unlock sequence ends', () => {
    expect(REVEAL_END_MS).toBeLessThanOrEqual(UNLOCK_SEQUENCE_MS);
  });

  it('starts no earlier than the doors begin to part', () => {
    for (const start of [
      REVEAL_LIGHT_START_MS,
      REVEAL_SEARCH_START_MS,
      REVEAL_ROW_START_MS,
      REVEAL_PANEL_START_MS,
    ]) {
      expect(start).toBeGreaterThanOrEqual(DOORS_PART_START_MS);
    }
  });

  it('settles the contents before the header floats in over them', () => {
    expect(REVEAL_ROW_START_MS).toBeLessThan(HEADER_ENTER_DELAY_MS);
  });
});
