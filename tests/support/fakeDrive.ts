import {
  DriveClient,
  DriveFileMeta,
  LocalVaultStore,
  NetworkError,
  SyncState,
  SyncStateStore,
  EMPTY_SYNC_STATE,
} from '@/sync/types';

/**
 * A stand-in for Google Drive that reproduces the property the sync design is
 * built around: **there is no conditional write.**
 *
 * `update` always succeeds and always bumps the revision, whatever the caller
 * believed the revision to be. That is what real Drive does, and it is why the
 * engine has to verify after writing rather than relying on the server to
 * reject a stale write.
 */
export class FakeDrive implements DriveClient {
  private files = new Map<
    string,
    { name: string; content: ArrayBuffer; revision: number }
  >();
  private nextId = 1;

  connected = true;
  /** Set to fail every call, to simulate being offline. */
  offline = false;

  /** Call counts, so tests can assert the check-write-verify ordering happened. */
  readonly calls = { getMetadata: 0, download: 0, update: 0, create: 0, findFile: 0 };

  /**
   * Runs immediately after an `update` writes but before it returns, letting a
   * test interleave another device's write into the exact window the engine's
   * post-write verification exists to catch.
   */
  onAfterUpdate: (() => void) | null = null;

  /** Throw a NetworkError from the next `update`, once. */
  failNextUpdate = false;

  private guard(): void {
    if (this.offline) throw new NetworkError();
  }

  private meta(id: string): DriveFileMeta {
    const file = this.files.get(id);
    if (!file) throw new Error('not found');
    return {
      id,
      name: file.name,
      headRevisionId: String(file.revision),
      modifiedTime: new Date(file.revision * 1000).toISOString(),
    };
  }

  async isConnected(): Promise<boolean> {
    return this.connected && !this.offline;
  }

  async findFile(vaultId: string): Promise<DriveFileMeta | null> {
    this.guard();
    this.calls.findFile++;
    const name = `vault-${vaultId}.kdbx`;
    for (const [id, file] of this.files) {
      if (file.name === name) return this.meta(id);
    }
    return null;
  }

  async getMetadata(fileId: string): Promise<DriveFileMeta> {
    this.guard();
    this.calls.getMetadata++;
    return this.meta(fileId);
  }

  async download(fileId: string): Promise<ArrayBuffer> {
    this.guard();
    this.calls.download++;
    const file = this.files.get(fileId);
    if (!file) throw new Error('not found');
    return file.content.slice(0);
  }

  async create(vaultId: string, data: ArrayBuffer): Promise<DriveFileMeta> {
    this.guard();
    this.calls.create++;
    const id = `file-${this.nextId++}`;
    this.files.set(id, {
      name: `vault-${vaultId}.kdbx`,
      content: data.slice(0),
      revision: 1,
    });
    return this.meta(id);
  }

  async update(fileId: string, data: ArrayBuffer): Promise<DriveFileMeta> {
    this.guard();
    if (this.failNextUpdate) {
      this.failNextUpdate = false;
      throw new NetworkError();
    }

    this.calls.update++;
    const file = this.files.get(fileId);
    if (!file) throw new Error('not found');

    // Unconditional. No precondition is checked because Drive checks none.
    file.content = data.slice(0);
    file.revision += 1;
    const result = this.meta(fileId);

    this.onAfterUpdate?.();
    return result;
  }

  /** Write directly, as a third party would. Used to forge concurrent writes. */
  writeDirectly(fileId: string, data: ArrayBuffer): void {
    const file = this.files.get(fileId);
    if (!file) throw new Error('not found');
    file.content = data.slice(0);
    file.revision += 1;
  }

  contentsOf(fileId: string): ArrayBuffer {
    const file = this.files.get(fileId);
    if (!file) throw new Error('not found');
    return file.content.slice(0);
  }

  onlyFileId(): string {
    const ids = [...this.files.keys()];
    if (ids.length !== 1) throw new Error(`expected one file, found ${ids.length}`);
    return ids[0] as string;
  }
}

/** The local `.kdbx` cache, in memory. */
export class MemoryVaultStore implements LocalVaultStore {
  private data: ArrayBuffer | null = null;
  writes = 0;

  async exists(): Promise<boolean> {
    return this.data !== null;
  }

  async read(): Promise<ArrayBuffer> {
    if (!this.data) throw new Error('no local vault');
    return this.data.slice(0);
  }

  async write(data: ArrayBuffer): Promise<void> {
    this.writes++;
    // Copied on write, matching the atomic replace on disk: a reader either
    // sees the whole old file or the whole new one.
    this.data = data.slice(0);
  }
}

export class MemorySyncStateStore implements SyncStateStore {
  private state: SyncState = { ...EMPTY_SYNC_STATE };

  async load(): Promise<SyncState> {
    return { ...this.state };
  }

  async save(state: SyncState): Promise<void> {
    this.state = { ...state };
  }

  /** Peek, for assertions. */
  current(): SyncState {
    return { ...this.state };
  }
}
