/**
 * Picking an expense's category — and making one when none fits.
 *
 * The last chip is "Other". Tapping it opens a small card over the screen to
 * type a name (and, if you like, pick an icon); the new category is saved with
 * the others and chosen at once, so logging the expense carries straight on.
 * Typing a name that already exists picks that one rather than making a twin.
 *
 * Shared by the quick entry screen and the expense editor, so a category made
 * from either is the same thing, in the same place.
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

import { categoryColourFor, radii, spacing, typeScale, type Category } from '@vaultp/core';

import { useOpenVault } from '../vault/VaultContext.js';
import type { Palette } from './theme.js';

/** A few starting points; any emoji can be typed instead. */
const ICONS = ['🛒', '🍽', '🚕', '🏠', '💊', '🎓', '🎁', '🐾', '✈️', '🔧', '👕', '📱'] as const;

export function CategoryChips({
  categories,
  selectedId,
  onSelect,
  palette,
}: {
  categories: readonly Category[];
  selectedId: string | null;
  onSelect: (categoryId: string | null) => void;
  palette: Palette;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.row}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="handled"
      >
        {categories.map((category) => {
          const selected = category.id === selectedId;
          return (
            <Pressable
              key={category.id}
              onPress={() => onSelect(selected ? null : category.id)}
              style={({ pressed }) => [
                styles.chip,
                { borderColor: palette.border, backgroundColor: palette.surface },
                selected
                  ? {
                      // The category's own colour, deep enough to carry white text.
                      backgroundColor: categoryColourFor(category.id, category.color),
                      borderColor: 'transparent',
                    }
                  : null,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={[styles.chipText, { color: selected ? '#fff' : palette.text }]}>
                {category.icon ? `${category.icon}  ` : ''}
                {category.name}
              </Text>
            </Pressable>
          );
        })}

        <Pressable
          onPress={() => setAdding(true)}
          accessibilityLabel="Other: add a category"
          style={({ pressed }) => [
            styles.chip,
            styles.other,
            { borderColor: palette.dim },
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={[styles.chipText, { color: palette.dim }]}>＋  Other</Text>
        </Pressable>
      </ScrollView>

      {adding ? (
        <NewCategory
          palette={palette}
          onClose={() => setAdding(false)}
          onCreated={(category) => {
            setAdding(false);
            onSelect(category.id);
          }}
        />
      ) : null}
    </>
  );
}

function NewCategory({
  palette,
  onClose,
  onCreated,
}: {
  palette: Palette;
  onClose: () => void;
  onCreated: (category: Category) => void;
}) {
  const { vault, mutate } = useOpenVault();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const existing = vault.expenses
    .listCategories(true)
    .find((category) => trimmed !== '' && category.name.toLowerCase() === trimmed.toLowerCase());

  function save() {
    if (trimmed === '') {
      setError('Give the category a name.');
      return;
    }
    try {
      const category = mutate((v) => v.expenses.ensureCategory({ name: trimmed, ...(icon ? { icon } : {}) }));
      if (category) onCreated(category);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          {/* Swallows taps so pressing inside the card does not close it. */}
          <Pressable style={[styles.card, { backgroundColor: palette.surface }]} onPress={() => undefined}>
            <Text style={[styles.title, { color: palette.text }]}>New category</Text>

            <View style={[styles.inputRow, { backgroundColor: palette.key }]}>
              <Text style={styles.inputIcon}>{icon ?? '🏷'}</Text>
              <TextInput
                value={name}
                onChangeText={(value) => {
                  setName(value);
                  setError(null);
                }}
                autoFocus
                placeholder="Pets, Gifts, Pharmacy…"
                placeholderTextColor={palette.textFaint}
                returnKeyType="done"
                onSubmitEditing={save}
                maxLength={40}
                style={[styles.input, { color: palette.text }]}
              />
            </View>

            {existing ? (
              <Text style={[styles.hint, { color: palette.dim }]}>
                You already have “{existing.name}” — that one will be picked.
              </Text>
            ) : null}
            {error ? <Text style={[styles.hint, { color: palette.danger }]}>{error}</Text> : null}

            <Text style={[styles.label, { color: palette.dim }]}>Icon (optional)</Text>
            <View style={styles.icons}>
              {ICONS.map((glyph) => {
                const selected = glyph === icon;
                return (
                  <Pressable
                    key={glyph}
                    onPress={() => setIcon(selected ? null : glyph)}
                    style={({ pressed }) => [
                      styles.iconButton,
                      { borderColor: selected ? palette.accent : 'transparent', backgroundColor: palette.key },
                      pressed ? styles.pressed : null,
                    ]}
                  >
                    <Text style={styles.iconGlyph}>{glyph}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.actions}>
              <Pressable onPress={onClose} hitSlop={8} style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}>
                <Text style={[styles.actionText, { color: palette.dim }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={save}
                style={({ pressed }) => [
                  styles.action,
                  styles.primary,
                  { backgroundColor: trimmed === '' ? palette.key : palette.accent },
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={[styles.actionText, { color: trimmed === '' ? palette.dim : palette.onAccent }]}>
                  {existing ? 'Use it' : 'Add'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: spacing.sm, paddingVertical: spacing.md, paddingRight: spacing.xl, alignItems: 'center' },
  chip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.pill, borderWidth: 1 },
  other: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  chipText: { fontSize: typeScale.base, fontWeight: '500' },
  pressed: { transform: [{ scale: 0.97 }] },

  flex: { flex: 1 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: { borderRadius: radii.xl, padding: spacing.xl, gap: spacing.md },
  title: { fontSize: typeScale.lg, fontWeight: '700' },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  inputIcon: { fontSize: 20 },
  input: { flex: 1, fontSize: typeScale.md, paddingVertical: 12 },
  hint: { fontSize: typeScale.sm, marginTop: -4 },
  label: { fontSize: typeScale.xs, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: spacing.xs },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
  action: { paddingHorizontal: spacing.lg, paddingVertical: 11, borderRadius: radii.md },
  primary: { minWidth: 88, alignItems: 'center' },
  actionText: { fontSize: typeScale.md, fontWeight: '700' },
});
