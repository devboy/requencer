"""Extract schematic-review data from a committed *-placed.kicad_pcb file.

Uses KiCad's pcbnew Python bindings — must be run under KICAD_PYTHON
(see hardware/boards/scripts/common/kicad_env.py).

The extractor is the only module in the review pipeline that depends on
pcbnew. Everything downstream (symbols, layout, rendering) consumes
plain JSON-serializable dicts.

Usage:
    KICAD_PYTHON extract.py main /path/to/main-placed.kicad_pcb out.json

Output dict schema (also valid JSON):

    {
      "board": "main",
      "source": "...kicad_pcb",
      "bbox_mm": {"x": ..., "y": ..., "w": ..., "h": ...},
      "subcircuits": {
        "<subcircuit_name>": {
          "name": "dac",
          "components": [
            {
              "ref": "U1" | "REF**",
              "display_name": "dac1",        # last segment of atopile_address
              "value": "10kΩ",
              "footprint": "WQFN-16",
              "atopile_address": "dac.dac1",
              "position_mm": [x, y],
              "rotation_deg": 90,
              "layer": "F.Cu",
              "pads": [
                {"number": "1", "pin_name": "", "net": "c_ref1_hf-power-hv"},
                ...
              ]
            },
            ...
          ]
        },
        ...
      },
      "nets_per_subcircuit": {
        "dac": ["net_a", "net_b", ...]
      },
      "cross_subcircuit_nets": [
        {"net": "SCLK", "subcircuits": ["dac", "mcu", "swd_header"]}
      ]
    }
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any


# --------------------------------------------------------------------------
# pcbnew import
# --------------------------------------------------------------------------

def _import_pcbnew():
    """Import pcbnew with a helpful error if it's not available."""
    try:
        import pcbnew  # type: ignore
        return pcbnew
    except ImportError as e:
        print(
            "ERROR: pcbnew not available. Run this script with KICAD_PYTHON:\n"
            "  /Applications/KiCad/KiCad.app/Contents/Frameworks/"
            "Python.framework/Versions/3.9/bin/python3 extract.py ...",
            file=sys.stderr,
        )
        raise SystemExit(1) from e


# --------------------------------------------------------------------------
# Footprint extraction
# --------------------------------------------------------------------------

# Subcircuit grouping rules.
#
# Atopile promotes single-component things (individual resistors, caps, etc.)
# to their own subcircuit, which produces dozens of tiny useless pages. We
# collapse these by prefix into two logical parent groups:
#
#   discretes  — all singleton passives/actives (r_*, c_*, q_*, l_*, d_*,
#                y_*, f_*, tp_*). Atopile's own naming convention for leaf
#                components.
#   protection — prot_* subcircuits and the "esd" singleton. ALL prot_*
#                subcircuits (prot_clk, prot_cv_a..d, prot_rst) are merged
#                into a single page. The merging is intentional because
#                the prot_* subcircuits share identical topology (clamp
#                diodes + RC filter); rendering six near-identical pages
#                adds no value. If a future project uses prot_* for
#                unrelated subcircuits, this rule will need to change.
#
# Everything else passes through unchanged.
_PREFIX_GROUPS: tuple[tuple[str, str], ...] = (
    ("r_", "discretes"),
    ("c_", "discretes"),
    ("q_", "discretes"),
    ("l_", "discretes"),
    ("d_", "discretes"),
    ("y_", "discretes"),
    ("f_", "discretes"),
    ("tp_", "discretes"),
    ("prot_", "protection"),
)

_EXACT_GROUPS: dict[str, str] = {
    "esd": "protection",
}


def _first_segment(addr: str) -> str:
    """Return the first dotted segment of an atopile address.

    `dac.dac1` → `dac`. `usb` → `usb`. Empty string → `__unsorted__`.

    Singleton subcircuits like `r_cc1` are then collapsed by
    `_group_name()` — this function only handles the dotted split.
    """
    if not addr:
        return "__unsorted__"
    return addr.split(".", 1)[0]


def _group_name(sub_name: str) -> str:
    """Map a raw subcircuit name to its rendering group.

    Collapses singleton prefixes (r_/c_/q_/...) into "discretes",
    prot_* and "esd" into "protection". Everything else passes through.
    """
    if sub_name in _EXACT_GROUPS:
        return _EXACT_GROUPS[sub_name]
    for prefix, group in _PREFIX_GROUPS:
        if sub_name.startswith(prefix):
            return group
    return sub_name


