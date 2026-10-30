/** Documents held in the vault. */

import { useMemo, useState } from 'react';

import type { DocumentDto } from '../../shared/api.js';
import { Icon } from '../icons.js';
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

  const add = () =>
    void run(async () => {
      const created = await api().addDocumentFromFile();
      if (created) setOpen(created.id);
    });

  // The one that ends soonest, if anything is ending: it leads the page.
  const today = Date.parse(new Date().toDateString());
  const next = (documents.data ?? [])
    .filter((document) => document.expiryDate && (document.expiringSoon || document.expired))
    .sort((a, b) => (a.expiryDate ?? '').localeCompare(b.expiryDate ?? ''))[0];
  const nextDays = next?.expiryDate ? Math.round((Date.parse(`${next.expiryDate}T00:00:00`) - today) / 86_400_000) : null;

  return (
    <>
      <div className="head">
        <h2>Documents</h2>
        <button className="accent" disabled={busy} onClick={add}>
          <span className="row" style={{ gap: 8 }}>
            <Icon name="scan" size={16} stroke={2} />
            Add a scan
          </span>
        </button>
      </div>

      <div className="gsearch" style={{ maxWidth: 560, marginBottom: 14 }}>
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search titles, notes and the text inside scans"
        />
      </div>

      {error ? <p className="error">{error}</p> : null}

      {next && nextDays !== null ? (
        <button className="tile doc-hero" onClick={() => setOpen(next.id)}>
          <span className="label">
            {next.title.toUpperCase()} {nextDays < 0 ? 'ENDED' : 'ENDS IN'}
          </span>
          <span className="monument">
            <span className="dots neg" style={{ fontSize: 'var(--text-display)' }}>
              {Math.abs(nextDays)}
            </span>
            <span className="unit">
              {nextDays < 0 ? 'DAYS AGO' : 'DAYS'} · {next.expiryDate}
            </span>
          </span>
        </button>
      ) : null}

      {documents.data?.length === 0 ? (
        <div className="empty">{term ? 'Nothing matches that' : 'Nothing stored yet'}</div>
      ) : null}

      <div className="doc-grid">
        {documents.data?.map((document) => (
          <button key={document.id} className="tile doc" onClick={() => setOpen(document.id)}>
            <span className="page-thumb" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="what">
              <span className="label">{(document.kind ?? 'Document').toUpperCase()}</span>
              <strong>{document.title}</strong>
              <span>
                {document.tags.length > 0 ? document.tags.map((tag) => tag.name).join(', ') : ''}
                {document.file && !document.file.presentHere
                  ? // The record arrived ahead of the bytes. Said plainly, because
                    // the alternative is a broken image and a guess about why.
                    'Scan not fetched yet — sync to get it'
                  : document.extractedText
                    ? `${document.tags.length > 0 ? ' · ' : ''}Text read`
                    : ''}
              </span>
            </span>
            {document.expiryDate ? (
              <span className={`badge ${document.expired || document.expiringSoon ? 'signal' : ''}`}>
                {document.expired ? 'EXPIRED' : 'EXP'} {document.expiryDate.slice(5, 7)}.{document.expiryDate.slice(0, 4)}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {open ? <DocumentDetail documentId={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
