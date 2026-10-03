import { DriveClient, LocalVaultStore, SyncStateStore } from '../sync/types';

export type { DriveClient, LocalVaultStore, SyncStateStore };

/**
 * A key combination, described the way a browser `KeyboardEvent` already
 * describes one — `code` is its `.code` value (`"KeyH"`, `"Digit1"`,
 * `"F5"`, …), passed straight through to the host rather than formatted
 * into a separate accelerator-string grammar. Windows only.
 */
export interface HotkeyCombo {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** The Windows key. */
  meta: boolean;
  code: string;
}

export const DEFAULT_MANUAL_FILL_HOTKEY: HotkeyCombo = {
  ctrl: true,
  alt: true,
  shift: false,
  meta: false,
  code: 'KeyH',
};

/**
 * What `Platform.manualFillHotkeyStatus`/`setManualFillHotkey` resolve to —
 * the persisted combo, and whether it's genuinely registered with the OS
 * right now (a combo already claimed by something else fails to register,
 * and must never be shown as active just because it's what's saved).
 */
export interface HotkeyStatus {
  hotkey: HotkeyCombo;
  registered: boolean;
  /** Set only right after a `setManualFillHotkey` call that itself failed. */
  error: string | null;
}

export interface Settings {
  /** Minutes of idleness before locking. `null` means never. */
  autoLockMinutes: number | null;
  clipboardClearSeconds: number;
  biometricUnlockEnabled: boolean;
  onboardingComplete: boolean;
  /** Whether entry rows fetch and show the site's favicon. */
  showSiteIcons: boolean;
  /**
   * The manual-fill hotkey, as last successfully registered. Windows only —
   * present (and round-tripped through `settings_load`/`settings_save`) on
   * Android too only because it lives in the same shared `Settings` record;
   * Android never reads or acts on it.
   */
  manualFillHotkey: HotkeyCombo;
  /**
   * Ids of the first-run tip sequences already finished or skipped on this
   * device (`src/ui/tips/tipSets.ts`, `docs/ONBOARDING-TIPS-DESIGN.md`).
   * Device-local on purpose: tips are platform-specific.
   */
  tipsSeen: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  autoLockMinutes: 5,
  clipboardClearSeconds: 20,
  biometricUnlockEnabled: false,
  onboardingComplete: false,
  showSiteIcons: true,
  manualFillHotkey: DEFAULT_MANUAL_FILL_HOTKEY,
  tipsSeen: [],
};

/** What `Platform.fetchFavicon` resolves to for a site that has one. */
export interface FaviconIcon {
  mime: string;
  dataBase64: string;
}

/**
 * What `Platform.exportVault` resolves to. See
 * `docs/EXPORT-VAULT-DESIGN.md` — Windows and Android genuinely differ here:
 * Windows shows a native Save-As dialog and knows the path chosen (or that
 * it was cancelled); Android opens the share sheet and is never told what
 * happens afterwards, so `'shared'` is not a claim the file landed anywhere.
 */
export type ExportOutcome =
  | { kind: 'saved'; path: string }
  | { kind: 'shared' }
  | { kind: 'cancelled' };

/**
 * What `Platform.pickLocalVaultFile` resolves to. See
 * `docs/RESTORE-VAULT-DESIGN.md` — the local-file half of "restore vault",
 * for moving a vault to a device by hand (AirDrop/USB/email an exported
 * `.kdbx`) rather than through Drive.
 */
export type ImportOutcome = { kind: 'picked'; data: ArrayBuffer } | { kind: 'cancelled' };

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
   *
   * On Android this is best-effort only: the OS refuses clipboard reads from
   * a backgrounded app, so this cannot tell "something else was copied" from
   * "we're not in the foreground" and treats both the same — leaving the
   * clipboard alone. `scheduleClear` below is what actually guarantees
   * clearing there.
   */
  clearIfMatches(expected: string): Promise<boolean>;
  /**
   * Unconditionally clear the clipboard after `seconds`, replacing any
   * previously scheduled clear.
   *
   * A no-op on desktop, where `clearIfMatches`'s own timer-driven check
   * already works reliably. On Android this is the real guarantee: it runs
   * natively, independent of the WebView's JS engine, so it still fires while
   * the app is backgrounded — which a JS `setInterval` cannot promise, and
   * which is exactly when a copied password most needs to self-clear.
   */
  scheduleClear(seconds: number): Promise<void>;
  /** Cancel a pending `scheduleClear`, e.g. because a fresh copy replaced it. */
  cancelScheduledClear(): Promise<void>;
}

