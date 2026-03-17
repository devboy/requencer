"""Parse .ato part files and count instantiations to build a full BOM.

Extracts part metadata (LCSC, MPN, manufacturer) from trait declarations
in hardware/boards/parts/*/*.ato, then counts `= new ComponentName`
instantiations across hardware/boards/elec/src/*.ato to determine quantities.
"""

import re
from dataclasses import dataclass
from pathlib import Path

# Regex for trait extraction from .ato part files
_PART_PICKED_RE = re.compile(
    r'has_part_picked::by_supplier<'
    r'[^>]*supplier_partno="([^"]+)"'
    r'[^>]*manufacturer="([^"]+)"'
    r'[^>]*partno="([^"]+)"'
)
_ATOMIC_PART_RE = re.compile(
    r'is_atomic_part<[^>]*footprint="([^"]+)"'
)
_ATOMIC_MFR_RE = re.compile(
    r'is_atomic_part<[^>]*manufacturer="([^"]+)"[^>]*partnumber="([^"]+)"'
)
_COMPONENT_NAME_RE = re.compile(r'^component\s+(\w+)\s*:', re.MULTILINE)

# Import pattern: from "../../parts/X/X.ato" import Y
_IMPORT_RE = re.compile(
    r'from\s+"[^"]*parts/[^"]+"\s+import\s+(\w+)'
)
# Instantiation: name = new ComponentName
_NEW_RE = re.compile(r'=\s*new\s+(\w+)')

# Parts that are through-hole / manual-order (not JLCPCB SMD assembly)
THT_PARTS = {
    "PGA2350", "WQP518MA", "PJ366ST", "PJ301M12", "PJS008U", "EC11E",
    "PB6149L", "_2N3904",
    "EurorackPowerHeader", "ShroudedHeader2x16", "ShroudedSocket2x16",
    "PinHeader1x9", "TactileSwitch",
}

# Parts with placeholder or missing LCSC (must order separately regardless)
MANUAL_SOURCE_PARTS = {
    "PGA2350": "Pimoroni PIM722 — order from pimoroni.com",
}

# Special parts not in .ato (hardcoded into report)
EXTRA_MANUAL_PARTS = [
    {
        "name": "ST7796-32pin-panel",
        "mpn": "ST7796-32pin-panel",
        "manufacturer": "maithoga (AliExpress)",
        "lcsc": "",
        "footprint": "bare-panel",
        "quantity": 1,
        "note": "3.5\" ST7796 bare TFT display (32-pin FPC, no touch). AliExpress item 32286288684.",
    },
]


@dataclass
class Part:
    name: str
    lcsc: str
    mpn: str
    manufacturer: str
    footprint: str
    quantity: int
    category: str  # "smd" | "tht" | "manual"
    note: str = ""


def parse_part_file(path: Path) -> dict | None:
    """Extract part metadata from a single .ato file in parts/.

    Prefers has_part_picked::by_supplier for LCSC/manufacturer/MPN.
    Falls back to is_atomic_part for parts without a supplier trait
    (e.g. AliExpress-only THT parts like PB6149L).
    """
    text = path.read_text()

    atomic = _ATOMIC_PART_RE.search(text)
    comp = _COMPONENT_NAME_RE.search(text)

    picked = _PART_PICKED_RE.search(text)
    if picked:
        return {
            "name": comp.group(1) if comp else path.parent.name,
            "lcsc": picked.group(1),
            "manufacturer": picked.group(2),
            "mpn": picked.group(3),
            "footprint": atomic.group(1) if atomic else "",
        }

    # Fallback: extract from is_atomic_part (no LCSC)
    atomic_mfr = _ATOMIC_MFR_RE.search(text)
    if atomic_mfr:
        return {
            "name": comp.group(1) if comp else path.parent.name,
            "lcsc": "",
            "manufacturer": atomic_mfr.group(1),
            "mpn": atomic_mfr.group(2),
            "footprint": atomic.group(1) if atomic else "",
        }

    return None


def parse_all_parts(parts_dir: Path) -> dict[str, dict]:
    """Parse all .ato files under parts/*/. Returns dict keyed by component name."""
    parts = {}
    for ato_file in sorted(parts_dir.glob("*/*.ato")):
        info = parse_part_file(ato_file)
        if info:
            parts[info["name"]] = info
    return parts


def count_instantiations(src_dir: Path) -> dict[str, int]:
    """Count `= new ComponentName` occurrences across all .ato source files.

    Returns dict mapping component name (as used in `new` statements) to count.
    Scans all .ato files recursively under src_dir.
    """
    counts: dict[str, int] = {}
    for ato_file in sorted(src_dir.glob("*.ato")):
        text = ato_file.read_text()
        for match in _NEW_RE.finditer(text):
            comp_name = match.group(1)
            # Skip generic Atopile stdlib types
            if comp_name in ("Resistor", "Capacitor"):
                continue
            counts[comp_name] = counts.get(comp_name, 0) + 1
    return counts


def _resolve_import_name(parts: dict[str, dict]) -> dict[str, str]:
    """Build mapping from import alias to canonical part name.

    In .ato files, parts starting with digits get underscore-prefixed imports:
    `from "../../parts/74HC165D/74HC165D.ato" import _74HC165D`
    but the part definition is `component _74HC165D`.
    """
    # The part name in the file IS the import name, so this is identity.
    # But we also need to handle cases where the component name in the .ato
    # differs from the directory name (e.g., OPA4172ID vs OPA4172IPWR).
    return {name: name for name in parts}


def classify_part(name: str, lcsc: str) -> str:
    """Classify a part as smd, tht, or manual."""
    if name in MANUAL_SOURCE_PARTS or lcsc in ("", "C0000", "TBD"):
        return "manual"
    if name in THT_PARTS:
        return "tht"
    return "smd"


def build_bom(parts_dir: Path, src_dir: Path, board_count: int = 1) -> list[Part]:
    """Build full BOM from .ato source files.

    Returns list of Part objects with quantities multiplied by board_count.
    """
    parts = parse_all_parts(parts_dir)
    counts = count_instantiations(src_dir)

    bom: list[Part] = []
    for name, info in sorted(parts.items()):
        qty = counts.get(name, 0)
        if qty == 0:
            continue  # Part defined but not instantiated

        category = classify_part(name, info["lcsc"])
        note = MANUAL_SOURCE_PARTS.get(name, "")

        bom.append(Part(
            name=name,
            lcsc=info["lcsc"],
            mpn=info["mpn"],
            manufacturer=info["manufacturer"],
            footprint=info["footprint"],
            quantity=qty * board_count,
            category=category,
            note=note,
        ))

    # Add hardcoded extra parts
    for extra in EXTRA_MANUAL_PARTS:
        bom.append(Part(
            name=extra["name"],
            lcsc=extra["lcsc"],
            mpn=extra["mpn"],
            manufacturer=extra["manufacturer"],
            footprint=extra["footprint"],
            quantity=extra["quantity"] * board_count,
            category="manual",
            note=extra.get("note", ""),
        ))

    return bom
