/**
 * A screen that is either a page or a modal, depending on how it was reached.
 *
 * Every top-level screen used to be a `<Modal>`, because the only way into one
 * was a button on the entry screen. With a sidebar they are destinations instead:
 * the drawer stays beside them, and a modal would cover it.
 *
 * Rather than fork each screen into a page version and a modal version, they take
 * an optional `onClose`. Given one, they are still something you opened on top of
 * what you were doing — the expense editor, a person's ledger — and stay modal.
 * Without one, they are simply the current view.
 */

import type { ReactNode } from 'react';
import { Modal, View } from 'react-native';

export function Screen({
  onClose,
  children,
}: {
  /** Present when this screen was pushed over another. */
  onClose?: (() => void) | undefined;
  children: ReactNode;
}) {
  if (!onClose) return <View style={{ flex: 1 }}>{children}</View>;

  // onRequestClose is what makes the Android back button dismiss it rather than
  // leaving the app.
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      {children}
    </Modal>
  );
}
