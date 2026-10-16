/**
 * A small card with a few labelled lines of text — a person's name, contact
 * and note; a category's name. TextPrompt's bigger sibling: still a card over
 * the screen rather than a whole page, because editing three words should not
 * feel like going somewhere.
 *
 * Extra actions (archive, delete) sit on the left, away from Save, so the
 * destructive one is never where a thumb lands to confirm.
 */

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { radii, spacing, typeScale } from '@vaultp/core';

import type { Palette } from './theme.js';

export interface SheetField {
  readonly key: string;
  readonly label: string;
  readonly initial?: string;
  readonly placeholder?: string;
  /** The form cannot be saved while this one is blank. */
  readonly required?: boolean;
  readonly keyboard?: 'default' | 'decimal-pad' | 'phone-pad';
}

/** A pick-one row of chips — an account's kind. Its value arrives with the fields'. */
export interface SheetChoice {
  readonly key: string;
  readonly label: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly initial: string;
}

export interface SheetAction {
  readonly label: string;
  readonly onPress: () => void;
  readonly destructive?: boolean;
}

export function FieldsSheet({
  title,
  fields,
  choices = [],
  actions = [],
  saveLabel = 'Save',
  footnote,
  palette,
  onCancel,
  onSave,
}: {
  title: string;
  fields: readonly SheetField[];
  choices?: readonly SheetChoice[];
  actions?: readonly SheetAction[];
  saveLabel?: string;
  footnote?: string;
  palette: Palette;
  onCancel: () => void;
  onSave: (values: Record<string, string>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries([
      ...fields.map((field) => [field.key, field.initial ?? '']),
      ...choices.map((choice) => [choice.key, choice.initial]),
    ]),
  );
  const ready = fields.every((field) => !field.required || (values[field.key] ?? '').trim() !== '');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onCancel}>
          <Pressable style={[styles.card, { backgroundColor: palette.surface }]} onPress={() => undefined}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
              <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
              {fields.map((field, index) => (
                <View key={field.key} style={styles.field}>
                  <Text style={[styles.label, { color: palette.dim }]}>{field.label}</Text>
                  <TextInput
                    value={values[field.key] ?? ''}
                    onChangeText={(text) => setValues((current) => ({ ...current, [field.key]: text }))}
                    autoFocus={index === 0}
                    placeholder={field.placeholder}
                    placeholderTextColor={palette.textFaint}
                    keyboardType={field.keyboard ?? 'default'}
                    maxLength={200}
                    style={[styles.input, { color: palette.text, backgroundColor: palette.key }]}
                  />
                </View>
              ))}
              {choices.map((choice) => (
                <View key={choice.key} style={styles.field}>
                  <Text style={[styles.label, { color: palette.dim }]}>{choice.label}</Text>
                  <View style={styles.chips}>
                    {choice.options.map((option) => {
                      const on = values[choice.key] === option.value;
                      return (
                        <Pressable
                          key={option.value}
                          onPress={() => setValues((current) => ({ ...current, [choice.key]: option.value }))}
                          style={[
                            styles.chip,
                            { borderColor: palette.border },
                            on ? { backgroundColor: palette.accent, borderColor: 'transparent' } : null,
                          ]}
                        >
                          <Text style={{ color: on ? palette.onAccent : palette.dim, fontWeight: '600', fontSize: 13 }}>
                            {option.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
              {footnote ? <Text style={[styles.footnote, { color: palette.dim }]}>{footnote}</Text> : null}

              <View style={styles.actions}>
                {actions.map((action) => (
                  <Pressable
                    key={action.label}
                    onPress={action.onPress}
                    hitSlop={6}
                    style={({ pressed }) => [styles.extra, pressed ? styles.pressed : null]}
                  >
                    <Text style={{ color: action.destructive ? palette.danger : palette.accent, fontWeight: '600' }}>
                      {action.label}
                    </Text>
                  </Pressable>
                ))}
                <View style={styles.flex} />
                <Pressable
                  onPress={onCancel}
                  style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
                >
                  <Text style={[styles.actionText, { color: palette.dim }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => ready && onSave(values)}
                  style={({ pressed }) => [
                    styles.action,
                    { backgroundColor: ready ? palette.accent : palette.key },
                    pressed ? styles.pressed : null,
                  ]}
                >
                  <Text style={[styles.actionText, { color: ready ? palette.onAccent : palette.dim }]}>
                    {saveLabel}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)', justifyContent: 'center', padding: spacing.xl },
  card: { borderRadius: radii.xl, maxHeight: '90%' },
  content: { padding: spacing.xl, gap: spacing.md },
  title: { fontSize: typeScale.lg, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontSize: typeScale.xs, fontWeight: '600', letterSpacing: 0.6, textTransform: 'uppercase' },
  input: { fontSize: typeScale.md, paddingVertical: 12, paddingHorizontal: spacing.md, borderRadius: radii.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1 },
  footnote: { fontSize: typeScale.sm, lineHeight: 19 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs, flexWrap: 'wrap' },
  extra: { paddingVertical: 11, paddingRight: spacing.sm },
  action: { paddingHorizontal: spacing.lg, paddingVertical: 11, borderRadius: radii.md, minWidth: 80, alignItems: 'center' },
  actionText: { fontSize: typeScale.md, fontWeight: '700' },
  pressed: { transform: [{ scale: 0.97 }] },
});
