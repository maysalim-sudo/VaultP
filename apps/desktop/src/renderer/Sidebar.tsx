/**
 * The navigation column.
 *
 * The phone got a sidebar for the same reason: a row of tabs stops working once
 * there are more than about five places to go, and there are more than five.
 */

export const SCREENS = [
  { id: 'dashboard', label: 'Dashboard', icon: '◆' },
  { id: 'expenses', label: 'Expenses', icon: '▤' },
  { id: 'rules', label: 'Recurring', icon: '↻' },
  { id: 'debts', label: 'Debts', icon: '⇄' },
  { id: 'documents', label: 'Documents', icon: '▣' },
  { id: 'notes', label: 'Notes', icon: '✎' },
  { id: 'search', label: 'Search', icon: '⌕' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
] as const;

export type ScreenId = (typeof SCREENS)[number]['id'];

export function Sidebar({
  current,
  onSelect,
}: {
  current: ScreenId;
  onSelect: (id: ScreenId) => void;
}) {
  return (
    <nav className="sidebar">
      <div className="brand">VaultP</div>
      {SCREENS.map((screen) => (
        <button
          key={screen.id}
          className={`nav ${screen.id === current ? 'active' : ''}`}
          onClick={() => onSelect(screen.id)}
        >
          <span className="nav-icon">{screen.icon}</span>
          {screen.label}
        </button>
      ))}
    </nav>
  );
}
