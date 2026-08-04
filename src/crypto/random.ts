/**
 * The only source of randomness in the app.
 *
 * `Math.random` is banned repo-wide by an ESLint rule; this module is what that
 * rule points at. `crypto.getRandomValues` is available in the system webview
 * on both Windows and Android and in Node, so there is no polyfill anywhere in
 * the dependency graph.
 */

/**
 * A uniformly distributed integer in `[0, bound)`.
 *
 * Rejection sampling, not modulo. `getRandomValues() % bound` is biased towards
 * the low end whenever `bound` does not divide 2^32, which for a password
 * generator means some characters are quietly more likely than others.
 */
export function randomInt(bound: number): number {
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new Error('bound must be a positive integer');
  }
  if (bound === 1) return 0;

  // Largest multiple of `bound` that fits in a uint32. Values at or above it
  // are discarded so every accepted value maps to exactly one outcome.
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const buf = new Uint32Array(1);

  for (;;) {
    crypto.getRandomValues(buf);
    const value = buf[0] as number;
    if (value < limit) {
      return value % bound;
    }
  }
}

/** A uniformly chosen element of `items`. */
export function randomChoice<T>(items: readonly T[]): T {
  if (items.length === 0) {
    throw new Error('cannot choose from an empty list');
  }
  return items[randomInt(items.length)] as T;
}

/**
 * Fisher-Yates, so that the "guarantee one character from each class" step does
 * not leave those characters sitting in predictable positions.
 */
export function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const a = items[i] as T;
    const b = items[j] as T;
    items[i] = b;
    items[j] = a;
  }
  return items;
}

/** Random bytes, for identifiers that must not be guessable. */
export function randomBytes(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  crypto.getRandomValues(buf);
  return buf;
}
