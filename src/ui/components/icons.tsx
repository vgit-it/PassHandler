/**
 * Inline SVG icons.
 *
 * Bundled as components rather than pulled from an icon font or a CDN, because
 * the app makes no network requests other than Drive sync and that rule has no
 * exceptions for decoration.
 */
type IconProps = { className?: string };

const base = 'h-4 w-4';

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className ?? base}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * The row-affordance chevron on `EntryList`. Kept as its own tiny `<svg>`
 * rather than going through `Svg` above — the design system's
 * `EntryListRow.tsx` defines it in a 16×16 viewBox at 1.5px stroke, not the
 * shared 24×24/1.8px grid the rest of these icons use, and reusing `Svg`
 * here would stretch/misplace the path instead of reproducing it as-is.
 */
export const ChevronIcon = (p: IconProps) => (
  <svg
    className={p.className ?? base}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6 4l4 4-4 4" />
  </svg>
);

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Svg>
);

export const EyeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
);

export const EyeOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.2 3.8" />
    <path d="M6.5 8.3A16.6 16.6 0 0 0 2 12s3.5 6 10 6a9.7 9.7 0 0 0 3.6-.7" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12.5l5 5L20 6" />
  </Svg>
);

export const SearchIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);

export const LockIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="10" width="16" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 1 1 8 0v3" />
  </Svg>
);

/**
 * The app's actual mark — a keyhole in a ring, on the app's own navy plate
 * — not a generic stroke glyph like the rest of this file. It carries its
 * own fixed colors (the same artwork the desktop/Android app icon is
 * generated from — see `src-tauri/icons/icon-manifest.json`'s `default`),
 * so unlike `Svg`'s children it does not use `currentColor` and does not
 * go through the shared `Svg` wrapper.
 */
export function LogoMark({
  className,
  noBg = false,
}: IconProps & {
  /** Omits the navy background plate, leaving just the ring/keyhole/base
   * shape on a transparent ground — the "LogoMark_NoBG" variant the
   * Android home header uses (Figma home-screen design), next to a small
   * "Vault" wordmark, where a second dark plate on top of the header
   * would be redundant. Everywhere else keeps the plate (the default). */
  noBg?: boolean;
}) {
  return (
    <svg
      className={className ?? 'h-16 w-16'}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Vault"
    >
      {!noBg && (
        <path
          d="M50 0H14C6.26801 0 0 6.26801 0 14V50C0 57.732 6.26801 64 14 64H50C57.732 64 64 57.732 64 50V14C64 6.26801 57.732 0 50 0Z"
          fill="#0F1B2D"
        />
      )}
      <path
        d="M32 50C41.9411 50 50 41.9411 50 32C50 22.0589 41.9411 14 32 14C22.0589 14 14 22.0589 14 32C14 41.9411 22.0589 50 32 50Z"
        stroke="#8FADC7"
        strokeWidth="5"
      />
      <path
        d="M32 34C36.4183 34 40 30.4183 40 26C40 21.5817 36.4183 18 32 18C27.5817 18 24 21.5817 24 26C24 30.4183 27.5817 34 32 34Z"
        fill="#8FADC7"
      />
      <path
        d="M32 30C34.2091 30 36 28.2091 36 26C36 23.7909 34.2091 22 32 22C29.7909 22 28 23.7909 28 26C28 28.2091 29.7909 30 32 30Z"
        fill="#0F1B2D"
      />
      <path d="M29 33L27 48H37L35 33H29Z" fill="#8FADC7" />
    </svg>
  );
}

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const BackIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 19l-7-7 7-7" />
  </Svg>
);

export const SettingsIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </Svg>
);

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v6h-6" />
  </Svg>
);

export const TrashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Svg>
);

/** `EntryDetail`'s header Edit action, per the Figma entry-detail redesign —
 * a plain pencil, no underline stroke (unlike e.g. Lucide's "edit-3"), since
 * the reference shows just the pencil body. */
export const EditIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    <path d="M14.5 5.5l4 4" />
  </Svg>
);

export const ExternalIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </Svg>
);

/** Login's representative icon everywhere one shows: `EntrySiteIcon`'s
 * (`EntryList.tsx`) no-favicon fallback (originally what this was built for
 * — see that component's own doc), and, via `entryTypeIcons.tsx`'s
 * `ENTRY_TYPE_ICONS` lookup, the
 * type picker, `EntryDetail`'s header badge, and anywhere else in the app
 * that resolves an entry's icon generically by type — a Login-specific
 * glyph used to sit in that lookup instead (a padlock/ID-card shape,
 * deleted per request once nothing referenced it any more) and read as
 * visually inconsistent with the peg's own globe. Also fills in the vault
 * spec's own documented but never-built middle fallback tier for the peg
 * specifically: "cached favicon → entry-type glyph → first letter"
 * (`vault-visual-language-spec.md` §4.2). */
export const GlobeIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <path d="M2 12h20" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z" />
  </Svg>
);

export const DiceIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" />
    <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" />
  </Svg>
);

