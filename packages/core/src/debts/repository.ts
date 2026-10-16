/**
 * The debts API.
 *
 * Method names describe what happened in the world — I lent, they repaid — rather
 * than which sign to add to which column. Getting a direction backwards is the
 * easiest mistake to make here and the hardest to notice later, so the mapping
 * lives in one place instead of in every screen.
 */

import { uuidv7 } from '../id.js';
import type { VaultStore } from '../db/store.js';
import type { Json } from '../oplog/event.js';
import { BASE_CURRENCY, type CurrencyCode } from '../money/currency.js';
import { type Money, money } from '../money/money.js';
import { type IsoDate, parseDate } from '../time/date.js';
import {
  type AccrualPeriod,
  type InterestMethod,
  type InterestTerms,
  NO_INTEREST,
  assertValidTerms,
} from './interest.js';
import {
  type DebtDirection,
  type DebtEntry,
  type DebtEntryKind,
  type LedgerBalance,
  computeLedger,
} from './ledger.js';

export interface Person {
  readonly id: string;
  readonly name: string;
  readonly contact: string | null;
  readonly note: string | null;
  readonly archived: boolean;
}

export interface LoanInput {
  readonly personId: string;
  readonly amount: Money;
  readonly occurredOn: IsoDate;
  readonly note?: string;
  readonly interest?: InterestTerms;
  readonly id?: string;
}

export interface PaymentInput {
  readonly personId: string;
  readonly amount: Money;
  readonly occurredOn: IsoDate;
  readonly note?: string;
  readonly id?: string;
}

export class DebtValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DebtValidationError';
  }
}

interface PersonRow {
  id: string;
  name: string | null;
  contact: string | null;
  note: string | null;
  archived: number | null;
}

interface EntryRow {
  id: string;
  person_id: string;
  kind: string;
  direction: string;
  amount_minor: number;
  currency: string | null;
  occurred_on: string;
  note: string | null;
  interest_method: string | null;
  interest_rate: number | null;
  interest_period: string | null;
  settled_on: string | null;
  settlement_of: string | null;
}

export class DebtRepository {
  constructor(
    private readonly store: VaultStore,
    readonly defaultCurrency: CurrencyCode = BASE_CURRENCY,
  ) {}

  // ----------------------------------------------------------------- people

  addPerson(input: { name: string; contact?: string; note?: string; id?: string }): Person {
    if (input.name.trim() === '') {
      throw new DebtValidationError('A person needs a name.');
    }
    const id = input.id ?? uuidv7();
    this.store.commit('person', id, {
      name: input.name.trim(),
      contact: input.contact ?? null,
      note: input.note ?? null,
      archived: false,
    });
    return this.getPerson(id)!;
  }

