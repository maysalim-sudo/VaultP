# Changelog

What changed in each release, for the people using it. The newest is first.
Each `## <version>` section becomes that release's notes on GitHub.

## Unreleased

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
