import { useEffect, useRef, useState } from 'react';

import { useApp } from '../../app/store';
import {
  AUTO_LOCK_CHOICES,
  CLIPBOARD_CHOICES,
  ExportOutcome,
  HotkeyCombo,
} from '../../platform/ports';
import { DriveFileMeta } from '../../sync/types';
import { StrengthBar } from '../components/PasswordField';
import { Toggle } from '../components/Toggle';
import { BackIcon, RefreshIcon } from '../components/icons';

/**
 * Settings.
 *
 * Colors only, per explicit request: this screen was still entirely on the
 * older ink-system (`docs/vault-visual-overhaul-plan.md` lists it, along
 * with the entry editor, as not yet migrated) — CLAUDE.md's "Phase 9 (the
 * 3D Settings turn) is permanently skipped" rules out the STRUCTURAL 3D
 * overhaul that plan's own §9 describes (a rotate-to-side-face treatment,
 * see `VaultFrame.tsx`'s own doc), not a same-layout recolor; this pass
 * changes fills/text/dividers to the palette the home screen (List/
 * Upcoming) already uses, and leaves every component/layout/interaction
 * exactly as it was.
 *
 * Two different target palettes, matching Home's own platform split:
 * Windows moves onto the `--vault-*` tokens (`index.css`) already used
 * throughout List/Upcoming/Entry Detail; Android moves onto the literal hex
 * palette the Figma home-screen design uses (`#292c2f` root, `#d6e4ef`
 * "legible foreground" text, `rgba(77,87,97,.4)` card fill). There's no
 * Figma Settings frame to pull these from, so the Android values here are
 * this screen's own extrapolation of Home's Android recipe onto Settings'
 * existing (unchanged) Section/Row structure, not a literal design-file
 * pull the way Entry Detail's Android styling was.
 *
 * The root background is painted explicitly here on both platforms, rather
 * than left to inherit `body`'s own color — on Android that inherited color
 * already happens to be right (`VaultScreen.tsx`'s `.vault-home-gutter`
 * class stays applied for the whole "unlocked, on Android" session, Settings
 * included), but this app already has one bug on record from trusting that
 * kind of ancestor inheritance instead of painting directly
 * (`EntryDetail.tsx`'s own doc on its background), so this does the same
 * defensive direct-paint here instead of relying on it again.
 *
 * Left deliberately untouched: `.field`/`.label`/`.btn-*` (`index.css`) —
 * shared component classes with call sites all over the app; `EntryDetail`
 * already reuses `.btn-secondary`/`.btn-danger` unmodified inside its own
 * vault-styled body (its delete-confirm block), so that's the standing
 * precedent for treating them as cross-system-safe rather than something
 * this pass needs to fork. `text-warn`/`border-warn`/`bg-warn` similarly
 * unchanged — the home screen itself isn't fully consistent here either
 * (`EntryList.tsx`'s own "Review" section label uses plain `warn`, not
 * `vault-warn`), so there's no single clearly-correct target to move to.
 * `text-bad` unchanged everywhere — there is no `vault-bad` token; Entry
 * Detail's own vault theme leaves `text-bad` as the plain token too.
 */
