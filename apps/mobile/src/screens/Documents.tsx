/**
 * The document vault.
 *
 * Two things drive the layout: expiring papers go at the top, because that is the
 * one thing the app can tell you that you would not otherwise notice; and adding a
 * document is a single button, because a vault that is tedious to add to stays
 * empty.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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

import { paletteFor, type Palette } from '../components/theme.js';
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

  return (
    <Screen onClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          {onClose ? (
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={[styles.headerAction, { color: palette.dim }]}>Close</Text>
            </Pressable>
          ) : (
            // Keeps the title centred in a three-slot header when there is
            // nothing to close: this screen is the page, not a layer over one.
            <View />
          )}
          <Text style={[styles.headerTitle, { color: palette.text }]}>Documents</Text>
          <View style={styles.headerSpacer} />
        </View>

        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search titles and text inside documents"
          placeholderTextColor={palette.dim}
          style={[
            styles.search,
            {
              color: palette.text,
              borderColor: palette.border,
              backgroundColor: palette.surface,
            },
          ]}
        />

        {error ? (
          <Text style={[styles.error, { color: palette.danger }]}>{error}</Text>
        ) : null}

        <ScrollView contentContainerStyle={styles.list}>
          {expiring.length > 0 ? (
            <>
              <Text style={[styles.sectionLabel, { color: palette.warning }]}>
                Needs attention
              </Text>
              {expiring.map((document) => (
                <DocumentRow
                  key={document.id}
                  document={document}
                  today={today}
                  palette={palette}
                  onPress={() => setOpen(document)}
                />
              ))}
            </>
          ) : null}

          <Text style={[styles.sectionLabel, { color: palette.dim }]}>
            {search.trim() === '' ? 'All documents' : 'Results'}
          </Text>

          {documents.length === 0 ? (
            <Text style={[styles.empty, { color: palette.dim }]}>
              {search.trim() === ''
                ? 'Nothing stored yet. Photograph a passport, a contract, an insurance paper — anything you would otherwise hunt for in a drawer.'
                : 'Nothing matches that.'}
            </Text>
          ) : (
            documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                today={today}
                palette={palette}
                onPress={() => setOpen(document)}
              />
            ))
          )}
        </ScrollView>

        <View style={styles.actions}>
          <Pressable
            onPress={() => void capture('camera')}
            disabled={busy}
            style={[styles.action, { backgroundColor: palette.accent }]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionText}>Photograph</Text>
            )}
          </Pressable>
          <Pressable
            onPress={() => void capture('library')}
            disabled={busy}
            style={[
              styles.action,
              { backgroundColor: palette.surface, borderColor: palette.border, borderWidth: 1 },
            ]}
          >
            <Text style={[styles.actionText, { color: palette.text }]}>From gallery</Text>
          </Pressable>
        </View>

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

function DocumentRow({
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

  return (
    <Pressable
      onPress={onPress}
      style={[styles.row, { borderBottomColor: palette.divider }]}
      android_ripple={{ color: palette.ripple }}
    >
      <View style={styles.rowMain}>
        <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
          {document.title}
        </Text>
        {days !== null ? (
          <Text
            style={[
              styles.meta,
              { color: expired ? palette.negative : days < 30 ? palette.warning : palette.dim },
            ]}
          >
            {expired
              ? `expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
              : `expires in ${days} day${days === 1 ? '' : 's'} · ${document.expiryDate}`}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: 52 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  headerTitle: { fontWeight: '700', fontSize: 17 },
  headerAction: { fontSize: 16, fontWeight: '600' },
  headerSpacer: { width: 44 },

  search: {
    marginHorizontal: 20,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  error: { paddingHorizontal: 20, paddingTop: 10, fontSize: 13, fontWeight: '600' },

  list: { paddingHorizontal: 20, paddingBottom: 24 },
  sectionLabel: {
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 22,
    marginBottom: 4,
  },
  empty: { paddingVertical: 28, lineHeight: 20 },
  row: {
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowMain: { gap: 3 },
  title: { fontSize: 16, fontWeight: '600' },
  meta: { fontSize: 12 },

  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingVertical: 16 },
  action: { flex: 1, alignItems: 'center', paddingVertical: 15, borderRadius: 14 },
  actionText: { color: '#fff', fontWeight: '700' },
});
