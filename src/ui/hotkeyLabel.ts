import { HotkeyCombo } from '../platform/ports';

/** "Ctrl+Alt+H" — how Settings' hotkey row, the first-run tips and About
 * all spell the manual-fill hotkey, so the three never disagree. */
export function describeHotkey(combo: HotkeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  if (combo.meta) parts.push('Win');
  parts.push(describeCode(combo.code));
  return parts.join('+');
}

function describeCode(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
