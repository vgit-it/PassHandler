import { useEffect, useRef, useState } from 'react';

import { useApp } from '../../app/store';
import { EyeIcon, EyeOffIcon, FingerprintIcon, LockIcon } from '../components/icons';

/**
 * The lock screen.
 *
 * The master password is never held in React state. The input is uncontrolled,
 * read once from the DOM at submit time, and the field is blanked immediately
 * afterwards — so the one secret that unlocks everything else does not sit in a
 * component's state, in a render trace, or in a DevTools snapshot.
 */
export function UnlockScreen() {
  const { unlock, unlockWithBiometrics, unlockError, busy, biometricEnrolled, platform } =
    useApp();

  const inputRef = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [biometricTried, setBiometricTried] = useState(false);

  // On Android biometrics are the default path, so the prompt comes up without
  // the user having to ask. On Windows the password field is focused instead —
  // typing is usually faster than reaching for the fingerprint reader.
  useEffect(() => {
    if (!biometricEnrolled || biometricTried) {
      inputRef.current?.focus();
      return;
    }
    if (!platform.isAndroid) {
      inputRef.current?.focus();
      return;
    }

    setBiometricTried(true);
    void unlockWithBiometrics().then((ok) => {
      if (!ok) inputRef.current?.focus();
    });
  }, [biometricEnrolled, biometricTried, platform.isAndroid, unlockWithBiometrics]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const input = inputRef.current;
    if (!input) return;

    const password = input.value;
    // Blanked before awaiting, so it is out of the DOM while key derivation
    // runs rather than after.
    input.value = '';
    if (password === '') return;

    await unlock(password);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-accent/10 p-4 text-accent">
            <LockIcon className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-semibold text-slate-100">Vault locked</h1>
          <p className="text-sm text-slate-400">Enter your master password to continue.</p>
        </div>

        <form onSubmit={submit}>
          <label className="label" htmlFor="master-password">
            Master password
          </label>
          <div className="flex gap-2">
            <input
              id="master-password"
              ref={inputRef}
              type={revealed ? 'text' : 'password'}
              className="field"
              autoComplete="current-password"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              disabled={busy}
            />
            <button
              type="button"
              className="btn-secondary px-2.5"
              onClick={() => setRevealed((r) => !r)}
              aria-label={revealed ? 'Hide password' : 'Show password'}
            >
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>

          {unlockError && (
            <p role="alert" className="mt-3 text-sm text-bad">
              {unlockError}
            </p>
          )}

          <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>

          {biometricEnrolled && (
            <button
              type="button"
              className="btn-secondary mt-2 w-full"
              disabled={busy}
              onClick={() => void unlockWithBiometrics()}
            >
              <FingerprintIcon />
              {platform.isAndroid ? 'Use biometrics' : 'Use Windows Hello'}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
