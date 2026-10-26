/**
 * Keyboard shortcuts of the POS. Function keys and Ctrl+Enter only, so nothing fires while the cashier types text and
 * nothing clashes with the usual browser shortcuts (Ctrl+T/W/N/L/F/P, F5, F11, F12 are left alone).
 * The shortcuts stored by Laravel (shift+letter) are not used: they would trigger while typing a capital letter.
 */
export type ShortcutId =
  | 'help'
  | 'search'
  | 'customer'
  | 'discount'
  | 'pay'
  | 'express'
  | 'suspend'
  | 'draft'
  | 'quotation'
  | 'clear'
  | 'recent'
  | 'addPayment'
  | 'finalize';

export const SHORTCUTS: Record<ShortcutId, string> = {
  help: 'f1',
  search: 'f2',
  customer: 'f4',
  discount: 'f7',
  pay: 'f8',
  express: 'f9',
  suspend: 'shift+f8',
  draft: 'shift+f9',
  quotation: 'shift+f7',
  clear: 'shift+f4',
  recent: 'shift+f2',
  addPayment: 'f7',
  finalize: 'ctrl+enter',
};

/** Shortcuts that work on the POS screen itself and those that work inside the payment dialog. */
export const SCREEN_SHORTCUTS: ShortcutId[] = ['help', 'search', 'customer', 'discount', 'pay', 'express', 'suspend', 'draft', 'quotation', 'clear', 'recent'];
export const PAYMENT_SHORTCUTS: ShortcutId[] = ['addPayment', 'finalize'];

/** "ctrl+shift+f8" for a keyboard event (modifiers in a fixed order, key lower-cased). */
export function eventCombo(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(e.key.toLowerCase());
  return parts.join('+');
}

export function shortcutFor(e: KeyboardEvent, ids: ShortcutId[]): ShortcutId | null {
  const combo = eventCombo(e);
  return ids.find((id) => SHORTCUTS[id] === combo) ?? null;
}

/** "shift+f8" -> "Shift+F8". */
export function prettyCombo(combo: string): string {
  return combo
    .split('+')
    .map((p) => (p === 'ctrl' ? 'Ctrl' : p === 'alt' ? 'Alt' : p === 'shift' ? 'Shift' : p === 'enter' ? 'Enter' : p.toUpperCase()))
    .join('+');
}
