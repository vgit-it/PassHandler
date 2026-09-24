import { useEffect, useRef, useState } from 'react';

import { useApp } from '../../app/store';
import { StrengthBar } from '../components/PasswordField';
import { EyeIcon, EyeOffIcon, LockIcon } from '../components/icons';

type Step = 'choose' | 'create' | 'connect-existing' | 'connecting' | 'adopt';

/**
 * First run.
 *
 * Two routes: create a vault here, or connect to one that already exists on
 * Drive. The second is what the second and third devices do.
 *
 * `'connecting'` (per request, second pass) is that second route's own
 * "in progress" screen — shown the instant "Sign in with Google" is tapped,
 * *before* the system browser even opens, and it's also where a fresh
 * mount lands directly if `driveConnected` is already true (see
 * `Connecting`'s own doc for why that combination, on a first mount, is
 * unambiguous). Both are "something is in flight with Drive, wait and
 * resolve one of two ways" — the same screen either way rather than two
 * near-identical ones.
 *
 * First pass here just moved the *destination* (straight to `'adopt'`
 * rather than back to `'choose'`) for the case where this app itself
 * restarts mid-connect — Android is free to kill the whole process while
 * backgrounded for the OAuth browser (`store.tsx`'s startup-effect doc),
 * which was landing back on this same first-run "choose" screen with no
 * sign anything had happened. That part's still true and still handled.
 * What that pass didn't cover: the *far* more common case where this app
 * process survives backgrounding — nothing here ever kicked off a
 * "waiting" screen *before* the browser opened, and nothing ever noticed
 * the person coming back without finishing. `Connecting` covers both now.
 */
export function OnboardingScreen() {
  const { driveConnected } = useApp();
  const [step, setStep] = useState<Step>(() => (driveConnected ? 'connecting' : 'choose'));

  return (
    <div className="flex h-full flex-col overflow-y-auto px-7 py-10">
      <div className="mx-auto w-full max-w-sm">
        {step === 'choose' && <Choose onPick={setStep} />}
        {step === 'create' && <CreateVault onBack={() => setStep('choose')} />}
        {step === 'connect-existing' && (
          <ConnectExisting onBack={() => setStep('choose')} onConnecting={() => setStep('connecting')} />
        )}
        {step === 'connecting' && (
          <Connecting
            onFound={() => setStep('adopt')}
            onNotFound={() => setStep('connect-existing')}
          />
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
        title="Vault"
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
        <p className="mt-3 text-center text-xs text-slate-400">
          Google Drive sync isn&apos;t set up for this build, so only a local vault can be
          created for now. Sync can be added later.
        </p>
      )}
    </>
  );
}

function CreateVault({ onBack }: { onBack: () => void }) {
  const { createVault, driveConfigured, busy } = useApp();

  // Both password fields are uncontrolled so the master password never lands in
  // React state. Only the strength meter sees it, via a separate value that is
  // cleared on submit. `revealed`/`confirmRevealed` are just booleans — toggling
  // which of these two fields shows plaintext never puts the password itself
  // into state.
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [confirmRevealed, setConfirmRevealed] = useState(false);
  const [connect, setConnect] = useState(driveConfigured);
  // Gates the submit button — see the checkbox below. This is the one
  // password in the whole app with no recovery path at all, so acknowledging
  // that has to be a real, deliberate action, not just text above the fold
  // that's easy to skim past.
  const [acknowledged, setAcknowledged] = useState(false);
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
        className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn"
      >
        <strong className="font-semibold">There is no recovery.</strong> Nobody — not us,
        not Google — can reset this password or read your vault without it. If you forget
        it, the passwords inside are gone. Write it down and keep it somewhere safe.
      </div>

      <label className="mb-5 flex cursor-pointer items-start gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          className="mt-0.5 accent-accent"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
        />
        <span>I understand this password can&apos;t be recovered if I forget it.</span>
      </label>

      <label className="label" htmlFor="new-password">
        Master password
      </label>
      <div className="relative">
        <input
          id="new-password"
          ref={passwordRef}
          type={revealed ? 'text' : 'password'}
          className="field pr-11"
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setPreview(e.target.value)}
        />
        {/* w-11 (44px), full field height — a real tap target, not the
            smaller icon-only toggle elsewhere in the app (see
            docs/UI-UX-REVIEW.md). This is the one password with no recovery
            path, so being able to actually check what was typed matters
            more here than anywhere else in the app. */}
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? 'Hide password' : 'Show password'}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      {preview !== '' && <StrengthBar password={preview} />}

      <label className="label mt-4" htmlFor="confirm-password">
        Confirm
      </label>
      <div className="relative">
        <input
          id="confirm-password"
          ref={confirmRef}
          type={confirmRevealed ? 'text' : 'password'}
          className="field pr-11"
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-slate-400"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setConfirmRevealed((r) => !r)}
          aria-label={confirmRevealed ? 'Hide password' : 'Show password'}
        >
          {confirmRevealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>

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
            {/* slate-400, not slate-500 — 500 falls under the AA contrast
                minimum at this size (docs/UI-UX-REVIEW.md), and this text is
                the actual privacy explanation the checkbox label above is
                summarizing, so it should never read as an afterthought. */}
            <span className="mt-0.5 block text-xs text-slate-400">
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

      <button type="submit" className="btn-primary mt-6 w-full" disabled={busy || !acknowledged}>
        {busy ? 'Creating…' : 'Create vault'}
      </button>
      <button type="button" className="btn-ghost mt-2 w-full" onClick={onBack} disabled={busy}>
        Back
      </button>
    </form>
  );
}

