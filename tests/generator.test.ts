import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  CHAR_CLASSES,
  DEFAULT_OPTIONS,
  MAX_LENGTH,
  MIN_LENGTH,
  canDisable,
  clampLength,
  estimateStrength,
  generatePassword,
} from '@/crypto/generator';
import { randomInt, shuffleInPlace } from '@/crypto/random';

const CLASS_PATTERNS: Record<string, RegExp> = {
  uppercase: /[A-Z]/,
  lowercase: /[a-z]/,
  numbers: /[0-9]/,
  symbols: /[!#$%&()*+,\-.:;<=>?@[\]^_{|}~]/,
};

describe('password generator', () => {
  it('honours the requested length', () => {
    for (const length of [MIN_LENGTH, 12, 20, 41, MAX_LENGTH]) {
      expect(generatePassword({ ...DEFAULT_OPTIONS, length })).toHaveLength(length);
    }
  });

  it('clamps lengths outside the supported range', () => {
    expect(clampLength(1)).toBe(MIN_LENGTH);
    expect(clampLength(9999)).toBe(MAX_LENGTH);
    expect(clampLength(Number.NaN)).toBe(20);
  });

  it('includes at least one character from every enabled class', () => {
    // A single sample can pass by luck; a complexity guarantee has to hold
    // every time or it is not a guarantee.
    for (let i = 0; i < 200; i++) {
      const password = generatePassword({ ...DEFAULT_OPTIONS, length: MIN_LENGTH });
      for (const name of CHAR_CLASSES) {
        expect(CLASS_PATTERNS[name]!.test(password)).toBe(true);
      }
    }
  });

  it('uses only the enabled classes', () => {
    for (let i = 0; i < 100; i++) {
      const password = generatePassword({
        length: 24,
        uppercase: false,
        lowercase: true,
        numbers: true,
        symbols: false,
      });
      expect(password).toMatch(/^[a-z0-9]+$/);
    }
  });

  it('refuses to generate with no class enabled', () => {
    expect(() =>
      generatePassword({
        length: 20,
        uppercase: false,
        lowercase: false,
        numbers: false,
        symbols: false,
      }),
    ).toThrow();
  });

  it('reports when a class is the last one standing', () => {
    const onlyLower = {
      length: 20,
      uppercase: false,
      lowercase: true,
      numbers: false,
      symbols: false,
    };
    expect(canDisable(onlyLower, 'lowercase')).toBe(false);
    expect(canDisable(DEFAULT_OPTIONS, 'lowercase')).toBe(true);
  });

  it('does not park the guaranteed characters in fixed positions', () => {
    // If the one guaranteed digit always landed at a fixed index, the first
    // characters would be perfectly predictable by class.
    const firstCharClasses = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const password = generatePassword({ ...DEFAULT_OPTIONS, length: 12 });
      for (const [name, pattern] of Object.entries(CLASS_PATTERNS)) {
        if (pattern.test(password[0] as string)) firstCharClasses.add(name);
      }
    }
    expect(firstCharClasses.size).toBeGreaterThan(1);
  });

  it('produces a different password each time', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      seen.add(generatePassword(DEFAULT_OPTIONS));
    }
    expect(seen.size).toBe(500);
  });
});

describe('random', () => {
  it('covers the whole range without bias', () => {
    // Rejection sampling should give a roughly flat distribution. A modulo
    // implementation over a bound that does not divide 2^32 skews low; 100_000
    // samples over 7 buckets makes that visible well outside noise.
    const bound = 7;
    const counts = new Array(bound).fill(0);
    const samples = 100_000;

    for (let i = 0; i < samples; i++) counts[randomInt(bound)]++;

    const expected = samples / bound;
    for (const count of counts) {
      expect(Math.abs(count - expected) / expected).toBeLessThan(0.05);
    }
  });

  it('rejects a non-positive bound rather than returning something wrong', () => {
    expect(() => randomInt(0)).toThrow();
    expect(() => randomInt(-1)).toThrow();
    expect(() => randomInt(1.5)).toThrow();
  });

  it('shuffles without dropping or duplicating elements', () => {
    const original = Array.from({ length: 50 }, (_, i) => i);
    const shuffled = shuffleInPlace([...original]);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(original);
  });
});

describe('strength estimate', () => {
  it('rates obvious passwords as weak', () => {
    for (const weak of ['password', 'password1', '12345678', 'aaaaaaaa', 'qwerty123']) {
      expect(estimateStrength(weak).score).toBeLessThanOrEqual(1);
    }
  });

  it('rates a generated password as strong', () => {
    for (let i = 0; i < 20; i++) {
      expect(estimateStrength(generatePassword(DEFAULT_OPTIONS)).score).toBe(4);
    }
  });

  it('rewards length over character-class gymnastics', () => {
    const longPassphrase = estimateStrength('correct horse battery staple anvil');
    const shortAndCryptic = estimateStrength('P@ss1!');
    expect(longPassphrase.score).toBeGreaterThan(shortAndCryptic.score);
  });
});

describe('no non-cryptographic randomness anywhere in src/', () => {
  it('never calls Math.random', () => {
    // The ESLint rule catches this at lint time; this catches it if the rule is
    // ever removed or a file is exempted. In a password manager the difference
    // between the two RNGs is the whole product.
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(name)) {
          // Comments are stripped first: several modules mention Math.random
          // in prose explaining why they do not use it.
          const code = readFileSync(path, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*$/gm, '');
          if (/Math\s*\.\s*random/.test(code)) {
            offenders.push(path);
          }
        }
      }
    };

    walk(join(import.meta.dirname ?? __dirname, '..', 'src'));
    expect(offenders).toEqual([]);
  });
});
