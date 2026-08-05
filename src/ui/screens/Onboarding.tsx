import { useRef, useState } from 'react';

import { useApp } from '../../app/store';
import { StrengthBar } from '../components/PasswordField';
import { LockIcon } from '../components/icons';

type Step = 'choose' | 'create' | 'connect-existing' | 'adopt';

/**
 * First run.
 *
 * Two routes: create a vault here, or connect to one that already exists on
 * Drive. The second is what the second and third devices do.
 */
export function OnboardingScreen() {
  const [step, setStep] = useState<Step>('choose');

  return (
    <div className="flex h-full flex-col overflow-y-auto px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        {step === 'choose' && <Choose onPick={setStep} />}
        {step === 'create' && <CreateVault onBack={() => setStep('choose')} />}
        {step === 'connect-existing' && (
          <ConnectExisting onBack={() => setStep('choose')} onConnected={() => setStep('adopt')} />
        )}
        {step === 'adopt' && <AdoptExisting onBack={() => setStep('choose')} />}
      </div>
    </div>
  );
}

function Choose({ onPick }: { onPick: (step: Step) => void }) {
  const { driveConfigured } = useApp();

  return (
    <>
      <Header
        title="Pass Handler"
        subtitle="A KeePass-compatible vault that stays on your devices."
      />

      <button className="btn-primary w-full" onClick={() => onPick('create')}>
        Create a new vault
      </button>

      <button
        className="btn-secondary mt-2 w-full"
        disabled={!driveConfigured}
        onClick={() => onPick('connect-existing')}
      >
        Connect to an existing Drive vault
      </button>

      {!driveConfigured && (
        <p className="mt-3 text-center text-xs text-slate-500">
          Google Drive is not configured in this build, so only a local vault can be
          created. See docs/google-oauth-setup.md.
        </p>
      )}
    </>
  );
}

function CreateVault({ onBack }: { onBack: () => void }) {
  const { createVault, driveConfigured, busy } = useApp();

  // Both password fields are uncontrolled so the master password never lands in
  // React state. Only the strength meter sees it, via a separate value that is
  // cleared on submit.
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState('');
  const [connect, setConnect] = useState(driveConfigured);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const password = passwordRef.current?.value ?? '';
    const confirm = confirmRef.current?.value ?? '';

    if (password.length < 8) {
      setError('Use at least 8 characters. Longer is better than more complicated.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    if (passwordRef.current) passwordRef.current.value = '';
    if (confirmRef.current) confirmRef.current.value = '';
    setPreview('');
    setError(null);

    await createVault(password, connect && driveConfigured);
  };

  return (
    <form onSubmit={submit}>
      <Header title="Choose a master password" subtitle="This is the only key to your vault." />

      <div
        role="note"
        className="mb-5 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn"
      >
        <strong className="font-semibold">There is no recovery.</strong> Nobody — not us,
        not Google — can reset this password or read your vault without it. If you forget
        it, the passwords inside are gone. Write it down and keep it somewhere safe.
      </div>

      <label className="label" htmlFor="new-password">
        Master password
      </label>
      <input
        id="new-password"
        ref={passwordRef}
        type="password"
        className="field"
        autoComplete="new-password"
        spellCheck={false}
        onChange={(e) => setPreview(e.target.value)}
      />
      {preview !== '' && <StrengthBar password={preview} />}

      <label className="label mt-4" htmlFor="confirm-password">
        Confirm
      </label>
      <input
        id="confirm-password"
        ref={confirmRef}
        type="password"
        className="field"
        autoComplete="new-password"
        spellCheck={false}
      />

      {driveConfigured && (
        <label className="mt-5 flex cursor-pointer items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            className="mt-0.5 accent-accent"
            checked={connect}
            onChange={(e) => setConnect(e.target.checked)}
          />
          <span>
            Sync with Google Drive
            <span className="mt-0.5 block text-xs text-slate-500">
              Only the encrypted vault file is uploaded, into a private folder only this
              app can see. Google never receives your password or anything readable. You
              can turn this on later instead.
            </span>
          </span>
        </label>
      )}

      {connect && driveConfigured && <UnverifiedAppNotice />}

      {error && (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary mt-6 w-full" disabled={busy}>
        {busy ? 'Creating…' : 'Create vault'}
      </button>
      <button type="button" className="btn-ghost mt-2 w-full" onClick={onBack} disabled={busy}>
        Back
      </button>
    </form>
  );
}

function ConnectExisting({
  onBack,
  onConnected,
}: {
  onBack: () => void;
  onConnected: () => void;
}) {
  const { connectDrive, syncNow, busy } = useApp();
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    try {
      await connectDrive();
      await syncNow();
      onConnected();
    } catch {
      setError('Could not connect to Google Drive. Check your connection and try again.');
    }
  };

  return (
    <>
      <Header
        title="Connect to Google Drive"
        subtitle="Sign in with the account holding your vault."
      />
      <UnverifiedAppNotice />

      {error && (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      )}

      <button className="btn-primary mt-5 w-full" onClick={() => void connect()} disabled={busy}>
        {busy ? 'Waiting for Google…' : 'Sign in with Google'}
      </button>
      <button className="btn-ghost mt-2 w-full" onClick={onBack} disabled={busy}>
        Back
      </button>
    </>
  );
}

function AdoptExisting({ onBack }: { onBack: () => void }) {
  const { adoptRemoteVault, unlockError, busy } = useApp();
  const passwordRef = useRef<HTMLInputElement>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const password = passwordRef.current?.value ?? '';
    if (passwordRef.current) passwordRef.current.value = '';
    if (password === '') return;

    await adoptRemoteVault(password).catch(() => {
      // The error is already rendered from `unlockError`; nothing further to do
      // and nothing worth logging.
    });
  };

  return (
    <form onSubmit={submit}>
      <Header
        title="Unlock the downloaded vault"
        subtitle="Enter the master password you used on your other device."
      />

      <label className="label" htmlFor="adopt-password">
        Master password
      </label>
      <input
        id="adopt-password"
        ref={passwordRef}
        type="password"
        className="field"
        autoComplete="current-password"
        spellCheck={false}
      />

      {unlockError && (
        <p role="alert" className="mt-3 text-sm text-bad">
          {unlockError}
        </p>
      )}

      <button type="submit" className="btn-primary mt-5 w-full" disabled={busy}>
        {busy ? 'Unlocking…' : 'Unlock'}
      </button>
      <button type="button" className="btn-ghost mt-2 w-full" onClick={onBack} disabled={busy}>
        Back
      </button>
    </form>
  );
}

/**
 * Google shows an "unverified app" interstitial for any OAuth client that has
 * not been through review. Ours never will be — the `drive.appdata` scope is
 * classified as non-sensitive and needs none. Saying so up front stops it
 * reading as a failure.
 */
function UnverifiedAppNotice() {
  return (
    <div className="mt-4 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-xs text-slate-400">
      <strong className="font-semibold text-slate-300">Expect a warning screen.</strong>{' '}
      Google will say it hasn&apos;t verified this app. That is normal for a personal app
      like this one. Choose <em>Advanced</em>, then <em>Go to Pass Handler</em>. The app
      only ever asks for access to its own private folder — it cannot see the rest of your
      Drive.
    </div>
  );
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6 flex flex-col items-center gap-3 text-center">
      <div className="rounded-2xl bg-accent/10 p-4 text-accent">
        <LockIcon className="h-7 w-7" />
      </div>
      <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
      <p className="text-sm text-slate-400">{subtitle}</p>
    </div>
  );
}
