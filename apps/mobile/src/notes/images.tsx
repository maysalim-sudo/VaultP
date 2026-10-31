/**
 * Images inside notes: bringing them in, and showing them.
 *
 * Three ways in — the gallery, the camera, and a screenshot on the clipboard —
 * and all three end the same way: the bytes are encrypted into the vault before
 * anything else happens, and the note holds only the file's id. A pasted
 * screenshot never touches disk as plaintext at all.
 *
 * Showing one means decrypting it to the preview cache. Cards in the grid would
 * otherwise decrypt the same image on every render, so decrypted copies are
 * remembered by file id — and checked for on disk before reuse, because opening
 * a document clears the whole preview cache when it closes.
 */

import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp } from 'react-native';
import { toByteArray } from 'react-native-quick-base64';

import type { StoredFile, VaultKeys } from '@vaultp/core';

import { fonts } from '../components/theme.js';
import { decryptForViewing, deleteEncrypted, importBytes, importFile } from '../documents/fileStore.js';
import type { OpenVault } from '../vault/open.js';

export type ImageSource = 'library' | 'camera' | 'clipboard';

export interface AddedImage {
  readonly fileId: string;
  readonly width: number | null;
  readonly height: number | null;
}

export class ImageImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageImportError';
  }
}

/** Whether there is an image on the clipboard to paste. */
export async function clipboardHasImage(): Promise<boolean> {
  try {
    return await Clipboard.hasImageAsync();
  } catch {
    return false;
  }
}

/**
 * Bring an image into the vault. Returns null if the person backed out.
 *
 * `record` commits the file row; it is passed in so the caller decides how the
 * write is wrapped (the app's `mutate`, which refreshes the screens).
 */
export async function addImage(
  keys: VaultKeys,
  source: ImageSource,
  record: (fn: (vault: OpenVault) => StoredFile) => StoredFile | undefined,
): Promise<AddedImage | null> {
  if (source === 'clipboard') {
    const pasted = await Clipboard.getImageAsync({ format: 'png' });
    if (!pasted) throw new ImageImportError('There is no image on the clipboard.');

    const base64 = pasted.data.replace(/^data:[^,]*,/, '');
    const imported = await importBytes(keys, toByteArray(base64));
    const file = record((v) =>
      v.notes.addImageFile({
        id: imported.id,
        encryptedPath: imported.encryptedPath,
        sha256: imported.sha256,
        sizeBytes: imported.sizeBytes,
        mime: 'image/png',
        filename: 'pasted.png',
        width: pasted.size.width,
        height: pasted.size.height,
      }),
    );
    return file ? { fileId: file.id, width: pasted.size.width, height: pasted.size.height } : null;
  }

  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new ImageImportError(
      source === 'camera'
        ? 'Camera access is needed to take a photo.'
        : 'Photo access is needed to pick an image.',
    );
  }

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.85 })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.85, mediaTypes: ['images'] });
  if (result.canceled || !result.assets[0]) return null;

  const asset = result.assets[0];
  const imported = await importFile(keys, asset.uri);
  const file = record((v) =>
    v.notes.addImageFile({
      id: imported.id,
      encryptedPath: imported.encryptedPath,
      sha256: imported.sha256,
      sizeBytes: imported.sizeBytes,
      mime: asset.mimeType ?? 'image/jpeg',
      filename: asset.fileName ?? 'image.jpg',
      ...(asset.width ? { width: asset.width } : {}),
      ...(asset.height ? { height: asset.height } : {}),
    }),
  );
  return file ? { fileId: file.id, width: asset.width || null, height: asset.height || null } : null;
}

/** Remove released files' ciphertext from this device. Sync handles the rest. */
export function removeReleased(files: readonly StoredFile[]): void {
  for (const file of files) {
    try {
      deleteEncrypted(file.encryptedPath);
    } catch {
      // Already gone is the outcome wanted.
    }
  }
}

// ------------------------------------------------------------------ display

const decrypted = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

async function viewableUri(keys: VaultKeys, file: StoredFile): Promise<string> {
  const known = decrypted.get(file.id);
  if (known && new File(known).exists) return known;

  let pending = inFlight.get(file.id);
  if (!pending) {
    pending = decryptForViewing(keys, file).finally(() => inFlight.delete(file.id));
    inFlight.set(file.id, pending);
  }
  const uri = await pending;
  decrypted.set(file.id, uri);
  return uri;
}

type ImageState =
  | { status: 'loading' }
  | { status: 'ready'; uri: string }
  | { status: 'missing'; reason: string };

export function useNoteImage(vault: OpenVault, fileId: string): ImageState {
  const [state, setState] = useState<ImageState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const file = vault.notes.getFile(fileId);
    if (!file) {
      setState({ status: 'missing', reason: 'Image removed' });
      return;
    }
    viewableUri(vault.keys, file)
      .then((uri) => {
        if (!cancelled) setState({ status: 'ready', uri });
      })
      .catch(() => {
        // Most often: the image was added on the other device and its bytes
        // have not synced here yet. Say so rather than show a broken frame.
        if (!cancelled) setState({ status: 'missing', reason: 'Not on this device yet — sync to fetch it' });
      });
    return () => {
      cancelled = true;
    };
  }, [vault, fileId]);

  return state;
}

/**
 * An image block, sized from its known dimensions so the layout does not jump
 * when the decrypted bytes arrive.
 */
export function NoteImage({
  vault,
  fileId,
  width,
  height,
  maxHeight,
  style,
  placeholderColour,
  textColour,
  onPress,
  onLongPress,
}: {
  vault: OpenVault;
  fileId: string;
  width: number | null;
  height: number | null;
  maxHeight?: number;
  style?: StyleProp<ImageStyle>;
  placeholderColour: string;
  textColour: string;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const state = useNoteImage(vault, fileId);
  const ratio = width && height ? width / height : 4 / 3;

  const frame = [
    styles.frame,
    { aspectRatio: ratio, backgroundColor: placeholderColour },
    maxHeight !== undefined ? { maxHeight } : null,
    style,
  ];

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} disabled={!onPress && !onLongPress}>
      {state.status === 'ready' ? (
        <Image source={{ uri: state.uri }} style={frame} resizeMode="cover" />
      ) : (
        <View style={[frame, styles.placeholder]}>
          {state.status === 'missing' ? (
            <Text style={[styles.placeholderText, { color: textColour }]}>{state.reason}</Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%' },
  placeholder: { alignItems: 'center', justifyContent: 'center', padding: 12 },
  placeholderText: { fontFamily: fonts.ui, fontSize: 12, textAlign: 'center', opacity: 0.8 },
});
