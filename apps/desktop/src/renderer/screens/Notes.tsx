/**
 * Notes on the desktop, matching the phone: a Keep-style grid of cards, folders,
 * labels, archive, and notes you arrange by hand.
 *
 * The same holds as on the phone, with the mouse:
 *
 *   click                    open the note
 *   hold, let go by 0.5 s    its options (right-click does the same)
 *   keep holding             the border traces round, and at 1.2 s the card
 *                            lifts to be dragged
 *
 * A mouse can also simply drag: moving while pressed lifts the card at once, as
 * any desktop list would. Drop it between two notes to reorder, or onto a chip —
 * a folder files it, a label tags it, All notes unfiles it, Archive and Done do
 * what they say. Right-clicking empty space offers a new or pasted note.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { NOTE_COLOURS, type Block } from '@vaultp/core';

import type { NoteDto, NoteFolderDto, NotesQueryDto, TagDto } from '../../shared/api.js';
import { Modal } from '../Modal.js';
import { MenuItem, NoteEditor, NoteImageView, noteBackground, type EditorStart } from '../notes/NoteEditor.js';
import { api, invalidate, messageOf, useVaultQuery } from '../vault.js';
import '../notes/notes.css';

type Filter = { kind: 'all' } | { kind: 'folder'; id: string } | { kind: 'label'; id: string } | { kind: 'archive' } | { kind: 'done' };

type Menu =
  | null
  | { kind: 'note'; note: NoteDto; x: number; y: number; picking?: boolean }
  | { kind: 'space'; x: number; y: number; hasImage: boolean; text: string }
  | { kind: 'folder'; folder: NoteFolderDto; x: number; y: number };

type Hover = null | { kind: 'chip'; key: string } | { kind: 'card'; id: string; edge: 'before' | 'after' };

interface Drag {
  readonly note: NoteDto;
  readonly width: number;
  readonly grab: { x: number; y: number };
}

const MENU_AFTER_MS = 280;
const TRACE_FROM_MS = 500;
const LIFT_AT_MS = 1200;
const DRAG_SLOP = 6;
const PREVIEW_LINES = 10;

function queryFor(filter: Filter, search: string): NotesQueryDto {
  const base: NotesQueryDto = { view: filter.kind, ...('id' in filter ? { id: filter.id } : {}) };
  return search.trim() ? { ...base, search } : base;
}

export function Notes() {
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<EditorStart | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [naming, setNaming] = useState<null | { folder?: NoteFolderDto }>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [error, setError] = useState<string | null>(null);

  const notes = useVaultQuery(() => api().listNotes(queryFor(filter, search)));
  const folders = useVaultQuery(() => api().listNoteFolders());
  const labels = useVaultQuery(() => api().listNoteLabels());
  const layout = useVaultQuery(() => api().notesLayout());

  const list = notes.data ?? [];
  const searching = search.trim() !== '';
  const canReorder = !searching && (filter.kind === 'all' || filter.kind === 'folder');
  const pinned = canReorder ? list.filter((n) => n.pinned) : [];
  const others = canReorder ? list.filter((n) => !n.pinned) : list;
  const folderNames = useMemo(() => new Map((folders.data ?? []).map((f) => [f.id, f.name])), [folders.data]);
  const currentFolder = filter.kind === 'folder' ? filter.id : null;

  // A folder or label removed (here or by a sync) must not strand the view.
  useEffect(() => {
    if (filter.kind === 'folder' && folders.data && !folders.data.some((f) => f.id === filter.id)) setFilter({ kind: 'all' });
    if (filter.kind === 'label' && labels.data && !labels.data.some((l) => l.id === filter.id)) setFilter({ kind: 'all' });
  }, [folders.data, labels.data, filter]);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function say(message: string) {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2200);
  }

  async function act(action: () => Promise<unknown>, message?: string) {
    setError(null);
    try {
      await action();
      invalidate();
      if (message) say(message);
    } catch (caught: unknown) {
      setError(messageOf(caught));
    }
  }

  // ----------------------------------------------------------------- drop

  function hitTest(x: number, y: number, dragged: NoteDto): Hover {
    for (const element of document.elementsFromPoint(x, y)) {
      const chip = (element as HTMLElement).closest<HTMLElement>('[data-drop]');
      if (chip) return { kind: 'chip', key: chip.dataset.drop! };
      const card = (element as HTMLElement).closest<HTMLElement>('[data-note]');
      if (card && card.dataset.note !== dragged.id && canReorder) {
        const rect = card.getBoundingClientRect();
        return { kind: 'card', id: card.dataset.note!, edge: y < rect.top + rect.height / 2 ? 'before' : 'after' };
      }
    }
    return null;
  }

  function drop(dragged: NoteDto, target: Hover) {
    if (!target) return;
    if (target.kind === 'chip') {
      const [kind, id] = target.key.split(':') as [string, string | undefined];
      if (kind === 'all') {
        if (dragged.folderId) void act(() => api().moveNoteToFolder(dragged.id, null), 'Taken out of its folder');
      } else if (kind === 'folder' && id) {
        void act(() => api().moveNoteToFolder(dragged.id, id), `Moved to ${folderNames.get(id) ?? 'folder'}`);
      } else if (kind === 'label' && id) {
        void act(
          () => api().setNoteLabel(dragged.id, id, true),
          `Labelled ${labels.data?.find((l) => l.id === id)?.name ?? ''}`,
        );
      } else if (kind === 'archive') {
        void act(() => api().saveNote(dragged.id, { archived: true }), 'Archived');
      } else if (kind === 'done') {
        void act(() => api().setNoteDone(dragged.id, true), 'Marked done');
      }
      return;
    }

    // Between two notes: only the moved note is written, at the midpoint of its
    // new neighbours. Dropping among the pinned ones pins it.
    const targetNote = list.find((n) => n.id === target.id);
    if (!targetNote) return;
    const group = list.filter((n) => n.id !== dragged.id && n.pinned === targetNote.pinned);
    const at = group.findIndex((n) => n.id === targetNote.id);
    const previous = target.edge === 'before' ? (group[at - 1] ?? null) : targetNote;
    const next = target.edge === 'before' ? targetNote : (group[at + 1] ?? null);
    void act(() => api().placeNote(dragged.id, previous?.id ?? null, next?.id ?? null, targetNote.pinned));
  }

  // --------------------------------------------------------------- render

  const chips: { key: string; label: string; filter: Filter; folder?: NoteFolderDto }[] = [
    { key: 'all', label: 'All notes', filter: { kind: 'all' } },
    ...(folders.data ?? []).map((folder) => ({
      key: `folder:${folder.id}`,
      label: `📁 ${folder.name}`,
      filter: { kind: 'folder', id: folder.id } as Filter,
      folder,
    })),
    ...(labels.data ?? []).map((label) => ({
      key: `label:${label.id}`,
      label: `🏷 ${label.name}`,
      filter: { kind: 'label', id: label.id } as Filter,
    })),
    { key: 'archive', label: '🗄 Archive', filter: { kind: 'archive' } },
    { key: 'done', label: '✓ Done', filter: { kind: 'done' } },
  ];
  const isActive = (f: Filter) => f.kind === filter.kind && (!('id' in f) || ('id' in filter && filter.id === f.id));

  function renderCards(items: readonly NoteDto[]) {
    return (
      <div className={layout.data === 'list' ? 'note-list' : 'note-grid'}>
        {items.map((note) => (
          <HoldCard
            key={note.id}
            note={note}
            ghost={drag?.note.id === note.id}
            dropEdge={hover?.kind === 'card' && hover.id === note.id ? hover.edge : null}
            onOpen={() => setEditor({ kind: 'existing', note })}
            onMenu={(x, y) => setMenu({ kind: 'note', note, x, y })}
            onLift={(grab, width) => setDrag({ note, width, grab })}
            onMove={(x, y) => {
              const next = hitTest(x, y, note);
              setHover((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
            }}
            onDrop={(x, y) => {
              const target = hitTest(x, y, note);
              setDrag(null);
              setHover(null);
              drop(note, target);
            }}
          >
            <NoteCard
              note={note}
              folderName={filter.kind === 'folder' || !note.folderId ? null : (folderNames.get(note.folderId) ?? null)}
            />
          </HoldCard>
        ))}
      </div>
    );
  }

  return (
    <div
      className={`notes-page ${drag ? 'dragging' : ''}`}
      onContextMenu={(event) => {
        // Right-click on empty space: a new note, or one from the clipboard.
        if ((event.target as HTMLElement).closest('[data-note], [data-drop], input, textarea, button')) return;
        event.preventDefault();
        const { clientX: x, clientY: y } = event;
        void api()
          .noteClipboard()
          .then(({ hasImage, text }) => setMenu({ kind: 'space', x, y, hasImage, text }));
      }}
    >
      <div className="notes-top">
        <div className="notes-search">
          <span className="muted">⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search your notes" />
          {search ? (
            <button className="icon-btn" onClick={() => setSearch('')} title="Clear">
              ✕
            </button>
          ) : null}
        </div>
        <button
          className="icon-btn"
          title={layout.data === 'list' ? 'Show as a grid' : 'Show as a list'}
          onClick={() => void act(() => api().setNotesLayout(layout.data === 'list' ? 'grid' : 'list'))}
        >
          {layout.data === 'list' ? '▦' : '☰'}
        </button>
      </div>

      <div className="note-chips-row">
        {chips.map((chip) => {
          const active = isActive(chip.filter);
          const hovered = hover?.kind === 'chip' && hover.key === chip.key;
          return (
            <button
              key={chip.key}
              data-drop={chip.key}
              className={`tag ${active ? 'on' : ''} ${hovered ? 'drop-on' : ''}`}
              onClick={() => setFilter(chip.filter)}
              onContextMenu={(event) => {
                if (!chip.folder) return;
                event.preventDefault();
                setMenu({ kind: 'folder', folder: chip.folder, x: event.clientX, y: event.clientY });
              }}
            >
              {chip.label}
            </button>
          );
        })}
        <button className="tag dashed" onClick={() => setNaming({})}>
          ＋ Folder
        </button>
      </div>

      {filter.kind !== 'archive' && filter.kind !== 'done' && !searching ? (
        <div className="take-note">
          <button className="take-text" onClick={() => setEditor({ kind: 'new', with: 'text', folderId: currentFolder })}>
            Take a note…
          </button>
          <button
            className="icon-btn"
            title="New checklist"
            onClick={() => setEditor({ kind: 'new', with: 'checklist', folderId: currentFolder })}
          >
            ☑
          </button>
          <button
            className="icon-btn"
            title="New note with an image"
            onClick={() => setEditor({ kind: 'new', with: 'image', folderId: currentFolder })}
          >
            🖼
          </button>
        </div>
      ) : null}

      {error || notes.error ? <p className="error">{error ?? notes.error}</p> : null}

      {notes.data && list.length === 0 ? (
        <div className="empty notes-empty">
          <div className="notes-empty-icon">
            {searching ? '🔍' : filter.kind === 'archive' ? '🗄' : filter.kind === 'done' ? '✓' : filter.kind === 'folder' ? '📁' : '💡'}
          </div>
          {searching
            ? 'No note has that in it'
            : filter.kind === 'archive'
              ? 'Archived notes appear here'
              : filter.kind === 'done'
                ? 'Nothing marked done yet'
                : filter.kind === 'folder'
                  ? 'This folder is empty. Drag a note onto the folder to file it.'
                  : filter.kind === 'label'
                    ? 'No notes with this label'
                    : 'Notes you add appear here. Right-click empty space to paste one.'}
        </div>
      ) : null}

      {pinned.length > 0 ? (
        <>
          <h3>Pinned</h3>
          {renderCards(pinned)}
        </>
      ) : null}
      {others.length > 0 ? (
        <>
          {pinned.length > 0 ? <h3>Others</h3> : null}
          {renderCards(others)}
        </>
      ) : null}

      {drag ? <FloatingCard drag={drag} /> : null}
      {notice ? <div className="notice">{notice}</div> : null}

      {menu ? (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          {menu.kind === 'note' && !menu.picking ? (
            <>
              <div className="swatches">
                <button
                  className={`swatch ${menu.note.colour === null ? 'on' : ''}`}
                  style={{ background: 'var(--surface-raised)' }}
                  title="Default"
                  onClick={() => {
                    setMenu(null);
                    void act(() => api().saveNote(menu.note.id, { colour: null }));
                  }}
                >
                  ⊘
                </button>
                {NOTE_COLOURS.map((name) => (
                  <button
                    key={name}
                    className={`swatch ${menu.note.colour === name ? 'on' : ''}`}
                    style={{ background: `var(--note-${name})` }}
                    title={name}
                    onClick={() => {
                      setMenu(null);
                      void act(() => api().saveNote(menu.note.id, { colour: name }));
                    }}
                  />
                ))}
              </div>
              {!menu.note.archived ? (
                <MenuItem
                  glyph="📌"
                  label={menu.note.pinned ? 'Unpin' : 'Pin to the top'}
                  onClick={() => {
                    setMenu(null);
                    void act(() => api().saveNote(menu.note.id, { pinned: !menu.note.pinned }));
                  }}
                />
              ) : null}
              <MenuItem
                glyph="📁"
                label="Move to folder"
                trailing={menu.note.folderId ? (folderNames.get(menu.note.folderId) ?? '') : ''}
                onClick={() => setMenu({ ...menu, picking: true })}
              />
              <MenuItem
                glyph="🗄"
                label={menu.note.archived ? 'Unarchive' : 'Archive'}
                onClick={() => {
                  setMenu(null);
                  void act(
                    () => api().saveNote(menu.note.id, { archived: !menu.note.archived }),
                    menu.note.archived ? 'Unarchived' : 'Archived',
                  );
                }}
              />
              <MenuItem
                glyph="✓"
                label={menu.note.done ? 'Mark as not done' : 'Mark as done'}
                onClick={() => {
                  setMenu(null);
                  void act(() => api().setNoteDone(menu.note.id, !menu.note.done), menu.note.done ? undefined : 'Marked done');
                }}
              />
              <MenuItem
                glyph="⧉"
                label="Make a copy"
                onClick={() => {
                  setMenu(null);
                  void act(() => api().duplicateNote(menu.note.id), 'Copied');
                }}
              />
              <MenuItem
                glyph="🗑"
                label="Delete"
                danger
                onClick={() => {
                  setMenu(null);
                  if (window.confirm('Delete this note? Its images are deleted with it.')) {
                    void act(() => api().deleteNote(menu.note.id), 'Deleted');
                  }
                }}
              />
            </>
          ) : null}

          {menu.kind === 'note' && menu.picking ? (
            <>
              <MenuItem
                glyph="🗒"
                label="No folder"
                trailing={menu.note.folderId === null ? '✓' : ''}
                onClick={() => {
                  setMenu(null);
                  void act(() => api().moveNoteToFolder(menu.note.id, null), 'Removed from its folder');
                }}
              />
              {(folders.data ?? []).map((folder) => (
                <MenuItem
                  key={folder.id}
                  glyph="📁"
                  label={folder.name}
                  trailing={menu.note.folderId === folder.id ? '✓' : ''}
                  onClick={() => {
                    setMenu(null);
                    void act(() => api().moveNoteToFolder(menu.note.id, folder.id), `Moved to ${folder.name}`);
                  }}
                />
              ))}
            </>
          ) : null}

          {menu.kind === 'space' ? (
            <>
              <MenuItem
                glyph="📝"
                label="New note"
                onClick={() => {
                  setMenu(null);
                  setEditor({ kind: 'new', with: 'text', folderId: currentFolder });
                }}
              />
              <MenuItem
                glyph="☑"
                label="New checklist"
                onClick={() => {
                  setMenu(null);
                  setEditor({ kind: 'new', with: 'checklist', folderId: currentFolder });
                }}
              />
              <MenuItem
                glyph="📋"
                label={menu.hasImage ? 'Paste image as a new note' : menu.text.trim() ? 'Paste as a new note' : 'Paste (nothing copied)'}
                onClick={() => {
                  setMenu(null);
                  if (menu.hasImage) setEditor({ kind: 'new', with: 'clipboard-image', folderId: currentFolder });
                  else if (menu.text.trim()) setEditor({ kind: 'new', text: menu.text, folderId: currentFolder });
                }}
              />
              <MenuItem
                glyph="📁"
                label="New folder"
                onClick={() => {
                  setMenu(null);
                  setNaming({});
                }}
              />
            </>
          ) : null}

          {menu.kind === 'folder' ? (
            <>
              <MenuItem
                glyph="✎"
                label="Rename"
                onClick={() => {
                  setMenu(null);
                  setNaming({ folder: menu.folder });
                }}
              />
              <MenuItem
                glyph="🗑"
                label="Delete folder"
                danger
                onClick={() => {
                  setMenu(null);
                  if (window.confirm(`Delete “${menu.folder.name}”? The notes in it are kept; they just stop being in a folder.`)) {
                    void act(() => api().deleteNoteFolder(menu.folder.id), 'Folder deleted, notes kept');
                  }
                }}
              />
            </>
          ) : null}
        </ContextMenu>
      ) : null}

      {naming ? (
        <FolderNameDialog
          initial={naming.folder?.name ?? ''}
          renaming={Boolean(naming.folder)}
          onClose={() => setNaming(null)}
          onSave={async (name) => {
            if (naming.folder) {
              await api().renameNoteFolder(naming.folder.id, name);
            } else {
              const folder = await api().addNoteFolder(name);
              setFilter({ kind: 'folder', id: folder.id });
            }
            invalidate();
            setNaming(null);
          }}
        />
      ) : null}

      {editor ? (
        <NoteEditor
          start={editor}
          folders={folders.data ?? []}
          labels={labels.data ?? []}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------- holding

type Phase = 'idle' | 'pressing' | 'menu' | 'tracing' | 'dragging' | 'cancelled';

/**
 * A card that answers to how long the mouse is held on it — and to being
 * dragged straight away, as a mouse user expects.
 */
