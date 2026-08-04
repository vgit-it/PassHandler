/**
 * What the header shows. These four are the whole vocabulary, and the rule is
 * that they must be honest: "Synced" is only ever displayed when the local
 * vault and the Drive copy are known to agree.
 */
export type SyncStatus =
  /** No Drive client configured, or the user has not connected. Local-only. */
  | 'disabled'
  /** Local and remote agree as of the last verified exchange. */
  | 'synced'
  /** An exchange is in flight. */
  | 'syncing'
  /** Local changes are waiting for the network to come back. */
  | 'offline'
  /** Needs the user: a different master password, or a stubborn conflict. */
  | 'conflict';

export type ConflictReason =
  /**
   * The remote will not open with the current key. Merging is impossible —
   * the master password was changed on another device.
   */
  | 'different-master-password'
  /** The remote file is present but unreadable. Never resolved by overwriting. */
  | 'remote-unreadable'
  /**
   * Another device wrote while we were writing. Not an error: the next cycle
   * pulls and merges, and per-entry timestamps resolve it without data loss.
   */
  | 'concurrent-write';

export interface SyncSnapshot {
  status: SyncStatus;
  /** Epoch milliseconds of the last exchange that ended in agreement. */
  lastSyncAt: number | null;
  /** True when there are local changes not yet on Drive. */
  pendingChanges: boolean;
  conflict: ConflictReason | null;
}

/** Persisted across restarts. Contains no secrets — see prefs.rs. */
export interface SyncState {
  driveFileId: string | null;
  /**
   * The revision both sides last agreed on.
   *
   * Drive offers no conditional write, so this local record is the only way to
   * notice that someone else has written since we last looked.
   */
  lastKnownRevision: string | null;
  dirty: boolean;
  lastSyncAt: number | null;
  editState: unknown;
  vaultId: string | null;
}

export const EMPTY_SYNC_STATE: SyncState = {
  driveFileId: null,
  lastKnownRevision: null,
  dirty: false,
  lastSyncAt: null,
  editState: null,
  vaultId: null,
};

export interface DriveFileMeta {
  id: string;
  name: string;
  headRevisionId: string | null;
  modifiedTime: string | null;
}

/**
 * The transport the sync engine drives.
 *
 * Deliberately dumb: it moves bytes and reports revisions, and makes no
 * decisions. Everything about what to do when revisions disagree lives in the
 * engine, where it can be tested against a fake without a network.
 */
export interface DriveClient {
  isConnected(): Promise<boolean>;
  findFile(vaultId: string): Promise<DriveFileMeta | null>;
  getMetadata(fileId: string): Promise<DriveFileMeta>;
  download(fileId: string): Promise<ArrayBuffer>;
  create(vaultId: string, data: ArrayBuffer): Promise<DriveFileMeta>;
  update(fileId: string, data: ArrayBuffer): Promise<DriveFileMeta>;
}

export interface LocalVaultStore {
  exists(): Promise<boolean>;
  read(): Promise<ArrayBuffer>;
  write(data: ArrayBuffer): Promise<void>;
}

export interface SyncStateStore {
  load(): Promise<SyncState>;
  save(state: SyncState): Promise<void>;
}

/**
 * A network failure, as distinct from anything else that can go wrong.
 *
 * The distinction matters: a network failure means "try again later, keep the
 * local changes, show Offline", whereas anything else needs the user to know.
 */
export class NetworkError extends Error {
  constructor(message = 'network') {
    super(message);
    this.name = 'NetworkError';
  }
}
