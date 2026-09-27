/**
 * The shape of everything that crosses the process boundary.
 *
 * Both sides import this file: the main process to check what it returns, the
 * renderer to know what it receives. Neither side may import the other, so this
 * is the only place the two agree — if a field is added here and only one side
 * is updated, the compiler says so.
 *
 * `Money` does not cross as a `Money`. Structured clone would carry the object
 * fine, but the renderer has no business doing arithmetic on it, so amounts
 * cross as a formatted string *and* their minor units: the string for display,
 * the minor units for round-tripping a value back into an editor without
 * re-parsing what was already parsed once.
 */

import type { NoteColour, NoteContent } from '@vaultp/core';

export interface MoneyDto {
  /** Already formatted for display, decimal point, correct number of places. */
  readonly text: string;
  readonly amountMinor: number;
  readonly currency: string;
}

export interface CurrencyDto {
  readonly code: string;
  readonly name: string;
}

export interface DriveStatusDto {
  readonly connected: boolean;
  readonly folderName: string;
  readonly connectedAt: string | null;
}

/** Where a sync goes. A folder on this machine, or the connected Drive account. */
export type SyncTarget = 'folder' | 'drive';

export interface VaultStatus {
  readonly exists: boolean;
  readonly open: boolean;
  /** Explicitly `undefined` rather than absent: the window replaces it wholesale. */
  readonly syncFolder: string | undefined;
  /** So the window knows which amounts need a converted figure beside them. */
  readonly baseCurrency: string;
  readonly syncTarget: SyncTarget;
}

export interface SyncReportDto {
  readonly pushedEvents: number;
  readonly pushedSegments: number;
  readonly pulledEvents: number;
  readonly pulledSegments: number;
  readonly appliedEvents: number;
  readonly uploadedFiles: number;
  readonly downloadedFiles: number;
  readonly removedFiles: number;
  /** Records whose scan neither side has sent yet. Not a loss. */
  readonly awaitingFiles: number;
}

export interface CategoryDto {
  readonly id: string;
  readonly name: string;
  readonly icon: string | null;
  readonly archived: boolean;
  readonly monthlyLimit: MoneyDto | null;
  readonly rollover: boolean;
}

export interface ExpenseDto {
  readonly id: string;
  readonly occurredOn: string;
  readonly amount: MoneyDto;
  /** Null when the charge is foreign and no statement has landed yet. */
  readonly base: MoneyDto | null;
  readonly baseEstimated: boolean;
  readonly merchant: string | null;
  readonly note: string | null;
  readonly categoryId: string | null;
}

/**
 * One expense as the form holds it.
 *
 * Amounts are the text that was typed. `charged` is the real debited figure when
 * the user has it — supplying it is what turns an estimate into a fact — and an
 * empty string means they do not, which is not the same as zero.
 */
export interface ExpenseFormDto {
  readonly occurredOn: string;
  readonly amount: string;
  readonly currency: string;
  readonly charged: string;
  readonly merchant: string;
  readonly note: string;
  readonly categoryId: string | null;
}

export interface ExpenseQueryDto {
  readonly from?: string;
  readonly to?: string;
  readonly categoryId?: string;
  readonly limit?: number;
}

/**
 * A note as the window sees it. `content` is the note's blocks exactly as core
 * holds them — plain data, edited in the window with core's own block helpers.
 */
export interface NoteDto {
  readonly id: string;
  readonly title: string;
  readonly content: NoteContent;
  /** Plain-text rendering, for one-line mentions such as the dashboard. */
  readonly body: string;
  readonly dueOn: string | null;
  readonly remind: boolean;
  readonly done: boolean;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly colour: NoteColour | null;
  readonly folderId: string | null;
  readonly labels: readonly TagDto[];
  readonly checklist: { readonly done: number; readonly total: number } | null;
  readonly updatedAt: string | null;
}