export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const {
    settings,
    saveSettings,
    sync,
    syncNow,
    driveConfigured,
    driveConnected,
    driveAccountEmail,
    connectDrive,
    disconnectDrive,
    biometricAvailable,
    biometricEnrolled,
    enrolBiometrics,
    disableBiometrics,
    platform,
    busy,
  } = useApp();
  const isAndroid = platform.isAndroid;

  return (
    <div className={`flex h-full flex-col ${isAndroid ? 'bg-[#292c2f]' : 'bg-vault-wall'}`}>
      <header className="flex items-center gap-2 px-4 pb-2 pt-3">
        <button className="btn-ghost px-2" onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <h1 className={`text-sm font-semibold ${isAndroid ? 'text-[#d6e4ef]' : 'text-vault-fg'}`}>
          Settings
        </h1>
      </header>

      <div
        // space-y-6 (24px, up from the 16px space-y-4 used to be) is the
        // +8dp increase between sections. Bottom padding is platform-split:
        // Android floats a bottom tab bar over this screen (`BottomTabBar`,
        // via `VaultScreen.tsx`'s absolutely-positioned stack) that pb-10
        // (40px) used to leave content — the Recovery section's bottom rows
        // — sitting behind. That stack works out to ~104px tall (its own
        // p-3 top+bottom (24px) plus the nav's content: py-2 (16px) + a
        // tab button's py-1.5 (12px) + its 32px icon + 4px gap + ~16px
        // label), so pb-28 (112px) clears it with a small margin. Desktop
        // has no such overlay, so it keeps the original pb-10.
        // no-scrollbar — same reasoning as the home screen's entry list, see
        // its own comment.
        className={`no-scrollbar flex-1 space-y-6 overflow-y-auto px-4 ${
          isAndroid ? 'pb-28' : 'pb-10'
        }`}
      >
        <Section title="Security">
          <Row label="Auto-lock after">
            <select
              className="field w-auto"
              value={String(settings.autoLockMinutes ?? 'never')}
              onChange={(e) =>
                void saveSettings({
                  autoLockMinutes: e.target.value === 'never' ? null : Number(e.target.value),
                })
              }
            >
              {AUTO_LOCK_CHOICES.map((choice) => (
                <option key={String(choice.value)} value={String(choice.value ?? 'never')}>
                  {choice.label}
                </option>
              ))}
            </select>
          </Row>

          <Row
            label="Clear clipboard after"
            hint="Cleared only if you haven't copied something else since."
          >
            <select
              className="field w-auto"
              value={settings.clipboardClearSeconds}
              onChange={(e) =>
                void saveSettings({ clipboardClearSeconds: Number(e.target.value) })
              }
            >
              {CLIPBOARD_CHOICES.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} seconds
                </option>
              ))}
            </select>
          </Row>

          <Row
            label={platform.isAndroid ? 'Biometric unlock' : 'Windows Hello unlock'}
            hint={
              biometricAvailable
                ? 'Your master password is still required after restarting the app.'
                : 'Not available on this device.'
            }
          >
            <Toggle
              label={platform.isAndroid ? 'Biometric unlock' : 'Windows Hello unlock'}
              checked={biometricEnrolled}
              disabled={!biometricAvailable}
              onChange={() =>
                void (biometricEnrolled ? disableBiometrics() : enrolBiometrics())
              }
            />
          </Row>

          {!platform.isAndroid && <ManualFillHotkeyRow />}
        </Section>

        <Section title="Google Drive">
          {!driveConfigured ? (
            <p className={`px-3 py-2.5 text-sm ${isAndroid ? 'text-[#d6e4ef]/50' : 'text-vault-muted'}`}>
              Not configured in this build. The vault works normally without it — see
              <code
                className={`mx-1 rounded px-1 text-xs ${isAndroid ? 'bg-white/10' : 'bg-vault-rail'}`}
              >
                docs/google-oauth-setup.md
              </code>
              to enable sync.
            </p>
          ) : (
            <>
              <Row
                label={
                  driveConnected
                    ? // Falls back to "Connected" while the email is still
                      // being fetched, or if it could not be fetched at all
                      // — never blocks on it.
                      (driveAccountEmail ?? 'Connected')
                    : 'Not connected'
                }
                hint={
                  sync.lastSyncAt
                    ? `Last synced ${new Date(sync.lastSyncAt).toLocaleString()}`
                    : 'Only the encrypted vault file is ever uploaded.'
                }
              >
                <button
                  className={driveConnected ? 'btn-secondary' : 'btn-primary'}
                  disabled={busy}
                  onClick={() => void (driveConnected ? disconnectDrive() : connectDrive())}
                >
                  {driveConnected ? 'Disconnect' : 'Connect'}
                </button>
              </Row>

              {driveConnected && (
                <Row label="Sync now">
                  <button
                    className="btn-secondary"
                    disabled={sync.status === 'syncing'}
                    onClick={() => void syncNow()}
                  >
                    <RefreshIcon />
                    {sync.status === 'syncing' ? 'Syncing…' : 'Sync'}
                  </button>
                </Row>
              )}
            </>
          )}
        </Section>

        <Section title="Appearance">
          <Row
            label="Show site icons"
            hint="Fetches each site's favicon directly — never a third-party icon service."
          >
            <Toggle
              label="Show site icons"
              checked={settings.showSiteIcons}
              onChange={(next) => void saveSettings({ showSiteIcons: next })}
            />
          </Row>
        </Section>

        <ChangeMasterPassword />

        <Section title="Recovery">
          <ExportVault />
          <RestoreBackupRow />
          <RestoreVaultRow />
        </Section>
      </div>
    </div>
  );
}

