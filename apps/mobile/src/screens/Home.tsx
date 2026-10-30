/**
 * The first screen, in the manner of Ivy Wallet.
 *
 * Ordered by what you can still do something about:
 *
 *   1. what has been spent         — the number you open the app to check
 *   2. what is owed or due soon    — acting on it has a deadline
 *   3. what was added recently     — and can be corrected while you remember it
 *
 * The month's spend is the hero, centred and large. Categories carry colour, so
 * a list of spending can be read by shape before it is read by word. Every figure
 * is tappable through to the thing it came from: a dashboard that only reports
 * leaves you hunting for the screen that can change it.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  addDays,
  autoLogId,
  BASE_CURRENCY,
  type Category,
  categoryColourFor,
  daysBetween,
  type DueOccurrence,
  type Expense,
  forecastAllowance,
  formatAmount,
  formatAmountParts,
  isAllowanceConfigured,
  type LedgerBalance,
  loadAllowanceConfig,
  type Money,
  money,
  monthKey,
  monthTotal,
  noteHeadline,
  pendingReminders,
  radii,
  spacing,
  todayIn,
  typeScale,
  upcomingCharges,
} from '@vaultp/core';

import { describeDate } from '../components/DateField.js';
import { Icon, categoryIcon, type IconName } from '../components/icons.js';
import { fonts, labelStyle, paletteFor, type Palette } from '../components/theme.js';
import type { Navigate } from '../navigation.js';
import { useOpenVault } from '../vault/VaultContext.js';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** A colour at low opacity, for tinted fills. Tokens are six-digit hex. */
function tint(hex: string, alpha = '26'): string {
  return /^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${alpha}` : hex;
}

/**
 * Home used emoji throughout; each one it draws maps to a stroke icon here. A
 * category's own glyph is a person's choice and may be anything, so an emoji
 * not in the map falls back to an icon guessed from the category's name.
 */
const GLYPH_ICONS: Readonly<Record<string, IconName>> = {
  '🔁': 'repeat',
  '🔔': 'bolt',
  '📝': 'notes',
  '📄': 'docs',
  '💳': 'money',
  '🗓️': 'receipt',
  '🤝': 'people',
  '☑️': 'checklist',
  '📷': 'camera',
  '🍽️': 'food',
  '🍽': 'food',
  '🚕': 'car',
  '🛒': 'cart',
  '💻': 'repeat',
  '🧾': 'receipt',
  '💊': 'heart',
  '🏠': 'home',
};

function iconFor(glyph: string, hint?: string | null): IconName {
  return GLYPH_ICONS[glyph] ?? categoryIcon(hint ?? null);
}

export function Home({
  onNavigate,
  onEditExpense,
  onSearch,
}: {
  onNavigate: Navigate;
  onEditExpense: (expense: Expense) => void;
  onSearch: () => void;
}) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();
  const yesterday = addDays(today, -1);

  const month = useMemo(
    () => monthTotal(vault.db, monthKey(today), BASE_CURRENCY),
    [vault, version, today],
  );

  /**
   * Today's spend, with the charges whose value is not known yet counted
   * separately. Folding them in as zero would make the figure quietly wrong.
   */
  const todaySpend = useMemo(() => {
    const expenses = vault.expenses.listExpenses({ from: today, to: today });
    let known = 0;
    let unvalued = 0;
    for (const expense of expenses) {
      if (expense.base) known += expense.base.amountMinor;
      else unvalued += 1;
    }
    return { total: money(known, BASE_CURRENCY), unvalued };
  }, [vault, version, today]);

  const recent = useMemo(() => vault.expenses.listExpenses({ limit: 12 }), [vault, version]);

  /**
   * One bar per day of the month, in the base currency. A foreign charge with
   * no value yet adds nothing rather than a guessed amount.
   */
  const perDay = useMemo(() => {
    const [y, m] = monthKey(today).split('-').map(Number);
    const daysInMonth = new Date(y!, m!, 0).getDate();
    const totals = new Array<number>(daysInMonth).fill(0);
    for (const expense of vault.expenses.listExpenses({ from: `${monthKey(today)}-01`, to: today })) {
      if (!expense.base || expense.base.currency !== BASE_CURRENCY) continue;
      const day = Number(expense.occurredOn.slice(8, 10));
      if (day >= 1 && day <= daysInMonth) totals[day - 1]! += expense.base.amountMinor;
    }
    return totals;
  }, [vault, version, today]);

  /** Pinned first, then the latest touched: what you were in the middle of. */
  const recentNotes = useMemo(
    () =>
      [...vault.notes.listOpen()]
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
        .slice(0, 8),
    [vault, version],
  );

  const accountTotals = useMemo(() => vault.accounts.totals(), [vault, version]);
  const accountCount = useMemo(() => vault.accounts.listAccounts().length, [vault, version]);

  const categories = useMemo(() => vault.expenses.listCategories(true), [vault, version]);
  const categoryById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  );

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
  const balances = useMemo(() => {
    const found: { balance: LedgerBalance; name: string }[] = [];

    for (const person of vault.debts.listPeople(true)) {
      try {
        const balance = vault.debts.ledgerFor(person.id, today);
        if (balance && balance.net.amountMinor !== 0) {
          found.push({ balance, name: person.name });
        }
      } catch {
        // Mixed-currency ledger. It is shown, with its explanation, on the debts
        // screen; there is no single number to put here.
      }
    }

    return found.sort(
      (a, b) => Math.abs(b.balance.net.amountMinor) - Math.abs(a.balance.net.amountMinor),
    );
  }, [vault, version, today]);

  /** Owed to you, in dinars. Other currencies are not converted — see debts. */
  const owedToYou = useMemo(
    () =>
      balances
        .filter(({ balance }) => balance.currency === BASE_CURRENCY && balance.net.amountMinor > 0)
        .reduce((sum, { balance }) => sum + balance.net.amountMinor, 0),
    [balances],
  );

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

  const attentionCount =
    overdue.length + dueNotes.length + expiring.length + (allowance?.exhaustionDate ? 1 : 0);

  /** Recent expenses grouped by the day they happened, newest first. */
  const days = useMemo(() => {
    const groups: { date: string; expenses: Expense[] }[] = [];
    for (const expense of recent) {
      const last = groups[groups.length - 1];
      if (last && last.date === expense.occurredOn) last.expenses.push(expense);
      else groups.push({ date: expense.occurredOn, expenses: [expense] });
    }
    return groups;
  }, [recent]);

  const hero = formatAmountParts(month.total);
  const dayOfMonth = Number(today.slice(8, 10));
  const peak = Math.max(1, ...perDay);
  const [year, monthNumber] = monthKey(today).split('-');

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <ScrollView contentContainerStyle={styles.body}>
        {/* ------------------------------------------------------------ hero */}
        <Pressable
          onPress={() => onNavigate('insights')}
          style={({ pressed }) => [styles.heroTile, { backgroundColor: palette.surface }, pressed ? styles.pressed : null]}
        >
          <View style={styles.labelRow}>
            <Text style={[labelStyle, { color: palette.textFaint }]}>
              SPENT · {MONTHS[Number(monthNumber) - 1]!.toUpperCase()}
            </Text>
            <Text style={[labelStyle, { color: palette.textFaint }]}>
              DAY {String(dayOfMonth).padStart(2, '0')} / {perDay.length}
            </Text>
          </View>
          <View style={styles.heroFigureRow}>
            <Text
              style={[styles.heroFigure, { color: palette.text }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.5}
            >
              {hero.figure}
            </Text>
            <Text style={[styles.heroUnit, { color: palette.dim }]}>{hero.unit}</Text>
          </View>
          <View style={styles.bars} accessibilityLabel="Spending per day this month">
            {perDay.map((value, index) => {
              const day = index + 1;
              const future = day > dayOfMonth;
              return (
                <View
                  key={day}
                  style={[
                    styles.bar,
                    future
                      ? { height: '100%', borderWidth: 1, borderColor: palette.border }
                      : {
                          height: `${Math.max(4, Math.round((value / peak) * 100))}%`,
                          backgroundColor:
                            day === dayOfMonth ? palette.accent : value === 0 ? palette.border : palette.text,
                        },
                  ]}
                />
              );
            })}
          </View>
          {month.unvaluedCount > 0 ? (
            // Never let an unknown amount hide inside a total.
            <Text style={[styles.heroNote, { color: palette.estimate }]}>
              + {month.unvaluedCount} amount{month.unvaluedCount === 1 ? '' : 's'} not yet known
            </Text>
          ) : null}
        </Pressable>

        {/* ----------------------------------------------- quick create: notes */}
        <View style={styles.quickRow}>
          <Pressable
            onPress={() => onNavigate('notes', { kind: 'newNote', with: 'text' })}
            style={({ pressed }) => [
              styles.takeNote,
              { backgroundColor: palette.surface, borderColor: palette.border },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[styles.takeNoteText, { color: palette.dim }]}>Take a note…</Text>
          </Pressable>
          <QuickIcon
            glyph="☑️"
            label="New checklist"
            palette={palette}
            onPress={() => onNavigate('notes', { kind: 'newNote', with: 'checklist' })}
          />
          <QuickIcon
            glyph="📷"
            label="New note from the camera"
            palette={palette}
            onPress={() => onNavigate('notes', { kind: 'newNote', with: 'camera' })}
          />
        </View>

        {recentNotes.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.notesStrip}
            style={styles.notesStripOuter}
          >
            {recentNotes.map((note) => (
              <Pressable
                key={note.id}
                onPress={() => onNavigate('notes', { kind: 'note', id: note.id })}
                style={({ pressed }) => [
                  styles.noteCard,
                  { backgroundColor: palette.surface, borderColor: palette.border },
                  pressed ? styles.pressed : null,
                ]}
              >
                {note.title ? (
                  <Text style={[styles.noteTitle, { color: palette.text }]} numberOfLines={1}>
                    {note.title}
                  </Text>
                ) : null}
                <Text style={[styles.noteBody, { color: palette.dim }]} numberOfLines={note.title ? 3 : 4}>
                  {note.body || 'Empty note'}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}


        {/* ------------------------------------------------------- stat tiles */}
        <View style={styles.tiles}>
          <StatTile
            glyph="🗓️"
            colour={palette.accent}
            label="Today"
            value={formatAmount(todaySpend.total)}
            note={todaySpend.unvalued > 0 ? `+ ${todaySpend.unvalued} not yet known` : undefined}
            noteColour={palette.warning}
            palette={palette}
            onPress={() => onNavigate('insights')}
          />
          <StatTile
            glyph="🤝"
            colour={palette.positive}
            label="Owed to you"
            value={owedToYou > 0 ? formatAmount(money(owedToYou, BASE_CURRENCY)) : 'Nothing'}
            palette={palette}
            onPress={() => onNavigate('debts')}
          />
        </View>
        <View style={styles.tiles}>
          <StatTile
            glyph="💳"
            colour={palette.accent}
            label={accountCount > 0 ? `In ${accountCount} account${accountCount === 1 ? '' : 's'}` : 'Accounts'}
            value={accountTotals.length > 0 ? accountTotals.map((total) => formatAmount(total)).join('  ·  ') : 'Add your balances'}
            palette={palette}
            onPress={() => onNavigate('accounts')}
          />
        </View>

        {/* ------------------------------------------------------- attention */}
        {attentionCount > 0 ? (
          <Section title="Needs you" count={attentionCount} countColour={palette.warning} palette={palette}>
            {overdue.map((due) => (
              <ActionRow
                key={`due-${due.rule.id}-${due.date}`}
                glyph="🔁"
                colour={palette.warning}
                title={`${due.rule.name} was due`}
                detail={describeDate(due.date)}
                detailColour={palette.warning}
                right={formatAmount(due.rule.amount)}
                palette={palette}
                onPress={() => onNavigate('recurring')}
                action={{ label: 'Log', onPress: () => confirmReminder(due) }}
              />
            ))}

            {dueNotes.map((note) => (
              <ActionRow
                key={`note-${note.id}`}
                glyph="📝"
                colour={palette.warning}
                title={noteHeadline(note)}
                detail={note.dueOn ? describeDate(note.dueOn) : ''}
                detailColour={palette.warning}
                palette={palette}
                onPress={() => onNavigate('notes', { kind: 'note', id: note.id })}
              />
            ))}

            {expiring.map((document) => {
              const days = document.expiryDate ? daysBetween(today, document.expiryDate) : 0;
              return (
                <ActionRow
                  key={`doc-${document.id}`}
                  glyph="📄"
                  colour={days < 0 ? palette.negative : palette.warning}
                  title={document.title}
                  detail={
                    days < 0
                      ? `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
                      : `expires in ${days} day${days === 1 ? '' : 's'}`
                  }
                  detailColour={days < 0 ? palette.negative : palette.warning}
                  palette={palette}
                  onPress={() => onNavigate('documents', { kind: 'document', id: document.id })}
                />
              );
            })}

            {allowance?.exhaustionDate ? (
              <ActionRow
                glyph="💳"
                colour={palette.negative}
                title="Foreign allowance running out"
                detail={`projected empty by ${describeDate(allowance.exhaustionDate)}`}
                detailColour={palette.negative}
                right={`${formatAmount(allowance.remaining)} left`}
                palette={palette}
                onPress={() => onNavigate('insights')}
              />
            ) : null}
          </Section>
        ) : null}

        {/* -------------------------------------------------------- upcoming */}
        {upcoming.length > 0 ? (
          <Section title="Upcoming" count={upcoming.length} countColour={palette.accent} palette={palette}>
            {upcoming.map((charge) => {
              const category = charge.rule.categoryId
                ? categoryById.get(charge.rule.categoryId)
                : undefined;
              return (
                <ActionRow
                  key={`${charge.rule.id}-${charge.date}`}
                  glyph={category?.icon ?? (charge.rule.autoLog ? '🔁' : '🔔')}
                  colour={
                    category ? categoryColourFor(category.id, category.color) : palette.accent
                  }
                  solid={Boolean(category)}
                  title={charge.rule.name}
                  detail={`${describeDate(charge.date)}${charge.rule.autoLog ? ' · logs itself' : ''}`}
                  right={formatAmount(charge.rule.amount)}
                  palette={palette}
                  onPress={() => onNavigate('recurring')}
                />
              );
            })}
          </Section>
        ) : null}

        {/* ----------------------------------------------------------- debts */}
        {balances.length > 0 ? (
          <Section title="Debts" count={balances.length} countColour={palette.dim} palette={palette}>
            {balances.slice(0, 3).map(({ balance, name }) => {
              const owed = balance.net.amountMinor > 0;
              return (
                <ActionRow
                  key={balance.personId}
                  glyph={name.slice(0, 1).toUpperCase()}
                  colour={owed ? palette.positive : palette.negative}
                  title={name}
                  // Direction in words, never a sign: "-200" reads as either the
                  // moment you stop concentrating.
                  detail={owed ? 'owes you' : 'you owe'}
                  detailColour={owed ? palette.positive : palette.negative}
                  right={formatAmount(money(Math.abs(balance.net.amountMinor), balance.currency))}
                  palette={palette}
                  onPress={() => onNavigate('debts', { kind: 'person', id: balance.personId })}
                />
              );
            })}
          </Section>
        ) : null}

        {/* ---------------------------------------------------- transactions */}
        <Text style={[styles.sectionTitle, styles.transactionsTitle, { color: palette.text }]}>
          Recent
        </Text>

        {days.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="receipt" size={40} color={palette.textFaint} />
            <Text style={[styles.emptyText, { color: palette.dim }]}>
              No expenses yet. The orange + below adds the first.
            </Text>
          </View>
        ) : null}

        {days.map((day) => {
          let known = 0;
          let unvalued = 0;
          for (const expense of day.expenses) {
            if (expense.base) known += expense.base.amountMinor;
            else unvalued += 1;
          }
          const label =
            day.date === today ? 'Today' : day.date === yesterday ? 'Yesterday' : describeDate(day.date);

          return (
            <View key={day.date} style={styles.day}>
              <View style={styles.dayHead}>
                <Text style={[styles.dayLabel, { color: palette.text }]}>{label}</Text>
                {/* A day with an unvalued charge says so rather than presenting a
                    partial sum as the whole. */}
                <Text style={[styles.dayTotal, { color: palette.dim }]}>
                  {formatAmount(money(known, BASE_CURRENCY))}
                  {unvalued > 0 ? ' + ?' : ''}
                </Text>
              </View>

              {day.expenses.map((expense) => (
                <TransactionRow
                  key={expense.id}
                  expense={expense}
                  category={expense.categoryId ? categoryById.get(expense.categoryId) : undefined}
                  palette={palette}
                  // Straight into the editor: a mistake is easiest to fix while
                  // you still remember making it.
                  onPress={() => onEditExpense(expense)}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>

      {/* The one primary action, always within thumb's reach. */}
      <View style={styles.fabDock} pointerEvents="box-none">
        <Pressable
          onPress={() => onNavigate('add')}
          accessibilityLabel="Add an expense"
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: palette.accent, elevation: palette.elevationOverlay },
            pressed ? styles.fabPressed : null,
          ]}
        >
          <Text style={[styles.fabGlyph, { color: palette.onAccent }]}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function QuickIcon({
  glyph,
  label,
  palette,
  onPress,
}: {
  glyph: string;
  label: string;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.quickIcon,
        { backgroundColor: palette.surface, borderColor: palette.border },
        pressed ? styles.pressed : null,
      ]}
    >
      <Icon name={iconFor(glyph)} size={20} color={palette.text} />
    </Pressable>
  );
}

function StatTile({
  glyph,
  colour,
  label,
  value,
  note,
  noteColour,
  palette,
  onPress,
}: {
  glyph: string;
  colour: string;
  label: string;
  value: string;
  note?: string;
  noteColour?: string;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: palette.surface, borderColor: palette.border, elevation: palette.elevationCard },
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: palette.surfaceOverlay }]}>
        <Icon name={iconFor(glyph)} size={18} color={colour} />
      </View>
      <Text style={[styles.tileLabel, { color: palette.dim }]}>{label}</Text>
      <Text style={[styles.tileValue, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      {note ? <Text style={[styles.tileNote, { color: noteColour ?? palette.dim }]}>{note}</Text> : null}
    </Pressable>
  );
}

