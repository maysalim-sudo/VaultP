/**
 * One document: the scan, and what the app needs to be useful about it.
 *
 * The image is decrypted only while this screen is open, into the cache, and the
 * copy is removed when it closes. The vault copy on disk is never plaintext.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
} from 'react-native';

import { addDays, isValidDate, type VaultDocument } from '@vaultp/core';

import { DateField, describeDate } from '../components/DateField.js';
import { fonts, paletteFor } from '../components/theme.js';
import {
  clearPreviews,
  decryptForViewing,
  deleteEncrypted,
} from '../documents/fileStore.js';
import { useOpenVault } from '../vault/VaultContext.js';

/**
 * Lead times that match how long renewal actually takes. A passport is months of
 * queueing; a card is a phone call.
 */
const LEAD_TIMES: ReadonlyArray<{ days: number; label: string }> = [
  { days: 180, label: '6 months' },
  { days: 90, label: '3 months' },
  { days: 60, label: '2 months' },
  { days: 30, label: '1 month' },
  { days: 7, label: '1 week' },
];

export function DocumentDetail({
  document,
  onClose,
}: {
  document: VaultDocument;
  onClose: () => void;
}) {
  const { vault, version, mutate } = useOpenVault();
  const palette = paletteFor(useColorScheme());

  const [title, setTitle] = useState(document.title);
  const [expiry, setExpiry] = useState(document.expiryDate ?? '');
  const [note, setNote] = useState(document.note ?? '');
  const [lead, setLead] = useState(document.reminderLeadDays);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const current = vault.documents.getDocument(document.id) ?? document;
  const file = current.fileId ? vault.documents.getFile(current.fileId) : undefined;

  useEffect(() => {
    let cancelled = false;
    if (!file) return;

    void decryptForViewing(vault.keys, file)
      .then((uri) => {
        if (!cancelled) setPreviewUri(uri);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setPreviewError(caught instanceof Error ? caught.message : String(caught));
        }
      });

    return () => {
      cancelled = true;
      // The decrypted copy exists only while it is on screen.
      clearPreviews();
    };
  }, [vault, version, file?.id]);

  const expiryValid = isValidDate(expiry.trim());

  function save() {
    const trimmed = title.trim();
    if (trimmed === '') return;

    mutate((v) =>
      v.documents.updateDocument(document.id, {
        title: trimmed,
        expiryDate: expiry.trim() === '' ? null : expiry.trim(),
        reminderLeadDays: lead,
        note,
      }),
    );
    onClose();
  }

  function remove() {
    Alert.alert(
      'Delete this document?',
      'The scan is erased from the device for good. The record of the deletion stays in the history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            // Bytes first: a soft-deleted row that still had a readable scan on
            // disk would defeat the point of deleting it.
            deleteEncrypted(file?.encryptedPath ?? null);
            mutate((v) => v.documents.deleteDocument(document.id));
            onClose();
          },
        },
      ],
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { backgroundColor: palette.background }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.dim }]}>Back</Text>
          </Pressable>
          <Pressable onPress={save} hitSlop={12}>
            <Text style={[styles.headerAction, { color: palette.accentText }]}>Save</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={[styles.preview, { backgroundColor: palette.surface }]}>
            {previewUri ? (
              <Image
                source={{ uri: previewUri }}
                style={styles.image}
                resizeMode="contain"
              />
            ) : previewError ? (
              <Text style={[styles.previewError, { color: palette.danger }]}>
                {previewError}
              </Text>
            ) : file ? (
              <ActivityIndicator />
            ) : (
              <Text style={{ color: palette.dim }}>No image</Text>
            )}
          </View>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Passport, insurance, lease…"
            placeholderTextColor={palette.dim}
            style={[
              styles.input,
              {
                color: palette.text,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              },
            ]}
          />

          <Text style={[styles.label, { color: palette.dim }]}>Expires on</Text>
          <DateField
            value={expiry}
            onChange={setExpiry}
            placeholder="No expiry date"
            palette={palette}
          />

          {expiryValid ? (
            <>
              <Text style={[styles.label, { color: palette.dim }]}>Warn me</Text>
              <View style={styles.chips}>
                {LEAD_TIMES.map((option) => (
                  <Pressable
                    key={option.days}
                    onPress={() => setLead(option.days)}
                    style={[
                      styles.chip,
                      { borderColor: palette.border, backgroundColor: palette.surface },
                      lead === option.days
                        ? { backgroundColor: palette.text, borderColor: palette.text }
                        : null,
                    ]}
                  >
                    <Text style={[styles.chipText, { color: lead === option.days ? palette.background : palette.text }]}>
                      {option.label} before
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[styles.hint, { color: palette.dim }]}>
                First warning on {describeDate(addDays(expiry.trim(), -lead))}.
              </Text>
            </>
          ) : null}

          <Text style={[styles.label, { color: palette.dim }]}>Note</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Where the original is kept, reference numbers…"
            placeholderTextColor={palette.dim}
            multiline
            style={[
              styles.input,
              styles.multiline,
              {
                color: palette.text,
                borderColor: palette.border,
                backgroundColor: palette.surface,
              },
            ]}
          />

          <Pressable onPress={remove} style={styles.delete}>
            <Text style={{ color: palette.danger, fontWeight: '600' }}>
              Delete this document
            </Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
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
  headerAction: { fontFamily: fonts.uiSemibold, fontSize: 16, },

  body: { paddingHorizontal: 20, paddingBottom: 48, gap: 10 },
  preview: {
    height: 260,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  previewError: { paddingHorizontal: 16, textAlign: 'center', fontFamily: fonts.ui, fontSize: 13 },

  label: { fontFamily: fonts.ui, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: fonts.ui, fontSize: 16 },
  multiline: { minHeight: 84, textAlignVertical: 'top' },
  hint: { fontFamily: fonts.ui, fontSize: 12 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1 },

  chipText: { fontFamily: fonts.uiMedium, fontSize: 13 },
  delete: { alignItems: 'center', paddingVertical: 20 },
});
