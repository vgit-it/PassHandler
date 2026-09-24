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
import { EMPTY_SYNC_STATE, SyncSnapshot } from '../sync/types';
import { toFillText } from '../vault/fillFormat';
import { Vault } from '../vault/vault';
import { EntryField, EntryInput, LOGIN_TYPE_ID, VaultEntry, VaultError } from '../vault/types';
import { isKnownEntryType } from '../vault/entryTypes';
import {
  DraftSnapshot,
  DraftState,
  EntryTypeOption,
  draftFieldDefsForType,
  draftSnapshot,
  draftToEntryInput,
  emptyDraft,
  hasDraftContent,
  listEntryTypeOptions,
  listKnownEmails,
} from '../vault/accountCreationDraft';
import { DEFAULT_SETTINGS, ExportOutcome, Platform, Settings } from '../platform/ports';
import { completeOauthRedirect, configureDrive } from '../platform/tauri';
import { GeneratorOptions, clampLength, generatePassword } from '../crypto/generator';

export type Phase = 'loading' | 'onboarding' | 'locked' | 'unlocked';

/**
 * Android manual fill's whole bridge surface — see
 * `docs/MANUAL-FILL-DESIGN.md` and the effect below that installs this.
 * `VaultIme.kt`'s `WebViewBridge.kt` calls these two functions via
 * `evaluateJavascript`; nothing else in the codebase calls them.
 *
 * `listEntries` now sends each entry's full `fields` array — the same
 * `EntryField[]` shape `VaultEntry` already carries, sensitive values
 * included as `''` exactly like the app-side list model — rather than a
 * fixed `{ id, title, username }`. `readPassword(id)` became
 * `readField(id, key)`, generalised the same way `Vault.readField` was: a
 * sensitive field's real value is fetched only once its own fill button is
 * tapped, by key, never listed alongside the entry. `WebViewBridge.kt` and
 * `VaultIme.kt` were updated to match this shape in the same pass —
 * see the project's conflict-analysis doc for what's still deferred beyond
 * this (frecency, session persistence).
 *
 * Every function here (and every function on `VaultCreateBridge`
 * below) starts by calling `enforceAutoLockOnBridgeCall` — see that
 * callback's own doc comment and `docs/MANUAL-FILL-DESIGN.md`'s "Bug found
 * after shipping" section for why: this bridge is the one call site that
 * still runs while this page is fully backgrounded, so it's the one place
 * left that can actually enforce the idle timeout for an IME-only session.
 */
interface VaultFillBridge {
  listEntries(): { id: string; title: string; type: string; fields: EntryField[] }[];
  readField(id: string, key: string): string | null;
  /** The keyboard's own "Lock" key — see `WebViewBridge.lockVault` on the
   * Kotlin side. A plain pass-through to this provider's own `lock`
   * action, exposed here because locking is app/vault state, same as
   * `listEntries`/`readField`. Also where an in-progress account-creation
   * draft gets finalized — see `lock`'s own comment below and
   * `VaultCreateBridge`'s doc further down. */
  lock(): void;
}

// The draft's own state shape, field-list derivation, wire-snapshot
// building, and `EntryInput` construction all live in
// `vault/accountCreationDraft.ts` now — pure logic, unit-tested there
// (`tests/accountCreationDraft.test.ts`) the same way `entryTypes.ts`/
// `emailSuggestions.ts` are, rather than defined inline here where nothing
// could import and test them without pulling in this file's own
// `@tauri-apps/*` chain. See that module's own top doc for the fuller
// story: this file had silently drifted back to a fixed Login-only draft
// shape while the Kotlin IME side moved on to the generic one that module
// now defines — a cross-language contract drift invisible to
// `typecheck`/`lint`/`test`/`build`, which is exactly what left the
// creation panel with no fields to render, for any draft, of any type.

/**
 * The streamlined account-creation flow's bridge surface — see
 * `docs/ACCOUNT-CREATION-DESIGN.md`. Installed the same way, under the same
 * `phase === 'unlocked'` guard, as `VaultFillBridge` above; kept as a
 * second global rather than folded into it because the two are
 * conceptually different things to ask for — picking/filling an *existing*
 * entry, versus building up a brand-new one that isn't in the vault yet —
 * even though both end up living in this same file.
 */
