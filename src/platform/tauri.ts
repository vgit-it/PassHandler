import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { addPluginListener } from '@tauri-apps/api/core';
import { platform as osPlatform } from '@tauri-apps/plugin-os';
import { openUrl } from '@tauri-apps/plugin-opener';

import { DriveFileMeta, NetworkError, SyncState, EMPTY_SYNC_STATE } from '../sync/types';
import {
  BiometricStatus,
  Biometrics,
  Clipboard,
  DEFAULT_SETTINGS,
  DriveClient,
  LocalVaultStore,
  Platform,
  Settings,
  SettingsStore,
  SyncStateStore,
} from './ports';

/**
 * The Tauri implementation of every port.
 *
 * This is the only module in the renderer that talks to the host. Everything
 * above it — vault, sync, generator, UI logic — sees interfaces, which is what
 * lets the same code run under Node in tests and in two different webviews in
 * production.
 */

const PLUGIN = 'passhandler';

/** Base64 is used for the IPC hop because vault blobs are tens of kilobytes. */
function toBase64(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Map the host's error codes onto the one distinction sync cares about.
 *
 * Rust returns coarse codes on purpose; 'network' is the only one that means
 * "keep the local changes and try again later" rather than "tell the user".
 */
function rethrow(error: unknown): never {
  if (typeof error === 'string' && error === 'network') {
    throw new NetworkError();
  }
  throw error instanceof Error ? error : new Error(String(error));
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    return rethrow(error);
  }
}

async function callPlugin<T>(command: string, payload: unknown): Promise<T> {
  try {
    return await invoke<T>(`plugin:${PLUGIN}|${command}`, { payload });
  } catch (error) {
    return rethrow(error);
  }
}

class TauriVaultStore implements LocalVaultStore {
  exists(): Promise<boolean> {
    return call<boolean>('vault_exists');
  }

  async read(): Promise<ArrayBuffer> {
    return fromBase64(await call<string>('vault_read'));
  }

  async write(data: ArrayBuffer): Promise<void> {
    // The host writes to a temp file, fsyncs, and renames over the original, so
    // this either replaces the vault completely or leaves it untouched.
    await call('vault_write', { contentsB64: toBase64(data) });
  }
}

class TauriSettingsStore implements SettingsStore {
  async load(): Promise<Settings> {
    return { ...DEFAULT_SETTINGS, ...(await call<Settings>('settings_load')) };
  }

  async save(settings: Settings): Promise<void> {
    await call('settings_save', { settings });
  }
}

class TauriSyncStateStore implements SyncStateStore {
  async load(): Promise<SyncState> {
    return { ...EMPTY_SYNC_STATE, ...(await call<SyncState>('sync_state_load')) };
  }

  async save(state: SyncState): Promise<void> {
    await call('sync_state_save', { state });
  }
}

class TauriDriveClient implements DriveClient {
  async isConnected(): Promise<boolean> {
    const status = await call<{ configured: boolean; connected: boolean }>('drive_status');
    return status.configured && status.connected;
  }

  findFile(vaultId: string): Promise<DriveFileMeta | null> {
    return call<DriveFileMeta | null>('drive_find_file', { vaultId });
  }

  getMetadata(fileId: string): Promise<DriveFileMeta> {
    return call<DriveFileMeta>('drive_get_metadata', { fileId });
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    return fromBase64(await call<string>('drive_download', { fileId }));
  }

  create(vaultId: string, data: ArrayBuffer): Promise<DriveFileMeta> {
    return call<DriveFileMeta>('drive_create', {
      vaultId,
      contentsB64: toBase64(data),
    });
  }

  update(fileId: string, data: ArrayBuffer): Promise<DriveFileMeta> {
    return call<DriveFileMeta>('drive_update', {
      fileId,
      contentsB64: toBase64(data),
    });
  }
}

class TauriClipboard implements Clipboard {
  async writeSensitive(text: string): Promise<void> {
    await callPlugin('clipboard_write_sensitive', { text });
  }

