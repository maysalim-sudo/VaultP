/**
 * The navigation rail.
 *
 * Four places, not eight: Home, Money, Notes and Documents. Money is one place
 * with four parts — what was spent, people and debts, what repeats, and the
 * accounts — switched by the tabs at the top of the page, because they are one
 * subject and were scattered across the old sidebar. Settings and the theme sit
 * at the foot; search is not a place, it is the bar above every page (Ctrl+K).
 */

import { useEffect, useState } from 'react';

import { Icon, type IconName } from './icons.js';
import { THEME_EVENT, setThemeChoice, themeChoice, type ThemeChoice } from './theme/applyTokens.js';

export const SCREENS = [
  { id: 'dashboard', label: 'Overview' },
  { id: 'notes', label: 'Notes' },
  { id: 'expenses', label: 'Spent' },
  { id: 'rules', label: 'Repeats' },
  { id: 'debts', label: 'People' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'documents', label: 'Documents' },
  { id: 'settings', label: 'Settings' },
] as const;

export type ScreenId = (typeof SCREENS)[number]['id'];

/** The parts of Money, in tab order. */
export const MONEY: readonly ScreenId[] = ['expenses', 'debts', 'rules', 'accounts'];

const PLACES: ReadonlyArray<{ readonly id: ScreenId; readonly short: string; readonly icon: IconName }> = [
  { id: 'dashboard', short: 'HOME', icon: 'home' },
  { id: 'expenses', short: 'MONEY', icon: 'money' },
  { id: 'notes', short: 'NOTES', icon: 'notes' },
  { id: 'documents', short: 'DOCS', icon: 'docs' },
];

const NEXT_THEME: Record<ThemeChoice, ThemeChoice> = { auto: 'dark', dark: 'light', light: 'auto' };
const THEME_ICON: Record<ThemeChoice, IconName> = { auto: 'auto', dark: 'moon', light: 'sun' };

export function Sidebar({
  current,
  synced,
  onSelect,
  onCreate,
}: {
  current: ScreenId;
  /** Whether the last sync worked: the dot at the foot of the rail. */
  synced: boolean;
  onSelect: (id: ScreenId) => void;
  onCreate: () => void;
}) {
  const [theme, setTheme] = useState<ThemeChoice>(themeChoice);
  useEffect(() => {
    const follow = () => setTheme(themeChoice());
    window.addEventListener(THEME_EVENT, follow);
    return () => window.removeEventListener(THEME_EVENT, follow);
  }, []);
  const inMoney = MONEY.includes(current);

  return (
    <nav className="rail" aria-label="Main">
      <div className="mark" aria-label="VaultP" role="img">
        {Array.from({ length: 9 }, (_, index) => (
          <span key={index} className={index === 4 ? 'on' : ''} />
        ))}
      </div>

      {PLACES.map((place) => {
        const active = place.id === 'expenses' ? inMoney : place.id === current;
        return (
          <button
            key={place.id}
            className={`rail-item ${active ? 'active' : ''}`}
            aria-current={active ? 'page' : undefined}
            // Money remembers nothing: it opens on what was spent, the part
            // looked at most.
            onClick={() => onSelect(place.id)}
          >
            <Icon name={place.icon} />
            {place.short}
          </button>
        );
      })}

      <button className="rail-new" aria-label="New entry" title="New entry (Ctrl+N)" onClick={onCreate}>
        <Icon name="plus" size={22} stroke={2.2} />
      </button>

      <div className="rail-foot">
        <button
          className="rail-round"
          aria-label={`Theme: ${theme}. Switch to ${NEXT_THEME[theme]}`}
          title={`Theme: ${theme}`}
          onClick={() => {
            setThemeChoice(NEXT_THEME[theme]);
          }}
        >
          <Icon name={THEME_ICON[theme]} size={18} />
        </button>
        <button
          className={`rail-round ${current === 'settings' ? 'active' : ''}`}
          aria-label="Settings"
          title="Settings"
          onClick={() => onSelect('settings')}
        >
          <Icon name="sliders" size={18} />
        </button>
        <span className={`sync-dot ${synced ? 'ok' : ''}`} title={synced ? 'Sync is set up' : 'Not syncing yet'} />
      </div>
    </nav>
  );
}
