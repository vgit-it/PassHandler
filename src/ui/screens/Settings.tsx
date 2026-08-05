import { useRef, useState } from 'react';

import { useApp } from '../../app/store';
import { AUTO_LOCK_CHOICES, CLIPBOARD_CHOICES } from '../../platform/ports';
import { StrengthBar } from '../components/PasswordField';
import { BackIcon, FingerprintIcon, RefreshIcon } from '../components/icons';

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const {
    settings,
    saveSettings,
    sync,
    syncNow,
    driveConfigured,
    driveConnected,
    connectDrive,
    disconnectDrive,
    biometricAvailable,
    biometricEnrolled,
    enrolBiometrics,
    disableBiometrics,
    platform,
    busy,
  } = useApp();

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <button className="btn-ghost px-2" onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <h1 className="text-sm font-semibold text-slate-200">Settings</h1>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-10">
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
            <button
              className={biometricEnrolled ? 'btn-secondary' : 'btn-primary'}
              disabled={!biometricAvailable}
              onClick={() =>
                void (biometricEnrolled ? disableBiometrics() : enrolBiometrics())
              }
            >
              <FingerprintIcon />
              {biometricEnrolled ? 'Turn off' : 'Turn on'}
            </button>
          </Row>
        </Section>

        <Section title="Google Drive">
          {!driveConfigured ? (
            <p className="px-3 py-2.5 text-sm text-slate-400">
              Not configured in this build. The vault works normally without it — see
              <code className="mx-1 rounded bg-ink-700 px-1 text-xs">
                docs/google-oauth-setup.md
              </code>
              to enable sync.
            </p>
          ) : (
            <>
              <Row
                label={driveConnected ? 'Connected' : 'Not connected'}
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

        <ChangeMasterPassword />

        <RestoreBackup />
      </div>
    </div>
  );
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
        <p className="px-3 pt-2 text-sm text-ok">
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
}

function RestoreBackup() {
  const { restoreBackup } = useApp();
  const [confirming, setConfirming] = useState(false);

  return (
    <Section title="Recovery">
      {confirming ? (
        <div className="px-3 py-3">
          <p className="text-sm text-slate-300">
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
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      <div className="card divide-y divide-ink-600">{children}</div>
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
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-slate-200">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      </div>
      {children}
    </div>
  );
}
