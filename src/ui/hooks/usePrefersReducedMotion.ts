import { useEffect, useState } from 'react';

/**
 * Tracks the OS/browser `prefers-reduced-motion` media query live — not just
 * its value at mount, since a user can flip this setting while the app is
 * open. Extracted out of `VaultDoors.tsx` (its original, sole use) once
 * `PasswordField.tsx`'s generate/regenerate scramble animation needed the
 * same check (`docs/UI-UX-REVIEW.md` finding #5) — a generic "does the user
 * want less motion" query has no reason to live inside one specific
 * component, and a second copy would just be the same logic drifting apart
 * over time.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
