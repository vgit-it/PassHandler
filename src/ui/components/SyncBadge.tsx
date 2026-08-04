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
}: {
  sync: SyncSnapshot;
  onClick?: () => void;
}) {
  const { tone, text, title } = describe(sync);

  const Element = onClick ? 'button' : 'div';

  return (
    <Element
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1
                  text-xs font-medium ${tone} ${onClick ? 'hover:brightness-125' : ''}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full bg-current ${
          sync.status === 'syncing' ? 'animate-pulse' : ''
        }`}
      />
      {text}
    </Element>
  );
}

function describe(sync: SyncSnapshot): { tone: string; text: string; title: string } {
  switch (sync.status) {
    case 'synced':
      return {
        tone: 'border-ok/30 bg-ok/10 text-ok',
        text: 'Synced',
        title: sync.lastSyncAt
          ? `Last synced ${new Date(sync.lastSyncAt).toLocaleString()}`
          : 'Up to date with Google Drive',
      };

    case 'syncing':
      return {
        tone: 'border-accent/30 bg-accent/10 text-accent',
        text: 'Syncing',
        title: 'Exchanging changes with Google Drive',
      };

    case 'offline':
      return {
        tone: 'border-warn/30 bg-warn/10 text-warn',
        text: sync.pendingChanges ? 'Offline — changes pending' : 'Offline',
        title:
          'Your changes are saved on this device and will sync when the connection returns.',
      };

    case 'conflict':
      return {
        tone: 'border-bad/30 bg-bad/10 text-bad',
        text: conflictText(sync),
        title: conflictTitle(sync),
      };

    case 'disabled':
    default:
      return {
        tone: 'border-ink-500 bg-ink-700 text-slate-400',
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