def _is_mechanical_only(comp: dict[str, Any]) -> bool:
    """Filter for purely mechanical footprints (standoffs, mounting holes).

    These have zero nets on zero pads and shouldn't appear in a schematic.
    """
    pads = comp.get("pads") or []
    if not pads:
        return True
    if all(not p.get("net") for p in pads):
        return True
    fp_name = (comp.get("footprint") or "").lower()
    mechanical_hints = ("standoff", "mountinghole", "m3_", "m2_")
    return any(h in fp_name for h in mechanical_hints)


def _last_segment(addr: str) -> str:
    """Return the final dotted segment (or the whole string if no dot)."""
    if not addr:
        return ""
    return addr.rsplit(".", 1)[-1]


def _extract_component(fp, pcbnew_mod) -> dict[str, Any]:
    """Pull a single footprint's schematic-relevant data into a dict."""
    pos = fp.GetPosition()
    x_mm = pcbnew_mod.ToMM(pos.x)
    y_mm = pcbnew_mod.ToMM(pos.y)

    layer = "F.Cu" if fp.GetLayer() == pcbnew_mod.F_Cu else "B.Cu"

    addr = ""
    if fp.HasField("atopile_address"):
        addr = str(fp.GetFieldText("atopile_address"))

    ref = str(fp.GetReference())
    value = str(fp.GetValue())
    fpid = str(fp.GetFPID().GetLibItemName())

    pads = []
    for p in fp.Pads():
        num = str(p.GetNumber())
        if not num:
            # Non-electrical pads (mounting holes, fiducials on a connector,
            # or damaged footprint data) have no pad number. Skip them —
            # they have no net and can't be displayed on a schematic.
            continue
        pads.append({
            "number": num,
            "pin_name": str(p.GetPinFunction() or ""),
            "net": str(p.GetNetname() or ""),
        })
    # Keep pads in natural number order (sorted alphanumerically for IC legibility)
    pads.sort(key=lambda p: _pad_sort_key(p["number"]))

    return {
        "ref": ref,
        "display_name": _last_segment(addr) or ref.lower(),
        "value": value,
        "footprint": fpid,
        "atopile_address": addr,
        "position_mm": [round(x_mm, 3), round(y_mm, 3)],
        "rotation_deg": round(fp.GetOrientationDegrees(), 2),
        "layer": layer,
        "pads": pads,
    }


def _pad_sort_key(num: str):
    """Sort pads numerically when possible, alphabetically otherwise."""
    try:
        return (0, int(num))
    except ValueError:
        return (1, num)


def _enrich_from_pinout_json(
    subcircuits: dict[str, dict],
    board_build_dir: Path,
) -> None:
    """Augment component pin_name fields from atopile's pinout JSON if present.

    atopile's `pinout` build target writes one JSON file per subcircuit at
    `build/builds/<board>/pinout/NNN_<name>.json`. Each entry has a `leads[]`
    array with `leadDesignator` (e.g. "VREF", "OUT1") and `padNumbers`.
    We match by the component's `atoAddress`/`atopile_address` and copy the
    leadDesignator into the matching pad's `pin_name` field.

    This is a no-op if the pinout dir doesn't exist (i.e. `ato build` hasn't
    been run in this tree).
    """
    pinout_dir = board_build_dir / "pinout"
    if not pinout_dir.exists():
        return

    # Build a lookup: atopile_address → component dict
    addr_to_comp: dict[str, dict] = {}
    for sub in subcircuits.values():
        for c in sub["components"]:
            if c["atopile_address"]:
                addr_to_comp[c["atopile_address"]] = c

    for json_file in sorted(pinout_dir.glob("*.json")):
        try:
            with open(json_file) as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as e:
            print(
                f"WARN: could not read pinout file {json_file.name}: {e}",
                file=sys.stderr,
            )
            continue

        addr = data.get("atoAddress")
        if not addr or addr not in addr_to_comp:
            continue

        comp = addr_to_comp[addr]
        pad_to_name = {}
        for lead in data.get("leads", []):
            designator = lead.get("leadDesignator", "")
            for pad_num in lead.get("padNumbers", []):
                pad_to_name[str(pad_num)] = designator

        for pad in comp["pads"]:
            if pad["number"] in pad_to_name and not pad["pin_name"]:
                pad["pin_name"] = pad_to_name[pad["number"]]


# --------------------------------------------------------------------------
# Board-level extraction
# --------------------------------------------------------------------------

