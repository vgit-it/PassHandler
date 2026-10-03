/**
 * A binary on/off control, lit up in the accent color when active.
 *
 * Used for settings that are a plain boolean and take effect immediately —
 * no confirmation step, nothing else on screen changes shape when it flips.
 * `disabled` mirrors what the button controls it replaces did: the row's own
 * hint text explains why (e.g. "Not available on this device"), this just
 * stops the click from doing anything.
 *
 * The off track is the border token (`ink-500`), not a fill step: it has to
 * stand out from the surface it sits on (3:1), and the fill steps are too
 * close to the surfaces by design. The drawn switch is 24px tall; a `::before`
 * inset extends the tap area to the app's 44px floor without changing how
 * it looks (`docs/SETTINGS-VISUAL-PASS.md`).
 */
export function Toggle({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full
                  transition-colors before:absolute before:inset-x-0 before:-inset-y-2.5
                  before:content-[''] disabled:cursor-not-allowed disabled:opacity-40 ${
                    checked ? 'bg-accent' : 'bg-ink-500'
                  }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}
