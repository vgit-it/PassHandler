/**
 * The shape the UI sees.
 *
 * Note what is missing: the password. Entry passwords are never carried in the
 * list model, never held in React state and never put in a component prop. They
 * are read one at a time, on demand, straight out of the in-memory `kdbxweb`
 * database — see `Vault.readPassword`. Anything in this interface may end up in
 * a React DevTools snapshot; nothing in it is secret.
 */
export interface VaultEntry {
  id: string;
  title: string;
  username: string;
  url: string;
  notes: string;
  /** Epoch milliseconds. Used for sorting and for conflict explanations. */
  updatedAt: number;
}

/** What the editor submits. Absent fields are left untouched. */
export interface EntryInput {
  title: string;
  username?: string;
  password?: string;
  url?: string;
  notes?: string;
}

/**
 * Why an unlock failed.
 *
 * `wrong-password-or-corrupt` is one case on purpose. Telling the user which of
 * the two it was tells an attacker with the file whether a guess was close, and
 * the PRD is explicit that unlock failures are indistinguishable.
 */
export type UnlockFailure =
  | 'wrong-password-or-corrupt'
  | 'unsupported-format'
  | 'no-vault';

export class VaultError extends Error {
  constructor(public readonly reason: UnlockFailure) {
    // The message is a stable code, never a description of what went wrong
    // internally, because it may be rendered or logged by a caller.
    super(reason);
    this.name = 'VaultError';
  }
}
