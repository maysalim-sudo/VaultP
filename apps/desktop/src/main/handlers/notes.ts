/**
 * Note operations: the same rich notes the phone makes — blocks, images,
 * folders, labels, archive, hand-arranged order.
 *
 * Blocks cross the bridge as they are. They are plain data, and the window runs
 * the same pure block helpers from core that the phone does, so the two editors
 * cannot disagree about what a checklist or a table is.
 *
 * Images are encrypted here on the way in and decrypted here on the way out, as
 * data URLs held only in the window's memory. The window never sees a key or a
 * path; a note only ever holds a file id.
 */

import { basename } from 'node:path';

import { app, clipboard, dialog, ipcMain, nativeImage } from 'electron';

import { readSetting, writeSetting, type Note, type StoredFile } from '@vaultp/core';

import type {
  NoteDto,
  NoteFolderDto,
  NoteImageDto,
  NoteInputDto,
  NotePatchDto,
  NotesQueryDto,
  TagDto,
} from '../../shared/api.js';
import { decryptFile, deleteEncrypted, importBytes, importFile } from '../fileStore.js';
import type { DesktopVault } from '../vault.js';

const LAYOUT_SETTING = 'notes_layout';

function vaultRoot(): string {
  return app.getPath('userData');
}

export function toNoteDto(note: Note, labels: readonly TagDto[] = []): NoteDto {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    body: note.body,
    dueOn: note.dueOn,
    remind: note.notify,
    done: note.done,
    pinned: note.pinned,
    archived: note.archived,
    colour: note.colour,
    folderId: note.folderId,
    labels,
    checklist: note.checklist,
    updatedAt: note.updatedAt,
  };
}

/** Released files' ciphertext goes now; sync removes the copies elsewhere. */
async function removeReleased(files: readonly StoredFile[]): Promise<void> {
  for (const file of files) await deleteEncrypted(vaultRoot(), file.encryptedPath);
}

