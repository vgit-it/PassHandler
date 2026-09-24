import { FunctionComponent } from 'react';

import {
  AddressTypeIcon,
  BackupCodesTypeIcon,
  BankTypeIcon,
  CardTypeIcon,
  GlobeIcon,
  IdentityTypeIcon,
  InsuranceTypeIcon,
  LicenseKeyTypeIcon,
  LoyaltyTypeIcon,
  PhoneTypeIcon,
  SecureNoteTypeIcon,
  SecurityQaTypeIcon,
  SshKeyTypeIcon,
  VehicleTypeIcon,
  WifiTypeIcon,
} from './icons';

type IconProps = { className?: string };

/**
 * Maps an `entryTypes.ts` `icon` string to the component that renders it.
 *
 * Split out from `icons.tsx` (which only exports components) and from
 * `entryTypes.ts` (which stays free of a React import — see that file's
 * comment) so that "which icon does this type use" has exactly one lookup
 * table, used by both the type picker and the entry list's type-icon
 * fallback.
 */
const ENTRY_TYPE_ICONS: Record<string, FunctionComponent<IconProps>> = {
  // `GlobeIcon`, not a Login-specific glyph (per request) — matches the
  // home-screen peg's own Login fallback (`EntrySiteIcon` in
  // `EntryList.tsx`), so a Login entry
  // reads as "a website" the same way everywhere it shows an icon at all:
  // this lookup (the type picker, `EntryDetail.tsx`'s header badge, and
  // anywhere else that resolves an entry's icon by type) and the peg's own
  // direct `GlobeIcon` use for its no-favicon fallback.
  login: GlobeIcon,
  card: CardTypeIcon,
  bank: BankTypeIcon,
  identity: IdentityTypeIcon,
  phone: PhoneTypeIcon,
  address: AddressTypeIcon,
  wifi: WifiTypeIcon,
  licenseKey: LicenseKeyTypeIcon,
  sshKey: SshKeyTypeIcon,
  backupCodes: BackupCodesTypeIcon,
  securityQa: SecurityQaTypeIcon,
  loyalty: LoyaltyTypeIcon,
  vehicle: VehicleTypeIcon,
  insurance: InsuranceTypeIcon,
  secureNote: SecureNoteTypeIcon,
};

export function EntryTypeIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ENTRY_TYPE_ICONS[icon] ?? GlobeIcon;
  return <Icon className={className} />;
}
