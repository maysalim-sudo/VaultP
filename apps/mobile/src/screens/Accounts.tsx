/**
 * Accounts on the phone: where the money is, as last read.
 *
 * Tapping an account asks for its new balance, because that is what you open it
 * to do — you just looked at your banking app. Its name, kind and note are
 * behind "Edit", with archive and delete. Each balance carries the day it was
 * checked, and says so once that is more than a month ago.
 */

import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  type Account,
  ACCOUNT_KINDS,
  type AccountKind,
  BASE_CURRENCY,
  daysBetween,
  formatAmount,
  money,
  radii,
  spacing,
  todayIn,
  typeScale,
} from '@vaultp/core';

import { AmountSheet } from '../components/AmountSheet.js';
import { FieldsSheet } from '../components/FieldsSheet.js';
import { Screen } from '../components/Screen.js';
import { paletteFor, type Palette } from '../components/theme.js';
import type { IntentProps } from '../navigation.js';
import { useOpenVault } from '../vault/VaultContext.js';

const KIND_LABELS: Record<AccountKind, { label: string; icon: string }> = {
  bank: { label: 'Bank', icon: '🏦' },
  cash: { label: 'Cash', icon: '💵' },
  card: { label: 'Card', icon: '💳' },
  savings: { label: 'Savings', icon: '🐷' },
  other: { label: 'Other', icon: '•' },
};

const STALE_AFTER_DAYS = 30;

type Sheet =
  | null
  | { kind: 'new' }
  | { kind: 'newBalance'; name: string; type: AccountKind; note: string }
  | { kind: 'balance'; account: Account }
  | { kind: 'edit'; account: Account };

