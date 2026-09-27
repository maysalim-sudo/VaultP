/**
 * Notes, in the manner of Google Keep.
 *
 * A grid of cards (or a single column, if you prefer), each showing what the
 * note actually holds: its first image across the top, its title, its opening
 * lines, the first few checklist items with their ticks, a table's size. A note
 * is something you glance at, so the card has to say what is in it.
 *
 * Starting a note costs one tap. The bar at the top opens a blank note, or one
 * already set up as a checklist or with an image picked — anything that makes you
 * configure first loses the thought you were trying to keep.
 *
 * Filters along the top: your notes, the archive, what is done, and each label.
 * Search looks through titles and everything inside notes — checklist items,
 * table cells, captions — because the plain-text copy the vault keeps covers all
 * of them.
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
  noteShades,
  radii,
  readSetting,
  spacing,
  todayIn,
  typeScale,
  writeSetting,
  type Block,
  type Note,
} from '@vaultp/core';

import { describeDate } from '../components/DateField.js';
import { paletteFor, type Palette } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { NoteImage } from '../notes/images.js';
import { NoteEditor, wash, type EditorStart } from '../notes/NoteEditor.js';
import type { OpenVault } from '../vault/open.js';
import { useOpenVault } from '../vault/VaultContext.js';

type Scheme = 'light' | 'dark';
type Layout = 'grid' | 'list';
type Filter = { kind: 'notes' } | { kind: 'archive' } | { kind: 'done' } | { kind: 'label'; id: string };

const LAYOUT_SETTING = 'notes_layout';

function isLayout(value: unknown): value is Layout {
  return value === 'grid' || value === 'list';
}

function cardColours(note: Note, scheme: Scheme, palette: Palette) {
  if (note.colour) {
    const shade = noteShades[scheme][note.colour] ?? palette.surface;
    return { backgroundColor: shade, borderColor: shade };
  }
  return { backgroundColor: palette.surface, borderColor: palette.border };
}

/**
 * A rough rendered height, for balancing the two columns.
 *
 * Exact measurement would mean laying everything out twice; this is close
 * enough that neither column visibly runs long.
 */
function estimateHeight(note: Note): number {
  let height = 36;
  if (note.title) height += 26;
  const image = note.content.blocks.find((b) => b.type === 'image');
  if (image && image.type === 'image') {
    const ratio = image.width && image.height ? image.height / image.width : 0.75;
    height += Math.min(220, 170 * ratio);
  }
  height += Math.min(10, preview(note.content.blocks).length) * 21;
  if (note.dueOn) height += 30;
  return height;
}

function balance(notes: readonly Note[]): [Note[], Note[]] {
  const columns: [Note[], Note[]] = [[], []];
  const heights = [0, 0];
  for (const note of notes) {
    const target = heights[0]! <= heights[1]! ? 0 : 1;
    columns[target].push(note);
    heights[target] += estimateHeight(note);
  }
  return columns;
}

/** The blocks a card shows: everything but images, which go across the top. */
function preview(blocks: readonly Block[]): Block[] {
  return blocks.filter((b) => b.type !== 'image' && b.type !== 'unknown' && !(b.type === 'text' && b.text.trim() === ''));
}

