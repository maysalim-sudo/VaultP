import { beforeEach, describe, expect, it } from 'vitest';
import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { todayIn } from '../time/date.js';
import { DocumentRepository, DocumentValidationError, taggingId } from './repository.js';

function newRepo(device = 'dev_phone') {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device });
  return { repo: new DocumentRepository(store), store, db };
}

describe('files', () => {
  it('records metadata without the bytes', () => {
    const { repo } = newRepo();
    const file = repo.addFile({
      filename: 'passport.jpg',
      mime: 'image/jpeg',
      sizeBytes: 2_400_000,
      sha256: 'abc123',
      encryptedPath: 'files/f1.enc',
    });

    expect(file.sizeBytes).toBe(2_400_000);
    expect(file.encryptedPath).toBe('files/f1.enc');
  });

  it('recognises the same bytes added twice', () => {
    const { repo } = newRepo();
    repo.addFile({ sha256: 'same-hash', encryptedPath: 'files/f1.enc' });

    // The hash is of the plaintext: two encryptions of one scan differ entirely
    // as ciphertext, so hashing that would never match.
    const existing = repo.findByHash('same-hash');
    expect(existing?.encryptedPath).toBe('files/f1.enc');
    expect(repo.findByHash('different')).toBeUndefined();
  });
});

describe('documents', () => {
  let ctx: ReturnType<typeof newRepo>;

  beforeEach(() => {
    ctx = newRepo();
  });

  it('stores a document with an expiry', () => {
    const document = ctx.repo.addDocument({
      title: 'Passport',
      expiryDate: '2028-03-15',
      reminderLeadDays: 180,
    });

    expect(document.title).toBe('Passport');
    expect(document.expiryDate).toBe('2028-03-15');
    expect(document.reminderLeadDays).toBe(180);
  });

  it('rejects a blank title and an impossible date', () => {
    expect(() => ctx.repo.addDocument({ title: '   ' })).toThrow(DocumentValidationError);
    expect(() =>
      ctx.repo.addDocument({ title: 'Passport', expiryDate: '2026-02-30' }),
    ).toThrow(/not a valid/i);
  });

  it('corrects a document without losing its history', () => {
    const document = ctx.repo.addDocument({ title: 'Pasport', expiryDate: '2028-03-15' });
    ctx.repo.updateDocument(document.id, { title: 'Passport' });

    expect(ctx.repo.getDocument(document.id)?.title).toBe('Passport');
    expect(ctx.store.historyOf('document', document.id)).toHaveLength(2);
  });

  it('clears an expiry when asked', () => {
    const document = ctx.repo.addDocument({ title: 'Card', expiryDate: '2027-01-01' });
    const updated = ctx.repo.updateDocument(document.id, { expiryDate: null });
    expect(updated.expiryDate).toBeNull();
  });

  it('hides a deleted document but keeps the record', () => {
    const document = ctx.repo.addDocument({ title: 'Old lease' });
    ctx.repo.deleteDocument(document.id);

    expect(ctx.repo.getDocument(document.id)).toBeUndefined();
    expect(ctx.repo.listDocuments()).toHaveLength(0);
    expect(ctx.store.historyOf('document', document.id)).toHaveLength(2);
  });
});

describe('search', () => {
  let ctx: ReturnType<typeof newRepo>;

  beforeEach(() => {
    ctx = newRepo();
    ctx.repo.addDocument({
      title: 'Passport',
      extractedText: 'REPUBLIQUE TUNISIENNE PASSEPORT N 12345678 SALIM',
    });
    ctx.repo.addDocument({
      title: 'Car insurance',
      extractedText: 'ASSURANCE AUTOMOBILE POLICE 998877 STAR',
      note: 'renewed at the agency',
    });
  });

  it('finds a document by text inside it, not just its title', () => {
    // The point of OCR: you remember the number, not what you named the file.
    const found = ctx.repo.searchDocuments('12345678');
    expect(found.map((d) => d.title)).toEqual(['Passport']);
  });

  it('searches titles and notes too', () => {
    expect(ctx.repo.searchDocuments('insurance').map((d) => d.title)).toEqual([
      'Car insurance',
    ]);
    expect(ctx.repo.searchDocuments('agency').map((d) => d.title)).toEqual([
      'Car insurance',
    ]);
  });

  it('treats wildcards as literal text', () => {
    // A search for "%" should not match everything.
    expect(ctx.repo.searchDocuments('%')).toHaveLength(0);
    expect(ctx.repo.searchDocuments('_')).toHaveLength(0);
  });

  it('returns nothing for an empty search', () => {
    expect(ctx.repo.searchDocuments('   ')).toEqual([]);
  });
});

