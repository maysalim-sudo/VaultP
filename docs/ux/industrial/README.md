# VaultP: industrial UI (approved 2026-10-30)

The design the phone and desktop apps are rebuilt to (plan Phases 3–4). One responsive component,
`Main.dc.html`: phone below 900 px wide, desktop above, dark and light from the same tokens.
The other `*.dc.html` files only mount it at a size, theme and starting screen.

Live canvas: https://claude.ai/artifact/UD61nAqGo8BGBadVagnShh (private to the owner).

- Type: Doto (dot-matrix figures), JetBrains Mono (labels), Inter Tight (text). All SIL OFL.
- Ground: #000 / warm paper #E9E7E1. Tiles #111 / #F7F6F2, 22 px corners, pill controls.
- One accent, safety orange #FF5A1F (text on light: #B33A08): the + button, the next bill, you owe, over budget, today.
- Green = money coming back, blue-grey with ≈ = estimate. Everything else neutral.
- Signatures: the month as one bar per day, segmented budget and loan meters, the allowance dial,
  and the expense keypad that fills the millimes from the right.
- Navigation: Home, Money (Spent / People / Repeats / Accounts), Notes, Docs, and + in the middle.
  Search and vault settings from the header.
