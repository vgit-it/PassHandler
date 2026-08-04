import { SyncEngine } from '@/sync/syncEngine';
import { Vault } from '@/vault/vault';
import { FakeDrive, MemorySyncStateStore, MemoryVaultStore } from './fakeDrive';

/**
 * One installation of the app: its own local vault cache, its own sync state,
 * pointed at a shared FakeDrive.
 *
 * This is what makes the two-device scenarios in the PRD testable without two
 * devices. The sync engine has no platform dependencies, so the only difference
 * between this and a real phone is where the bytes land.
 */
export class Device {
  vault: Vault | null = null;
  readonly local = new MemoryVaultStore();
  readonly stateStore = new MemorySyncStateStore();
  readonly engine: SyncEngine;

  constructor(
    readonly name: string,
    readonly drive: FakeDrive,
  ) {
    this.engine = new SyncEngine({
      drive,
      local: this.local,
      stateStore: this.stateStore,
      getVault: () => this.vault,
    });
  }

  /** Create a brand-new vault on this device. */
  static async createNew(name: string, drive: FakeDrive, password: string): Promise<Device> {
    const device = new Device(name, drive);
    device.vault = await Vault.create(password);
    await device.engine.load();
    await device.local.write(await device.vault.save());
    return device;
  }

  /**
   * Set up a second device the way onboarding does: pull the existing vault
   * from Drive and unlock it with the master password.
   */
  static async adoptFromDrive(
    name: string,
    drive: FakeDrive,
    password: string,
    vaultId: string,
  ): Promise<Device> {
    const device = new Device(name, drive);

    const remote = await drive.findFile(vaultId);
    if (!remote) throw new Error('no remote vault to adopt');

    const bytes = await drive.download(remote.id);
    device.vault = await Vault.unlock(bytes, password);

    await device.engine.load();
    await device.local.write(bytes);
    await device.engine.sync();
    return device;
  }

  /** Simulate a restart: drop in-memory state, reload from disk. */
  async restart(password: string): Promise<void> {
    this.vault?.lock();
    this.vault = await Vault.unlock(await this.local.read(), password);
    await this.engine.load();
    this.engine.restoreEditState();
  }

  titles(): string[] {
    return (this.vault?.listEntries() ?? []).map((e) => e.title).sort();
  }

  find(title: string) {
    return (this.vault?.listEntries() ?? []).find((e) => e.title === title);
  }

  password(title: string): string | null {
    const entry = this.find(title);
    return entry ? (this.vault?.readPassword(entry.id) ?? null) : null;
  }

  async addEntry(input: { title: string; username?: string; password?: string }) {
    this.vault!.addEntry(input);
    await this.engine.markDirtyAndSave();
  }

  async editEntry(title: string, changes: { username?: string; password?: string }) {
    const entry = this.find(title);
    if (!entry) throw new Error(`${this.name}: no entry titled ${title}`);
    this.vault!.updateEntry(entry.id, {
      title,
      username: changes.username ?? entry.username,
      password: changes.password ?? this.vault!.readPassword(entry.id) ?? '',
    });
    await this.engine.markDirtyAndSave();
  }

  async deleteEntry(title: string) {
    const entry = this.find(title);
    if (!entry) throw new Error(`${this.name}: no entry titled ${title}`);
    this.vault!.deleteEntry(entry.id);
    await this.engine.markDirtyAndSave();
  }
}

/**
 * KDBX stores modification times with one-second resolution, so two edits made
 * inside the same second are indistinguishable to a merge. Tests that depend on
 * "A edited this before B did" have to leave a real gap.
 */
export function waitForNextSecond(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 1100));
}
