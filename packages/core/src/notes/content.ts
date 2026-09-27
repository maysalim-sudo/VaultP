/**
 * What a note is made of: a list of blocks.
 *
 * A note used to be one string. It is now a sequence of blocks — paragraphs,
 * headings, list items, checklist items, quotes, dividers, tables and images —
 * because each of those behaves differently when edited (Enter in a checklist
 * makes another item, a table grows by rows) and a single string cannot say
 * which is which without inventing a markup language and parsing it back.
 *
 * TWO REPRESENTATIONS, ONE TRUTH. The blocks are the note. Beside them the
 * repository keeps a plain-text rendering in the old `body` column, derived on
 * every write, and never edited directly. It is what search matches, what a
 * reminder notification quotes, and — the reason it cannot simply go — what an
 * older build on the other device shows, since it knows nothing of blocks.
 *
 * TOLERANT ON READ. Content written by a newer build may hold a block type this
 * one has never heard of. It is kept verbatim as an `unknown` block and written
 * back unchanged, so opening and saving a note here never destroys what a newer
 * device put in it.
 */

import { uuidv7 } from '../id.js';

export const CONTENT_VERSION = 1;

/** The text styles a line of writing can take. */
export const TEXT_STYLES = ['body', 'h1', 'h2', 'quote'] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export interface TextBlock {
  readonly id: string;
  readonly type: 'text';
  readonly style: TextStyle;
  readonly text: string;
}

export interface ListBlock {
  readonly id: string;
  readonly type: 'bullet' | 'numbered';
  readonly text: string;
  /** 0 or 1: one level of nesting is what a phone keyboard can reasonably drive. */
  readonly indent: number;
}

export interface CheckBlock {
  readonly id: string;
  readonly type: 'check';
  readonly text: string;
  readonly checked: boolean;
  readonly indent: number;
}

export interface DividerBlock {
  readonly id: string;
  readonly type: 'divider';
}

export interface ImageBlock {
  readonly id: string;
  readonly type: 'image';
  /** A row in the file table; the bytes are encrypted on disk like any scan. */
  readonly fileId: string;
  readonly caption: string;
  /** Known at import, so the layout can reserve the right height before decrypting. */
  readonly width: number | null;
  readonly height: number | null;
}

export interface TableBlock {
  readonly id: string;
  readonly type: 'table';
  /** Row-major; every row has the same number of cells. */
  readonly rows: readonly (readonly string[])[];
  /** Whether the first row is a header. */
  readonly header: boolean;
}

/** A block from a newer build, kept exactly as it came. */
export interface UnknownBlock {
  readonly id: string;
  readonly type: 'unknown';
  readonly raw: Readonly<Record<string, unknown>>;
}

export type Block =
  | TextBlock
  | ListBlock
  | CheckBlock
  | DividerBlock
  | ImageBlock
  | TableBlock
  | UnknownBlock;

export type BlockType = Block['type'];

export interface NoteContent {
  readonly blocks: readonly Block[];
  /** Keep's "move ticked items to the bottom", per note. */
  readonly checkedLast: boolean;
}

export const EMPTY_CONTENT: NoteContent = { blocks: [], checkedLast: false };

export const MAX_TABLE_ROWS = 100;
export const MAX_TABLE_COLUMNS = 12;

// --------------------------------------------------------------- building

export function textBlock(text = '', style: TextStyle = 'body'): TextBlock {
  return { id: uuidv7(), type: 'text', style, text };
}

export function listBlock(type: 'bullet' | 'numbered', text = '', indent = 0): ListBlock {
  return { id: uuidv7(), type, text, indent };
}

export function checkBlock(text = '', checked = false, indent = 0): CheckBlock {
  return { id: uuidv7(), type: 'check', text, checked, indent };
}

export function dividerBlock(): DividerBlock {
  return { id: uuidv7(), type: 'divider' };
}

export function imageBlock(
  fileId: string,
  size: { width?: number | null; height?: number | null } = {},
): ImageBlock {
  return {
    id: uuidv7(),
    type: 'image',
    fileId,
    caption: '',
    width: size.width ?? null,
    height: size.height ?? null,
  };
}

export function tableBlock(rows = 3, columns = 3): TableBlock {
  const r = clamp(rows, 1, MAX_TABLE_ROWS);
  const c = clamp(columns, 1, MAX_TABLE_COLUMNS);
  return {
    id: uuidv7(),
    type: 'table',
    rows: Array.from({ length: r }, () => Array.from({ length: c }, () => '')),
    header: true,
  };
}

/** Blocks that hold a single editable line of text. */
export function isTextual(block: Block): block is TextBlock | ListBlock | CheckBlock {
  return block.type === 'text' || block.type === 'bullet' || block.type === 'numbered' || block.type === 'check';
}