/** Per-date-field "Track in Upcoming" toggle (`TrackToggle`, in
 * `DateFieldWithRenewal.tsx`) — a plain bell outline, distinct from
 * `AlertIcon` (the Upcoming tab's own glyph, and separately "Review"'s
 * pinned-group marker on `EntryList`) so a field-level control doesn't
 * borrow an icon that already means something else in two other spots. */
export const BellIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 10.5a6 6 0 0 1 12 0c0 4 1.3 5.7 2 6.5H4c.7-.8 2-2.5 2-6.5Z" />
    <path d="M10 20a2.2 2.2 0 0 0 4 0" />
  </Svg>
);

export const CalendarIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.2" />
    <path d="M3.5 9.5h17" />
    <path d="M8 3v4M16 3v4" />
  </Svg>
);

/** The Android bottom tab bar's Upcoming glyph — a plain "!", not part of
 * the shared `Svg` outline-icon set stylistically but built the same way. */
export const AlertIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v9" />
    <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
  </Svg>
);

/**
 * The Android bottom tab bar's Home glyph — a filled keyhole silhouette,
 * not the outlined `LockIcon` (used for the actual Lock action in the same
 * header) or the full `LogoMark` (the app's icon/mark, shown alongside the
 * title next to it). Filled rather than stroked, matching how solid glyphs
 * read better at the bar's small size than a 1.8px outline would.
 */
export const KeyholeIcon = (p: IconProps) => (
  <svg className={p.className ?? base} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="12" cy="8.5" r="4" />
    <path d="M9.3 12.2h5.4l1.9 8.8H7.4Z" />
  </svg>
);

/** The Android bottom tab bar's Home glyph, per the Figma home-screen
 * design — replaces the earlier `KeyholeIcon` there so all three tabs
 * (Home/Upcoming/Profile) share one plain-outline icon language, matching
 * the design exactly. `KeyholeIcon` itself is left in place below in case
 * it's still wanted elsewhere. */
export const HomeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 11.5 12 4l8 7.5" />
    <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
    <path d="M10 20v-5h4v5" />
  </Svg>
);

/** Fallback for the bottom tab bar's You avatar when no Drive account email
 * is available to take an initial from. */
export const PersonIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c1.1-4.2 3.9-6.5 7-6.5s5.9 2.3 7 6.5" />
  </Svg>
);

export const FingerprintIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 10a2 2 0 0 1 2 2c0 3-.4 5.4-1.2 7.4" />
    <path d="M8.6 20a14 14 0 0 0 1.4-6.2V12a2 2 0 0 1 .6-1.4" />
    <path d="M5.4 17.2A11 11 0 0 0 6 13.8V12a6 6 0 0 1 9.3-5" />
    <path d="M18 11.4V12c0 2.6-.3 4.8-.9 6.6" />
    <path d="M3.6 9.2a9 9 0 0 1 15-1.6" />
  </Svg>
);

/** A "return"/"enter" glyph (⏎) — the unlock screen's submit button, next
 * to the master-password field, per the Figma unlock-screen design. */
export const EnterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 6v5a3 3 0 0 1-3 3H6" />
    <path d="M10 10l-4 4 4 4" />
  </Svg>
);

/**
 * Entry-type icons, one per `entryTypes.ts` id. Looked up by string key
 * rather than imported directly by any single screen — see
 * `entryTypeIcons.tsx`, which maps a type's `icon` field to one of these.
 * Login has no icon of its own here any more — it maps to `GlobeIcon`
 * above, alongside the rest of this file's generic icons.
 */

export const CardTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.2" />
    <path d="M2.5 9.5h19" />
    <path d="M6 15h5" />
  </Svg>
);

export const BankTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 10.5 12 4l9 6.5" />
    <path d="M4.5 10.5V19M9 10.5V19M15 10.5V19M19.5 10.5V19" />
    <path d="M3 19h18" />
  </Svg>
);

export const IdentityTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="14" rx="2.2" />
    <circle cx="8.5" cy="12" r="2.2" />
    <path d="M4.7 16.3a3.9 3.9 0 0 1 7.6 0" />
    <path d="M14.5 10h4M14.5 13.5h4" />
  </Svg>
);

export const WifiTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 9.5a14 14 0 0 1 19 0" />
    <path d="M5.7 13a9.5 9.5 0 0 1 12.6 0" />
    <path d="M9 16.5a4.8 4.8 0 0 1 6 0" />
    <circle cx="12" cy="20" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

export const LicenseKeyTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="7.5" cy="14.5" r="3.5" />
    <path d="M10.6 12 20 2.5" />
    <path d="M16.5 6 19 8.5" />
    <path d="M13.5 9 16 11.5" />
  </Svg>
);

export const SshKeyTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 17 14.5 6.5" />
    <path d="M13 8 16.5 4.5a2.1 2.1 0 0 1 3 3L16 11" />
    <path d="M7 14l3 3M9 12l2.5 2.5" />
  </Svg>
);

