/**
 * Editing a note, in the manner of Google Keep.
 *
 * The note is the page: a title, then its blocks, on the note's own colour, with
 * a toolbar along the bottom — add (＋), format (Aa), colour, and everything
 * else (⋮). There is no Save button. Keep saves as you type, and so does this:
 * a note you were halfway through when the phone rang is not lost.
 *
 * A note that ends up empty is discarded on the way out, as in Keep, rather
 * than left as a blank card.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  NOTE_COLOURS,
  checkBlock,
  convertBlock,
  dividerBlock,
  displayOrder,
  imageBlock,
  isContentEmpty,
  isTextual,
  listBlock,
  moveBlock,
  noteShades,
  radii,
  spacing,
  tableBlock,
  textBlock,
  typeScale,
  type Block,
  type CheckBlock,
  type ImageBlock,
  type ListBlock,
  type Note,
  type NoteColour,
  type TextBlock,
  type TextStyle,
} from '@vaultp/core';

import { DateField } from '../components/DateField.js';
import { paletteFor } from '../components/theme.js';
import { useOpenVault } from '../vault/VaultContext.js';
import { BlockView } from './BlockView.js';
import {
  ImageImportError,
  addImage,
  clipboardHasImage,
  removeReleased,
  useNoteImage,
  type ImageSource,
} from './images.js';

type Scheme = 'light' | 'dark';
type Textual = TextBlock | ListBlock | CheckBlock;

export type EditorStart =
  | { kind: 'existing'; note: Note }
  | { kind: 'new'; with?: 'text' | 'checklist' | ImageSource };

type Sheet = null | 'add' | 'format' | 'colour' | 'more' | 'labels' | 'reminder' | { block: string };

export function wash(scheme: Scheme): string {
  return scheme === 'dark' ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.06)';
}

export function NoteEditor({
  start,
  scheme,
  onClose,
}: {
  start: EditorStart;
  scheme: Scheme;
  onClose: () => void;
}) {
  const { vault, mutate } = useOpenVault();
  const palette = paletteFor(scheme);
  const existing = start.kind === 'existing' ? start.note : null;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [blocks, setBlocks] = useState<Block[]>(() => {
    if (existing) return existing.content.blocks.length > 0 ? [...existing.content.blocks] : [textBlock()];
    return [start.kind === 'new' && start.with === 'checklist' ? checkBlock() : textBlock()];
  });
  const [checkedLast, setCheckedLast] = useState(existing?.content.checkedLast ?? false);
  const [colour, setColour] = useState<NoteColour | null>(existing?.colour ?? null);
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const [dueOn, setDueOn] = useState(existing?.dueOn ?? '');
  const [notify, setNotify] = useState(existing?.notify ?? false);
  const [done, setDone] = useState(existing?.done ?? false);
  const [labelIds, setLabelIds] = useState<Set<string>>(
    () => new Set(existing ? vault.notes.labelsFor(existing.id).map((label) => label.id) : []),
  );

  const [sheet, setSheet] = useState<Sheet>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [viewing, setViewing] = useState<ImageBlock | null>(null);
  const [showTicked, setShowTicked] = useState(true);
  const [canPaste, setCanPaste] = useState(false);
  const [editedAt, setEditedAt] = useState<string | null>(existing?.updatedAt ?? null);
  const [error, setError] = useState<string | null>(null);

  const inputs = useRef(new Map<string, TextInput>());
  const savedId = useRef<string | null>(existing?.id ?? null);
  const addedFiles = useRef<string[]>([]);
  const dirty = useRef(false);
  const closed = useRef(false);

  // The latest state, for the save that runs from a timer or on the way out.
  const latest = useRef({ title, blocks, checkedLast, colour, pinned, archived, dueOn, notify, done, labelIds });
  latest.current = { title, blocks, checkedLast, colour, pinned, archived, dueOn, notify, done, labelIds };

  const ground = colour ? (noteShades[scheme][colour] ?? palette.background) : palette.background;
  const fill = wash(scheme);

  // ----------------------------------------------------------------- saving

  function persist(final: boolean) {
    const s = latest.current;
    const content = { blocks: s.blocks, checkedLast: s.checkedLast };
    const empty = s.title.trim() === '' && isContentEmpty(content);
    const due = s.dueOn.trim() === '' ? null : s.dueOn.trim();

    mutate((v) => {
      if (savedId.current === null) {
        if (empty) return;
        const created = v.notes.addNote({
          title: s.title,
          content,
          colour: s.colour,
          pinned: s.pinned,
          ...(due ? { dueOn: due, notify: s.notify } : {}),
        });
        savedId.current = created.id;
        if (s.archived) v.notes.updateNote(created.id, { archived: true });
        for (const id of s.labelIds) v.notes.addLabel(created.id, id);
        if (s.done) v.notes.setDone(created.id, true);
        return;
      }

      const id = savedId.current;
      if (empty) {
        // Keep's rule: a note emptied and left is gone, not a blank card.
        if (final) removeReleased(v.notes.deleteNote(id));
        return;
      }

      const { note, released } = v.notes.saveNote(id, {
        title: s.title,
        content,
        colour: s.colour,
        pinned: s.pinned,
        archived: s.archived,
        dueOn: due,
        notify: due ? s.notify : false,
      });
      removeReleased(released);
      if (note.done !== s.done) v.notes.setDone(id, s.done);

      const current = new Set(v.notes.labelsFor(id).map((label) => label.id));
      for (const labelId of s.labelIds) if (!current.has(labelId)) v.notes.addLabel(id, labelId);
      for (const labelId of current) if (!s.labelIds.has(labelId)) v.notes.removeLabel(id, labelId);
    });

    if (final) {
      // Images added while editing and then removed (or a note discarded) are
      // referenced by nothing; let them go now rather than leave orphans.
      mutate((v) => removeReleased(v.notes.releaseUnused(addedFiles.current)));
    }
    dirty.current = false;
    setEditedAt(new Date().toISOString());
  }

  function close() {
    if (closed.current) return;
    closed.current = true;
    persist(true);
    onClose();
  }

  // Save a moment after typing stops.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => persist(false), 700);
    return () => clearTimeout(timer);
  }, [title, blocks, checkedLast, colour, pinned, archived, dueOn, notify, done, labelIds]);

  function touch() {
    dirty.current = true;
  }

  // Open straight into the picker when the note was started from an image button.
  useEffect(() => {
    if (start.kind === 'new' && (start.with === 'library' || start.with === 'camera' || start.with === 'clipboard')) {
      void insertImage(start.with);
    }
    void clipboardHasImage().then(setCanPaste);
  }, []);

  useEffect(() => {
    if (!pendingFocus) return;
    const input = inputs.current.get(pendingFocus);
    if (input) {
      input.focus();
      setPendingFocus(null);
    }
  }, [pendingFocus, blocks]);

  // ------------------------------------------------------------ block edits

  function update(next: Block) {
    touch();
    setBlocks((current) => current.map((block) => (block.id === next.id ? next : block)));
  }

  function indexOf(id: string | null): number {
    return id === null ? -1 : blocks.findIndex((block) => block.id === id);
  }

  /** Insert after the block being edited, or at the end. */
  function insert(newBlocks: Block[], focus?: string) {
    touch();
    setBlocks((current) => {
      const at = focusId ? current.findIndex((block) => block.id === focusId) : -1;
      const position = at === -1 ? current.length : at + 1;
      const next = [...current];

      // Replacing an empty paragraph the cursor sits in, rather than leaving a
      // blank line above whatever was inserted.
      const here = at === -1 ? undefined : current[at];
      const replaceHere = here?.type === 'text' && here.text === '' && here.style === 'body';
      next.splice(replaceHere ? at : position, replaceHere ? 1 : 0, ...newBlocks);

      // Always somewhere to keep writing after a table, an image or a divider.
      const last = next[next.length - 1];
      if (last && !isTextual(last)) next.push(textBlock());
      return next;
    });
    if (focus) setPendingFocus(focus);
  }

  function split(block: Textual, before: string, after: string) {
    touch();
    // Enter on an empty list item leaves the list, as every editor does.
    if (block.type !== 'text' && before.trim() === '' && after === '') {
      update(convertBlock(block, 'body'));
      return;
    }
    const next: Block =
      block.type === 'check'
        ? checkBlock(after, false, block.indent)
        : block.type === 'bullet' || block.type === 'numbered'
          ? listBlock(block.type, after, block.indent)
          : textBlock(after);

    setBlocks((current) => {
      const at = current.findIndex((b) => b.id === block.id);
      const copy = [...current];
      copy[at] = { ...block, text: before };
      copy.splice(at + 1, 0, next);
      return copy;
    });
    setPendingFocus(next.id);
  }

  function backspaceEmpty(block: Textual) {
    if (block.type !== 'text' && block.indent > 0) {
      update({ ...block, indent: 0 });
      return;
    }
    if (block.type !== 'text' || block.style !== 'body') {
      update(convertBlock(block, 'body'));
      return;
    }
    const at = indexOf(block.id);
    if (at <= 0 || blocks.length === 1) return;
    touch();
    const previous = blocks.slice(0, at).reverse().find(isTextual);
    setBlocks((current) => current.filter((b) => b.id !== block.id));
    if (previous) setPendingFocus(previous.id);
  }

  function remove(id: string) {
    touch();
    setBlocks((current) => {
      const next = current.filter((block) => block.id !== id);
      return next.length > 0 ? next : [textBlock()];
    });
  }

  function move(id: string, by: number) {
    const at = indexOf(id);
    if (at === -1) return;
    touch();
    setBlocks((current) => moveBlock(current, at, at + by));
  }

  async function insertImage(source: ImageSource) {
    setSheet(null);
    setError(null);
    try {
      const added = await addImage(vault.keys, source, (fn) => mutate(fn));
      if (!added) return;
      addedFiles.current.push(added.fileId);
      insert([imageBlock(added.fileId, added)]);
    } catch (caught: unknown) {
      setError(caught instanceof ImageImportError || caught instanceof Error ? caught.message : String(caught));
    }
  }

  function addFromMenu(kind: 'check' | 'bullet' | 'numbered' | 'h1' | 'table' | 'divider') {
    setSheet(null);
    const block =
      kind === 'check'
        ? checkBlock()
        : kind === 'bullet' || kind === 'numbered'
          ? listBlock(kind)
          : kind === 'h1'
            ? textBlock('', 'h1')
            : kind === 'table'
              ? tableBlock(3, 2)
              : dividerBlock();
    insert([block], isTextual(block) ? block.id : undefined);
  }

  function format(to: TextStyle | 'bullet' | 'numbered' | 'check') {
    const block = blocks.find((b) => b.id === focusId);
    if (!block || !isTextual(block)) return;
    update(convertBlock(block, to));
    setSheet(null);
    setPendingFocus(block.id);
  }

  function indent(by: 1 | -1) {
    const block = blocks.find((b) => b.id === focusId);
    if (!block || block.type === 'text' || !isTextual(block)) return;
    update({ ...block, indent: by > 0 ? 1 : 0 });
  }

  // --------------------------------------------------------------- display

  const ordered = useMemo(() => displayOrder({ blocks, checkedLast }), [blocks, checkedLast]);
  const focused = blocks.find((b) => b.id === focusId);

  const numbers = useMemo(() => {
    const map = new Map<string, number>();
    let n = 0;
    for (const block of ordered) {
      n = block.type === 'numbered' ? n + 1 : 0;
      if (block.type === 'numbered') map.set(block.id, n);
    }
    return map;
  }, [ordered]);

  /** With ticked-last on, where each run's ticked items begin, and how many. */
  const tickedStarts = useMemo(() => {
    const starts = new Map<string, number>();
    if (!checkedLast) return starts;
    for (let i = 0; i < ordered.length; i += 1) {
      const block = ordered[i]!;
      const previous = ordered[i - 1];
      if (block.type === 'check' && block.checked && !(previous?.type === 'check' && previous.checked)) {
        let count = 0;
        for (let j = i; j < ordered.length; j += 1) {
          const b = ordered[j]!;
          if (b.type === 'check' && b.checked) count += 1;
          else break;
        }
        starts.set(block.id, count);
      }
    }
    return starts;
  }, [ordered, checkedLast]);

  const labels = vault.notes.listLabels();

  return (
    <Modal visible animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={[styles.screen, { backgroundColor: ground }]}>
        <View style={styles.head}>
          <IconButton glyph="←" label="Back" onPress={close} colour={palette.text} />
          <View style={styles.headRight}>
            <IconButton
              glyph="📌"
              label={pinned ? 'Unpin' : 'Pin'}
              faded={!pinned}
              fill={pinned ? fill : undefined}
              onPress={() => {
                touch();
                setPinned((p) => !p);
                if (!pinned) setArchived(false);
              }}
              colour={palette.text}
            />
            <IconButton
              glyph="🔔"
              label="Reminder"
              faded={dueOn === ''}
              fill={dueOn !== '' ? fill : undefined}
              onPress={() => {
                Keyboard.dismiss();
                setSheet('reminder');
              }}
              colour={palette.text}
            />
            <IconButton
              glyph="🗄"
              label={archived ? 'Unarchive' : 'Archive'}
              faded={!archived}
              fill={archived ? fill : undefined}
              onPress={() => {
                touch();
                const next = !archived;
                setArchived(next);
                if (next) {
                  setPinned(false);
                  latest.current = { ...latest.current, archived: true, pinned: false };
                  close();
                }
              }}
              colour={palette.text}
            />
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
        >
          <TextInput
            value={title}
            onChangeText={(value) => {
              touch();
              setTitle(value.replace(/\n/g, ' '));
            }}
            onFocus={() => setFocusId(null)}
            placeholder="Title"
            placeholderTextColor={palette.textFaint}
            multiline
            scrollEnabled={false}
            returnKeyType="next"
            blurOnSubmit
            onSubmitEditing={() => {
              const first = blocks.find(isTextual);
              if (first) setPendingFocus(first.id);
            }}
            style={[styles.title, { color: palette.text }]}
          />

          {ordered.map((block) => {
            const tickedCount = tickedStarts.get(block.id);
            const hiddenTicked = checkedLast && !showTicked && block.type === 'check' && block.checked;
            return (
              <View key={block.id}>
                {tickedCount !== undefined ? (
                  <Pressable onPress={() => setShowTicked((s) => !s)} style={styles.tickedHead}>
                    <Text style={[styles.tickedText, { color: palette.dim }]}>
                      {showTicked ? '⌄' : '›'} {tickedCount} ticked {tickedCount === 1 ? 'item' : 'items'}
                    </Text>
                  </Pressable>
                ) : null}
                {hiddenTicked ? null : (
                  <BlockView
                    ref={(input) => {
                      if (input) inputs.current.set(block.id, input);
                      else inputs.current.delete(block.id);
                    }}
                    block={block}
                    number={numbers.get(block.id) ?? 1}
                    palette={palette}
                    wash={fill}
                    vault={vault}
                    onChange={update}
                    onSplit={split}
                    onBackspaceEmpty={backspaceEmpty}
                    onFocus={() => setFocusId(block.id)}
                    onOpenImage={(image) => {
                      Keyboard.dismiss();
                      setViewing(image);
                    }}
                    onBlockMenu={() => {
                      Keyboard.dismiss();
                      setFocusId(block.id);
                      setSheet({ block: block.id });
                    }}
                  />
                )}
              </View>
            );
          })}

          {/* Keep's "+ List item": a target below the last checklist line. */}
          {blocks.some((b) => b.type === 'check') ? (
            <Pressable
              onPress={() => {
                const lastCheck = [...blocks].reverse().find((b) => b.type === 'check');
                const item = checkBlock('', false);
                touch();
                setBlocks((current) => {
                  const at = lastCheck ? current.findIndex((b) => b.id === lastCheck.id) : current.length - 1;
                  const copy = [...current];
                  copy.splice(at + 1, 0, item);
                  return copy;
                });
                setPendingFocus(item.id);
              }}
              style={styles.addItem}
            >
              <Text style={[styles.addItemText, { color: palette.dim }]}>＋  List item</Text>
            </Pressable>
          ) : null}

          {labelIds.size > 0 || dueOn !== '' ? (
            <View style={styles.chips}>
              {dueOn !== '' ? (
                <Pressable onPress={() => setSheet('reminder')} style={[styles.chip, { backgroundColor: fill }]}>
                  <Text style={[styles.chipText, { color: palette.text }]}>
                    {notify ? '🔔' : '🕒'} {dueOn}
                  </Text>
                </Pressable>
              ) : null}
              {labels
                .filter((label) => labelIds.has(label.id))
                .map((label) => (
                  <Pressable
                    key={label.id}
                    onPress={() => setSheet('labels')}
                    style={[styles.chip, { backgroundColor: fill }]}
                  >
                    <Text style={[styles.chipText, { color: palette.text }]}>{label.name}</Text>
                  </Pressable>
                ))}
            </View>
          ) : null}

          {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
        </ScrollView>

        {/* The bottom bar: add, format, colour … when it was edited … more. */}
        <View style={[styles.toolbar, { borderColor: fill }]}>
          <IconButton
            glyph="＋"
            label="Add"
            onPress={() => {
              void clipboardHasImage().then(setCanPaste);
              setSheet('add');
            }}
            colour={palette.text}
          />
          <IconButton
            glyph="Aa"
            label="Format"
            faded={!focused || !isTextual(focused)}
            onPress={() => {
              if (focused && isTextual(focused)) setSheet('format');
            }}
            colour={palette.text}
          />
          <IconButton glyph="🎨" label="Colour" onPress={() => setSheet('colour')} colour={palette.text} />
          <Text style={[styles.edited, { color: palette.dim }]} numberOfLines={1}>
            {editedAt ? `Edited ${describeEdited(editedAt)}` : ''}
          </Text>
          <IconButton
            glyph="⋮"
            label="More"
            onPress={() => {
              Keyboard.dismiss();
              setSheet('more');
            }}
            colour={palette.text}
          />
        </View>

        {sheet !== null ? (
          <Pressable style={styles.backdrop} onPress={() => setSheet(null)}>
            <Pressable style={[styles.sheet, { backgroundColor: palette.surface }]} onPress={() => undefined}>
              <View style={[styles.grabber, { backgroundColor: palette.border }]} />

              {sheet === 'add' ? (
                <>
                  <SheetRow glyph="☑" label="Checklist" palette={palette} onPress={() => addFromMenu('check')} />
                  <SheetRow glyph="🖼" label="Image from gallery" palette={palette} onPress={() => void insertImage('library')} />
                  <SheetRow glyph="📷" label="Take photo" palette={palette} onPress={() => void insertImage('camera')} />
                  <SheetRow
                    glyph="📋"
                    label={canPaste ? 'Paste image' : 'Paste image (copy one first)'}
                    palette={palette}
                    disabled={!canPaste}
                    onPress={() => void insertImage('clipboard')}
                  />
                  <SheetRow glyph="▦" label="Table" palette={palette} onPress={() => addFromMenu('table')} />
                  <SheetRow glyph="H" label="Heading" palette={palette} onPress={() => addFromMenu('h1')} />
                  <SheetRow glyph="•" label="Bulleted list" palette={palette} onPress={() => addFromMenu('bullet')} />
                  <SheetRow glyph="1." label="Numbered list" palette={palette} onPress={() => addFromMenu('numbered')} />
                  <SheetRow glyph="—" label="Divider" palette={palette} onPress={() => addFromMenu('divider')} />
                </>
              ) : null}

              {sheet === 'format' && focused && isTextual(focused) ? (
                <>
                  <View style={styles.formatGrid}>
                    {(
                      [
                        ['body', 'Text'],
                        ['h1', 'Heading'],
                        ['h2', 'Subheading'],
                        ['quote', 'Quote'],
                        ['bullet', '• List'],
                        ['numbered', '1. List'],
                        ['check', '☑ Checklist'],
                      ] as const
                    ).map(([to, label]) => {
                      const active =
                        focused.type === 'text' ? focused.style === to : focused.type === to;
                      return (
                        <Pressable
                          key={to}
                          onPress={() => format(to)}
                          style={[
                            styles.formatOption,
                            { backgroundColor: active ? palette.accent : fill },
                          ]}
                        >
                          <Text style={{ color: active ? palette.onAccent : palette.text, fontWeight: '600' }}>
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {focused.type !== 'text' ? (
                    <View style={styles.formatGrid}>
                      <Pressable onPress={() => indent(-1)} style={[styles.formatOption, { backgroundColor: fill }]}>
                        <Text style={{ color: palette.text, fontWeight: '600' }}>⇤ Outdent</Text>
                      </Pressable>
                      <Pressable onPress={() => indent(1)} style={[styles.formatOption, { backgroundColor: fill }]}>
                        <Text style={{ color: palette.text, fontWeight: '600' }}>Indent ⇥</Text>
                      </Pressable>
                    </View>
                  ) : null}
                  <BlockActions
                    palette={palette}
                    onUp={() => move(focused.id, -1)}
                    onDown={() => move(focused.id, 1)}
                    onDelete={() => {
                      remove(focused.id);
                      setSheet(null);
                    }}
                  />
                </>
              ) : null}

              {typeof sheet === 'object' && sheet !== null ? (
                <BlockActions
                  palette={palette}
                  onUp={() => move(sheet.block, -1)}
                  onDown={() => move(sheet.block, 1)}
                  onDelete={() => {
                    remove(sheet.block);
                    setSheet(null);
                  }}
                />
              ) : null}

              {sheet === 'colour' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.swatches}>
                    <Swatch
                      fill={palette.background}
                      selected={colour === null}
                      ring={palette.accent}
                      border={palette.border}
                      mark="⊘"
                      markColour={palette.dim}
                      onPress={() => {
                        touch();
                        setColour(null);
                      }}
                    />
                    {NOTE_COLOURS.map((name) => (
                      <Swatch
                        key={name}
                        fill={noteShades[scheme][name] ?? palette.surface}
                        selected={colour === name}
                        ring={palette.accent}
                        border="transparent"
                        mark={colour === name ? '✓' : ''}
                        markColour={palette.text}
                        onPress={() => {
                          touch();
                          setColour(name);
                        }}
                      />
                    ))}
                  </View>
                </ScrollView>
              ) : null}

              {sheet === 'reminder' ? (
                <View style={styles.sheetBody}>
                  <Text style={[styles.sheetTitle, { color: palette.text }]}>Date</Text>
                  <DateField
                    value={dueOn}
                    onChange={(next) => {
                      touch();
                      setDueOn(next);
                      if (next === '') setNotify(false);
                    }}
                    placeholder="No date"
                    palette={palette}
                  />
                  {dueOn !== '' ? (
                    <Switch
                      label="Notify me on the day"
                      detail="Off: the date only shows on the card."
                      value={notify}
                      onChange={(next) => {
                        touch();
                        setNotify(next);
                      }}
                      palette={palette}
                      fill={fill}
                    />
                  ) : null}
                </View>
              ) : null}

              {sheet === 'labels' ? (
                <LabelPicker
                  labels={labels}
                  selected={labelIds}
                  palette={palette}
                  fill={fill}
                  onToggle={(id) => {
                    touch();
                    setLabelIds((current) => {
                      const next = new Set(current);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    });
                  }}
                  onCreate={(name) => {
                    const label = mutate((v) => v.notes.ensureLabel(name));
                    if (!label) return;
                    touch();
                    setLabelIds((current) => new Set(current).add(label.id));
                  }}
                />
              ) : null}

              {sheet === 'more' ? (
                <>
                  <SheetRow glyph="🏷" label="Labels" palette={palette} onPress={() => setSheet('labels')} />
                  <SheetRow
                    glyph="↧"
                    label={checkedLast ? 'Keep ticked items in place' : 'Move ticked items to the bottom'}
                    palette={palette}
                    onPress={() => {
                      touch();
                      setCheckedLast((c) => !c);
                      setSheet(null);
                    }}
                  />
                  {blocks.some((b) => b.type === 'check') ? (
                    <SheetRow
                      glyph="☐"
                      label="Untick all items"
                      palette={palette}
                      onPress={() => {
                        touch();
                        setBlocks((current) =>
                          current.map((b) => (b.type === 'check' ? { ...b, checked: false } : b)),
                        );
                        setSheet(null);
                      }}
                    />
                  ) : null}
                  <SheetRow
                    glyph="✓"
                    label={done ? 'Mark as not done' : 'Mark as done'}
                    palette={palette}
                    onPress={() => {
                      touch();
                      setDone((d) => !d);
                      setSheet(null);
                    }}
                  />
                  <SheetRow
                    glyph="⧉"
                    label="Make a copy"
                    palette={palette}
                    onPress={() => {
                      persist(false);
                      const id = savedId.current;
                      if (id) mutate((v) => v.notes.duplicateNote(id));
                      setSheet(null);
                      close();
                    }}
                  />
                  <SheetRow
                    glyph="🗑"
                    label="Delete note"
                    palette={palette}
                    danger
                    onPress={() => {
                      setSheet(null);
                      Alert.alert('Delete this note?', 'Its images are deleted with it.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Delete',
                          style: 'destructive',
                          onPress: () => {
                            closed.current = true;
                            const id = savedId.current;
                            mutate((v) => {
                              if (id) removeReleased(v.notes.deleteNote(id));
                              removeReleased(v.notes.releaseUnused(addedFiles.current));
                            });
                            onClose();
                          },
                        },
                      ]);
                    }}
                  />
                </>
              ) : null}
            </Pressable>
          </Pressable>
        ) : null}

        {viewing ? <ImageViewer block={viewing} onClose={() => setViewing(null)} /> : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function describeEdited(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function ImageViewer({ block, onClose }: { block: ImageBlock; onClose: () => void }) {
  const { vault } = useOpenVault();
  const state = useNoteImage(vault, block.fileId);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.viewer} onPress={onClose}>
        {state.status === 'ready' ? (
          <Image source={{ uri: state.uri }} style={styles.viewerImage} resizeMode="contain" />
        ) : (
          <Text style={styles.viewerText}>{state.status === 'missing' ? state.reason : ''}</Text>
        )}
        {block.caption ? <Text style={styles.viewerText}>{block.caption}</Text> : null}
      </Pressable>
    </Modal>
  );
}

function IconButton({
  glyph,
  label,
  onPress,
  colour,
  faded,
  fill,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  colour: string;
  faded?: boolean;
  fill?: string | undefined;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.iconButton,
        fill ? { backgroundColor: fill } : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.iconGlyph, { color: colour, opacity: faded ? 0.45 : 1 }]}>{glyph}</Text>
    </Pressable>
  );
}