interface VaultCreateBridge {
  /** Starts a brand-new draft, discarding any previous one that was never
   * committed. Always starts as a Login draft — `setDraftType` switches it
   * afterwards. `titleGuess` seeds the draft's title — the IME's own
   * best-effort guess from the focused app's package name, see
   * `VaultIme.kt` — applied whenever it's non-blank; the user can
   * always overwrite it later in the ordinary entry editor, same as any
   * other field this flow fills in. */
  startDraft(titleGuess: string): void;
  /** Every selectable entry type, for the creation panel's "Type" row —
   * independent of any draft being active. */
  listEntryTypes(): EntryTypeOption[];
  /** Switches the in-progress draft to a different type, resetting every
   * field back to blank — kept to that one simple rule rather than trying
   * to carry a value across two types' unrelated fields (even a same-named
   * one: `password` means the same *slot* on both `login` and `wifi`, but
   * not the same *thing* to a user re-reading the panel a moment later).
   * Only `title` survives a type switch. A no-op if the type is unrecognised
   * or there's no draft active. */
  setDraftType(type: string): void;
  /** The in-progress draft, or `null` if none is active — for the IME's
   * creation panel to render which fields already have a value. */
  getDraft(): DraftSnapshot | null;
  /** Generates a fresh password using the draft's own stored
   * `passwordOptions` (not always the app's `DEFAULT_OPTIONS`), stores it
   * into the draft, and returns the plaintext once so the keyboard can type
   * it into whatever field is focused. `null` if there's no draft, or the
   * current type has no `password` field. */
  generateDraftPassword(): string | null;
  /** Changes the draft's generator settings and immediately regenerates
   * with them, storing and returning the fresh plaintext the same way
   * `generateDraftPassword` does. `length` is clamped the same way the
   * app's own generator clamps it; an all-character-class-disabled
   * combination is refused (returns `null`, changing nothing) as a
   * backstop — the Kotlin panel already locks the last enabled toggle
   * (mirroring `canDisable`), so this should never actually be exercised in
   * practice. */
  setDraftPasswordOptions(options: GeneratorOptions): string | null;
  /** Every distinct email-shaped value already stored anywhere in the
   * vault, for the Email field's own "Pick from Vault" dropdown —
   * independent of any draft being active. */
  listKnownEmails(): string[];
  /** Records a value the user picked from an already-saved entry — via the
   * same pick-and-fill mechanism `window.__vaultFill` already exposes
   * — into the draft's `key` field. The IME types the value into the
   * focused app field itself, through its own `InputConnection`; this call
   * only keeps the draft in sync so the value survives an app switch and
   * ends up in the eventual commit. A no-op for a key that isn't one of the
   * current type's own fields, or with no draft active. */
  setDraftField(key: string, value: string): void;
  /** Commits the draft to the vault right now — one `Vault.addEntry`
   * immediately followed by one `Vault.setNeedsReview(id, true)` — and
   * clears it. `false` if there's no draft, or it has nothing worth saving
   * (see `hasDraftContent`). Called from the IME's own "Done". */
  commitDraft(): boolean;
  /** Discards the draft without saving anything — the IME's "Cancel". */
  cancelDraft(): void;
}

declare global {
  interface Window {
    __vaultFill?: VaultFillBridge;
    __vaultCreate?: VaultCreateBridge;
    /** Set to `'fill'` by Android's `MainActivity` while it waits for an
     * unlock it was launched for from the IME's "Unlock Vault" link (see
     * `docs/MANUAL-FILL-DESIGN.md`'s "Launch flag for the web side"). Only
     * ever suppresses the unlock reveal animation — nothing
     * security-relevant may key off it, since any page script could set it. */
    __vaultLaunchContext?: string;
  }
}