export interface TagDto {
  readonly id: string;
  readonly name: string;
  readonly colour: string | null;
}

export interface NoteFolderDto {
  readonly id: string;
  readonly name: string;
}

/** Which notes a list shows. `search` looks through everything, whatever the view. */
export interface NotesQueryDto {
  readonly view: 'all' | 'folder' | 'label' | 'archive' | 'done';
  readonly id?: string;
  readonly search?: string;
}

export interface NoteInputDto {
  readonly title: string;
  readonly content: NoteContent;
  readonly colour: NoteColour | null;
  readonly pinned: boolean;
  readonly archived: boolean;
  /** Empty for no date. */
  readonly dueOn: string;
  readonly remind: boolean;
  readonly folderId: string | null;
  readonly labelIds: readonly string[];
}

/** Only the fields present are changed. */
export type NotePatchDto = Partial<NoteInputDto>;

export interface NoteImageDto {
  readonly fileId: string;
  readonly width: number | null;
  readonly height: number | null;
}

export interface SearchResultDto {
  readonly kind: 'expense' | 'debt' | 'document' | 'note';
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly amount: MoneyDto | null;
  readonly date: string | null;
}

export interface CategoryFormDto {
  readonly name: string;
  /** Blank means no limit at all, which is not the same as a limit of zero. */
  readonly monthlyLimit: string;
  readonly rollover: boolean;
}

export interface DocumentDto {
  readonly id: string;
  readonly title: string;
  readonly expiryDate: string | null;
  readonly expiringSoon: boolean;
  readonly expired: boolean;
  readonly reminderLeadDays: number;
  readonly note: string | null;
  readonly kind: string | null;
  /** Text recognised from the scan. Read-only here — OCR is on the phone. */
  readonly extractedText: string | null;
  readonly tags: readonly TagDto[];
  /** Null when the record has no file, or the bytes live on the other device. */
  readonly file: {
    readonly id: string;
    readonly filename: string | null;
    readonly mime: string | null;
    readonly sizeBytes: number | null;
    /** False when the ciphertext is not on this computer. */
    readonly presentHere: boolean;
  } | null;
}

export interface DocumentFormDto {
  readonly title: string;
  readonly expiryDate: string;
  readonly reminderLeadDays: number;
  readonly note: string;
  readonly kind: string;
}

export interface BalanceDto {
  readonly id: string;
  readonly name: string;
  /** Null when this person's ledger mixes currencies and cannot be netted. */
  readonly net: MoneyDto | null;
  readonly owesYou: boolean;
}

export interface PersonDto {
  readonly id: string;
  readonly name: string;
  readonly contact: string | null;
  readonly note: string | null;
}

export interface LoanPositionDto {
  readonly id: string;
  readonly occurredOn: string;
  readonly note: string | null;
  readonly principal: MoneyDto;
  /** Accrued to the as-of date. Zero when the loan carries no interest. */
  readonly interest: MoneyDto;
  readonly total: MoneyDto;
  readonly closed: boolean;
  readonly interestTerms: string | null;
}

export interface SideBalanceDto {
  readonly total: MoneyDto;
  readonly principal: MoneyDto;
  readonly interest: MoneyDto;
  /** Paid more than was owed on this side; a credit against future loans. */
  readonly unapplied: MoneyDto;
  readonly loans: readonly LoanPositionDto[];
}

export interface LedgerDto {
  readonly personId: string;
  readonly asOf: string;
  readonly owedToMe: SideBalanceDto;
  readonly owedByMe: SideBalanceDto;
  readonly net: MoneyDto;
  readonly owesYou: boolean;
  readonly settledOn: string | null;
  readonly entries: readonly DebtEntryDto[];
  /** Set instead of the rest when the ledger mixes currencies and cannot net. */
  readonly mixedCurrencies: string | null;
}

