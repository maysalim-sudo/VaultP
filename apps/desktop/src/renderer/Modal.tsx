/** A dialog over the page, for editing one thing at a time. */

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Which dialogs are open, innermost last.
 *
 * Dialogs nest — a ledger opens a form over itself — and without this every
 * open dialog would answer one Escape, closing the whole stack when the user
 * meant to back out of the top form only.
 */
const stack: object[] = [];

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const token = useRef({}).current;

  // Held in a ref so the effect below can depend on nothing. `onClose` is a new
  // closure every render, and re-running the effect would pop this dialog off
  // the stack and push it back on top — making an outer dialog, re-rendered
  // while an inner one is open, answer the Escape meant for the inner one.
  const close = useRef(onClose);
  close.current = onClose;

  // Escape closes the topmost dialog. Without it the only way out is the mouse,
  // which on a form reached by keyboard is a jarring thing to discover.
  useEffect(() => {
    stack.push(token);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && stack[stack.length - 1] === token) close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(token), 1);
    };
  }, [token]);

  return (
    <div className="backdrop" onMouseDown={onClose}>
      {/* Stops a click that began inside the dialog from closing it — including a
          text selection that happens to end on the backdrop. */}
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** A labelled field. Every form here is a stack of these. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="muted small">{label}</span>
      {children}
    </label>
  );
}
