/**
 * The document vault.
 *
 * Two things drive the layout: whatever ends soonest leads the page, its days
 * left in dot-matrix, because that is the one thing the app can tell you that you
 * would not otherwise notice; and adding a document is a single button, because a
 * vault that is tedious to add to stays empty.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { daysBetween, todayIn, type VaultDocument } from '@vaultp/core';

import { describeDate } from '../components/DateField.js';
import { Button, Empty, Figure, Label, PageHead, Tile } from '../components/Industrial.js';
import { Icon } from '../components/icons.js';
import { fonts, paletteFor, type Palette } from '../components/theme.js';
import { Screen } from '../components/Screen.js';
import { importFile } from '../documents/fileStore.js';
import { recogniseText, suggestTitle } from '../documents/ocr.js';
import type { IntentProps } from '../navigation.js';
import { useOpenVault } from '../vault/VaultContext.js';
import { DocumentDetail } from './DocumentDetail.js';

export function Documents({ onClose, intent, onIntentHandled }: { onClose?: () => void } & IntentProps) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());
  const today = todayIn();

  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<VaultDocument | null>(null);

  // Arriving from search or Home: open that document.
  useEffect(() => {
    if (!intent) return;
    if (intent.kind === 'document') {
      const found = vault.documents.getDocument(intent.id);
      if (found) setOpen(found);
    }
    onIntentHandled?.();
  }, [intent, vault, onIntentHandled]);

  const documents = useMemo(
    () =>
      search.trim() === ''
        ? vault.documents.listDocuments()
        : vault.documents.searchDocuments(search),
    [vault, version, search],
  );

  const expiring = useMemo(
    () => (search.trim() === '' ? vault.documents.expiringSoon(today) : []),
    [vault, version, today, search],
  );

  async function capture(source: 'camera' | 'library') {
    setError(null);

    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setError(
        source === 'camera'
          ? 'Camera access is needed to photograph a document.'
          : 'Photo access is needed to pick a document.',
      );
      return;
    }

    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.8 });

    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];

    setBusy(true);
    try {
      // Read the text before encrypting: OCR needs the plaintext image, and the
      // one the picker handed us is the only plaintext copy that will exist.
      const recognised = await recogniseText(asset.uri);
      const imported = await importFile(vault.keys, asset.uri);

      // Recognising the same scan twice is worth a question, not a silent second
      // copy — and not a silent refusal either, since a genuine reason to keep two
      // does exist.
      const duplicate = vault.documents.findByHash(imported.sha256);
      if (duplicate) {
        setBusy(false);
        Alert.alert(
          'Already in the vault',
          'This exact image is stored already. Add it a second time?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add anyway',
              onPress: () => createDocument(imported, asset, recognised?.text),
            },
          ],
        );
        return;
      }

      createDocument(imported, asset, recognised?.text);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function createDocument(
    imported: Awaited<ReturnType<typeof importFile>>,
    asset: ImagePicker.ImagePickerAsset,
    extractedText?: string,
  ) {
    const created = mutate((v) => {
      const file = v.documents.addFile({
        id: imported.id,
        filename: asset.fileName ?? 'scan.jpg',
        mime: asset.mimeType ?? 'image/jpeg',
        sizeBytes: imported.sizeBytes,
        sha256: imported.sha256,
        encryptedPath: imported.encryptedPath,
        ...(asset.width ? { width: asset.width } : {}),
        ...(asset.height ? { height: asset.height } : {}),
      });

      return v.documents.addDocument({
        title: (extractedText ? suggestTitle(extractedText) : undefined) ?? 'Untitled document',
        fileId: file.id,
        ...(extractedText ? { extractedText } : {}),
      });
    });

    // Straight into the detail screen: a document with no title or expiry is not
    // yet useful, and this is the moment the user knows what it is.
    if (created) setOpen(created);
  }

  // The one that ends soonest, if anything is ending: it leads the page.
  const next = expiring[0];
  const nextDays = next?.expiryDate ? daysBetween(today, next.expiryDate) : null;

  return (
    <Screen onClose={onClose}>
      <View style={styles.page}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <PageHead title="Documents" palette={palette} />

          <View style={[styles.search, { backgroundColor: palette.surface }]}>
            <Icon name="search" size={17} color={palette.dim} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Titles, notes and text inside scans"
              placeholderTextColor={palette.textFaint}
              style={[styles.searchInput, { color: palette.text }]}
            />
          </View>

          {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

          {next && nextDays !== null ? (
            <Tile palette={palette} onPress={() => setOpen(next)} label={`Open ${next.title}`}>
              <Label palette={palette}>
                {next.title.toUpperCase()} {nextDays < 0 ? 'ENDED' : 'ENDS IN'}
              </Label>
              <Figure
                value={String(Math.abs(nextDays))}
                unit={`${nextDays < 0 ? 'DAYS AGO' : 'DAYS'} · ${describeDate(next.expiryDate!).toUpperCase()}`}
                size={64}
                colour={palette.accentText}
                palette={palette}
              />
            </Tile>
          ) : null}

          {documents.length === 0 ? (
            <Empty palette={palette}>
              {search.trim() === ''
                ? 'NOTHING STORED YET. A PASSPORT, A CONTRACT, AN INSURANCE PAPER: ANYTHING YOU WOULD HUNT FOR IN A DRAWER.'
                : 'NOTHING MATCHES'}
            </Empty>
          ) : (
            documents.map((document) => (
              <DocumentTile
                key={document.id}
                document={document}
                today={today}
                palette={palette}
                onPress={() => setOpen(document)}
              />
            ))
          )}

          <Button
            label={busy ? 'Reading the scan…' : 'Scan a document'}
            icon="scan"
            disabled={busy}
            palette={palette}
            onPress={() => void capture('camera')}
          />
          <Pressable
            onPress={() => void capture('library')}
            disabled={busy}
            hitSlop={8}
            accessibilityRole="button"
            style={styles.gallery}
          >
            <Text style={[styles.galleryText, { color: palette.dim }]}>Or choose from the gallery</Text>
          </Pressable>
        </ScrollView>

        {open ? (
          <DocumentDetail
            document={open}
            onClose={() => setOpen(null)}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function DocumentTile({
  document,
  today,
  palette,
  onPress,
}: {
  document: VaultDocument;
  today: string;
  palette: Palette;
  onPress: () => void;
}) {
  const days = document.expiryDate ? daysBetween(today, document.expiryDate) : null;
  const expired = days !== null && days < 0;
  const soon = days !== null && days < document.reminderLeadDays;

  return (
    <Tile palette={palette} style={styles.doc} onPress={onPress} label={`Open ${document.title}`}>
      <View style={[styles.thumb, { backgroundColor: palette.key, borderColor: palette.border }]}>
        {[70, 100, 90, 60].map((width, index) => (
          <View key={index} style={[styles.thumbLine, { width: `${width}%`, backgroundColor: palette.border }]} />
        ))}
      </View>
      <View style={styles.docMain}>
        <Label palette={palette}>{(document.kind ?? 'Document').toUpperCase()}</Label>
        <Text style={[styles.docTitle, { color: palette.text }]} numberOfLines={1}>
          {document.title}
        </Text>
        <Text style={[styles.docMeta, { color: palette.dim }]} numberOfLines={1}>
          {document.extractedText ? 'Text read' : document.note || 'Stored encrypted'}
        </Text>
      </View>
      {document.expiryDate ? (
        <View style={[styles.badge, { backgroundColor: soon || expired ? palette.accent : palette.key }]}>
          <Text style={[styles.badgeText, { color: soon || expired ? palette.onAccent : palette.dim }]}>
            {expired ? 'EXPIRED' : 'EXP'} {document.expiryDate.slice(5, 7)}.{document.expiryDate.slice(0, 4)}
          </Text>
        </View>
      ) : null}
    </Tile>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  body: { paddingHorizontal: 12, paddingBottom: 16, gap: 10 },

  search: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 18, borderRadius: 26 },
  searchInput: { flex: 1, fontFamily: fonts.uiMedium, fontSize: 15, padding: 0 },
  error: { fontFamily: fonts.uiSemibold, fontSize: 13, paddingHorizontal: 6 },

  doc: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, minHeight: 88 },
  thumb: { width: 48, height: 60, borderRadius: 8, borderWidth: 1, padding: 8, gap: 4 },
  thumbLine: { height: 3, borderRadius: 2 },
  docMain: { flex: 1, minWidth: 0, gap: 3 },
  docTitle: { fontFamily: fonts.uiSemibold, fontSize: 15 },
  docMeta: { fontFamily: fonts.ui, fontSize: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontFamily: fonts.monoMedium, fontSize: 9, letterSpacing: 0.8 },

  gallery: { alignItems: 'center', paddingVertical: 8 },
  galleryText: { fontFamily: fonts.uiMedium, fontSize: 14 },
});