  getPerson(id: string): Person | undefined {
    const row = this.store.database.get<PersonRow>(
      'SELECT * FROM person WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? toPerson(row) : undefined;
  }

  listPeople(includeArchived = false): Person[] {
    return this.store.database
      .all<PersonRow>(
        `SELECT * FROM person WHERE deleted_at IS NULL
         ${includeArchived ? '' : 'AND (archived IS NULL OR archived = 0)'}
         ORDER BY name`,
      )
      .map(toPerson);
  }

  archivePerson(id: string): void {
    this.store.commit('person', id, { archived: true });
  }

  /** Bring an archived person back, entries and all — nothing was removed. */
  unarchivePerson(id: string): void {
    this.store.commit('person', id, { archived: false });
  }

  /**
   * Correct who someone is. Only the fields given change, so a phone renaming
   * and a computer adding a contact at the same time both survive the merge.
   * Their entries hang off the id, not the name, so a rename touches none.
   */
  updatePerson(id: string, patch: { name?: string; contact?: string | null; note?: string | null }): Person {
    if (!this.getPerson(id)) throw new DebtValidationError('That person no longer exists.');
    const fields: Record<string, Json> = {};
    if (patch.name !== undefined) {
      if (patch.name.trim() === '') throw new DebtValidationError('A person needs a name.');
      fields.name = patch.name.trim();
    }
    if (patch.contact !== undefined) fields.contact = patch.contact?.trim() || null;
    if (patch.note !== undefined) fields.note = patch.note?.trim() || null;
    if (Object.keys(fields).length > 0) this.store.commit('person', id, fields);
    return this.getPerson(id)!;
  }

  // ---------------------------------------------------------------- entries

  /** I gave them money. They owe me. */
  lend(input: LoanInput): DebtEntry {
    return this.addLoan(input, 'owed_to_me');
  }

  /** They gave me money. I owe them. */
  borrow(input: LoanInput): DebtEntry {
    return this.addLoan(input, 'owed_by_me');
  }

  /** They paid me back, in full or in part. */
  recordRepaymentToMe(input: PaymentInput): DebtEntry {
    return this.addPayment(input, 'owed_to_me');
  }

  /** I paid them back. */
  recordRepaymentByMe(input: PaymentInput): DebtEntry {
    return this.addPayment(input, 'owed_by_me');
  }

  private addLoan(input: LoanInput, direction: DebtDirection): DebtEntry {
    parseDate(input.occurredOn);
    if (input.amount.amountMinor <= 0) {
      throw new DebtValidationError('A loan needs a positive amount.');
    }
    const terms = input.interest ?? NO_INTEREST;
    assertValidTerms(terms);

    const id = input.id ?? uuidv7();
    this.store.commit('debt_entry', id, {
      person_id: input.personId,
      kind: 'loan',
      direction,
      amount_minor: input.amount.amountMinor,
      currency: input.amount.currency,
      occurred_on: input.occurredOn,
      note: input.note ?? null,
      interest_method: terms.method,
      interest_rate: terms.rate,
      interest_period: terms.period,
      settled_on: null,
      settlement_of: null,
    });
    return this.getEntry(id)!;
  }

  private addPayment(input: PaymentInput, direction: DebtDirection): DebtEntry {
    parseDate(input.occurredOn);
    if (input.amount.amountMinor <= 0) {
      throw new DebtValidationError('A payment needs a positive amount.');
    }
    const id = input.id ?? uuidv7();
    this.store.commit('debt_entry', id, {
      person_id: input.personId,
      kind: 'payment',
      direction,
      amount_minor: input.amount.amountMinor,
      currency: input.amount.currency,
      occurred_on: input.occurredOn,
      note: input.note ?? null,
      settled_on: null,
      settlement_of: null,
    });
    return this.getEntry(id)!;
  }

  /**
   * Correct a mistake without erasing it.
   *
   * The original entry is voided by an adjustment rather than edited, so the
   * ledger still shows that something was changed and when. In a disagreement,
   * a history with visible corrections is worth more than a tidy one.
   */
  voidEntry(entryId: string, note: string): DebtEntry {
    const original = this.getEntry(entryId);
    if (!original) throw new DebtValidationError(`No debt entry ${entryId}.`);

    const id = uuidv7();
    const sign = original.kind === 'payment' ? 1 : -1;
    this.store.commit('debt_entry', id, {
      person_id: original.personId,
      kind: 'adjustment',
      direction: original.direction,
      amount_minor: sign * original.amount.amountMinor,
      currency: original.amount.currency,
      occurred_on: original.occurredOn,
      note,
      settlement_of: entryId,
    });
    return this.getEntry(id)!;
  }

  /**
   * Close out a ledger.
   *
   * Records the amount agreed as settled, on the date agreed, and marks every open
   * loan closed so interest stops there. The settlement entry is never rewritten:
   * it is the receipt.
   */
  settle(personId: string, asOf: IsoDate, note?: string): DebtEntry | undefined {
    parseDate(asOf);
    const balance = this.ledgerFor(personId, asOf);
    if (!balance || balance.net.amountMinor === 0) return undefined;

    const amount = Math.abs(balance.net.amountMinor);
    const direction: DebtDirection =
      balance.net.amountMinor > 0 ? 'owed_to_me' : 'owed_by_me';

    const id = uuidv7();
    this.store.commit('debt_entry', id, {
      person_id: personId,
      kind: 'settlement',
      direction,
      amount_minor: amount,
      currency: balance.currency,
      occurred_on: asOf,
      note: note ?? null,
      settled_on: asOf,
      settlement_of: null,
    });

    // Stop interest on every loan that was open at settlement.
    for (const side of [balance.owedToMe, balance.owedByMe]) {
      for (const position of side.loans) {
        if (position.closed) continue;
        this.store.commit('debt_entry', position.loan.id, { settled_on: asOf });
      }
    }

    return this.getEntry(id)!;
  }

  getEntry(id: string): DebtEntry | undefined {
    const row = this.store.database.get<EntryRow>(
      'SELECT * FROM debt_entry WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? this.toEntry(row) : undefined;
  }

  /** Every entry for a person, oldest first. The audit trail as the user sees it. */
  entriesFor(personId: string): DebtEntry[] {
    return this.store.database
      .all<EntryRow>(
        `SELECT * FROM debt_entry
          WHERE person_id = ? AND deleted_at IS NULL
          ORDER BY occurred_on ASC, id ASC`,
        [personId],
      )
      .map((row) => this.toEntry(row));
  }

  /** Full edit history of one entry, including corrections. Never lossy. */
  historyOf(entryId: string): ReturnType<VaultStore['historyOf']> {
    return this.store.historyOf('debt_entry', entryId);
  }

  ledgerFor(personId: string, asOf: IsoDate): LedgerBalance | undefined {
    const entries = this.entriesFor(personId);
    if (entries.length === 0) return undefined;
    return computeLedger(personId, entries, asOf);
  }

  /** Every non-zero ledger, largest first. Feeds the dashboard. */
  allBalances(asOf: IsoDate): LedgerBalance[] {
    return this.listPeople(true)
      .map((person) => this.ledgerFor(person.id, asOf))
      .filter((balance): balance is LedgerBalance => balance !== undefined)
      .filter((balance) => balance.net.amountMinor !== 0)
      .sort((a, b) => Math.abs(b.net.amountMinor) - Math.abs(a.net.amountMinor));
  }

  private toEntry(row: EntryRow): DebtEntry {
    const terms: InterestTerms =
      row.interest_method && row.interest_method !== 'none'
        ? {
            method: row.interest_method as InterestMethod,
            rate: row.interest_rate ?? 0,
            period: (row.interest_period ?? 'monthly') as AccrualPeriod,
          }
        : NO_INTEREST;

    return {
      id: row.id,
      personId: row.person_id,
      kind: row.kind as DebtEntryKind,
      direction: row.direction as DebtDirection,
      amount: money(row.amount_minor, row.currency ?? this.defaultCurrency),
      occurredOn: row.occurred_on,
      note: row.note,
      terms,
      settledOn: row.settled_on,
      settlementOf: row.settlement_of,
    };
  }
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    name: row.name ?? '',
    contact: row.contact,
    note: row.note,
    archived: row.archived === 1,
  };
}

export type { Json };