function ExportVault() {
  const { exportVault, platform } = useApp();
  const isAndroid = platform.isAndroid;
  const [result, setResult] = useState<ExportOutcome | null>(null);
  const [error, setError] = useState(false);
  const [working, setWorking] = useState(false);

  const run = async () => {
    setError(false);
    setResult(null);
    setWorking(true);
    try {
      setResult(await exportVault());
    } catch {
      setError(true);
    } finally {
      setWorking(false);
    }
  };

  return (
    <Row
      label="Save a copy of your vault"
      hint={
        platform.isAndroid
          ? 'Opens the share sheet — save it to your own cloud, email it to yourself, or send it anywhere else.'
          : 'Choose where to save an encrypted copy of the vault file. Independent of Google Drive.'
      }
    >
      <div className="text-right">
        <button className="btn-secondary" disabled={working} onClick={() => void run()}>
          {working ? 'Working…' : 'Export'}
        </button>
        {result?.kind === 'saved' && (
          <p className="mt-1 max-w-[16rem] truncate text-xs text-vault-ok" title={result.path}>
            Saved to {result.path}
          </p>
        )}
        {result?.kind === 'shared' && (
          <p className={`mt-1 text-xs ${isAndroid ? 'text-[#d6e4ef]/50' : 'text-vault-muted'}`}>
            Choose a destination to finish saving it.
          </p>
        )}
        {error && <p className="mt-1 text-xs text-bad">Could not export the vault.</p>}
      </div>
    </Row>
  );
}

/**
 * Windows only. There was previously no way at all to see or change the
 * manual-fill hotkey from inside the app — it was hardcoded in Rust, so
 * discovering or rebinding it meant reading source. This is the fix: shows
 * the combo currently registered, and lets the person capture a new one by
 * pressing it, the same "press the keys you want" pattern most apps use for
 * this rather than a dropdown of pre-set options.
 *
 * `settings.manualFillHotkey` (already loaded via `useApp()`, no extra
 * round trip) seeds the initial display so this never shows a blank
 * placeholder while the real check below is still in flight; that check —
 * `platform.manualFillHotkeyStatus()` — is what can actually say whether
 * the persisted combo is genuinely registered right now, since a combo can
 * be saved but fail to register (claimed by something else) after an
 * upgrade or on a different machine.
 */
