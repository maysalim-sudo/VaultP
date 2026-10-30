/**
 * The overview: where the month stands, what wants you, and what you were
 * working on — as tiles, led by the month's spend and one bar per day.
 */

import { useState } from 'react';

import { formatAmount, money } from '@vaultp/core';

import type { AllowanceConfigDto, AllowanceDto, BalanceDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { useNav } from '../nav.js';
import { api, useRunner, useVaultQuery } from '../vault.js';

const DAY_MS = 86_400_000;

/** Today as YYYY-MM-DD in local time, which is what dates in the vault are. */
function localToday(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function daysUntil(date: string, today: string): number {
  return Math.round((Date.parse(date) - Date.parse(today)) / DAY_MS);
}

function inDays(days: number): string {
  if (days < 0) return `${-days} D LATE`;
  if (days === 0) return 'TODAY';
  return days === 1 ? '1 DAY' : `${days} DAYS`;
}

/** Netted balances on one side, summed per currency (a ledger may be foreign). */
function sideTotal(balances: readonly BalanceDto[], owesYou: boolean): string | null {
  const totals = new Map<string, number>();
  for (const balance of balances) {
    if (balance.owesYou !== owesYou || !balance.net) continue;
    totals.set(balance.net.currency, (totals.get(balance.net.currency) ?? 0) + Math.abs(balance.net.amountMinor));
  }
  if (totals.size === 0) return null;
  return [...totals].map(([currency, minor]) => formatAmount(money(minor, currency), { unit: 'none' })).join(' + ');
}

function names(balances: readonly BalanceDto[], owesYou: boolean): string {
  const side = balances.filter((balance) => balance.owesYou === owesYou).map((balance) => balance.name);
  if (side.length === 0) return owesYou ? 'Nobody owes you' : 'You owe nobody';
  return side.length <= 2 ? side.join(' · ') : `${side.slice(0, 2).join(' · ')} +${side.length - 2}`;
}

export function Dashboard() {
  const today = localToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const overview = useVaultQuery(() => api().overview());
  const notes = useVaultQuery(() => api().listNotes({ view: 'all' }));
  const spent = useVaultQuery(() => api().listExpenses({ from: monthStart, to: today }));
  const [configuring, setConfiguring] = useState(false);
  const nav = useNav();
  const data = overview.data;

  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const monthName = now.toLocaleDateString('en-GB', { month: 'long' }).toUpperCase();
  const kicker = now
    .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    .replace(/,/g, '')
    .toUpperCase();
  const hour = now.getHours();
  const greeting = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  // One bar per day of the month, in the base currency. A foreign charge with
  // no value yet adds nothing rather than a guessed amount.
  const baseCurrency = data?.month.total.currency;
  const perDay = new Array<number>(daysInMonth).fill(0);
  for (const expense of spent.data ?? []) {
    const value = expense.base ?? (expense.amount.currency === baseCurrency ? expense.amount : null);
    if (!value || value.currency !== baseCurrency) continue;
    const day = Number(expense.occurredOn.slice(8, 10));
    if (day >= 1 && day <= daysInMonth) perDay[day - 1]! += value.amountMinor;
  }
  const peak = Math.max(1, ...perDay);
  const todaySpend = baseCurrency ? formatAmount(money(perDay[dayOfMonth - 1] ?? 0, baseCurrency), { unit: 'none' }) : '—';
  const budgetTotal = (data?.budgets ?? []).reduce((sum, budget) => sum + budget.available.amountMinor, 0);

  // Pinned first, then the most recently touched: what you were working on.
  const recentNotes = [...(notes.data ?? [])]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, 2);

  const nextBill = data?.pendingReminders[0] ?? data?.upcoming[0] ?? null;
  const attention: Array<{ t: string; m: string; v: string; tone: string; go: () => void }> = [];
  for (const charge of data?.pendingReminders ?? []) {
    attention.push({
      t: `${charge.name} — due, not logged`,
      m: `${charge.date} · waiting for you to log it`,
      v: charge.amount.figure,
      tone: '',
      go: () => nav.go('rules'),
    });
  }
  for (const document of data?.expiringDocuments ?? []) {
    const days = document.expiryDate ? daysUntil(document.expiryDate, today) : null;
    attention.push({
      t: days === null ? `${document.title} expires soon` : `${document.title} ends in ${days} days`,
      m: `${document.expiryDate ?? ''} · Documents`,
      v: days === null ? '' : `${days} D`,
      tone: 'neg',
      go: () => nav.go('documents', { kind: 'document', id: document.id }),
    });
  }
  for (const note of data?.overdueNotes ?? []) {
    attention.push({
      t: note.title || note.body.split('\n')[0] || 'A note',
      m: `Due ${note.dueOn ?? ''} · Notes`,
      v: 'DUE',
      tone: 'neg',
      go: () => nav.go('notes', { kind: 'note', id: note.id }),
    });
  }
  if (data && data.month.unvaluedCount > 0) {
    attention.push({
      t: `${data.month.unvaluedCount} foreign charge${data.month.unvaluedCount === 1 ? '' : 's'} awaiting a statement`,
      m: 'Not counted in the month until the bank says what it took',
      v: '≈',
      tone: 'est',
      go: () => nav.go('expenses'),
    });
  }

  const owedToYou = data ? sideTotal(data.openBalances, true) : null;
  const youOwe = data ? sideTotal(data.openBalances, false) : null;

  return (
    <>
      <div className="ov-head">
        <span className="kicker">{kicker}</span>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <h2>{greeting}</h2>
          <button className="secondary" onClick={() => setConfiguring(true)}>
            Foreign allowance
          </button>
        </div>
      </div>

      {overview.error ? <p className="error">{overview.error}</p> : null}

      <div className="bento">
        <section className="tile hero" aria-label="Spent this month">
          <div className="label-row">
            <span className="label">SPENT · {monthName}</span>
            <span className="label">
              DAY {String(dayOfMonth).padStart(2, '0')} / {daysInMonth}
            </span>
          </div>
          <div className="monument">
            <span className="dots">{data ? data.month.total.figure : '—'}</span>
            <span className="unit">{data?.month.total.currency ?? ''}</span>
          </div>
          <div className="daybars" aria-label="Spending per day this month">
            {perDay.map((value, index) => {
              const day = index + 1;
              const kind = day > dayOfMonth ? 'future' : day === dayOfMonth ? 'today' : value === 0 ? 'zero' : '';
              return (
                <span
                  key={day}
                  className={kind}
                  title={`${day}: ${baseCurrency ? formatAmount(money(value, baseCurrency)) : ''}`}
                  style={kind === 'future' ? undefined : { height: `${Math.max(3, Math.round((value / peak) * 100))}%` }}
                />
              );
            })}
          </div>
          <div className="dayaxis label">
            <span>01</span>
            <span>08</span>
            <span>15</span>
            <span>22</span>
            <span>{daysInMonth}</span>
          </div>
          <div className="trio">
            <div>
              <span className="label">TODAY</span>
              <span className="mono">{todaySpend}</span>
            </div>
            <div>
              <span className="label">HEADING FOR</span>
              <span className={`mono ${data?.forecast.variableUnreliable ? 'est' : ''}`}>
                {data ? `≈ ${data.forecast.projectedTotal.figure}` : '—'}
              </span>
            </div>
            <div>
              <span className="label">{budgetTotal > 0 ? 'BUDGETS' : 'A DAY SO FAR'}</span>
              <span className="mono">
                {budgetTotal > 0 && baseCurrency
                  ? formatAmount(money(budgetTotal, baseCurrency), { unit: 'none' })
                  : (data?.forecast.dailyAverage.figure ?? '—')}
              </span>
            </div>
          </div>
          {data?.forecast.variableUnreliable ? (
            // Too few days with spending to trust the everyday part of the
            // projection: said, not hidden.
            <span className="sub">
              Heading-for rests on {data.forecast.daysWithSpending} day
              {data.forecast.daysWithSpending === 1 ? '' : 's'} of spending — a rough hint.
            </span>
          ) : null}
        </section>

        <button className="tile" onClick={() => nav.go('debts')}>
          <span className="label">OWED TO YOU</span>
          <span className="bottom">
            <span className="dots big pos">{owedToYou ?? '0'}</span>
            <span className="sub">{data ? names(data.openBalances, true) : ''}</span>
          </span>
        </button>

        <button className="tile" onClick={() => nav.go('debts')}>
          <span className="label">YOU OWE</span>
          <span className="bottom">
            <span className="dots big neg">{youOwe ?? '0'}</span>
            <span className="sub">{data ? names(data.openBalances, false) : ''}</span>
          </span>
        </button>

        {data?.allowance.configured ? (
          <AllowanceTile data={data.allowance} onConfigure={() => setConfiguring(true)} />
        ) : (
          <button className="tile" onClick={() => setConfiguring(true)}>
            <span className="label">FX ALLOWANCE</span>
            <span className="bottom">
              <span className="dots big faint">OFF</span>
              <span className="sub">Set the yearly ceiling to track it</span>
            </span>
          </button>
        )}

        {nextBill ? (
          <button className="tile signal" onClick={() => nav.go('rules')}>
            <span className="label-row">
              <span className="label">NEXT BILL</span>
              <span className="label">{nextBill.date.slice(8, 10)}.{nextBill.date.slice(5, 7)}</span>
            </span>
            <span className="bottom">
              <span className="dots big">{inDays(daysUntil(nextBill.date, today))}</span>
              <span className="sub">
                {nextBill.name} · {nextBill.amount.display}
              </span>
            </span>
          </button>
        ) : (
          <div className="tile">
            <span className="label">NEXT BILL</span>
            <span className="bottom">
              <span className="dots big faint">NONE</span>
              <span className="sub">Nothing repeats this month</span>
            </span>
          </div>
        )}

        <section className="tile span2" aria-label="Needs you">
          <div className="label-row">
            <span className="label">NEEDS YOU</span>
            <span className="label">{String(attention.length).padStart(2, '0')}</span>
          </div>
          <div className="rows">
            {attention.length === 0 ? (
              <div>
                <span className="what">
                  <span>Nothing is waiting on you.</span>
                </span>
              </div>
            ) : (
              attention.slice(0, 5).map((item, index) => (
                <button key={`${item.t}-${index}`} onClick={item.go}>
                  <span className="n">{String(index + 1).padStart(2, '0')}</span>
                  <span className="what">
                    <strong>{item.t}</strong>
                    <span>{item.m}</span>
                  </span>
                  <span className={`val ${item.tone}`}>{item.v}</span>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="tile span2" aria-label="Recent notes">
          <div className="label-row">
            <span className="label">RECENT NOTES</span>
            <button className="link label" style={{ padding: 0, textDecoration: 'none' }} onClick={() => nav.go('notes')}>
              ALL {notes.data?.length ?? 0} →
            </button>
          </div>
          <div className="minis">
            {recentNotes.map((note) => (
              <button key={note.id} className="mini" onClick={() => nav.go('notes', { kind: 'note', id: note.id })}>
                <span className="pips">
                  {note.checklist ? (
                    Array.from({ length: Math.min(note.checklist.total, 8) }, (_, index) => (
                      <i key={index} className={index < note.checklist!.done ? 'on' : ''} />
                    ))
                  ) : (
                    <i className={note.pinned ? 'signal' : 'on'} />
                  )}
                </span>
                <strong>{note.title || 'Untitled'}</strong>
                <span>{note.body || 'Empty note'}</span>
              </button>
            ))}
            <button className="mini" onClick={() => nav.go('notes', { kind: 'newNote', with: 'text' })}>
              <span className="pips">
                <i />
              </span>
              <strong>Take a note…</strong>
              <span>One click to a blank page</span>
            </button>
          </div>
        </section>

        {data && data.budgets.length > 0 ? (
          <section className="tile span2" aria-label="Budgets">
            <span className="label">BUDGETS · {monthName}</span>
            {data.budgets.map((budget) => {
              const tenths = Math.min(10, Math.round((budget.ratioUsed ?? 0) * 10));
              const over = budget.overspent || (budget.ratioUsed ?? 0) >= 0.8;
              return (
                <div key={budget.categoryId} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 150px', gap: 12, alignItems: 'center' }}>
                  <span className="sub" style={{ color: 'var(--text)' }}>
                    {budget.name}
                  </span>
                  <span className={`meter ${over ? 'over' : ''}`}>
                    {Array.from({ length: 10 }, (_, index) => (
                      <span key={index} className={index < tenths ? 'on' : ''} />
                    ))}
                  </span>
                  <span className={`mono small ${budget.overspent ? 'neg' : 'muted'}`} style={{ textAlign: 'right' }}>
                    {budget.overspent
                      ? `${budget.remaining.figure.replace('−', '')} over`
                      : `${budget.spent.figure} / ${budget.available.figure}`}
                  </span>
                </div>
              );
            })}
          </section>
        ) : null}
      </div>

      <p className="label" style={{ marginTop: 20 }}>
        {data?.eventCount ?? 0} CHANGES RECORDED ON THIS COMPUTER
      </p>

      {configuring ? <AllowanceConfig onClose={() => setConfiguring(false)} /> : null}
    </>
  );
}

function AllowanceTile({ data, onConfigure }: { data: AllowanceDto; onConfigure: () => void }) {
  const ratio = Math.max(0, Math.min(1, data.ratioUsed));
  const outer = 2 * Math.PI * 33;
  const inner = 2 * Math.PI * 24;
  return (
    <button className="tile" onClick={onConfigure} title={data.label}>
      <span className="label">FX ALLOWANCE</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="dial">
          <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
            <circle cx="38" cy="38" r="33" fill="none" stroke="var(--border)" strokeWidth="6" strokeDasharray="1.6 3.58" />
            <circle cx="38" cy="38" r="33" fill="none" stroke="var(--text)" strokeWidth="6" strokeDasharray={`${outer * ratio} ${outer}`} />
            {data.projectedOverrun.amountMinor > 0 ? (
              <circle cx="38" cy="38" r="24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeDasharray={`${inner} ${inner}`} />
            ) : null}
          </svg>
          <span className="dots">{Math.round(ratio * 100)}</span>
        </span>
        <span className="mono small" style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--text-dim)' }}>
          <span style={{ color: 'var(--text)', fontWeight: 500 }}>{data.remaining.figure} LEFT</span>
          <span>OF {data.ceiling.display}</span>
          {data.exhaustionDate ? <span className="neg">OUT ≈ {data.exhaustionDate}</span> : null}
          {data.unvaluedCount > 0 ? <span className="est">{data.unvaluedCount} NOT VALUED YET</span> : null}
        </span>
      </span>
    </button>
  );
}

function AllowanceConfig({ onClose }: { onClose: () => void }) {
  const existing = useVaultQuery(() => api().readAllowanceConfig());
  const currencies = useVaultQuery(() => api().listCurrencies());
  const { busy, error, run } = useRunner();
  const [form, setForm] = useState<AllowanceConfigDto | null>(null);

  const state = form ?? existing.data;
  if (!state) return null;

  return (
    <Modal
      title="Foreign currency allowance"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api().saveAllowanceConfig(state);
                onClose();
              })
            }
          >
            Save
          </button>
        </>
      }
    >
      <div className="row">
        <Field label="Annual ceiling">
          <input
            value={state.ceiling}
            onChange={(event) => setForm({ ...state, ceiling: event.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Currency">
          <select
            value={state.currency}
            onChange={(event) => setForm({ ...state, currency: event.target.value })}
          >
            {currencies.data?.map((currency) => (
              <option key={currency.code} value={currency.code}>
                {currency.code}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Year starts in month">
          <input
            type="number"
            min={1}
            max={12}
            value={state.yearStartMonth}
            onChange={(event) =>
              setForm({
                ...state,
                yearStartMonth: Math.min(12, Math.max(1, Number(event.target.value) || 1)),
              })
            }
          />
        </Field>
      </div>

      <p className="muted small">
        The ceiling is what the card may be debited over the allowance year, in the card&apos;s
        billing currency. Leave it empty to turn the tracking off.
      </p>

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
