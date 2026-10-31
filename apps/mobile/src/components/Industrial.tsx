/**
 * The pieces every page is built from: the same grammar as the desktop.
 *
 * A tile on the ground, a small spaced mono label, one figure in dot-matrix,
 * pills for choices, rows with a hairline between. Colour means something: green
 * is money coming back, blue-grey with ≈ is an estimate, orange is what wants
 * you. Everything else stays neutral.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon, type IconName } from './icons.js';
import { fonts, labelStyle, type Palette } from './theme.js';

export function Tile({
  palette,
  style,
  onPress,
  onLongPress,
  label,
  children,
}: {
  palette: Palette;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Read out for a pressable tile. */
  label?: string;
  children: ReactNode;
}) {
  if (!onPress) return <View style={[styles.tile, { backgroundColor: palette.surface }, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.tile,
        { backgroundColor: palette.surface },
        style,
        pressed ? styles.pressed : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

export function Label({
  palette,
  colour,
  children,
}: {
  palette: Palette;
  colour?: string;
  children: ReactNode;
}) {
  return <Text style={[labelStyle, { color: colour ?? palette.textFaint }]}>{children}</Text>;
}

/** The figure a tile exists to show. Shrinks rather than wraps: a long balance stays one line. */
export function Figure({
  value,
  unit,
  size = 48,
  colour,
  palette,
}: {
  value: string;
  unit?: string;
  size?: number;
  colour?: string;
  palette: Palette;
}) {
  return (
    <View style={styles.figure}>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.5}
        style={[styles.figureText, { fontSize: size, lineHeight: size, color: colour ?? palette.text }]}
      >
        {value}
      </Text>
      {unit ? <Text style={[styles.unit, { color: palette.dim }]}>{unit}</Text> : null}
    </View>
  );
}

/** A meter of separate cells, not a smooth bar: it reads as a count at a glance. */
export function Cells({
  ratio,
  count = 10,
  height = 10,
  colour,
  palette,
}: {
  ratio: number;
  count?: number;
  height?: number;
  colour: string;
  palette: Palette;
}) {
  const on = Math.round(Math.max(0, Math.min(1, ratio)) * count);
  return (
    <View style={styles.cells} accessibilityLabel={`${Math.round(ratio * 100)} percent`}>
      {Array.from({ length: count }, (_, index) => (
        <View
          key={index}
          style={[styles.cell, { height, backgroundColor: index < on ? colour : palette.border }]}
        />
      ))}
    </View>
  );
}

export function Pill({
  label,
  selected = false,
  icon,
  palette,
  onPress,
  onLongPress,
}: {
  label: string;
  selected?: boolean;
  icon?: IconName;
  palette: Palette;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const fg = selected ? palette.background : palette.dim;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.pill,
        { borderColor: selected ? palette.text : palette.border, backgroundColor: selected ? palette.text : 'transparent' },
        pressed ? styles.pressed : null,
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={fg} /> : null}
      <Text style={[styles.pillText, { color: fg }]}>{label.toUpperCase()}</Text>
    </Pressable>
  );
}

/** The one action a page leads to. `tone`: solid text colour, or orange for the commit. */
export function Button({
  label,
  icon,
  tone = 'solid',
  disabled = false,
  palette,
  onPress,
}: {
  label: string;
  icon?: IconName;
  tone?: 'solid' | 'accent' | 'outline';
  disabled?: boolean;
  palette: Palette;
  onPress: () => void;
}) {
  const bg = disabled
    ? palette.key
    : tone === 'accent'
      ? palette.accent
      : tone === 'solid'
        ? palette.text
        : 'transparent';
  const fg = disabled
    ? palette.dim
    : tone === 'accent'
      ? palette.onAccent
      : tone === 'solid'
        ? palette.background
        : palette.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg },
        tone === 'outline' ? { borderWidth: 1, borderColor: palette.border } : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      {icon ? <Icon name={icon} size={18} stroke={1.9} color={fg} /> : null}
      <Text numberOfLines={1} style={[styles.buttonText, { color: fg }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A row inside a tile: leading piece, two lines, a figure. Rule above all but the first. */
export function Row({
  palette,
  first = false,
  leading,
  title,
  meta,
  value,
  valueColour,
  unit,
  trailing,
  dimmed = false,
  onPress,
  onLongPress,
}: {
  palette: Palette;
  first?: boolean;
  leading?: ReactNode;
  title: string;
  meta?: string;
  value?: string;
  valueColour?: string;
  unit?: string;
  /** After the figure: a small action of the row's own. */
  trailing?: ReactNode;
  dimmed?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [
        styles.row,
        first ? null : { borderTopWidth: 1, borderTopColor: palette.border },
        dimmed ? styles.dimmed : null,
        pressed ? { backgroundColor: palette.key } : null,
      ]}
    >
      {leading}
      <View style={styles.rowMain}>
        <Text numberOfLines={1} style={[styles.rowTitle, { color: palette.text }]}>
          {title}
        </Text>
        {meta ? (
          <Text numberOfLines={1} style={[styles.rowMeta, { color: palette.dim }]}>
            {meta}
          </Text>
        ) : null}
      </View>
      {value ? (
        <View style={styles.rowRight}>
          <Text numberOfLines={1} style={[styles.rowValue, { color: valueColour ?? palette.text }]}>
            {value}
          </Text>
          {unit ? <Text style={[labelStyle, styles.rowUnit, { color: palette.textFaint }]}>{unit}</Text> : null}
        </View>
      ) : null}
      {trailing}
    </Pressable>
  );
}

/** A round icon on the lifted tile colour. */
export function Disc({ icon, size = 40, palette }: { icon: IconName; size?: number; palette: Palette }) {
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.key }]}>
      <Icon name={icon} size={size * 0.45} color={palette.dim} />
    </View>
  );
}

