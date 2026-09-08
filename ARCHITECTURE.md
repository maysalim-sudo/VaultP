# VaultP — Architecture

Status: v0.3, 2026-09-07. Written as a plan, updated to match what was actually
built. Where the two disagreed, the code won and this document was corrected —
sections marked **CHANGED** record decisions that did not survive contact.

This document covers *how*, not *what*. The v0.1 feature spec remains the backlog.

Target: Android phone + Windows desktop, single user, local-first, no server.

---

## 1. Principles

1. **Local-first.** Each device holds a complete, authoritative copy of the data.
   Every feature works with the network off, permanently, not as a degraded mode.
2. **No server.** Cloud storage is a dumb encrypted file drop. It never sees
   plaintext, never runs our code, and can be swapped for another provider.
3. **Append-only.** Nothing is ever overwritten. State is derived by replaying an
   event log. This gives audit trail, undo, versioned backup, and sync from one
   mechanism instead of four.
4. **Compute on read.** Balances, budgets, interest, and forecasts are derived,
   never stored as mutable totals.
5. **Encrypted at rest, always.** From the first commit, not retrofitted.

---

## 2. There is no shared database

Both apps keep their own SQLite file. Nothing is shared live. What travels between
devices is a set of **encrypted append-only log segments** in a cloud folder.

```
[Android]  local SQLite  <--replay--  local oplog  --encrypt+upload--> \
                                                                       > cloud folder (ciphertext only)
[Windows]  local SQLite  <--replay--  local oplog  --encrypt+upload--> /
```

Each device writes **only to its own directory** in the cloud folder, so two
devices can never conflict on a write. Reconciliation happens locally,
deterministically, on replay.

---

## 3. Stack

| Layer | Choice | Why |
|---|---|---|
| Shared core | TypeScript package, no UI | The hard parts (crypto, oplog, sync, money math) written once and unit-tested |
| Android | React Native | Already shipped RN; fastest path to daily use |
| Windows | Electron + React | Same core, same language, desktop-appropriate UI |
| Database | SQLite + SQLCipher (AES-256) | Relational, single file, zero-config, transparent full-file encryption |
| DB bindings | `op-sqlite` (Android), `better-sqlite3` + SQLCipher (desktop) | Same SQL both sides behind a thin adapter |
| Search | SQLite FTS5, inside the encrypted DB | One index across all modules; never a plaintext side file |
| OCR | ML Kit on-device (Android) | ID scans never leave the phone |
| Cloud | Storage-backend interface, plain-folder implementation | **CHANGED** — the folder implementation shipped and Drive was never needed. Any folder kept in step by something else works, with no account, token or API key |
| Native crypto | react-native-quick-crypto (Android), WebCrypto (desktop) | **CHANGED** — see "Why the KDF is native" |

### Repo layout

```
VaultP/
  packages/core/        domain logic, schema, oplog, crypto, sync — no UI, no platform APIs
  apps/mobile/          React Native (Android)
  apps/desktop/         Electron + React (Windows)
```

`core` must never import a platform API. Platform capabilities (filesystem,
keystore, network) are passed in as injected interfaces so `core` runs under Node
in tests.

---

## 4. Cryptography and keys

### Key hierarchy

```
passphrase --Argon2id(salt, m=64MB, t=3, p=1)--> KEK
                                                  |
                                 AES-256-GCM unwrap
                                                  v
                           DK  (32 random bytes, the root data key)
                                |
                 HKDF-SHA256 with distinct info strings
       +------------------------+------------------------+
       v                        v                        v
   SQLCipher key            file key                 oplog key
   ("vaultp/db")          ("vaultp/files")         ("vaultp/oplog")
```

- **DK** is generated once, at vault creation, from a CSPRNG. It never leaves the
  device in plaintext and is never written to disk unwrapped.
- **The passphrase is the only recovery path.** It is written on paper by the user
  at setup. Losing it means losing the data — that is the intended property.
- The passphrase-wrapped DK (`keyfile.json`) is stored locally *and* in the cloud
  folder, which is how a new device bootstraps: install, enter passphrase, sync.

### Why the KDF is native — **CHANGED**

The plan assumed PBKDF2 in JavaScript would do. Measured on the actual phone, it
runs 10,000 iterations in 3.8 seconds — roughly 40x slower than Node. That is 80
seconds at the 210,000 iterations this vault uses, and nearly four minutes at the
600,000 OWASP recommends for SHA-256.