function ManualFillHotkeyRow() {
  const { platform, settings } = useApp();
  const [combo, setCombo] = useState<HotkeyCombo>(settings.manualFillHotkey);
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void platform.manualFillHotkeyStatus().then((result) => {
      if (cancelled) return;
      setCombo(result.hotkey);
      setRegistered(result.registered);
    });
    return () => {
      cancelled = true;
    };
    // Deliberately runs once per mount, not on every `settings` change —
    // this is the one true "is it actually live" check, not a mirror of
    // the persisted value `settings.manualFillHotkey` already gives us.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  useEffect(() => {
    if (!capturing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setCapturing(false);
        return;
      }
      // Wait for the actual key, not the modifier being held down on its
      // own — a bare Ctrl press fires its own keydown before the letter
      // does.
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return;

      setCapturing(false);
      setError(null);
      const next: HotkeyCombo = {
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
        meta: event.metaKey,
        code: event.code,
      };
      void platform.setManualFillHotkey(next).then((result) => {
        setCombo(result.hotkey);
        setRegistered(result.registered);
        if (result.error) setError(result.error);
      });
    };

    // Capture phase, so this intercepts the keystroke before it reaches
    // anything else on the page — there's nothing else on this screen that
    // should see it while a combo is being captured.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [capturing, platform]);

  return (
    <Row
      label="Manual fill hotkey"
      hint={
        capturing
          ? 'Press a key combination, or Esc to cancel.'
          : registered === false
            ? 'Not currently active — that combination may already be in use by something else.'
            : 'Brings up quick-fill from anywhere, without opening the app first.'
      }
    >
      <div className="text-right">
        <button
          className="btn-secondary"
          disabled={capturing}
          onClick={() => {
            setError(null);
            setCapturing(true);
          }}
        >
          {capturing ? 'Press keys…' : describeHotkey(combo)}
        </button>
        {error && (
          <p className="mt-1 max-w-[16rem] text-xs text-bad">{error}</p>
        )}
      </div>
    </Row>
  );
}

function describeHotkey(combo: HotkeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  if (combo.meta) parts.push('Win');
  parts.push(describeCode(combo.code));
  return parts.join('+');
}

function describeCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