export function Accounts({ onClose, intent, onIntentHandled }: { onClose?: () => void } & IntentProps) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [showArchived, setShowArchived] = useState(false);

  const accounts = useMemo(() => vault.accounts.listAccounts(showArchived), [vault, version, showArchived]);
  const totals = useMemo(() => vault.accounts.totals(), [vault, version]);

  useEffect(() => {
    if (!intent) return;
    if (intent.kind === 'newAccount') setSheet({ kind: 'new' });
    if (intent.kind === 'account') {
      const account = vault.accounts.getAccount(intent.id);
      if (account) setSheet({ kind: 'balance', account });
    }
    onIntentHandled?.();
  }, [intent, vault, onIntentHandled]);

  function remove(account: Account) {
    Alert.alert(`Delete ${account.name}?`, 'It disappears from every device. Archive keeps it out of sight instead.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => mutate((v) => v.accounts.deleteAccount(account.id)) },
    ]);
  }

  return (
    <Screen onClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: palette.text }]}>Accounts</Text>
          <Pressable
            onPress={() => setSheet({ kind: 'new' })}
            hitSlop={8}
            style={({ pressed }) => [styles.newButton, { backgroundColor: palette.key }, pressed ? styles.pressed : null]}
          >
            <Text style={[styles.newText, { color: palette.text }]}>＋ Account</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {totals.length > 0 ? (
            <View style={[styles.total, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <Text style={[styles.totalLabel, { color: palette.dim }]}>Across your accounts</Text>
              {totals.map((total, index) => (
                <Text
                  key={total.currency}
                  style={[index === 0 ? styles.totalValue : styles.totalSecond, { color: palette.text }]}
                >
                  {formatAmount(total, { unit: 'none' })}
                  <Text style={[styles.totalUnit, { color: palette.dim }]}> {total.currency}</Text>
                </Text>
              ))}
            </View>
          ) : null}

          {accounts.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>💳</Text>
              <Text style={[styles.emptyText, { color: palette.dim }]}>
                Add your bank, the cash in your wallet, a card or a savings pot, with the balance you see today. You type
                it in — nothing here talks to a bank.
              </Text>
            </View>
          ) : null}

          {accounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              age={Math.max(0, daysBetween(account.balanceOn, today))}
              palette={palette}
              onPress={() => setSheet({ kind: 'balance', account })}
              onEdit={() => setSheet({ kind: 'edit', account })}
            />
          ))}

          <Pressable onPress={() => setShowArchived((current) => !current)} hitSlop={8} style={styles.archivedToggle}>
            <Text style={{ color: palette.dim }}>{showArchived ? 'Hide archived' : 'Show archived'}</Text>
          </Pressable>
        </ScrollView>

        {sheet?.kind === 'new' ? (
          <FieldsSheet
            title="New account"
            palette={palette}
            fields={[
              { key: 'name', label: 'Name', placeholder: 'BIAT current account, Wallet…', required: true },
              { key: 'note', label: 'Note', placeholder: 'Optional' },
            ]}
            choices={[
              {
                key: 'kind',
                label: 'Kind',
                initial: 'bank',
                options: ACCOUNT_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind].label })),
              },
            ]}
            saveLabel="Next"
            onCancel={() => setSheet(null)}
            onSave={(values) =>
              setSheet({
                kind: 'newBalance',
                name: values.name ?? '',
                type: (values.kind as AccountKind) ?? 'bank',
                note: values.note ?? '',
              })
            }
          />
        ) : null}

        {sheet?.kind === 'newBalance' ? (
          <AmountSheet
            title={`${sheet.name}: balance today`}
            hint="What your banking app, wallet or statement says right now."
            allowCurrencyChange
            signed
            confirmLabel="Add"
            onCancel={() => setSheet(null)}
            onSave={(minor, currency) => {
              const { name, type, note } = sheet;
              setSheet(null);
              mutate((v) =>
                v.accounts.addAccount({ name, kind: type, balance: money(minor, currency), ...(note ? { note } : {}) }),
              );
            }}
          />
        ) : null}

        {sheet?.kind === 'balance' ? (
          <AmountSheet
            title={`${sheet.account.name}: new balance`}
            hint={`Last checked ${sheet.account.balanceOn}. Saving dates it today.`}
            initialMinor={sheet.account.balance.amountMinor}
            currency={sheet.account.balance.currency}
            allowCurrencyChange
            signed
            confirmLabel="Update"
            onCancel={() => setSheet(null)}
            onSave={(minor, currency) => {
              const id = sheet.account.id;
              setSheet(null);
              mutate((v) => v.accounts.updateAccount(id, { balance: money(minor, currency) }));
            }}
          />
        ) : null}

        {sheet?.kind === 'edit' ? (
          <FieldsSheet
            title="Edit account"
            palette={palette}
            fields={[
              { key: 'name', label: 'Name', initial: sheet.account.name, required: true },
              { key: 'note', label: 'Note', initial: sheet.account.note ?? '' },
            ]}
            choices={[
              {
                key: 'kind',
                label: 'Kind',
                initial: sheet.account.kind,
                options: ACCOUNT_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind].label })),
              },
            ]}
            actions={[
              {
                label: sheet.account.archived ? 'Unarchive' : 'Archive',
                onPress: () => {
                  const account = sheet.account;
                  setSheet(null);
                  mutate((v) =>
                    account.archived ? v.accounts.unarchiveAccount(account.id) : v.accounts.archiveAccount(account.id),
                  );
                },
              },
              {
                label: 'Delete',
                destructive: true,
                onPress: () => {
                  const account = sheet.account;
                  setSheet(null);
                  remove(account);
                },
              },
            ]}
            onCancel={() => setSheet(null)}
            onSave={(values) => {
              const id = sheet.account.id;
              setSheet(null);
              mutate((v) =>
                v.accounts.updateAccount(id, {
                  name: values.name ?? '',
                  note: values.note ?? null,
                  kind: (values.kind as AccountKind) ?? 'other',
                }),
              );
            }}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function AccountCard({
  account,
  age,
  palette,
  onPress,
  onEdit,
}: {
  account: Account;
  age: number;
  palette: Palette;
  onPress: () => void;
  onEdit: () => void;
}) {
  const stale = age > STALE_AFTER_DAYS;
  const negative = account.balance.amountMinor < 0;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onEdit}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
        account.archived ? styles.archived : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={styles.cardIcon}>{KIND_LABELS[account.kind].icon}</Text>
      <View style={styles.cardMain}>
        <Text style={[styles.cardName, { color: palette.text }]} numberOfLines={1}>
          {account.name}
        </Text>
        <Text style={[styles.cardSub, { color: stale ? palette.warning : palette.dim }]} numberOfLines={1}>
          {account.archived ? 'archived · ' : ''}
          {age === 0 ? 'checked today' : age === 1 ? 'checked yesterday' : `checked ${age} days ago`}
          {stale ? ' — worth a fresh look' : ''}
        </Text>
      </View>
      <View style={styles.cardRight}>
        <Text style={[styles.cardAmount, { color: negative ? palette.negative : palette.text }]}>
          {formatAmount(account.balance, { unit: 'none' })}
        </Text>
        <Text style={[styles.cardCurrency, { color: palette.dim }]}>
          {account.balance.currency}
        </Text>
      </View>
      <Pressable onPress={onEdit} hitSlop={10} style={styles.more} accessibilityLabel={`Edit ${account.name}`}>
        <Text style={[styles.moreText, { color: palette.dim }]}>⋯</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 48 },
  pressed: { transform: [{ scale: 0.97 }] },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { flex: 1, fontSize: typeScale.xl, fontWeight: '700', letterSpacing: -0.5 },
  newButton: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radii.pill },
  newText: { fontSize: typeScale.sm, fontWeight: '700' },

  body: { paddingHorizontal: spacing.lg, paddingBottom: 56, gap: spacing.sm },
  total: { borderRadius: radii.lg, borderWidth: 1, padding: spacing.lg, marginBottom: spacing.md },
  totalLabel: { fontSize: typeScale.sm },
  totalValue: { fontSize: 34, fontWeight: '700', letterSpacing: -1, fontVariant: ['tabular-nums'], marginTop: 4 },
  totalSecond: { fontSize: typeScale.lg, fontWeight: '700', fontVariant: ['tabular-nums'], marginTop: 2 },
  totalUnit: { fontSize: typeScale.base, fontWeight: '600' },

  empty: { alignItems: 'center', paddingVertical: 40, gap: spacing.md },
  emptyIcon: { fontSize: 40 },
  emptyText: { textAlign: 'center', lineHeight: 21, paddingHorizontal: spacing.lg },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
  },
  archived: { opacity: 0.55 },
  cardIcon: { fontSize: 24, width: 32, textAlign: 'center' },
  cardMain: { flex: 1 },
  cardName: { fontSize: typeScale.md, fontWeight: '600' },
  cardSub: { fontSize: typeScale.xs, marginTop: 2 },
  cardRight: { alignItems: 'flex-end' },
  cardAmount: { fontSize: typeScale.md, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cardCurrency: { fontSize: typeScale.xs },
  more: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  moreText: { fontSize: 20, fontWeight: '700' },
  archivedToggle: { alignItems: 'center', paddingVertical: spacing.lg },
});
