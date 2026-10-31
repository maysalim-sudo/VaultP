# Changelog

What changed in each release, for the people using it. The newest is first.
Each `## <version>` section becomes that release's notes on GitHub.

## Unreleased

- **The phone wears the new look everywhere.** Home is the bento: the month as
  one bar per day, a note one tap away, what you are owed and owe, the next
  bill, what needs you and recent notes.
- **Money on the phone.** Spent lists every charge under its day, with budgets
  as segmented meters; People, Repeats and Accounts match the computer.
- **Every amount on the phone fills from the right**, like a card terminal, so
  the decimals are always there.
- **Vault** leads with whether the computer is in step, and has a light, dark or
  automatic theme of its own.
- Fixed: opening the phone app asked for the fingerprint twice.
- Fixed: a recurring charge created just after midnight was dated the day
  before, and could log a charge for that day.

## 0.2.0

- **A new look.** Black or warm paper, soft tiles, one safety orange for what
  wants you, and figures on a dot-matrix face. Light, dark, or following the
  system, chosen from the rail or in Vault settings.
- **Four places instead of eight.** Home, Money, Notes and Documents, with the
  orange + (or Ctrl+N) for anything new. Money holds what was spent, people and
  debts, what repeats, and accounts, as tabs.
- **The overview** shows the month as one bar per day, what you are owed and
  owe, the next bill, and what needs you.
- **Amounts read the same everywhere**: 1,240.500 TND, three decimals for the
  dinar, never "DT" on one screen and "TND" on the next.
- **Adding an expense works like a card terminal**: digits fill in from the
  right, so the decimals are always there.
- **Linux.** An AppImage that updates itself, and a .deb for Ubuntu and Kubuntu.
- Sync moved out of the top of every page into Vault settings; a small pill
  says whether the phone has actually been in touch.
- Dates in forms read day/month/year whatever the system's language.
- Fixed: checklist items in the computer's note editor showed no text.
- Fixed: installed copies looked for updates in the wrong place.
- The computer can update itself. It checks GitHub for a new version, downloads
  it in the background, and installs it when VaultP closes, or straight away
  with **Restart to update**. Checking is a setting, and Settings says what it
  reveals: that this computer runs VaultP, nothing from the vault.
- Pairing explains why Windows turns the phone away, and fixes it with one
  button. That button adds a single firewall rule: VaultP only, its sync ports
  only, the local network only.
- The phone tries every address of the computer at once. A computer with a
  virtual network adapter (VirtualBox, Hyper-V, Tailscale) no longer leaves the
  phone waiting a minute before saying it cannot connect.
- Opening a vault with an older version of the app now says plainly to update,
  instead of showing a technical error. Nothing is changed in the vault.

## 0.1.0

The first release: an encrypted vault for notes, expenses, debts and documents,
on Android and Windows, kept in step by scanning a QR code.