Lowering the count until JavaScript felt fast would have meant choosing a weaker
KDF to hide a slow implementation. So Android uses a native module, which also
supplies the AES-GCM that sync needs. HKDF stays portable JavaScript: it is a
handful of HMACs and costs nothing.

The measurement is the point. The plan's assumption was wrong by a factor of
forty, and only running it on the device said so.

### Convenience unlock

Typing a long passphrase daily is unacceptable for an app opened to log a coffee.

- **Android:** DK is additionally wrapped by an Android Keystore key requiring
  biometric auth. Face/fingerprint unlocks in one gesture.
- **Windows:** DK is additionally wrapped via Electron `safeStorage` (DPAPI),
  gated by a short local PIN.

Both are *convenience* wrappers over the same DK. The passphrase wrap always
remains valid and is the fallback.

### Decoy vault ("panic PIN")

Two independent vaults, each with its own DK, keyfile slot, and database file. The
PIN entered at unlock selects which slot to unwrap. The decoy is a real, empty,
functioning vault.

> **Honest limitation:** this hides content from a casual observer. It does not
> withstand forensic inspection — two encrypted databases are visible on disk. It
> is a deterrent, not a security control. Built because it was requested as such.

### File encryption

Document scans and receipt photos are **not** stored in the database. Each file is
encrypted with AES-256-GCM under a per-file key derived from the file key and the
file id, stored on disk as `files/<file_id>.enc`. The DB holds only metadata and
the reference. Rationale: multi-megabyte blobs in SQLite bloat every query, every
backup, and every sync segment.

---

## 5. The event log (oplog)

Every mutation in the system is an event. The database is a cache of the replay.

### Event shape

```json
{
  "id":        "uuidv7",
  "hlc":       "2026-09-07T10:22:31.123Z|0007|dev_a1b2",
  "device":    "dev_a1b2",
  "entity":    "expense",
  "entity_id": "uuidv7",
  "op":        "put",
  "fields":    { "amount_minor": 4500, "category_id": "...", "note": "coffee" },
  "schema_version": 1
}
```

`op` is `put` or `delete`. A `put` carries only the fields that changed, not the
whole row.

### Ordering: hybrid logical clock

Wall clock alone is unsafe — device clocks drift and the desktop may be off for
weeks. An HLC is `physical_time | logical_counter | device_id`, compared in that
order. This yields a **total order** across devices that respects causality and
breaks ties deterministically, so both devices always converge on the same state
without any coordination.

### Merge rule: per-field last-write-wins

Each row carries a `_meta` JSON column mapping `field -> hlc` of the write that
last set it. On replay, a field is updated only if the incoming event's HLC is
greater than the stored one. Per-field rather than per-row so that editing an
amount on the phone and a note on the desktop does not lose one of them.

### What this buys us for free

| Requested feature | How the oplog provides it |
|---|---|
| Debt audit trail | The log *is* the history. Every edit, forever, replayable. |
| Versioned backup | Append-only; nothing can be overwritten by a bad sync. |
| Document versioning | Old file refs remain in earlier events. |
| Undo | Replay to an earlier HLC. |
| Sync | Its original purpose. |

---

## 6. Sync protocol

### Cloud folder layout

```
VaultP/
  keyfile.json                    wrapped DK (passphrase wrap only)
  oplog/
    dev_a1b2/000001.seg.enc       Android writes only here
    dev_c3d4/000001.seg.enc       Desktop writes only here
  snapshots/
    <hlc>.snap.enc                compaction, so a new device need not replay all history
  files/
    <file_id>.enc
```

Single-writer-per-directory means write conflicts are structurally impossible.

### Cycle

1. Encrypt and upload local events not yet uploaded, as a new numbered segment.
2. List remote segments; download those past our cursor for each foreign device.
3. Decrypt, merge into the local oplog, replay in HLC order.
4. Advance cursors.

Idempotent and interruption-safe: a partial sync just means fewer events applied,
and the next run catches up. Segments are immutable once written.

### Compaction

Past a threshold of events, write an encrypted snapshot of materialized state plus
the HLC watermark. A fresh install loads the newest snapshot and replays only
segments after it. Old segments are retained (they are the audit trail) but leave
the bootstrap path.

### Storage backend interface

```ts
interface StorageBackend {
  list(prefix: string): Promise<RemoteObject[]>
  get(key: string): Promise<Uint8Array>
  put(key: string, data: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
}
```

Implementations: `GoogleDriveBackend` (appDataFolder scope), `LocalFolderBackend`
(a directory kept in sync by Syncthing or the Drive desktop client). Everything
above this interface is provider-agnostic.