/**
 * Turn a text-bearing block into another kind, keeping its words.
 *
 * What the "Aa" menu does to the line under the cursor. Turning a checklist item
 * into a paragraph and back loses only the tick, which is the honest result.
 */
export function convertBlock(
  block: TextBlock | ListBlock | CheckBlock,
  to: TextStyle | 'bullet' | 'numbered' | 'check',
): TextBlock | ListBlock | CheckBlock {
  const indent = 'indent' in block ? block.indent : 0;
  if (to === 'check') {
    return { id: block.id, type: 'check', text: block.text, checked: block.type === 'check' ? block.checked : false, indent };
  }
  if (to === 'bullet' || to === 'numbered') {
    return { id: block.id, type: to, text: block.text, indent };
  }
  return { id: block.id, type: 'text', style: to, text: block.text };
}

// ------------------------------------------------------------ table edits

export function setCell(table: TableBlock, row: number, column: number, text: string): TableBlock {
  return {
    ...table,
    rows: table.rows.map((cells, r) =>
      r === row ? cells.map((cell, c) => (c === column ? text : cell)) : cells,
    ),
  };
}

export function addRow(table: TableBlock, at = table.rows.length): TableBlock {
  if (table.rows.length >= MAX_TABLE_ROWS) return table;
  const width = table.rows[0]?.length ?? 1;
  const rows = [...table.rows];
  rows.splice(clamp(at, 0, rows.length), 0, Array.from({ length: width }, () => ''));
  return { ...table, rows };
}

export function removeRow(table: TableBlock, at: number): TableBlock {
  if (table.rows.length <= 1) return table;
  return { ...table, rows: table.rows.filter((_, r) => r !== at) };
}

export function addColumn(table: TableBlock, at = table.rows[0]?.length ?? 0): TableBlock {
  if ((table.rows[0]?.length ?? 0) >= MAX_TABLE_COLUMNS) return table;
  return {
    ...table,
    rows: table.rows.map((cells) => {
      const next = [...cells];
      next.splice(clamp(at, 0, next.length), 0, '');
      return next;
    }),
  };
}

export function removeColumn(table: TableBlock, at: number): TableBlock {
  if ((table.rows[0]?.length ?? 0) <= 1) return table;
  return { ...table, rows: table.rows.map((cells) => cells.filter((_, c) => c !== at)) };
}

// ------------------------------------------------------------ list edits

export function moveBlock(blocks: readonly Block[], from: number, to: number): Block[] {
  const next = [...blocks];
  if (from < 0 || from >= next.length) return next;
  const [moved] = next.splice(from, 1);
  next.splice(clamp(to, 0, next.length), 0, moved!);
  return next;
}

/**
 * Blocks in display order.
 *
 * With "ticked items last" on, each run of consecutive checklist items keeps its
 * open items first and its ticked ones after, each group in its own order. Runs
 * are sorted separately so a ticked item never jumps over a heading or a table
 * into some other list.
 */
export function displayOrder(content: NoteContent): Block[] {
  if (!content.checkedLast) return [...content.blocks];

  const out: Block[] = [];
  let run: CheckBlock[] = [];
  const flush = () => {
    out.push(...run.filter((b) => !b.checked), ...run.filter((b) => b.checked));
    run = [];
  };
  for (const block of content.blocks) {
    if (block.type === 'check') run.push(block);
    else {
      flush();
      out.push(block);
    }
  }
  flush();
  return out;
}

export interface ChecklistProgress {
  readonly done: number;
  readonly total: number;
}

export function checklistProgress(content: NoteContent): ChecklistProgress | null {
  const items = content.blocks.filter((b): b is CheckBlock => b.type === 'check');
  if (items.length === 0) return null;
  return { done: items.filter((b) => b.checked).length, total: items.length };
}

export function imageFileIds(content: NoteContent): string[] {
  return content.blocks.flatMap((b) => (b.type === 'image' ? [b.fileId] : []));
}

/** Nothing worth keeping: no words, no image, no table with anything in it. */
export function isContentEmpty(content: NoteContent): boolean {
  return content.blocks.every((block) => {
    switch (block.type) {
      case 'text':
      case 'bullet':
      case 'numbered':
      case 'check':
        return block.text.trim() === '';
      case 'divider':
        return true;
      case 'table':
        return block.rows.every((cells) => cells.every((cell) => cell.trim() === ''));
      default:
        return false;
    }
  });
}

// ------------------------------------------------------------- plain text

/**
 * The note as plain text: what search matches and older builds display.
 *
 * Checklist items use ☐ / ☑ and bullets use •, so the text reads naturally in a
 * build that knows nothing of blocks — and `fromPlainText` can recognise them if
 * such a build edits the note and sends the text back.
 */
