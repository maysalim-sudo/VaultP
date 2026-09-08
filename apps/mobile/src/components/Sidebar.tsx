/**
 * The navigation drawer.
 *
 * Replaces a row of tabs across the top, which was never going to hold: seven
 * destinations do not fit on a phone, and the last two were already scrolling off
 * the edge on a narrow screen.
 *
 * Collapsed it is a strip of icons, so the destinations stay visible and reachable
 * with one thumb; expanded it names them. It slides rather than covering the
 * screen, because on a phone held in one hand a drawer that swallows the content
 * costs a second tap to get back.
 */

import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import type { Palette } from './theme.js';

export type ViewName =
  | 'home'
  | 'add'
  | 'recurring'
  | 'debts'
  | 'documents'
  | 'notes'
  | 'search'
  | 'insights'
  | 'backup';

interface Destination {
  readonly name: ViewName;
  readonly icon: string;
  readonly label: string;
}

export const DESTINATIONS: readonly Destination[] = [
  { name: 'home', icon: '🏠', label: 'Home' },
  { name: 'add', icon: '➕', label: 'Add expense' },
  { name: 'insights', icon: '📊', label: 'Month' },
  { name: 'recurring', icon: '🔁', label: 'Recurring' },
  { name: 'debts', icon: '🤝', label: 'Debts' },
  { name: 'documents', icon: '📄', label: 'Documents' },
  { name: 'notes', icon: '📝', label: 'Notes' },
  { name: 'search', icon: '🔎', label: 'Search' },
  { name: 'backup', icon: '☁️', label: 'Backup & sync' },
];

export const COLLAPSED_WIDTH = 60;
export const EXPANDED_WIDTH = 208;

export function Sidebar({
  active,
  expanded,
  onSelect,
  onToggle,
  palette,
}: {
  active: ViewName;
  expanded: boolean;
  onSelect: (view: ViewName) => void;
  onToggle: () => void;
  palette: Palette;
}) {
  const width = useRef(
    new Animated.Value(expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH),
  ).current;

  useEffect(() => {
    Animated.timing(width, {
      toValue: expanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
      duration: 180,
      // Width cannot be driven natively; the distance is small and the list
      // short, so the cost is not visible.
      useNativeDriver: false,
    }).start();
  }, [expanded, width]);

  return (
    <Animated.View
      style={[
        styles.bar,
        { width, backgroundColor: palette.surface, borderRightColor: palette.divider },
      ]}
    >
      <Pressable
        onPress={onToggle}
        style={styles.toggle}
        hitSlop={8}
        accessibilityLabel={expanded ? 'Collapse menu' : 'Expand menu'}
      >
        <Text style={[styles.icon, { color: palette.dim }]}>{expanded ? '‹' : '›'}</Text>
        {expanded ? (
          <Text style={[styles.label, { color: palette.dim }]}>VaultP</Text>
        ) : null}
      </Pressable>

      <View style={styles.items}>
        {DESTINATIONS.map((destination) => {
          const selected = destination.name === active;
          return (
            <Pressable
              key={destination.name}
              onPress={() => onSelect(destination.name)}
              style={[
                styles.item,
                selected ? { backgroundColor: palette.key } : null,
              ]}
              android_ripple={{ color: palette.ripple }}
              accessibilityLabel={destination.label}
            >
              <Text style={styles.icon}>{destination.icon}</Text>
              {expanded ? (
                <Text
                  numberOfLines={1}
                  style={[
                    styles.label,
                    { color: selected ? palette.text : palette.dim },
                    selected ? styles.selectedLabel : null,
                  ]}
                >
                  {destination.label}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flex: 1,
    paddingTop: 48,
    borderRightWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    paddingHorizontal: 18,
    gap: 14,
  },
  items: { marginTop: 8 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 46,
    paddingHorizontal: 16,
    gap: 14,
    borderRadius: 10,
    marginHorizontal: 4,
    marginBottom: 2,
  },
  // Fixed width so the icons stay in one column as the drawer slides.
  icon: { fontSize: 18, width: 24, textAlign: 'center' },
  label: { fontSize: 14, flexShrink: 1 },
  selectedLabel: { fontWeight: '700' },
});
