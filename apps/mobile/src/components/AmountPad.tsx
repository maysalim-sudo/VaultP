/**
 * The keypad, shared by entry and correction.
 *
 * A custom pad rather than the system keyboard: the system one animates in,
 * shifts everything above it, and puts the digits in a different place on every
 * Android skin. This one never moves.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  type Draft,
  draftDisplay,
  pressBackspace,
  pressDecimal,
  pressDigit,
} from './amount.js';
import { type Palette } from './theme.js';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'] as const;

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
      <Text style={[styles.amount, { color: palette.text }]}>{draftDisplay(draft)}</Text>
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
          style={[styles.key, { backgroundColor: palette.key }]}
          android_ripple={{ color: palette.ripple }}
          onPress={() => {
            if (key === '⌫') onChange(pressBackspace(draft));
            else if (key === ',') onChange(pressDecimal(draft, exponent));
            else onChange(pressDigit(draft, key, exponent));
          }}
        >
          <Text style={[styles.keyText, { color: palette.text }]}>{key}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  amountRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center' },
  amount: { fontSize: 56, fontWeight: '300', letterSpacing: -1 },
  currency: { fontSize: 20, marginBottom: 10, marginLeft: 8 },

  keypad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  key: {
    width: '31.5%',
    aspectRatio: 2.1,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    overflow: 'hidden',
  },
  keyText: { fontSize: 24, fontWeight: '500' },
});
