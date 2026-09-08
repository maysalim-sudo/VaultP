/** Categories, budgets, and getting the vault in and out. */

import { useState } from 'react';

import type { CategoryFormDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { api, baseCurrency, useRunner, useVaultQuery } from '../vault.js';
import { DriveSettings } from './Drive.js';

export function Settings() {
  const categories = useVaultQuery(() => api().listCategories());
  const { busy, error, run } = useRunner();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <div className="head">
        <h2>Settings</h2>
        <button onClick={() => setAdding(true)}>New category</button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="muted small">{message}</p> : null}
      {adding ? <CategoryForm onClose={() => setAdding(false)} /> : null}

      <h3>Categories</h3>
      <ul className="list">
        {categories.data?.map((category) => (
          <li key={category.id}>
            <span>
              {category.name}
              {category.monthlyLimit ? (
                <em className="muted">
                  {' '}
                  · {category.monthlyLimit.text} {category.monthlyLimit.currency} a month
                  {category.rollover ? ', unspent carries over' : ''}
                </em>
              ) : (
                <em className="muted"> · no budget</em>
              )}
            </span>
            <span className="right">
              <button
                className="link"
                disabled={busy}
                onClick={() => void run(() => api().archiveCategory(category.id))}
              >
                archive
              </button>
            </span>
          </li>
        ))}
      </ul>
      {categories.data?.length === 0 ? <p className="muted small">No categories yet.</p> : null}
      <p className="muted small">
        Archiving hides a category from new entries. It is never deleted, so past
        expenses keep a readable heading.
      </p>

      <DriveSettings />

      <h3>Backup</h3>
      <div className="row">
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const path = await api().exportBackup();
              setMessage(path ? `Written to ${path}` : null);
            })
          }
        >
          Export the vault
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const result = await api().restoreBackup();
              setMessage(
                result
                  ? `${result.applied} of ${result.total} changes were new to this vault.`
                  : null,
              );
            })
          }
        >
          Restore from a backup
        </button>
      </div>
      <p className="warn small">
        An exported backup is the whole vault in the clear — every expense, document
        record, debt and note, unencrypted. Put it somewhere you would be willing to
        keep the vault itself.
      </p>
      <p className="muted small">
        Restoring merges rather than replaces, and is safe to run twice: changes carry
        their own ordering, so nothing already here is lost.
      </p>
    </>
  );
}

function CategoryForm({ onClose }: { onClose: () => void }) {
  const { busy, error, run } = useRunner();
  const [form, setForm] = useState<CategoryFormDto>({
    name: '',
    monthlyLimit: '',
    rollover: false,
  });

  return (
    <Modal
      title="New category"
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button
            disabled={busy || form.name.trim() === ''}
            onClick={() =>
              void run(async () => {
                await api().addCategory(form);
                onClose();
              })
            }
          >
            Create
          </button>
        </>
      }
    >
      <Field label="Name">
        <input
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          autoFocus
        />
      </Field>

      <Field label={`Monthly budget (${baseCurrency()}) — leave blank for none`}>
        <input
          value={form.monthlyLimit}
          onChange={(event) => setForm({ ...form, monthlyLimit: event.target.value })}
          placeholder="no budget"
        />
      </Field>

      {form.monthlyLimit.trim() ? (
        <label className="row check">
          <input
            type="checkbox"
            checked={form.rollover}
            onChange={(event) => setForm({ ...form, rollover: event.target.checked })}
          />
          <span>Carry unspent budget into the next month</span>
        </label>
      ) : null}

      <p className="muted small">
        Overspending never carries forward as debt — a bad month starts the next one
        clean.
      </p>

      {error ? <p className="error">{error}</p> : null}
    </Modal>
  );
}
