import json
import sys
from pathlib import Path

if len(sys.argv) != 4:
    raise SystemExit("usage: make-dark-screen.py SOURCE TARGET FRAME_ID")

source, target, frame_id = Path(sys.argv[1]), Path(sys.argv[2]), int(sys.argv[3])
commands = json.loads(source.read_text())
text_colors = {
    "#FFFFFF": "#F8FAFC",
    "#172337": "#EEF3FA",
    "#273246": "#DCE5F1",
    "#6C788A": "#A7B4C5",
    "#748197": "#A7B4C5",
    "#246BCE": "#6DA5FF",
    "#315F9E": "#C3DCFF",
    "#53749F": "#A7BCD8",
    "#8A6B35": "#D9BB7F",
    "#42735A": "#8EC5A1",
    "#9C5D37": "#E0A37E",
    "#A64E48": "#EEAAA2",
    "#B44F50": "#F1A2A2",
    "#4A5568": "#C5D0DE",
    "#5B6472": "#A7B4C5",
    "#8793A3": "#94A3B8",
    "#B4466B": "#E89AB4",
    "#6B5CA6": "#B2A4E0",
    "#A57425": "#E0B466",
    "#2F6B4F": "#8EC5A1",
    "#8B5E3C": "#D8A77E",
    "#2D5F9A": "#9CC4FF",
    "#1F6B57": "#8EC5A1",
    "#7A3E65": "#D9A3C8",
    "#A13D3D": "#F0A0A0",
    "#1F4D3A": "#BFE3CC",
    "#4A6F5D": "#A9C9B7",
    "#805D24": "#F0D19A",
    "#42648D": "#A7BCD8",
    "#5E4515": "#F0D19A",
}
shape_fills = {
    "#FFFFFF": "#1B2736",
    "#EEF4FF": "#203450",
    "#FFF7E8": "#352B1D",
    "#FFF7F5": "#382322",
    "#DCEAFF": "#22364F",
    "#F8E8DC": "#3C2D26",
    "#E6EDF5": "#273548",
    "#EAF5EE": "#21382C",
    "#FFFDF7": "#2B2A25",
    "#F8FAFC": "#18222F",
    "#F1F5F9": "#1F2B3A",
    "#FDF2F6": "#38222C",
    "#F1EDFA": "#2B2540",
    "#FFF4E5": "#3A2E1E",
    "#E8F1FB": "#21344D",
    "#E6F4EA": "#21382C",
    "#F6F7F9": "#1B2736",
    "#E2E8F0": "#314154",
    "#CBD5E1": "#4A5B71",
    "#FDE8E8": "#3A2225",
    "#2F6B4F": "#6FAF8A",
    "#CFE3D6": "#315C48",
    "#C9DBF0": "#324154",
    "#D5E3F4": "#31445D",
}
strokes = {
    "#E5EAF1": "#2A394C",
    "#A9C9F4": "#456A9A",
    "#D9E6F7": "#31445D",
    "#F0E4CF": "#51432B",
    "#D8E0EA": "#324154",
    "#F0D9D5": "#63403D",
    "#EEE9D9": "#4D4636",
    "#DCE4EE": "#324154",
    "#E2E8F0": "#314154",
    "#CBD5E1": "#4A5B71",
    "#F3D9E2": "#5C3A49",
    "#E4DDF4": "#40385C",
    "#F1E1CB": "#4D3D28",
}

for command in commands:
    params = command["params"]
    params["parent"] = frame_id
    props = params.get("props", {})
    if "fill" in props:
        palette = text_colors if params["type"] == "text" else shape_fills
        props["fill"] = palette.get(props["fill"], props["fill"])
    if "strokes" in props:
        props["strokes"] = [strokes.get(color, color) for color in props["strokes"]]
    if "stroke" in props:
        props["stroke"] = strokes.get(props["stroke"], props["stroke"])

target.write_text(json.dumps(commands, ensure_ascii=False, indent=2) + "\n")
