/**
 * Picking a date.
 *
 * A tappable row that opens Android's own calendar, rather than a text field.
 * Typing a date is a small ordeal on a phone — the keyboard covers half the
 * screen, the separators fight you, and half-typed input has to be handled at
 * every step. The system picker is familiar, cannot produce an invalid date, and
 * knows which month has 30 days.
 *
 * The value stays a plain YYYY-MM-DD string, because that is what the vault
 * stores; the JavaScript Date exists only for as long as the dialog is open.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';

import { type IsoDate, isValidDate } from '@vaultp/core';

import { fonts, type Palette } from './theme.js';

/** Local noon: far enough from either boundary that no timezone shifts the day. */
function toDate(value: IsoDate): Date {
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function toIso(date: Date): IsoDate {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** "15 March 2028" — unambiguous, unlike anything with slashes in it. */
export function describeDate(value: IsoDate, locale = 'en-GB'): string {
  if (!isValidDate(value)) return value;
  return toDate(value).toLocaleDateString(locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function DateField({
  value,
  onChange,
  placeholder = 'Choose a date',
  palette,
  clearable = true,
  minimumDate,
}: {
  /** YYYY-MM-DD, or empty for unset. */
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  palette: Palette;
  clearable?: boolean;
  minimumDate?: Date;
}) {
  const set = isValidDate(value);

  /**
   * Opened imperatively rather than rendered.
   *
   * On Android the dialog is a system window, not a view in the tree: rendering
   * the component asks for an inline picker and its native view, which is a
   * different thing and fails outright on a build that only registers the dialog.
   */
  function open() {
    DateTimePickerAndroid.open({
      value: set ? toDate(value) : new Date(),
      mode: 'date',
      display: 'calendar',
      ...(minimumDate ? { minimumDate } : {}),
      onChange: (event, selected) => {
        if (event.type === 'set' && selected) onChange(toIso(selected));
      },
    });
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={open}
        style={[
          styles.field,
          { borderColor: palette.border, backgroundColor: palette.surface },
        ]}
      >
        <Text style={{ color: set ? palette.text : palette.dim, fontSize: 16 }}>
          {set ? describeDate(value) : placeholder}
        </Text>
      </Pressable>

      {set && clearable ? (
        <Pressable
          onPress={() => onChange('')}
          style={[styles.clear, { borderColor: palette.border }]}
          hitSlop={8}
        >
          <Text style={{ color: palette.dim, fontWeight: '600' }}>Clear</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  field: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    justifyContent: 'center',
  },
  clear: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
});