export interface DebtEntryDto {
  readonly id: string;
  readonly kind: 'loan' | 'payment' | 'adjustment' | 'settlement';
  readonly owedToMe: boolean;
  readonly amount: MoneyDto;
  readonly occurredOn: string;
  readonly note: string | null;
  readonly settledOn: string | null;
}

/** A loan or a repayment as the form holds it. */
export interface DebtEntryFormDto {
  readonly personId: string;
  readonly kind: 'lend' | 'borrow' | 'repaidToMe' | 'repaidByMe';
  readonly amount: string;
  readonly currency: string;
  readonly occurredOn: string;
  readonly note: string;
  /** Loans only, and only when it actually bears interest. */
  readonly interest: {
    readonly method: 'none' | 'simple' | 'compound';
    /** A percentage as typed, e.g. "5" for five percent per period. */
    readonly ratePercent: string;
    readonly period: 'daily' | 'monthly' | 'yearly';
  };
}

export interface RuleDto {
  readonly id: string;
  readonly name: string;
  readonly amount: MoneyDto;
  readonly categoryId: string | null;
  readonly frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  readonly intervalN: number;
  readonly anchorDate: string;
  readonly autoLog: boolean;
  readonly state: 'active' | 'paused' | 'ended';
  /** Set when the amount changed since the last one recorded against this rule. */
  readonly priceChange: { readonly difference: MoneyDto; readonly ratio: number } | null;
}

export interface RuleFormDto {
  readonly name: string;
  readonly amount: string;
  readonly currency: string;
  readonly categoryId: string | null;
  readonly frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  readonly intervalN: number;
  readonly anchorDate: string;
  readonly autoLog: boolean;
}

/** A charge a rule says is due, which nothing has logged yet. */
export interface DueChargeDto {
  readonly ruleId: string;
  readonly name: string;
  readonly date: string;
  readonly amount: MoneyDto;
}

export interface MonthTotalDto {
  readonly total: MoneyDto;
  readonly transactionCount: number;
  /** Foreign charges with no value yet. Never folded into the total as zero. */
  readonly unvaluedCount: number;
}

export interface ForecastDto {
  readonly spentSoFar: MoneyDto;
  /** Scheduled charges still to come this month. */
  readonly committed: MoneyDto;
  readonly variable: MoneyDto;
  readonly projectedTotal: MoneyDto;
  readonly dailyAverage: MoneyDto;
  readonly daysRemaining: number;
  readonly daysWithSpending: number;
  /**
   * True when too few actual spending days back the projection. The window must
   * present the variable part as a hint, never as a figure.
   */
  readonly variableUnreliable: boolean;
  /** Rules whose base-currency cost is unknown; the projection is a floor. */
  readonly rulesWithoutRate: number;
}

export interface BudgetDto {
  readonly categoryId: string;
  readonly name: string;
  readonly limit: MoneyDto;
  readonly carriedIn: MoneyDto;
  readonly available: MoneyDto;
  readonly spent: MoneyDto;
  readonly remaining: MoneyDto;
  readonly ratioUsed: number | null;
  readonly overspent: boolean;
}

export interface AllowanceDto {
  readonly configured: boolean;
  readonly label: string;
  readonly ceiling: MoneyDto;
  readonly used: MoneyDto;
  readonly remaining: MoneyDto;
  readonly ratioUsed: number;
  readonly committedTotal: MoneyDto;
  readonly projectedTotal: MoneyDto;
  readonly projectedOverrun: MoneyDto;
  /** The day the ceiling is projected to run out, or null if it holds. */
  readonly exhaustionDate: string | null;
  readonly rulesWithoutRate: number;
  /** Charges in the period with no debited value known, so `used` is a floor. */
  readonly unvaluedCount: number;
  readonly byCurrency: ReadonlyArray<{
    readonly currency: string;
    readonly billed: MoneyDto;
    /** Null when nothing in this currency has a known debited value. */
    readonly charged: MoneyDto | null;
    readonly transactionCount: number;
    readonly unvaluedCount: number;
  }>;
}

