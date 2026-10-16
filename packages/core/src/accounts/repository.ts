/**
 * Accounts: where the money is.
 *
 * A bank account, the cash in a wallet, a card, a savings pot — each with the
 * balance as it was last read, and the date it was read. The balance is typed
 * in, never derived: expenses here are not drawn from an account, so a computed
 * figure would drift from the bank's without anyone noticing. A stated figure
 * with its date is something a person can trust, or see is stale.
 *
 * Totals are kept per currency. Adding dinars to euros needs a rate, and a rate
 * is an estimate; the overview that wants one total can convert and say so.
 */

import { uuidv7 } from '../id.js';
import type { VaultStore } from '../db/store.js';
import type { Json } from '../oplog/event.js';
import { BASE_CURRENCY, type CurrencyCode, isKnownCurrency } from '../money/currency.js';
import { type Money, money, sum } from '../money/money.js';
import { type IsoDate, parseDate, todayIn } from '../time/date.js';

export type AccountKind = 'bank' | 'cash' | 'card' | 'savings' | 'other';

export const ACCOUNT_KINDS: readonly AccountKind[] = ['bank', 'cash', 'card', 'savings', 'other'];

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly kind: AccountKind;
  readonly balance: Money;
  /** The day the balance was true. */
  readonly balanceOn: IsoDate;
  readonly note: string | null;
  readonly archived: boolean;
  readonly sortOrder: number;
}

export class AccountValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountValidationError';
  }
}

interface AccountRow {
  id: string;
  name: string | null;
  kind: string | null;
  balance_minor: number | null;
  currency: string | null;
  balance_on: string | null;
  note: string | null;
  archived: number | null;
  sort_order: number | null;
  updated_at: string | null;
}

function asKind(value: string | null): AccountKind {
  return (ACCOUNT_KINDS as readonly string[]).includes(value ?? '') ? (value as AccountKind) : 'other';
}

export class AccountRepository {
  constructor(
    private readonly store: VaultStore,
    readonly defaultCurrency: CurrencyCode = BASE_CURRENCY,
  ) {}

  addAccount(input: {
    name: string;
    kind?: AccountKind;
    balance: Money;
    balanceOn?: IsoDate;
    note?: string;
    id?: string;
  }): Account {
    const name = input.name.trim();
    if (name === '') throw new AccountValidationError('An account needs a name.');
    if (!isKnownCurrency(input.balance.currency)) {
      throw new AccountValidationError(`Unknown currency ${input.balance.currency}.`);
    }
    const balanceOn = input.balanceOn ?? todayIn();
    parseDate(balanceOn);

    const last = this.listAccounts(true).reduce((max, account) => Math.max(max, account.sortOrder), 0);
    const id = input.id ?? uuidv7();
    this.store.commit('account', id, {
      name,
      kind: input.kind ?? 'bank',
      balance_minor: input.balance.amountMinor,
      currency: input.balance.currency,
      balance_on: balanceOn,
      note: input.note?.trim() || null,
      archived: false,
      sort_order: last + 1,
    });
    return this.getAccount(id)!;
  }

  /**
   * Change anything about an account. Setting a new balance stamps today as the
   * day it was true unless another date is given — the usual case is "I just
   * looked at my banking app".
   */
  updateAccount(
    id: string,
    patch: {
      name?: string;
      kind?: AccountKind;
      balance?: Money;
      balanceOn?: IsoDate;
      note?: string | null;
      sortOrder?: number;
    },
  ): Account {
    if (!this.getAccount(id)) throw new AccountValidationError('That account no longer exists.');
    const fields: Record<string, Json> = {};
    if (patch.name !== undefined) {
      if (patch.name.trim() === '') throw new AccountValidationError('An account needs a name.');
      fields.name = patch.name.trim();
    }
    if (patch.kind !== undefined) fields.kind = asKind(patch.kind);
    if (patch.balance !== undefined) {
      if (!isKnownCurrency(patch.balance.currency)) {
        throw new AccountValidationError(`Unknown currency ${patch.balance.currency}.`);
      }
      fields.balance_minor = patch.balance.amountMinor;
      fields.currency = patch.balance.currency;
      fields.balance_on = patch.balanceOn ?? todayIn();
    } else if (patch.balanceOn !== undefined) {
      fields.balance_on = patch.balanceOn;
    }
    if (typeof fields.balance_on === 'string') parseDate(fields.balance_on);
    if (patch.note !== undefined) fields.note = patch.note?.trim() || null;
    if (patch.sortOrder !== undefined) fields.sort_order = patch.sortOrder;
    if (Object.keys(fields).length > 0) this.store.commit('account', id, fields);
    return this.getAccount(id)!;
  }

  /** Hidden from the list and the totals, kept with its history. */
  archiveAccount(id: string): void {
    this.store.commit('account', id, { archived: true });
  }

  unarchiveAccount(id: string): void {
    this.store.commit('account', id, { archived: false });
  }

  /** Gone for good from every screen; the history stays in the log. */
  deleteAccount(id: string): void {
    this.store.remove('account', id);
  }

  getAccount(id: string): Account | undefined {
    const row = this.store.database.get<AccountRow>(
      'SELECT * FROM account WHERE id = ? AND deleted_at IS NULL',
      [id],
    );
    return row ? this.toAccount(row) : undefined;
  }

  listAccounts(includeArchived = false): Account[] {
    return this.store.database
      .all<AccountRow>(
        `SELECT * FROM account WHERE deleted_at IS NULL
         ${includeArchived ? '' : 'AND (archived IS NULL OR archived = 0)'}
         ORDER BY sort_order ASC, name ASC`,
      )
      .map((row) => this.toAccount(row));
  }

  /** What the open accounts hold, one total per currency, largest first. */
  totals(): Money[] {
    const byCurrency = new Map<CurrencyCode, Money[]>();
    for (const account of this.listAccounts()) {
      const list = byCurrency.get(account.balance.currency) ?? [];
      list.push(account.balance);
      byCurrency.set(account.balance.currency, list);
    }
    return [...byCurrency.entries()]
      .map(([currency, balances]) => sum(balances, currency))
      .sort((a, b) =>
        a.currency === this.defaultCurrency ? -1 : b.currency === this.defaultCurrency ? 1 : b.amountMinor - a.amountMinor,
      );
  }

  private toAccount(row: AccountRow): Account {
    const currency = row.currency ?? this.defaultCurrency;
    return {
      id: row.id,
      name: row.name ?? '',
      kind: asKind(row.kind),
      balance: money(row.balance_minor ?? 0, currency),
      balanceOn: row.balance_on ?? (row.updated_at ?? '').slice(0, 10),
      note: row.note,
      archived: row.archived === 1,
      sortOrder: row.sort_order ?? 0,
    };
  }
}
