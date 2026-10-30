import json
from pathlib import Path

commands = json.loads(Path("docs/ux/payment-methods.json").read_text())
text_colors = {
    "#FFFFFF": "#F8FAFC",
    "#172337": "#EEF3FA",
    "#273246": "#DCE5F1",
    "#6C788A": "#A7B4C5",
    "#748197": "#A7B4C5",
    "#246BCE": "#6DA5FF",
}
shape_fills = {"#FFFFFF": "#1B2736", "#EEF4FF": "#203450"}
strokes = {"#E5EAF1": "#2A394C", "#A9C9F4": "#456A9A", "#B8C2D0": "#64748B"}

for command in commands:
    params = command["params"]
    params["parent"] = 195
    props = params.get("props", {})
    if "fill" in props:
        palette = text_colors if params["type"] == "text" else shape_fills
        props["fill"] = palette.get(props["fill"], props["fill"])
    if "strokes" in props:
        props["strokes"] = [strokes.get(color, color) for color in props["strokes"]]
    if "stroke" in props:
        props["stroke"] = strokes.get(props["stroke"], props["stroke"])

Path("docs/ux/payment-methods-dark.json").write_text(
    json.dumps(commands, ensure_ascii=False, indent=2) + "\n"
)
