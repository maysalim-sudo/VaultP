/**
 * Notes, and the ones with a date attached.
 *
 * A reminder is only offered once there is a date, because a note that wants to
 * interrupt with no moment to do it at is a setting that does nothing.
 */

import { useState } from 'react';

import type { NoteDto, NoteFormDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { api, useRunner, useVaultQuery } from '../vault.js';

const BLANK: NoteFormDto = { body: '', dueOn: '', remind: false, pinned: false };

export function Notes() {
  const [includeDone, setIncludeDone] = useState(false);
  const notes = useVaultQuery(() => api().listNotes(includeDone));
  const { busy, error, run } = useRunner();
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<NoteDto | null>(null);

  const add = () =>
    void run(async () => {
      await api().addNote({ ...BLANK, body });
      setBody('');
    });

  return (
    <>
      <div className="head">
        <h2>Notes</h2>
        <label className="row check">
          <input
            type="checkbox"
            checked={includeDone}
            onChange={(event) => setIncludeDone(event.target.checked)}
          />
          <span className="muted small">Show done</span>
        </label>
      </div>

      <div className="row">
        <input
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Write anything"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && body.trim() !== '') add();
          }}
        />
        <button disabled={busy || body.trim() === ''} onClick={add}>
          Add
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <ul className="list">
        {notes.data?.map((note) => (
          <li key={note.id}>
            <label className="row check grow">
              <input
                type="checkbox"
                checked={note.done}
                disabled={busy}
                onChange={(event) => void run(() => api().setNoteDone(note.id, event.target.checked))}
              />
              <span className={note.done ? 'muted strike' : ''}>
                {note.pinned ? '★ ' : ''}
                {note.body}
              </span>
            </label>
            <span className="right">
              {note.dueOn ? (
                <em className={note.remind ? 'warn' : 'muted'}>
                  {note.dueOn}
                  {note.remind ? ' · reminds' : ''}
                </em>
              ) : null}
              <button className="link" onClick={() => setEditing(note)}>
                edit
              </button>
            </span>
          </li>
        ))}
      </ul>

      {notes.data?.length === 0 ? <p className="muted small">Nothing noted.</p> : null}

      {editing ? <NoteEditor note={editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function NoteEditor({ note, onClose }: { note: NoteDto; onClose: () => void }) {
  const { busy, error, run } = useRunner();
  const [form, setForm] = useState<NoteFormDto>({
    body: note.body,
    dueOn: note.dueOn ?? '',
    remind: note.remind,
    pinned: note.pinned,
  });

  return (
    <Modal
      title="Edit note"
      onClose={onClose}
      footer={
        <>
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api().deleteNote(note.id);
                onClose();
              })
            }
          >
            Delete
          </button>
          <span className="spacer" />
          <button
            disabled={busy || form.body.trim() === ''}
            onClick={() =>
              void run(async () => {
                await api().updateNote(note.id, form);
                onClose();
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <Field label="Note">
        <input
          value={form.body}
          onChange={(event) => setForm({ ...form, body: event.target.value })}
          autoFocus
        />
      </Field>

      <Field label="Due">
        <input
          type="date"
          value={form.dueOn}
          onChange={(event) => setForm({ ...form, dueOn: event.target.value })}
        />
      </Field>

      {form.dueOn ? (
        <label className="row check">
          <input
            type="checkbox"
            checked={form.remind}
            onChange={(event) => setForm({ ...form, remind: event.target.checked })}
          />
          <span>Notify me on that date</span>
        </label>
      ) : (
        <p className="muted small">Give it a date to be reminded about it.</p>
      )}

      <label className="row check">
        <input
          type="checkbox"
          checked={form.pinned}
          onChange={(event) => setForm({ ...form, pinned: event.target.checked })}
        />
        <span>Keep it at the top</span>
      </label>

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
