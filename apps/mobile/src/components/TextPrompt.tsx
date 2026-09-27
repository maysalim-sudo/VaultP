/**
 * A small card over the screen asking for one line of text — a note on an
 * expense, the name of someone new. Android has no built-in prompt dialog, and
 * a whole screen for one field would be out of proportion.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { radii, spacing, typeScale } from '@vaultp/core';

import type { Palette } from './theme.js';

export function TextPrompt({
  title,
  placeholder,
  initial = '',
  action = 'Save',
  allowEmpty = false,
  palette,
  onCancel,
  onSave,
}: {
  title: string;
  placeholder: string;
  initial?: string;
  action?: string;
  /** Saving an empty value clears it (a note), rather than being refused (a name). */
  allowEmpty?: boolean;
  palette: Palette;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const ready = allowEmpty || value.trim() !== '';

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable style={[styles.card, { backgroundColor: palette.surface }]} onPress={() => undefined}>
            <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
            <TextInput
              value={value}
              onChangeText={setValue}
              autoFocus
              placeholder={placeholder}
              placeholderTextColor={palette.textFaint}
              returnKeyType="done"
              onSubmitEditing={() => ready && onSave(value.trim())}
              maxLength={120}
              style={[styles.input, { color: palette.text, backgroundColor: palette.key }]}
            />
            <View style={styles.actions}>
              <Pressable onPress={onCancel} style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}>
                <Text style={[styles.actionText, { color: palette.dim }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => ready && onSave(value.trim())}
                style={({ pressed }) => [
                  styles.action,
                  { backgroundColor: ready ? palette.accent : palette.key },
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={[styles.actionText, { color: ready ? palette.onAccent : palette.dim }]}>{action}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'center', padding: spacing.xl },
  card: { borderRadius: radii.xl, padding: spacing.xl, gap: spacing.md },
  title: { fontSize: typeScale.lg, fontWeight: '700' },
  input: { fontSize: typeScale.md, paddingVertical: 12, paddingHorizontal: spacing.md, borderRadius: radii.md },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
  action: { paddingHorizontal: spacing.lg, paddingVertical: 11, borderRadius: radii.md, minWidth: 80, alignItems: 'center' },
  actionText: { fontSize: typeScale.md, fontWeight: '700' },
  pressed: { transform: [{ scale: 0.97 }] },
});
