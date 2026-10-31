/**
 * The frame around every screen: a slim bar on top, a floating tab bar below,
 * the Money tabs, and the create sheet behind the orange button.
 *
 * Four places, not nine: Home, Money, Notes and Documents. Money is one place
 * with four parts (spent, people, repeats, accounts), switched by tabs at its
 * top, because they are one subject. Search and the vault's settings sit in
 * the top bar; making something new is the button in the middle of the tabs.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Intent, Navigate, ViewName } from '../navigation.js';
import { Icon, type IconName } from './icons.js';
import { fonts, labelStyle, type Palette } from './theme.js';

/** The parts of Money, in tab order. */
export const MONEY: readonly ViewName[] = ['insights', 'debts', 'recurring', 'accounts'];
const MONEY_LABELS: Partial<Record<ViewName, string>> = {
  insights: 'SPENT',
  debts: 'PEOPLE',
  recurring: 'REPEATS',
  accounts: 'ACCOUNTS',
};

const PLACES: ReadonlyArray<{ readonly view: ViewName; readonly label: string; readonly icon: IconName }> = [
  { view: 'home', label: 'Home', icon: 'home' },
  { view: 'insights', label: 'Money', icon: 'money' },
  { view: 'notes', label: 'Notes', icon: 'notes' },
  { view: 'documents', label: 'Documents', icon: 'docs' },
];

export function TopBar({
  palette,
  onSearch,
  onVault,
}: {
  palette: Palette;
  onSearch: () => void;
  onVault: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.top, { paddingTop: insets.top + 6 }]}>
      <Mark palette={palette} />
      <Text style={[styles.name, { color: palette.text }]}>VAULTP</Text>
      <View style={styles.grow} />
      <RoundButton palette={palette} icon="search" label="Search everything" onPress={onSearch} />
      <RoundButton palette={palette} icon="sliders" label="Vault: sync, backup and settings" onPress={onVault} />
    </View>
  );
}

export function TabBar({
  palette,
  active,
  onSelect,
  onCreate,
}: {
  palette: Palette;
  active: ViewName;
  onSelect: Navigate;
  onCreate: () => void;
}) {
  // Gesture phones report a thin strip here, three-button phones a full bar;
  // either way the tabs sit clear of it.
  const insets = useSafeAreaInsets();
  const current = (place: ViewName) => (place === 'insights' ? MONEY.includes(active) : place === active);
  const tab = (place: (typeof PLACES)[number]) => {
    const on = current(place.view);
    return (
      <Pressable
        key={place.view}
        onPress={() => onSelect(place.view)}
        accessibilityRole="tab"
        accessibilityLabel={place.label}
        accessibilityState={{ selected: on }}
        style={styles.tab}
      >
        <Icon name={place.icon} size={22} color={on ? palette.text : palette.textFaint} />
        <View style={[styles.tabDot, { backgroundColor: on ? palette.accent : 'transparent' }]} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.tabWrap, { paddingBottom: insets.bottom + 8 }]}>
      <View style={[styles.tabBar, { backgroundColor: palette.surface }]}>
        {PLACES.slice(0, 2).map(tab)}
        <View style={styles.tab}>
          <Pressable
            onPress={onCreate}
            accessibilityRole="button"
            accessibilityLabel="New entry"
            style={[styles.create, { backgroundColor: palette.accent }]}
          >
            <Icon name="plus" size={22} stroke={2.2} color={palette.onAccent} />
          </Pressable>
        </View>
        {PLACES.slice(2).map(tab)}
      </View>
    </View>
  );
}

