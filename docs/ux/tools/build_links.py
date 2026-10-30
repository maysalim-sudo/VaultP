import json
from pathlib import Path

batches = [
    (624, ["notes-list", "note-editor", "checklist-detail"]),
    (908, ["expenses-list", "edit-expense", "month-insights"]),
    (1184, ["accounts-list", "account-balance", "add-payment-method"]),
    (1412, ["recurring-list", "documents-list", "document-viewer"]),
    (1690, ["more-hub", "settings", "sync-backup"]),
    (1986, ["lock-screen", "first-run", "debt-repayment"]),
    (2136, ["new-debt", "new-recurring", "scan-document", "folders-labels", "archive", "scan-pairing"]),
]

starts = {}
for start, names in batches:
    cursor = start
    for name in names:
        starts[name] = cursor
        cursor += len(json.loads(Path(f"docs/ux/{name}.json").read_text()))

links = [
    # Notes
    ("notes-list", "New note button", 620),
    ("notes-list", "Groceries note title", 622),
    ("notes-list", "Trip note title", 620),
    ("notes-list", "Notes search field", 476),
    ("notes-list", "Notes nav home icon", 2),
    ("notes-list", "Notes nav expenses icon", 902),
    ("notes-list", "Notes nav more icon", 1684),
    ("notes-list", "Notes create action", 474),
    # Expenses
    ("expenses-list", "Expenses new button", 114),
    ("expenses-list", "Carrefour expense row", 904),
    ("expenses-list", "Expenses nav home icon", 2),
    ("expenses-list", "Expenses nav notes icon", 618),
    ("expenses-list", "Expenses nav more icon", 1684),
    ("expenses-list", "Expenses create action", 474),
    # Accounts
    ("accounts-list", "Accounts add button", 1182),
    ("accounts-list", "BIAT account card", 1180),
    ("accounts-list", "Accounts nav home icon", 2),
    ("accounts-list", "Accounts nav notes icon", 618),
    ("accounts-list", "Accounts create action", 474),
    ("accounts-list", "Accounts nav expenses icon", 902),
    # Recurring
    ("recurring-list", "Recurring add button", 2126),
    ("recurring-list", "Recurring nav home icon", 2),
    ("recurring-list", "Recurring nav notes icon", 618),
    ("recurring-list", "Recurring create action", 474),
    ("recurring-list", "Recurring nav expenses icon", 902),
    # Documents
    ("documents-list", "Documents scan button", 2128),
    ("documents-list", "Passport document card", 1410),
    ("documents-list", "Documents nav home icon", 2),
    ("documents-list", "Documents nav notes icon", 618),
    ("documents-list", "Documents create action", 474),
    ("documents-list", "Documents nav expenses icon", 902),
    # More hub
    ("more-hub", "More accounts row", 1178),
    ("more-hub", "More recurring row", 1406),
    ("more-hub", "More debts row", 294),
    ("more-hub", "More methods row", 194),
    ("more-hub", "More documents row", 1408),
    ("more-hub", "More archive row", 2132),
    ("more-hub", "More sync tile", 1688),
    ("more-hub", "More settings tile", 1686),
    ("more-hub", "More nav home icon", 2),
    ("more-hub", "More nav notes icon", 618),
    ("more-hub", "More create action", 474),
    ("more-hub", "More nav expenses icon", 902),
    # Settings and sync
    ("settings", "Settings back button", 1684),
    ("settings", "Settings default method value", 194),
    ("sync-backup", "Sync back button", 1684),
    ("sync-backup", "Sync now action", 1688),
    # Security and setup
    ("lock-screen", "Lock unlock button", 2),
    ("lock-screen", "Lock fingerprint button", 2),
    ("first-run", "First run create button", 2),
    ("first-run", "First run join link", 2134),
    # Debt repayment
    ("debt-repayment", "Repayment back button", 296),
    ("debt-repayment", "Repayment save button", 296),
    # Creation forms
    ("new-debt", "New debt back button", 294),
    ("new-debt", "New debt save button", 294),
    ("new-recurring", "New recurring back button", 1406),
    ("new-recurring", "New recurring save button", 1406),
    ("scan-document", "Scan back button", 1408),
    ("scan-document", "Scan manual link", 1408),
    ("folders-labels", "Folders back button", 618),
    ("folders-labels", "Archived notes row", 2132),
    ("archive", "Archive back button", 618),
    ("scan-pairing", "Pairing back button", 1688),
    ("scan-pairing", "Pairing enter code", 1688),
]

commands = []
for name, node_name, dest in links:
    commands.append(
        {
            "command": "proto.interaction.add",
            "params": {
                "id": starts[name]
                + next(
                    index
                    for index, node in enumerate(
                        json.loads(Path(f"docs/ux/{name}.json").read_text())
                    )
                    if node.get("params", {}).get("name") == node_name
                ),
                "trigger": {"type": "onClick"},
                "action": {"type": "navigate", "dest": dest},
            },
        }
    )

# Existing screens whose ids were already known from the initial build.
commands.extend(
    [
        {
            "command": "proto.interaction.add",
            "params": {
                "id": 333,
                "trigger": {"type": "onClick"},
                "action": {"type": "navigate", "dest": 2124},
            },
        },
        {
            "command": "proto.interaction.add",
            "params": {
                "id": 422,
                "trigger": {"type": "onClick"},
                "action": {"type": "navigate", "dest": 1984},
            },
        },
    ]
)

Path("docs/ux/complete-navigation.json").write_text(
    json.dumps(commands, ensure_ascii=False, indent=2) + "\n"
)
print(f"{len(commands)} links")
