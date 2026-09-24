import { useEffect, useState } from 'react';

import { Platform } from '../../platform/ports';

/**
 * Best-effort favicon for an entry row.
 *
 * Resolves to a `data:` URL once fetched, or `null` while loading, disabled,
 * or on any failure — the caller's fallback (`EntrySiteIcon`'s colored glyph
 * plate, `EntryList.tsx`) covers every one of those cases identically, so
 * this hook never needs to distinguish "still loading" from "no icon found".
 *
 * Entirely self-contained: no other hook or component state feeds into this,
 * and nothing here writes to any shared state, so a bug in favicon fetching
 * cannot affect anything else — the isolation the feature was asked for.
 */
// Mirrors the Rust side's MAX_BASE64_LEN. Belt-and-suspenders: the host
// already refuses to fetch or cache anything bigger, but a stale cache entry
// written before that limit existed should still never reach an <img> tag
// here, on any platform, from any build.
const MAX_ICON_BASE64_LEN = 280_000;

export function useFavicon(platform: Platform, url: string, enabled: boolean): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    setDataUrl(null);
    if (!enabled || url.trim() === '') return;

    let cancelled = false;

    platform
      .fetchFavicon(url)
      .then((icon) => {
        if (cancelled || !icon) return;
        if (icon.dataBase64.length > MAX_ICON_BASE64_LEN) return;
        setDataUrl(`data:${icon.mime};base64,${icon.dataBase64}`);
      })
      .catch(() => {
        // Nothing to do — the caller already renders a fallback for `null`.
      });

    return () => {
      cancelled = true;
    };
  }, [platform, url, enabled]);

  return dataUrl;
}
