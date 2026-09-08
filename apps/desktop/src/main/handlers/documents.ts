/**
 * Document operations.
 *
 * A document record and its scan are two different things. The record syncs; the
 * scan does not, because sync moves oplog events and the bytes are not in one.
 * So a document created on the phone arrives here complete except for the file,
 * and the window is told which case it is looking at rather than being left to
 * guess from a broken image.
 */

import { basename } from 'node:path';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

import { BrowserWindow, app, dialog, ipcMain } from 'electron';

import { todayIn, type StoredFile, type VaultDocument } from '@vaultp/core';

import type { DocumentDto, DocumentFormDto, TagDto } from '../../shared/api.js';
import { decryptFile, deleteEncrypted, importFile } from '../fileStore.js';
import { canRecognise, recogniseText } from '../ocr.js';
import type { DesktopVault } from '../vault.js';

/** Where the encrypted originals live on this machine. */
function vaultRoot(): string {
  return app.getPath('userData');
}

function presentHere(file: StoredFile | undefined): boolean {
  if (!file?.encryptedPath) return false;
  return existsSync(join(vaultRoot(), file.encryptedPath));
}

export function registerDocumentHandlers(requireVault: () => DesktopVault): void {
  function toDto(
    vault: DesktopVault,
    document: VaultDocument,
    expiring: ReadonlySet<string>,
    expired: ReadonlySet<string>,
  ): DocumentDto {
    const file = document.fileId ? vault.documents.getFile(document.fileId) : undefined;

    return {
      id: document.id,
      title: document.title,
      expiryDate: document.expiryDate,
      expiringSoon: expiring.has(document.id),
      expired: expired.has(document.id),
      reminderLeadDays: document.reminderLeadDays,
      note: document.note,
      kind: document.kind,
      extractedText: document.extractedText,
      tags: vault.documents.tagsFor(document.id),
      file: file
        ? {
            id: file.id,
            filename: file.filename,
            mime: file.mime,
            sizeBytes: file.sizeBytes,
            presentHere: presentHere(file),
          }
        : null,
    };
  }

  ipcMain.handle('documents:list', (_event, search: string): DocumentDto[] => {
    const vault = requireVault();
    const today = todayIn();
    const term = search.trim();

    const documents = term
      ? vault.documents.searchDocuments(term)
      : vault.documents.listDocuments();

    // Worked out once for the whole list rather than per row: both queries scan
    // every document, and doing that per document is quadratic for no reason.
    const expiring = new Set(vault.documents.expiringSoon(today).map((d) => d.id));
    const expired = new Set(vault.documents.expired(today).map((d) => d.id));

    return documents.map((document) => toDto(vault, document, expiring, expired));
  });

  ipcMain.handle('documents:addFromFile', async () => {
    const vault = requireVault();
    const picked = await dialog.showOpenDialog({
      title: 'Add a document to the vault',
      properties: ['openFile'],
      filters: [
        { name: 'Documents and scans', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (picked.canceled || !picked.filePaths[0]) return undefined;

    const source = picked.filePaths[0];
    const imported = await importFile(vaultRoot(), vault.keys, source);

    // The hash is of the plaintext, so the same scan encrypted twice is still
    // recognised. Re-filing an existing file under a second record would leave
    // two rows for one passport.
    const duplicate = vault.documents.findByHash(imported.sha256);
    if (duplicate) {
      await deleteEncrypted(vaultRoot(), imported.encryptedPath);
      const existing = vault.documents
        .listDocuments()
        .find((document) => document.fileId === duplicate.id);
      if (existing) return { id: existing.id };
    }

    const file = vault.documents.addFile({
      id: imported.id,
      filename: basename(source),
      mime: mimeOf(source),
      sizeBytes: imported.sizeBytes,
      sha256: imported.sha256,
      encryptedPath: imported.encryptedPath,
    });

    const created = vault.documents.addDocument({
      title: basename(source).replace(/\.[^.]+$/, ''),
      fileId: file.id,
    });

    // Recognition runs behind the import rather than inside it. The first run
    // has to start a WebAssembly worker and unpack three languages, which is
    // tens of seconds — far too long to hold a file dialog open for, and the
    // document is already usable without it.
    if (canRecognise(file.mime)) {
      void readTextInBackground(created.id);
    }

    return { id: created.id };
  });

  /**
   * Read a scan's text and file it against the document.
   *
   * Deliberately silent on failure. OCR is an aid to searching, not a step that
   * can stop a document being stored, and a photo that turns out to hold no
   * readable text is an ordinary outcome.
   */
  async function readTextInBackground(documentId: string): Promise<void> {
    try {
      const text = await recogniseFor(documentId);
      if (text === undefined) return;

      requireVault().documents.updateDocument(documentId, { extractedText: text });
      // The window asked for this document before the text existed, so it is
      // told rather than left showing the state from before.
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('vault:changed');
      }
    } catch {
      // Left without text; the manual action on the document says as much.
    }
  }

  async function recogniseFor(documentId: string): Promise<string | undefined> {
    const vault = requireVault();
    const document = vault.documents.getDocument(documentId);
    const file = document?.fileId ? vault.documents.getFile(document.fileId) : undefined;
    if (!file) throw new Error('This document has no file.');
    if (!canRecognise(file.mime)) {
      throw new Error('Text can only be read from an image.');
    }

    return recogniseText(vaultRoot(), await decryptFile(vaultRoot(), vault.keys, file));
  }

  ipcMain.handle('documents:recognise', async (_event, id: string) => {
    const text = await recogniseFor(id);
    if (text === undefined) return { found: false };

    requireVault().documents.updateDocument(id, { extractedText: text });
    return { found: true };
  });

  ipcMain.handle('documents:add', (_event, form: DocumentFormDto) => {
    const created = requireVault().documents.addDocument({
      title: form.title,
      reminderLeadDays: form.reminderLeadDays,
      ...(form.expiryDate ? { expiryDate: form.expiryDate } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
      ...(form.kind.trim() ? { kind: form.kind.trim() } : {}),
    });
    return { id: created.id };
  });

  ipcMain.handle('documents:update', (_event, id: string, form: DocumentFormDto) => {
    requireVault().documents.updateDocument(id, {
      title: form.title,
      // Null clears it. An expiry removed must actually go, or the reminder
      // outlives the reason for it.
      expiryDate: form.expiryDate === '' ? null : form.expiryDate,
      reminderLeadDays: form.reminderLeadDays,
      note: form.note.trim(),
      kind: form.kind.trim(),
    });
  });

  ipcMain.handle('documents:delete', async (_event, id: string) => {
    const vault = requireVault();
    const document = vault.documents.getDocument(id);
    const file = document?.fileId ? vault.documents.getFile(document.fileId) : undefined;

    vault.documents.deleteDocument(id);
    // The row is soft-deleted and stays in the history; the bytes go for real.
    await deleteEncrypted(vaultRoot(), file?.encryptedPath ?? null);
  });

  ipcMain.handle('documents:preview', async (_event, id: string): Promise<string> => {
    const vault = requireVault();
    const document = vault.documents.getDocument(id);
    const file = document?.fileId ? vault.documents.getFile(document.fileId) : undefined;
    if (!file) throw new Error('This document has no file.');

    const plaintext = await decryptFile(vaultRoot(), vault.keys, file);
    // A data URL, so the plaintext exists only in the window's memory. Writing
    // a decrypted copy to disk to show it would leave the scan lying around.
    return `data:${file.mime ?? 'application/octet-stream'};base64,${Buffer.from(plaintext).toString('base64')}`;
  });

  ipcMain.handle('documents:export', async (_event, id: string) => {
    const vault = requireVault();
    const document = vault.documents.getDocument(id);
    const file = document?.fileId ? vault.documents.getFile(document.fileId) : undefined;
    if (!file) throw new Error('This document has no file.');

    const picked = await dialog.showSaveDialog({
      title: 'Save a decrypted copy',
      defaultPath: file.filename ?? `${document?.title ?? 'document'}`,
    });
    if (picked.canceled || !picked.filePath) return undefined;

    await writeFile(picked.filePath, await decryptFile(vaultRoot(), vault.keys, file));
    return picked.filePath;
  });

  ipcMain.handle('documents:tags', (): TagDto[] => requireVault().documents.listTags());

  ipcMain.handle('documents:addTag', (_event, name: string) => {
    const created = requireVault().documents.addTag({ name: name.trim() });
    return { id: created.id };
  });

  ipcMain.handle(
    'documents:tagDocument',
    (_event, documentId: string, tagId: string, tagged: boolean) => {
      const vault = requireVault();
      if (tagged) vault.documents.tagDocument(documentId, tagId);
      else vault.documents.untagDocument(documentId, tagId);
    },
  );
}

/** Enough to render a preview; the file is stored whatever this returns. */
function mimeOf(path: string): string {
  switch (path.toLowerCase().replace(/^.*\./, '')) {
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'heic':
      return 'image/heic';
    default:
      return 'image/jpeg';
  }
}