def extract_board(board_name: str, pcb_path: str | os.PathLike) -> dict[str, Any]:
    """Extract all review-relevant data from a single .kicad_pcb file.

    Returns a JSON-serializable dict (see module docstring for schema).
    """
    pcbnew = _import_pcbnew()
    pcb_path = Path(pcb_path)
    board = pcbnew.LoadBoard(str(pcb_path))

    # Subcircuit grouping in two stages:
    #   1. Raw atopile subcircuit (first dotted segment of atopile_address)
    #   2. Rendering group (collapse singletons into "discretes"/"protection")
    #
    # We also drop mechanical-only footprints (standoffs, mounting holes).
    # Individual footprint extraction is wrapped in a try/except so that a
    # single malformed footprint doesn't abort the whole board extraction.
    subcircuits: dict[str, dict] = {}
    for fp in board.GetFootprints():
        try:
            comp = _extract_component(fp, pcbnew)
        except Exception as e:
            ref_guess = ""
            try:
                ref_guess = str(fp.GetReference())
            except Exception:
                pass
            print(
                f"WARN: failed to extract footprint {ref_guess!r}: {e}",
                file=sys.stderr,
            )
            continue
        if _is_mechanical_only(comp):
            continue
        raw_sub = _first_segment(comp["atopile_address"])
        sub_name = _group_name(raw_sub)
        sub = subcircuits.setdefault(
            sub_name,
            {"name": sub_name, "components": []},
        )
        sub["components"].append(comp)

    # Sort components inside each subcircuit for deterministic output
    for sub in subcircuits.values():
        sub["components"].sort(key=lambda c: (c["atopile_address"] or "", c["ref"]))

    # Try to enrich pin names from atopile pinout JSON if present.
    # The build directory sits one level up from the pcb file under build/builds/{board}/
    # pcb: hardware/boards/build/main-placed.kicad_pcb
    # pinout: hardware/boards/build/builds/main/pinout/*.json
    build_base = pcb_path.parent / "builds" / board_name
    _enrich_from_pinout_json(subcircuits, build_base)

    # Compute nets_per_subcircuit and cross_subcircuit_nets
    nets_per_sub: dict[str, set[str]] = {}
    for sub_name, sub in subcircuits.items():
        nets = set()
        for c in sub["components"]:
            for p in c["pads"]:
                if p["net"]:
                    nets.add(p["net"])
        nets_per_sub[sub_name] = nets

    # A net is "cross-subcircuit" if it appears in ≥2 subcircuits
    net_to_subs: dict[str, set[str]] = {}
    for sub_name, nets in nets_per_sub.items():
        for net in nets:
            net_to_subs.setdefault(net, set()).add(sub_name)

    cross_subcircuit_nets = [
        {"net": net, "subcircuits": sorted(subs)}
        for net, subs in sorted(net_to_subs.items())
        if len(subs) >= 2
    ]

    # Board bbox
    bbox = board.GetBoardEdgesBoundingBox()
    bbox_mm = {
        "x": round(pcbnew.ToMM(bbox.GetX()), 2),
        "y": round(pcbnew.ToMM(bbox.GetY()), 2),
        "w": round(pcbnew.ToMM(bbox.GetWidth()), 2),
        "h": round(pcbnew.ToMM(bbox.GetHeight()), 2),
    }

    return {
        "board": board_name,
        "source": str(pcb_path),
        "bbox_mm": bbox_mm,
        "subcircuits": {
            name: {"name": name, "components": sub["components"]}
            for name, sub in sorted(subcircuits.items())
        },
        "nets_per_subcircuit": {
            name: sorted(nets) for name, nets in sorted(nets_per_sub.items())
        },
        "cross_subcircuit_nets": cross_subcircuit_nets,
    }


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main() -> int:
    if len(sys.argv) < 3:
        print(
            "Usage: extract.py <board_name> <pcb_path> [out_json]",
            file=sys.stderr,
        )
        return 2
    board_name = sys.argv[1]
    pcb_path = sys.argv[2]
    out_path = sys.argv[3] if len(sys.argv) > 3 else None

    data = extract_board(board_name, pcb_path)

    if out_path:
        with open(out_path, "w") as f:
            json.dump(data, f, indent=2)
            f.write("\n")
        print(f"Wrote {out_path}", file=sys.stderr)
    else:
        json.dump(data, sys.stdout, indent=2)
        print()

    # Short stderr summary
    sub_count = len(data["subcircuits"])
    comp_count = sum(
        len(s["components"]) for s in data["subcircuits"].values()
    )
    cross_count = len(data["cross_subcircuit_nets"])
    print(
        f"  {board_name}: {sub_count} subcircuits, "
        f"{comp_count} components, {cross_count} cross-block nets",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
