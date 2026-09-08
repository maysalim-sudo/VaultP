/**
 * The first screen.
 *
 * Ordered by what you can still do something about:
 *
 *   1. what is owed or due soon    — acting on it has a deadline
 *   2. what has been spent         — the number you open the app to check
 *   3. what was added recently     — and can be corrected while you remember it
 *
 * Every figure here is tappable through to the thing it came from. A dashboard
 * that only reports leaves you hunting for the screen that can change it.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  BASE_CURRENCY,
  autoLogId,
  daysBetween,
  formatMoney,
  loadAllowanceConfig,
  isAllowanceConfigured,
  forecastAllowance,
  monthKey,
  money,
  monthTotal,
  pendingReminders,
  todayIn,
  toDecimalString,
  upcomingCharges,
  type Expense,
  type LedgerBalance,
  type DueOccurrence,
} from '@vaultp/core';

import { describeDate } from '../components/DateField.js';
import { paletteFor, type Palette } from '../components/theme.js';
import type { ViewName } from '../components/Sidebar.js';
import { useOpenVault } from '../vault/VaultContext.js';

export function Home({
  onNavigate,
  onEditExpense,
}: {
  onNavigate: (view: ViewName) => void;
  onEditExpense: (expense: Expense) => void;
}) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const month = useMemo(
    () => monthTotal(vault.db, monthKey(today), BASE_CURRENCY),
    [vault, version, today],
  );

  const todayTotal = useMemo(
    () =>
      vault.expenses
        .listExpenses({ from: today, to: today })
        .reduce((sum, expense) => sum + (expense.base?.amountMinor ?? 0), 0),
    [vault, version, today],
  );

  const recent = useMemo(
    () => vault.expenses.listExpenses({ limit: 6 }),
    [vault, version],
  );

  const categories = useMemo(() => vault.expenses.listCategories(), [vault, version]);

  /** The next few scheduled charges, whether they log themselves or not. */
  const upcoming = useMemo(
    () => upcomingCharges(vault.expenses, today, 45).slice(0, 3),
    [vault, version, today],
  );

  /** Charges that were due and are still unlogged — these need a decision. */
  const overdue = useMemo(
    () => pendingReminders(vault.expenses, today).slice(0, 3),
    [vault, version, today],
  );

  const dueNotes = useMemo(
    () => vault.notes.overdue(today).slice(0, 3),
    [vault, version, today],
  );

  const expiring = useMemo(
    () => vault.documents.expiringSoon(today).slice(0, 3),
    [vault, version, today],
  );

  /**
   * Per person rather than `allBalances`, which computes them in one pass and so
   * throws the whole list away if any one ledger mixes currencies. On a summary
   * screen, one unrepresentable person should cost that person's row, not every
   * other balance.
   */
  const debts = useMemo(() => {
    const balances: { balance: LedgerBalance; name: string }[] = [];

    for (const person of vault.debts.listPeople(true)) {
      try {
        const balance = vault.debts.ledgerFor(person.id, today);
        if (balance && balance.net.amountMinor !== 0) {
          balances.push({ balance, name: person.name });
        }
      } catch {
        // Mixed-currency ledger. It is shown, with its explanation, on the debts
        // screen; there is no single number to put here.
      }
    }

    return balances
      .sort(
        (a, b) =>
          Math.abs(b.balance.net.amountMinor) - Math.abs(a.balance.net.amountMinor),
      )
      .slice(0, 3);
  }, [vault, version, today]);

  const allowance = useMemo(() => {
    const config = loadAllowanceConfig(vault.store);
    if (!isAllowanceConfigured(config)) return null;
    return forecastAllowance(vault.db, config, today);
  }, [vault, version, today]);

  /**
   * Logging a charge the app only reminded about.
   *
   * The id is the one the scheduler would have used, so confirming here and
   * auto-logging on another device can never produce two rows for one charge.
   */
  function confirmReminder(due: DueOccurrence) {
    mutate((v) =>
      v.expenses.addExpense({
        id: autoLogId(due.rule.id, due.date),
        occurredOn: due.date,
        amount: due.rule.amount,
        source: 'recurring',
        recurringRuleId: due.rule.id,
        merchant: due.rule.name,
        ...(due.rule.categoryId ? { categoryId: due.rule.categoryId } : {}),
      }),
    );
  }

  const needsAttention =
    overdue.length + dueNotes.length + expiring.length > 0 ||
    (allowance?.exhaustionDate ?? null) !== null;

  return (
    <ScrollView
      style={{ backgroundColor: palette.background }}
      contentContainerStyle={styles.body}
    >
      <Text style={[styles.greeting, { color: palette.dim }]}>{describeDate(today)}</Text>

      {/* ------------------------------------------------------- spending */}
      {/*
        Stacked rather than side by side. A three-decimal dinar total runs to
        eleven characters, and two of them beside each other wrap in the middle of
        the number on a narrow screen — which is exactly where a figure must not
        break.
      */}
      <Pressable
        onPress={() => onNavigate('insights')}
        style={[styles.stats, { backgroundColor: palette.surface }]}
        android_ripple={{ color: palette.ripple }}
      >
        {/*
          Label above the figure, not beside it: sharing a line means the label
          and the number compete for width, and it is the number that gets cut.
        */}
        <Text style={[styles.statLabel, { color: palette.dim }]}>This month</Text>
        <Text style={[styles.statValue, { color: palette.text }]} numberOfLines={1}>
          {formatMoney(month.total, 'fr-TN')}
        </Text>

        <View style={styles.statLine}>
          <Text style={[styles.statLabel, { color: palette.dim }]}>Today</Text>
          <Text style={[styles.statToday, { color: palette.dim }]} numberOfLines={1}>
            {formatMoney(money(todayTotal, BASE_CURRENCY), 'fr-TN')}
          </Text>
        </View>

        {month.unvaluedCount > 0 ? (
          // Never let an unknown amount hide inside a total.
          <Text style={[styles.note, { color: palette.warning }]}>
            {month.unvaluedCount} amount{month.unvaluedCount === 1 ? '' : 's'} not yet
            known
          </Text>
        ) : null}
      </Pressable>

      {/* ------------------------------------------------------ attention */}
      {needsAttention ? (
        <Section title="Needs you" palette={palette}>
          {overdue.map((due) => (
            <Row
              key={`due-${due.rule.id}-${due.date}`}
              icon="🔁"
              title={`${due.rule.name} was due`}
              detail={describeDate(due.date)}
              right={`${toDecimalString(due.rule.amount)} ${due.rule.amount.currency}`}
              tone="warning"
              palette={palette}
              onPress={() => onNavigate('recurring')}
              action={{ label: 'Log', onPress: () => confirmReminder(due) }}
            />
          ))}

          {dueNotes.map((note) => (
            <Row
              key={`note-${note.id}`}
              icon="📝"
              title={note.body}
              detail={note.dueOn ? describeDate(note.dueOn) : ''}
              tone="warning"
              palette={palette}
              onPress={() => onNavigate('notes')}
            />
          ))}

          {expiring.map((document) => {
            const days = document.expiryDate ? daysBetween(today, document.expiryDate) : 0;
            return (
              <Row
                key={`doc-${document.id}`}
                icon="📄"
                title={document.title}
                detail={
                  days < 0
                    ? `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
                    : `expires in ${days} day${days === 1 ? '' : 's'}`
                }
                tone={days < 0 ? 'danger' : 'warning'}
                palette={palette}
                onPress={() => onNavigate('documents')}
              />
            );
          })}

          {allowance?.exhaustionDate ? (
            <Row
              icon="💳"
              title="Foreign allowance running out"
              detail={`projected empty by ${describeDate(allowance.exhaustionDate)}`}
              right={`${toDecimalString(allowance.remaining)} left`}
              tone="danger"
              palette={palette}
              onPress={() => onNavigate('insights')}
            />
          ) : null}
        </Section>
      ) : null}

      {/* -------------------------------------------------------- upcoming */}
      {upcoming.length > 0 ? (
        <Section title="Coming up" palette={palette}>
          {upcoming.map((charge) => (
            <Row
              key={`${charge.rule.id}-${charge.date}`}
              icon={charge.rule.autoLog ? '🔁' : '🔔'}
              title={charge.rule.name}
              detail={`${describeDate(charge.date)}${charge.rule.autoLog ? ' · logs itself' : ''}`}
              right={`${toDecimalString(charge.rule.amount)} ${charge.rule.amount.currency}`}
              palette={palette}
              onPress={() => onNavigate('recurring')}
            />
          ))}
        </Section>
      ) : null}

      {/* ----------------------------------------------------------- debts */}
      {debts.length > 0 ? (
        <Section title="Debts" palette={palette}>
          {debts.map(({ balance, name }) => {
            const owed = balance.net.amountMinor > 0;
            return (
              <Row
                key={balance.personId}
                icon="🤝"
                title={name}
                detail={owed ? 'owes you' : 'you owe'}
                right={`${toDecimalString(
                  money(Math.abs(balance.net.amountMinor), balance.currency),
                )} ${balance.currency}`}
                tone={owed ? 'success' : 'danger'}
                palette={palette}
                onPress={() => onNavigate('debts')}
              />
            );
          })}
        </Section>
      ) : null}

      {/* ---------------------------------------------------------- recent */}
      <Section title="Recently added" palette={palette}>
        {recent.length === 0 ? (
          <Text style={[styles.empty, { color: palette.dim }]}>
            Nothing logged yet. Tap Add expense to start.
          </Text>
        ) : (
          recent.map((expense) => {
            const category = categories.find((c) => c.id === expense.categoryId);
            return (
              <Row
                key={expense.id}
                icon={category?.icon ?? '•'}
                title={expense.merchant ?? category?.name ?? 'Uncategorised'}
                detail={
                  expense.occurredOn === today ? 'today' : describeDate(expense.occurredOn)
                }
                right={`${toDecimalString(expense.amount)} ${expense.amount.currency}`}
                subRight={
                  expense.amount.currency !== BASE_CURRENCY
                    ? expense.base
                      ? `${expense.baseEstimated ? '≈ ' : ''}${toDecimalString(expense.base)} ${BASE_CURRENCY}`
                      : 'awaiting statement'
                    : undefined
                }
                palette={palette}
                // Straight into the editor: a mistake is easiest to fix while you
                // still remember making it.
                onPress={() => onEditExpense(expense)}
              />
            );
          })
        )}
      </Section>

      <Pressable
        onPress={() => onNavigate('add')}
        style={[styles.addButton, { backgroundColor: palette.accent }]}
      >
        <Text style={styles.addButtonText}>Add an expense</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({
  title,
  palette,
  children,
}: {
  title: string;
  palette: Palette;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: palette.dim }]}>{title}</Text>
      {children}
    </View>
  );
}

function Row({
  icon,
  title,
  detail,
  right,
  subRight,
  tone,
  palette,
  onPress,
  action,
}: {
  icon: string;
  title: string;
  detail?: string;
  right?: string;
  subRight?: string;
  tone?: 'warning' | 'danger' | 'success';
  palette: Palette;
  onPress: () => void;
  /** A one-tap resolution, for rows where the obvious answer is usually yes. */
  action?: { label: string; onPress: () => void };
}) {
  const detailColour =
    tone === 'danger'
      ? palette.danger
      : tone === 'warning'
        ? palette.warning
        : tone === 'success'
          ? palette.success
          : palette.dim;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { borderBottomColor: palette.divider }]}
      android_ripple={{ color: palette.ripple }}
    >
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text style={[styles.rowDetail, { color: detailColour }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right ? (
        <View style={styles.rowRight}>
          <Text style={[styles.rowAmount, { color: palette.text }]}>{right}</Text>
          {subRight ? (
            <Text style={[styles.rowDetail, { color: palette.dim }]}>{subRight}</Text>
          ) : null}
        </View>
      ) : null}

      {action ? (
        <Pressable
          onPress={action.onPress}
          style={[styles.action, { backgroundColor: palette.accent }]}
          hitSlop={6}
        >
          <Text style={styles.actionText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, paddingTop: 48, paddingBottom: 48 },
  greeting: { fontSize: 13 },

  stats: { marginTop: 10, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14 },
  statLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 10,
  },
  statLabel: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 },
  statValue: { fontSize: 28, fontWeight: '700', marginTop: 2 },
  statToday: { fontSize: 15, fontWeight: '600', flexShrink: 1 },
  note: { fontSize: 11, marginTop: 6 },

  section: { marginTop: 28 },
  sectionTitle: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  empty: { paddingVertical: 20, lineHeight: 20 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowDetail: { fontSize: 12, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  action: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  actionText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  rowAmount: { fontWeight: '600' },

  addButton: { marginTop: 28, borderRadius: 14, paddingVertical: 16, alignItems: 'center' },
  addButtonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
