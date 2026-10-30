# VaultP UI plan: finish and polish

Written 2026-10-30. Goal: one product, the same on the phone, the desktop and the
prototype. Each phase ends with something you can look at and approve before the
next starts.

Canonical design: `docs/ux/vaultp-ui-kit.figcraft` (64 artboards). Exports: `docs/ux/previews/`.

---

## Decisions (taken 2026-10-30: the recommendations below)

| # | Question | Decision |
|---|---|---|
| D1 | Number format | `1,240.500 TND`: dot for decimals, comma for thousands, always 3 decimals for TND. It matches the prototype and bank statements in English. |
| D2 | Currency label | `TND` everywhere. Drop `DT` (today both appear on one screen). |
| D3 | Unit placement on hero figures | Right after the number, smaller and dimmed (`428.750 TND`), not floated to the far right. |
| D4 | Icon set | Lucide (ISC licence). `lucide-react-native` on the phone, `lucide-react` on the desktop. One stroke weight (1.75). |
| D5 | Phone navigation | Bottom tabs from the prototype (Home, Notes, +, Expenses, More). Retire the emoji rail and drawer. |
| D6 | "Needs attention" | One shared block (bills due, documents expiring, debts overdue, charges awaiting a statement) used on both Home screens. |

---

## Phase 0: housekeeping (before touching UI)

- [x] The 51 "modified" files on the Windows checkout were CRLF line endings only (plus one deleted doc comment, kept). Added `.gitattributes` (`eol=lf`) so it stops recurring. Work continues on `ui-pass`.
- [x] Track `docs/ux/` (FigCraft files, previews, this plan). Leave out the one-off scripts (`make-dark-*.py`, `patch_dark_colors.py`, `inspect-*.json`, `fix-*.json`) or move them to `docs/ux/tools/`.
- [x] Found and fixed: `.gitignore`'s `vault/` rule also matched `apps/mobile/src/vault/`, so `keys.ts`, `open.ts` and `VaultContext.tsx` were never committed (a fresh clone could not build the phone app). Now tracked.
- [x] Baseline: `npm run typecheck` passes in all workspaces; core tests 468/468. Desktop tests need the Electron SQLite binary (run on Windows).

**Done when:** clean `git status`, tests pass, `ui-pass` branch exists.

---

## Phase 1: foundations in `packages/core` (fixes every screen at once)

### 1.1 One money formatter
Today there are three paths:
- `core/money/money.ts → formatMoney` (Intl currency style, gives `DT` with `fr-TN`)
- `mobile/screens/Home.tsx` own `Intl.NumberFormat` + hard-coded `'DT'` (also `Accounts.tsx:297`, `Debts.tsx:187`)
- desktop main sends `toDecimalString` (`1921.850`, no grouping) via `handlers/serialize.ts`

- [x] Add `formatAmount(m, opts)` in core returning `{ sign, figure, unit, text }`. Options: `estimated` (prefix `≈`), `signed`, `unit: 'code' | 'none'`. Exponent always from `currency.ts`.
- [x] Tests: TND 3 decimals, JPY 0, negatives, `≈`, grouping, a large figure.
- [x] Replace every local formatter on the phone. Desktop: serialize `{figure, unit}` parts from main, never a bare decimal string for display.
- [x] Grep guard in a test: no `'DT'` and no `Intl.NumberFormat` outside core.
- Done 2026-10-30: `formatAmount` / `formatAmountParts` in `core/money/money.ts` (no `Intl`, so Hermes and Chromium print the same). Desktop `MoneyDto` gained `display` and `figure`; `text` stays the plain decimal that edit fields start from. Guard: `core/money/formatGuard.test.ts`. Core 479, desktop 42 tests pass.

### 1.2 Amount colour rule
- [ ] One `amountTone(kind)` helper: `positive` (coming back), `negative` (owed / overspent), `estimate` (≈), `text` (an ordinary expense). `danger` stays for destructive buttons only (as `tokens.ts` already says).
- [ ] Fix the cases that break it: account balance below zero (Rizon `−120.000` in red-orange), repayment amounts, archived note cards (show them neutral, not in their note colour).

### 1.3 Tokens additions
- [ ] Contrast: raise `textFaint` / `textDim` in light mode until small captions pass WCAG AA (4.5:1) on `bg` and `surfaceRaised`. Add a token test that checks the ratios.
- [ ] Dark note shades: replace the muddy browns in `noteShades.dark` with tinted surfaces that stay in hue.
- [ ] Add `iconSize` and `iconStroke` to the tokens.

**Done when:** a screenshot of Home, Accounts and the desktop Dashboard all show the same figure the same way.

---

## Phase 2: finish the design in FigCraft

Fix in the UI kit first, then build. Each item is an artboard edit, light and dark.

