/**
 * Notes, in the manner of Google Keep — arranged by hand.
 *
 * A grid of cards (or one column), each showing what the note holds: its first
 * image across the top, its title, its opening lines, checklist items with their
 * ticks, a table's size. A note is something you glance at, so the card has to
 * say what is in it.
 *
 * HOLDING. Every card answers to how long it is held (see HoldCard): a tap opens
 * it, a short hold opens its options, and a long hold traces the border and
 * lifts it to be dragged. A lifted card can be dropped between two others to
 * reorder, or onto a chip at the top — a folder files it, a label tags it, All
 * notes takes it out of its folder, Archive and Done do what they say. Holding
 * an empty part of the screen offers a new note, or one made from whatever is on
 * the clipboard.
 *
 * FOLDERS hold notes, one folder per note. Labels are still there for the
 * cross-cutting tags, several per note. Search looks through everything, in
 * every folder, since looking for something is not the moment to remember
 * where it was put.
 */

import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
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
  type NoteFolder,
} from '@vaultp/core';

import { describeDate } from '../components/DateField.js';
import { paletteFor, type Palette } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { HoldCard, type Frame, type Point } from '../notes/HoldCard.js';
import { NoteImage, clipboardHasImage } from '../notes/images.js';
import { NoteActions } from '../notes/NoteActions.js';
import { NoteEditor, wash, type EditorStart } from '../notes/NoteEditor.js';
import { Sheet, SheetRow } from '../notes/sheet.js';
import type { OpenVault } from '../vault/open.js';
import type { IntentProps } from '../navigation.js';
import { useOpenVault } from '../vault/VaultContext.js';

type Scheme = 'light' | 'dark';
type Layout = 'grid' | 'list';
type Filter =
  | { kind: 'all' }
  | { kind: 'folder'; id: string }
  | { kind: 'label'; id: string }
  | { kind: 'archive' }
  | { kind: 'done' };

type Panel =
  | null
  | { kind: 'note'; note: Note }
  | { kind: 'space'; canPasteImage: boolean; canPasteText: boolean }
  | { kind: 'newFolder' }
  | { kind: 'folder'; folder: NoteFolder }
  | { kind: 'rename'; folder: NoteFolder };

/** Where a lifted note would land if let go now. */
type Hover =
  | null
  | { kind: 'chip'; key: string }
  | { kind: 'card'; id: string; edge: 'before' | 'after' };

interface Drag {
  readonly note: Note;
  readonly width: number;
  /** Where on the card the finger is, so the card does not jump to it. */
  readonly grab: Point;
}

const LAYOUT_SETTING = 'notes_layout';
const EDGE_ZONE = 90;

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

/** A rough rendered height, for balancing the two columns without laying out twice. */
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
  return blocks.filter(
    (b) => b.type !== 'image' && b.type !== 'unknown' && !(b.type === 'text' && b.text.trim() === ''),
  );
}

function sameHover(a: Hover, b: Hover): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'chip' && b.kind === 'chip') return a.key === b.key;
  if (a.kind === 'card' && b.kind === 'card') return a.id === b.id && a.edge === b.edge;
  return false;
}

function inside(point: Point, frame: Frame): boolean {
  return (
    point.x >= frame.x &&
    point.x <= frame.x + frame.width &&
    point.y >= frame.y &&
    point.y <= frame.y + frame.height
  );
}

