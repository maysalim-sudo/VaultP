/**
 * A keypad in a sheet, for the places where one number is being set.
 *
 * Shared by budgets, the allowance ceiling and every debt entry, so the digits sit
 * in the same place everywhere and muscle memory carries between screens.
 */

import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';

import { BASE_CURRENCY, exponentOf } from '@vaultp/core';

import { AmountDisplay, AmountPad } from './AmountPad.js';
import {
  EMPTY_DRAFT,
  type Draft,
  draftFromMinor,
  draftToMinor,
  retypeForExponent,
} from './amount.js';
import { paletteFor } from './theme.js';

const CURRENCIES = [BASE_CURRENCY, 'USD', 'EUR'] as const;

export function AmountSheet({
  title,
  hint,
  initialMinor = 0,
  currency: initialCurrency = BASE_CURRENCY,
  allowCurrencyChange = false,
  confirmLabel = 'Save',
  onCancel,
  onSave,
}: {
  title: string;
  hint?: string;
  initialMinor?: number;
  currency?: string;
  allowCurrencyChange?: boolean;
  confirmLabel?: string;
  onCancel: () => void;
  onSave: (minor: number, currency: string) => void;
}) {
  const palette = paletteFor(useColorScheme());
  const [currency, setCurrency] = useState(initialCurrency);
  const exponent = exponentOf(currency);
  const [draft, setDraft] = useState<Draft>(
    initialMinor > 0 ? draftFromMinor(initialMinor, exponent) : EMPTY_DRAFT,
  );

  const minor = draftToMinor(draft, exponent);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: palette.background }]}>
          <View style={styles.header}>
            <Pressable onPress={onCancel} hitSlop={12}>
              <Text style={[styles.action, { color: palette.dim }]}>Cancel</Text>
            </Pressable>
            <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Pressable onPress={() => onSave(minor, currency)} hitSlop={12}>
              <Text style={[styles.action, { color: palette.accent }]}>{confirmLabel}</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <AmountDisplay draft={draft} currency={currency} palette={palette} />

            {allowCurrencyChange ? (
              <View style={styles.currencyRow}>
                {CURRENCIES.map((code) => (
                  <Pressable
                    key={code}
                    onPress={() => {
                      setDraft((current) => retypeForExponent(current, exponentOf(code)));
                      setCurrency(code);
                    }}
                    style={[
                      styles.currencyChip,
                      { borderColor: palette.border },
                      currency === code
                        ? { backgroundColor: palette.accent, borderColor: 'transparent' }
                        : null,
                    ]}
                  >
                    <Text
                      style={{
                        color: currency === code ? '#fff' : palette.dim,
                        fontWeight: '600',
                        fontSize: 13,
                      }}
                    >
                      {code}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {hint ? (
              <Text style={[styles.hint, { color: palette.dim }]}>{hint}</Text>
            ) : null}

            <AmountPad
              draft={draft}
              exponent={exponent}
              onChange={setDraft}
              palette={palette}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
    gap: 12,
  },
  title: { fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  action: { fontSize: 16, fontWeight: '600' },
  body: { paddingHorizontal: 20, paddingBottom: 32, gap: 10 },
  hint: { fontSize: 12, textAlign: 'center', lineHeight: 17 },
  currencyRow: { flexDirection: 'row', gap: 8, justifyContent: 'center' },
  currencyChip: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
});