function Section({
  title,
  count,
  countColour,
  palette,
  children,
}: {
  title: string;
  count: number;
  countColour: string;
  palette: Palette;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={[labelStyle, { color: palette.textFaint }]}>{title.toUpperCase()}</Text>
        <View style={[styles.badge, { backgroundColor: tint(countColour, '2E') }]}>
          <Text style={[styles.badgeText, { color: countColour }]}>{count}</Text>
        </View>
      </View>
      {/* Rows grouped on one generous, rounded surface. */}
      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border, elevation: palette.elevationCard },
        ]}
      >
        {children}
      </View>
    </View>
  );
}

/** A round tile with a glyph: solid for a category, tinted for everything else. */
function Dot({ glyph, colour, hint }: { glyph: string; colour: string; solid?: boolean; hint?: string | null }) {
  return (
    <View style={[styles.dot, { backgroundColor: tint(colour, '1F') }]}>
      <Icon name={iconFor(glyph, hint)} size={18} color={colour} />
    </View>
  );
}

function ActionRow({
  glyph,
  colour,
  solid = false,
  title,
  detail,
  detailColour,
  right,
  palette,
  onPress,
  action,
}: {
  glyph: string;
  colour: string;
  solid?: boolean;
  title: string;
  detail?: string;
  detailColour?: string;
  right?: string;
  palette: Palette;
  onPress: () => void;
  /** A one-tap resolution, for rows where the obvious answer is usually yes. */
  action?: { label: string; onPress: () => void };
}) {
  return (
    <Pressable onPress={onPress} style={styles.row} android_ripple={{ color: palette.ripple }}>
      <Dot glyph={glyph} colour={colour} solid={solid} />
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
          {title}
        </Text>
        {detail ? (
          <Text style={[styles.rowDetail, { color: detailColour ?? palette.dim }]} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {right ? <Text style={[styles.rowAmount, { color: palette.text }]}>{right}</Text> : null}
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={6}
          style={({ pressed }) => [
            styles.action,
            { backgroundColor: palette.accent },
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={[styles.actionText, { color: palette.onAccent }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function TransactionRow({
  expense,
  category,
  palette,
  onPress,
}: {
  expense: Expense;
  category: Category | undefined;
  palette: Palette;
  onPress: () => void;
}) {
  const name = category?.name ?? 'Uncategorised';
  const glyph = category?.icon ?? name.slice(0, 1).toUpperCase();
  const foreign = expense.amount.currency !== BASE_CURRENCY;

  // Three states for a foreign charge, kept apart: what the bank debited, an
  // estimate marked as one, or nothing known yet — never a zero standing in.
  const converted = !foreign
    ? null
    : expense.base
      ? {
          text: formatAmount(expense.base, { estimated: expense.baseEstimated }),
          colour: expense.baseEstimated ? palette.estimate : palette.dim,
        }
      : { text: 'awaiting statement', colour: palette.textFaint };

  return (
    <Pressable onPress={onPress} style={styles.transaction} android_ripple={{ color: palette.ripple }}>
      {category ? (
        <Dot glyph={glyph} colour={palette.dim} hint={category.name} />
      ) : (
        <View style={[styles.dot, { backgroundColor: palette.key }]}>
          <Text style={[styles.dotGlyph, { color: palette.dim }]}>•</Text>
        </View>
      )}
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={1}>
          {expense.merchant ?? name}
        </Text>
        <Text style={[styles.rowDetail, { color: palette.dim }]} numberOfLines={1}>
          {expense.merchant ? name : 'No merchant'}
        </Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, { color: palette.text }]}>{formatAmount(expense.amount)}</Text>
        {converted ? (
          <Text style={[styles.rowDetail, styles.figure, { color: converted.colour }]}>
            {converted.text}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: spacing.lg, paddingTop: 8, paddingBottom: 32 },

  // The month: the figure in dot-matrix, and one bar per day with today in orange.
  heroTile: { borderRadius: radii.xl, padding: 20, gap: 16 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroFigureRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  heroFigure: { fontFamily: fonts.display, fontSize: 72, lineHeight: 72, flexShrink: 1 },
  heroUnit: { fontFamily: fonts.monoMedium, fontSize: 13, letterSpacing: 1, paddingBottom: 8 },
  heroNote: { fontFamily: fonts.mono, fontSize: 11 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 72 },
  bar: { flex: 1, minHeight: 3, borderRadius: 3 },

  tiles: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },

  // Notes first: a blank note is one tap from opening the app.
  quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  takeNote: { flex: 1, borderRadius: radii.xl, paddingHorizontal: spacing.lg, paddingVertical: 16 },
  takeNoteText: { fontFamily: fonts.uiMedium, fontSize: typeScale.md },
  quickIcon: { width: 54, borderRadius: radii.xl, alignItems: 'center', justifyContent: 'center' },
  notesStripOuter: { marginHorizontal: -spacing.lg, marginTop: spacing.md },
  notesStrip: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  noteCard: { width: 156, minHeight: 104, borderRadius: radii.lg, padding: 14, gap: 6 },
  noteTitle: { fontFamily: fonts.uiSemibold, fontSize: typeScale.base, letterSpacing: -0.1 },
  noteBody: { fontFamily: fonts.ui, fontSize: typeScale.sm, lineHeight: 18 },
  tile: {
    flex: 1,
    borderRadius: radii.xl,
    padding: 18,
    gap: 4,
  },
  tileIcon: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  tileLabel: { ...labelStyle },
  tileValue: { fontFamily: fonts.monoMedium, fontSize: typeScale.md, fontVariant: ['tabular-nums'] },
  tileNote: { fontFamily: fonts.mono, fontSize: 11 },

  section: { marginTop: spacing.xl },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  sectionTitle: { ...labelStyle },
  transactionsTitle: { marginTop: spacing.xl, marginBottom: spacing.xs, marginLeft: spacing.xs },
  badge: { minWidth: 24, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill, alignItems: 'center' },
  badgeText: { fontFamily: fonts.monoBold, fontSize: typeScale.xs },
  card: {
    borderRadius: radii.xl,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  transaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  dot: {
    width: 42,
    height: 42,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotGlyph: { fontSize: 17, fontWeight: '800' },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: typeScale.md, fontWeight: '700' },
  rowDetail: { fontSize: typeScale.xs, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: typeScale.base, fontWeight: '800', fontVariant: ['tabular-nums'] },
  figure: { fontVariant: ['tabular-nums'] },
  action: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radii.pill },
  actionText: { fontWeight: '800', fontSize: typeScale.sm },

  day: { marginTop: spacing.md },
  dayHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingHorizontal: spacing.xs,
    marginBottom: 2,
  },
  dayLabel: { fontSize: typeScale.sm, fontWeight: '800' },
  dayTotal: { fontSize: typeScale.sm, fontWeight: '600', fontVariant: ['tabular-nums'] },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm },
  emptyText: { fontSize: typeScale.sm },

  fabDock: { position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center' },
  fab: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGlyph: { fontSize: 34, fontWeight: '400', marginTop: -3 },

  // Press feedback: the element answers the finger before anything else happens.
  pressed: { transform: [{ scale: 0.97 }] },
  fabPressed: { transform: [{ scale: 0.93 }] },
});
