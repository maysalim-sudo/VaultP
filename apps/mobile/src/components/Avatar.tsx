/**
 * A person, as a coloured circle with their initials.
 *
 * The colour comes from the person's id through the same palette categories
 * use, so Sami is the same colour on every screen and on both devices, and no
 * one has to pick it.
 */

import { StyleSheet, Text, View } from 'react-native';

import { categoryColourFor } from '@vaultp/core';

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[words.length - 1]![0]!).toUpperCase();
}

export function Avatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: categoryColourFor(id) },
      ]}
    >
      <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initialsOf(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#fff', fontWeight: '700' },
});