function HoldCard({
  note,
  ghost,
  dropEdge,
  onOpen,
  onMenu,
  onLift,
  onMove,
  onDrop,
  children,
}: {
  note: NoteDto;
  ghost: boolean;
  dropEdge: 'before' | 'after' | null;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
  onLift: (grab: { x: number; y: number }, width: number) => void;
  onMove: (x: number, y: number) => void;
  onDrop: (x: number, y: number) => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const phase = useRef<Phase>('idle');
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const start = useRef({ x: 0, y: 0 });
  const [tracing, setTracing] = useState(false);
  const [pressed, setPressed] = useState(false);

  function clear() {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    setTracing(false);
    setPressed(false);
  }

  function lift(x: number, y: number) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    phase.current = 'dragging';
    setTracing(false);
    setPressed(false);
    onLift({ x: x - rect.left, y: y - rect.top }, rect.width);
    moveFloating(x, y, { x: x - rect.left, y: y - rect.top });
    onMove(x, y);
  }

  function down(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    phase.current = 'pressing';
    start.current = { x: event.clientX, y: event.clientY };
    setPressed(true);
    const { clientX, clientY } = event;
    timers.current.push(
      setTimeout(() => {
        if (phase.current === 'pressing') phase.current = 'menu';
      }, MENU_AFTER_MS),
      setTimeout(() => {
        if (phase.current !== 'menu') return;
        phase.current = 'tracing';
        setTracing(true);
      }, TRACE_FROM_MS),
      setTimeout(() => {
        if (phase.current === 'tracing') lift(last.current.x || clientX, last.current.y || clientY);
      }, LIFT_AT_MS),
    );
  }

  const last = useRef({ x: 0, y: 0 });

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    last.current = { x: event.clientX, y: event.clientY };
    if (phase.current === 'dragging') {
      moveFloating(event.clientX, event.clientY);
      onMove(event.clientX, event.clientY);
      return;
    }
    if (phase.current === 'idle' || phase.current === 'cancelled') return;
    const moved = Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y);
    // A mouse drag lifts at once; waiting out the trace is for when you hold still.
    if (moved > DRAG_SLOP) {
      for (const timer of timers.current) clearTimeout(timer);
      timers.current = [];
      lift(event.clientX, event.clientY);
    }
  }

  function up(event: ReactPointerEvent<HTMLDivElement>) {
    const was = phase.current;
    phase.current = 'idle';
    clear();
    if (was === 'pressing') onOpen();
    else if (was === 'menu') onMenu(event.clientX, event.clientY);
    else if (was === 'dragging') onDrop(event.clientX, event.clientY);
  }

  useEffect(() => clear, []);

  return (
    <div
      ref={ref}
      data-note={note.id}
      className={`hold-card ${ghost ? 'ghost' : ''} ${pressed ? 'pressed' : ''} ${tracing ? 'tracing' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        phase.current = 'idle';
        clear();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onMenu(event.clientX, event.clientY);
      }}
    >
      {children}
      {/* The trace: an SVG outline drawn from nothing to the full border. */}
      <svg className="trace" aria-hidden="true">
        <rect x="1.5" y="1.5" rx="11" ry="11" pathLength="100" />
      </svg>
      {dropEdge ? <div className={`drop-mark ${dropEdge}`} /> : null}
    </div>
  );
}

/** The lifted card follows the pointer; moved directly, not through React state. */
let floatingGrab = { x: 0, y: 0 };
function moveFloating(x: number, y: number, grab?: { x: number; y: number }) {
  if (grab) floatingGrab = grab;
  const element = document.getElementById('floating-note');
  if (element) element.style.transform = `translate(${x - floatingGrab.x}px, ${y - floatingGrab.y}px) scale(1.04)`;
}

function FloatingCard({ drag }: { drag: Drag }) {
  useEffect(() => {
    floatingGrab = drag.grab;
  }, [drag]);
  return (
    <div id="floating-note" className="floating-note" style={{ width: drag.width }}>
      <NoteCard note={drag.note} folderName={null} />
    </div>
  );
}

// --------------------------------------------------------------------- card

function preview(blocks: readonly Block[]): Block[] {
  return blocks.filter((b) => b.type !== 'image' && b.type !== 'unknown' && !(b.type === 'text' && b.text.trim() === ''));
}

function NoteCard({ note, folderName }: { note: NoteDto; folderName: string | null }) {
  const image = note.content.blocks.find((b) => b.type === 'image');
  const lines = preview(note.content.blocks);
  const hideTicked = note.content.checkedLast;
  const shown = lines.filter((b) => !(hideTicked && b.type === 'check' && b.checked)).slice(0, PREVIEW_LINES);
  const hiddenTicked = hideTicked ? lines.filter((b) => b.type === 'check' && b.checked).length : 0;
  let number = 0;

  return (
    <div className={`note-card ${note.done ? 'done' : ''}`} style={{ background: noteBackground(note.colour) }}>
      {image && image.type === 'image' ? <NoteImageView block={image} compact /> : null}
      <div className="note-card-body">
        {note.title ? <div className="note-card-title">{note.title}</div> : null}
        {shown.map((block) => {
          number = block.type === 'numbered' ? number + 1 : 0;
          switch (block.type) {
            case 'check':
              return (
                <div key={block.id} className={`card-check ${block.checked ? 'checked' : ''}`}>
                  <span>{block.checked ? '☑' : '☐'}</span>
                  <span>{block.text}</span>
                </div>
              );
            case 'table':
              return (
                <div key={block.id} className="card-meta">
                  ▦ Table · {block.rows.length} × {block.rows[0]?.length ?? 0}
                </div>
              );
            case 'divider':
              return <hr key={block.id} />;
            case 'bullet':
            case 'numbered':
              return (
                <div key={block.id} className="card-line">
                  {block.type === 'bullet' ? '• ' : `${number}. `}
                  {block.text}
                </div>
              );
            case 'text':
              return (
                <div key={block.id} className={`card-line card-${block.style}`}>
                  {block.text}
                </div>
              );
            default:
              return null;
          }
        })}
        {lines.length > PREVIEW_LINES ? <div className="card-meta">…</div> : null}
        {hiddenTicked > 0 ? (
          <div className="card-meta">
            + {hiddenTicked} ticked {hiddenTicked === 1 ? 'item' : 'items'}
          </div>
        ) : null}
        {note.dueOn || note.labels.length > 0 || (note.checklist && !hideTicked) || folderName ? (
          <div className="card-chips">
            {note.dueOn ? (
              <span className="chip">
                {note.remind ? '🔔' : '🕒'} {note.dueOn}
              </span>
            ) : null}
            {note.checklist && !hideTicked ? (
              <span className="chip">
                ☑ {note.checklist.done}/{note.checklist.total}
              </span>
            ) : null}
            {folderName ? <span className="chip">📁 {folderName}</span> : null}
            {note.labels.map((label: TagDto) => (
              <span key={label.id} className="chip">
                {label.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- menus

function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu on screen near the window's right and bottom edges.
  useEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      left: Math.min(x, window.innerWidth - rect.width - 8),
      top: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y, children]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="menu-backdrop" onMouseDown={onClose} onContextMenu={(event) => event.preventDefault()}>
      <div ref={ref} className="context-menu" style={position} onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function FolderNameDialog({
  initial,
  renaming,
  onClose,
  onSave,
}: {
  initial: string;
  renaming: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    if (name.trim() === '') return;
    void onSave(name.trim()).catch((caught: unknown) => setError(messageOf(caught)));
  };
  return (
    <Modal
      title={renaming ? 'Rename folder' : 'New folder'}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button disabled={name.trim() === ''} onClick={save}>
            {renaming ? 'Rename' : 'Create'}
          </button>
        </>
      }
    >
      <input
        autoFocus
        value={name}
        placeholder="Folder name"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === 'Enter' && save()}
      />
      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
