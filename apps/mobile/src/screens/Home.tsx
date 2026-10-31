/**
 * The first screen: the bento.
 *
 * The month leads, as one figure and one bar per day. Around it, in the order
 * you can do something about them: a note one tap away, what you are owed and
 * owe, the next bill, what needs you, and your recent notes. Every tile opens
 * the thing it came from, because a dashboard that only reports leaves you
 * hunting for the screen that can change it.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import {
  autoLogId,
  BASE_CURRENCY,
  budgetForMonth,
  daysBetween,
  type DueOccurrence,
  forecastAllowance,
  forecastMonth,
  formatAmount,
  formatAmountParts,
  isAllowanceConfigured,
  type LedgerBalance,
  loadAllowanceConfig,
  money,
  monthKey,
  monthTotal,
  noteHeadline,
  pendingReminders,
  todayIn,
  upcomingCharges,
} from '@vaultp/core';

import { describeDate } from '../components/DateField.js';
import { Figure, Label, Pill, Row, Tile } from '../components/Industrial.js';
import { Icon } from '../components/icons.js';
import { fonts, labelStyle, paletteFor, type Palette } from '../components/theme.js';
import type { Navigate } from '../navigation.js';
import { useOpenVault } from '../vault/VaultContext.js';

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

export function Home({ onNavigate }: { onNavigate: Navigate }) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const month = useMemo(() => monthTotal(vault.db, monthKey(today), BASE_CURRENCY), [vault, version, today]);
  const forecast = useMemo(() => forecastMonth(vault.expenses, vault.db, today), [vault, version, today]);

  /** Everything budgeted this month, or nothing to show if no limit is set. */
  const budgeted = useMemo(() => {
    let total = 0;
    for (const budget of budgetForMonth(vault.expenses, vault.db, monthKey(today))) {
      total += budget.available?.amountMinor ?? 0;
    }
    return total;
  }, [vault, version, today]);

  /**
   * One bar per day of the month, in the base currency, and today's figure. A
   * foreign charge with no value yet adds nothing rather than a guessed amount.
   */
  const { perDay, spentToday } = useMemo(() => {
    const [y, m] = monthKey(today).split('-').map(Number);
    const totals = new Array<number>(new Date(y!, m!, 0).getDate()).fill(0);
    for (const expense of vault.expenses.listExpenses({ from: `${monthKey(today)}-01`, to: today })) {
      if (!expense.base || expense.base.currency !== BASE_CURRENCY) continue;
      const day = Number(expense.occurredOn.slice(8, 10));
      if (day >= 1 && day <= totals.length) totals[day - 1]! += expense.base.amountMinor;
    }
    return { perDay: totals, spentToday: totals[Number(today.slice(8, 10)) - 1] ?? 0 };
  }, [vault, version, today]);

  /** Pinned first, then the latest touched: what you were in the middle of. */
  const notes = useMemo(() => vault.notes.listOpen(), [vault, version]);
  const recentNotes = [...notes]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 4);

  const accountTotals = useMemo(() => vault.accounts.totals(), [vault, version]);
  const accountCount = useMemo(() => vault.accounts.listAccounts().length, [vault, version]);

  const nextBill = useMemo(() => upcomingCharges(vault.expenses, today, 45)[0], [vault, version, today]);
  const overdue = useMemo(() => pendingReminders(vault.expenses, today).slice(0, 3), [vault, version, today]);
  const dueNotes = useMemo(() => vault.notes.overdue(today).slice(0, 3), [vault, version, today]);
  const expiring = useMemo(() => vault.documents.expiringSoon(today).slice(0, 3), [vault, version, today]);

  /**
   * Per person rather than `allBalances`, which computes them in one pass and so
   * throws the whole list away if any one ledger mixes currencies. One
   * unrepresentable person should cost that person's row, not every balance.
   */
  const balances = useMemo(() => {
    const found: { balance: LedgerBalance; name: string }[] = [];
    for (const person of vault.debts.listPeople(true)) {
      try {
        const balance = vault.debts.ledgerFor(person.id, today);
        if (balance && balance.net.amountMinor !== 0) found.push({ balance, name: person.name });
      } catch {
        // A mixed-currency ledger is explained on the People page; there is no
        // single number to put here.
      }
    }
    return found.sort((a, b) => Math.abs(b.balance.net.amountMinor) - Math.abs(a.balance.net.amountMinor));
  }, [vault, version, today]);

  // Dinars only: other currencies are not converted, as on the People page.
  const inBase = balances.filter(({ balance }) => balance.currency === BASE_CURRENCY);
  const owed = inBase.filter(({ balance }) => balance.net.amountMinor > 0);
  const owing = inBase.filter(({ balance }) => balance.net.amountMinor < 0);
  const owedMinor = owed.reduce((sum, { balance }) => sum + balance.net.amountMinor, 0);
  const owingMinor = owing.reduce((sum, { balance }) => sum - balance.net.amountMinor, 0);

  const allowance = useMemo(() => {
    const config = loadAllowanceConfig(vault.store);
    return isAllowanceConfigured(config) ? forecastAllowance(vault.db, config, today) : null;
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

  const hero = formatAmountParts(month.total);
  const dayOfMonth = Number(today.slice(8, 10));
  const peak = Math.max(1, ...perDay);
  const monthName = MONTHS[Number(today.slice(5, 7)) - 1]!;
  const billDays = nextBill ? daysBetween(today, nextBill.date) : 0;

  const attention = overdue.length + dueNotes.length + expiring.length + (allowance?.exhaustionDate ? 1 : 0);
  let rowNumber = 0;
  const numbered = () => {
    rowNumber += 1;
    return { first: rowNumber === 1, leading: <RowNumber value={rowNumber} palette={palette} /> };
  };

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.body}>
      {/* The month: one figure, one bar per day. */}
      <Tile palette={palette} style={styles.hero} onPress={() => onNavigate('insights')} label="Spent this month">
        <View style={styles.labelRow}>
          <Label palette={palette}>SPENT · {monthName}</Label>
          <View style={styles.dayMark}>
            <View style={[styles.dot, { backgroundColor: palette.accent }]} />
            <Label palette={palette}>
              DAY {String(dayOfMonth).padStart(2, '0')} / {perDay.length}
            </Label>
          </View>
        </View>
        <Figure value={hero.figure} unit={hero.unit} size={68} palette={palette} />
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
                    ? { height: '100%', borderWidth: 1, borderStyle: 'dashed', borderColor: palette.border }
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
        <View style={[styles.heroFoot, { borderTopColor: palette.border }]}>
          <HeroCell label="TODAY" value={formatAmount(money(spentToday, BASE_CURRENCY), { unit: 'none' })} palette={palette} />
          <HeroCell
            label="HEADING FOR"
            value={formatAmount(forecast.projectedTotal, { unit: 'none', estimated: true })}
            colour={palette.estimate}
            palette={palette}
          />
          {budgeted > 0 ? (
            <HeroCell label="BUDGET" value={formatAmount(money(budgeted, BASE_CURRENCY), { unit: 'none' })} palette={palette} />
          ) : null}
        </View>
        {month.unvaluedCount > 0 ? (
          // Never let an unknown amount hide inside a total.
          <Text style={[styles.heroNote, { color: palette.estimate }]}>
            + {month.unvaluedCount} amount{month.unvaluedCount === 1 ? '' : 's'} not yet known
          </Text>
        ) : null}
      </Tile>

      {/* A note, one tap from opening the app: where this app started. */}
      <View style={styles.quickRow}>
        <Pressable
          onPress={() => onNavigate('notes', { kind: 'newNote', with: 'text' })}
          accessibilityRole="button"
          style={({ pressed }) => [styles.takeNote, { backgroundColor: palette.surface }, pressed ? styles.pressed : null]}
        >
          <Text style={[styles.takeNoteText, { color: palette.dim }]}>Take a note…</Text>
        </Pressable>
        <QuickIcon
          icon="checklist"
          label="New checklist"
          palette={palette}
          onPress={() => onNavigate('notes', { kind: 'newNote', with: 'checklist' })}
        />
        <QuickIcon
          icon="camera"
          label="New note from the camera"
          palette={palette}
          onPress={() => onNavigate('notes', { kind: 'newNote', with: 'camera' })}
        />
      </View>

      <View style={styles.pair}>
        <Tile palette={palette} style={styles.half} onPress={() => onNavigate('debts')} label="Owed to you">
          <Label palette={palette}>OWED TO YOU</Label>
          <View style={styles.tileFoot}>
            <Figure
              value={formatAmount(money(owedMinor, BASE_CURRENCY), { unit: 'none' })}
              size={30}
              colour={owedMinor > 0 ? palette.positive : palette.textFaint}
              palette={palette}
            />
            <Text style={[styles.sub, { color: palette.dim }]} numberOfLines={1}>
              {owed.length === 0 ? 'Nothing out' : owed.length === 1 ? owed[0]!.name : `${owed.length} people`}
            </Text>
          </View>
        </Tile>
        <Tile palette={palette} style={styles.half} onPress={() => onNavigate('debts')} label="You owe">
          <Label palette={palette}>YOU OWE</Label>
          <View style={styles.tileFoot}>
            <Figure
              value={formatAmount(money(owingMinor, BASE_CURRENCY), { unit: 'none' })}
              size={30}
              colour={owingMinor > 0 ? palette.accentText : palette.textFaint}
              palette={palette}
            />
            <Text style={[styles.sub, { color: palette.dim }]} numberOfLines={1}>
              {owing.length === 0 ? 'All clear' : owing.length === 1 ? owing[0]!.name : `${owing.length} people`}
            </Text>
          </View>
        </Tile>
      </View>

      {allowance || nextBill ? (
        <View style={styles.pair}>
          {allowance ? (
            <Tile palette={palette} style={styles.half} onPress={() => onNavigate('insights')} label="Foreign allowance">
              <Label palette={palette}>FX ALLOWANCE</Label>
              <View style={styles.dialRow}>
                <Dial ratio={allowance.ratioUsed} palette={palette} />
                <View style={styles.dialText}>
                  <Text style={[styles.dialLine, { color: palette.text }]} numberOfLines={1}>
                    {formatAmount(allowance.remaining, { unit: 'none' })} LEFT
                  </Text>
                  {allowance.exhaustionDate ? (
                    <Text style={[styles.dialLine, { color: palette.accentText }]} numberOfLines={1}>
                      OUT ≈ {describeDate(allowance.exhaustionDate).toUpperCase()}
                    </Text>
                  ) : null}
                </View>
              </View>
            </Tile>
          ) : null}
          {nextBill ? (
            <Pressable
              onPress={() => onNavigate('recurring')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.bill, { backgroundColor: palette.accent }, pressed ? styles.pressed : null]}
            >
              <View style={styles.labelRow}>
                <Label palette={palette} colour={palette.onAccent}>
                  NEXT BILL
                </Label>
                <Label palette={palette} colour={palette.onAccent}>
                  {nextBill.rule.autoLog ? 'AUTO' : 'REMIND'}
                </Label>
              </View>
              <View style={styles.tileFoot}>
                <Figure
                  value={billDays === 0 ? 'TODAY' : `${billDays} DAY${billDays === 1 ? '' : 'S'}`}
                  size={30}
                  colour={palette.onAccent}
                  palette={palette}
                />
                <Text style={[styles.billLine, { color: palette.onAccent }]} numberOfLines={1}>
                  {nextBill.rule.name} · {formatAmount(nextBill.rule.amount)}
                </Text>
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {accountCount > 0 ? (
        <Tile palette={palette} onPress={() => onNavigate('accounts')} label="Accounts">
          <Label palette={palette}>
            IN {accountCount} ACCOUNT{accountCount === 1 ? '' : 'S'} · AS LAST CHECKED
          </Label>
          {accountTotals.map((total, index) => {
            const parts = formatAmountParts(total);
            return <Figure key={total.currency} value={parts.figure} unit={parts.unit} size={index === 0 ? 34 : 22} palette={palette} />;
          })}
        </Tile>
      ) : null}

      {attention > 0 ? (
        <View style={[styles.rows, { backgroundColor: palette.surface }]}>
          <View style={styles.rowsHead}>
            <Label palette={palette}>NEEDS YOU</Label>
            <Label palette={palette}>{String(attention).padStart(2, '0')}</Label>
          </View>
          {overdue.map((due) => (
            <Row
              key={`due-${due.rule.id}-${due.date}`}
              {...numbered()}
              palette={palette}
              title={`${due.rule.name} was due`}
              meta={describeDate(due.date)}
              value={formatAmount(due.rule.amount, { unit: 'none' })}
              onPress={() => onNavigate('recurring')}
              trailing={<Pill label="Log" palette={palette} onPress={() => confirmReminder(due)} />}
            />
          ))}
          {dueNotes.map((note) => (
            <Row
              key={`note-${note.id}`}
              {...numbered()}
              palette={palette}
              title={noteHeadline(note)}
              {...(note.dueOn ? { meta: `Due ${describeDate(note.dueOn)}` } : {})}
              onPress={() => onNavigate('notes', { kind: 'note', id: note.id })}
            />
          ))}
          {expiring.map((document) => {
            const days = document.expiryDate ? daysBetween(today, document.expiryDate) : 0;
            return (
              <Row
                key={`doc-${document.id}`}
                {...numbered()}
                palette={palette}
                title={days < 0 ? `${document.title} has ended` : `${document.title} ends in ${days} days`}
                {...(document.expiryDate ? { meta: describeDate(document.expiryDate) } : {})}
                value={`${Math.abs(days)} D`}
                valueColour={palette.accentText}
                onPress={() => onNavigate('documents', { kind: 'document', id: document.id })}
              />
            );
          })}
          {allowance?.exhaustionDate ? (
            <Row
              {...numbered()}
              palette={palette}
              title="Foreign allowance running out"
              meta={`Projected empty by ${describeDate(allowance.exhaustionDate)}`}
              value={formatAmount(allowance.remaining, { unit: 'none' })}
              valueColour={palette.accentText}
              onPress={() => onNavigate('insights')}
            />
          ) : null}
        </View>
      ) : null}

      {recentNotes.length > 0 ? (
        <Tile palette={palette}>
          <View style={styles.labelRow}>
            <Label palette={palette}>RECENT NOTES</Label>
            <Pressable onPress={() => onNavigate('notes')} hitSlop={10} accessibilityRole="button">
              <Label palette={palette} colour={palette.text}>
                ALL {notes.length} →
              </Label>
            </Pressable>
          </View>
          <View style={styles.noteGrid}>
            {recentNotes.map((note) => (
              <Pressable
                key={note.id}
                onPress={() => onNavigate('notes', { kind: 'note', id: note.id })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.noteCard, { backgroundColor: palette.key }, pressed ? styles.pressed : null]}
              >
                <NoteMark done={note.checklist?.done} total={note.checklist?.total} palette={palette} />
                <Text style={[styles.noteTitle, { color: palette.text }]} numberOfLines={1}>
                  {note.title || noteHeadline(note)}
                </Text>
                <Text style={[styles.noteBody, { color: palette.dim }]} numberOfLines={2}>
                  {note.body || 'Empty note'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Tile>
      ) : null}
    </ScrollView>
  );
}

function HeroCell({
  label,
  value,
  colour,
  palette,
}: {
  label: string;
  value: string;
  colour?: string;
  palette: Palette;
}) {
  return (
    <View style={styles.heroCell}>
      <Text style={[labelStyle, styles.heroCellLabel, { color: palette.textFaint }]}>{label}</Text>
      <Text style={[styles.heroCellValue, { color: colour ?? palette.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function QuickIcon({
  icon,
  label,
  palette,
  onPress,
}: {
  icon: 'checklist' | 'camera';
  label: string;
  palette: Palette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.quickIcon, { backgroundColor: palette.surface }, pressed ? styles.pressed : null]}
    >
      <Icon name={icon} size={20} color={palette.text} />
    </Pressable>
  );
}

function RowNumber({ value, palette }: { value: number; palette: Palette }) {
  return <Text style={[styles.rowNumber, { color: palette.textFaint }]}>{String(value).padStart(2, '0')}</Text>;
}

/** A checklist's ticks as dots; anything else, one orange dot. */
function NoteMark({ done, total, palette }: { done?: number | undefined; total?: number | undefined; palette: Palette }) {
  if (!total) return <View style={[styles.dot, { backgroundColor: palette.accent }]} />;
  return (
    <View style={styles.marks}>
      {Array.from({ length: Math.min(total, 8) }, (_, index) => (
        <View key={index} style={[styles.dot, { backgroundColor: index < (done ?? 0) ? palette.text : palette.border }]} />
      ))}
    </View>
  );
}

/** The allowance dial: a dotted ring, filled to what has been used. */
function Dial({ ratio, palette }: { ratio: number; palette: Palette }) {
  const size = 68;
  const radius = 29;
  const around = 2 * Math.PI * radius;
  const used = Math.max(0, Math.min(1, ratio));
  return (
    <View style={styles.dial}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={styles.dialRing}>
        <Circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={palette.border} strokeWidth={6} strokeDasharray="1.6 3.58" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={used >= 0.9 ? palette.accent : palette.text}
          strokeWidth={6}
          strokeDasharray={`${around * used} ${around}`}
        />
      </Svg>
      <Text style={[styles.dialFigure, { color: palette.text }]}>{Math.round(used * 100)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 16, gap: 10 },
  pressed: { transform: [{ scale: 0.98 }] },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },

  hero: { gap: 16, padding: 20 },
  dayMark: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 72 },
  bar: { flex: 1, minHeight: 3, borderRadius: 3 },
  heroFoot: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingTop: 14, borderTopWidth: 1 },
  heroCell: { flexShrink: 1, gap: 4 },
  heroCellLabel: { fontSize: 9 },
  heroCellValue: { fontFamily: fonts.monoMedium, fontSize: 14 },
  heroNote: { fontFamily: fonts.ui, fontSize: 12 },

  quickRow: { flexDirection: 'row', gap: 8 },
  takeNote: { flex: 1, height: 52, borderRadius: 26, paddingHorizontal: 20, justifyContent: 'center' },
  takeNoteText: { fontFamily: fonts.uiMedium, fontSize: 15 },
  quickIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },

  pair: { flexDirection: 'row', gap: 10 },
  half: { flex: 1, minHeight: 138, justifyContent: 'space-between' },
  tileFoot: { gap: 6 },
  sub: { fontFamily: fonts.ui, fontSize: 12 },

  bill: { flex: 1, minHeight: 138, borderRadius: 22, padding: 18, justifyContent: 'space-between', gap: 12 },
  billLine: { fontFamily: fonts.uiSemibold, fontSize: 13 },

  dialRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dial: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center' },
  dialRing: { position: 'absolute', transform: [{ rotate: '-90deg' }] },
  dialFigure: { fontFamily: fonts.display, fontSize: 19 },
  dialText: { flex: 1, gap: 4 },
  dialLine: { fontFamily: fonts.mono, fontSize: 10 },

  rows: { borderRadius: 22, paddingVertical: 6, overflow: 'hidden' },
  rowsHead: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 12, paddingBottom: 8 },
  rowNumber: { fontFamily: fonts.mono, fontSize: 11, width: 18 },

  noteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  noteCard: { width: '48.7%', minHeight: 104, borderRadius: 14, padding: 14, gap: 6 },
  marks: { flexDirection: 'row', gap: 4 },
  noteTitle: { fontFamily: fonts.uiSemibold, fontSize: 14, letterSpacing: -0.15 },
  noteBody: { fontFamily: fonts.ui, fontSize: 12, lineHeight: 17 },
});