export function Notes({ onClose }: { onClose?: () => void }) {
  const { vault, version, mutate } = useOpenVault();
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = paletteFor(scheme);
  const today = todayIn();

  const [editor, setEditor] = useState<EditorStart | null>(null);
  const [filter, setFilter] = useState<Filter>({ kind: 'notes' });
  const [query, setQuery] = useState('');

  const layout = useMemo(
    () => readSetting<Layout>(vault.store, LAYOUT_SETTING, 'grid', isLayout),
    [vault, version],
  );
  const labels = useMemo(() => vault.notes.listLabels(), [vault, version]);

  const notes = useMemo(() => {
    let list: Note[];
    switch (filter.kind) {
      case 'archive':
        list = vault.notes.listArchived();
        break;
      case 'done':
        list = vault.notes.listDone(200);
        break;
      case 'label': {
        const ids = vault.notes.notesLabelled(filter.id);
        list = [...vault.notes.listOpen(), ...vault.notes.listDone(200), ...vault.notes.listArchived()].filter(
          (note) => ids.has(note.id),
        );
        break;
      }
      default:
        list = vault.notes.listOpen();
    }
    const term = query.trim().toLowerCase();
    if (term === '') return list;
    // Search the whole vault's notes, not just the current filter: looking for
    // something is not the moment to remember where you put it.
    const everything =
      filter.kind === 'notes'
        ? [...vault.notes.listOpen(), ...vault.notes.listArchived(), ...vault.notes.listDone(200)]
        : list;
    return everything.filter(
      (note) => note.title.toLowerCase().includes(term) || note.body.toLowerCase().includes(term),
    );
  }, [vault, version, filter, query]);

  const pinned = filter.kind === 'notes' && query === '' ? notes.filter((n) => n.pinned) : [];
  const others = filter.kind === 'notes' && query === '' ? notes.filter((n) => !n.pinned) : notes;

  function setLayout(next: Layout) {
    mutate((v) => writeSetting(v.store, LAYOUT_SETTING, next));
  }

  function cards(list: readonly Note[]) {
    const card = (note: Note) => (
      <NoteCard
        key={note.id}
        note={note}
        vault={vault}
        today={today}
        scheme={scheme}
        palette={palette}
        labelNames={vault.notes.labelsFor(note.id).map((label) => label.name)}
        onOpen={() => setEditor({ kind: 'existing', note })}
      />
    );
    if (layout === 'list') return <View style={styles.column}>{list.map(card)}</View>;
    const [left, right] = balance(list);
    return (
      <View style={styles.grid}>
        <View style={styles.column}>{left.map(card)}</View>
        <View style={styles.column}>{right.map(card)}</View>
      </View>
    );
  }

  const filters: { key: string; label: string; filter: Filter }[] = [
    { key: 'notes', label: 'Notes', filter: { kind: 'notes' } },
    ...labels.map((label) => ({ key: label.id, label: `🏷 ${label.name}`, filter: { kind: 'label', id: label.id } as Filter })),
    { key: 'archive', label: '🗄 Archive', filter: { kind: 'archive' } },
    { key: 'done', label: '✓ Done', filter: { kind: 'done' } },
  ];
  const isActive = (f: Filter) =>
    f.kind === filter.kind && (f.kind !== 'label' || (filter.kind === 'label' && filter.id === f.id));

  return (
    <Screen onClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        {/* Keep's search pill. */}
        <View
          style={[
            styles.bar,
            { backgroundColor: palette.surface, borderColor: palette.border, elevation: palette.elevationCard },
          ]}
        >
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.barGlyph, { color: palette.text }]}>←</Text>
            </Pressable>
          ) : (
            <Text style={[styles.barGlyph, { color: palette.dim }]}>⌕</Text>
          )}
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your notes"
            placeholderTextColor={palette.textFaint}
            style={[styles.search, { color: palette.text }]}
          />
          {query !== '' ? (
            <Pressable onPress={() => setQuery('')} hitSlop={10}>
              <Text style={[styles.barGlyph, { color: palette.dim }]}>✕</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setLayout(layout === 'grid' ? 'list' : 'grid')}
            hitSlop={10}
            accessibilityLabel={layout === 'grid' ? 'Show as a list' : 'Show as a grid'}
            style={({ pressed }) => [styles.layoutButton, pressed ? styles.pressed : null]}
          >
            <Text style={[styles.barGlyph, { color: palette.text }]}>{layout === 'grid' ? '☰' : '▦'}</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filtersScroll}
          contentContainerStyle={styles.filters}
        >
          {filters.map((f) => {
            const active = isActive(f.filter);
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.filter)}
                style={({ pressed }) => [
                  styles.filter,
                  {
                    backgroundColor: active ? palette.accent : 'transparent',
                    borderColor: active ? palette.accent : palette.border,
                  },
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={[styles.filterText, { color: active ? palette.onAccent : palette.text }]}>
                  {f.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {filter.kind === 'notes' && query === '' ? (
            // "Take a note…" with Keep's shortcuts: a checklist, an image.
            <View
              style={[
                styles.take,
                { backgroundColor: palette.surface, borderColor: palette.border, elevation: palette.elevationCard },
              ]}
            >
              <Pressable style={styles.takeText} onPress={() => setEditor({ kind: 'new', with: 'text' })}>
                <Text style={[styles.takePlaceholder, { color: palette.textFaint }]}>Take a note…</Text>
              </Pressable>
              <TakeButton glyph="☑" label="New checklist" colour={palette.text} onPress={() => setEditor({ kind: 'new', with: 'checklist' })} />
              <TakeButton glyph="🖼" label="New note with image" colour={palette.text} onPress={() => setEditor({ kind: 'new', with: 'library' })} />
              <TakeButton glyph="📷" label="New note with photo" colour={palette.text} onPress={() => setEditor({ kind: 'new', with: 'camera' })} />
            </View>
          ) : null}

          {notes.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyIcon}>
                {query !== '' ? '🔍' : filter.kind === 'archive' ? '🗄' : filter.kind === 'done' ? '✓' : '💡'}
              </Text>
              <Text style={[styles.emptyText, { color: palette.dim }]}>
                {query !== ''
                  ? 'No note has that in it'
                  : filter.kind === 'archive'
                    ? 'Archived notes appear here'
                    : filter.kind === 'done'
                      ? 'Nothing marked done yet'
                      : filter.kind === 'label'
                        ? 'No notes with this label'
                        : 'Notes you add appear here'}
              </Text>
            </View>
          ) : null}

          {pinned.length > 0 ? (
            <>
              <Text style={[styles.section, { color: palette.dim }]}>PINNED</Text>
              {cards(pinned)}
            </>
          ) : null}

          {others.length > 0 ? (
            <>
              {pinned.length > 0 ? <Text style={[styles.section, { color: palette.dim }]}>OTHERS</Text> : null}
              {cards(others)}
            </>
          ) : null}
        </ScrollView>

        {/* Keep's floating "new note" for when the bar has scrolled away. */}
        <Pressable
          onPress={() => setEditor({ kind: 'new', with: 'text' })}
          accessibilityLabel="New note"
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: palette.accent, elevation: palette.elevationOverlay },
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={[styles.fabGlyph, { color: palette.onAccent }]}>＋</Text>
        </Pressable>

        {editor ? <NoteEditor start={editor} scheme={scheme} onClose={() => setEditor(null)} /> : null}
      </View>
    </Screen>
  );
}

