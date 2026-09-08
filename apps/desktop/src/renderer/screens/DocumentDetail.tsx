/**
 * One document: what it is, when it expires, and the scan if this device has it.
 *
 * The scan is fetched decrypted into the window's memory as a data URL. Nothing
 * plaintext is written to disk unless the user explicitly asks for a copy.
 */

import { useEffect, useState } from 'react';

import type { DocumentFormDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { api, useRunner, useVaultQuery } from '../vault.js';

export function DocumentDetail({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}) {
  const documents = useVaultQuery(() => api().listDocuments(''));
  const tags = useVaultQuery(() => api().listTags());
  const { busy, error, run } = useRunner();

  const document = documents.data?.find((candidate) => candidate.id === documentId);
  const [form, setForm] = useState<DocumentFormDto | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [newTag, setNewTag] = useState('');

  const canPreview = document?.file?.presentHere === true;
  const isImage = document?.file?.mime?.startsWith('image/') === true;
  // HEIC is an image the preview can show but Tesseract cannot read.
  const canRead = isImage && document?.file?.mime !== 'image/heic';

  useEffect(() => {
    if (!canPreview || !isImage) return;
    let current = true;

    void api()
      .previewDocument(documentId)
      .then((url) => {
        if (current) setPreview(url);
      })
      .catch((caught: unknown) => {
        if (current) setPreviewError(caught instanceof Error ? caught.message : String(caught));
      });

    return () => {
      current = false;
    };
  }, [documentId, canPreview, isImage]);

  if (!document) return null;

  const state: DocumentFormDto = form ?? {
    title: document.title,
    expiryDate: document.expiryDate ?? '',
    reminderLeadDays: document.reminderLeadDays,
    note: document.note ?? '',
    kind: document.kind ?? '',
  };

  return (
    <Modal
      title={document.title}
      onClose={onClose}
      footer={
        <>
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api().deleteDocument(documentId);
                onClose();
              })
            }
          >
            Delete
          </button>
          {document.file ? (
            <button
              className="secondary"
              disabled={busy || !canPreview}
              onClick={() => void run(() => api().exportDocument(documentId))}
            >
              Save a copy
            </button>
          ) : null}
          <span className="spacer" />
          <button
            disabled={busy || state.title.trim() === ''}
            onClick={() =>
              void run(async () => {
                await api().updateDocument(documentId, state);
                onClose();
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      {preview ? <img className="preview" src={preview} alt={document.title} /> : null}
      {previewError ? <p className="warn small">{previewError}</p> : null}
      {document.file && !canPreview ? (
        <p className="warn small">
          The scan is not on this computer yet. Sync fetches it once the device that
          took it has pushed it.
        </p>
      ) : null}

      <Field label="Title">
        <input
          value={state.title}
          onChange={(event) => setForm({ ...state, title: event.target.value })}
        />
      </Field>

      <div className="row">
        <Field label="Expires">
          <input
            type="date"
            value={state.expiryDate}
            onChange={(event) => setForm({ ...state, expiryDate: event.target.value })}
          />
        </Field>
        <Field label="Remind this many days before">
          <input
            type="number"
            min={0}
            value={state.reminderLeadDays}
            onChange={(event) =>
              setForm({
                ...state,
                reminderLeadDays: Math.max(0, Number(event.target.value) || 0),
              })
            }
          />
        </Field>
        <Field label="Kind">
          <input
            value={state.kind}
            onChange={(event) => setForm({ ...state, kind: event.target.value })}
            placeholder="Passport, contract, receipt"
          />
        </Field>
      </div>

      <Field label="Note">
        <input
          value={state.note}
          onChange={(event) => setForm({ ...state, note: event.target.value })}
        />
      </Field>

      <Field label="Tags">
        <div className="row tags">
          {tags.data?.map((tag) => {
            const applied = document.tags.some((candidate) => candidate.id === tag.id);
            return (
              <button
                key={tag.id}
                className={applied ? 'tag on' : 'tag'}
                disabled={busy}
                onClick={() => void run(() => api().tagDocument(documentId, tag.id, !applied))}
              >
                {tag.name}
              </button>
            );
          })}
          <input
            className="narrow"
            value={newTag}
            onChange={(event) => setNewTag(event.target.value)}
            placeholder="New tag"
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || newTag.trim() === '') return;
              void run(async () => {
                const created = await api().addTag(newTag);
                await api().tagDocument(documentId, created.id, true);
                setNewTag('');
              });
            }}
          />
        </div>
      </Field>

      {document.extractedText ? (
        <Field label="Text recognised from the scan">
          <p className="muted small scroll">{document.extractedText}</p>
        </Field>
      ) : document.file ? (
        <div className="row">
          <span className="muted small grow">
            {canRead
              ? 'No text read from this scan yet.'
              : 'Text can only be read from an image.'}
          </span>
          <button
            className="secondary"
            disabled={busy || !canPreview || !canRead}
            onClick={() =>
              void run(async () => {
                const result = await api().recogniseDocument(documentId);
                if (!result.found) setPreviewError('Nothing readable was found in this scan.');
              })
            }
          >
            Read the text
          </button>
        </div>
      ) : null}

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