**RESOLVED.** The Drive backend was never written. The folder implementation does
the whole job: point both devices at a directory something else keeps in sync and
they converge, with no account, no OAuth and nothing that expires. The open risk
was retired by not taking it.

Writes land on a temporary name and are renamed into place. A sync client watching
the folder copies whatever appears, and a rename is atomic where a slow write is
not — otherwise the other device eventually reads a truncated segment.

---

## 7. Schema

Conventions:

- Ids are UUIDv7 `TEXT` — time-sortable, generated offline, collision-free across devices.
- **Money is integer minor units** (`amount_minor`). Never floats. The number of
  minor units per major unit is **per-currency, not always 100** — see
  "Currency handling" below. This is not a detail; it is a correctness trap.
- Every entity table carries `created_at`, `updated_at`, `deleted_at` (soft delete,
  required for sync), and `_meta` (per-field HLC map).
- Multi-currency and sync columns exist from day one even though v1 does not use
  them. Adding them later means rewriting every row and every event.

### v1 tables (Expenses)

```
category(
  id, name, kind, monthly_limit_minor, rollover, color, icon, sort_order, archived,
  created_at, updated_at, deleted_at, _meta)

expense(
  id, occurred_on, amount_minor, currency, fx_rate, base_amount_minor,
  category_id, merchant, note, recurring_rule_id, source,
  created_at, updated_at, deleted_at, _meta)

recurring_rule(
  id, name, amount_minor, currency, category_id,
  frequency, interval_n, anchor_date, next_due_on,
  auto_log, active, last_seen_amount_minor,
  created_at, updated_at, deleted_at, _meta)
```

`last_seen_amount_minor` is what makes subscription price-change detection a
comparison rather than a feature.

### Currency handling (base: TND)

**Base currency is TND.** This is not a cosmetic setting — it forces two design
decisions that a EUR/USD-based app would never surface.

#### 1. TND has three decimal places

The Tunisian dinar divides into 1000 millimes, not 100 centimes. ISO 4217 gives it
an exponent of 3.

| Currency | Exponent | 1 major unit = |
|---|---|---|
| TND | 3 | 1000 minor |
| USD | 2 | 100 minor |
| EUR | 2 | 100 minor |

Consequences, all mandatory:

- **No `* 100` anywhere in the codebase.** Conversion goes through a currency
  table: `minorUnits(currency)`. A hardcoded 100 silently divides every TND amount
  by ten and the error is invisible until a total is wrong.
- Parsing, formatting, keypad entry, and CSV export are all exponent-aware.
- Rounding on conversion rounds to the *target* currency's exponent.
- The core test suite must include TND↔USD cases specifically, because a
  2-decimal-only test suite passes while the app is broken.

#### 2. Foreign subscriptions: record what the bank charged, not a market rate

Monthly USD subscriptions (Claude, Google) plus intermittent ones (CapCut, Topaz,
Canva, Adobe) are billed in USD but settled from a TND card. The bank applies its
own rate plus fees, so the market rate on the billing date is *not* what left the
account.

So the entry model is inverted from the usual one:

```
user enters:   amount_minor = 20.00 USD      (what the vendor charged)
user enters:   base_amount_minor = 68.400 TND (what the bank actually took)
system derives: fx_rate = effective rate, including the bank's spread and fees
```

`fx_rate` is therefore *derived and stored*, never fetched. Consequences:

- No exchange-rate API dependency, no network call, no key to manage.
- Reports show true cost, spread and fees included — which is the number that
  matters, since the spread on a foreign card is not small.
- Optionally: fetch a market rate purely to display the implied bank markup.
  Informational only; it never touches a stored amount.

Both amounts are snapshotted at entry and never recomputed. A historical entry must
not change when today's rate moves.

#### 3. Foreign-currency allowance

A Tunisian card carries an annual ceiling on international payments. This is a
constraint no ordinary budget category can express:

- the limit is **annual**, not monthly;
- it counts every non-TND transaction regardless of what it was for;
- exceeding it means cards are **declined**, not merely a budget looking bad.

So it is modelled separately. Consumption is measured by the amount the bank
actually debited — spread included — because that is what the ceiling is measured
against; a market-rate conversion would understate it.

The forecast projects active foreign `recurring_rule`s to the end of the period at
the rate the bank last applied to that rule, and reports **the date the ceiling
runs out**. A rule with no past charge to derive a rate from is listed in
`rulesWithoutRate` and excluded, so the projection is a floor rather than a guess.

Ceiling and year-start month are configuration, since the rules change and differ
by card. Nothing hardcodes an amount.

#### 4. Intermittent subscriptions