function TakeButton({
  glyph,
  label,
  colour,
  onPress,
}: {
  glyph: string;
  label: string;
  colour: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.takeButton, pressed ? styles.pressed : null]}
    >
      <Text style={[styles.takeGlyph, { color: colour }]}>{glyph}</Text>
    </Pressable>
  );
}

const PREVIEW_LINES = 8;

function NoteCard({
  note,
  vault,
  today,
  scheme,
  palette,
  labelNames,
  onOpen,
}: {
  note: Note;
  vault: OpenVault;
  today: string;
  scheme: Scheme;
  palette: Palette;
  labelNames: string[];
  onOpen: () => void;
}) {
  const overdue = !note.done && note.dueOn !== null && note.dueOn <= today;
  const image = note.content.blocks.find((b) => b.type === 'image');
  const lines = preview(note.content.blocks);
  const shown = lines.slice(0, PREVIEW_LINES);
  const hiddenTicked =
    note.content.checkedLast ? lines.filter((b) => b.type === 'check' && b.checked).length : 0;
  const fill = wash(scheme);
  let number = 0;

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
      {image && image.type === 'image' ? (
        <NoteImage
          vault={vault}
          fileId={image.fileId}
          width={image.width}
          height={image.height}
          maxHeight={220}
          placeholderColour={fill}
          textColour={palette.dim}
        />
      ) : null}

      <View style={styles.cardInner}>
        {note.title ? (
          <Text numberOfLines={2} style={[styles.cardTitle, { color: palette.text }]}>
            {note.title}
          </Text>
        ) : null}

        {shown
          .filter((b) => !(note.content.checkedLast && b.type === 'check' && b.checked))
          .map((block) => {
            number = block.type === 'numbered' ? number + 1 : 0;
            switch (block.type) {
              case 'check':
                return (
                  <View key={block.id} style={styles.cardCheck}>
                    <Text style={[styles.cardBox, { color: palette.dim }]}>{block.checked ? '☑' : '☐'}</Text>
                    <Text
                      numberOfLines={2}
                      style={[
                        styles.cardLine,
                        { color: block.checked ? palette.dim : palette.text },
                        block.checked ? styles.struck : null,
                      ]}
                    >
                      {block.text}
                    </Text>
                  </View>
                );
              case 'table':
                return (
                  <Text key={block.id} style={[styles.cardMeta, { color: palette.dim }]}>
                    ▦ Table · {block.rows.length} × {block.rows[0]?.length ?? 0}
                  </Text>
                );
              case 'divider':
                return <View key={block.id} style={[styles.cardDivider, { backgroundColor: palette.dim }]} />;
              case 'bullet':
              case 'numbered':
                return (
                  <Text key={block.id} numberOfLines={2} style={[styles.cardLine, { color: palette.text }]}>
                    {block.type === 'bullet' ? '• ' : `${number}. `}
                    {block.text}
                  </Text>
                );
              case 'text':
                return (
                  <Text
                    key={block.id}
                    numberOfLines={block.style === 'body' ? 6 : 2}
                    style={[
                      styles.cardLine,
                      { color: palette.text },
                      block.style === 'h1' || block.style === 'h2' ? styles.cardHeading : null,
                      block.style === 'quote' ? styles.italic : null,
                    ]}
                  >
                    {block.text}
                  </Text>
                );
              default:
                return null;
            }
          })}

        {lines.length > PREVIEW_LINES ? (
          <Text style={[styles.cardMeta, { color: palette.dim }]}>…</Text>
        ) : null}
        {hiddenTicked > 0 ? (
          <Text style={[styles.cardMeta, { color: palette.dim }]}>
            + {hiddenTicked} ticked {hiddenTicked === 1 ? 'item' : 'items'}
          </Text>
        ) : null}

        {note.dueOn || labelNames.length > 0 || note.checklist ? (
          <View style={styles.cardFoot}>
            {note.dueOn ? (
              <View style={[styles.chip, { backgroundColor: fill }]}>
                <Text
                  numberOfLines={1}
                  // Overdue is carried by weight, not a warning colour: the chip sits
                  // on the note's own shade, and ochre on a yellow card is unreadable.
                  style={[styles.chipText, { color: palette.text, fontWeight: overdue ? '700' : '500' }]}
                >
                  {note.notify ? '🔔 ' : '🕒 '}
                  {describeDate(note.dueOn)}
                </Text>
              </View>
            ) : null}
            {note.checklist && !note.content.checkedLast ? (
              <View style={[styles.chip, { backgroundColor: fill }]}>
                <Text style={[styles.chipText, { color: palette.text }]}>
                  ☑ {note.checklist.done}/{note.checklist.total}
                </Text>
              </View>
            ) : null}
            {labelNames.map((name) => (
              <View key={name} style={[styles.chip, { backgroundColor: fill }]}>
                <Text numberOfLines={1} style={[styles.chipText, { color: palette.text }]}>
                  {name}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 48 },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    height: 50,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  barGlyph: { fontSize: 20, fontWeight: '600' },
  search: { flex: 1, fontSize: typeScale.md, paddingVertical: 8 },
  layoutButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },

  filtersScroll: { flexGrow: 0, marginTop: spacing.md },
  filters: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  filter: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1 },
  filterText: { fontSize: typeScale.sm, fontWeight: '600' },

  body: { paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 120 },

  take: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.xs,
    marginBottom: spacing.lg,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    minHeight: 52,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  takeText: { flex: 1, paddingVertical: spacing.md },
  takePlaceholder: { fontSize: typeScale.md },
  takeButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: radii.pill },
  takeGlyph: { fontSize: 19 },

  empty: { alignItems: 'center', paddingTop: 80, gap: spacing.md },
  emptyIcon: { fontSize: 64, opacity: 0.35 },
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

  card: { borderRadius: radii.md, borderWidth: 1, overflow: 'hidden' },
  cardInner: { padding: spacing.md, gap: 4 },
  cardDone: { opacity: 0.62 },
  cardTitle: { fontSize: typeScale.md, fontWeight: '600', lineHeight: 22, marginBottom: 2 },
  cardLine: { fontSize: typeScale.base, lineHeight: 20, flexShrink: 1 },
  cardHeading: { fontWeight: '700' },
  italic: { fontStyle: 'italic' },
  cardCheck: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
  cardBox: { fontSize: typeScale.base, lineHeight: 20 },
  cardMeta: { fontSize: typeScale.sm, lineHeight: 20 },
  cardDivider: { height: StyleSheet.hairlineWidth * 2, opacity: 0.4, marginVertical: 4 },
  struck: { textDecorationLine: 'line-through' },
  cardFoot: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radii.pill, maxWidth: '100%' },
  chipText: { fontSize: typeScale.xs, fontWeight: '500' },

  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: 40,
    width: 58,
    height: 58,
    borderRadius: radii.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabGlyph: { fontSize: 28, fontWeight: '500' },

  // Press feedback: the card answers the finger before anything else happens.
  pressed: { transform: [{ scale: 0.97 }] },
});
