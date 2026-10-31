/**
 * One block of a note, editable.
 *
 * Every line of writing is its own TextInput, which is what makes each kind of
 * line behave as it should: Enter at the end of a checklist item makes the next
 * item, Enter on an empty one leaves the list, Backspace on an empty line joins
 * the one above. A single big TextInput cannot know which kind of line the
 * cursor is on.
 *
 * Tables and images are not text, so they have their own controls: a table grows
 * by rows and columns from the cell you are in; an image opens full screen on a
 * tap and offers its actions on a long press.
 */

import { forwardRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';

import {
  addColumn,
  addRow,
  radii,
  removeColumn,
  removeRow,
  setCell,
  spacing,
  typeScale,
  type Block,
  type CheckBlock,
  type ImageBlock,
  type ListBlock,
  type TableBlock,
  type TextBlock,
} from '@vaultp/core';

import { fonts, type Palette } from '../components/theme.js';
import type { OpenVault } from '../vault/open.js';
import { NoteImage } from './images.js';

export interface BlockViewProps {
  block: Block;
  /** Position in a numbered run, for numbered items. */
  number: number;
  palette: Palette;
  /** A translucent fill that reads on any note colour. */
  wash: string;
  vault: OpenVault;
  onChange: (next: Block) => void;
  /** Text typed with a line break in it: split the block there. */
  onSplit: (block: TextBlock | ListBlock | CheckBlock, before: string, after: string) => void;
  /** Backspace on an empty line. */
  onBackspaceEmpty: (block: TextBlock | ListBlock | CheckBlock) => void;
  onFocus: () => void;
  onOpenImage: (block: ImageBlock) => void;
  onBlockMenu: () => void;
}

type Textual = TextBlock | ListBlock | CheckBlock;

/** Whether Enter should make a new block here, rather than a line break. */
function splitsOnEnter(block: Textual): boolean {
  // A paragraph or a quote may run to several lines, as in Keep. Headings and
  // list items are one line each; Enter means "next one".
  return !(block.type === 'text' && (block.style === 'body' || block.style === 'quote'));
}

export const BlockView = forwardRef<TextInput, BlockViewProps>(function BlockView(props, ref) {
  const { block, palette } = props;

  switch (block.type) {
    case 'text':
    case 'bullet':
    case 'numbered':
    case 'check':
      return <TextualBlock {...props} block={block} inputRef={ref} />;
    case 'divider':
      return (
        <Pressable onLongPress={props.onBlockMenu} style={styles.dividerHit}>
          <View style={[styles.divider, { backgroundColor: palette.dim }]} />
        </Pressable>
      );
    case 'image':
      return (
        <View style={styles.imageBlock}>
          <NoteImage
            vault={props.vault}
            fileId={block.fileId}
            width={block.width}
            height={block.height}
            style={styles.image}
            placeholderColour={props.wash}
            textColour={palette.dim}
            onPress={() => props.onOpenImage(block)}
            onLongPress={props.onBlockMenu}
          />
          <TextInput
            value={block.caption}
            onChangeText={(caption) => props.onChange({ ...block, caption })}
            onFocus={props.onFocus}
            placeholder="Add a caption"
            placeholderTextColor={palette.textFaint}
            style={[styles.caption, { color: palette.dim }]}
          />
        </View>
      );
    case 'table':
      return <TableView {...props} block={block} />;
    case 'unknown':
      return (
        <Pressable onLongPress={props.onBlockMenu} style={[styles.unknown, { backgroundColor: props.wash }]}>
          <Text style={{ color: palette.dim, fontSize: typeScale.sm }}>
            Something made in a newer version of VaultP. Update this app to see it; it is kept as it is.
          </Text>
        </Pressable>
      );
  }
});

function TextualBlock({
  block,
  number,
  palette,
  onChange,
  onSplit,
  onBackspaceEmpty,
  onFocus,
  inputRef,
}: BlockViewProps & { block: Textual; inputRef: React.ForwardedRef<TextInput> }) {
  const indent = 'indent' in block ? block.indent : 0;

  function changeText(value: string) {
    if (splitsOnEnter(block) && value.includes('\n')) {
      const at = value.indexOf('\n');
      onSplit(block, value.slice(0, at), value.slice(at + 1).replace(/\n/g, ' '));
      return;
    }
    onChange({ ...block, text: value });
  }

  function keyPress(event: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    if (event.nativeEvent.key === 'Backspace' && block.text === '') onBackspaceEmpty(block);
  }

  const textStyle = [
    styles.text,
    { color: palette.text },
    block.type === 'text' && block.style === 'h1' ? styles.h1 : null,
    block.type === 'text' && block.style === 'h2' ? styles.h2 : null,
    block.type === 'text' && block.style === 'quote' ? styles.quoteText : null,
    block.type === 'check' && block.checked ? [styles.checkedText, { color: palette.dim }] : null,
  ];

  const input = (
    <TextInput
      ref={inputRef}
      value={block.text}
      onChangeText={changeText}
      onKeyPress={keyPress}
      onFocus={onFocus}
      multiline
      scrollEnabled={false}
      placeholder={
        block.type === 'check'
          ? 'List item'
          : block.type === 'text' && block.style === 'h1'
            ? 'Heading'
            : block.type === 'text' && block.style === 'h2'
              ? 'Subheading'
              : ''
      }
      placeholderTextColor={palette.textFaint}
      style={textStyle}
    />
  );

  return (
    <View style={[styles.row, { paddingLeft: indent * 28 }]}>
      {block.type === 'check' ? (
        <Pressable
          onPress={() => onChange({ ...block, checked: !block.checked })}
          hitSlop={10}
          style={[
            styles.box,
            {
              borderColor: block.checked ? palette.dim : palette.text,
              backgroundColor: block.checked ? palette.dim : 'transparent',
            },
          ]}
        >
          {block.checked ? <Text style={[styles.boxMark, { color: palette.background }]}>✓</Text> : null}
        </Pressable>
      ) : block.type === 'bullet' ? (
        <Text style={[styles.gutter, { color: palette.text }]}>{indent > 0 ? '◦' : '•'}</Text>
      ) : block.type === 'numbered' ? (
        <Text style={[styles.gutter, styles.number, { color: palette.text }]}>{number}.</Text>
      ) : block.type === 'text' && block.style === 'quote' ? (
        <View style={[styles.quoteBar, { backgroundColor: palette.dim }]} />
      ) : null}
      <View style={styles.grow}>{input}</View>
    </View>
  );
}

function TableView({
  block,
  palette,
  wash,
  onChange,
  onFocus,
  onBlockMenu,
}: BlockViewProps & { block: TableBlock }) {
  const [cell, setCellFocus] = useState<{ row: number; column: number } | null>(null);
  const columns = block.rows[0]?.length ?? 1;

  return (
    <View style={styles.tableBlock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.table, { borderColor: palette.border }]}>
          {block.rows.map((cells, r) => (
            <View
              key={r}
              style={[
                styles.tableRow,
                { borderColor: palette.border },
                r === block.rows.length - 1 ? styles.lastRow : null,
                block.header && r === 0 ? { backgroundColor: wash } : null,
              ]}
            >
              {cells.map((value, c) => (
                <TextInput
                  key={c}
                  value={value}
                  multiline
                  scrollEnabled={false}
                  onChangeText={(text) => onChange(setCell(block, r, c, text))}
                  onFocus={() => {
                    setCellFocus({ row: r, column: c });
                    onFocus();
                  }}
                  placeholder={block.header && r === 0 ? 'Header' : ''}
                  placeholderTextColor={palette.textFaint}
                  style={[
                    styles.cell,
                    { color: palette.text, borderColor: palette.border },
                    c === columns - 1 ? styles.lastCell : null,
                    block.header && r === 0 ? styles.headerCell : null,
                    cell?.row === r && cell.column === c ? { backgroundColor: wash } : null,
                  ]}
                />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.tableTools}>
          <Tool label="+ Row" palette={palette} wash={wash} onPress={() => onChange(addRow(block, cell ? cell.row + 1 : undefined))} />
          <Tool
            label="+ Column"
            palette={palette}
            wash={wash}
            onPress={() => onChange(addColumn(block, cell ? cell.column + 1 : undefined))}
          />
          {cell && block.rows.length > 1 ? (
            <Tool
              label="− Row"
              palette={palette}
              wash={wash}
              onPress={() => {
                onChange(removeRow(block, cell.row));
                setCellFocus(null);
              }}
            />
          ) : null}
          {cell && columns > 1 ? (
            <Tool
              label="− Column"
              palette={palette}
              wash={wash}
              onPress={() => {
                onChange(removeColumn(block, cell.column));
                setCellFocus(null);
              }}
            />
          ) : null}
          <Tool
            label={block.header ? 'Header ✓' : 'Header'}
            palette={palette}
            wash={wash}
            onPress={() => onChange({ ...block, header: !block.header })}
          />
          <Tool label="⋯" palette={palette} wash={wash} onPress={onBlockMenu} />
        </View>
      </ScrollView>
    </View>
  );
}

function Tool({
  label,
  palette,
  wash,
  onPress,
}: {
  label: string;
  palette: Palette;
  wash: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tool, { backgroundColor: wash }, pressed ? styles.pressed : null]}
    >
      <Text style={[styles.toolText, { color: palette.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  grow: { flex: 1 },
  text: { fontFamily: fonts.ui, fontSize: typeScale.md, lineHeight: 24, paddingVertical: 4, textAlignVertical: 'top' },
  h1: { fontFamily: fonts.uiBold, fontSize: 24, lineHeight: 32, paddingTop: spacing.sm },
  h2: { fontFamily: fonts.uiSemibold, fontSize: typeScale.lg, lineHeight: 28, paddingTop: spacing.xs },
  quoteText: { fontStyle: 'italic' },
  quoteBar: { width: 3, alignSelf: 'stretch', borderRadius: 2, marginVertical: 4, opacity: 0.6 },
  checkedText: { textDecorationLine: 'line-through' },
  gutter: { fontFamily: fonts.ui, fontSize: typeScale.md, lineHeight: 24, paddingTop: 4, minWidth: 14, textAlign: 'center' },
  number: { minWidth: 22, textAlign: 'right', fontVariant: ['tabular-nums'] },
  box: {
    width: 20,
    height: 20,
    marginTop: 6,
    borderRadius: 4,
    borderWidth: 1.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxMark: { fontFamily: fonts.uiBold, fontSize: 13, lineHeight: 15 },

  dividerHit: { paddingVertical: spacing.md },
  divider: { height: StyleSheet.hairlineWidth * 2, opacity: 0.5 },

  imageBlock: { marginVertical: spacing.xs },
  image: { borderRadius: radii.md },
  caption: { fontFamily: fonts.ui, fontSize: typeScale.sm, paddingVertical: 4, textAlign: 'center' },

  tableBlock: { marginVertical: spacing.xs, gap: spacing.xs },
  table: { borderWidth: 1, borderRadius: radii.sm, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1 },
  lastRow: { borderBottomWidth: 0 },
  cell: {
    width: 128,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    fontFamily: fonts.ui, fontSize: typeScale.base,
    borderRightWidth: 1,
    textAlignVertical: 'top',
  },
  lastCell: { borderRightWidth: 0 },
  headerCell: { fontFamily: fonts.uiBold },
  tableTools: { flexDirection: 'row', gap: spacing.xs },
  tool: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radii.pill },
  toolText: { fontFamily: fonts.uiSemibold, fontSize: typeScale.sm, },

  unknown: { padding: spacing.md, borderRadius: radii.md },
  pressed: { transform: [{ scale: 0.97 }] },
});
