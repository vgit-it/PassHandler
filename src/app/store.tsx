import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { SyncEngine } from '../sync/syncEngine';
import { SyncSnapshot } from '../sync/types';
import { Vault } from '../vault/vault';
import { EntryInput, VaultEntry, VaultError } from '../vault/types';
import { DEFAULT_SETTINGS, Platform, Settings } from '../platform/ports';
import { completeOauthRedirect, configureDrive } from '../platform/tauri';

export type Phase = 'loading' | 'onboarding' | 'locked' | 'unlocked';

interface AppState {
  phase: Phase;
  entries: VaultEntry[];
  settings: Settings;
  sync: SyncSnapshot;
  platform: Platform;
  biometricAvailable: boolean;
  biometricEnrolled: boolean;
  driveConfigured: boolean;
  driveConnected: boolean;
  /** Set when the last unlock attempt failed. Always the same generic text. */
  unlockError: string | null;
  busy: boolean;
}

interface AppActions {
  createVault(masterPassword: string, connectDrive: boolean): Promise<void>;
  adoptRemoteVault(masterPassword: string): Promise<void>;
  unlock(masterPassword: string): Promise<boolean>;
  unlockWithBiometrics(): Promise<boolean>;
  lock(): void;
  noteActivity(): void;

  readPassword(id: string): string | null;
  addEntry(input: EntryInput): Promise<void>;
  updateEntry(id: string, input: EntryInput): Promise<void>;
  deleteEntry(id: string): Promise<void>;

  syncNow(): Promise<void>;
  saveSettings(next: Partial<Settings>): Promise<void>;
  changeMasterPassword(next: string): Promise<void>;

  connectDrive(): Promise<void>;
  disconnectDrive(): Promise<void>;
  enrolBiometrics(): Promise<boolean>;
  disableBiometrics(): Promise<void>;
  restoreBackup(): Promise<void>;
}

const Ctx = createContext<(AppState & AppActions) | null>(null);