export function toPlainText(content: NoteContent): string {
  const lines: string[] = [];
  let number = 0;

  for (const block of content.blocks) {
    if (block.type !== 'numbered') number = 0;
    const pad = 'indent' in block && block.indent > 0 ? '  ' : '';

    switch (block.type) {
      case 'text':
        lines.push(block.text);
        break;
      case 'bullet':
        lines.push(`${pad}• ${block.text}`);
        break;
      case 'numbered':
        number += 1;
        lines.push(`${pad}${number}. ${block.text}`);
        break;
      case 'check':
        lines.push(`${pad}${block.checked ? '☑' : '☐'} ${block.text}`);
        break;
      case 'divider':
        lines.push('———');
        break;
      case 'image':
        lines.push(block.caption.trim() === '' ? '[image]' : `[image: ${block.caption.trim()}]`);
        break;
      case 'table':
        for (const cells of block.rows) {
          lines.push(cells.map((cell) => cell.trim()).join(' | ').trimEnd());
        }
        break;
      case 'unknown':
        break;
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Read an old plain-text note, or one edited by a build without blocks.
 *
 * Every line becomes its own block, which is what the editor wants: Enter makes
 * a new block, so a multi-line paragraph block would behave differently from
 * everything around it. Lines that look like our own checklist or bullet
 * rendering come back as those blocks.
 */
export function fromPlainText(text: string): NoteContent {
  const blocks: Block[] = [];
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const indent = /^\s{2,}\S/.test(rawLine) ? 1 : 0;
    const line = rawLine.trim();
    let match: RegExpExecArray | null;

    if ((match = /^(☐|☑|\[ \]|\[x\])\s?(.*)$/i.exec(line))) {
      const checked = match[1] === '☑' || match[1]!.toLowerCase() === '[x]';
      blocks.push(checkBlock(match[2]!, checked, indent));
    } else if ((match = /^[•\-*]\s(.*)$/.exec(line))) {
      blocks.push(listBlock('bullet', match[1]!, indent));
    } else if (line === '———') {
      blocks.push(dividerBlock());
    } else {
      blocks.push(textBlock(line));
    }
  }

  // Trailing blank lines are not content anyone wrote on purpose.
  while (blocks.length > 0) {
    const last = blocks[blocks.length - 1]!;
    if (last.type === 'text' && last.text === '') blocks.pop();
    else break;
  }
  return { blocks, checkedLast: false };
}

// ---------------------------------------------------------- serialisation

export function serializeContent(content: NoteContent): string {
  return JSON.stringify({
    v: CONTENT_VERSION,
    checkedLast: content.checkedLast,
    blocks: content.blocks.map((block) => (block.type === 'unknown' ? block.raw : block)),
  });
}

/**
 * Parse stored content, falling back to the plain body.
 *
 * Never throws: a note that cannot be parsed is shown as its plain text rather
 * than not at all, since the plain text is always kept in step.
 */
export function parseContent(stored: string | null | undefined, body: string): NoteContent {
  if (!stored) return fromPlainText(body);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return fromPlainText(body);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.blocks)) return fromPlainText(body);

  return {
    checkedLast: parsed.checkedLast === true,
    blocks: parsed.blocks.filter(isRecord).map(readBlock),
  };
}

function readBlock(raw: Record<string, unknown>): Block {
  const id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : uuidv7();
  const text = typeof raw.text === 'string' ? raw.text : '';
  const indent = raw.indent === 1 ? 1 : 0;

  switch (raw.type) {
    case 'text':
      return {
        id,
        type: 'text',
        style: (TEXT_STYLES as readonly unknown[]).includes(raw.style) ? (raw.style as TextStyle) : 'body',
        text,
      };
    case 'bullet':
    case 'numbered':
      return { id, type: raw.type, text, indent };
    case 'check':
      return { id, type: 'check', text, checked: raw.checked === true, indent };
    case 'divider':
      return { id, type: 'divider' };
    case 'image':
      if (typeof raw.fileId !== 'string') break;
      return {
        id,
        type: 'image',
        fileId: raw.fileId,
        caption: typeof raw.caption === 'string' ? raw.caption : '',
        width: typeof raw.width === 'number' ? raw.width : null,
        height: typeof raw.height === 'number' ? raw.height : null,
      };
    case 'table': {
      if (!Array.isArray(raw.rows)) break;
      const rows = raw.rows
        .filter(Array.isArray)
        .map((cells) => (cells as unknown[]).map((cell) => (typeof cell === 'string' ? cell : '')));
      if (rows.length === 0) break;
      // Ragged rows from a hand-edited or damaged note are padded, not dropped.
      const width = Math.max(1, ...rows.map((cells) => cells.length));
      return {
        id,
        type: 'table',
        rows: rows.map((cells) => [...cells, ...Array.from({ length: width - cells.length }, () => '')]),
        header: raw.header !== false,
      };
    }
  }
  return { id, type: 'unknown', raw };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}