export function registerNoteHandlers(requireVault: () => DesktopVault): void {
  const dto = (vault: DesktopVault, note: Note) => toNoteDto(note, vault.notes.labelsFor(note.id));

  ipcMain.handle('notes:list', (_event, query: NotesQueryDto): NoteDto[] => {
    const vault = requireVault();
    const { notes } = vault;
    const term = query.search?.trim().toLowerCase() ?? '';

    let list: Note[];
    if (term !== '') {
      // Everything, wherever it is filed: searching is not the moment to
      // remember which folder something went in.
      list = [...notes.listArranged(), ...notes.listArchived(), ...notes.listDone(500)].filter(
        (note) => note.title.toLowerCase().includes(term) || note.body.toLowerCase().includes(term),
      );
    } else {
      switch (query.view) {
        case 'folder':
          list = notes.listArranged(query.id ?? null);
          break;
        case 'label': {
          const ids = query.id ? notes.notesLabelled(query.id) : new Set<string>();
          list = [...notes.listArranged(), ...notes.listDone(500), ...notes.listArchived()].filter((note) =>
            ids.has(note.id),
          );
          break;
        }
        case 'archive':
          list = notes.listArchived();
          break;
        case 'done':
          list = notes.listDone(500);
          break;
        default:
          list = notes.listArranged();
      }
    }
    return list.map((note) => dto(vault, note));
  });

  ipcMain.handle('notes:get', (_event, id: string): NoteDto | null => {
    const vault = requireVault();
    const note = vault.notes.getNote(id);
    return note ? dto(vault, note) : null;
  });

  ipcMain.handle('notes:add', (_event, input: NoteInputDto) => {
    const vault = requireVault();
    const created = vault.notes.addNote({
      title: input.title,
      content: input.content,
      colour: input.colour,
      pinned: input.pinned,
      folderId: input.folderId,
      // A reminder with no date has nothing to fire on, so it is not carried.
      ...(input.dueOn ? { dueOn: input.dueOn, notify: input.remind } : {}),
    });
    if (input.archived) vault.notes.updateNote(created.id, { archived: true });
    for (const labelId of input.labelIds) vault.notes.addLabel(created.id, labelId);
    return { id: created.id };
  });

  ipcMain.handle('notes:save', async (_event, id: string, patch: NotePatchDto) => {
    const vault = requireVault();
    const { note, released } = vault.notes.saveNote(id, {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.colour !== undefined ? { colour: patch.colour } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
      ...(patch.dueOn !== undefined
        ? {
            // Empty clears the date, and core clears the reminder with it.
            dueOn: patch.dueOn === '' ? null : patch.dueOn,
            notify: patch.dueOn === '' ? false : (patch.remind ?? false),
          }
        : patch.remind !== undefined
          ? { notify: patch.remind }
          : {}),
    });
    if (patch.folderId !== undefined && note.folderId !== patch.folderId) {
      vault.notes.moveToFolder(id, patch.folderId);
    }
    if (patch.labelIds !== undefined) {
      const current = new Set(vault.notes.labelsFor(id).map((label) => label.id));
      const wanted = new Set(patch.labelIds);
      for (const labelId of wanted) if (!current.has(labelId)) vault.notes.addLabel(id, labelId);
      for (const labelId of current) if (!wanted.has(labelId)) vault.notes.removeLabel(id, labelId);
    }
    await removeReleased(released);
  });

  ipcMain.handle('notes:setDone', (_event, id: string, done: boolean) => {
    requireVault().notes.setDone(id, done);
  });

  ipcMain.handle('notes:delete', async (_event, id: string) => {
    await removeReleased(requireVault().notes.deleteNote(id));
  });

  ipcMain.handle('notes:duplicate', (_event, id: string) => ({
    id: requireVault().notes.duplicateNote(id).id,
  }));

  ipcMain.handle(
    'notes:place',
    (_event, id: string, after: string | null, before: string | null, pinned?: boolean) => {
      requireVault().notes.placeNote(id, after, before, pinned);
    },
  );

  // ---------------------------------------------------------------- labels

  ipcMain.handle('notes:labels', (): TagDto[] => requireVault().notes.listLabels());

  ipcMain.handle('notes:ensureLabel', (_event, name: string): TagDto => requireVault().notes.ensureLabel(name));

  ipcMain.handle('notes:setLabel', (_event, noteId: string, tagId: string, on: boolean) => {
    const vault = requireVault();
    if (on) vault.notes.addLabel(noteId, tagId);
    else vault.notes.removeLabel(noteId, tagId);
  });

  // --------------------------------------------------------------- folders

  ipcMain.handle('notes:folders', (): NoteFolderDto[] =>
    requireVault()
      .notes.listFolders()
      .map((folder) => ({ id: folder.id, name: folder.name })),
  );

  ipcMain.handle('notes:addFolder', (_event, name: string): NoteFolderDto => {
    const folder = requireVault().notes.addFolder(name);
    return { id: folder.id, name: folder.name };
  });

  ipcMain.handle('notes:renameFolder', (_event, id: string, name: string) => {
    requireVault().notes.renameFolder(id, name);
  });

  ipcMain.handle('notes:deleteFolder', (_event, id: string) => {
    requireVault().notes.deleteFolder(id);
  });

  ipcMain.handle('notes:moveToFolder', (_event, noteId: string, folderId: string | null) => {
    requireVault().notes.moveToFolder(noteId, folderId);
  });

  // ---------------------------------------------------------------- images

  ipcMain.handle('notes:imageFromFile', async (): Promise<NoteImageDto | undefined> => {
    const vault = requireVault();
    const picked = await dialog.showOpenDialog({
      title: 'Add an image to the note',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    });
    if (picked.canceled || !picked.filePaths[0]) return undefined;

    const source = picked.filePaths[0];
    const size = nativeImage.createFromPath(source).getSize();
    const imported = await importFile(vaultRoot(), vault.keys, source);
    vault.notes.addImageFile({
      id: imported.id,
      encryptedPath: imported.encryptedPath,
      sha256: imported.sha256,
      sizeBytes: imported.sizeBytes,
      mime: mimeOf(source),
      filename: basename(source),
      ...(size.width ? { width: size.width, height: size.height } : {}),
    });
    return { fileId: imported.id, width: size.width || null, height: size.height || null };
  });

  /**
   * A pasted or dropped image. The bytes arrive from the window already in
   * memory and are encrypted before anything touches the disk.
   */
  ipcMain.handle(
    'notes:imageFromBytes',
    async (_event, bytes: Uint8Array, mime: string, width: number | null, height: number | null) => {
      const vault = requireVault();
      const imported = await importBytes(vaultRoot(), vault.keys, new Uint8Array(bytes));
      vault.notes.addImageFile({
        id: imported.id,
        encryptedPath: imported.encryptedPath,
        sha256: imported.sha256,
        sizeBytes: imported.sizeBytes,
        mime: mime || 'image/png',
        filename: 'pasted',
        ...(width && height ? { width, height } : {}),
      });
      return { fileId: imported.id, width, height } satisfies NoteImageDto;
    },
  );

  /** What "Paste as a new note" would paste: an image, some text, or nothing. */
  ipcMain.handle('notes:clipboard', (): { hasImage: boolean; text: string } => ({
    hasImage: !clipboard.readImage().isEmpty(),
    text: clipboard.readText(),
  }));

  ipcMain.handle('notes:imageFromClipboard', async (): Promise<NoteImageDto | undefined> => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return undefined;
    const vault = requireVault();
    const size = image.getSize();
    const imported = await importBytes(vaultRoot(), vault.keys, new Uint8Array(image.toPNG()));
    vault.notes.addImageFile({
      id: imported.id,
      encryptedPath: imported.encryptedPath,
      sha256: imported.sha256,
      sizeBytes: imported.sizeBytes,
      mime: 'image/png',
      filename: 'pasted.png',
      width: size.width,
      height: size.height,
    });
    return { fileId: imported.id, width: size.width, height: size.height };
  });

  ipcMain.handle('notes:image', async (_event, fileId: string): Promise<string> => {
    const vault = requireVault();
    const file = vault.notes.getFile(fileId);
    if (!file) throw new Error('This image was removed.');
    const plaintext = await decryptFile(vaultRoot(), vault.keys, file);
    // A data URL, so the decrypted image exists only in the window's memory.
    return `data:${file.mime ?? 'image/png'};base64,${Buffer.from(plaintext).toString('base64')}`;
  });

  /** Images added while editing that the note no longer shows. */
  ipcMain.handle('notes:releaseImages', async (_event, fileIds: string[]) => {
    await removeReleased(requireVault().notes.releaseUnused(fileIds));
  });

  // ---------------------------------------------------------------- layout

  ipcMain.handle('notes:layout', (): 'grid' | 'list' =>
    readSetting(requireVault().store, LAYOUT_SETTING, 'grid', (v): v is 'grid' | 'list' => v === 'grid' || v === 'list'),
  );

  ipcMain.handle('notes:setLayout', (_event, layout: 'grid' | 'list') => {
    writeSetting(requireVault().store, LAYOUT_SETTING, layout);
  });
}

function mimeOf(path: string): string {
  switch (path.toLowerCase().replace(/^.*\./, '')) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    default:
      return 'image/jpeg';
  }
}