export function useApp(): AppState & AppActions {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

const GENERIC_UNLOCK_ERROR =
  'Could not open the vault. Check your master password and try again.';

export function AppProvider({
  platform,
  children,
}: {
  platform: Platform;
  children: ReactNode;
}) {
  // The vault lives in a ref, never in React state. Putting a decrypted
  // database into state would put it into every DevTools snapshot and every
  // render trace.
  const vaultRef = useRef<Vault | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  const lastActivityRef = useRef(Date.now());

  const [phase, setPhase] = useState<Phase>('loading');
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sync, setSync] = useState<SyncSnapshot>({
    status: 'disabled',
    lastSyncAt: null,
    pendingChanges: false,
    conflict: null,
  });
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [driveConnected, setDriveConnected] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const engine = useCallback((): SyncEngine => {
    if (!engineRef.current) {
      engineRef.current = new SyncEngine({
        drive: platform.drive,
        local: platform.local,
        stateStore: platform.syncState,
        getVault: () => vaultRef.current,
        onChange: setSync,
      });
    }
    return engineRef.current;
  }, [platform]);

  const refreshEntries = useCallback(() => {
    setEntries(vaultRef.current?.listEntries() ?? []);
  }, []);

  const noteActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  const lock = useCallback(() => {
    vaultRef.current?.lock();
    vaultRef.current = null;
    setEntries([]);
    setPhase('locked');
    // Screen-capture protection is only needed while there is something to
    // protect; leaving it on would block screenshots of the lock screen too.
    void platform.setScreenCaptureBlocked(false);
  }, [platform]);

  // ------------------------------------------------------------- start-up

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [loaded, hasVault] = await Promise.all([
        platform.settings.load(),
        platform.vaultExists(),
      ]);
      await configureDrive(platform);
      await engine().load();

      const [configured, connected, biometric] = await Promise.all([
        platform.driveConfigured(),
        platform.driveConnected(),
        platform.biometrics.status(),
      ]);

      if (cancelled) return;
      setSettings(loaded);
      setDriveConfigured(configured);
      setDriveConnected(connected);
      setBiometricAvailable(biometric.available);
      setBiometricEnrolled(loaded.biometricUnlockEnabled && biometric.available);
      setPhase(hasVault && loaded.onboardingComplete ? 'locked' : 'onboarding');
    })();

    return () => {
      cancelled = true;
    };
  }, [platform, engine]);

  // Host-side lock triggers: the window closing on Windows, the app going to
  // the background on Android.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void platform.onLockRequested(() => lock()).then((fn) => {
      dispose = fn;
    });
    return () => dispose?.();
  }, [platform, lock]);

  // Android returns from the Google consent screen through a custom-scheme
  // intent rather than a loopback socket.
  useEffect(() => {
    let dispose: (() => void) | undefined;
    void platform
      .onOauthCallback((url) => void completeOauthRedirect(url))
      .then((fn) => {
        dispose = fn;
      });
    return () => dispose?.();
  }, [platform]);

  // Auto-lock. Compared against wall-clock time rather than counted in ticks,
  // so a machine that sleeps for an hour wakes up locked.
  useEffect(() => {
    if (phase !== 'unlocked' || settings.autoLockMinutes === null) return;

    const timeout = settings.autoLockMinutes * 60_000;
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current >= timeout) lock();
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase, settings.autoLockMinutes, lock]);

  // Android: keep the vault out of the task-switcher preview and out of
  // screenshots for exactly as long as it is unlocked.
  useEffect(() => {
    if (!platform.isAndroid) return;
    void platform.setScreenCaptureBlocked(phase === 'unlocked');
  }, [platform, phase]);

  // Backgrounding on Android is a lock trigger. `visibilitychange` is the
  // signal the webview gets when the activity stops being foreground.
  useEffect(() => {
    if (!platform.isAndroid) return;

    const onHidden = () => {
      if (document.visibilityState === 'hidden') lock();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => document.removeEventListener('visibilitychange', onHidden);
  }, [platform.isAndroid, lock]);

  // -------------------------------------------------------------- actions

  const afterUnlock = useCallback(
    async (vault: Vault) => {
      vaultRef.current = vault;
      engine().restoreEditState();
      refreshEntries();
      noteActivity();
      setUnlockError(null);
      setPhase('unlocked');

      // The PRD asks for a sync check immediately after unlock. It runs in the
      // background: the entry list must be usable before the network answers.
      void engine().sync();
    },
    [engine, refreshEntries, noteActivity],
  );

  const unlock = useCallback(
    async (masterPassword: string): Promise<boolean> => {
      setBusy(true);
      try {
        const bytes = await platform.local.read();
        const vault = await Vault.unlock(bytes, masterPassword);
        await afterUnlock(vault);
        return true;
      } catch {
        // Fail closed, with one message. Nothing about the cause is surfaced
        // and nothing is logged.
        setUnlockError(GENERIC_UNLOCK_ERROR);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [platform, afterUnlock],
  );

  const unlockWithBiometrics = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      const material = await platform.biometrics.retrieve('Unlock your vault');
      if (!material) return false;

      const bytes = await platform.local.read();
      const vault = await Vault.unlockWithKeyMaterial(bytes, material);
      material.fill(0);
      await afterUnlock(vault);
      return true;
    } catch {
      // A failed or cancelled biometric check falls back to the master
      // password rather than retrying, per the PRD.
      return false;
    } finally {
      setBusy(false);
    }
  }, [platform, afterUnlock]);

  const persistSettings = useCallback(
    async (next: Settings) => {
      setSettings(next);
      await platform.settings.save(next);
    },
    [platform],
  );

  const createVault = useCallback(
    async (masterPassword: string, connect: boolean) => {
      setBusy(true);
      try {
        const vault = await Vault.create(masterPassword);
        vaultRef.current = vault;
        await platform.local.write(await vault.save());

        await persistSettings({ ...settings, onboardingComplete: true });
        if (connect) {
          await platform.connectDrive();
          setDriveConnected(true);
        }
        await afterUnlock(vault);
      } finally {
        setBusy(false);
      }
    },
    [platform, settings, persistSettings, afterUnlock],
  );

  /** Second device: pull the existing vault from Drive, then unlock it. */
  const adoptRemoteVault = useCallback(
    async (masterPassword: string) => {
      setBusy(true);
      try {
        const vault = await Vault.unlock(await platform.local.read(), masterPassword);
        await persistSettings({ ...settings, onboardingComplete: true });
        await afterUnlock(vault);
      } catch {
        setUnlockError(GENERIC_UNLOCK_ERROR);
        throw new VaultError('wrong-password-or-corrupt');
      } finally {
        setBusy(false);
      }
    },
    [platform, settings, persistSettings, afterUnlock],
  );

  const mutate = useCallback(
    async (change: (vault: Vault) => void) => {
      const vault = vaultRef.current;
      if (!vault) return;

      change(vault);
      refreshEntries();
      noteActivity();

      // Save locally first, then sync. An edit is safe on disk before the
      // network is involved, so losing connectivity never loses the edit.
      await engine().markDirtyAndSave();
      void engine().sync();
    },
    [engine, refreshEntries, noteActivity],
  );

  const value = useMemo<AppState & AppActions>(
    () => ({
      phase,
      entries,
      settings,
      sync,
      platform,
      biometricAvailable,
      biometricEnrolled,
      driveConfigured,
      driveConnected,
      unlockError,
      busy,

      createVault,
      adoptRemoteVault,
      unlock,
      unlockWithBiometrics,
      lock,
      noteActivity,

      readPassword: (id) => vaultRef.current?.readPassword(id) ?? null,
      addEntry: (input) => mutate((vault) => vault.addEntry(input)),
      updateEntry: (id, input) => mutate((vault) => vault.updateEntry(id, input)),
      deleteEntry: (id) => mutate((vault) => vault.deleteEntry(id)),

      syncNow: async () => {
        await engine().sync();
      },

      saveSettings: async (next) => {
        await persistSettings({ ...settings, ...next });
      },

      changeMasterPassword: async (next) => {
        const vault = vaultRef.current;
        if (!vault) return;

        await vault.changeMasterPassword(next);
        await engine().markDirtyAndSave();

        // The remote is now undecryptable with the old key, so an ordinary
        // merge is impossible and a force push is the only correct move. The
        // user has already been warned that other devices need the new
        // password before they can sync again.
        await engine().forcePush();

        // Any enrolled biometric key material is for the old password.
        if (settings.biometricUnlockEnabled) {
          await platform.biometrics.forget();
          setBiometricEnrolled(false);
          await persistSettings({ ...settings, biometricUnlockEnabled: false });
        }
      },

      connectDrive: async () => {
        setBusy(true);
        try {
          await platform.connectDrive();
          setDriveConnected(true);
          await engine().sync();
        } finally {
          setBusy(false);
        }
      },

      disconnectDrive: async () => {
        await platform.disconnectDrive();
        await engine().disconnect();
        setDriveConnected(false);
      },

      enrolBiometrics: async () => {
        const material = vaultRef.current?.keyMaterial();
        if (!material) return false;
        try {
          await platform.biometrics.enrol(material);
          material.fill(0);
          await persistSettings({ ...settings, biometricUnlockEnabled: true });
          setBiometricEnrolled(true);
          return true;
        } catch {
          return false;
        }
      },

      disableBiometrics: async () => {
        await platform.biometrics.forget();
        setBiometricEnrolled(false);
        await persistSettings({ ...settings, biometricUnlockEnabled: false });
      },

      restoreBackup: async () => {
        await platform.restoreBackup();
        lock();
      },
    }),
    [
      phase,
      entries,
      settings,
      sync,
      platform,
      biometricAvailable,
      biometricEnrolled,
      driveConfigured,
      driveConnected,
      unlockError,
      busy,
      createVault,
      adoptRemoteVault,
      unlock,
      unlockWithBiometrics,
      lock,
      noteActivity,
      mutate,
      engine,
      persistSettings,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
