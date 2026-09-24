import { SyncSnapshot } from '../../sync/types';

/**
 * The sync indicator.
 *
 * It is never allowed to flatter. "Synced" appears only when a verified
 * exchange says local and remote agree; pending local changes always show as
 * something else, because a user who sees "Synced" and closes the app has been
 * told their passwords are safe on another device.
 */
export function SyncBadge({
  sync,
  onClick,
  size = 'sm',
}: {
  sync: SyncSnapshot;
  onClick?: () => void;
  /** 'lg' is the Android home header's larger top-right indicator; 'sm'
   * (the default) is unchanged from before this existed — Windows' header
   * badge, and any other existing call site. */
  size?: 'sm' | 'lg';
}) {
  const { tone, toneLg, text, title } = describe(sync);

  const Element = onClick ? 'button' : 'div';

  // 'lg' (the Android home header's badge) now matches the Figma
  // home-screen design's own pill exactly: tight gap-[2px]/px-[6px]/
  // py-[2px], 10px text (bumped from 8px in a later design pass) — all
  // arbitrary values since none land on this app's (already-bumped)
  // Tailwind steps, same reasoning as the entry card's own arbitrary-pixel
  // sizes elsewhere in this app.
  const sizeClasses = size === 'lg' ? 'gap-[2px] px-[6px] py-[2px] text-[10px]' : 'gap-1.5 px-2.5 py-1 text-xs';
  const dotClasses = 'h-1.5 w-1.5';
  // `toneLg` is a second, fully-literal set of tone strings (below) — NOT
  // `tone` with its `/30`/`bg-*` opacity modifiers stripped at runtime.
  // That was tried first and looked right in the editor but rendered with
  // no border color at all: Tailwind's class generator only emits CSS for
  // class names it can find written out, literally, somewhere in the
  // source — a string built by `.replace()`ing pieces off `tone` at
  // runtime (e.g. turning "border-ok/30" into "border-ok") produces a
  // class name that never appears literally in the source, so no CSS rule
  // for it ever gets generated, and the border falls back to unstyled.
  const toneClasses = size === 'lg' ? toneLg : tone;

  return (
    <Element
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center rounded-full border font-medium ${sizeClasses} ${toneClasses} ${onClick ? 'hover:brightness-125' : ''}`}
    >
      <span
        className={`rounded-full bg-current ${dotClasses} ${
          sync.status === 'syncing' ? 'animate-pulse' : ''
        }`}
      />
      {text}
    </Element>
  );
}

function describe(sync: SyncSnapshot): { tone: string; toneLg: string; text: string; title: string } {
  switch (sync.status) {
    case 'synced':
      return {
        tone: 'border-ok/30 bg-ok/10 text-ok',
        // toneLg: the Figma home-screen design's own badge — solid border,
        // no fill. A literal class string, not `tone` with modifiers
        // stripped off at runtime — see the doc where this is used.
        toneLg: 'border-ok text-ok',
        text: 'Synced',
        title: sync.lastSyncAt
          ? `Last synced ${new Date(sync.lastSyncAt).toLocaleString()}`
          : 'Up to date with Google Drive',
      };

    case 'syncing':
      return {
        tone: 'border-accent/30 bg-accent/10 text-accent',
        toneLg: 'border-accent text-accent',
        text: 'Syncing',
        title: 'Exchanging changes with Google Drive',
      };

    case 'offline':
      return {
        tone: 'border-warn/30 bg-warn/10 text-warn',
        toneLg: 'border-warn text-warn',
        text: sync.pendingChanges ? 'Offline — changes pending' : 'Offline',
        title:
          'Your changes are saved on this device and will sync when the connection returns.',
      };

    case 'conflict':
      return {
        tone: 'border-bad/30 bg-bad/10 text-bad',
        toneLg: 'border-bad text-bad',
        text: conflictText(sync),
        title: conflictTitle(sync),
      };

    case 'disabled':
    default:
      return {
        tone: 'border-ink-500 bg-ink-700 text-slate-400',
        toneLg: 'border-ink-500 text-slate-400',
        text: sync.pendingChanges ? 'Local only — unsaved' : 'Local only',
        title: 'Google Drive sync is not connected. The vault works normally.',
      };
  }
}

function conflictText(sync: SyncSnapshot): string {
  return sync.conflict === 'different-master-password' ? 'Password mismatch' : 'Conflict';
}

function conflictTitle(sync: SyncSnapshot): string {
  switch (sync.conflict) {
    case 'different-master-password':
      return 'The synced vault uses a different master password.';
    case 'concurrent-write':
      return 'Another device saved at the same time. The next sync will merge both sets of changes.';
    default:
      return 'Sync needs attention.';
  }
}

/** The full-width explanation shown under the header when sync needs the user. */
export function SyncNotice({ sync }: { sync: SyncSnapshot }) {
  if (sync.status !== 'conflict') return null;

  const isPasswordMismatch = sync.conflict === 'different-master-password';

  return (
    <div
      // Top of the list, so it takes the first slot in the unlock reveal
      // (`useUnlockReveal.ts`).
      data-reveal="row"
      className={`mx-3 mb-2 rounded-lg border px-3 py-2 text-xs ${
        isPasswordMismatch
          ? 'border-bad/30 bg-bad/10 text-bad'
          : 'border-warn/30 bg-warn/10 text-warn'
      }`}
    >
      {isPasswordMismatch ? (
        <>
          <strong className="font-semibold">
            The synced vault uses a different master password.
          </strong>{' '}
          It was changed on another device. Nothing here has been lost — sync is paused
          until both devices use the same password. Change it in Settings to match, or
          change it on the other device back.
        </>
      ) : (
        <>
          Another device saved at the same time. Nothing was overwritten — the next sync
          will merge both sets of changes.
        </>
      )}
    </div>
  );
}
