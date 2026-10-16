/**
 * What surrounds every screen once the vault is open.
 *
 * Holds the drawer and whichever destination is current. The screens themselves
 * know nothing about navigation: they are rendered here, and the two that need to
 * send you somewhere else — Home, mostly — are handed a callback.
 *
 * Two behaviours worth stating, because both are about the back button, which on
 * Android is the gesture people actually use:
 *
 *   - Back closes the drawer if it is open, then returns to Home, then leaves the
 *     app. Nothing traps you.
 *   - Choosing a destination collapses the drawer. On a phone the expanded drawer
 *     takes a third of the width; leaving it open after a choice would mean
 *     reading every screen through a slot.
 *
 * There is no history stack. With nine flat destinations and a home screen that
 * links to all of them, a stack would only add ways to be somewhere unexpected.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View, useColorScheme } from 'react-native';

import type { Category, Expense, SearchResult } from '@vaultp/core';

import { COLLAPSED_WIDTH, Sidebar, type ViewName } from '../components/Sidebar.js';
import { paletteFor } from '../components/theme.js';
import type { Intent, IntentProps, Navigate } from '../navigation.js';
import { useOpenVault } from '../vault/VaultContext.js';

import { Accounts } from './Accounts.js';
import { BackupScreen } from './BackupScreen.js';
import { Dashboard } from './Dashboard.js';
import { Debts } from './Debts.js';
import { Documents } from './Documents.js';
import { ExpenseEditor } from './ExpenseEditor.js';
import { Home } from './Home.js';
import { Notes } from './Notes.js';
import { AddEntry } from './AddEntry.js';
import { RecurringRules } from './RecurringRules.js';
import { Search } from './Search.js';

export function Shell() {
  const { vault, version } = useOpenVault();
  const palette = paletteFor(useColorScheme());

  const [view, setView] = useState<ViewName>('home');
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<{ view: ViewName; intent: Intent } | null>(null);

  const categories = useMemo<readonly Category[]>(
    () => vault.expenses.listCategories(),
    [vault, version],
  );

  const navigate = useCallback<Navigate>((next, intent) => {
    setView(next);
    setExpanded(false);
    setPending(intent ? { view: next, intent } : null);
  }, []);

  /** Props for the screen showing: its intent, if it was opened with one. */
  const intentFor = (name: ViewName): IntentProps => ({
    intent: pending?.view === name ? pending.intent : null,
    onIntentHandled: () => setPending(null),
  });

  function openResult(result: SearchResult) {
    setSearching(false);
    switch (result.kind) {
      case 'expense': {
        const expense = vault.expenses.getExpense(result.id);
        if (expense) setEditing(expense);
        return;
      }
      case 'note':
        return navigate('notes', { kind: 'note', id: result.id });
      case 'person':
        return navigate('debts', { kind: 'person', id: result.id });
      case 'debt':
        return result.parentId ? navigate('debts', { kind: 'person', id: result.parentId }) : undefined;
      case 'account':
        return navigate('accounts', { kind: 'account', id: result.id });
      case 'document':
        return navigate('documents', { kind: 'document', id: result.id });
    }
  }

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (expanded) {
        setExpanded(false);
        return true;
      }
      if (view !== 'home') {
        setView('home');
        return true;
      }
      // Not handled: let Android do what it normally does and leave the app.
      return false;
    });

    return () => subscription.remove();
  }, [expanded, view]);

  return (
    <View style={[styles.shell, { backgroundColor: palette.background }]}>
      {/*
        Content first, drawer second: React Native paints later siblings on top,
        and the drawer has to slide over the content rather than under it.

        The content sits beside the collapsed strip and does not reflow when the
        drawer expands. Relaying out a whole screen on every toggle is both
        visible and slow, and the drawer is only open long enough for one tap.
      */}
      <View style={styles.content}>{renderView()}</View>

      <View style={styles.drawer}>
        <Sidebar
          active={view}
          expanded={expanded}
          onSelect={navigate}
          onToggle={() => setExpanded((current) => !current)}
          onSearch={() => {
            setExpanded(false);
            setSearching(true);
          }}
          palette={palette}
        />
      </View>

      {searching ? <Search onClose={() => setSearching(false)} onOpen={openResult} /> : null}

      {editing ? (
        <ExpenseEditor
          expense={editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </View>
  );

  function renderView() {
    switch (view) {
      case 'home':
        return <Home onNavigate={navigate} onEditExpense={setEditing} onSearch={() => setSearching(true)} />;
      case 'add':
        return <AddEntry />;
      case 'insights':
        return <Dashboard />;
      case 'recurring':
        return <RecurringRules categories={categories} />;
      case 'debts':
        return <Debts {...intentFor('debts')} />;
      case 'accounts':
        return <Accounts {...intentFor('accounts')} />;
      case 'documents':
        return <Documents {...intentFor('documents')} />;
      case 'notes':
        return <Notes {...intentFor('notes')} />;
      case 'backup':
        return <BackupScreen />;
    }
  }
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  // Both children are absolute, so neither is squeezed by the other as the
  // drawer widens.
  content: { position: 'absolute', left: COLLAPSED_WIDTH, right: 0, top: 0, bottom: 0 },
  drawer: { position: 'absolute', left: 0, top: 0, bottom: 0 },
});
