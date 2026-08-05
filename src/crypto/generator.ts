import { randomChoice, randomInt, shuffleInPlace } from './random';

export interface GeneratorOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

export const MIN_LENGTH = 8;
export const MAX_LENGTH = 64;
export const DEFAULT_LENGTH = 20;

export const DEFAULT_OPTIONS: GeneratorOptions = {
  length: DEFAULT_LENGTH,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
};

const CHARSETS = {
  uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lowercase: 'abcdefghijklmnopqrstuvwxyz',
  numbers: '0123456789',
  // Punctuation that survives a round-trip through the average web form. No
  // quotes, backslashes or spaces: they get mangled by shell paste, by CSV
  // export, and by more login forms than they should.
  symbols: '!#$%&()*+,-.:;<=>?@[]^_{|}~',
} as const;

export type CharClass = keyof typeof CHARSETS;

export const CHAR_CLASSES: readonly CharClass[] = [
  'uppercase',
  'lowercase',
  'numbers',
  'symbols',
];

export function enabledClasses(options: GeneratorOptions): CharClass[] {
  return CHAR_CLASSES.filter((name) => options[name]);
}

/**
 * Whether turning `candidate` off would leave nothing to generate from.
 *
 * The UI uses this to disable the last remaining toggle rather than letting the
 * user reach a state where the generate button silently does nothing.
 */
export function canDisable(options: GeneratorOptions, candidate: CharClass): boolean {
  return enabledClasses(options).some((name) => name !== candidate);
}

export function clampLength(length: number): number {
  if (!Number.isFinite(length)) return DEFAULT_LENGTH;
  return Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.round(length)));
}

/**
 * Generate a password.
 *
 * Every enabled character class is guaranteed to appear at least once —
 * otherwise a 20-character password can come out with no digit and fail a site's
 * complexity rule, which trains people to give up and pick their own. The
 * guaranteed characters are then shuffled in, so they do not sit in a
 * predictable prefix.
 */
export function generatePassword(options: GeneratorOptions): string {
  const classes = enabledClasses(options);
  if (classes.length === 0) {
    throw new Error('at least one character class must be enabled');
  }

  const length = clampLength(options.length);
  const pool = classes.map((name) => CHARSETS[name]).join('');

  const chars: string[] = classes
    .slice(0, length)
    .map((name) => randomChoice([...CHARSETS[name]]));

  while (chars.length < length) {
    chars.push(pool[randomInt(pool.length)] as string);
  }

  return shuffleInPlace(chars).join('');
}

/**
 * A rough strength signal for the master password field.
 *
 * Deliberately a heuristic, not a promise. It exists to stop someone choosing
 * "password1" for the one secret that cannot be recovered, and the UI pairs it
 * with that warning rather than presenting it as a security guarantee.
 */
export interface StrengthEstimate {
  /** 0 (hopeless) to 4 (strong). */
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

const COMMON_PATTERNS = [
  /^\d+$/,
  /^[a-z]+$/i,
  /(.)\1{3,}/,
  /^(?:password|letmein|qwerty|welcome|admin|iloveyou|monkey|dragon)/i,
  /(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i,
];

export function estimateStrength(password: string): StrengthEstimate {
  if (password.length === 0) {
    return { score: 0, label: 'Empty' };
  }

  const classCount = CHAR_CLASSES.filter((name) =>
    [...password].some((ch) => CHARSETS[name].includes(ch)),
  ).length;
  // Characters outside our own sets — accented letters, other scripts — still
  // add entropy and should not be punished.
  const hasOther = [...password].some(
    (ch) => !CHAR_CLASSES.some((name) => CHARSETS[name].includes(ch)),
  );

  const poolSize =
    CHAR_CLASSES.filter((name) => [...password].some((ch) => CHARSETS[name].includes(ch))).reduce(
      (total, name) => total + CHARSETS[name].length,
      0,
    ) + (hasOther ? 20 : 0);

  const bits = poolSize > 1 ? password.length * Math.log2(poolSize) : 0;
  const penalised = COMMON_PATTERNS.some((pattern) => pattern.test(password));

  let score: StrengthEstimate['score'];
  if (penalised && bits < 90) score = password.length >= 16 ? 1 : 0;
  else if (bits < 40) score = 0;
  else if (bits < 60) score = 1;
  else if (bits < 80) score = 2;
  else if (bits < 110) score = 3;
  else score = 4;

  if (classCount + (hasOther ? 1 : 0) === 1 && score > 1) {
    score = (score - 1) as StrengthEstimate['score'];
  }

  const labels = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const;
  return { score, label: labels[score] };
}
