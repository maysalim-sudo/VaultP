/**
 * Debt operations.
 *
 * Nothing here nets two currencies together. A ledger that mixes them throws in
 * core, and that refusal is passed on to the window as a message rather than
 * papered over with a conversion — what someone owes was agreed in a currency,
 * and today's rate is not part of the agreement.
 */

import { ipcMain } from 'electron';

import {
  MixedCurrencyLedgerError,
  money,
  parseAmount,
  todayIn,
  type DebtEntry,
  type InterestTerms,
  type LedgerBalance,
  type Person,
  type SideBalance,
} from '@vaultp/core';

import type {
  BalanceDto,
  DebtEntryDto,
  DebtEntryFormDto,
  LedgerDto,
  PersonDto,
  SideBalanceDto,
} from '../../shared/api.js';
import type { DesktopVault } from '../vault.js';
import { toMoneyDto } from './serialize.js';

function toEntryDto(entry: DebtEntry): DebtEntryDto {
  return {
    id: entry.id,
    kind: entry.kind,
    owedToMe: entry.direction === 'owed_to_me',
    amount: toMoneyDto(entry.amount),
    occurredOn: entry.occurredOn,
    note: entry.note,
    settledOn: entry.settledOn,
  };
}

function toPersonDto(person: Person): PersonDto {
  return {
    id: person.id,
    name: person.name,
    contact: person.contact,
    note: person.note,
    archived: person.archived,
  };
}

function describeTerms(terms: InterestTerms): string | null {
  if (terms.method === 'none') return null;
  // The rate is per period, not annualised, and saying so avoids the reader
  // assuming the yearly figure they are used to seeing.
  return `${(terms.rate * 100).toFixed(2)}% ${terms.period}, ${terms.method}`;
}

function toSideDto(side: SideBalance, currency: string): SideBalanceDto {
  return {
    total: toMoneyDto(money(side.totalMinor, currency)),
    principal: toMoneyDto(money(side.principalMinor, currency)),
    interest: toMoneyDto(money(side.interestMinor, currency)),
    unapplied: toMoneyDto(money(side.unappliedMinor, currency)),
    loans: side.loans.map((position) => ({
      id: position.loan.id,
      occurredOn: position.loan.occurredOn,
      note: position.loan.note,
      principal: toMoneyDto(money(position.principalMinor, currency)),
      interest: toMoneyDto(money(position.interestMinor, currency)),
      total: toMoneyDto(money(position.totalMinor, currency)),
      closed: position.closed,
      interestTerms: describeTerms(position.loan.terms),
    })),
  };
}

function toLedgerDto(
  personId: string,
  balance: LedgerBalance,
  entries: readonly DebtEntry[],
): LedgerDto {
  return {
    personId,
    asOf: balance.asOf,
    owedToMe: toSideDto(balance.owedToMe, balance.currency),
    owedByMe: toSideDto(balance.owedByMe, balance.currency),
    net: toMoneyDto(balance.net),
    owesYou: balance.net.amountMinor >= 0,
    settledOn: balance.settledOn,
    entries: entries.map(toEntryDto),
    mixedCurrencies: null,
  };
}

/** Percent as typed to the fraction core wants: "5" means 0.05 per period. */
function termsOf(form: DebtEntryFormDto): InterestTerms | undefined {
  if (form.interest.method === 'none') return undefined;

  const percent = Number(form.interest.ratePercent.replace(',', '.'));
  if (!Number.isFinite(percent)) {
    throw new Error(`Not a valid interest rate: "${form.interest.ratePercent}"`);
  }

  return { method: form.interest.method, rate: percent / 100, period: form.interest.period };
}