/** Reads and clears the native launch flag — one flag, one unlock. */
function consumeFillLaunch(): boolean {
  const fromFill = window.__vaultLaunchContext === 'fill';
  delete window.__vaultLaunchContext;
  return fromFill;
}

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
  /** The connected account's email, once known. `null` while unconnected or
   * still fetching — Settings should just omit the line rather than wait. */
  driveAccountEmail: string | null;
  /** Set when the last unlock attempt failed. Always the same generic text. */
  unlockError: string | null;
  busy: boolean;
  /** True for the last 30s before auto-lock actually fires — the vault
   * doors' "creep" warning (`docs/vault-visual-language-spec.md` §5: "Idle
   * at (timeout − 30s): add creep — doors ease back in 9px, bolts return
   * to thrown position... No dialog, no countdown text. The doors closing
   * IS the warning."). Computed alongside the existing auto-lock interval
   * below rather than as a second timer, and cleared the instant
   * `noteActivity` fires — see that callback's own doc. `false` whenever
   * auto-lock is off (`autoLockMinutes === null`) or the vault isn't
   * unlocked in the first place. */
  autoLockCreeping: boolean;
  /**
   * True only in the render right after a real, user-triggered phase
   * transition — `lock()` on the way to `'locked'`, `unlock()`/
   * `unlockWithBiometrics()` on the way to `'unlocked'` — never on a cold
   * start that lands directly on either phase with no transition to
   * animate. Drives the locked⇄unlocked handoff choreography
   * (`src/ui/lockTransitionTiming.ts`): `Unlock.tsx` and `VaultScreen.tsx`
   * each capture this value once, at their own mount, to decide whether
   * their entrance should play (a real transition) or appear already
   * settled (everything else — including onboarding finishing, which never
   * sets this).
   *
   * Lives in the store, not threaded down as a prop the way `App.tsx`'s own
   * `exiting`/`lingeringUnlock` are, because those two components need the
   * answer in time for their own FIRST render — no `useEffect` in `App.tsx`
   * fires early enough, and diffing `phase` against a ref during render
   * isn't reliably safe under Strict Mode's double-invocation. `store.tsx`
   * already knows the answer for free, at the exact moment it flips
   * `phase`, since it's the one making that decision — so `setPhase` and
   * this both update together, same call, same batch.
   *
   * Never explicitly reset back to `false`: a mount only ever happens as a
   * direct result of the same `lock()`/`unlock()` call that also sets this,
   * so there is no path where a later, unrelated mount could see a stale
   * `true` — each consumer's own one-time capture (`Unlock.tsx`'s
   * `justLocked`) or ref (`VaultScreen.tsx`'s `justUnlockedRef`) is what
   * stops it from replaying on every subsequent re-render after that.
   */
  justTransitioned: boolean;
  /**
   * Whether `VaultScreen`'s unlock reveal (`docs/vault-visual-language-spec.md`
   * §5.1) should play on its next mount: true after a password or biometric
   * unlock from the lock screen, false after one launched from the Android
   * IME (the app backgrounds itself straight away) and after onboarding's
   * `createVault`/`adoptRemoteVault` (no doors to open). Set BEFORE the
   * phase flips, so it's already right on `VaultScreen`'s first render.
   * `VaultScreen` captures it once at mount; reduced motion is checked
   * there, not here.
   */
  playUnlockReveal: boolean;
  /** Set the instant `createVault`/`adoptRemoteVault` finishes, so the very
   * first screen after onboarding (`EntryList`'s empty state) can show a
   * one-time "Vault created" welcome — and, if this device supports it, a
   * biometric-unlock offer — instead of the plain "This vault is empty"
   * message a later, ordinary empty vault gets. See
   * `docs/UI-UX-REVIEW.md`'s onboarding critique for why: without this,
   * account creation had no confirmation moment at all — the phase flip to
   * `'unlocked'` happens synchronously inside `createVault`, so there is no
   * point in the flow left for `Onboarding.tsx` itself to show one.
   * Cleared by `dismissOnboardingWelcome` — see that action's own doc for
   * when. */
  justOnboarded: boolean;
}

interface AppActions {
  createVault(masterPassword: string, connectDrive: boolean): Promise<void>;
  adoptRemoteVault(masterPassword: string): Promise<void>;
  unlock(masterPassword: string): Promise<boolean>;
  unlockWithBiometrics(): Promise<boolean>;
  lock(): void;
  noteActivity(): void;

  readPassword(id: string): string | null;
  readField(id: string, key: string): string | null;
  addEntry(input: EntryInput): Promise<void>;
  updateEntry(id: string, input: EntryInput): Promise<void>;
  deleteEntry(id: string): Promise<void>;

  syncNow(): Promise<void>;
  /** Second device, before any vault exists locally: fetch the remote bytes
   * so `adoptRemoteVault` has something to unlock. */
  pullRemoteVault(): Promise<void>;
  saveSettings(next: Partial<Settings>): Promise<void>;
  changeMasterPassword(next: string): Promise<void>;