export interface BiometricStatus {
  available: boolean;
  reason: string | null;
}

/** Android's own fill keyboard (`VaultIme`). `available` is false on
 * Windows, which fills through the manual-fill hotkey instead. */
export interface KeyboardStatus {
  available: boolean;
  enabled: boolean;
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
  /** The connected account's email, so Settings can show which one it is. */
  driveAccountEmail(): Promise<string | null>;
  connectDrive(): Promise<void>;
  disconnectDrive(): Promise<void>;

  /**
   * Best-effort favicon lookup for an entry's site, fetched directly from
   * that site (never a third-party icon service — see `favicon.rs`'s module
   * docs). Resolves to `null` for anything that isn't a fetchable site, has
   * no icon, or fails for any reason; never rejects.
   */
  fetchFavicon(url: string): Promise<FaviconIcon | null>;

  /** Android: whether Vault's keyboard is turned on in the system list. */
  keyboardStatus(): Promise<KeyboardStatus>;

  /** Android: open the system screen where keyboards are turned on. */
  openKeyboardSettings(): Promise<void>;

  /** Android: exclude the window from screenshots and the task switcher. */
  setScreenCaptureBlocked(blocked: boolean): Promise<void>;

  openExternal(url: string): Promise<void>;

  /** Fires when the host decides the vault should lock (window closed, etc). */
  onLockRequested(handler: () => void): Promise<() => void>;

  /** Fires when Android hands back an OAuth redirect. */
  onOauthCallback(handler: (url: string) => void): Promise<() => void>;

  /**
   * Windows only: fires when the manual-fill hotkey is pressed. The main
   * window has already been shown and focused by the time this fires — see
   * `docs/MANUAL-FILL-DESIGN.md`. Harmless to listen for on Android too: the
   * event is simply never emitted there, since nothing registers the hotkey.
   */
  onEnterPickMode(handler: () => void): Promise<() => void>;

  /**
   * Windows only: restore focus to whichever window last had it before the
   * manual-fill hotkey fired, then type `text` into it as synthetic
   * keystrokes. One call fills one field — the picker calls this once per
   * field filled, in whatever order the user taps Fill buttons in. The
   * clipboard is never touched.
   */
  typeText(text: string): Promise<void>;

  /**
   * Windows only: a single Tab key press into the same restored window
   * `typeText` just typed into — see `docs/MANUAL-FILL-DESIGN.md`'s "Fill,
   * then Tab" section. Used to move focus to the form's next field right
   * after a fill, so the picker can heuristically follow up with the
   * entry's password if it has one — Windows has no way to inspect what
   * field Tab actually landed on, unlike Android's IME (see
   * `VaultKeyboardView.kt`'s `onEditorInfoChanged`).
   */
  pressTab(): Promise<void>;

  /**
   * Windows only: best-effort, real check of whether the field Tab just
   * landed on is a password field, via Windows UI Automation. `null` means
   * it couldn't tell (no UIA support on the control, a COM failure, …) —
   * the caller should fall back to the old Username→Tab→Password heuristic
   * in that case, never treat it as "no."
   */
  focusedFieldIsPassword(): Promise<boolean | null>;

  /** Windows only: minimize the main window back down after a manual fill. */
  minimizeMainWindow(): Promise<void>;

  /**
   * Windows only: read-only snapshot of the manual-fill hotkey — see
   * `HotkeyStatus`.
   */
  manualFillHotkeyStatus(): Promise<HotkeyStatus>;

  /**
   * Windows only: register a new manual-fill hotkey, replacing whatever was
   * registered before. Only persisted on success — a rejected combo
   * (already claimed by something else, or with no modifier key) leaves the
   * previous one active and unchanged; the reason comes back in
   * `HotkeyStatus.error`, not as a rejected promise.
   */
  setManualFillHotkey(combo: HotkeyCombo): Promise<HotkeyStatus>;

  vaultExists(): Promise<boolean>;
  backupExists(): Promise<boolean>;
  restoreBackup(): Promise<void>;

  /**
   * Save an independent copy of the vault, outside of Drive entirely.
   * Windows shows a native Save-As dialog; Android opens the share sheet.
   */
  exportVault(): Promise<ExportOutcome>;

  /**
   * Native "open file" dialog, filtered to `.kdbx`, for the local-file half
   * of restoring a vault. See `docs/RESTORE-VAULT-DESIGN.md`. Never
   * validates the bytes as a real vault — that happens once they reach
   * `kdbxweb`, same as every other source of vault bytes.
   */
  pickLocalVaultFile(): Promise<ImportOutcome>;
}
