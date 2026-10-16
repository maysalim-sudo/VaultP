/** Documents held in the vault. */

import { useMemo, useState } from 'react';

import type { DocumentDto } from '../../shared/api.js';
import { useIntent } from '../nav.js';
import { api, useRunner, useVaultQuery } from '../vault.js';
import { DocumentDetail } from './DocumentDetail.js';

export function Documents() {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { busy, error, run } = useRunner();

  useIntent('documents', (intent) => {
    if (intent.kind === 'document') setOpen(intent.id);
    if (intent.kind === 'newDocument') {
      void run(async () => {
        const created = await api().addDocumentFromFile();
        if (created) setOpen(created.id);
      });
    }
  });

  const term = useMemo(() => search, [search]);
  const documents = useVaultQuery(() => api().listDocuments(term));

  return (
    <>
      <div className="head">
        <h2>Documents</h2>
        <div className="row">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search titles, notes and scanned text"
          />
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const created = await api().addDocumentFromFile();
                if (created) setOpen(created.id);
              })
            }
          >
            Add a file
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {documents.data?.length === 0 ? (
        <p className="muted small">
          {term ? 'Nothing matches that.' : 'Nothing stored yet.'}
        </p>
      ) : null}

      <ul className="list">
        {documents.data?.map((document) => (
          <li key={document.id} className="clickable" onClick={() => setOpen(document.id)}>
            <span>
              {document.title}
              {document.tags.length > 0 ? (
                <em className="muted"> · {document.tags.map((tag) => tag.name).join(', ')}</em>
              ) : null}
              {document.file && !document.file.presentHere ? (
                // The record arrived ahead of the bytes. Said plainly, because
                // the alternative is a broken image and a guess about why.
                <>
                  <br />
                  <em className="muted small">scan not fetched yet — sync to get it</em>
                </>
              ) : null}
            </span>
            {document.expiryDate ? (
              <span className={expiryClass(document)}>expires {document.expiryDate}</span>
            ) : null}
          </li>
        ))}
      </ul>

      {open ? <DocumentDetail documentId={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function expiryClass(document: DocumentDto): string {
  if (document.expired) return 'right error';
  if (document.expiringSoon) return 'right warn';
  return 'right muted';
}