export interface AllowanceConfigDto {
  readonly ceiling: string;
  readonly currency: string;
  readonly yearStartMonth: number;
}

export interface OverviewDto {
  readonly month: MonthTotalDto;
  readonly eventCount: number;
  readonly forecast: ForecastDto;
  readonly budgets: readonly BudgetDto[];
  readonly uncategorised: MoneyDto;
  readonly allowance: AllowanceDto;
  readonly upcoming: readonly DueChargeDto[];
  readonly pendingReminders: readonly DueChargeDto[];
  /** Just enough to name them; the Documents screen holds the rest. */
  readonly expiringDocuments: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly expiryDate: string | null;
  }>;
  readonly overdueNotes: readonly NoteDto[];
  readonly openBalances: readonly BalanceDto[];
}

/**
 * Every operation the window may perform.
 *
 * The preload script exposes exactly these and nothing else. Adding a capability
 * means adding it here, in the preload, and in a handler — three deliberate
 * steps, so nothing reaches the renderer by accident.
 */
export interface VaultpApi {
  /**
   * Told when the vault changed without the window asking — work that finishes
   * after the call that started it, such as reading a scan's text.
   */
  onVaultChanged(listener: () => void): void;
  status(): Promise<VaultStatus>;
  create(passphrase: string): Promise<unknown>;
  unlock(passphrase: string): Promise<unknown>;
  adopt(passphrase: string): Promise<unknown>;
  joinFolder(passphrase: string): Promise<unknown>;
  chooseSyncFolder(): Promise<string | undefined>;
  sync(): Promise<SyncReportDto>;
  setSyncTarget(target: SyncTarget): Promise<void>;

  driveStatus(): Promise<DriveStatusDto>;
  /**
   * Opens the system browser to sign in. Resolves when the redirect comes back,
   * which may be a minute later or never if the user walks away.
   */
  connectDrive(input: {
    clientId: string;
    clientSecret: string;
    folderName: string;
  }): Promise<{ folderName: string }>;
  disconnectDrive(): Promise<void>;

  overview(): Promise<OverviewDto>;
  readAllowanceConfig(): Promise<AllowanceConfigDto>;
  saveAllowanceConfig(config: AllowanceConfigDto): Promise<void>;
  listExpenses(query: ExpenseQueryDto): Promise<ExpenseDto[]>;
  listCategories(): Promise<CategoryDto[]>;
  listCurrencies(): Promise<CurrencyDto[]>;
  addExpense(input: ExpenseFormDto): Promise<{ id: string }>;
  updateExpense(id: string, input: ExpenseFormDto): Promise<{ id: string }>;
  deleteExpense(id: string): Promise<void>;
  /** Foreign charges with no real debited figure yet. */
  listUnsettled(): Promise<ExpenseDto[]>;
  /** Record what the statement actually debited, in the base currency. */
  settleExpense(id: string, charged: string): Promise<{ id: string }>;
  exportExpensesCsv(): Promise<string | undefined>;