  connectDrive(): Promise<void>;
  disconnectDrive(): Promise<void>;
  /** A plain status read — unlike `connectDrive`, never opens the OAuth
   * browser, just asks the platform "is Drive actually connected right
   * now" and syncs `driveConnected`/`driveAccountEmail` to match. For
   * `Onboarding.tsx`'s own resume-after-restart handling: whether *this*
   * app process is the one that ran the original `connectDrive()` or not,
   * the answer here is authoritative either way, since it's the token
   * exchange landing in secure storage that actually decides it, not
   * anything held in this process's own memory. */
  checkDriveConnected(): Promise<boolean>;
  enrolBiometrics(): Promise<boolean>;
  disableBiometrics(): Promise<void>;
  restoreBackup(): Promise<void>;
  exportVault(): Promise<ExportOutcome>;
  /**
   * Replace the vault on this device with `data` — a `.kdbx` file picked
   * locally, or downloaded from Drive. See `docs/RESTORE-VAULT-DESIGN.md`
   * for why this does more than a plain write: it also clears sync state
   * and discards the running session's `SyncEngine`, so the next automatic
   * sync cannot merge the restored vault against a stale reference to
   * whatever vault used to be here.
   */
  restoreVault(data: ArrayBuffer): Promise<void>;
  /** Turns off `justOnboarded` — either because the welcome was shown and
   * the user dismissed it (Skip on the biometric offer), or because they
   * enrolled biometrics from it (see `EntryList.tsx`'s `EmptyState`, which
   * calls this directly rather than waiting on `biometricEnrolled` to flip,
   * so "Skip" and "Enabled" both close the same way). Never called
   * automatically on a timer or on navigation — the welcome is meant to
   * stay until the person actually does something with it. */
  dismissOnboardingWelcome(): void;
}

const Ctx = createContext<(AppState & AppActions) | null>(null);

