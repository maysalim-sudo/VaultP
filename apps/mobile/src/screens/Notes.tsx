/**
 * Notes and to-dos.
 *
 * One list, not two. A thought and a task are the same object with different
 * fields filled in, and making the user choose which they are before typing is a
 * decision they do not have yet.
 *
 * Adding is a single field at the top: anything that makes you stop and configure
 * before writing loses the thought you were trying to keep.
 */

import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';

import { todayIn, type Note } from '@vaultp/core';

import { DateField, describeDate } from '../components/DateField.js';
import { paletteFor, type Palette } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { useOpenVault } from '../vault/VaultContext.js';

export function Notes({ onClose }: { onClose?: () => void }) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [showDone, setShowDone] = useState(false);

  const open = useMemo(() => vault.notes.listOpen(), [vault, version]);
  const done = useMemo(
    () => (showDone ? vault.notes.listDone() : []),
    [vault, version, showDone],
  );

  function add() {
    if (draft.trim() === '') return;
    mutate((v) => v.notes.addNote({ body: draft }));
    setDraft('');
  }

  return (
    <Screen onClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.headerAction, { color: palette.dim }]}>Close</Text>
            </Pressable>
          ) : (
            // Keeps the title centred in a three-slot header when there is
            // nothing to close: this screen is the page, not a layer over one.
            <View />
          )}
          <Text style={[styles.headerTitle, { color: palette.text }]}>Notes</Text>
          <Pressable onPress={() => setShowDone((current) => !current)} hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.accent }]}>
              {showDone ? 'Hide done' : 'Done'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.addRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write anything"
            placeholderTextColor={palette.dim}
            onSubmitEditing={add}
            returnKeyType="done"
            style={[
              styles.input,
              {
                color: palette.text,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              },
            ]}
          />
          <Pressable
            onPress={add}
            style={[
              styles.addButton,
              { backgroundColor: draft.trim() ? palette.accent : palette.key },
            ]}
          >
            <Text style={{ color: draft.trim() ? '#fff' : palette.dim, fontWeight: '700' }}>
              Add
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {open.length === 0 ? (
            <Text style={[styles.empty, { color: palette.dim }]}>
              Nothing here. A reminder, a thought, something to do — it all goes in
              the same list.
            </Text>
          ) : null}

          {open.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              today={today}
              palette={palette}
              onToggle={() => mutate((v) => v.notes.setDone(note.id, true))}
              onOpen={() => setEditing(note)}
            />
          ))}

          {done.length > 0 ? (
            <Text style={[styles.sectionLabel, { color: palette.dim }]}>Done</Text>
          ) : null}

          {done.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              today={today}
              palette={palette}
              onToggle={() => mutate((v) => v.notes.setDone(note.id, false))}
              onOpen={() => setEditing(note)}
            />
          ))}
        </ScrollView>

        {editing ? (
          <NoteEditor note={editing} onClose={() => setEditing(null)} />
        ) : null}
      </View>
    </Screen>
  );
}

