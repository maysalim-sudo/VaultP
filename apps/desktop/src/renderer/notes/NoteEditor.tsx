/**
 * Editing a note on the desktop — the same note, the same blocks, as the phone.
 *
 * A card over the page in the note's own colour: title, blocks, and a toolbar
 * along the bottom. It saves as you type and closes with Escape or a click
 * outside, as Keep's does; a note left empty is discarded.
 *
 * A keyboard makes a few things easier than on the phone, so they are here:
 * Enter splits the line at the caret and Shift+Enter breaks within it;
 * Backspace at the start of a line joins it to the one above; Tab indents a list
 * item; the arrow keys move between lines; typing "- ", "[] ", "1. ", "# ",
 * "## " or "> " at the start of a line turns it into that kind of line; and an
 * image can be pasted or dropped straight in.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import {
  NOTE_COLOURS,
  addColumn,
  addRow,
  checkBlock,
  convertBlock,
  displayOrder,
  dividerBlock,
  fromPlainText,
  imageBlock,
  isContentEmpty,
  isTextual,
  listBlock,
  moveBlock,
  removeColumn,
  removeRow,
  setCell,
  tableBlock,
  textBlock,
  type Block,
  type CheckBlock,
  type ImageBlock,
  type ListBlock,
  type NoteColour,
  type TableBlock,
  type TextBlock,
  type TextStyle,
} from '@vaultp/core';

import type { NoteDto, NoteFolderDto, NoteImageDto, NoteInputDto, TagDto } from '../../shared/api.js';
import { Glyph } from '../icons.js';
import { api, invalidate, messageOf } from '../vault.js';
import { imageSize, useNoteImage } from './images.js';

type Textual = TextBlock | ListBlock | CheckBlock;
type Caret = number | 'start' | 'end';

export type EditorStart =
  | { kind: 'existing'; note: NoteDto }
  | {
      kind: 'new';
      with?: 'text' | 'checklist' | 'image' | 'clipboard-image';
      folderId?: string | null;
      text?: string;
    };

type Menu = null | 'add' | 'format' | 'colour' | 'folder' | 'labels' | 'reminder' | 'more';

const FORMATS: ReadonlyArray<readonly [TextStyle | 'bullet' | 'numbered' | 'check', string]> = [
  ['body', 'Text'],
  ['h1', 'Heading'],
  ['h2', 'Subheading'],
  ['quote', 'Quote'],
  ['bullet', '• Bulleted list'],
  ['numbered', '1. Numbered list'],
  ['check', '☐ Checklist'],
];

/** Typed at the start of a plain line, these turn it into that kind of line. */
const SHORTCUTS: ReadonlyArray<readonly [RegExp, TextStyle | 'bullet' | 'numbered' | 'check']> = [
  [/^\[\s?\]\s/, 'check'],
  [/^[-*]\s/, 'bullet'],
  [/^1[.)]\s/, 'numbered'],
  [/^##\s/, 'h2'],
  [/^#\s/, 'h1'],
  [/^>\s/, 'quote'],
];

export function noteBackground(colour: NoteColour | null): string {
  return colour ? `var(--note-${colour})` : 'var(--surface-raised)';
}

export function NoteEditor({
  start,
  folders,
  labels,
  onClose,
}: {
  start: EditorStart;
  folders: readonly NoteFolderDto[];
  labels: readonly TagDto[];
  onClose: () => void;
}) {
  const existing = start.kind === 'existing' ? start.note : null;

  const [title, setTitle] = useState(existing?.title ?? '');
  const [blocks, setBlocks] = useState<Block[]>(() => {
    if (existing) return existing.content.blocks.length > 0 ? [...existing.content.blocks] : [textBlock()];
    if (start.kind === 'new' && start.text) return [...fromPlainText(start.text).blocks, textBlock()];
    return [start.kind === 'new' && start.with === 'checklist' ? checkBlock() : textBlock()];
  });
  const [checkedLast, setCheckedLast] = useState(existing?.content.checkedLast ?? false);
  const [colour, setColour] = useState<NoteColour | null>(existing?.colour ?? null);
  const [pinned, setPinned] = useState(existing?.pinned ?? false);
  const [archived, setArchived] = useState(existing?.archived ?? false);
  const [dueOn, setDueOn] = useState(existing?.dueOn ?? '');
  const [remind, setRemind] = useState(existing?.remind ?? false);
  const [done, setDone] = useState(existing?.done ?? false);
  const [folderId, setFolderId] = useState<string | null>(
    existing ? existing.folderId : start.kind === 'new' ? (start.folderId ?? null) : null,
  );
  const [labelIds, setLabelIds] = useState<string[]>(existing?.labels.map((l) => l.id) ?? []);
  const [knownLabels, setKnownLabels] = useState<readonly TagDto[]>(labels);

  const [menu, setMenu] = useState<Menu>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pendingFocus, setPendingFocus] = useState<{ id: string; caret: Caret } | null>(null);
  const [viewing, setViewing] = useState<ImageBlock | null>(null);
  const [showTicked, setShowTicked] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(existing?.updatedAt ?? null);
  const [newLabel, setNewLabel] = useState('');

  const inputs = useRef(new Map<string, HTMLTextAreaElement>());
  const savedId = useRef<string | null>(existing?.id ?? null);
  const addedFiles = useRef<string[]>([]);
  const dirty = useRef(start.kind === 'new' && Boolean(start.text));
  const closed = useRef(false);
  const saving = useRef<Promise<void>>(Promise.resolve());

  const state = { title, blocks, checkedLast, colour, pinned, archived, dueOn, remind, done, folderId, labelIds };
  const latest = useRef(state);
  latest.current = state;

  // ----------------------------------------------------------------- saving

  function input(): NoteInputDto {
    const s = latest.current;
    return {
      title: s.title,
      content: { blocks: s.blocks, checkedLast: s.checkedLast },
      colour: s.colour,
      pinned: s.pinned,
      archived: s.archived,
      dueOn: s.dueOn,
      remind: s.dueOn ? s.remind : false,
      folderId: s.folderId,
      labelIds: s.labelIds,
    };
  }

  /** Saves run one after another, so a slow one never lands after a later one. */
  function persist(final: boolean): Promise<void> {
    saving.current = saving.current.then(async () => {
      const data = input();
      const empty = data.title.trim() === '' && isContentEmpty(data.content);
      if (empty && !final) return;

      try {
        if (savedId.current === null) {
          if (empty) return;
          const { id } = await api().addNote(data);
          savedId.current = id;
          if (latest.current.done) await api().setNoteDone(id, true);
        } else if (empty) {
          // Keep's rule: a note emptied and left is gone, not a blank card.
          await api().deleteNote(savedId.current);
        } else {
          await api().saveNote(savedId.current, data);
          if (existing && latest.current.done !== existing.done) {
            await api().setNoteDone(savedId.current, latest.current.done);
          }
        }
        dirty.current = false;
        setSavedAt(new Date().toISOString());
        invalidate();
      } catch (caught: unknown) {
        setError(messageOf(caught));
      }
    });
    return saving.current;
  }

  async function close() {
    if (closed.current) return;
    closed.current = true;
    if (dirty.current) await persist(true);
    // Images added while editing and then removed (or a discarded note's) are
    // referenced by nothing; let them go now rather than leave orphans.
    if (addedFiles.current.length > 0) await api().releaseNoteImages(addedFiles.current).catch(() => undefined);
    invalidate();
    onClose();
  }

  const touch = () => {
    dirty.current = true;
  };

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => void persist(false), 700);
    return () => clearTimeout(timer);
  }, [title, blocks, checkedLast, colour, pinned, archived, dueOn, remind, done, folderId, labelIds]);

  // Escape closes, unless a menu is open — then it closes the menu.
  const menuRef = useRef(menu);
  menuRef.current = menu;
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (viewing) setViewing(null);
      else if (menuRef.current) setMenu(null);
      else void close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (start.kind === 'new' && start.with === 'image') void insertImage('file');
    if (start.kind === 'new' && start.with === 'clipboard-image') void insertImage('clipboard');
  }, []);

  useLayoutEffect(() => {
    if (!pendingFocus) return;
    const element = inputs.current.get(pendingFocus.id);
    if (!element) return;
    element.focus();
    const at =
      pendingFocus.caret === 'start' ? 0 : pendingFocus.caret === 'end' ? element.value.length : pendingFocus.caret;
    element.setSelectionRange(at, at);
    setPendingFocus(null);
  }, [pendingFocus, blocks]);

  // ------------------------------------------------------------ block edits

  function update(next: Block) {
    touch();
    setBlocks((current) => current.map((block) => (block.id === next.id ? next : block)));
  }

  function insert(newBlocks: Block[], focus?: string) {
    touch();
    setBlocks((current) => {
      const at = focusId ? current.findIndex((block) => block.id === focusId) : -1;
      const here = at === -1 ? undefined : current[at];
      const replaceHere = here?.type === 'text' && here.text === '' && here.style === 'body';
      const next = [...current];
      next.splice(at === -1 ? next.length : replaceHere ? at : at + 1, replaceHere ? 1 : 0, ...newBlocks);
      const last = next[next.length - 1];
      if (last && !isTextual(last)) next.push(textBlock());
      return next;
    });
    if (focus) setPendingFocus({ id: focus, caret: 'start' });
  }

  function remove(id: string) {
    touch();
    setBlocks((current) => {
      const next = current.filter((block) => block.id !== id);
      return next.length > 0 ? next : [textBlock()];
    });
  }

  function move(id: string, by: number) {
    touch();
    setBlocks((current) => {
      const at = current.findIndex((block) => block.id === id);
      return at === -1 ? current : moveBlock(current, at, at + by);
    });
  }

  function neighbour(id: string, direction: -1 | 1): Textual | undefined {
    const ordered = displayOrder({ blocks, checkedLast });
    const at = ordered.findIndex((block) => block.id === id);
    const pool = direction < 0 ? ordered.slice(0, at).reverse() : ordered.slice(at + 1);
    return pool.find(isTextual);
  }

  function changeText(block: Textual, value: string) {
    // Markdown-ish shortcuts at the start of a plain line.
    if (block.type === 'text' && block.style === 'body') {
      for (const [pattern, to] of SHORTCUTS) {
        if (pattern.test(value)) {
          update({ ...convertBlock(block, to), text: value.replace(pattern, '') });
          setPendingFocus({ id: block.id, caret: 'start' });
          return;
        }
      }
    }
    update({ ...block, text: value });
  }

  function keyDown(block: Textual, event: KeyboardEvent<HTMLTextAreaElement>) {
    const element = event.currentTarget;
    const caret = element.selectionStart;
    const collapsed = element.selectionStart === element.selectionEnd;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      // Enter on an empty list item leaves the list.
      if (block.type !== 'text' && block.text === '') {
        update(convertBlock(block, 'body'));
        return;
      }
      const before = block.text.slice(0, caret);
      const after = block.text.slice(element.selectionEnd);
      const next: Block =
        block.type === 'check'
          ? checkBlock(after, false, block.indent)
          : block.type === 'bullet' || block.type === 'numbered'
            ? listBlock(block.type, after, block.indent)
            : textBlock(after);
      touch();
      setBlocks((current) => {
        const at = current.findIndex((b) => b.id === block.id);
        const copy = [...current];
        copy[at] = { ...block, text: before };
        copy.splice(at + 1, 0, next);
        return copy;
      });
      setPendingFocus({ id: next.id, caret: 'start' });
      return;
    }

    if (event.key === 'Backspace' && collapsed && caret === 0) {
      if (block.type !== 'text' && block.indent > 0) {
        event.preventDefault();
        update({ ...block, indent: 0 });
        return;
      }
      if (block.type !== 'text' || block.style !== 'body') {
        event.preventDefault();
        update(convertBlock(block, 'body'));
        return;
      }
      const previous = neighbour(block.id, -1);
      if (!previous) return;
      event.preventDefault();
      // Join this line onto the end of the one above.
      const join = previous.text.length;
      touch();
      setBlocks((current) =>
        current
          .filter((b) => b.id !== block.id)
          .map((b) => (b.id === previous.id ? { ...previous, text: previous.text + block.text } : b)),
      );
      setPendingFocus({ id: previous.id, caret: join });
      return;
    }

    if (event.key === 'Tab' && block.type !== 'text') {
      event.preventDefault();
      update({ ...block, indent: event.shiftKey ? 0 : 1 });
      return;
    }

    if (event.key === 'ArrowUp' && collapsed && caret === 0) {
      const previous = neighbour(block.id, -1);
      if (previous) {
        event.preventDefault();
        setPendingFocus({ id: previous.id, caret: 'end' });
      }
    }
    if (event.key === 'ArrowDown' && collapsed && caret === element.value.length) {
      const next = neighbour(block.id, 1);
      if (next) {
        event.preventDefault();
        setPendingFocus({ id: next.id, caret: 'start' });
      }
    }
  }

  function format(to: TextStyle | 'bullet' | 'numbered' | 'check') {
    const block = blocks.find((b) => b.id === focusId);
    setMenu(null);
    if (!block || !isTextual(block)) {
      // Nothing focused: add a fresh line of that kind instead.
      const fresh =
        to === 'check' ? checkBlock() : to === 'bullet' || to === 'numbered' ? listBlock(to) : textBlock('', to);
      insert([fresh], fresh.id);
      return;
    }
    update(convertBlock(block, to));
    setPendingFocus({ id: block.id, caret: 'end' });
  }

  async function insertImage(source: 'file' | 'clipboard' | Blob) {
    setMenu(null);
    setError(null);
    try {
      let added: NoteImageDto | undefined;
      if (source === 'file') added = await api().noteImageFromFile();
      else if (source === 'clipboard') added = await api().noteImageFromClipboard();
      else {
        const size = await imageSize(source);
        added = await api().noteImageFromBytes(
          new Uint8Array(await source.arrayBuffer()),
          source.type,
          size.width,
          size.height,
        );
      }
      if (!added) return;
      addedFiles.current.push(added.fileId);
      insert([imageBlock(added.fileId, added)]);
    } catch (caught: unknown) {
      setError(messageOf(caught));
    }
  }

  function imageFrom(items: DataTransferItemList | undefined): File | null {
    for (const item of Array.from(items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
    }
    return null;
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

  const tickedStarts = useMemo(() => {
    const starts = new Map<string, number>();
    if (!checkedLast) return starts;
    ordered.forEach((block, i) => {
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
    });
    return starts;
  }, [ordered, checkedLast]);

  const toggleMenu = (next: Menu) => setMenu((current) => (current === next ? null : next));

  return (
    <div className="backdrop note-backdrop" onMouseDown={() => void close()}>
      <div
        className="note-editor"
        style={{ background: noteBackground(colour) }}
        onMouseDown={(event) => event.stopPropagation()}
        onPaste={(event) => {
          const image = imageFrom(event.clipboardData.items);
          if (image) {
            event.preventDefault();
            void insertImage(image);
          }
        }}
        onDragOver={(event) => {
          if (Array.from(event.dataTransfer.items).some((i) => i.type.startsWith('image/'))) event.preventDefault();
        }}
        onDrop={(event) => {
          const image = imageFrom(event.dataTransfer.items);
          if (image) {
            event.preventDefault();
            void insertImage(image);
          }
        }}
      >
        <div className="note-editor-scroll">
          <div className="note-title-row">
            <textarea
              className="note-title"
              value={title}
              rows={1}
              placeholder="Title"
              onChange={(event) => {
                touch();
                setTitle(event.target.value.replace(/\n/g, ' '));
              }}
              onFocus={() => setFocusId(null)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const first = ordered.find(isTextual);
                  if (first) setPendingFocus({ id: first.id, caret: 'start' });
                }
              }}
              ref={autoGrow}
            />
            <button
              className={`icon-btn ${pinned ? 'on' : ''}`}
              title={pinned ? 'Unpin' : 'Pin'}
              onClick={() => {
                touch();
                setPinned((p) => !p);
                if (!pinned) setArchived(false);
              }}
            >
              <Glyph glyph="📌" size={18} />
            </button>
          </div>

          <div className="note-blocks">
            {ordered.map((block) => {
              const ticked = tickedStarts.get(block.id);
              const hidden = checkedLast && !showTicked && block.type === 'check' && block.checked;
              return (
                <div key={block.id}>
                  {ticked !== undefined ? (
                    <button className="ticked-head" onClick={() => setShowTicked((s) => !s)}>
                      {showTicked ? '⌄' : '›'} {ticked} ticked {ticked === 1 ? 'item' : 'items'}
                    </button>
                  ) : null}
                  {hidden ? null : (
                    <BlockRow
                      block={block}
                      number={numbers.get(block.id) ?? 1}
                      inputRef={(element) => {
                        if (element) inputs.current.set(block.id, element);
                        else inputs.current.delete(block.id);
                      }}
                      onChange={update}
                      onText={changeText}
                      onKey={keyDown}
                      onFocus={() => setFocusId(block.id)}
                      onOpenImage={setViewing}
                      onMove={(by) => move(block.id, by)}
                      onRemove={() => remove(block.id)}
                    />
                  )}
                </div>
              );
            })}

            {blocks.some((b) => b.type === 'check') ? (
              <button
                className="add-item"
                onClick={() => {
                  const lastCheck = [...blocks].reverse().find((b) => b.type === 'check');
                  const item = checkBlock();
                  touch();
                  setBlocks((current) => {
                    const at = lastCheck ? current.findIndex((b) => b.id === lastCheck.id) : current.length - 1;
                    const copy = [...current];
                    copy.splice(at + 1, 0, item);
                    return copy;
                  });
                  setPendingFocus({ id: item.id, caret: 'start' });
                }}
              >
                ＋ List item
              </button>
            ) : null}
          </div>

          {dueOn || labelIds.length > 0 || folderId ? (
            <div className="note-chips">
              {dueOn ? (
                <button className="chip" onClick={() => toggleMenu('reminder')}>
                  <Glyph glyph={remind ? '🔔' : '🕒'} size={12} /> {dueOn}
                </button>
              ) : null}
              {folderId ? (
                <button className="chip" onClick={() => toggleMenu('folder')}>
                  <Glyph glyph="📁" size={12} /> {folders.find((f) => f.id === folderId)?.name ?? 'Folder'}
                </button>
              ) : null}
              {knownLabels
                .filter((label) => labelIds.includes(label.id))
                .map((label) => (
                  <button key={label.id} className="chip" onClick={() => toggleMenu('labels')}>
                    {label.name}
                  </button>
                ))}
            </div>
          ) : null}

          {error ? <p className="error">{error}</p> : null}
        </div>

        <div className="note-toolbar">
          <ToolButton glyph="＋" title="Add" active={menu === 'add'} onClick={() => toggleMenu('add')} />
          <ToolButton glyph="Aa" title="Format" active={menu === 'format'} onClick={() => toggleMenu('format')} />
          <ToolButton glyph="🎨" title="Colour" active={menu === 'colour'} onClick={() => toggleMenu('colour')} />
          <ToolButton glyph="🔔" title="Reminder" active={menu === 'reminder'} onClick={() => toggleMenu('reminder')} />
          <ToolButton glyph="📁" title="Folder" active={menu === 'folder'} onClick={() => toggleMenu('folder')} />
          <ToolButton glyph="🏷" title="Labels" active={menu === 'labels'} onClick={() => toggleMenu('labels')} />
          <ToolButton
            glyph="🗄"
            title={archived ? 'Unarchive' : 'Archive'}
            active={archived}
            onClick={() => {
              touch();
              const next = !archived;
              setArchived(next);
              if (next) {
                setPinned(false);
                latest.current = { ...latest.current, archived: true, pinned: false };
                void close();
              }
            }}
          />
          <ToolButton glyph="⋮" title="More" active={menu === 'more'} onClick={() => toggleMenu('more')} />
          <span className="spacer" />
          <span className="muted small">{savedAt ? `Edited ${describeEdited(savedAt)}` : ''}</span>
          <button className="secondary close-note" onClick={() => void close()}>
            Close
          </button>

          {menu ? (
            <div className="note-menu" onMouseDown={(event) => event.stopPropagation()}>
              {menu === 'add' ? (
                <>
                  <MenuItem glyph="☑" label="Checklist" onClick={() => format('check')} />
                  <MenuItem glyph="🖼" label="Image from a file…" onClick={() => void insertImage('file')} />
                  <MenuItem glyph="📋" label="Paste image (or press Ctrl+V)" onClick={() => void insertImage('clipboard')} />
                  <MenuItem
                    glyph="▦"
                    label="Table"
                    onClick={() => {
                      setMenu(null);
                      insert([tableBlock(3, 3)]);
                    }}
                  />
                  <MenuItem glyph="H" label="Heading" onClick={() => format('h1')} />
                  <MenuItem glyph="•" label="Bulleted list" onClick={() => format('bullet')} />
                  <MenuItem glyph="1." label="Numbered list" onClick={() => format('numbered')} />
                  <MenuItem
                    glyph="—"
                    label="Divider"
                    onClick={() => {
                      setMenu(null);
                      insert([dividerBlock()]);
                    }}
                  />
                </>
              ) : null}

              {menu === 'format' ? (
                <>
                  <p className="menu-hint">
                    {focused && isTextual(focused) ? 'Turn this line into' : 'Add a line of'}
                  </p>
                  <div className="format-grid">
                    {FORMATS.map(([to, label]) => {
                      const active =
                        focused && isTextual(focused)
                          ? focused.type === 'text'
                            ? focused.style === to
                            : focused.type === to
                          : false;
                      return (
                        <button key={to} className={`tag ${active ? 'on' : ''}`} onClick={() => format(to)}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="menu-hint">Tip: type “- ”, “[] ”, “1. ”, “# ” or “&gt; ” at the start of a line.</p>
                </>
              ) : null}

              {menu === 'colour' ? (
                <div className="swatches">
                  <button
                    className={`swatch ${colour === null ? 'on' : ''}`}
                    style={{ background: 'var(--surface-raised)' }}
                    title="Default"
                    onClick={() => {
                      touch();
                      setColour(null);
                    }}
                  >
                    ⊘
                  </button>
                  {NOTE_COLOURS.map((name) => (
                    <button
                      key={name}
                      className={`swatch ${colour === name ? 'on' : ''}`}
                      style={{ background: `var(--note-${name})` }}
                      title={name}
                      onClick={() => {
                        touch();
                        setColour(name);
                      }}
                    >
                      {colour === name ? '✓' : ''}
                    </button>
                  ))}
                </div>
              ) : null}

              {menu === 'reminder' ? (
                <div className="menu-form">
                  <label className="field">
                    <span className="muted small">Date</span>
                    <input
                      type="date"
                      value={dueOn}
                      onChange={(event) => {
                        touch();
                        setDueOn(event.target.value);
                        if (event.target.value === '') setRemind(false);
                      }}
                    />
                  </label>
                  {dueOn ? (
                    <label className="row check">
                      <input
                        type="checkbox"
                        checked={remind}
                        onChange={(event) => {
                          touch();
                          setRemind(event.target.checked);
                        }}
                      />
                      <span>Notify me on the day</span>
                    </label>
                  ) : (
                    <p className="muted small">Give it a date to be reminded about it.</p>
                  )}
                  {dueOn ? (
                    <button
                      className="secondary"
                      onClick={() => {
                        touch();
                        setDueOn('');
                        setRemind(false);
                      }}
                    >
                      Remove date
                    </button>
                  ) : null}
                </div>
              ) : null}

              {menu === 'folder' ? (
                <>
                  <MenuItem
                    glyph="🗒"
                    label="No folder"
                    trailing={folderId === null ? '✓' : ''}
                    onClick={() => {
                      touch();
                      setFolderId(null);
                      setMenu(null);
                    }}
                  />
                  {folders.map((folder) => (
                    <MenuItem
                      key={folder.id}
                      glyph="📁"
                      label={folder.name}
                      trailing={folderId === folder.id ? '✓' : ''}
                      onClick={() => {
                        touch();
                        setFolderId(folder.id);
                        setMenu(null);
                      }}
                    />
                  ))}
                  <NewNameRow
                    placeholder="New folder"
                    onCreate={async (name) => {
                      const folder = await api().addNoteFolder(name);
                      touch();
                      setFolderId(folder.id);
                      setMenu(null);
                      invalidate();
                    }}
                  />
                </>
              ) : null}

              {menu === 'labels' ? (
                <>
                  {knownLabels.map((label) => (
                    <MenuItem
                      key={label.id}
                      glyph="🏷"
                      label={label.name}
                      trailing={labelIds.includes(label.id) ? '☑' : '☐'}
                      onClick={() => {
                        touch();
                        setLabelIds((current) =>
                          current.includes(label.id) ? current.filter((id) => id !== label.id) : [...current, label.id],
                        );
                      }}
                    />
                  ))}
                  <NewNameRow
                    placeholder="New label"
                    value={newLabel}
                    onValue={setNewLabel}
                    onCreate={async (name) => {
                      const label = await api().ensureNoteLabel(name);
                      setKnownLabels((current) => (current.some((l) => l.id === label.id) ? current : [...current, label]));
                      touch();
                      setLabelIds((current) => (current.includes(label.id) ? current : [...current, label.id]));
                      setNewLabel('');
                    }}
                  />
                </>
              ) : null}

              {menu === 'more' ? (
                <>
                  <MenuItem
                    glyph="↧"
                    label={checkedLast ? 'Keep ticked items in place' : 'Move ticked items to the bottom'}
                    onClick={() => {
                      touch();
                      setCheckedLast((c) => !c);
                      setMenu(null);
                    }}
                  />
                  {blocks.some((b) => b.type === 'check') ? (
                    <MenuItem
                      glyph="☐"
                      label="Untick all items"
                      onClick={() => {
                        touch();
                        setBlocks((current) => current.map((b) => (b.type === 'check' ? { ...b, checked: false } : b)));
                        setMenu(null);
                      }}
                    />
                  ) : null}
                  <MenuItem
                    glyph="✓"
                    label={done ? 'Mark as not done' : 'Mark as done'}
                    onClick={() => {
                      touch();
                      setDone((d) => !d);
                      setMenu(null);
                    }}
                  />
                  <MenuItem
                    glyph="⧉"
                    label="Make a copy"
                    onClick={async () => {
                      setMenu(null);
                      await persist(false);
                      if (savedId.current) await api().duplicateNote(savedId.current);
                      void close();
                    }}
                  />
                  <MenuItem
                    glyph="🗑"
                    label="Delete note"
                    danger
                    onClick={async () => {
                      setMenu(null);
                      if (!window.confirm('Delete this note? Its images are deleted with it.')) return;
                      closed.current = true;
                      await saving.current;
                      if (savedId.current) await api().deleteNote(savedId.current);
                      if (addedFiles.current.length > 0) await api().releaseNoteImages(addedFiles.current);
                      invalidate();
                      onClose();
                    }}
                  />
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {viewing ? <Lightbox block={viewing} onClose={() => setViewing(null)} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ blocks

function autoGrow(element: HTMLTextAreaElement | null) {
  if (!element) return;
  element.style.height = 'auto';
  element.style.height = `${element.scrollHeight}px`;
}

function BlockRow({
  block,
  number,
  inputRef,
  onChange,
  onText,
  onKey,
  onFocus,
  onOpenImage,
  onMove,
  onRemove,
}: {
  block: Block;
  number: number;
  inputRef: (element: HTMLTextAreaElement | null) => void;
  onChange: (next: Block) => void;
  onText: (block: Textual, value: string) => void;
  onKey: (block: Textual, event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onOpenImage: (block: ImageBlock) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const handle = (
    <div className="block-handle">
      <button title="Move up" onClick={() => onMove(-1)}>
        ↑
      </button>
      <button title="Move down" onClick={() => onMove(1)}>
        ↓
      </button>
      <button title="Remove" onClick={onRemove}>
        ✕
      </button>
    </div>
  );

  if (isTextual(block)) {
    const indent = 'indent' in block ? block.indent : 0;
    const style = block.type === 'text' ? block.style : block.type;
    return (
      <div className={`block block-${style}`} style={{ paddingLeft: indent * 28 }}>
        {block.type === 'check' ? (
          <input
            type="checkbox"
            className="block-check"
            checked={block.checked}
            onChange={() => onChange({ ...block, checked: !block.checked })}
          />
        ) : block.type === 'bullet' ? (
          <span className="block-gutter">{indent > 0 ? '◦' : '•'}</span>
        ) : block.type === 'numbered' ? (
          <span className="block-gutter num">{number}.</span>
        ) : null}
        <textarea
          ref={(element) => {
            inputRef(element);
            autoGrow(element);
          }}
          rows={1}
          value={block.text}
          className={block.type === 'check' && block.checked ? 'checked' : ''}
          placeholder={
            block.type === 'check'
              ? 'List item'
              : block.type === 'text' && block.style === 'h1'
                ? 'Heading'
                : block.type === 'text' && block.style === 'h2'
                  ? 'Subheading'
                  : ''
          }
          onChange={(event) => {
            onText(block, event.target.value);
            autoGrow(event.target);
          }}
          onKeyDown={(event) => onKey(block, event)}
          onFocus={onFocus}
        />
        {handle}
      </div>
    );
  }

  switch (block.type) {
    case 'divider':
      return (
        <div className="block block-divider">
          <hr />
          {handle}
        </div>
      );
    case 'image':
      return (
        <div className="block block-image">
          <NoteImageView block={block} onOpen={() => onOpenImage(block)} />
          <input
            className="caption"
            value={block.caption}
            placeholder="Add a caption"
            onChange={(event) => onChange({ ...block, caption: event.target.value })}
            onFocus={onFocus}
          />
          {handle}
        </div>
      );
    case 'table':
      return <TableEditor block={block} onChange={onChange} onFocus={onFocus} handle={handle} />;
    default:
      return (
        <div className="block block-unknown">
          <span className="muted small">
            Made in a newer version of VaultP — update this app to see it. It is kept as it is.
          </span>
          {handle}
        </div>
      );
  }
}

export function NoteImageView({ block, onOpen, compact }: { block: ImageBlock; onOpen?: () => void; compact?: boolean }) {
  const state = useNoteImage(block.fileId);
  const ratio = block.width && block.height ? `${block.width} / ${block.height}` : '4 / 3';
  if (state.status !== 'ready') {
    return (
      <div className={`image-placeholder ${compact ? 'compact' : ''}`} style={{ aspectRatio: ratio }}>
        {state.status === 'missing' ? (
          <span className="muted small">
            <Glyph glyph="🖼" size={14} /> {state.reason}
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <img
      src={state.url}
      alt={block.caption}
      className={compact ? 'card-image' : 'note-image'}
      style={{ aspectRatio: ratio }}
      onClick={onOpen}
      draggable={false}
    />
  );
}

function TableEditor({
  block,
  onChange,
  onFocus,
  handle,
}: {
  block: TableBlock;
  onChange: (next: Block) => void;
  onFocus: () => void;
  handle: React.ReactNode;
}) {
  const [cell, setCellFocus] = useState<{ row: number; column: number } | null>(null);
  const columns = block.rows[0]?.length ?? 1;

  return (
    <div className="block block-table">
      <div className="table-scroll">
        <table className={block.header ? 'with-header' : ''}>
          <tbody>
            {block.rows.map((cells, r) => (
              <tr key={r}>
                {cells.map((value, c) => (
                  <td key={c} className={cell?.row === r && cell.column === c ? 'active' : ''}>
                    <textarea
                      rows={1}
                      value={value}
                      ref={autoGrow}
                      placeholder={block.header && r === 0 ? 'Header' : ''}
                      onChange={(event) => {
                        onChange(setCell(block, r, c, event.target.value));
                        autoGrow(event.target);
                      }}
                      onFocus={() => {
                        setCellFocus({ row: r, column: c });
                        onFocus();
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-tools">
        <button className="tag" onClick={() => onChange(addRow(block, cell ? cell.row + 1 : undefined))}>
          + Row
        </button>
        <button className="tag" onClick={() => onChange(addColumn(block, cell ? cell.column + 1 : undefined))}>
          + Column
        </button>
        {cell && block.rows.length > 1 ? (
          <button
            className="tag"
            onClick={() => {
              onChange(removeRow(block, cell.row));
              setCellFocus(null);
            }}
          >
            − Row
          </button>
        ) : null}
        {cell && columns > 1 ? (
          <button
            className="tag"
            onClick={() => {
              onChange(removeColumn(block, cell.column));
              setCellFocus(null);
            }}
          >
            − Column
          </button>
        ) : null}
        <button className={`tag ${block.header ? 'on' : ''}`} onClick={() => onChange({ ...block, header: !block.header })}>
          Header row
        </button>
      </div>
      {handle}
    </div>
  );
}

function Lightbox({ block, onClose }: { block: ImageBlock; onClose: () => void }) {
  const state = useNoteImage(block.fileId);
  return (
    <div
      className="lightbox"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      {state.status === 'ready' ? <img src={state.url} alt={block.caption} /> : null}
      {block.caption ? <p>{block.caption}</p> : null}
    </div>
  );
}

// ---------------------------------------------------------------- controls

function ToolButton({
  glyph,
  title,
  active,
  onClick,
}: {
  glyph: string;
  title: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`icon-btn ${active ? 'on' : ''}`} title={title} aria-label={title} onClick={onClick}>
      <Glyph glyph={glyph} size={18} />
    </button>
  );
}

export function MenuItem({
  glyph,
  label,
  trailing,
  danger,
  onClick,
}: {
  glyph: string;
  label: string;
  trailing?: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`menu-item ${danger ? 'danger-text' : ''}`} onClick={onClick}>
      <span className="menu-glyph">
        <Glyph glyph={glyph} />
      </span>
      <span className="grow">{label}</span>
      {trailing ? <span className="menu-trailing">{trailing}</span> : null}
    </button>
  );
}

export function NewNameRow({
  placeholder,
  onCreate,
  value,
  onValue,
}: {
  placeholder: string;
  onCreate: (name: string) => Promise<void>;
  value?: string;
  onValue?: (value: string) => void;
}) {
  const [own, setOwn] = useState('');
  const text = value ?? own;
  const setText = onValue ?? setOwn;
  const create = () => {
    if (text.trim() === '') return;
    void onCreate(text.trim()).then(() => setText(''));
  };
  return (
    <div className="new-name">
      <input
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') create();
        }}
      />
      <button disabled={text.trim() === ''} onClick={create}>
        Create
      </button>
    </div>
  );
}

function describeEdited(iso: string): string {
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