  listNotes(query: NotesQueryDto): Promise<NoteDto[]>;
  getNote(id: string): Promise<NoteDto | null>;
  addNote(input: NoteInputDto): Promise<{ id: string }>;
  saveNote(id: string, patch: NotePatchDto): Promise<void>;
  setNoteDone(id: string, done: boolean): Promise<void>;
  deleteNote(id: string): Promise<void>;
  duplicateNote(id: string): Promise<{ id: string }>;
  /** Put a note between two others; null for either end. */
  placeNote(id: string, after: string | null, before: string | null, pinned?: boolean): Promise<void>;
  listNoteLabels(): Promise<TagDto[]>;
  ensureNoteLabel(name: string): Promise<TagDto>;
  setNoteLabel(noteId: string, tagId: string, on: boolean): Promise<void>;
  listNoteFolders(): Promise<NoteFolderDto[]>;
  addNoteFolder(name: string): Promise<NoteFolderDto>;
  renameNoteFolder(id: string, name: string): Promise<void>;
  deleteNoteFolder(id: string): Promise<void>;
  moveNoteToFolder(noteId: string, folderId: string | null): Promise<void>;
  /** Opens a file dialog and encrypts the chosen image into the vault. */
  noteImageFromFile(): Promise<NoteImageDto | undefined>;
  /** Encrypts a pasted or dropped image into the vault. */
  noteImageFromBytes(bytes: Uint8Array, mime: string, width: number | null, height: number | null): Promise<NoteImageDto>;
  /** What the clipboard holds, for "Paste as a new note". */
  noteClipboard(): Promise<{ hasImage: boolean; text: string }>;
  /** Encrypts the image on the clipboard into the vault. */
  noteImageFromClipboard(): Promise<NoteImageDto | undefined>;
  /** The decrypted image as a data URL, held only in the window's memory. */
  noteImage(fileId: string): Promise<string>;
  releaseNoteImages(fileIds: readonly string[]): Promise<void>;
  notesLayout(): Promise<'grid' | 'list'>;
  setNotesLayout(layout: 'grid' | 'list'): Promise<void>;

  search(term: string): Promise<SearchResultDto[]>;

  addCategory(form: CategoryFormDto): Promise<{ id: string }>;
  archiveCategory(id: string): Promise<void>;

  /** Writes the whole vault, unencrypted, wherever the user chooses. */
  exportBackup(): Promise<string | undefined>;
  restoreBackup(): Promise<{ total: number; applied: number } | undefined>;

  listDocuments(search: string): Promise<DocumentDto[]>;
  /** Opens a file dialog, encrypts what is chosen, and files it as a document. */
  addDocumentFromFile(): Promise<{ id: string } | undefined>;
  addDocument(form: DocumentFormDto): Promise<{ id: string }>;
  updateDocument(id: string, form: DocumentFormDto): Promise<void>;
  deleteDocument(id: string): Promise<void>;
  /** The decrypted bytes as a data URL, for showing a scan in the window. */
  previewDocument(id: string): Promise<string>;
  /** Writes a decrypted copy where the user chooses. Returns the path. */
  exportDocument(id: string): Promise<string | undefined>;
  /** Read the text out of a scan on this machine. Slow the first time. */
  recogniseDocument(id: string): Promise<{ found: boolean }>;
  listTags(): Promise<TagDto[]>;
  addTag(name: string): Promise<{ id: string }>;
  tagDocument(documentId: string, tagId: string, tagged: boolean): Promise<void>;

  listRules(): Promise<RuleDto[]>;
  addRule(form: RuleFormDto): Promise<{ id: string }>;
  setRuleState(id: string, state: 'active' | 'paused' | 'ended'): Promise<void>;
  updateRuleAmount(id: string, amount: string, currency: string): Promise<void>;
  /** Rules set to log themselves, caught up to today. Returns how many landed. */
  runAutoLog(): Promise<{ created: number }>;
  /** Remind-only rules that are due and still unlogged. */
  listPendingReminders(): Promise<DueChargeDto[]>;
  listUpcoming(): Promise<DueChargeDto[]>;

  listBalances(): Promise<BalanceDto[]>;
  listPeople(): Promise<PersonDto[]>;
  addPerson(input: { name: string; contact: string; note: string }): Promise<{ id: string }>;
  archivePerson(id: string): Promise<void>;
  ledgerFor(personId: string): Promise<LedgerDto>;
  addDebtEntry(form: DebtEntryFormDto): Promise<{ id: string }>;
  /** Records the correction as an adjustment; the original entry stays visible. */
  voidDebtEntry(id: string, note: string): Promise<void>;
  settleDebt(personId: string, note: string): Promise<{ settled: boolean }>;
}
