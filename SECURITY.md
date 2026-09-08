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
- **Losing the passphrase loses the vault.** There is no recovery path, no reset,
  and no copy held anywhere. That is the feature.
- **The desktop executables are not code-signed.** Verify what you downloaded
  before trusting it.

## What protects the data

| | |
|---|---|
| **Passphrase → key** | PBKDF2-SHA512, 210,000 iterations, per-slot salt |
| **Data key** | Random, never derived from the passphrase, wrapped by it |
| **Derived keys** | HKDF, separately for the database, files and sync |
| **Database** | SQLCipher (AES-256) |
| **Files** | AES-256-GCM under a key derived per file, bound to that file's id |
| **Sync** | AES-256-GCM per segment, bound to the writing device and sequence |

The passphrase is never stored, never logged, and never leaves the device it was
typed on.

## No audit

**This code has not been independently audited.** It is written carefully, the
cryptographic decisions are documented where they are made, and the interop
between platforms is covered by tests — but that is not the same as review by
someone qualified and paid to break it. Weigh that against what you are storing.
