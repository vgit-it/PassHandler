import { DriveClient, LocalVaultStore, SyncStateStore } from '../sync/types';

export type { DriveClient, LocalVaultStore, SyncStateStore };

export interface Settings {
  /** Minutes of idleness before locking. `null` means never. */
  autoLockMinutes: number | null;
  clipboardClearSeconds: number;
  biometricUnlockEnabled: boolean;
  onboardingComplete: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 5,
  clipboardClearSeconds: 20,
  biometricUnlockEnabled: false,
  onboardingComplete: false,
};

export const AUTO_LOCK_CHOICES: Array<{ label: string; value: number | null }> = [
  { label: '1 minute', value: 1 },
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: 'Never', value: null },
];

export const CLIPBOARD_CHOICES = [10, 20, 30, 60];

export interface SettingsStore {
  load(): Promise<Settings>;
  save(settings: Settings): Promise<void>;
}

export interface Clipboard {
  /**
   * Copy, marking the content sensitive where the platform supports it, so it
   * is excluded from clipboard history and preview.
   */
  writeSensitive(text: string): Promise<void>;
  /**
   * Clear only if the clipboard still holds `expected`.
   *
   * Returns whether it did. Anything the user copied since is theirs and must
   * survive our timer.
   */
  clearIfMatches(expected: string): Promise<boolean>;
}

export interface BiometricStatus {
  available: boolean;
  reason: string | null;
}

export interface Biometrics {
  status(): Promise<BiometricStatus>;
  /** Store key material behind the platform's biometric gate. */
  enrol(keyMaterial: Uint8Array): Promise<void>;
  /** Prompt, then return the stored key material. `null` if none is stored. */
  retrieve(reason: string): Promise<Uint8Array | null>;
  forget(): Promise<void>;
}

export interface Platform {
  /** 'windows' | 'android' | anything else the host reports. */
  name: string;
  isDesktop: boolean;
  isAndroid: boolean;

  local: LocalVaultStore;
  settings: SettingsStore;
  syncState: SyncStateStore;
  drive: DriveClient;
  clipboard: Clipboard;
  biometrics: Biometrics;

  /** Whether a Drive client ID was configured at build time. */
  driveConfigured(): Promise<boolean>;
  driveConnected(): Promise<boolean>;
  connectDrive(): Promise<void>;
  disconnectDrive(): Promise<void>;

  /** Android: exclude the window from screenshots and the task switcher. */
  setScreenCaptureBlocked(blocked: boolean): Promise<void>;

  openExternal(url: string): Promise<void>;

  /** Fires when the host decides the vault should lock (window closed, etc). */
  onLockRequested(handler: () => void): Promise<() => void>;

  /** Fires when Android hands back an OAuth redirect. */
  onOauthCallback(handler: (url: string) => void): Promise<() => void>;

  vaultExists(): Promise<boolean>;
  backupExists(): Promise<boolean>;
  restoreBackup(): Promise<void>;
}
