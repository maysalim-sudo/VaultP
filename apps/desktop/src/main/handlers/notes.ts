/** Note operations. */

import { ipcMain } from 'electron';

import type { Note } from '@vaultp/core';

import type { NoteDto, NoteFormDto } from '../../shared/api.js';
import type { DesktopVault } from '../vault.js';

export function toNoteDto(note: Note): NoteDto {
  return {
    id: note.id,
    body: note.body,
    dueOn: note.dueOn,
    remind: note.notify,
    done: note.done,
    pinned: note.pinned,
  };
}

export function registerNoteHandlers(requireVault: () => DesktopVault): void {
  ipcMain.handle('notes:list', (_event, includeDone: boolean): NoteDto[] => {
    const vault = requireVault();
    const open = vault.notes.listOpen().map(toNoteDto);
    return includeDone ? [...open, ...vault.notes.listDone().map(toNoteDto)] : open;
  });

  ipcMain.handle('notes:add', (_event, form: NoteFormDto) => {
    const created = requireVault().notes.addNote({
      body: form.body,
      pinned: form.pinned,
      // A reminder with no date has nothing to fire on, so it is not carried.
      ...(form.dueOn ? { dueOn: form.dueOn, notify: form.remind } : {}),
    });
    return { id: created.id };
  });

  ipcMain.handle('notes:update', (_event, id: string, form: NoteFormDto) => {
    requireVault().notes.updateNote(id, {
      body: form.body,
      // Null clears the date, and core clears the reminder with it.
      dueOn: form.dueOn === '' ? null : form.dueOn,
      notify: form.dueOn === '' ? false : form.remind,
      pinned: form.pinned,
    });
  });

  ipcMain.handle('notes:setDone', (_event, id: string, done: boolean) => {
    requireVault().notes.setDone(id, done);
  });

  ipcMain.handle('notes:delete', (_event, id: string) => {
    requireVault().notes.deleteNote(id);
  });
}
