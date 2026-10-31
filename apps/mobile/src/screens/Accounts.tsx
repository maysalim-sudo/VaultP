/**
 * Accounts: where the money is, as last read.
 *
 * Each account is a tile with its balance in dot-matrix and the day it was
 * checked; a dot turns orange once that is over a month ago, because a figure is
 * only as good as when it was looked at. Tapping asks for a new balance, since
 * that is what you open it to do. Holding opens its name, kind and note, with
 * archive and delete.
 */

import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';

import {
  type Account,
  ACCOUNT_KINDS,
  type AccountKind,
  daysBetween,
  formatAmountParts,
  money,
  todayIn,
} from '@vaultp/core';

import { AmountSheet } from '../components/AmountSheet.js';
import { describeDate } from '../components/DateField.js';
import { FieldsSheet } from '../components/FieldsSheet.js';
import { Empty, Figure, Label, PageHead, Tile } from '../components/Industrial.js';
import { Screen } from '../components/Screen.js';
import { Icon, type IconName } from '../components/icons.js';
import { fonts, paletteFor, type Palette } from '../components/theme.js';
import type { IntentProps } from '../navigation.js';
import { useOpenVault } from '../vault/VaultContext.js';

const KIND_LABELS: Record<AccountKind, { label: string; icon: IconName }> = {
  bank: { label: 'Bank', icon: 'bank' },
  cash: { label: 'Cash', icon: 'cash' },
  card: { label: 'Card', icon: 'card' },
  savings: { label: 'Savings', icon: 'piggy' },
  other: { label: 'Other', icon: 'globe' },
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
  const open = accounts.filter((account) => !account.archived).length;

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

  const kinds = ACCOUNT_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind].label }));

  return (
    <Screen onClose={onClose}>
      <View style={styles.page}>
        <ScrollView contentContainerStyle={styles.body}>
          <PageHead title="Accounts" action="Account" onAction={() => setSheet({ kind: 'new' })} palette={palette} />

          {totals.length > 0 ? (
            <Tile palette={palette}>
              <Label palette={palette}>
                ACROSS {open} ACCOUNT{open === 1 ? '' : 'S'} · AS LAST CHECKED
              </Label>
              {totals.map((total, index) => {
                const parts = formatAmountParts(total);
                return (
                  <Figure key={total.currency} value={parts.figure} unit={parts.unit} size={index === 0 ? 46 : 24} palette={palette} />
                );
              })}
            </Tile>
          ) : null}

          {accounts.length === 0 ? (
            <Empty palette={palette}>ADD YOUR BANK, YOUR WALLET OR A CARD, WITH THE BALANCE YOU SEE TODAY. NOTHING HERE TALKS TO A BANK.</Empty>
          ) : null}

          <View style={styles.grid}>
            {accounts.map((account) => (
              <AccountTile
                key={account.id}
                account={account}
                age={Math.max(0, daysBetween(account.balanceOn, today))}
                palette={palette}
                onPress={() => setSheet({ kind: 'balance', account })}
                onEdit={() => setSheet({ kind: 'edit', account })}
              />
            ))}
          </View>

          {accounts.length > 0 ? (
            <Text style={[styles.hint, { color: palette.textFaint }]}>
              Tap to update a balance; hold to rename or archive.
            </Text>
          ) : null}

          <Pressable onPress={() => setShowArchived((current) => !current)} hitSlop={8} style={styles.archivedToggle}>
            <Label palette={palette} colour={palette.dim}>
              {showArchived ? 'HIDE ARCHIVED' : 'SHOW ARCHIVED'}
            </Label>
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
            choices={[{ key: 'kind', label: 'Kind', initial: 'bank', options: kinds }]}
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
            hint={`Last checked ${describeDate(sheet.account.balanceOn)}. Saving dates it today.`}
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
            choices={[{ key: 'kind', label: 'Kind', initial: sheet.account.kind, options: kinds }]}
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

function AccountTile({
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
  const parts = formatAmountParts(account.balance);
  return (
    <Tile
      palette={palette}
      style={[styles.tile, account.archived ? styles.archived : null]}
      onPress={onPress}
      onLongPress={onEdit}
      label={`${account.name}. Tap to update the balance, hold to edit.`}
    >
      <View style={styles.tileHead}>
        <Icon name={KIND_LABELS[account.kind].icon} size={18} color={palette.dim} />
        <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
          {account.name}
        </Text>
        <View style={[styles.dot, { backgroundColor: stale ? palette.accent : palette.positive }]} />
      </View>
      <Figure
        value={parts.figure}
        unit={parts.unit}
        size={28}
        colour={negative ? palette.accentText : palette.text}
        palette={palette}
      />
      <Label palette={palette} colour={stale ? palette.accentText : palette.textFaint}>
        {account.archived
          ? 'ARCHIVED'
          : age === 0
            ? 'CHECKED TODAY'
            : `CHECKED ${describeDate(account.balanceOn).toUpperCase()}`}
      </Label>
    </Tile>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { paddingHorizontal: 12, paddingBottom: 16, gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: '48.5%', minHeight: 142, justifyContent: 'space-between' },
  archived: { opacity: 0.55 },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: fonts.uiSemibold, fontSize: 15, flex: 1 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  hint: { fontFamily: fonts.ui, fontSize: 12, textAlign: 'center' },
  archivedToggle: { alignItems: 'center', paddingVertical: 12 },
});