export function Notes({ onClose, intent, onIntentHandled }: { onClose?: () => void } & IntentProps) {
  const { vault, version, mutate } = useOpenVault();
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = paletteFor(scheme);
  const today = todayIn();

  const [editor, setEditor] = useState<EditorStart | null>(null);

  // Arriving from search or Home: open that note, or start the kind asked for.
  useEffect(() => {
    if (!intent) return;
    if (intent.kind === 'note') {
      const note = vault.notes.getNote(intent.id);
      if (note) setEditor({ kind: 'existing', note });
    }
    if (intent.kind === 'newNote') {
      setEditor({ kind: 'new', with: intent.with === 'image' ? 'library' : intent.with, folderId: null });
    }
    onIntentHandled?.();
  }, [intent, vault, onIntentHandled]);
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Hover>(null);

  const layout = useMemo(
    () => readSetting<Layout>(vault.store, LAYOUT_SETTING, 'grid', isLayout),
    [vault, version],
  );
  const labels = useMemo(() => vault.notes.listLabels(), [vault, version]);
  const folders = useMemo(() => vault.notes.listFolders(), [vault, version]);

  // A folder or label deleted elsewhere (or on sync) must not strand the view.
  useEffect(() => {
    if (filter.kind === 'folder' && !folders.some((f) => f.id === filter.id)) setFilter({ kind: 'all' });
    if (filter.kind === 'label' && !labels.some((l) => l.id === filter.id)) setFilter({ kind: 'all' });
  }, [folders, labels, filter]);

  const searching = query.trim() !== '';
  const canReorder = !searching && (filter.kind === 'all' || filter.kind === 'folder');

  const notes = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (term !== '') {
      const everything = [
        ...vault.notes.listArranged(),
        ...vault.notes.listArchived(),
        ...vault.notes.listDone(200),
      ];
      return everything.filter(
        (note) => note.title.toLowerCase().includes(term) || note.body.toLowerCase().includes(term),
      );
    }
    switch (filter.kind) {
      case 'folder':
        return vault.notes.listArranged(filter.id);
      case 'archive':
        return vault.notes.listArchived();
      case 'done':
        return vault.notes.listDone(200);
      case 'label': {
        const ids = vault.notes.notesLabelled(filter.id);
        return [...vault.notes.listArranged(), ...vault.notes.listDone(200), ...vault.notes.listArchived()].filter(
          (note) => ids.has(note.id),
        );
      }
      default:
        return vault.notes.listArranged();
    }
  }, [vault, version, filter, query]);

  const pinned = canReorder ? notes.filter((n) => n.pinned) : [];
  const others = canReorder ? notes.filter((n) => !n.pinned) : notes;
  const folderNames = useMemo(() => new Map(folders.map((f) => [f.id, f.name])), [folders]);

  // ------------------------------------------------------------ notices

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function say(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2200);
  }

  // --------------------------------------------------------------- drag

  const root = useRef<View | null>(null);
  const scroller = useRef<ScrollView | null>(null);
  const scrollY = useRef(0);
  const cardViews = useRef(new Map<string, View>());
  const chipViews = useRef(new Map<string, View>());

  const geometry = useRef<{
    root: Point;
    viewport: Frame;
    cards: Map<string, Frame>;
    chips: Map<string, Frame>;
    scrollAtMeasure: number;
  } | null>(null);
  const floating = useRef(new Animated.ValueXY()).current;
  const lift = useRef(new Animated.Value(1)).current;
  const lastTouch = useRef<Point>({ x: 0, y: 0 });
  const hoverRef = useRef<Hover>(null);
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);

  function measure(view: View): Promise<Frame | null> {
    return new Promise((resolve) => {
      view.measureInWindow((x, y, width, height) =>
        resolve(width > 0 || height > 0 ? { x, y, width, height } : null),
      );
    });
  }

  async function onLift(note: Note, touch: Point, frame: Frame) {
    const grab = { x: touch.x - frame.x, y: touch.y - frame.y };
    lastTouch.current = touch;

    const [rootFrame, viewport] = await Promise.all([
      root.current ? measure(root.current) : Promise.resolve(null),
      scroller.current ? measure(scroller.current as unknown as View) : Promise.resolve(null),
    ]);
    const cards = new Map<string, Frame>();
    const chips = new Map<string, Frame>();
    await Promise.all([
      ...[...cardViews.current].map(async ([id, view]) => {
        const f = await measure(view);
        if (f) cards.set(id, f);
      }),
      ...[...chipViews.current].map(async ([key, view]) => {
        const f = await measure(view);
        if (f) chips.set(key, f);
      }),
    ]);

    geometry.current = {
      root: { x: rootFrame?.x ?? 0, y: rootFrame?.y ?? 0 },
      viewport: viewport ?? { x: 0, y: 0, width: 0, height: 10_000 },
      cards,
      chips,
      scrollAtMeasure: scrollY.current,
    };

    floating.setValue({
      x: touch.x - grab.x - geometry.current.root.x,
      y: touch.y - grab.y - geometry.current.root.y,
    });
    lift.setValue(1);
    Animated.spring(lift, { toValue: 1.05, useNativeDriver: true, speed: 18, bounciness: 6 }).start();
    setDrag({ note, width: frame.width, grab });
  }

  function hitTest(touch: Point, dragged: Note): Hover {
    const g = geometry.current;
    if (!g) return null;

    for (const [key, frame] of g.chips) {
      // A little generous vertically: the chips are small targets for a thumb
      // that is also carrying a card.
      if (inside(touch, { ...frame, y: frame.y - 12, height: frame.height + 24 })) return { kind: 'chip', key };
    }
    if (!canReorder) return null;

    const shift = scrollY.current - g.scrollAtMeasure;
    for (const [id, frame] of g.cards) {
      if (id === dragged.id) continue;
      const current = { ...frame, y: frame.y - shift };
      if (inside(touch, current)) {
        return { kind: 'card', id, edge: touch.y < current.y + current.height / 2 ? 'before' : 'after' };
      }
    }
    return null;
  }

  function onDragMove(touch: Point) {
    const g = geometry.current;
    if (!drag || !g) return;
    lastTouch.current = touch;
    floating.setValue({ x: touch.x - drag.grab.x - g.root.x, y: touch.y - drag.grab.y - g.root.y });

    const next = hitTest(touch, drag.note);
    if (!sameHover(next, hoverRef.current)) {
      hoverRef.current = next;
      setHover(next);
    }

    // Near the top or bottom of the list, scroll it, so a note can be carried
    // past the edge of the screen.
    const top = g.viewport.y + EDGE_ZONE;
    const bottom = g.viewport.y + g.viewport.height - EDGE_ZONE;
    const speed = touch.y < top ? -(top - touch.y) / 6 : touch.y > bottom ? (touch.y - bottom) / 6 : 0;
    if (speed !== 0 && !autoScroll.current) {
      autoScroll.current = setInterval(() => {
        const t = lastTouch.current;
        const s = t.y < top ? -(top - t.y) / 6 : t.y > bottom ? (t.y - bottom) / 6 : 0;
        if (s === 0) return;
        scrollY.current = Math.max(0, scrollY.current + s);
        scroller.current?.scrollTo({ y: scrollY.current, animated: false });
      }, 16);
    } else if (speed === 0) {
      stopAutoScroll();
    }
  }

  function stopAutoScroll() {
    if (autoScroll.current) clearInterval(autoScroll.current);
    autoScroll.current = null;
  }

  function endDrag() {
    stopAutoScroll();
    hoverRef.current = null;
    setHover(null);
    setDrag(null);
    geometry.current = null;
  }

  function onDrop(touch: Point) {
    const dragged = drag?.note;
    const target = dragged ? hitTest(touch, dragged) : null;
    endDrag();
    if (!dragged || !target) return;

    if (target.kind === 'chip') {
      const [kind, id] = target.key.split(':') as [string, string | undefined];
      if (kind === 'all') {
        if (dragged.folderId) {
          mutate((v) => v.notes.moveToFolder(dragged.id, null));
          say('Taken out of its folder');
        }
      } else if (kind === 'folder' && id) {
        mutate((v) => v.notes.moveToFolder(dragged.id, id));
        say(`Moved to ${folderNames.get(id) ?? 'folder'}`);
      } else if (kind === 'label' && id) {
        mutate((v) => v.notes.addLabel(dragged.id, id));
        say(`Labelled ${labels.find((l) => l.id === id)?.name ?? ''}`);
      } else if (kind === 'archive') {
        mutate((v) => v.notes.updateNote(dragged.id, { archived: true }));
        say('Archived');
      } else if (kind === 'done') {
        mutate((v) => v.notes.setDone(dragged.id, true));
        say('Marked done');
      }
      return;
    }

    // Reorder: take the note out, put it beside the target, and store only its
    // new position between its new neighbours.
    // Only the notes in the target's group (pinned or not) count as neighbours;
    // dropping among the pinned ones pins it, and among the rest unpins it.
    const targetNote = notes.find((n) => n.id === target.id);
    if (!targetNote) return;
    const group = notes.filter((n) => n.id !== dragged.id && n.pinned === targetNote.pinned);
    const at = group.findIndex((n) => n.id === targetNote.id);
    const previous = target.edge === 'before' ? (group[at - 1] ?? null) : targetNote;
    const next = target.edge === 'before' ? targetNote : (group[at + 1] ?? null);
    mutate((v) => v.notes.placeNote(dragged.id, previous?.id ?? null, next?.id ?? null, targetNote.pinned));
  }

  // -------------------------------------------------------- empty space

  async function openSpaceMenu() {
    const [canPasteImage, canPasteText] = await Promise.all([
      clipboardHasImage(),
      Clipboard.hasStringAsync().catch(() => false),
    ]);
    setPanel({ kind: 'space', canPasteImage, canPasteText });
  }

  const currentFolder = filter.kind === 'folder' ? filter.id : null;

  async function pasteAsNote() {
    setPanel(null);
    if (await clipboardHasImage()) {
      setEditor({ kind: 'new', with: 'clipboard', folderId: currentFolder });
      return;
    }
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (text.trim() === '') {
      say('Nothing to paste');
      return;
    }
    setEditor({ kind: 'new', text, folderId: currentFolder });
  }

  // -------------------------------------------------------------- render

  function renderCard(note: Note) {
    return (
      <HoldCard
        key={note.id}
        accent={palette.accent}
        radius={radii.md}
        ghost={drag?.note.id === note.id}
        dropEdge={hover?.kind === 'card' && hover.id === note.id ? hover.edge : null}
        viewRef={(view) => {
          if (view) cardViews.current.set(note.id, view);
          else cardViews.current.delete(note.id);
        }}
        onTap={() => setEditor({ kind: 'existing', note })}
        onMenu={() => setPanel({ kind: 'note', note })}
        onLift={(touch, frame) => void onLift(note, touch, frame)}
        onDragMove={onDragMove}
        onDrop={onDrop}
        onDragCancel={endDrag}
      >
        <NoteCard
          note={note}
          vault={vault}
          today={today}
          scheme={scheme}
          palette={palette}
          folderName={filter.kind === 'folder' || !note.folderId ? null : (folderNames.get(note.folderId) ?? null)}
          labelNames={vault.notes.labelsFor(note.id).map((label) => label.name)}
        />
      </HoldCard>
    );
  }

  function cards(list: readonly Note[]) {
    if (layout === 'list') return <View style={styles.column}>{list.map(renderCard)}</View>;
    const [left, right] = balance(list);
    return (
      <View style={styles.grid}>
        <View style={styles.column}>{left.map(renderCard)}</View>
        <View style={styles.column}>{right.map(renderCard)}</View>
      </View>
    );
  }

  const chips: { key: string; label: string; filter: Filter | null; folder?: NoteFolder }[] = [
    { key: 'all', label: 'All notes', filter: { kind: 'all' } },
    ...folders.map((folder) => ({
      key: `folder:${folder.id}`,
      label: `📁 ${folder.name}`,
      filter: { kind: 'folder', id: folder.id } as Filter,
      folder,
    })),
    ...labels.map((label) => ({
      key: `label:${label.id}`,
      label: `🏷 ${label.name}`,
      filter: { kind: 'label', id: label.id } as Filter,
    })),
    { key: 'archive', label: '🗄 Archive', filter: { kind: 'archive' } },
    { key: 'done', label: '✓ Done', filter: { kind: 'done' } },
  ];
  const isActive = (f: Filter) =>
    f.kind === filter.kind && (!('id' in f) || ('id' in filter && filter.id === f.id));

  return (
    <Screen onClose={onClose}>
      <View ref={root} collapsable={false} style={[styles.screen, { backgroundColor: palette.background }]}>
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
            onPress={() => mutate((v) => writeSetting(v.store, LAYOUT_SETTING, layout === 'grid' ? 'list' : 'grid'))}
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
          scrollEnabled={!drag}
        >
          {chips.map((chip) => {
            const active = chip.filter ? isActive(chip.filter) : false;
            const hovered = hover?.kind === 'chip' && hover.key === chip.key;
            return (
              <Pressable
                key={chip.key}
                ref={(view) => {
                  if (view) chipViews.current.set(chip.key, view as unknown as View);
                  else chipViews.current.delete(chip.key);
                }}
                onPress={() => chip.filter && setFilter(chip.filter)}
                onLongPress={chip.folder ? () => setPanel({ kind: 'folder', folder: chip.folder! }) : undefined}
                style={({ pressed }) => [
                  styles.filter,
                  {
                    backgroundColor: hovered ? palette.accent : active ? palette.accent : 'transparent',
                    borderColor: active || hovered ? palette.accent : palette.border,
                  },
                  hovered ? styles.chipHovered : null,
                  pressed ? styles.pressed : null,
                ]}
              >
                <Text style={[styles.filterText, { color: active || hovered ? palette.onAccent : palette.text }]}>
                  {chip.label}
                </Text>
              </Pressable>
            );
          })}
          {!drag ? (
            <Pressable
              onPress={() => setPanel({ kind: 'newFolder' })}
              style={({ pressed }) => [
                styles.filter,
                styles.dashed,
                { borderColor: palette.border },
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={[styles.filterText, { color: palette.dim }]}>＋ Folder</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <ScrollView
          ref={scroller}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          scrollEnabled={!drag}
          scrollEventThrottle={16}
          onScroll={(event) => {
            scrollY.current = event.nativeEvent.contentOffset.y;
          }}
        >
          {/* The empty space is a target too: hold it for a new or pasted note. */}
          <Pressable style={styles.space} onLongPress={() => void openSpaceMenu()} delayLongPress={450}>
            {filter.kind !== 'archive' && filter.kind !== 'done' && !searching ? (
              <View
                style={[
                  styles.take,
                  { backgroundColor: palette.surface, borderColor: palette.border, elevation: palette.elevationCard },
                ]}
              >
                <Pressable
                  style={styles.takeText}
                  onPress={() => setEditor({ kind: 'new', with: 'text', folderId: currentFolder })}
                >
                  <Text style={[styles.takePlaceholder, { color: palette.textFaint }]}>Take a note…</Text>
                </Pressable>
                <TakeButton
                  glyph="☑"
                  label="New checklist"
                  colour={palette.text}
                  onPress={() => setEditor({ kind: 'new', with: 'checklist', folderId: currentFolder })}
                />
                <TakeButton
                  glyph="🖼"
                  label="New note with image"
                  colour={palette.text}
                  onPress={() => setEditor({ kind: 'new', with: 'library', folderId: currentFolder })}
                />
                <TakeButton
                  glyph="📷"
                  label="New note with photo"
                  colour={palette.text}
                  onPress={() => setEditor({ kind: 'new', with: 'camera', folderId: currentFolder })}
                />
              </View>
            ) : null}

            {notes.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyIcon}>
                  {searching ? '🔍' : filter.kind === 'archive' ? '🗄' : filter.kind === 'done' ? '✓' : filter.kind === 'folder' ? '📁' : '💡'}
                </Text>
                <Text style={[styles.emptyText, { color: palette.dim }]}>
                  {searching
                    ? 'No note has that in it'
                    : filter.kind === 'archive'
                      ? 'Archived notes appear here'
                      : filter.kind === 'done'
                        ? 'Nothing marked done yet'
                        : filter.kind === 'folder'
                          ? 'This folder is empty. Hold a note and drag it onto the folder to file it.'
                          : filter.kind === 'label'
                            ? 'No notes with this label'
                            : 'Notes you add appear here. Hold any empty spot to paste one.'}
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
          </Pressable>
        </ScrollView>

        {!drag ? (
          <Pressable
            onPress={() => setEditor({ kind: 'new', with: 'text', folderId: currentFolder })}
            accessibilityLabel="New note"
            style={({ pressed }) => [
              styles.fab,
              { backgroundColor: palette.accent, elevation: palette.elevationOverlay },
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={[styles.fabGlyph, { color: palette.onAccent }]}>＋</Text>
          </Pressable>
        ) : null}

        {notice ? (
          <View pointerEvents="none" style={[styles.notice, { backgroundColor: palette.text }]}>
            <Text style={[styles.noticeText, { color: palette.background }]}>{notice}</Text>
          </View>
        ) : null}

        {/* The lifted card, following the finger. */}
        {drag ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.floating,
              {
                width: drag.width,
                elevation: 16,
                transform: [...floating.getTranslateTransform(), { scale: lift }],
              },
            ]}
          >
            <NoteCard
              note={drag.note}
              vault={vault}
              today={today}
              scheme={scheme}
              palette={palette}
              folderName={null}
              labelNames={[]}
            />
          </Animated.View>
        ) : null}

        {panel?.kind === 'note' ? (
          <NoteActions
            note={panel.note}
            folders={folders}
            palette={palette}
            scheme={scheme}
            mutate={mutate}
            onClose={() => setPanel(null)}
            onNotice={say}
          />
        ) : null}

        {panel?.kind === 'space' ? (
          <Sheet palette={palette} onClose={() => setPanel(null)}>
            <SheetRow
              glyph="📝"
              label="New note"
              palette={palette}
              onPress={() => {
                setPanel(null);
                setEditor({ kind: 'new', with: 'text', folderId: currentFolder });
              }}
            />
            <SheetRow
              glyph="☑"
              label="New checklist"
              palette={palette}
              onPress={() => {
                setPanel(null);
                setEditor({ kind: 'new', with: 'checklist', folderId: currentFolder });
              }}
            />
            <SheetRow
              glyph="📋"
              label={
                panel.canPasteImage
                  ? 'Paste image as a new note'
                  : panel.canPasteText
                    ? 'Paste as a new note'
                    : 'Paste (nothing copied)'
              }
              palette={palette}
              disabled={!panel.canPasteImage && !panel.canPasteText}
              onPress={() => void pasteAsNote()}
            />
            <SheetRow glyph="📁" label="New folder" palette={palette} onPress={() => setPanel({ kind: 'newFolder' })} />
          </Sheet>
        ) : null}

        {panel?.kind === 'folder' ? (
          <Sheet palette={palette} onClose={() => setPanel(null)} title={panel.folder.name}>
            <SheetRow
              glyph="✎"
              label="Rename"
              palette={palette}
              onPress={() => setPanel({ kind: 'rename', folder: panel.folder })}
            />
            <SheetRow
              glyph="🗑"
              label="Delete folder"
              palette={palette}
              danger
              onPress={() => {
                const folder = panel.folder;
                setPanel(null);
                Alert.alert(
                  `Delete “${folder.name}”?`,
                  'The notes in it are kept; they just stop being in a folder.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete folder',
                      style: 'destructive',
                      onPress: () => {
                        mutate((v) => v.notes.deleteFolder(folder.id));
                        say('Folder deleted, notes kept');
                      },
                    },
                  ],
                );
              }}
            />
          </Sheet>
        ) : null}

        {panel?.kind === 'newFolder' || panel?.kind === 'rename' ? (
          <FolderNameSheet
            palette={palette}
            initial={panel.kind === 'rename' ? panel.folder.name : ''}
            action={panel.kind === 'rename' ? 'Rename' : 'Create'}
            onClose={() => setPanel(null)}
            onSave={(name) => {
              if (panel.kind === 'rename') {
                mutate((v) => v.notes.renameFolder(panel.folder.id, name));
              } else {
                const folder = mutate((v) => v.notes.addFolder(name));
                if (folder) setFilter({ kind: 'folder', id: folder.id });
              }
              setPanel(null);
            }}
          />
        ) : null}

        {editor ? <NoteEditor start={editor} scheme={scheme} onClose={() => setEditor(null)} /> : null}
      </View>
    </Screen>
  );
}