export const BackupCodesTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9h2M11 9h2M15 9h2M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2" />
  </Svg>
);

export const SecurityQaTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4" />
    <circle cx="12" cy="17.5" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="9" />
  </Svg>
);

export const LoyaltyTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 14.4 9l6 .9-4.3 4.2 1 6-5.1-2.7-5.1 2.7 1-6L3.6 9.9l6-.9Z" />
  </Svg>
);

export const VehicleTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 15V11l2-4.5h13L20.5 11v4" />
    <path d="M3.5 15h17v3.5h-3V17h-11v1.5h-3Z" />
    <circle cx="7.5" cy="15" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="16.5" cy="15" r="1.3" fill="currentColor" stroke="none" />
  </Svg>
);

export const InsuranceTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 4.5 6v6c0 5 3.2 8 7.5 9 4.3-1 7.5-4 7.5-9V6Z" />
    <path d="M9 12l2 2 4-4.5" />
  </Svg>
);

export const SecureNoteTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h9l3 3v15H6Z" />
    <path d="M15 3v3h3" />
    <path d="M8.5 12h7M8.5 15.5h7M8.5 8.5h4" />
  </Svg>
);

export const PhoneTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6.5 3.5h3l1.3 4-2 1.4a11 11 0 0 0 5.3 5.3l1.4-2 4 1.3v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z" />
  </Svg>
);

export const AddressTypeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21.5s7-6.4 7-12A7 7 0 1 0 5 9.5c0 5.6 7 12 7 12Z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Svg>
);

/**
 * The decorative "hub" artwork above the Android home screen's entry list
 * (Figma node `56:175`) — a rounded card outline with a small connection
 * hub fanning out to it, plus a faint diagonal band behind it. Reproduced
 * pixel-for-pixel from the exact SVG the user exported from Figma
 * themselves (`BG_Image.svg`), not redrawn — every coordinate, transform,
 * and opacity below is copied as-is from that file, just converted to JSX
 * (kebab-case attrs to camelCase, `mask-type:alpha` to an inline `style`).
 * Its own 412×158 canvas already matches the app's design width and bakes
 * in the artwork's real position within it (the hub sits off-center, with
 * empty space above/left/right) — sized here with `w-full h-auto` off that
 * same viewBox so it scales to the device width without needing any
 * separate positioning math re-derived from the node's own (narrower,
 * tighter) bounding box.
 */
export const ListTopIllustration = ({ className }: IconProps) => (
  <svg
    className={className}
    viewBox="0 0 412 158"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
  >
    <mask
      id="listTopIllustrationMask"
      style={{ maskType: 'alpha' } as React.CSSProperties}
      maskUnits="userSpaceOnUse"
      x="118"
      y="13"
      width="190"
      height="129"
    >
      <rect x="118" y="13" width="190" height="129" rx="10" fill="#8FADC7" />
    </mask>
    <g mask="url(#listTopIllustrationMask)">
      <rect
        opacity="0.1"
        x="105"
        y="150.073"
        width="257.628"
        height="133.12"
        transform="rotate(-32.9359 105 150.073)"
        fill="#D9D9D9"
      />
      <rect opacity="0.2" x="118" y="13" width="190" height="129" rx="10" fill="#8FADC7" />
      <rect
        opacity="0.2"
        x="125"
        y="18"
        width="176"
        height="119"
        rx="9"
        stroke="#8FADC7"
        strokeWidth="2"
      />
      <rect opacity="0.5" x="295" y="34" width="18" height="18" rx="3" fill="#264670" />
      <rect opacity="0.5" x="295" y="100" width="18" height="18" rx="3" fill="#264670" />
    </g>
    <g opacity="0.7">
      <rect x="96" y="76" width="125" height="7" fill="#142238" />
      <rect
        x="111.831"
        y="121.219"
        width="125"
        height="7"
        transform="rotate(-45 111.831 121.219)"
        fill="#142238"
      />
      <rect
        x="155"
        y="142"
        width="125"
        height="7"
        transform="rotate(-90 155 142)"
        fill="#142238"
      />
      <rect
        x="200.219"
        y="126.169"
        width="125"
        height="7"
        transform="rotate(-135 200.219 126.169)"
        fill="#142238"
      />
      <circle cx="159" cy="80" r="20" fill="#1E3557" />
      <circle cx="221" cy="80" r="10" fill="#1E3557" />
      <circle cx="158" cy="17" r="10" fill="#1E3557" />
      <circle cx="96" cy="80" r="10" fill="#1E3557" />
      <circle cx="159" cy="142" r="10" fill="#1E3557" />
      <circle cx="205" cy="126" r="10" fill="#1E3557" />
      <circle cx="205" cy="33" r="10" fill="#1E3557" />
      <circle cx="112" cy="33" r="10" fill="#1E3557" />
      <circle cx="112" cy="126" r="10" fill="#1E3557" />
      <circle cx="159" cy="80" r="10" fill="#264670" />
    </g>
  </svg>
);
