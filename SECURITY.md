# Security

VaultP holds documents, debts and spending, encrypted on the owner's own devices.
This file says what that does and does not protect against, and how to report a
problem.

## Reporting a vulnerability

Please **do not open a public issue** for anything that could expose someone's
vault.

Use GitHub's private reporting — *Security → Report a vulnerability* on this
repository — which is visible only to the maintainer.

Include what you need to make the problem reproducible: the version or commit,
what you did, and what happened. A proof of concept is welcome and never
required.

There is no bounty. This is a personal project, maintained in whatever time is
available, so please expect a reply in days rather than hours.

## Please do report

- Anything that lets a passphrase, a data key, or plaintext reach disk, a log, a
  crash report, or the sync folder.
- Ciphertext that turns out to be forgeable, malleable, or decryptable in the
  wrong context — a file blob that opens under another file's identity, a
  segment that opens under another device's.
- A way to make one device accept events another device never wrote.
- A way to get the app to overwrite a keyfile, since that destroys the only
  route back to a vault.
- Anything that makes an **estimate look like a fact**. It is a correctness bug
  rather than a memory-safety one, but the whole point of this program is that a
  number you act on is a number you can trust.

## Known and accepted

These are design decisions, not oversights. Reporting them is welcome as
discussion, but they will not be treated as vulnerabilities.

- **An exported backup is unencrypted.** It is the whole vault in the clear, by
  design, so its protection is wherever the user chooses to put it. The UI says
  so at the button.
- **A decrypted copy of a document is plaintext.** "Save a copy" exists to hand
  a file to something else; once written, it is an ordinary file.
- **The device is trusted.** Malware already running as the user, with the vault
  unlocked, can read the vault. No local-first app can prevent this.
- **The sync folder's contents are visible as metadata.** Whoever runs that
  storage sees object names and sizes — how many devices, roughly how much
  activity, and how many files exist. Contents are ciphertext.
- **Pairing talks plain HTTP on the local network.** A paired phone and computer
  exchange sync objects directly over the Wi-Fi they share. The objects are the
  same ciphertext a sync folder holds, and every request and reply carries an
  HMAC under a secret that only ever travelled in the QR code — so someone on
  the same network can see that the two devices are talking, and how much, and
  can neither read nor forge any of it. TLS was left out deliberately: with no
  way to verify a certificate on a home network, it would add ceremony and no
  protection. Anyone who photographs the pairing code while it is on screen can
  talk to that computer's sync store until it is unpaired; they still cannot
  read the vault without the passphrase.
- **An unlocked phone can unlock a computer.** "Unlock with my phone" sends the
  vault's data key from the phone to the computer, so no passphrase need be
  typed there. The key is sealed (X25519, then AES-256-GCM) to a key pair the
  computer generates for that one unlock; the public half is shown in the QR
  code and the private half never leaves the computer's memory, so neither the
  network nor a photograph of the code yields the key. The phone asks for a
  fingerprint before sending, and the code works once and expires after five
  minutes. The consequence to accept: whoever holds your unlocked phone, and can
  pass its fingerprint check, can open your vault on a computer they control.
  That was already true of the phone itself.
- **Losing the passphrase loses the vault — unless a device is still open.**
  There is no reset and no copy held anywhere. A phone that still opens by
  fingerprint can unlock or set up a computer, but if every device is locked and
  the passphrase is gone, so is the data. That is the feature. A computer's
  "start over" moves its vault to a backup folder rather than deleting it.
- **The desktop executables are not code-signed.** Verify what you downloaded
  against the release's `SHA256SUMS.txt` before trusting it.
- **The desktop app checks GitHub for updates.** By default it asks the GitHub
  releases of this repository whether a newer version exists, at start and every
  six hours. GitHub sees the computer's address and that it runs VaultP, and
  nothing from the vault. Unticking *Check for updates automatically* in
  Settings stops every request except a press of *Check now*. An update is
  installed from the same releases the website links to. Whoever controls this
  repository's releases can therefore ship code to installed copies, which is
  true of any auto-updating app and is why releases are built in CI, from a
  tag, after the tests.
- **"Let my phone connect" adds a Windows Firewall rule.** It needs Windows'
  administrator prompt and allows inbound TCP to the VaultP program only, on its
  sync ports only, from the local subnet only, on any network profile. Any
  profile, because Windows marks most home Wi-Fi as Public. On a café's Wi-Fi
  that means others on the same network can reach the sync port. They still
  meet the HMAC check described under pairing, so they can neither read nor
  write anything. Uninstalling VaultP does not remove the rule; delete
  *VaultP (phone sync)* in Windows Defender Firewall to do so.

## What protects the data

| | |
|---|---|
| **Passphrase → key** | PBKDF2-SHA512, 210,000 iterations, per-slot salt |
| **Data key** | Random, never derived from the passphrase, wrapped by it |
| **Derived keys** | HKDF, separately for the database, files and sync |
| **Database** | SQLCipher (AES-256) |
| **Files** | AES-256-GCM under a key derived per file, bound to that file's id |
| **Sync** | AES-256-GCM per segment, bound to the writing device and sequence |
| **Pairing** | HMAC-SHA256 on every request and reply, 256-bit secret exchanged by QR code, replayed requests refused |
| **Unlock by phone** | Data key sealed with X25519 + HKDF-SHA256 + AES-256-GCM to a one-time key from the QR code |

The passphrase is never stored, never logged, and never leaves the device it was
typed on.

## No audit

**This code has not been independently audited.** It is written carefully, the
cryptographic decisions are documented where they are made, and the interop
between platforms is covered by tests — but that is not the same as review by
someone qualified and paid to break it. Weigh that against what you are storing.