export function registerDebtHandlers(requireVault: () => DesktopVault): void {
  ipcMain.handle('debts:balances', (): BalanceDto[] => {
    const vault = requireVault();
    const today = todayIn();

    return vault.debts
      .listPeople()
      .map((person): BalanceDto | undefined => {
        // Caught per person, so one unnettable ledger does not blank the list.
        try {
          const balance = vault.debts.ledgerFor(person.id, today);
          if (!balance || balance.net.amountMinor === 0) return undefined;
          return {
            id: person.id,
            name: person.name,
            net: toMoneyDto(balance.net),
            owesYou: balance.net.amountMinor > 0,
          };
        } catch {
          return { id: person.id, name: person.name, net: null, owesYou: false };
        }
      })
      .filter((entry): entry is BalanceDto => entry !== undefined);
  });

  ipcMain.handle('debts:people', (): PersonDto[] => requireVault().debts.listPeople().map(toPersonDto));

  ipcMain.handle('debts:person', (_event, id: string): PersonDto | null => {
    const person = requireVault().debts.getPerson(id);
    return person ? toPersonDto(person) : null;
  });

  ipcMain.handle(
    'debts:updatePerson',
    (_event, id: string, input: { name: string; contact: string; note: string }) => {
      requireVault().debts.updatePerson(id, { name: input.name, contact: input.contact, note: input.note });
    },
  );

  ipcMain.handle('debts:archivedPeople', (): PersonDto[] =>
    requireVault()
      .debts.listPeople(true)
      .filter((person) => person.archived)
      .map(toPersonDto),
  );

  ipcMain.handle('debts:unarchivePerson', (_event, id: string) => {
    requireVault().debts.unarchivePerson(id);
  });

  ipcMain.handle(
    'debts:addPerson',
    (_event, input: { name: string; contact: string; note: string }) => {
      const created = requireVault().debts.addPerson({
        name: input.name.trim(),
        ...(input.contact.trim() ? { contact: input.contact.trim() } : {}),
        ...(input.note.trim() ? { note: input.note.trim() } : {}),
      });
      return { id: created.id };
    },
  );

  ipcMain.handle('debts:archivePerson', (_event, id: string) => {
    requireVault().debts.archivePerson(id);
  });

  ipcMain.handle('debts:ledger', (_event, personId: string): LedgerDto => {
    const vault = requireVault();
    const entries = vault.debts.entriesFor(personId);

    try {
      const balance = vault.debts.ledgerFor(personId, todayIn());
      if (!balance) return emptyLedger(personId, entries);
      return toLedgerDto(personId, balance, entries);
    } catch (caught: unknown) {
      if (!(caught instanceof MixedCurrencyLedgerError)) throw caught;
      // The entries are still worth showing; only the netting is impossible.
      return { ...emptyLedger(personId, entries), mixedCurrencies: caught.message };
    }
  });

  ipcMain.handle('debts:addEntry', (_event, form: DebtEntryFormDto) => {
    const vault = requireVault();
    const amount = parseAmount(form.amount, form.currency);
    const note = form.note.trim();
    const common = {
      personId: form.personId,
      amount,
      occurredOn: form.occurredOn || todayIn(),
      ...(note ? { note } : {}),
    };

    switch (form.kind) {
      case 'lend': {
        const interest = termsOf(form);
        return { id: vault.debts.lend({ ...common, ...(interest ? { interest } : {}) }).id };
      }
      case 'borrow': {
        const interest = termsOf(form);
        return { id: vault.debts.borrow({ ...common, ...(interest ? { interest } : {}) }).id };
      }
      case 'repaidToMe':
        return { id: vault.debts.recordRepaymentToMe(common).id };
      case 'repaidByMe':
        return { id: vault.debts.recordRepaymentByMe(common).id };
    }
  });

  ipcMain.handle('debts:voidEntry', (_event, id: string, note: string) => {
    requireVault().debts.voidEntry(id, note.trim() || 'Corrected on the desktop');
  });

  ipcMain.handle('debts:settle', (_event, personId: string, note: string) => {
    const settled = requireVault().debts.settle(personId, todayIn(), note.trim() || undefined);
    return { settled: settled !== undefined };
  });
}

/** A person with no entries, or one whose entries cannot be netted. */
function emptyLedger(personId: string, entries: readonly DebtEntry[]): LedgerDto {
  const nothing = toMoneyDto(money(0, entries[0]?.amount.currency ?? 'TND'));
  const side: SideBalanceDto = {
    total: nothing,
    principal: nothing,
    interest: nothing,
    unapplied: nothing,
    loans: [],
  };

  return {
    personId,
    asOf: todayIn(),
    owedToMe: side,
    owedByMe: side,
    net: nothing,
    owesYou: true,
    settledOn: null,
    entries: entries.map(toEntryDto),
    mixedCurrencies: null,
  };
}