function SheetRow({
  glyph,
  label,
  onPress,
  palette,
  disabled,
  danger,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  palette: ReturnType<typeof paletteFor>;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.sheetRow, pressed ? { backgroundColor: palette.key } : null]}
    >
      <Text style={[styles.sheetGlyph, { color: danger ? palette.danger : palette.text, opacity: disabled ? 0.4 : 1 }]}>
        {glyph}
      </Text>
      <Text style={{ color: danger ? palette.danger : palette.text, fontSize: typeScale.md, opacity: disabled ? 0.4 : 1 }}>
        {label}
      </Text>
    </Pressable>
  );
}

function BlockActions({
  palette,
  onUp,
  onDown,
  onDelete,
}: {
  palette: ReturnType<typeof paletteFor>;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
}) {
  return (
    <>
      <SheetRow glyph="↑" label="Move up" palette={palette} onPress={onUp} />
      <SheetRow glyph="↓" label="Move down" palette={palette} onPress={onDown} />
      <SheetRow glyph="🗑" label="Remove this block" palette={palette} danger onPress={onDelete} />
    </>
  );
}

function Swatch({
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

function Switch({
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
  palette: ReturnType<typeof paletteFor>;
  fill: string;
}) {
  return (
    <Pressable onPress={() => onChange(!value)} style={[styles.toggle, { backgroundColor: fill }]}>
      <View style={{ flexShrink: 1 }}>
        <Text style={{ color: palette.text, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: palette.dim, fontSize: typeScale.xs, marginTop: 2 }}>{detail}</Text>
      </View>
      <View style={[styles.switch, { backgroundColor: value ? palette.accent : palette.key }]}>
        <View style={[styles.knob, { alignSelf: value ? 'flex-end' : 'flex-start' }]} />
      </View>
    </Pressable>
  );
}

function LabelPicker({
  labels,
  selected,
  palette,
  fill,
  onToggle,
  onCreate,
}: {
  labels: { id: string; name: string }[];
  selected: Set<string>;
  palette: ReturnType<typeof paletteFor>;
  fill: string;
  onToggle: (id: string) => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const exists = labels.some((label) => label.name.toLowerCase() === name.trim().toLowerCase());
  return (
    <View style={styles.sheetBody}>
      <Text style={[styles.sheetTitle, { color: palette.text }]}>Labels</Text>
      <View style={[styles.labelInputRow, { backgroundColor: fill }]}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="New label"
          placeholderTextColor={palette.textFaint}
          style={[styles.labelInput, { color: palette.text }]}
          onSubmitEditing={() => {
            if (name.trim() !== '' && !exists) {
              onCreate(name);
              setName('');
            }
          }}
        />
        {name.trim() !== '' && !exists ? (
          <Pressable
            onPress={() => {
              onCreate(name);
              setName('');
            }}
          >
            <Text style={{ color: palette.accent, fontWeight: '700' }}>Create</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView style={{ maxHeight: 260 }} keyboardShouldPersistTaps="handled">
        {labels
          .filter((label) => name.trim() === '' || label.name.toLowerCase().includes(name.trim().toLowerCase()))
          .map((label) => (
            <Pressable key={label.id} onPress={() => onToggle(label.id)} style={styles.labelRow}>
              <Text style={{ color: palette.text, fontSize: typeScale.md }}>🏷  {label.name}</Text>
              <Text style={{ color: palette.accent, fontSize: typeScale.lg }}>{selected.has(label.id) ? '☑' : '☐'}</Text>
            </Pressable>
          ))}
        {labels.length === 0 ? (
          <Text style={{ color: palette.dim }}>No labels yet. Type a name above to make one.</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 40 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
  },
  headRight: { flexDirection: 'row', gap: spacing.xs },
  iconButton: {
    minWidth: 42,
    height: 42,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  iconGlyph: { fontSize: 20, fontWeight: '600' },
  pressed: { transform: [{ scale: 0.97 }] },

  page: { paddingHorizontal: spacing.xl, paddingBottom: 120, gap: 2 },
  title: { fontSize: 22, lineHeight: 30, fontWeight: '600', paddingVertical: spacing.sm },

  tickedHead: { paddingVertical: spacing.sm, marginTop: spacing.xs },
  tickedText: { fontSize: typeScale.sm, fontWeight: '600' },
  addItem: { paddingVertical: spacing.sm, paddingLeft: 2 },
  addItemText: { fontSize: typeScale.md },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.lg },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 5, borderRadius: radii.pill },
  chipText: { fontSize: typeScale.sm, fontWeight: '500' },
  error: { marginTop: spacing.md, fontWeight: '600' },

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    paddingBottom: 28,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  edited: { flex: 1, textAlign: 'center', fontSize: typeScale.xs },

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
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  sheetGlyph: { width: 26, textAlign: 'center', fontSize: 18, fontWeight: '600' },
  sheetBody: { padding: spacing.sm, gap: spacing.md },
  sheetTitle: { fontSize: typeScale.md, fontWeight: '700' },

  formatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, padding: spacing.sm },
  formatOption: { paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: radii.pill },

  swatches: { flexDirection: 'row', gap: spacing.sm, padding: spacing.sm },
  swatch: { width: 40, height: 40, borderRadius: radii.pill, alignItems: 'center', justifyContent: 'center' },
  swatchMark: { fontSize: 15, fontWeight: '800' },

  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.md,
  },
  switch: { width: 48, height: 28, borderRadius: radii.pill, padding: 3, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: radii.pill, backgroundColor: '#fff' },

  labelInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  labelInput: { flex: 1, fontSize: typeScale.md, paddingVertical: 10 },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },

  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  viewerImage: { width: '100%', height: '85%' },
  viewerText: { color: '#fff', fontSize: typeScale.md, textAlign: 'center' },
});
