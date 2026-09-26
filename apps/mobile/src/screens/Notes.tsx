/**
 * Notes, in the manner of Google Keep.
 *
 * A two-column grid of cards rather than a list, because a note is something you
 * glance at, not something you read down a column. Cards keep their own height —
 * a one-line reminder and a paragraph sit side by side without either being
 * padded or cut to match — and the columns are balanced by height, not by count,
 * so neither side runs long.
 *
 * Adding is still a single field at the top: anything that makes you stop and
 * configure before writing loses the thought you were trying to keep. Colour,
 * pin and date come afterwards, in the note itself.
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

import {
  NOTE_COLOURS,
  noteShades,
  radii,
  spacing,
  todayIn,
  typeScale,
  type Note,
  type NoteColour,
} from '@vaultp/core';

import { DateField, describeDate } from '../components/DateField.js';
import { paletteFor, type Palette } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { useOpenVault } from '../vault/VaultContext.js';

type Scheme = 'light' | 'dark';

/** The card fill for a note: its chosen shade, or the plain surface. */
function cardColours(note: Note, scheme: Scheme, palette: Palette) {
  if (note.colour) {
    const shade = noteShades[scheme][note.colour] ?? palette.surface;
    return { backgroundColor: shade, borderColor: shade };
  }
  return { backgroundColor: palette.surface, borderColor: palette.border };
}

/** A translucent wash that reads on any card colour, for chips and controls. */
function wash(scheme: Scheme): string {
  return scheme === 'dark' ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)';
}

/**
 * Split notes into two columns of roughly equal height.
 *
 * Each note goes to whichever column is currently shorter, using its text length
 * as a stand-in for its rendered height. Exact measurement would mean laying
 * everything out twice; this is close enough that neither column visibly runs
 * long, and it keeps the reading order top-to-bottom within a column.
 */
function balance(notes: readonly Note[]): [Note[], Note[]] {
  const columns: [Note[], Note[]] = [[], []];
  const heights = [0, 0];

  for (const note of notes) {
    const lines = Math.min(10, Math.ceil(Math.max(note.body.length, 1) / 22));
    const estimate = 44 + lines * 21 + (note.dueOn ? 30 : 0);
    const target = heights[0]! <= heights[1]! ? 0 : 1;
    columns[target].push(note);
    heights[target] += estimate;
  }

  return columns;
}

export function Notes({ onClose }: { onClose?: () => void }) {
  const { vault, version, mutate } = useOpenVault();
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = paletteFor(scheme);
  const today = todayIn();

  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [showDone, setShowDone] = useState(false);

  const open = useMemo(() => vault.notes.listOpen(), [vault, version]);
  const done = useMemo(
    () => (showDone ? vault.notes.listDone() : []),
    [vault, version, showDone],
  );

  const pinned = open.filter((note) => note.pinned);
  const others = open.filter((note) => !note.pinned);

  function add() {
    if (draft.trim() === '') return;
    mutate((v) => v.notes.addNote({ body: draft }));
    setDraft('');
  }

  function grid(notes: readonly Note[]) {
    const [left, right] = balance(notes);
    return (
      <View style={styles.grid}>
        {[left, right].map((column, index) => (
          <View key={index} style={styles.column}>
            {column.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                today={today}
                scheme={scheme}
                palette={palette}
                onOpen={() => setEditing(note)}
                onToggle={() => mutate((v) => v.notes.setDone(note.id, !note.done))}
              />
            ))}
          </View>
        ))}
      </View>
    );
  }

  return (
    <Screen onClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        {/* The pill header Keep is recognised by. */}
        <View
          style={[
            styles.bar,
            {
              backgroundColor: palette.surface,
              borderColor: palette.border,
              elevation: palette.elevationCard,
            },
          ]}
        >
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.barAction, { color: palette.dim }]}>Close</Text>
            </Pressable>
          ) : null}
          <Text style={[styles.barTitle, { color: palette.dim }]}>Your notes</Text>
          <Pressable
            onPress={() => setShowDone((current) => !current)}
            hitSlop={8}
            style={({ pressed }) => [
              styles.barChip,
              { backgroundColor: showDone ? palette.accent : wash(scheme) },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text
              style={[styles.barChipText, { color: showDone ? palette.onAccent : palette.text }]}
            >
              {showDone ? 'Hide done' : 'Show done'}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* "Take a note…" — one field, nothing to choose first. */}
          <View
            style={[
              styles.take,
              {
                backgroundColor: palette.surface,
                borderColor: palette.border,
                elevation: palette.elevationCard,
              },
            ]}
          >
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Take a note…"
              placeholderTextColor={palette.textFaint}
              onSubmitEditing={add}
              returnKeyType="done"
              style={[styles.takeInput, { color: palette.text }]}
            />
            {draft.trim() !== '' ? (
              <Pressable
                onPress={add}
                style={({ pressed }) => [
                  styles.takeButton,
                  { backgroundColor: palette.accent },
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={[styles.takeButtonText, { color: palette.onAccent }]}>Add</Text>
              </Pressable>
            ) : null}
          </View>

          {open.length === 0 && done.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>💡</Text>
              <Text style={[styles.emptyText, { color: palette.dim }]}>
                Notes you add appear here
              </Text>
            </View>
          ) : null}

          {pinned.length > 0 ? (
            <>
              <Text style={[styles.section, { color: palette.dim }]}>PINNED</Text>
              {grid(pinned)}
            </>
          ) : null}

          {others.length > 0 ? (
            <>
              {/* Keep only labels the rest once there is a pinned group to tell
                  them apart from. */}
              {pinned.length > 0 ? (
                <Text style={[styles.section, { color: palette.dim }]}>OTHERS</Text>
              ) : null}
              {grid(others)}
            </>
          ) : null}

          {done.length > 0 ? (
            <>
              <Text style={[styles.section, { color: palette.dim }]}>DONE</Text>
              {grid(done)}
            </>
          ) : null}
        </ScrollView>

        {editing ? (
          <NoteEditor note={editing} scheme={scheme} onClose={() => setEditing(null)} />
        ) : null}
      </View>
    </Screen>
  );
}