  async clearIfMatches(expected: string): Promise<boolean> {
    const result = await callPlugin<{ cleared: boolean }>('clipboard_clear_if_matches', {
      expected,
    });
    return result.cleared;
  }
}

class TauriBiometrics implements Biometrics {
  async status(): Promise<BiometricStatus> {
    return callPlugin<BiometricStatus>('biometric_status', {});
  }

  async enrol(keyMaterial: Uint8Array): Promise<void> {
    // Base64 rather than an array of numbers: it is the same bytes, but it
    // keeps the value opaque in any IPC trace.
    await callPlugin('secure_store_set', {
      slot: 'biometricKeyMaterial',
      value: toBase64(keyMaterial.slice().buffer),
    });
  }

  async retrieve(reason: string): Promise<Uint8Array | null> {
    const result = await callPlugin<{ value: string | null }>('secure_store_get', {
      slot: 'biometricKeyMaterial',
      reason,
    });
    if (!result.value) return null;
    return new Uint8Array(fromBase64(result.value));
  }

  async forget(): Promise<void> {
    await callPlugin('secure_store_delete', { slot: 'biometricKeyMaterial' });
  }
}

export function createTauriPlatform(): Platform {
  // `platform()` is synchronous in plugin-os v2 and returns 'windows',
  // 'android', 'linux', and so on.
  const name = osPlatform();
  const isAndroid = name === 'android';

  return {
    name,
    isAndroid,
    isDesktop: !isAndroid && name !== 'ios',

    local: new TauriVaultStore(),
    settings: new TauriSettingsStore(),
    syncState: new TauriSyncStateStore(),
    drive: new TauriDriveClient(),
    clipboard: new TauriClipboard(),
    biometrics: new TauriBiometrics(),

    async driveConfigured() {
      const status = await call<{ configured: boolean }>('drive_status');
      return status.configured;
    },

    async driveConnected() {
      const status = await call<{ connected: boolean }>('drive_status');
      return status.connected;
    },

    async connectDrive() {
      await call('drive_connect');
    },

    async disconnectDrive() {
      await call('drive_disconnect');
    },

    async setScreenCaptureBlocked(blocked: boolean) {
      await callPlugin('set_screen_capture_blocked', { blocked });
    },

    async openExternal(url: string) {
      // Only http(s) reaches the system browser. A `file:` or custom-scheme URL
      // stored in an entry should not be able to launch something on the host.
      if (!/^https?:\/\//i.test(url)) return;
      await openUrl(url);
    },

    async onLockRequested(handler) {
      return listen('vault://lock-requested', () => handler());
    },

    async onOauthCallback(handler) {
      const subscription = await addPluginListener(
        PLUGIN,
        'oauth-callback',
        (payload: { url: string }) => handler(payload.url),
      );
      return () => subscription.unregister();
    },

    vaultExists() {
      return call<boolean>('vault_exists');
    },

    backupExists() {
      return call<boolean>('vault_backup_exists');
    },

    async restoreBackup() {
      await call('vault_restore_backup');
    },
  };
}

/**
 * Hand the host the OAuth client ID for this platform.
 *
 * Two clients are required — Google validates a desktop client by loopback
 * redirect and an Android client by package name plus signing-key SHA-1 — so
 * the right one is chosen here and the host never has to know which platform it
 * is serving. An empty value is how an unconfigured build reports itself, and
 * the app stays local-only.
 */
export async function configureDrive(platform: Platform): Promise<void> {
  const clientId = platform.isAndroid
    ? import.meta.env.VITE_GOOGLE_CLIENT_ID_ANDROID
    : import.meta.env.VITE_GOOGLE_CLIENT_ID_DESKTOP;

  await call('drive_configure', { clientId: clientId ?? '' });
}

export async function completeOauthRedirect(url: string): Promise<void> {
  await call('drive_complete_auth', { url });
}
