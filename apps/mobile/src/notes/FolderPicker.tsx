/**
 * Choosing a note's folder, or making a new one on the spot.
 *
 * Making a folder here, rather than only from the notes screen, matters: you
 * usually realise a note needs a home while you are looking at the note.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { radii, spacing, typeScale, type NoteFolder } from '@vaultp/core';

import { fonts, type Palette } from '../components/theme.js';
import { SheetRow } from './sheet.js';

export function FolderPicker({
  folders,
  current,
  palette,
  onPick,
  onCreate,
}: {
  folders: readonly NoteFolder[];
  current: string | null;
  palette: Palette;
  onPick: (folderId: string | null) => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const exists = folders.some((folder) => folder.name.toLowerCase() === trimmed.toLowerCase());

  function create() {
    if (trimmed === '' || exists) return;
    onCreate(trimmed);
    setName('');
  }

  return (
    <View style={styles.body}>
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        <SheetRow
          glyph="🗒"
          label="No folder"
          trailing={current === null ? '✓' : ''}
          palette={palette}
          onPress={() => onPick(null)}
        />
        {folders.map((folder) => (
          <SheetRow
            key={folder.id}
            glyph="📁"
            label={folder.name}
            trailing={current === folder.id ? '✓' : ''}
            palette={palette}
            onPress={() => onPick(folder.id)}
          />
        ))}
      </ScrollView>

      <View style={[styles.newRow, { backgroundColor: palette.key }]}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="New folder"
          placeholderTextColor={palette.textFaint}
          onSubmitEditing={create}
          style={[styles.input, { color: palette.text }]}
        />
        {trimmed !== '' && !exists ? (
          <Pressable onPress={create} hitSlop={8}>
            <Text style={[styles.create, { color: palette.accentText }]}>Create</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
  list: { maxHeight: 320 },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  input: { flex: 1, fontFamily: fonts.ui, fontSize: typeScale.md, paddingVertical: 10 },
  create: { fontFamily: fonts.uiBold, fontSize: typeScale.md },
});