function NoteCard({
  note,
  today,
  scheme,
  palette,
  onOpen,
  onToggle,
}: {
  note: Note;
  today: string;
  scheme: Scheme;
  palette: Palette;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const overdue = !note.done && note.dueOn !== null && note.dueOn <= today;

  return (
    <Pressable
      onPress={onOpen}
      style={({ pressed }) => [
        styles.card,
        cardColours(note, scheme, palette),
        note.done ? styles.cardDone : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text
        numberOfLines={10}
        style={[styles.cardBody, { color: palette.text }, note.done ? styles.struck : null]}
      >
        {note.body}
      </Text>

      <View style={styles.cardFoot}>
        {note.dueOn ? (
          <View style={[styles.chip, { backgroundColor: wash(scheme) }]}>
            <Text
              style={[styles.chipText, { color: overdue ? palette.danger : palette.text }]}
              numberOfLines={1}
            >
              {note.notify ? '🔔 ' : '🕒 '}
              {describeDate(note.dueOn)}
            </Text>
          </View>
        ) : (
          <View />
        )}

        {/* Ticking a note off is common enough to deserve a target on the card,
            rather than a trip into the note to find it. */}
        <Pressable
          onPress={onToggle}
          hitSlop={10}
          style={[
            styles.tick,
            {
              borderColor: note.done ? palette.success : palette.dim,
              backgroundColor: note.done ? palette.success : 'transparent',
            },
          ]}
        >
          {note.done ? <Text style={[styles.tickMark, { color: palette.onAccent }]}>✓</Text> : null}
        </Pressable>
      </View>
    </Pressable>
  );
}

function NoteEditor({
  note,
  scheme,
  onClose,
}: {
  note: Note;
  scheme: Scheme;
  onClose: () => void;
}) {
  const { mutate } = useOpenVault();
  const palette = paletteFor(scheme);

  const [body, setBody] = useState(note.body);
  const [dueOn, setDueOn] = useState(note.dueOn ?? '');
  const [notify, setNotify] = useState(note.notify);
  const [pinned, setPinned] = useState(note.pinned);
  const [colour, setColour] = useState<NoteColour | null>(note.colour);
  const [done, setDone] = useState(note.done);

  // The whole screen takes the note's colour, as Keep's editor does, so the note
  // being edited looks like the card that was tapped.
  const ground = colour ? (noteShades[scheme][colour] ?? palette.background) : palette.background;

  function save() {
    if (body.trim() === '') return;
    mutate((v) => {
      v.notes.updateNote(note.id, {
        body,
        dueOn: dueOn.trim() === '' ? null : dueOn.trim(),
        notify,
        pinned,
        colour,
      });
      if (done !== note.done) v.notes.setDone(note.id, done);
    });
    onClose();
  }

  return (
    <Screen onClose={onClose}>
      <View style={[styles.screen, { backgroundColor: ground }]}>
        <View style={styles.editorHead}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.barAction, { color: palette.dim }]}>Back</Text>
          </Pressable>
          <View style={styles.editorHeadRight}>
            <Pressable
              onPress={() => setPinned((current) => !current)}
              hitSlop={10}
              style={({ pressed }) => [
                styles.iconButton,
                { backgroundColor: pinned ? wash(scheme) : 'transparent' },
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={[styles.iconGlyph, { opacity: pinned ? 1 : 0.45 }]}>📌</Text>
            </Pressable>
            <Pressable onPress={save} hitSlop={12}>
              <Text style={[styles.barAction, { color: palette.accent }]}>Save</Text>
            </Pressable>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.editor} keyboardShouldPersistTaps="handled">
          {/* No box around the text: in Keep the note *is* the page. */}
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            autoFocus
            placeholder="Note"
            placeholderTextColor={palette.textFaint}
            style={[styles.editorBody, { color: palette.text }]}
          />

          <Text style={[styles.label, { color: palette.dim }]}>Colour</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.swatches}>
              <Swatch
                fill={palette.surface}
                selected={colour === null}
                ringColour={palette.accent}
                borderColour={palette.border}
                onPress={() => setColour(null)}
                mark="⊘"
                markColour={palette.dim}
              />
              {NOTE_COLOURS.map((name) => (
                <Swatch
                  key={name}
                  fill={noteShades[scheme][name] ?? palette.surface}
                  selected={colour === name}
                  ringColour={palette.accent}
                  borderColour="transparent"
                  onPress={() => setColour(name)}
                  mark={colour === name ? '✓' : ''}
                  markColour={palette.text}
                />
              ))}
            </View>
          </ScrollView>

          <Text style={[styles.label, { color: palette.dim }]}>Reminder</Text>
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
              detail="Off means it only shows on the card."
              value={notify}
              onChange={setNotify}
              palette={palette}
              fill={wash(scheme)}
            />
          ) : null}

          <Toggle
            label="Done"
            detail="Hidden from the grid until you show done notes."
            value={done}
            onChange={setDone}
            palette={palette}
            fill={wash(scheme)}
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

function Swatch({
  fill,
  selected,
  ringColour,
  borderColour,
  onPress,
  mark,
  markColour,
}: {
  fill: string;
  selected: boolean;
  ringColour: string;
  borderColour: string;
  onPress: () => void;
  mark: string;
  markColour: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.swatch,
        {
          backgroundColor: fill,
          borderColor: selected ? ringColour : borderColour,
          borderWidth: selected ? 2 : 1,
        },
        pressed ? styles.pressed : null,
      ]}
    >
      {mark ? <Text style={[styles.swatchMark, { color: markColour }]}>{mark}</Text> : null}
    </Pressable>
  );
}