describe('tags', () => {
  let ctx: ReturnType<typeof newRepo>;

  beforeEach(() => {
    ctx = newRepo();
  });

  it('puts one document under several tags at once', () => {
    const passport = ctx.repo.addDocument({ title: 'Passport' });
    const identity = ctx.repo.addTag({ name: 'identity' });
    const travel = ctx.repo.addTag({ name: 'travel' });

    ctx.repo.tagDocument(passport.id, identity.id);
    ctx.repo.tagDocument(passport.id, travel.id);

    // A folder would have forced a choice between these, and either choice is
    // the wrong one when you go looking.
    expect(ctx.repo.tagsFor(passport.id).map((t) => t.name)).toEqual([
      'identity',
      'travel',
    ]);
  });

  it('filters the list by tag', () => {
    const passport = ctx.repo.addDocument({ title: 'Passport' });
    ctx.repo.addDocument({ title: 'Lease' });
    const travel = ctx.repo.addTag({ name: 'travel' });
    ctx.repo.tagDocument(passport.id, travel.id);

    expect(ctx.repo.listDocuments({ tagId: travel.id }).map((d) => d.title)).toEqual([
      'Passport',
    ]);
  });

  it('is idempotent, so tagging twice leaves one row', () => {
    const passport = ctx.repo.addDocument({ title: 'Passport' });
    const travel = ctx.repo.addTag({ name: 'travel' });

    ctx.repo.tagDocument(passport.id, travel.id);
    ctx.repo.tagDocument(passport.id, travel.id);

    expect(ctx.repo.tagsFor(passport.id)).toHaveLength(1);
  });

  it('removes a tag and can put it back', () => {
    const passport = ctx.repo.addDocument({ title: 'Passport' });
    const travel = ctx.repo.addTag({ name: 'travel' });

    ctx.repo.tagDocument(passport.id, travel.id);
    ctx.repo.untagDocument(passport.id, travel.id);
    expect(ctx.repo.tagsFor(passport.id)).toHaveLength(0);

    ctx.repo.tagDocument(passport.id, travel.id);
    expect(ctx.repo.tagsFor(passport.id)).toHaveLength(1);
  });

  it('gives two devices the same tagging row', () => {
    const phone = newRepo('dev_phone');
    const desktop = newRepo('dev_desktop');

    for (const ctx2 of [phone, desktop]) {
      ctx2.repo.addDocument({ id: 'doc1', title: 'Passport' });
      ctx2.repo.addTag({ id: 'tag1', name: 'travel' });
      ctx2.repo.tagDocument('doc1', 'tag1');
    }

    desktop.store.ingest(phone.store.pendingUploads());
    phone.store.ingest(desktop.store.pendingUploads());

    for (const ctx2 of [phone, desktop]) {
      expect(ctx2.repo.tagsFor('doc1')).toHaveLength(1);
    }
    expect(taggingId('document', 'doc1', 'tag1')).toBe('tagging:document:doc1:tag1');
  });
});

describe('expiry', () => {
  it('warns using each document own lead time', () => {
    const { repo } = newRepo();
    // A passport takes months to renew; a membership does not.
    repo.addDocument({
      title: 'Passport',
      expiryDate: '2027-01-01',
      reminderLeadDays: 180,
    });
    repo.addDocument({ title: 'Gym', expiryDate: '2027-01-01', reminderLeadDays: 7 });

    const inAugust = repo.expiringSoon('2026-08-01').map((d) => d.title);

    expect(inAugust).toEqual(['Passport']);
  });

  it('includes both once the shorter lead time is reached', () => {
    const { repo } = newRepo();
    repo.addDocument({
      title: 'Passport',
      expiryDate: '2027-01-01',
      reminderLeadDays: 180,
    });
    repo.addDocument({ title: 'Gym', expiryDate: '2027-01-01', reminderLeadDays: 7 });

    expect(repo.expiringSoon('2026-12-30')).toHaveLength(2);
  });

  it('lists documents that have already expired', () => {
    const { repo } = newRepo();
    repo.addDocument({ title: 'Old passport', expiryDate: '2020-01-01' });
    repo.addDocument({ title: 'Current passport', expiryDate: '2030-01-01' });

    expect(repo.expired(todayIn()).map((d) => d.title)).toEqual(['Old passport']);
  });

  it('ignores documents with no expiry at all', () => {
    const { repo } = newRepo();
    repo.addDocument({ title: 'Diploma' });
    expect(repo.expiringSoon('2030-01-01')).toHaveLength(0);
  });
});
