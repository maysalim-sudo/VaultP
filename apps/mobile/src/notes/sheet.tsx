/**
 * The bottom drawer the notes screens share: a dimmed backdrop, a rounded panel
 * rising from the bottom, and rows of actions inside it.
 *
 * Drawn inside the current screen rather than as another Modal, so it can sit
 * over the note editor (itself a Modal) without stacking native windows.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typeScale } from '@vaultp/core';

import type { Palette } from '../components/theme.js';
import { Glyph } from '../components/icons.js';

export function Sheet({
  palette,
  onClose,
  title,
  children,
}: {
  palette: Palette;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Pressable style={styles.backdrop} onPress={onClose}>
      {/* Swallows taps so pressing inside the panel does not close it. */}
      <Pressable style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={() => undefined}>
        <View style={[styles.grabber, { backgroundColor: palette.border }]} />
        {title ? (
          <Text numberOfLines={1} style={[styles.title, { color: palette.dim }]}>
            {title}
          </Text>
        ) : null}
        {children}
      </Pressable>
    </Pressable>
  );
}

export function SheetRow({
  glyph,
  label,
  onPress,
  palette,
  disabled,
  danger,
  trailing,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  palette: Palette;
  disabled?: boolean;
  danger?: boolean;
  trailing?: string;
}) {
  const colour = danger ? palette.danger : palette.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: palette.key } : null]}
    >
      <Glyph glyph={glyph} color={colour} size={20} opacity={disabled ? 0.4 : 1} />
      <Text style={[styles.label, { color: colour, opacity: disabled ? 0.4 : 1 }]}>{label}</Text>
      {trailing ? <Text style={[styles.trailing, { color: palette.accent }]}>{trailing}</Text> : null}
    </Pressable>
  );
}

export function Swatch({
  fill,
  selected,
  ring,
  border,
  mark,
  markColour,
  onPress,
}: {
  fill: string;
  selected: boolean;
  ring: string;
  border: string;
  mark: string;
  markColour: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.swatch,
        { backgroundColor: fill, borderColor: selected ? ring : border, borderWidth: selected ? 2 : 1 },
        pressed ? styles.pressed : null,
      ]}
    >
      {mark ? <Text style={[styles.swatchMark, { color: markColour }]}>{mark}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing.sm,
    paddingBottom: 36,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, marginBottom: spacing.sm },
  title: {
    fontSize: typeScale.sm,
    fontWeight: '600',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  glyph: { width: 26, textAlign: 'center', fontSize: 18, fontWeight: '600' },
  label: { flex: 1, fontSize: typeScale.md },
  trailing: { fontSize: typeScale.md, fontWeight: '700' },
  swatch: { width: 40, height: 40, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  swatchMark: { fontSize: 15, fontWeight: '800' },
  pressed: { transform: [{ scale: 0.97 }] },
});
