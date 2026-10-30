import json
from pathlib import Path

text_patch = {
    "#2F6B4F": "#8EC5A1",
    "#68768A": "#A7B4C5",
    "#78869A": "#A7B4C5",
    "#8491A3": "#A7B4C5",
    "#8A7B55": "#D9BB7F",
    "#805D24": "#F0D19A",
    "#42648D": "#A7BCD8",
}
shape_patch = {
    "#2F6B4F": "#6FAF8A",
    "#E9EEF5": "#2A394C",
}

batches = [
    (
        624,
        763,
        ["notes-list", "note-editor", "checklist-detail"],
    ),
    (
        908,
        1043,
        ["expenses-list", "edit-expense", "month-insights"],
    ),
    (
        1184,
        1295,
        ["accounts-list", "account-balance", "add-payment-method"],
    ),
    (
        1412,
        1548,
        ["recurring-list", "documents-list", "document-viewer"],
    ),
    (
        1690,
        1835,
        ["more-hub", "settings", "sync-backup"],
    ),
    (
        1986,
        2055,
        ["lock-screen", "first-run", "debt-repayment"],
    ),
    (
        2136,
        2328,
        ["new-debt", "new-recurring", "scan-document", "folders-labels", "archive", "scan-pairing"],
    ),
]

commands = []
for light_start, dark_start, names in batches:
    light = light_start
    dark = dark_start
    for name in names:
        source = json.loads(Path(f"docs/ux/{name}.json").read_text())
        for index, command in enumerate(source):
            params = command.get("params", {})
            props = params.get("props", {})
            colour = props.get("fill")
            if not colour:
                continue
            if params.get("type") == "text" and colour in text_patch:
                commands.append(
                    {
                        "command": "node.set",
                        "params": {"id": dark + index, "fill": text_patch[colour]},
                    }
                )
            elif params.get("type") != "text" and colour in shape_patch:
                commands.append(
                    {
                        "command": "node.set",
                        "params": {"id": dark + index, "fill": shape_patch[colour]},
                    }
                )
        light += len(source)
        dark += len(source)

Path("docs/ux/fix-dark-colors.json").write_text(
    json.dumps(commands, ensure_ascii=False, indent=2) + "\n"
)
print(f"{len(commands)} patches")
