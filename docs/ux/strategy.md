# VaultP UX strategy

## Product direction

Make VaultP feel like one fast personal workspace for notes and money, rather than separate tools that happen to share an app. Keep common actions visible, make records easy to correct later, and make financial calculations explainable.

## Agreed priorities

1. **Home and quick capture** — keep note creation and recent notes prominent on the dashboard; expose checklist and image-note shortcuts.
2. **Global search** — search notes, expenses, people, and other records from a persistent entry point. Search is an action, not a destination in the primary navigation.
3. **Consistent record management** — details for notes, expenses, people, and accounts should offer a predictable edit/manage path. Destructive actions should explain their effect and confirm when appropriate.
4. **Image notes** — make the attachment target explicit: choose or create the note, pick/capture an image, preview it, then confirm attachment. Preserve the note text and show recoverable errors rather than silently placing an image in the wrong record.
5. **Debt people** — provide a people list with outstanding balances, person details and repayment history, and clear edit/archive/remove actions. Warn before removing a person with an outstanding balance; do not silently discard debt history.
6. **Payment methods** — users can add, rename/edit, choose a default, and remove methods such as BIAT Bank, Rizon Card, Redot Card, Payoneer, and Cash. The default is optional and configurable; when set, it is preselected on a new expense. A user may clear the method for an individual expense. One expense has at most one method: this is not expense splitting.
7. **Light and dark themes** — preserve the same hierarchy and semantics in both themes, with readable secondary text and clear selected states.

## Payment and balance behavior

- Store a method reference on an expense when the user selects one; allow no method.
- Changing the default only affects future expense drafts. It must not rewrite existing transactions.
- Removing a method should stop offering it for new expenses while preserving the label/history on past expenses. If a method is still referenced, prefer archive/deactivate semantics over destructive deletion.
- Keep the manually checked account balance as the last confirmed baseline. Show linked-expense effects as a separate estimated/current balance, with a clear “as of” date and explanation; never overwrite the checked snapshot automatically.

## Navigation and interaction principles

- **Home:** global search, quick note capture, recent notes, spending summary, tracked accounts, and a small amount of actionable reminders.
- **Primary navigation:** Home, Notes, Create, Expenses, More. Create opens a quick-action sheet rather than another content destination. The More hub collects Accounts, Recurring, People & debts, Payment methods, Documents, Archive, Sync & backup, and Settings.
- **Search:** launch from the Home/header entry point and return grouped, filterable results without adding Search to the main navigation.
- **Management:** keep editing close to the record. Use one consistent pattern for edit, archive/remove, and confirmation; distinguish “hide from future use” from deleting history.
- **Feedback:** show save success, attachment progress, and useful retry/error states. Avoid silent failure.

## Prototype status

The canonical prototype is `vaultp-ui-kit.figcraft`: **64 artboards**, 32 flows in light and dark themes, covering Home, quick create, global search, notes and checklists, expenses and editing, month insights, accounts and balances, payment methods, people and debts, recurring charges, documents, More, Settings, sync and backup, lock/setup, and all creation forms.

Key routes are linked for a clickable walkthrough, including the bottom navigation and the More hub. Individual controls such as text entry, camera capture, method selection, and search filtering are still visual placeholders; this is a UX prototype, not app behavior. Light/dark screens are separate visual artboards rather than variable modes. Remaining design work is limited to confirmation/error states, empty states, and a desktop layout pass if the Windows/Linux UI needs its own artboards. The older `vaultp-expense-flow.figcraft` is a partial 12-screen rebuild and is superseded by the UI kit.
