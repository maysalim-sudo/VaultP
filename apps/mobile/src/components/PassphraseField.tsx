/**
 * A passphrase field that can be looked at.
 *
 * A long passphrase typed blind on a phone keyboard is how people come to
 * believe they have forgotten it: one slipped key, an error, and doubt. So the
 * field has a Show beside it. Shown or hidden, it is kept away from the
 * keyboard's suggestions and autocorrect, which would otherwise learn it.
 */

import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { fonts, type Palette } from './theme.js';

export function PassphraseField({
  value,
  onChangeText,
  visible,
  onToggle,
  placeholder,
  palette,
  autoFocus,
  onSubmitEditing,
}: {
  value: string;
  onChangeText: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  placeholder: string;
  palette: Palette;
  autoFocus?: boolean;
  onSubmitEditing?: TextInputProps['onSubmitEditing'];
}) {
  return (
    <View style={[styles.field, { borderColor: palette.border, backgroundColor: palette.surface }]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.dim}
        secureTextEntry={!visible}
        // `visible-password` is Android's own "show it, but do not learn it" mode.
        keyboardType={visible ? 'visible-password' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        autoFocus={autoFocus}
        onSubmitEditing={onSubmitEditing}
        style={[styles.input, { color: palette.text }]}
      />
      <Pressable
        onPress={onToggle}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={visible ? 'Hide the passphrase' : 'Show the passphrase'}
        style={({ pressed }) => [styles.toggle, pressed ? styles.pressed : null]}
      >
        <Text style={[styles.toggleText, { color: palette.accentText }]}>{visible ? 'Hide' : 'Show'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 12 },
  input: { flex: 1, paddingHorizontal: 14, paddingVertical: 14, fontFamily: fonts.ui, fontSize: 16 },
  toggle: { paddingHorizontal: 14, paddingVertical: 14 },
  toggleText: { fontFamily: fonts.uiBold, fontSize: 14, },
  pressed: { transform: [{ scale: 0.97 }] },
});