/**
 * Just the ask — per request (second pass), this no longer runs the connect
 * attempt itself. Tapping "Sign in with Google" hands straight off to
 * `Connecting`, which transitions the screen *before* it does anything
 * that could open a browser, rather than this button sitting there
 * labeled "Waiting for Google…" as the one and only sign something is
 * happening.
 */
function ConnectExisting({
  onBack,
  onConnecting,
}: {
  onBack: () => void;
  onConnecting: () => void;
}) {
  return (
    <>
      <Header
        title="Connect to Google Drive"
        subtitle="Sign in with the account holding your vault."
      />
      <UnverifiedAppNotice />

      <button className="btn-primary mt-5 w-full" onClick={onConnecting}>
        Sign in with Google
      </button>
      <button className="btn-ghost mt-2 w-full" onClick={onBack}>
        Back
      </button>
    </>
  );
}

/** How long to let a just-restored connection settle before treating a
 * still-not-connected result as final — see `Connecting`'s own doc. */
const RESUME_SETTLE_MS = 1000;

/**
 * The connect-existing flow's one "in progress" screen (per request,
 * second pass) — mounted the instant "Sign in with Google" is tapped,
 * *before* anything opens a browser, and also what a fresh app mount lands
 * on directly when `driveConnected` is already true (see
 * `OnboardingScreen`'s own doc for why that combination is unambiguous on
 * a first mount). Both are "something is in flight with Drive, wait and
 * resolve one of two ways," so they share this one screen.
 *
 * Two ways out, whichever happens first:
 * - The `connectDrive()` this starts resolves on its own — the common case
 *   when this app process survives backgrounding for the browser (most of
 *   the time, in practice). Pulls the vault and hands off to the
 *   master-password screen.
 * - The page becomes visible again — the person's back, whether or not
 *   this app itself restarted to get here — and, after `RESUME_SETTLE_MS`
 *   (long enough that a check landing in the narrow window right as a
 *   real success is still propagating doesn't read as a false "gave up"),
 *   a fresh `checkDriveConnected()` — never the possibly-stale React
 *   state — still comes back false. Per request: that means sign-in was
 *   abandoned rather than completed (closed the browser, backed out,
 *   whatever), not still in progress, so this goes back to the plain
 *   "Connect to Google Drive" screen instead of sitting on "Connecting…"
 *   with nothing left to wait for.
 *
 * `settled`/`started` are `useRef`s, not state — nothing here needs a
 * render when they change, only to stop happening twice.
 */
function Connecting({ onFound, onNotFound }: { onFound: () => void; onNotFound: () => void }) {
  const { connectDrive, checkDriveConnected, pullRemoteVault, driveConnected } = useApp();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const settled = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const proceed = () => {
      if (settled.current) return;
      settled.current = true;
      // Same "no vault unlocked yet, so the regular sync engine would be a
      // no-op" reasoning this always had, back when `ConnectExisting` ran
      // this step itself.
      pullRemoteVault()
        .then(() => {
          if (!cancelled) onFound();
        })
        .catch((err) => {
          // Same fail-quiet-to-the-user convention this screen's catches
          // have always used (docs/SECURITY.md) — logged, not shown
          // verbatim. The one expected case behind this specific catch is
          // `VaultError('no-vault')`: the now-connected account genuinely
          // has nothing in its app folder (the wrong account, or a fresh
          // one) — indistinguishable from a network hiccup to the user
          // either way.
          console.error('[drive-connect]', err);
          if (!cancelled) setError('Could not find your vault on Google Drive.');
        });
    };

    if (driveConnected) {
      // Fresh mount, already connected — this app itself restarted
      // mid-flow (see this function's own doc); nothing left to open a
      // browser for.
      proceed();
      return () => {
        cancelled = true;
      };
    }

    if (!started.current) {
      started.current = true;
      connectDrive()
        .then(() => {
          if (!cancelled) proceed();
        })
        .catch((err) => {
          console.error('[drive-connect]', err);
          if (!cancelled) {
            settled.current = true;
            setError('Could not connect to Google Drive. Check your connection and try again.');
          }
        });
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible' || settled.current) return;
      window.setTimeout(() => {
        if (cancelled || settled.current) return;
        void checkDriveConnected().then((connected) => {
          if (cancelled || settled.current) return;
          if (connected) proceed();
          else {
            settled.current = true;
            onNotFound();
          }
        });
      }, RESUME_SETTLE_MS);
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driveConnected]);

  return (
    <>
      <Header
        title="Connecting to Google Drive"
        subtitle="Finish signing in in your browser, then come back here."
      />
      {error ? (
        <>
          <p role="alert" className="mt-3 text-center text-sm text-bad">
            {error}
          </p>
          <button className="btn-secondary mt-5 w-full" onClick={onNotFound}>
            Back
          </button>
        </>
      ) : (
        <p className="text-center text-sm text-slate-400">
          Waiting for you to finish signing in with Google…
        </p>
      )}
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
        autoCorrect="off"
        autoCapitalize="off"
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
      like this one. Choose <em>Advanced</em>, then <em>Go to Vault</em>. The app
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
