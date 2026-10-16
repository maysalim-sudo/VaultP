/** Categories, budgets, and getting the vault in and out. */

import { useEffect, useState } from 'react';

import type { CategoryDto, CategoryFormDto, UpdateStatusDto } from '../../shared/api.js';
import { Field, Modal } from '../Modal.js';
import { api, baseCurrency, useRunner, useVaultQuery } from '../vault.js';
import { DriveSettings } from './Drive.js';

export function Settings() {
  const categories = useVaultQuery(() => api().listCategories());
  const { busy, error, run } = useRunner();
  const [editing, setEditing] = useState<{ category: CategoryDto | null } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <>
      <div className="head">
        <h2>Settings</h2>
        <button onClick={() => setEditing({ category: null })}>New category</button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="muted small">{message}</p> : null}
      {editing ? <CategoryForm category={editing.category} onClose={() => setEditing(null)} /> : null}

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
              <button className="link" disabled={busy} onClick={() => setEditing({ category })}>
                edit
              </button>
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

      <UpdateSettings />

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

/**
 * Updates: one switch, and what it costs in privacy said beside it.
 *
 * The state is pushed from the main process as it changes, so a download that
 * finishes while this screen is open turns into a Restart button by itself.
 */
function UpdateSettings() {
  const [status, setStatus] = useState<UpdateStatusDto | null>(null);
  const { busy, error, run } = useRunner();

  useEffect(() => {
    let live = true;
    void api()
      .updateStatus()
      .then((current) => live && setStatus(current));
    const unsubscribe = api().onUpdateStatus((next) => setStatus(next));
    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  if (!status) return null;

  return (
    <>
      <h3>Updates</h3>
      <p className="small">
        Version {status.currentVersion}
        {status.state === 'unsupported' ? null : <> · {describe(status)}</>}
      </p>

      {status.state === 'unsupported' ? (
        <p className="muted small">{status.detail}</p>
      ) : (
        <>
          <label className="row check">
            <input
              type="checkbox"
              checked={status.enabled}
              disabled={busy}
              onChange={(event) => {
                const enabled = event.target.checked;
                void run(async () => setStatus(await api().setUpdateChecks(enabled)));
              }}
            />
            <span>Check for updates automatically</span>
          </label>
          <div className="row">
            {status.state === 'ready' ? (
              <button disabled={busy} onClick={() => void run(() => api().installUpdate())}>
                Restart to update
              </button>
            ) : (
              <button
                className="secondary"
                disabled={busy || status.state === 'checking' || status.state === 'downloading'}
                onClick={() => void run(async () => setStatus(await api().checkForUpdates()))}
              >
                Check now
              </button>
            )}
          </div>
          <p className="muted small">
            Checking asks GitHub, where VaultP is published, whether a newer version exists. GitHub
            sees this computer's address and that it runs VaultP — nothing from the vault. With the
            box unticked, nothing is sent unless you press Check now.
          </p>
        </>
      )}
      {error ? <p className="error">{error}</p> : null}
    </>
  );
}

function describe(status: UpdateStatusDto): string {
  switch (status.state) {
    case 'checking':
      return 'checking…';
    case 'downloading':
      return `downloading ${status.nextVersion ?? 'an update'}…`;
    case 'ready':
      return `${status.nextVersion ?? 'an update'} is ready — it installs when VaultP closes`;
    case 'current':
      return 'up to date';
    case 'error':
      return status.detail ?? 'the last check failed';
    default:
      return status.enabled ? 'checks automatically' : 'automatic checks are off';
  }
}

function CategoryForm({ category, onClose }: { category: CategoryDto | null; onClose: () => void }) {
  const { busy, error, run } = useRunner();
  const [form, setForm] = useState<CategoryFormDto>({
    name: category?.name ?? '',
    monthlyLimit: category?.monthlyLimit?.text ?? '',
    rollover: category?.rollover ?? false,
  });

  return (
    <Modal
      title={category ? 'Edit category' : 'New category'}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button
            disabled={busy || form.name.trim() === ''}
            onClick={() =>
              void run(async () => {
                if (category) await api().updateCategory(category.id, form);
                else await api().addCategory(form);
                onClose();
              })
            }
          >
            {category ? 'Save' : 'Create'}
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