export function MoneyTabs({ palette, active, onSelect }: { palette: Palette; active: ViewName; onSelect: Navigate }) {
  return (
    <View style={[styles.seg, { backgroundColor: palette.surface }]} accessibilityRole="tablist">
      {MONEY.map((view) => {
        const on = view === active;
        return (
          <Pressable
            key={view}
            onPress={() => onSelect(view)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segItem, { backgroundColor: on ? palette.text : 'transparent' }]}
          >
            <Text style={[labelStyle, { letterSpacing: 1.2, color: on ? palette.background : palette.dim }]}>
              {MONEY_LABELS[view]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Everything that can be made, one tap away. An expense is the common case: the wide orange tile. */
export function CreateSheet({
  palette,
  visible,
  onClose,
  onGo,
}: {
  palette: Palette;
  visible: boolean;
  onClose: () => void;
  onGo: (view: ViewName, intent?: Intent) => void;
}) {
  const items: ReadonlyArray<{ t: string; m: string; icon: IconName; go: () => void }> = [
    { t: 'Expense', m: 'Keypad, category, done', icon: 'receipt', go: () => onGo('add') },
    { t: 'Note', m: 'Text, tables, images', icon: 'notes', go: () => onGo('notes', { kind: 'newNote', with: 'text' }) },
    { t: 'Checklist', m: 'Ticks drop to the end', icon: 'checklist', go: () => onGo('notes', { kind: 'newNote', with: 'checklist' }) },
    { t: 'Person', m: 'Lent or borrowed', icon: 'people', go: () => onGo('debts', { kind: 'newPerson' }) },
    { t: 'Photo note', m: 'From the camera', icon: 'camera', go: () => onGo('notes', { kind: 'newNote', with: 'camera' }) },
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={[styles.sheet, { backgroundColor: palette.background }]} onPress={() => undefined}>
          <View style={styles.sheetGrid}>
            {items.map((item, index) => {
              const first = index === 0;
              const fg = first ? palette.onAccent : palette.text;
              return (
                <Pressable
                  key={item.t}
                  onPress={() => {
                    onClose();
                    item.go();
                  }}
                  accessibilityRole="button"
                  style={[
                    styles.sheetTile,
                    first ? styles.sheetFirst : null,
                    { backgroundColor: first ? palette.accent : palette.surface },
                  ]}
                >
                  <Icon name={item.icon} size={22} color={fg} />
                  <View>
                    <Text style={[styles.sheetTitle, { color: fg }]}>{item.t}</Text>
                    <Text style={[styles.sheetMeta, { color: fg }]}>{item.m}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Mark({ palette }: { palette: Palette }) {
  return (
    <View style={[styles.mark, { backgroundColor: palette.text }]} accessibilityLabel="VaultP">
      {Array.from({ length: 9 }, (_, index) => (
        <View
          key={index}
          style={[styles.markDot, { backgroundColor: index === 4 ? palette.accent : palette.background }]}
        />
      ))}
    </View>
  );
}

function RoundButton({
  palette,
  icon,
  label,
  onPress,
}: {
  palette: Palette;
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={[styles.round, { borderColor: palette.border }]}
    >
      <Icon name={icon} size={18} color={palette.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // The app draws edge to edge, so the bar clears the status bar itself; the
  // screens below it no longer pad for it.
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 6 },
  grow: { flex: 1 },
  name: { fontFamily: fonts.monoBold, fontSize: 12, letterSpacing: 2.6 },
  mark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: 5,
  },
  markDot: { width: 4, height: 4, borderRadius: 2 },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  tabWrap: { paddingHorizontal: 12, paddingTop: 8 },
  tabBar: { height: 64, borderRadius: 32, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  tab: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', gap: 5 },
  tabDot: { width: 4, height: 4, borderRadius: 2 },
  create: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },

  seg: { flexDirection: 'row', gap: 4, padding: 4, marginHorizontal: 12, marginBottom: 6, borderRadius: 999 },
  segItem: { flex: 1, height: 40, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },

  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { margin: 8, padding: 8, borderRadius: 28 },
  sheetGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sheetTile: { width: '48.6%', minHeight: 104, borderRadius: 20, padding: 16, justifyContent: 'space-between', gap: 12 },
  sheetFirst: { width: '100%' },
  sheetTitle: { fontFamily: fonts.uiSemibold, fontSize: 16, letterSpacing: -0.2 },
  sheetMeta: { fontFamily: fonts.ui, fontSize: 12, opacity: 0.72, marginTop: 2 },
});
