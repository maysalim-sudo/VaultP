import { describe, expect, it } from 'vitest';

import { VaultStore } from '../db/store.js';
import { openTestDatabase } from '../db/testing/nodeSqlite.js';
import { DebtRepository } from '../debts/repository.js';
import { ExpenseRepository } from '../expenses/repository.js';
import { money } from '../money/money.js';
import { searchEverything } from '../search.js';
import { AccountRepository, AccountValidationError } from './repository.js';

function newVault(device = 'dev_phone') {
  const db = openTestDatabase();
  const store = VaultStore.open({ db, device });
  return { db, store, accounts: new AccountRepository(store) };
}

describe('accounts', () => {
  it('keeps a typed balance with the day it was true', () => {
    const { accounts } = newVault();
    const bank = accounts.addAccount({ name: ' BIAT ', balance: money(1_250_500, 'TND'), balanceOn: '2026-10-01' });
    expect(bank.name).toBe('BIAT');
    expect(bank.kind).toBe('bank');
    expect(bank.balance).toEqual(money(1_250_500, 'TND'));
    expect(bank.balanceOn).toBe('2026-10-01');
  });

  it('dates a new balance today unless told otherwise', () => {
    const { accounts } = newVault();
    const cash = accounts.addAccount({ name: 'Wallet', kind: 'cash', balance: money(40_000, 'TND'), balanceOn: '2026-01-01' });
    const updated = accounts.updateAccount(cash.id, { balance: money(25_000, 'TND') });
    expect(updated.balance.amountMinor).toBe(25_000);
    expect(updated.balanceOn).not.toBe('2026-01-01');
    expect(updated.kind).toBe('cash');
  });

  it('totals per currency, base currency first, archived left out', () => {
    const { accounts } = newVault();
    accounts.addAccount({ name: 'Bank', balance: money(1_000_000, 'TND') });
    accounts.addAccount({ name: 'Cash', kind: 'cash', balance: money(50_000, 'TND') });
    accounts.addAccount({ name: 'Revolut', balance: money(30_000, 'EUR') });
    const old = accounts.addAccount({ name: 'Closed', balance: money(999_000, 'TND') });
    accounts.archiveAccount(old.id);

    expect(accounts.totals()).toEqual([money(1_050_000, 'TND'), money(30_000, 'EUR')]);
    expect(accounts.listAccounts().map((a) => a.name)).toEqual(['Bank', 'Cash', 'Revolut']);
    expect(accounts.listAccounts(true)).toHaveLength(4);
  });

  it('refuses a nameless account', () => {
    const { accounts } = newVault();
    expect(() => accounts.addAccount({ name: '  ', balance: money(0, 'TND') })).toThrow(AccountValidationError);
  });

  it('is found by search', () => {
    const { db, accounts } = newVault();
    accounts.addAccount({ name: 'Savings at BIAT', kind: 'savings', balance: money(5_000_000, 'TND') });
    const found = searchEverything(db, 'biat');
    expect(found.map((r) => r.kind)).toEqual(['account']);
  });
});

describe('editing what was already entered', () => {
  it('renames a person without touching their ledger', () => {
    const { store } = newVault();
    const debts = new DebtRepository(store);
    const sami = debts.addPerson({ name: 'Sami' });
    debts.lend({ personId: sami.id, amount: money(20_000, 'TND'), occurredOn: '2026-10-01' });

    const renamed = debts.updatePerson(sami.id, { name: 'Sami B.', contact: '+216 00 000 000' });
    expect(renamed.name).toBe('Sami B.');
    expect(renamed.contact).toBe('+216 00 000 000');
    expect(debts.entriesFor(sami.id)).toHaveLength(1);

    debts.archivePerson(sami.id);
    debts.unarchivePerson(sami.id);
    expect(debts.getPerson(sami.id)?.archived).toBe(false);
  });

  it('changes a budget without resetting carry-over, and refuses a twin name', () => {
    const { store } = newVault();
    const expenses = new ExpenseRepository(store);
    const food = expenses.addCategory({ name: 'Food', rollover: true });
    expenses.addCategory({ name: 'Rent' });

    const updated = expenses.updateCategory(food.id, { monthlyLimit: money(300_000, 'TND') });
    expect(updated.rollover).toBe(true);
    expect(updated.monthlyLimit?.amountMinor).toBe(300_000);
    expect(() => expenses.updateCategory(food.id, { name: 'rent' })).toThrow(/already a category/);
    expect(expenses.updateCategory(food.id, { monthlyLimit: null }).monthlyLimit).toBeNull();
  });

  it('edits and deletes a recurring charge, keeping what it logged', () => {
    const { store } = newVault();
    const expenses = new ExpenseRepository(store);
    const rule = expenses.addRule({
      name: 'Netflix',
      amount: money(36_000, 'TND'),
      frequency: 'monthly',
      anchorDate: '2026-01-05',
    });
    const edited = expenses.updateRule(rule.id, { name: 'Netflix Premium', autoLog: true });
    expect(edited.name).toBe('Netflix Premium');
    expect(edited.autoLog).toBe(true);

    expenses.deleteRule(rule.id);
    expect(expenses.getRule(rule.id)).toBeUndefined();
    expect(expenses.listRules()).toHaveLength(0);
  });
});

describe('records from a newer version', () => {
  it('are kept and passed on rather than stopping sync', () => {
    const { store } = newVault('dev_old');
    const applied = store.ingest([
      {
        id: '0199c0a0-0000-7000-8000-0000000000aa',
        hlc: '000001700000000000|00000|dev_new',
        device: 'dev_new',
        // A kind of record this build has never heard of.
        entity: 'budget_goal' as never,
        entityId: 'g1',
        op: 'put',
        fields: { name: 'Holiday' },
        schemaVersion: 1,
      },
    ]);
    expect(applied).toBe(1);
    expect(store.allEvents().map((event) => event.entityId)).toEqual(['g1']);
  });
});