function NoteRow({
  note,
  today,
  palette,
  onToggle,
  onOpen,
}: {
  note: Note;
  today: string;
  palette: Palette;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const overdue = !note.done && note.dueOn !== null && note.dueOn <= today;

  return (
    <View style={[styles.row, { borderBottomColor: palette.divider }]}>
      <Pressable onPress={onToggle} hitSlop={10} style={styles.tickTarget}>
        <View
          style={[
            styles.tick,
            {
              borderColor: note.done ? palette.success : palette.border,
              backgroundColor: note.done ? palette.success : 'transparent',
            },
          ]}
        >
          {note.done ? <Text style={styles.tickMark}>✓</Text> : null}
        </View>
      </Pressable>

      <Pressable onPress={onOpen} style={styles.rowBody}>
        <Text
          style={[
            styles.body,
            { color: note.done ? palette.dim : palette.text },
            note.done ? styles.struck : null,
          ]}
        >
          {note.pinned && !note.done ? '📌  ' : ''}
          {note.body}
        </Text>
        {note.dueOn ? (
          <Text
            style={[
              styles.meta,
              { color: overdue ? palette.danger : palette.dim },
            ]}
          >
            {describeDate(note.dueOn)}
            {note.notify ? '  ·  will notify' : ''}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

function NoteEditor({ note, onClose }: { note: Note; onClose: () => void }) {
  const { mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());

  const [body, setBody] = useState(note.body);
  const [dueOn, setDueOn] = useState(note.dueOn ?? '');
  const [notify, setNotify] = useState(note.notify);
  const [pinned, setPinned] = useState(note.pinned);

  function save() {
    if (body.trim() === '') return;
    mutate((v) =>
      v.notes.updateNote(note.id, {
        body,
        dueOn: dueOn.trim() === '' ? null : dueOn.trim(),
        notify,
        pinned,
      }),
    );
    onClose();
  }

  return (
    <Screen onClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.dim }]}>Back</Text>
          </Pressable>
          <Pressable onPress={save} hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.accent }]}>Save</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            autoFocus
            style={[
              styles.input,
              styles.multiline,
              {
                color: palette.text,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              },
            ]}
          />

          <Text style={[styles.label, { color: palette.dim }]}>Due</Text>
          <DateField
            value={dueOn}
            onChange={(next) => {
              setDueOn(next);
              // Clearing the date makes the notification meaningless; the core
              // enforces this too, but the switch should not sit on screen
              // claiming otherwise.
              if (next === '') setNotify(false);
            }}
            placeholder="No date"
            palette={palette}
          />

          {dueOn.trim() !== '' ? (
            <Toggle
              label="Notify me on the day"
              detail="Off means it only shows in this list."
              value={notify}
              onChange={setNotify}
              palette={palette}
            />
          ) : null}

          <Toggle
            label="Pin to the top"
            detail="For the one thing you keep forgetting."
            value={pinned}
            onChange={setPinned}
            palette={palette}
          />

          <Pressable
            onPress={() => {
              mutate((v) => v.notes.deleteNote(note.id));
              onClose();
            }}
            style={styles.delete}
          >
            <Text style={{ color: palette.danger, fontWeight: '600' }}>Delete note</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Screen>
  );
}

function Toggle({
  label,
  detail,
  value,
  onChange,
  palette,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (next: boolean) => void;
  palette: Palette;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={[styles.toggle, { borderColor: palette.border, backgroundColor: palette.surface }]}
    >
      <View style={styles.toggleText}>
        <Text style={{ color: palette.text, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: palette.dim, fontSize: 12, marginTop: 2 }}>{detail}</Text>
      </View>
      <View
        style={[styles.switch, { backgroundColor: value ? palette.accent : palette.key }]}
      >
        <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 52 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: { fontWeight: '700', fontSize: 17 },
  headerAction: { fontSize: 16, fontWeight: '600' },

  addRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingBottom: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  addButton: { paddingHorizontal: 20, justifyContent: 'center', borderRadius: 12 },

  list: { paddingHorizontal: 20, paddingBottom: 40 },
  empty: { paddingVertical: 40, textAlign: 'center', lineHeight: 20 },
  sectionLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 4,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tickTarget: { paddingTop: 1 },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickMark: { color: '#fff', fontWeight: '900', fontSize: 13 },
  rowBody: { flex: 1 },
  body: { fontSize: 15, lineHeight: 21 },
  struck: { textDecorationLine: 'line-through' },
  meta: { fontSize: 12, marginTop: 3 },

  editor: { paddingHorizontal: 20, paddingBottom: 40, gap: 12 },
  label: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 6 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  toggleText: { flexShrink: 1 },
  switch: { width: 48, height: 28, borderRadius: 999, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 999, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },
  delete: { alignItems: 'center', paddingVertical: 20 },
});
