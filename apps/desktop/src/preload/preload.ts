/**
 * The bridge.
 *
 * Every operation the window is allowed to perform, listed by name. Nothing else
 * crosses: no filesystem, no database handle, no keys. If an operation is not
 * here, the UI cannot do it.
 *
 * The list is written out rather than generated, so that reading this file tells
 * you the renderer's entire reach without having to follow anything.
 */

import { contextBridge, ipcRenderer } from 'electron';

import type { VaultpApi } from '../shared/api.js';

const api: VaultpApi = {
  // A listener, not a channel the window can send on: the main process talks,
  // the renderer only hears.
  onVaultChanged: (listener) => {
    ipcRenderer.on('vault:changed', () => listener());
  },

  status: () => ipcRenderer.invoke('vault:status'),
  create: (passphrase) => ipcRenderer.invoke('vault:create', passphrase),
  unlock: (passphrase) => ipcRenderer.invoke('vault:unlock', passphrase),
  adopt: (passphrase) => ipcRenderer.invoke('vault:adopt', passphrase),
  joinFolder: (passphrase) => ipcRenderer.invoke('vault:joinFolder', passphrase),
  chooseSyncFolder: () => ipcRenderer.invoke('vault:chooseSyncFolder'),
  sync: () => ipcRenderer.invoke('vault:sync'),
  setSyncTarget: (target) => ipcRenderer.invoke('vault:setSyncTarget', target),

  driveStatus: () => ipcRenderer.invoke('drive:status'),
  connectDrive: (input) => ipcRenderer.invoke('drive:connect', input),
  disconnectDrive: () => ipcRenderer.invoke('drive:disconnect'),

  overview: () => ipcRenderer.invoke('overview:read'),
  readAllowanceConfig: () => ipcRenderer.invoke('overview:allowanceConfig'),
  saveAllowanceConfig: (config) => ipcRenderer.invoke('overview:saveAllowanceConfig', config),

  listExpenses: (query) => ipcRenderer.invoke('expenses:list', query),
  listCategories: () => ipcRenderer.invoke('expenses:categories'),
  listCurrencies: () => ipcRenderer.invoke('expenses:currencies'),
  addExpense: (input) => ipcRenderer.invoke('expenses:add', input),
  updateExpense: (id, input) => ipcRenderer.invoke('expenses:update', id, input),
  deleteExpense: (id) => ipcRenderer.invoke('expenses:delete', id),
  listUnsettled: () => ipcRenderer.invoke('expenses:unsettled'),
  settleExpense: (id, charged) => ipcRenderer.invoke('expenses:settle', id, charged),
  exportExpensesCsv: () => ipcRenderer.invoke('expenses:exportCsv'),

  listNotes: (query) => ipcRenderer.invoke('notes:list', query),
  getNote: (id) => ipcRenderer.invoke('notes:get', id),
  addNote: (input) => ipcRenderer.invoke('notes:add', input),
  saveNote: (id, patch) => ipcRenderer.invoke('notes:save', id, patch),
  setNoteDone: (id, done) => ipcRenderer.invoke('notes:setDone', id, done),
  deleteNote: (id) => ipcRenderer.invoke('notes:delete', id),
  duplicateNote: (id) => ipcRenderer.invoke('notes:duplicate', id),
  placeNote: (id, after, before, pinned) => ipcRenderer.invoke('notes:place', id, after, before, pinned),
  listNoteLabels: () => ipcRenderer.invoke('notes:labels'),
  ensureNoteLabel: (name) => ipcRenderer.invoke('notes:ensureLabel', name),
  setNoteLabel: (noteId, tagId, on) => ipcRenderer.invoke('notes:setLabel', noteId, tagId, on),
  listNoteFolders: () => ipcRenderer.invoke('notes:folders'),
  addNoteFolder: (name) => ipcRenderer.invoke('notes:addFolder', name),
  renameNoteFolder: (id, name) => ipcRenderer.invoke('notes:renameFolder', id, name),
  deleteNoteFolder: (id) => ipcRenderer.invoke('notes:deleteFolder', id),
  moveNoteToFolder: (noteId, folderId) => ipcRenderer.invoke('notes:moveToFolder', noteId, folderId),
  noteImageFromFile: () => ipcRenderer.invoke('notes:imageFromFile'),
  noteImageFromBytes: (bytes, mime, width, height) =>
    ipcRenderer.invoke('notes:imageFromBytes', bytes, mime, width, height),
  noteClipboard: () => ipcRenderer.invoke('notes:clipboard'),
  noteImageFromClipboard: () => ipcRenderer.invoke('notes:imageFromClipboard'),
  noteImage: (fileId) => ipcRenderer.invoke('notes:image', fileId),
  releaseNoteImages: (fileIds) => ipcRenderer.invoke('notes:releaseImages', fileIds),
  notesLayout: () => ipcRenderer.invoke('notes:layout'),
  setNotesLayout: (layout) => ipcRenderer.invoke('notes:setLayout', layout),

  search: (term) => ipcRenderer.invoke('search:everything', term),

  addCategory: (form) => ipcRenderer.invoke('categories:add', form),
  ensureCategory: (name, icon) => ipcRenderer.invoke('categories:ensure', name, icon),
  archiveCategory: (id) => ipcRenderer.invoke('categories:archive', id),

  exportBackup: () => ipcRenderer.invoke('backup:export'),
  restoreBackup: () => ipcRenderer.invoke('backup:restore'),

  listDocuments: (search) => ipcRenderer.invoke('documents:list', search),
  addDocumentFromFile: () => ipcRenderer.invoke('documents:addFromFile'),
  addDocument: (form) => ipcRenderer.invoke('documents:add', form),
  updateDocument: (id, form) => ipcRenderer.invoke('documents:update', id, form),
  deleteDocument: (id) => ipcRenderer.invoke('documents:delete', id),
  previewDocument: (id) => ipcRenderer.invoke('documents:preview', id),
  exportDocument: (id) => ipcRenderer.invoke('documents:export', id),
  recogniseDocument: (id) => ipcRenderer.invoke('documents:recognise', id),
  listTags: () => ipcRenderer.invoke('documents:tags'),
  addTag: (name) => ipcRenderer.invoke('documents:addTag', name),
  tagDocument: (documentId, tagId, tagged) =>
    ipcRenderer.invoke('documents:tagDocument', documentId, tagId, tagged),
  listRules: () => ipcRenderer.invoke('rules:list'),
  addRule: (form) => ipcRenderer.invoke('rules:add', form),
  setRuleState: (id, state) => ipcRenderer.invoke('rules:setState', id, state),
  updateRuleAmount: (id, amount, currency) =>
    ipcRenderer.invoke('rules:updateAmount', id, amount, currency),
  runAutoLog: () => ipcRenderer.invoke('rules:runAutoLog'),
  listPendingReminders: () => ipcRenderer.invoke('rules:pending'),
  listUpcoming: () => ipcRenderer.invoke('rules:upcoming'),

  listBalances: () => ipcRenderer.invoke('debts:balances'),
  listPeople: () => ipcRenderer.invoke('debts:people'),
  addPerson: (input) => ipcRenderer.invoke('debts:addPerson', input),
  archivePerson: (id) => ipcRenderer.invoke('debts:archivePerson', id),
  ledgerFor: (personId) => ipcRenderer.invoke('debts:ledger', personId),
  addDebtEntry: (form) => ipcRenderer.invoke('debts:addEntry', form),
  voidDebtEntry: (id, note) => ipcRenderer.invoke('debts:voidEntry', id, note),
  settleDebt: (personId, note) => ipcRenderer.invoke('debts:settle', personId, note),
};

contextBridge.exposeInMainWorld('vaultp', api);