export function useApp(): AppState & AppActions {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

const GENERIC_UNLOCK_ERROR =
  'Could not open the vault. Check your master password and try again.';

/** Last-resort backstop for `unlockWithBiometrics`, so a native biometric
 * call that never settles can't leave `busy` — and the whole lock screen —
 * stuck forever. A real prompt is always answered or cancelled by the user
 * in well under this, and the native side now fails fast on its own when
 * it can't even show the prompt (see `VaultPlugin.kt`'s
 * `promptBiometric`); this is only for whatever neither of those two
 * things anticipated. */
const BIOMETRIC_TIMEOUT_MS = 20_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('biometric prompt timed out')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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
  // The streamlined account-creation flow's in-progress draft — see
  // `VaultCreateBridge`'s doc above. A ref, not React state, for the
  // same reason `vaultRef` is: a generated password, or a value pulled out
  // of an unlocked entry, has no business in a DevTools snapshot or a
  // render trace.
  const draftRef = useRef<DraftState | null>(null);

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
  const [driveAccountEmail, setDriveAccountEmail] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autoLockCreeping, setAutoLockCreeping] = useState(false);
  const [justOnboarded, setJustOnboarded] = useState(false);
  const [justTransitioned, setJustTransitioned] = useState(false);
  const [playUnlockReveal, setPlayUnlockReveal] = useState(false);

  const refreshEntries = useCallback(() => {
    setEntries(vaultRef.current?.listEntries() ?? []);
  }, []);

  const engine = useCallback((): SyncEngine => {
    if (!engineRef.current) {
      engineRef.current = new SyncEngine({
        drive: platform.drive,
        local: platform.local,
        stateStore: platform.syncState,
        getVault: () => vaultRef.current,
        // A pull-and-merge triggered by a background sync — the other
        // device's new entry arriving here, say — mutates the vault in
        // memory but has no other way to tell React the list on screen is
        // now stale. Without this, the new entry was only ever visible after
        // something else happened to call `refreshEntries` anyway (locking
        // and unlocking again, notably), never as a direct result of the
        // sync that actually brought it in. Every status change is a cheap
        // enough moment to just re-read the list rather than work out which
        // of syncing/synced/offline/conflict actually changed something.
        onChange: (snapshot) => {
          setSync(snapshot);
          refreshEntries();
        },
      });
    }
    return engineRef.current;
  }, [platform, refreshEntries]);

  const noteActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    // Spec: "Any pointerdown/keydown/wheel resets both timers and removes
    // creep." The functional form only actually triggers a re-render when
    // creep was true — setting `false` to `false` is a no-op React bails
    // out of via `Object.is`, which matters here since `noteActivity` fires
    // on every one of those events, not just the rare ones near the
    // auto-lock deadline.
    setAutoLockCreeping((creeping) => (creeping ? false : creeping));
  }, []);

  /**
   * Writes a draft straight to the vault, bypassing the `addEntry` action
   * (and the `mutate` wrapper it uses) so this can run synchronously and
   * report success immediately — both `window.__vaultCreate.commitDraft`
   * (a bridge method the Kotlin side awaits a same-tick answer from, via
   * `evaluateJavascript`) and `lock` below (which must finish this before
   * nulling `vaultRef`) need that. Otherwise the same shape as `mutate`:
   * refresh the list, note activity, save locally, then sync — save/sync
   * both fire without being awaited, exactly as `mutate` already does for
   * every other vault write.
   */
  const commitDraftNow = useCallback(
    (draft: DraftState): boolean => {
      const vault = vaultRef.current;
      if (!vault || !hasDraftContent(draft)) return false;

      const id = vault.addEntry(draftToEntryInput(draft));
      vault.setNeedsReview(id, true);
      refreshEntries();
      noteActivity();
      void engine().markDirtyAndSave();
      void engine().sync();
      return true;
    },
    [refreshEntries, noteActivity, engine],
  );

  const lock = useCallback(() => {
    // Nothing to lock if nothing is unlocked. Both trigger sites below —
    // backgrounding and the host's own lock request — fire unconditionally,
    // including while onboarding is still in progress: opening the system
    // browser for the Drive consent screen is itself a backgrounding event.
    // Without this guard, that knocked an in-progress "connect to an existing
    // vault" flow onto the lock screen — a dead end, since no local vault
    // exists yet for it to unlock — and the only way out was force-closing
    // and relaunching, which then correctly, but confusingly, restarts
    // onboarding from the beginning.
    if (!vaultRef.current) return;

    // Streamlined account creation: an in-progress draft is finalized here,
    // not abandoned — see docs/ACCOUNT-CREATION-DESIGN.md's "Session
    // lifetime". This has to run before `vaultRef.current.lock()` just
    // below, while the vault it needs is still decrypted.
    if (draftRef.current) {
      commitDraftNow(draftRef.current);
      draftRef.current = null;
    }

    vaultRef.current.lock();
    vaultRef.current = null;
    setEntries([]);
    setPhase('locked');
    setJustTransitioned(true);
    setPlayUnlockReveal(false);
    // The creep warning only ever makes sense while unlocked and counting
    // down toward this exact moment — clear it so a later unlock doesn't
    // inherit a stale `true` from whatever was happening right before this
    // lock (could be the creep-triggered auto-lock itself, could be a
    // manual lock that fired before creep ever started).
    setAutoLockCreeping(false);
    // Screen-capture protection is only needed while there is something to
    // protect; leaving it on would block screenshots of the lock screen too.
    void platform.setScreenCaptureBlocked(false);
  }, [platform, commitDraftNow]);

  // Android manual fill's own auto-lock enforcement — see the "Bug found
  // after shipping" section of `docs/MANUAL-FILL-DESIGN.md`. The interval
  // below and the `visibilitychange` listener further down both only run
  // while this app's own page is alive and, for the latter, foregrounded —
  // neither ever fires for a session where the vault is unlocked once and
  // then used exclusively through the Android IME from then on, since that
  // never touches this page at all. `evaluateJavascript` (how the IME calls
  // every bridge function below) runs synchronously on demand regardless of
  // page visibility, which makes every bridge call the one reliable point
  // left to enforce the same idle timeout. Every function in
  // `window.__vaultFill` and `window.__vaultCreate` calls this
  // first: it locks if the threshold has already passed, otherwise, by
  // default, treats the call itself as activity — the same "returning
  // within the grace period resets the clock" rule the `visibilitychange`
  // handler applies, now covering an IME-only session too.
  //
  // `listEntries` is the one exception, called with `countsAsActivity:
  // false` — see `VaultKeyboardView.kt`'s `autoRefreshRunnable`. It
  // re-calls `listEntries` on a 2-second timer for as long as the picker
  // is simply on screen, whether or not the user is doing anything, purely
  // so a relock elsewhere gets noticed and rendered promptly. Counting that
  // poll as activity would mean merely leaving the keyboard open — with no
  // taps, no typing — kept the vault unlocked indefinitely, which is the
  // same bug this fix exists to close, just moved rather than fixed. Every
  // other bridge call is a genuine, deliberate user action (opening the
  // picker in the first place still goes through `listEntries` too, but
  // that first call is indistinguishable here from a later poll — the
  // distinction only exists on the Kotlin side — so treating all of them
  // as non-activity is the conservative choice) and keeps the default.
  const enforceAutoLockOnBridgeCall = useCallback(
    (countsAsActivity = true) => {
      if (
        settings.autoLockMinutes !== null &&
        Date.now() - lastActivityRef.current >= settings.autoLockMinutes * 60_000
      ) {
        lock();
        return true;
      }
      if (countsAsActivity) noteActivity();
      return false;
    },
    [settings.autoLockMinutes, lock, noteActivity],
  );

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
      if (connected) {
        void platform.driveAccountEmail().then((email) => {
          if (!cancelled) setDriveAccountEmail(email);
        });
      }
      // A local vault file is reason enough to offer unlocking it, on its
      // own — `onboardingComplete` used to gate this too, but that flag only
      // turns true *after* a successful first unlock, while the vault file
      // itself is written earlier, during the Drive pull that precedes it.
      // Anything that restarts the app in that window (backgrounding for the
      // OAuth browser, a low-memory process kill — both ordinary on Android)
      // left a perfectly good vault on disk that this then discarded, sending
      // the user back to "create new / connect existing" for no reason.
      setPhase(hasVault ? 'locked' : 'onboarding');
    })().catch((err) => {
      // Without this, a failure anywhere above leaves phase stuck at
      // 'loading' — "Opening…" forever — with nothing in the console to say
      // why. Nothing caught here can carry vault contents; startup runs
      // before any vault is decrypted.
      console.error('[startup]', err);
    });

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
  // intent rather than a loopback socket. Desktop finishes the OAuth
  // round-trip entirely inside the Rust `drive_connect` command via a local
  // loopback listener, so no callback event is ever emitted there — the
  // native plugin has no `register_listener` command on desktop, and wiring
  // this up unconditionally just logs a harmless-but-noisy IPC error on
  // every launch.
  useEffect(() => {
    if (!platform.isAndroid) return;

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
  //
  // The same interval also drives the doors' "creep" warning (spec §5:
  // "Idle at (timeout − 30s): add creep") — one poll of `lastActivityRef`
  // rather than a second timer doing the same wall-clock comparison a few
  // seconds apart. `creepAt` floors at 0 so a very short `autoLockMinutes`
  // (under 30s) still creeps immediately rather than never, instead of
  // going negative and being permanently unreachable.
  useEffect(() => {
    if (phase !== 'unlocked' || settings.autoLockMinutes === null) {
      setAutoLockCreeping(false);
      return;
    }

    const timeout = settings.autoLockMinutes * 60_000;
    const creepAt = Math.max(0, timeout - 30_000);
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= timeout) lock();
      else setAutoLockCreeping(elapsed >= creepAt);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase, settings.autoLockMinutes, lock]);

  // Android: keep the vault out of the task-switcher preview and out of
  // screenshots for exactly as long as it is unlocked.
  useEffect(() => {
    if (!platform.isAndroid) return;
    void platform.setScreenCaptureBlocked(phase === 'unlocked');
  }, [platform, phase]);

  // Android manual fill: `VaultIme.kt` (a custom keyboard, native
  // Kotlin) asks the running webview these questions directly via
  // `evaluateJavascript` — see `docs/MANUAL-FILL-DESIGN.md`. Installed only
  // while unlocked, the same guard `onLockRequested`'s listener effectively
  // gets from `VaultScreen` only mounting then. This is what makes "fails
  // closed if the vault isn't unlocked" true on the Android side without
  // any native code ever needing to be told the lock state directly —
  // there's nothing installed to ask, so there's nothing to answer.
  useEffect(() => {
    if (!platform.isAndroid || phase !== 'unlocked') return;

    window.__vaultFill = {
      listEntries: () => {
        if (enforceAutoLockOnBridgeCall(false)) return [];
        return (vaultRef.current?.listEntries() ?? []).map((entry) => ({
          id: entry.id,
          title: entry.title,
          type: entry.type,
          // Sent as-is except for `value` itself: a sensitive field's is
          // already `''` on the list model (see `VaultEntry`'s doc
          // comment), so this never leaks a secret into the picker's
          // in-memory entry list — `readField` below is the only path to a
          // sensitive value, fetched only once its own fill button is
          // tapped. `value` is run through `toFillText` for the same reason
          // `VaultScreen.fillField` is on Windows: this IME has no display
          // formatting of its own (unlike `FieldRow` on the desktop side),
          // so a `monthYear`/`date` field's row shows the fill-ready digits
          // rather than raw ISO — a strict improvement — and, critically,
          // committing that same string is what actually fixes filling
          // into a masked expiry/date field. See `fillFormat.ts`.
          fields: entry.fields.map((field) => ({
            ...field,
            value: toFillText(field.dataType, field.value),
          })),
        }));
      },
      readField: (id, key) => {
        if (enforceAutoLockOnBridgeCall()) return null;
        return vaultRef.current?.readField(id, key) ?? null;
      },
      lock,
    };

    return () => {
      delete window.__vaultFill;
    };
  }, [platform.isAndroid, phase, lock, enforceAutoLockOnBridgeCall]);

  // Streamlined account creation's bridge — see `VaultCreateBridge`'s
  // doc above. Same guard, same "installed only while unlocked is what
  // makes it fail closed" reasoning as `window.__vaultFill` just
  // above. `commitDraft` writes straight to `vaultRef.current` via
  // `commitDraftNow` rather than going through the `addEntry` action, so it
  // can answer the Kotlin side synchronously — see that callback's own doc.
  useEffect(() => {
    if (!platform.isAndroid || phase !== 'unlocked') return;

    window.__vaultCreate = {
      startDraft: (titleGuess) => {
        if (enforceAutoLockOnBridgeCall()) return;
        draftRef.current = emptyDraft(LOGIN_TYPE_ID, titleGuess.trim());
      },
      listEntryTypes: () => {
        if (enforceAutoLockOnBridgeCall()) return [];
        return listEntryTypeOptions();
      },
      setDraftType: (type) => {
        if (enforceAutoLockOnBridgeCall()) return;
        if (!draftRef.current) return;
        draftRef.current = emptyDraft(isKnownEntryType(type) ? type : LOGIN_TYPE_ID, draftRef.current.title);
      },
      getDraft: () => {
        if (enforceAutoLockOnBridgeCall()) return null;
        return draftRef.current ? draftSnapshot(draftRef.current) : null;
      },
      generateDraftPassword: () => {
        if (enforceAutoLockOnBridgeCall()) return null;
        const draft = draftRef.current;
        if (!draft || !draftFieldDefsForType(draft.type).some((def) => def.key === 'password')) return null;
        const password = generatePassword(draft.passwordOptions);
        draftRef.current = { ...draft, fields: { ...draft.fields, password } };
        return password;
      },
      setDraftPasswordOptions: (options) => {
        if (enforceAutoLockOnBridgeCall()) return null;
        const draft = draftRef.current;
        if (!draft || !draftFieldDefsForType(draft.type).some((def) => def.key === 'password')) return null;
        // Backstop only, mirroring `crypto/generator.ts`'s `canDisable` —
        // the Kotlin panel already locks the last enabled toggle so this
        // all-disabled combination should never actually reach here;
        // refusing it keeps an unexpected call harmless rather than
        // throwing out of `generatePassword`.
        if (![options.uppercase, options.lowercase, options.numbers, options.symbols].some(Boolean)) {
          return null;
        }
        const passwordOptions: GeneratorOptions = { ...options, length: clampLength(options.length) };
        const password = generatePassword(passwordOptions);
        draftRef.current = { ...draft, passwordOptions, fields: { ...draft.fields, password } };
        return password;
      },
      listKnownEmails: () => {
        if (enforceAutoLockOnBridgeCall()) return [];
        // Straight off the vault, not the `entries` React state — same
        // "always fresh, no stale closure" reasoning `listEntries` above
        // already follows.
        return listKnownEmails(vaultRef.current?.listEntries() ?? []);
      },
      setDraftField: (key, value) => {
        if (enforceAutoLockOnBridgeCall()) return;
        const draft = draftRef.current;
        if (!draft) return;
        if (!draftFieldDefsForType(draft.type).some((def) => def.key === key)) return;
        draftRef.current = { ...draft, fields: { ...draft.fields, [key]: value } };
      },
      commitDraft: () => {
        // If the idle threshold has already passed, `lock()` (called by the
        // check below) already finalizes any in-progress draft itself — see
        // its own doc comment — so the draft is not lost even though this
        // call reports `false` rather than performing the commit directly.
        if (enforceAutoLockOnBridgeCall()) return false;
        const draft = draftRef.current;
        if (!draft) return false;
        const committed = commitDraftNow(draft);
        if (committed) draftRef.current = null;
        return committed;
      },
      cancelDraft: () => {
        if (enforceAutoLockOnBridgeCall()) return;
        draftRef.current = null;
      },
    };

    return () => {
      delete window.__vaultCreate;
    };
  }, [platform.isAndroid, phase, commitDraftNow, enforceAutoLockOnBridgeCall]);

  // Backgrounding on Android used to lock instantly and unconditionally, so
  // switching to another app for even a moment — copying a 2FA code, taking a
  // call — forced a full re-unlock every time. Time spent backgrounded now
  // counts as ordinary idle time instead, governed by the same auto-lock
  // setting as staying idle in the foreground: `lastActivityRef` is simply
  // left untouched while hidden, and the elapsed time since it is checked the
  // instant the app is foregrounded again, rather than waiting on the idle
  // interval below — which is not reliable while hidden anyway, since Android
  // throttles or suspends JS timers for backgrounded pages.
  useEffect(() => {
    if (!platform.isAndroid) return;

    const onVisible = () => {
      if (document.visibilityState !== 'visible' || phase !== 'unlocked') return;

      if (
        settings.autoLockMinutes !== null &&
        Date.now() - lastActivityRef.current >= settings.autoLockMinutes * 60_000
      ) {
        lock();
      } else {
        // Returning within the grace period counts as activity in its own
        // right, so several short trips in a row do not add up against the
        // one long-idle threshold this setting is meant to catch.
        noteActivity();
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [platform.isAndroid, phase, settings.autoLockMinutes, lock, noteActivity]);

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
        setPlayUnlockReveal(!consumeFillLaunch());
        await afterUnlock(vault);
        setJustTransitioned(true);
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
      const material = await withTimeout(
        platform.biometrics.retrieve('Unlock your vault'),
        BIOMETRIC_TIMEOUT_MS,
      );
      if (!material) return false;

      const bytes = await platform.local.read();
      const vault = await Vault.unlockWithKeyMaterial(bytes, material);
      material.fill(0);
      setPlayUnlockReveal(!consumeFillLaunch());
      await afterUnlock(vault);
      setJustTransitioned(true);
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
          void platform.driveAccountEmail().then(setDriveAccountEmail);
        }
        // No doors to open when arriving from onboarding — no reveal.
        setPlayUnlockReveal(false);
        await afterUnlock(vault);
        setJustOnboarded(true);
      } finally {
        setBusy(false);
      }
    },
    [platform, settings, persistSettings, afterUnlock],
  );

  /**
   * Second device, before onboarding has a vault to work with: fetch the
   * remote file's raw bytes and write them to local storage.
   *
   * Every other Drive lookup is keyed by vault ID, which lives inside the
   * file this device has not decrypted yet — `findAny` is the one query that
   * does not need it, and it exists for exactly this bootstrap step. Once
   * `adoptRemoteVault` decrypts the result, the vault ID becomes known and
   * ordinary `findFile`-based sync takes over from then on.
   */
  const pullRemoteVault = useCallback(async () => {
    const remote = await platform.drive.findAny();
    if (!remote) throw new VaultError('no-vault');

    const bytes = await platform.drive.download(remote.id);
    await platform.local.write(bytes);
  }, [platform]);

  /** Second device: pull the existing vault from Drive, then unlock it. */
  const adoptRemoteVault = useCallback(
    async (masterPassword: string) => {
      setBusy(true);
      try {
        const vault = await Vault.unlock(await platform.local.read(), masterPassword);
        await persistSettings({ ...settings, onboardingComplete: true });
        // No doors to open when arriving from onboarding — no reveal.
        setPlayUnlockReveal(false);
        await afterUnlock(vault);
        setJustOnboarded(true);
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
      driveAccountEmail,
      unlockError,
      busy,
      autoLockCreeping,
      justOnboarded,
      justTransitioned,
      playUnlockReveal,

      createVault,
      adoptRemoteVault,
      pullRemoteVault,
      unlock,
      unlockWithBiometrics,
      lock,
      noteActivity,

      readPassword: (id) => vaultRef.current?.readPassword(id) ?? null,
      readField: (id, key) => vaultRef.current?.readField(id, key) ?? null,
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
          void platform.driveAccountEmail().then(setDriveAccountEmail);
          await engine().sync();
        } finally {
          setBusy(false);
        }
      },

      disconnectDrive: async () => {
        await platform.disconnectDrive();
        await engine().disconnect();
        setDriveConnected(false);
        setDriveAccountEmail(null);
      },

      checkDriveConnected: async () => {
        const connected = await platform.driveConnected();
        setDriveConnected(connected);
        if (connected) void platform.driveAccountEmail().then(setDriveAccountEmail);
        return connected;
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

      // See docs/RESTORE-VAULT-DESIGN.md's "Why this needs care" section.
      // Order matters: the write must land before the sync state is
      // cleared, and the engine must be discarded before `lock()` returns
      // control to the running app — otherwise the next automatic sync
      // (fired from `afterUnlock` once the user re-enters the restored
      // vault's password) could still be carrying the *old* vault's
      // `driveFileId`/`vaultId` in memory and try to merge against it.
      restoreVault: async (data: ArrayBuffer) => {
        await platform.local.write(data);
        await platform.syncState.save(EMPTY_SYNC_STATE);
        engineRef.current = null;
        lock();
      },

      // No vault state changes here — this only reads the already-encrypted
      // bytes off disk and hands them to the host. `busy` is still set,
      // because the Windows Save-As dialog can sit open for as long as the
      // user takes to pick a folder, same as any other slow host call.
      exportVault: async () => {
        setBusy(true);
        try {
          return await platform.exportVault();
        } finally {
          setBusy(false);
        }
      },

      dismissOnboardingWelcome: () => setJustOnboarded(false),
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
      driveAccountEmail,
      unlockError,
      busy,
      autoLockCreeping,
      justOnboarded,
      justTransitioned,
      playUnlockReveal,
      createVault,
      adoptRemoteVault,
      pullRemoteVault,
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
