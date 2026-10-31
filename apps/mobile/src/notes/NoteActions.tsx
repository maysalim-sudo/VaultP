/**
 * What a short hold on a note offers, without opening it: pin, colour, folder,
 * archive, done, copy, delete. The things you do *to* a note rather than in it.
 */

import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import {
  NOTE_COLOURS,
  noteHeadline,
  noteShades,
  spacing,
  type Note,
  type NoteFolder,
} from '@vaultp/core';

import { fonts, type Palette } from '../components/theme.js';
import type { OpenVault } from '../vault/open.js';
import { FolderPicker } from './FolderPicker.js';
import { removeReleased } from './images.js';
import { Sheet, SheetRow, Swatch } from './sheet.js';

type Mutate = <T>(fn: (vault: OpenVault) => T) => T | undefined;

export function NoteActions({
  note,
  folders,
  palette,
  scheme,
  mutate,
  onClose,
  onNotice,
}: {
  note: Note;
  folders: readonly NoteFolder[];
  palette: Palette;
  scheme: 'light' | 'dark';
  mutate: Mutate;
  onClose: () => void;
  /** A short confirmation, shown after the drawer closes. */
  onNotice: (message: string) => void;
}) {
  const [picking, setPicking] = useState(false);

  function act(fn: (v: OpenVault) => unknown, notice?: string) {
    mutate(fn);
    onClose();
    if (notice) onNotice(notice);
  }

  const title = noteHeadline(note, 40) || 'Note';

  if (picking) {
    return (
      <Sheet palette={palette} onClose={onClose} title={`Move “${title}” to`}>
        <FolderPicker
          folders={folders}
          current={note.folderId}
          palette={palette}
          onPick={(folderId) =>
            act(
              (v) => v.notes.moveToFolder(note.id, folderId),
              folderId ? `Moved to ${folders.find((f) => f.id === folderId)?.name ?? 'folder'}` : 'Removed from its folder',
            )
          }
          onCreate={(name) =>
            act((v) => {
              const folder = v.notes.addFolder(name);
              v.notes.moveToFolder(note.id, folder.id);
            }, `Moved to ${name.trim()}`)
          }
        />
      </Sheet>
    );
  }

  return (
    <Sheet palette={palette} onClose={onClose} title={title}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.swatches}>
          <Swatch
            fill={palette.background}
            selected={note.colour === null}
            ring={palette.accent}
            border={palette.border}
            mark="⊘"
            markColour={palette.dim}
            onPress={() => act((v) => v.notes.updateNote(note.id, { colour: null }))}
          />
          {NOTE_COLOURS.map((name) => (
            <Swatch
              key={name}
              fill={noteShades[scheme][name] ?? palette.surface}
              selected={note.colour === name}
              ring={palette.accent}
              border="transparent"
              mark={note.colour === name ? '✓' : ''}
              markColour={palette.text}
              onPress={() => act((v) => v.notes.updateNote(note.id, { colour: name }))}
            />
          ))}
        </View>
      </ScrollView>

      {!note.archived ? (
        <SheetRow
          glyph="📌"
          label={note.pinned ? 'Unpin' : 'Pin to the top'}
          palette={palette}
          onPress={() => act((v) => v.notes.updateNote(note.id, { pinned: !note.pinned }))}
        />
      ) : null}
      <SheetRow
        glyph="📁"
        label="Move to folder"
        trailing={folders.find((f) => f.id === note.folderId)?.name ?? ''}
        palette={palette}
        onPress={() => setPicking(true)}
      />
      <SheetRow
        glyph="🗄"
        label={note.archived ? 'Unarchive' : 'Archive'}
        palette={palette}
        onPress={() =>
          act((v) => v.notes.updateNote(note.id, { archived: !note.archived }), note.archived ? 'Unarchived' : 'Archived')
        }
      />
      <SheetRow
        glyph="✓"
        label={note.done ? 'Mark as not done' : 'Mark as done'}
        palette={palette}
        onPress={() => act((v) => v.notes.setDone(note.id, !note.done), note.done ? undefined : 'Marked done')}
      />
      <SheetRow
        glyph="⧉"
        label="Make a copy"
        palette={palette}
        onPress={() => act((v) => v.notes.duplicateNote(note.id), 'Copied')}
      />
      <SheetRow
        glyph="🗑"
        label="Delete"
        palette={palette}
        danger
        onPress={() => {
          onClose();
          Alert.alert('Delete this note?', 'Its images are deleted with it.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => {
                mutate((v) => removeReleased(v.notes.deleteNote(note.id)));
                onNotice('Deleted');
              },
            },
          ]);
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
});
