"""Integration tests for extract.py against committed *-placed.kicad_pcb files.

These tests require KiCad's pcbnew Python bindings — run with:
    KICAD_PYTHON -m pytest review/tests/test_extract.py -v

from hardware/boards/scripts/.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from review import extract


REPO_ROOT = Path(__file__).resolve().parents[5]
MAIN_PCB = REPO_ROOT / "hardware/boards/build/main-placed.kicad_pcb"
CONTROL_PCB = REPO_ROOT / "hardware/boards/build/control-placed.kicad_pcb"


# -------- pure unit tests (no pcbnew required) ----------------------------


def test_first_segment_splits_dotted_address():
    assert extract._first_segment("dac.dac1") == "dac"
    assert extract._first_segment("power.reg_3v3") == "power"


def test_first_segment_handles_undotted_and_empty():
    assert extract._first_segment("usb") == "usb"
    assert extract._first_segment("") == "__unsorted__"


def test_last_segment_returns_final_part():
    assert extract._last_segment("dac.dac1") == "dac1"
    assert extract._last_segment("power.reg_3v3") == "reg_3v3"
    assert extract._last_segment("usb") == "usb"
    assert extract._last_segment("") == ""


def test_group_name_collapses_discretes():
    for prefix in ("r_", "c_", "q_", "l_", "d_", "y_", "f_", "tp_"):
        assert extract._group_name(prefix + "foo") == "discretes"


def test_group_name_collapses_protection():
    assert extract._group_name("prot_clk") == "protection"
    assert extract._group_name("prot_cv_a") == "protection"
    assert extract._group_name("esd") == "protection"


def test_group_name_keeps_real_subcircuits():
    for name in ("dac", "power", "mcu", "buttons", "jacks", "usb", "midi"):
        assert extract._group_name(name) == name


def test_is_mechanical_only_drops_standoff():
    standoff = {
        "ref": "SO_SO_BL",
        "value": "M3_Standoff",
        "footprint": "M3_Standoff",
        "pads": [],
    }
    assert extract._is_mechanical_only(standoff)


def test_is_mechanical_only_drops_pads_without_nets():
    fake = {
        "ref": "MH1",
        "value": "",
        "footprint": "MountingHole_3.2",
        "pads": [{"number": "1", "pin_name": "", "net": ""}],
    }
    assert extract._is_mechanical_only(fake)


def test_is_mechanical_only_keeps_real_component():
    real = {
        "ref": "R22",
        "value": "10kΩ",
        "footprint": "R0603",
        "pads": [
            {"number": "1", "pin_name": "", "net": "dac-IN2_N"},
            {"number": "2", "pin_name": "", "net": "VREF"},
        ],
    }
    assert not extract._is_mechanical_only(real)


def test_pad_sort_key_numeric_before_alpha():
    assert extract._pad_sort_key("5") < extract._pad_sort_key("10")
    assert extract._pad_sort_key("10") < extract._pad_sort_key("A1")


# -------- integration tests (require pcbnew + committed PCB) --------------


@pytest.fixture(scope="module")
def main_data():
    if not MAIN_PCB.exists():
        pytest.skip(f"{MAIN_PCB} not found — nothing to extract")
    return extract.extract_board("main", MAIN_PCB)


@pytest.fixture(scope="module")
def control_data():
    if not CONTROL_PCB.exists():
        pytest.skip(f"{CONTROL_PCB} not found — nothing to extract")
    return extract.extract_board("control", CONTROL_PCB)


def test_main_has_expected_subcircuits(main_data):
    # After grouping, we expect these top-level subcircuits
    expected = {"dac", "power", "mcu", "protection", "discretes"}
    assert expected <= set(main_data["subcircuits"].keys())


def test_main_dac_has_many_components(main_data):
    assert len(main_data["subcircuits"]["dac"]["components"]) >= 70


def test_main_every_component_has_ref_and_pads(main_data):
    for sub in main_data["subcircuits"].values():
        for c in sub["components"]:
            assert c["ref"], f"Component missing ref: {c}"
            assert c["atopile_address"], f"Component missing addr: {c['ref']}"
            assert c["pads"], f"Component has no pads: {c['ref']}"


def test_main_cross_subcircuit_nets_include_spi(main_data):
    cross_nets = {n["net"] for n in main_data["cross_subcircuit_nets"]}
    # SPI nets from dac to mcu
    assert any(n in cross_nets for n in ("SCLK", "DIN", "SDO"))


def test_main_no_unsorted_bucket(main_data):
    # After grouping and mechanical filtering there should be no leftover junk
    assert "__unsorted__" not in main_data["subcircuits"]


def test_main_no_empty_subcircuits(main_data):
    for name, sub in main_data["subcircuits"].items():
        assert sub["components"], f"Empty subcircuit: {name}"


def test_main_bbox_is_populated(main_data):
    bbox = main_data["bbox_mm"]
    assert bbox["w"] > 0
    assert bbox["h"] > 0


def test_control_has_expected_subcircuits(control_data):
    expected = {"buttons", "jacks", "leds", "midi", "discretes"}
    assert expected <= set(control_data["subcircuits"].keys())


def test_control_buttons_subcircuit_is_largest(control_data):
    sizes = {
        name: len(sub["components"])
        for name, sub in control_data["subcircuits"].items()
    }
    assert sizes["buttons"] == max(sizes.values())