function ChangeMasterPassword() {
  const { changeMasterPassword, driveConnected } = useApp();
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [working, setWorking] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = passwordRef.current?.value ?? '';
    const confirm = confirmRef.current?.value ?? '';

    if (next.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    if (passwordRef.current) passwordRef.current.value = '';
    if (confirmRef.current) confirmRef.current.value = '';
    setPreview('');
    setError(null);
    setWorking(true);

    try {
      await changeMasterPassword(next);
      setDone(true);
      setOpen(false);
    } catch {
      setError('Could not change the master password. Nothing has been changed.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <Section title="Master password">
      {done && (
        <p className="px-3 pt-2 text-sm text-vault-ok">
          Changed. Enter the new password on your other devices before they can sync
          again.
        </p>
      )}

      {!open ? (
        <Row
          label="Change master password"
          hint="Re-encrypts the vault and pushes it to Drive."
        >
          <button className="btn-secondary" onClick={() => setOpen(true)}>
            Change
          </button>
        </Row>
      ) : (
        <form onSubmit={submit} className="px-3 py-3">
          <div className="mb-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
            <strong className="font-semibold">Every other device will stop syncing</strong>{' '}
            until you enter the new password there.
            {driveConnected && (
              <> The re-encrypted vault is pushed to Drive as soon as you confirm.</>
            )}{' '}
            There is still no recovery if you forget it.
          </div>

          <label className="label" htmlFor="new-master">
            New master password
          </label>
          <input
            id="new-master"
            ref={passwordRef}
            type="password"
            className="field"
            autoComplete="new-password"
            spellCheck={false}
            onChange={(e) => setPreview(e.target.value)}
          />
          {preview !== '' && <StrengthBar password={preview} />}

          <label className="label mt-3" htmlFor="confirm-master">
            Confirm
          </label>
          <input
            id="confirm-master"
            ref={confirmRef}
            type="password"
            className="field"
            autoComplete="new-password"
            spellCheck={false}
          />

          {error && (
            <p role="alert" className="mt-3 text-sm text-bad">
              {error}
            </p>
          )}

          <div className="mt-4 flex gap-2">
            <button type="submit" className="btn-primary flex-1" disabled={working}>
              {working ? 'Re-encrypting…' : 'Change password'}
            </button>
            <button
              type="button"
              className="btn-secondary flex-1"
              disabled={working}
              onClick={() => {
                setOpen(false);
                setPreview('');
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </Section>
  );
  // This component's own JSX never forks by platform — the warning banner
  // and form inputs are deliberately left on the shared, unforked classes
  // (see this file's own top doc), so unlike every other sub-component here
  // it has no reason to pull `platform` out of `useApp()` at all.
}

function RestoreBackupRow() {
  const { restoreBackup, platform } = useApp();
  const isAndroid = platform.isAndroid;
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      {confirming ? (
        <div className="px-3 py-3">
          <p className={`text-sm ${isAndroid ? 'text-[#d6e4ef]' : 'text-vault-fg'}`}>
            Replace the current vault with the backup taken at the start of this session?
            Anything changed since then will be lost on this device.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              className="btn-danger flex-1"
              onClick={() => {
                void restoreBackup();
                setConfirming(false);
              }}
            >
              Restore backup
            </button>
            <button className="btn-secondary flex-1" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <Row
          label="Restore from backup"
          hint="A copy is kept from before the first change in each session."
        >
          <button className="btn-secondary" onClick={() => setConfirming(true)}>
            Restore
          </button>
        </Row>
      )}
    </>
  );
}

type RestoreVaultStep = 'closed' | 'choose' | 'drive-list' | 'confirm';

/**
 * Replace the vault on this device with a `.kdbx` file picked locally, or
 * downloaded from Drive. See `docs/RESTORE-VAULT-DESIGN.md` — this is for
 * getting a vault onto a device by hand (nothing else has ever connected to
 * Drive) or deliberately rolling back to an older Drive revision, not for
 * undoing this session's own edits (`RestoreBackupRow` above does that).
 *
 * Expand-in-place, matching `RestoreBackupRow`'s pattern rather than a
 * modal. Talks to `platform.pickLocalVaultFile()` / `platform.drive`
 * directly, same as `ExportVault` above does for pieces that are pure I/O
 * with no vault-state side effects of their own — only the final
 * `restoreVault(bytes)` goes through the store.
 */
function RestoreVaultRow() {
  const { platform, driveConnected, restoreVault } = useApp();
  const isAndroid = platform.isAndroid;
  const [step, setStep] = useState<RestoreVaultStep>('closed');
  const [picked, setPicked] = useState<{ label: string; data: ArrayBuffer } | null>(null);
  const [driveFiles, setDriveFiles] = useState<DriveFileMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const reset = () => {
    setStep('closed');
    setPicked(null);
    setDriveFiles(null);
    setError(null);
  };

  const pickFromFile = async () => {
    setError(null);
    setWorking(true);
    try {
      const outcome = await platform.pickLocalVaultFile();
      if (outcome.kind === 'cancelled') return;
      setPicked({ label: 'the chosen file', data: outcome.data });
      setStep('confirm');
    } catch {
      setError('Could not read that file.');
    } finally {
      setWorking(false);
    }
  };

  const openDriveList = async () => {
    setError(null);
    setStep('drive-list');
    setWorking(true);
    try {
      setDriveFiles(await platform.drive.listFiles());
    } catch {
      setError('Could not reach Google Drive.');
      setDriveFiles([]);
    } finally {
      setWorking(false);
    }
  };

  const pickFromDrive = async (file: DriveFileMeta) => {
    setError(null);
    setWorking(true);
    try {
      const data = await platform.drive.download(file.id);
      setPicked({ label: file.name, data });
      setStep('confirm');
    } catch {
      setError('Could not download that file.');
    } finally {
      setWorking(false);
    }
  };

  const confirm = async () => {
    if (!picked) return;
    await restoreVault(picked.data);
    reset();
  };

  if (step === 'closed') {
    return (
      <Row
        label="Restore vault"
        hint="Replace this device's vault with a file from local storage or Google Drive."
      >
        <button className="btn-secondary" onClick={() => setStep('choose')}>
          Restore
        </button>
      </Row>
    );
  }

  return (
    <div className="px-3 py-3">
      {step === 'choose' && (
        <>
          <p className={`text-sm ${isAndroid ? 'text-[#d6e4ef]' : 'text-vault-fg'}`}>Restore from:</p>
          <div className="mt-3 flex gap-2">
            <button
              className="btn-secondary flex-1"
              disabled={working}
              onClick={() => void pickFromFile()}
            >
              A file
            </button>
            <button
              className="btn-secondary flex-1"
              disabled={working || !driveConnected}
              title={driveConnected ? undefined : 'Connect Google Drive first'}
              onClick={() => void openDriveList()}
            >
              Google Drive
            </button>
          </div>
          <button className="btn-ghost mt-2 w-full" onClick={reset}>
            Cancel
          </button>
        </>
      )}

      {step === 'drive-list' && (
        <>
          <p className={`text-sm ${isAndroid ? 'text-[#d6e4ef]' : 'text-vault-fg'}`}>
            Choose a file to restore:
          </p>
          {working && (
            <p className={`mt-2 text-xs ${isAndroid ? 'text-[#d6e4ef]/50' : 'text-vault-muted'}`}>
              Loading…
            </p>
          )}
          {!working && driveFiles?.length === 0 && (
            <p className={`mt-2 text-xs ${isAndroid ? 'text-[#d6e4ef]/50' : 'text-vault-muted'}`}>
              No vault files found in Drive.
            </p>
          )}
          {!working && driveFiles && driveFiles.length > 0 && (
            <ul className="mt-2 space-y-1">
              {driveFiles.map((file) => (
                <li key={file.id}>
                  <button
                    className="btn-secondary w-full text-left"
                    onClick={() => void pickFromDrive(file)}
                  >
                    <span className="block truncate">{file.name}</span>
                    {file.modifiedTime && (
                      <span
                        className={`block text-xs ${isAndroid ? 'text-[#d6e4ef]/50' : 'text-vault-muted'}`}
                      >
                        {new Date(file.modifiedTime).toLocaleString()}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button className="btn-ghost mt-2 w-full" onClick={reset}>
            Cancel
          </button>
        </>
      )}

      {step === 'confirm' && picked && (
        <>
          <p className={`text-sm ${isAndroid ? 'text-[#d6e4ef]' : 'text-vault-fg'}`}>
            Replace the vault on this device with{' '}
            <strong className={isAndroid ? 'text-[#d6e4ef]' : 'text-vault-fg'}>{picked.label}</strong>?
            You&apos;ll need that file&apos;s own master password afterwards. The current vault is kept
            as a one-time backup for this session.
          </p>
          <div className="mt-3 flex gap-2">
            <button className="btn-danger flex-1" onClick={() => void confirm()}>
              Restore vault
            </button>
            <button className="btn-secondary flex-1" onClick={reset}>
              Cancel
            </button>
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { platform } = useApp();
  const isAndroid = platform.isAndroid;
  return (
    <section>
      {/* `text-primary/50` — the exact color/weight Home's OWN section
          headers use (`EntryList.tsx`'s category labels), on both
          platforms; that value is already shared across platforms there,
          so no `isAndroid` fork is needed here either. */}
      <h2 className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-primary/50">
        {title}
      </h2>
      {/* Windows: `vault-shelf` fill + `hairline` border/dividers — the same
          card recipe `EntryDetail.tsx`'s field cards use. Android:
          `rgba(77,87,97,.4)` — Home's own row-card fill, borderless
          (matching Home's cards, which have no outer border either) — with
          a soft `white/10` divider between the rows a Section groups
          together, since Home's own cards never have to share one box
          between multiple rows the way a settings Section does; dropping
          the divider entirely (matching Home's borderless single-row cards
          literally) would leave grouped rows with no visual seam between
          them at all, which is a real regression, not a neutral color
          change, so a subtle divider is kept instead. */}
      <div
        className={
          isAndroid
            ? 'divide-y divide-white/10 rounded-xl bg-[rgba(77,87,97,.4)]'
            : 'divide-y divide-hairline rounded-xl border border-hairline bg-vault-shelf'
        }
      >
        {children}
      </div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  const { platform } = useApp();
  const isAndroid = platform.isAndroid;
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className={`text-sm ${isAndroid ? 'text-[#d6e4ef]' : 'text-vault-fg'}`}>{label}</div>
        {hint && (
          <div className={`mt-0.5 text-xs ${isAndroid ? 'text-[#d6e4ef]/50' : 'text-vault-muted'}`}>
            {hint}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