/** Someone's initials on a disc: people are the one thing that keep letters. */
export function Initials({ name, size = 44, palette }: { name: string; size?: number; palette: Palette }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((word) => word.charAt(0)).join('') || '?';
  const shown = letters.length === 1 ? name.trim().slice(0, 2) : letters;
  return (
    <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: palette.key }]}>
      <Text style={[styles.initials, { color: palette.text }]}>{shown.toUpperCase()}</Text>
    </View>
  );
}

/** Nothing here yet: one quiet line in the label grammar. */
export function Empty({ palette, children }: { palette: Palette; children: ReactNode }) {
  return (
    <Tile palette={palette} style={styles.empty}>
      <Text style={[styles.emptyText, { color: palette.textFaint }]}>{children}</Text>
    </Tile>
  );
}

export function PageHead({
  title,
  action,
  onAction,
  palette,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  palette: Palette;
}) {
  return (
    <View style={styles.head}>
      <Text style={[styles.headTitle, { color: palette.text }]}>{title}</Text>
      {action && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => [styles.headAction, { borderColor: palette.border }, pressed ? styles.pressed : null]}
        >
          <Icon name="plus" size={14} stroke={2} color={palette.text} />
          <Text style={[styles.headActionText, { color: palette.text }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 22, padding: 18, gap: 12 },
  pressed: { transform: [{ scale: 0.98 }] },

  figure: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  figureText: { fontFamily: fonts.display, flexShrink: 1 },
  unit: { fontFamily: fonts.monoMedium, fontSize: 12, paddingBottom: 2 },

  cells: { flexDirection: 'row', gap: 2, flex: 1 },
  cell: { flex: 1, borderRadius: 2 },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  pillText: { fontFamily: fonts.monoMedium, fontSize: 10, letterSpacing: 1 },

  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    height: 54,
    paddingHorizontal: 24,
    borderRadius: 999,
  },
  buttonText: { fontFamily: fonts.uiSemibold, fontSize: 15, flexShrink: 1 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 62, paddingVertical: 10, paddingHorizontal: 18 },
  dimmed: { opacity: 0.55 },
  rowMain: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontFamily: fonts.uiSemibold, fontSize: 15, letterSpacing: -0.15 },
  rowMeta: { fontFamily: fonts.ui, fontSize: 12 },
  rowRight: { alignItems: 'flex-end', gap: 3, flexShrink: 0, maxWidth: '50%' },
  rowValue: { fontFamily: fonts.monoMedium, fontSize: 14 },
  rowUnit: { fontSize: 9, letterSpacing: 1.3 },

  disc: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  initials: { fontFamily: fonts.monoBold, fontSize: 12, letterSpacing: 0.7 },

  empty: { alignItems: 'center', paddingVertical: 40, paddingHorizontal: 20 },
  emptyText: { fontFamily: fonts.mono, fontSize: 11, lineHeight: 18, letterSpacing: 0.8, textAlign: 'center' },

  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingVertical: 8, paddingHorizontal: 4 },
  headTitle: { fontFamily: fonts.uiSemibold, fontSize: 26, letterSpacing: -0.6 },
  headAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  headActionText: { fontFamily: fonts.uiSemibold, fontSize: 13 },
});