### 2.1 Fixes to existing artboards
- [ ] Icons: replace letter avatars with Lucide icons everywhere except people (Samir, Amel keep initials). More hub, Quick create, accounts, documents, expenses (category icon).
- [ ] Bottom nav: inactive "More" dots overlap the label.
- [ ] Scan pairing (light): "Waiting for the computer…" is white on white.
- [ ] Lock: "Forgot passphrase?" → "Can't remember it?" → explains start-over (old vault kept as a backup).
- [ ] Hero figures: unit placement per D3.
- [ ] Accounts: each row shows "Now ≈ 981.500" as the main figure, "Bank said 1,000.000 · 12 Sep" as the secondary. Header total labelled "Estimated now", with the checked dates on tap.
- [ ] Quick create: a bottom sheet over Home, not a page.
- [ ] Expense form: one form for add and edit. Amount, what for, category (one control, one list), paid with (a compact picker row showing the default, not five radio rows), date, merchant, note, receipt. Edit adds only "Delete". One save button at the bottom; no top-right Save.
- [ ] Settings: App lock as a toggle like Reminders.
- [ ] Documents: drop the per-row "View" link; the row opens it. Expiring documents get a labelled badge ("Expires in 62 days"), not only a yellow card.
- [ ] Search: a debt repayment is grouped under People, not Expenses.
- [ ] Footnotes: cut the grey explanation paragraph on every screen. Keep it only where a choice is irreversible (create vault, delete, pairing). Move the rest to empty states or a one-time hint.
- [ ] Home: move "Needs attention" (D6) up under search; drop the thin ochre strip above the tab bar.

### 2.2 Missing states (the strategy doc lists them as remaining)
- [ ] Empty states: Notes, Expenses, Documents, People, Recurring, Accounts, Search with no results, first day with no data on Home.
- [ ] Confirmations: delete expense, remove payment method in use, remove person with a balance, empty archive, start over on a computer.
- [ ] Errors and progress: sync failed / computer not found, image attach failed (retry, text kept), OCR running, vault from a newer version.
- [ ] Toast: saved, undo after delete (the event log already supports undo).

### 2.3 Desktop artboards (none exist)
- [ ] Layout: left sidebar (icons + labels), content max-width, a right-hand detail pane for lists (expenses, notes, documents, people).
- [ ] Screens: Dashboard, Expenses (list + detail pane), Notes (grid + editor), Documents, People & ledger, Recurring, Accounts, Settings, Sync & pairing, Lock.
- [ ] Sync moves out of the dashboard header into the sidebar footer as a status line ("Synced 2 min ago · Sync now").
- [ ] Dashboard uses the same blocks as phone Home (spending, attention, accounts, allowance, budgets), arranged in a grid.

**Done when:** you approve the updated previews (light and dark) and the desktop set.

---

## Phase 3: build the phone to the prototype

- [ ] Icons: add `lucide-react-native`. Replace emoji in `vault/open.ts` (`STARTER_CATEGORIES` stores an emoji per category: map category id to a Lucide name, keep the stored field for old vaults), `Sidebar.tsx`, `Home.tsx`, `Notes.tsx`, `Search.tsx`, `Debts.tsx`, `CategoryChips.tsx`.
- [ ] Navigation: bottom tab bar + centre create button → Quick create sheet. More hub screen. Keep `navigation.ts` intents as they are.
- [ ] Shared components in `components/`: `ScreenHeader`, `Amount` (uses the core formatter), `ListRow`, `SectionLabel`, `Sheet`, `Toggle`, `ConfirmSheet`, `EmptyState`, `Toast`.
- [ ] Rebuild screens in this order (most used first): Home → Expense form → Expenses list → Notes list → Accounts → People & debts → Documents → Recurring → Settings / Sync / More.
- [ ] Remove dead screens once replaced (`Dashboard.tsx` vs Home overlap, `Sidebar.tsx`).

**Done when:** phone screenshots match the previews side by side, light and dark.

---

## Phase 4: build the desktop to its artboards

- [ ] `lucide-react`, the same shared component names in `renderer/components/`.
- [ ] Sidebar with sync status; list + detail pane screens.
- [ ] Remove "Choose sync folder" and "Foreign allowance" header buttons (one goes to Settings → Sync, one becomes a dashboard card).
- [ ] Keyboard: `Ctrl+K` search, `Ctrl+N` quick create, `Esc` closes panes.

**Done when:** desktop screenshots match the artboards.

---

## Phase 5: verify

- [ ] Screenshot every screen on both apps in light and dark, and lay them next to the previews (contact sheet).
- [ ] Contrast check on the real screens, not just the tokens.
- [ ] Android font scale at 1.3: nothing clipped (the `Written on t…` truncation on Home today).
- [ ] `npm test && npm run typecheck`, then a release build of each app.
- [ ] Update `README.md` screenshots and `CHANGELOG.md`.

---

## Order and size

| Phase | Size | Can start |
|---|---|---|
| 0 Housekeeping | ½ day | now |
| 1 Foundations | 1–2 days | after 0 |
| 2 Design in FigCraft | 2–3 days | in parallel with 1 |
| 3 Phone build | 4–6 days | after 1 and 2 |
| 4 Desktop build | 3–5 days | after 1 and 2.3; parallel with 3 |
| 5 Verify | 1 day | at the end |