CapCut, Topaz, Canva, and Adobe come and go with the work. A `recurring_rule` is
therefore not strictly periodic; it carries a state:

- `active` — auto-log or remind on schedule
- `paused` — retained with its history, excluded from forecasts, resumable in one tap
- `ended` — kept for reporting, never fires again

Forecasting counts `active` rules only. Deleting a cancelled subscription would
destroy the spending history that makes year-over-year comparison possible, so
nothing is deleted.

### Defined now, built later

```
person(id, name, contact, ...)
debt_entry(id, person_id, direction, kind, amount_minor, currency, occurred_on, note, ...)
  kind: loan | payment | interest | settlement
document(id, title, file_id, extracted_text, expiry_date, reminder_lead_days, ...)
note(id, body, due_at, notify, done, ...)
tag(id, name) / tagging(tag_id, owner_type, owner_id)
```

### Cross-module glue (the reason this is one app)

```
file(id, filename, mime, size_bytes, sha256, encrypted_path, uploaded)

attachment(id, owner_type, owner_id, file_id, kind)
  -- a receipt on an expense, a scan on a document

link(id, from_type, from_id, to_type, to_id, relation)
  -- e.g. a debt repayment that is also an expense
```

`sha256` on `file` gives duplicate detection for free.

Without `attachment` and `link`, this is three apps sharing a launcher icon.

### Search

```
search_index  -- FTS5 virtual table
  (source_type, source_id, title, body)
```

One index, one query, results grouped by type in the UI. It lives inside the
SQLCipher database, so the plaintext index is encrypted with everything else.

### Local-only tables (never synced)

```
oplog(seq, event_json, uploaded)
sync_cursor(device_id, last_seq)
device(id, label, platform, created_at)
settings(key, value)
```

---

## 8. Build order

Sequenced so a usable daily driver arrives early. Expenses first, because it is the
module opened every day.

### M1 — core, no UI
Schema, migrations, oplog, HLC, replay, crypto, money math, recurring-rule engine.
Fully unit-tested under Node. Nothing to look at; everything hard lives here.

### M2 — Android expenses (first daily-driver release)
Fast entry above all else: **amount → category → done, three taps.** If logging a
coffee is slower than that, the app has failed regardless of what else it does.
Month list with running total, categories with monthly limits, recurring rules
(auto-log or remind), passphrase setup + biometric unlock, CSV export.
No sync yet — but every mutation is already writing to the oplog.

### M3 — Windows desktop + sync
Electron app on the same core. Storage backend, sync cycle, conflict replay,
two-device convergence testing. This is where the M1 investment pays off or doesn't.

### M4 — Debts
Per-person ledger, partial payments, settlement records, reminders, interest
computed on read. PDF receipt generation instead of a shared link.

### M5 — Documents
Encrypted file store, ML Kit OCR at upload, tags, expiry reminders, quick capture,
duplicate detection via `sha256`, versioning.

### M6 — Cross-cutting
Dashboard, notes/to-do, global search UI, forecasting, net worth, RTL with
Arabic/French, decoy vault, home-screen widget, accessibility pass.

---

## 9. Decisions taken, with reasons

| Decision | Reason |
|---|---|
| SQLite over MongoDB | Mongo is a server database; Atlas means data off-device, no offline, 512MB free tier. The data model is relational. |
| TypeScript over Flutter | Desktop and mobile UIs differ enough that Flutter's shared-UI benefit is small, and it would cost a new language on the hardest code. |
| Hand-rolled oplog over CRDT library | Automerge converges correctly but queries poorly; `SUM(amount) GROUP BY category` is the core workload. |
| Sync designed in M1, shipped in M3 | Retrofitting sync onto a schema without HLCs, soft deletes, and stable ids is a rewrite. |
| Files outside the database | Multi-MB blobs degrade every query, backup, and sync segment. |
| Shared debt link dropped | It requires a server, contradicting principle 2, and leaks a name and an amount in a URL. A generated PDF delivers the same value. |
| Panic PIN kept, honestly labelled | Requested as an effect; nearly free given the key hierarchy; not represented as security. |

---

## 10. Open questions

1. Google Drive OAuth viability for a personal unverified app — verify before M3.
2. ~~Base currency~~ — **resolved: TND**, exponent 3. See "Currency handling".
3. Desktop unlock: short PIN over DPAPI, or Windows Hello?
4. Snapshot/compaction threshold — pick after observing real event volume in M2.
5. ~~Track annual foreign-currency card allowance?~~ — **resolved: yes**, built.
   See "Foreign-currency allowance" below.