function FolderNameSheet({
  palette,
  initial,
  action,
  onClose,
  onSave,
}: {
  palette: Palette;
  initial: string;
  action: string;
  onClose: () => void;
  onSave: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const valid = name.trim() !== '';
  return (
    <Sheet palette={palette} onClose={onClose} title={action === 'Rename' ? 'Rename folder' : 'New folder'}>
      <View style={[styles.nameRow, { backgroundColor: palette.key }]}>
        <TextInput
          value={name}
          onChangeText={setName}
          autoFocus
          placeholder="Folder name"
          placeholderTextColor={palette.textFaint}
          onSubmitEditing={() => valid && onSave(name)}
          style={[styles.nameInput, { color: palette.text }]}
        />
        <Pressable disabled={!valid} onPress={() => onSave(name)} hitSlop={8}>
          <Text style={{ color: palette.accent, fontWeight: '700', opacity: valid ? 1 : 0.4 }}>{action}</Text>
        </Pressable>
      </View>
    </Sheet>
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

/** The card's face. Not pressable itself: HoldCard owns every touch on it. */
function NoteCard({
  note,
  vault,
  today,
  scheme,
  palette,
  folderName,
  labelNames,
}: {
  note: Note;
  vault: OpenVault;
  today: string;
  scheme: Scheme;
  palette: Palette;
  folderName: string | null;
  labelNames: string[];
}) {
  const overdue = !note.done && note.dueOn !== null && note.dueOn <= today;
  const image = note.content.blocks.find((b) => b.type === 'image');
  const lines = preview(note.content.blocks);
  const shown = lines.slice(0, PREVIEW_LINES);
  const hiddenTicked = note.content.checkedLast ? lines.filter((b) => b.type === 'check' && b.checked).length : 0;
  const fill = wash(scheme);
  let number = 0;

  return (
    <View style={[styles.card, cardColours(note, scheme, palette), note.done ? styles.cardDone : null]}>
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

        {lines.length > PREVIEW_LINES ? <Text style={[styles.cardMeta, { color: palette.dim }]}>…</Text> : null}
        {hiddenTicked > 0 ? (
          <Text style={[styles.cardMeta, { color: palette.dim }]}>
            + {hiddenTicked} ticked {hiddenTicked === 1 ? 'item' : 'items'}
          </Text>
        ) : null}

        {note.dueOn || labelNames.length > 0 || note.checklist || folderName ? (
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
            {folderName ? (
              <View style={[styles.chip, { backgroundColor: fill }]}>
                <Text numberOfLines={1} style={[styles.chipText, { color: palette.text }]}>
                  📁 {folderName}
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
    </View>
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
  filters: { paddingHorizontal: spacing.lg, paddingVertical: 4, gap: spacing.sm },
  filter: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radii.pill, borderWidth: 1 },
  filterText: { fontSize: typeScale.sm, fontWeight: '600' },
  chipHovered: { transform: [{ scale: 1.08 }] },
  dashed: { borderStyle: 'dashed' },

  body: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 120 },
  space: { flexGrow: 1, minHeight: 420 },

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

  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: spacing.xl, gap: spacing.md },
  emptyIcon: { fontSize: 64, opacity: 0.35 },
  emptyText: { fontSize: typeScale.md, textAlign: 'center', lineHeight: 22 },

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

  floating: { position: 'absolute', top: 0, left: 0, opacity: 0.96, borderRadius: radii.md },

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

  notice: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 110,
    paddingHorizontal: spacing.lg,
    paddingVertical: 10,
    borderRadius: radii.pill,
  },
  noticeText: { fontSize: typeScale.sm, fontWeight: '600' },

  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  nameInput: { flex: 1, fontSize: typeScale.md, paddingVertical: 10 },

  // Press feedback: the thing touched answers the finger first.
  pressed: { transform: [{ scale: 0.97 }] },
});