function Toggle({
  label,
  detail,
  value,
  onChange,
  palette,
  fill,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (next: boolean) => void;
  palette: Palette;
  fill: string;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      style={({ pressed }) => [
        styles.toggle,
        { backgroundColor: fill },
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.toggleText}>
        <Text style={{ color: palette.text, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: palette.dim, fontSize: typeScale.xs, marginTop: 2 }}>{detail}</Text>
      </View>
      <View style={[styles.switch, { backgroundColor: value ? palette.accent : palette.key }]}>
        <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 48 },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    paddingLeft: spacing.xl,
    paddingRight: spacing.sm,
    height: 52,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  barTitle: { flex: 1, fontSize: typeScale.md },
  barAction: { fontSize: typeScale.md, fontWeight: '600' },
  barChip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill },
  barChipText: { fontSize: typeScale.sm, fontWeight: '600' },

  body: { paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: 48 },

  take: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.xs,
    marginBottom: spacing.lg,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    minHeight: 50,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  takeInput: { flex: 1, fontSize: typeScale.md, paddingVertical: spacing.md },
  takeButton: { paddingHorizontal: spacing.lg, paddingVertical: 8, borderRadius: radii.pill },
  takeButtonText: { fontWeight: '700', fontSize: typeScale.sm },

  empty: { alignItems: 'center', paddingTop: 90, gap: spacing.md },
  emptyIcon: { fontSize: 72, opacity: 0.35 },
  emptyText: { fontSize: typeScale.md },

  section: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    marginLeft: spacing.sm,
  },

  grid: { flexDirection: 'row', gap: spacing.sm },
  column: { flex: 1, gap: spacing.sm },

  card: {
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardDone: { opacity: 0.62 },
  cardBody: { fontSize: typeScale.base, lineHeight: 21 },
  struck: { textDecorationLine: 'line-through' },
  cardFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  chip: {
    flexShrink: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  chipText: { fontSize: typeScale.xs, fontWeight: '500' },
  tick: {
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickMark: { fontWeight: '900', fontSize: 11 },

  // Press feedback: the card answers the finger before anything else happens.
  pressed: { transform: [{ scale: 0.97 }] },

  editorHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  editorHeadRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconGlyph: { fontSize: 18 },

  editor: { paddingHorizontal: spacing.xl, paddingBottom: 48, gap: spacing.md },
  editorBody: {
    fontSize: typeScale.lg,
    lineHeight: 28,
    minHeight: 160,
    textAlignVertical: 'top',
    paddingVertical: spacing.sm,
  },
  label: {
    fontSize: typeScale.xs,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.sm,
  },
  swatches: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  swatch: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchMark: { fontSize: 15, fontWeight: '800' },

  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  toggleText: { flexShrink: 1 },
  switch: { width: 48, height: 28, borderRadius: radii.pill, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: radii.pill, backgroundColor: '#fff' },
  knobOn: { alignSelf: 'flex-end' },
  knobOff: { alignSelf: 'flex-start' },
  delete: { alignItems: 'center', paddingVertical: spacing.xl },
});
