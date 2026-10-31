/**
 * What surrounds every screen once the vault is open: the top bar, the tabs, and
 * whichever destination is current. The screens know nothing about navigation;
 * they are rendered here, and those that send you somewhere else are handed a
 * callback.
 *
 * Back on Android, the gesture people actually use, returns to Home and then
 * leaves the app. Nothing traps you. There is no history stack: with a handful
 * of flat places and a home that links to all of them, a stack would only add
 * ways to be somewhere unexpected.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View, useColorScheme } from 'react-native';

import type { Category, Expense, SearchResult } from '@vaultp/core';

import { CreateSheet, MONEY, MoneyTabs, TabBar, TopBar } from '../components/Chrome.js';
import { paletteFor } from '../components/theme.js';
import type { Intent, IntentProps, Navigate, ViewName } from '../navigation.js';
import { useOpenVault } from '../vault/VaultContext.js';

import { Accounts } from './Accounts.js';
import { AddEntry } from './AddEntry.js';
import { BackupScreen } from './BackupScreen.js';
import { Debts } from './Debts.js';
import { Documents } from './Documents.js';
import { ExpenseEditor } from './ExpenseEditor.js';
import { Home } from './Home.js';
import { Notes } from './Notes.js';
import { RecurringRules } from './RecurringRules.js';
import { Search } from './Search.js';
import { Spent } from './Spent.js';

export function Shell() {
  const { vault, version } = useOpenVault();
  const palette = paletteFor(useColorScheme());

  const [view, setView] = useState<ViewName>('home');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<{ view: ViewName; intent: Intent } | null>(null);

  const categories = useMemo<readonly Category[]>(
    () => vault.expenses.listCategories(),
    [vault, version],
  );

  const navigate = useCallback<Navigate>((next, intent) => {
    setView(next);
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
      if (view !== 'home') {
        setView('home');
        return true;
      }
      // Not handled: let Android do what it normally does and leave the app.
      return false;
    });

    return () => subscription.remove();
  }, [view]);

  return (
    <View style={[styles.shell, { backgroundColor: palette.background }]}>
      <TopBar palette={palette} onSearch={() => setSearching(true)} onVault={() => navigate('backup')} />
      {MONEY.includes(view) ? <MoneyTabs palette={palette} active={view} onSelect={navigate} /> : null}
      <View style={styles.content}>{renderView()}</View>
      <TabBar palette={palette} active={view} onSelect={navigate} onCreate={() => setCreating(true)} />

      <CreateSheet palette={palette} visible={creating} onClose={() => setCreating(false)} onGo={navigate} />

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
        return <Home onNavigate={navigate} />;
      case 'add':
        return <AddEntry />;
      case 'insights':
        return <Spent onEditExpense={setEditing} />;
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
  content: { flex: 1 },
});
