/**
 * The keypad, shared by entry and correction.
 *
 * A custom pad rather than the system keyboard: the system one animates in,
 * shifts everything above it, and puts the digits in a different place on every
 * Android skin. This one never moves. It works like a card terminal: digits fill
 * from the right, so the decimals are always there (see `amount.ts`).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { exponentOf } from '@vaultp/core';

import { type Draft, draftDisplay, pressBackspace, pressDigit } from './amount.js';
import { Icon } from './icons.js';
import { fonts, type Palette } from './theme.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'] as const;

export function AmountDisplay({
  draft,
  currency,
  palette,
}: {
  draft: Draft;
  currency: string;
  palette: Palette;
}) {
  return (
    <View style={styles.amountRow}>
      <Text style={[styles.amount, { color: palette.text }]} numberOfLines={1} adjustsFontSizeToFit>
        {draftDisplay(draft, exponentOf(currency))}
      </Text>
      <Text style={[styles.currency, { color: palette.dim }]}>{currency}</Text>
    </View>
  );
}

export function AmountPad({
  draft,
  exponent,
  onChange,
  palette,
}: {
  draft: Draft;
  exponent: number;
  onChange: (next: Draft) => void;
  palette: Palette;
}) {
  return (
    <View style={styles.keypad}>
      {KEYS.map((key) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={key === 'back' ? 'Delete a digit' : `Digit ${key}`}
          style={({ pressed }) => [
            styles.key,
            { backgroundColor: palette.surface },
            pressed ? styles.pressed : null,
          ]}
          onPress={() =>
            onChange(key === 'back' ? pressBackspace(draft, exponent) : pressDigit(draft, key, exponent))
          }
        >
          {key === 'back' ? (
            <Icon name="back" size={20} color={palette.text} />
          ) : (
            <Text style={[styles.keyText, { color: palette.text }]}>{key}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-end', gap: 8, minHeight: 60 },
  amount: { fontFamily: fonts.display, fontSize: 56, flexShrink: 1 },
  currency: { fontFamily: fonts.monoMedium, fontSize: 12, marginBottom: 8 },

  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  key: { width: '32.4%', height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  pressed: { transform: [{ scale: 0.97 }] },
  keyText: { fontFamily: fonts.display, fontSize: 26 },
});
