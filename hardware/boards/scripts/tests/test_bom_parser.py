"""Tests for procurement/bom_parser.py — .ato file parsing and BOM generation."""

import textwrap
from pathlib import Path

import pytest

from procurement.bom_parser import (
    Part,
    build_bom,
    classify_part,
    count_instantiations,
    parse_part_file,
)


# --- Fixtures: realistic .ato content ---

SAMPLE_PART_ATO = textwrap.dedent("""\
    # DAC8568SPMR — TI 16-bit 8-channel DAC, TSSOP-16
    #pragma experiment("TRAITS")
    import is_atomic_part
    import has_designator_prefix
    import has_part_picked

    component DAC8568SPMR:
        trait is_atomic_part<manufacturer="TI", partnumber="DAC8568SPMR", footprint="TSSOP-16.kicad_mod", symbol="DAC8568SPMR.kicad_sym">
        trait has_designator_prefix<prefix="U">
        trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C524819", manufacturer="TI", partno="DAC8568SPMR">

        signal VOUTA ~ pin 1
        signal GND ~ pin 9
""")

SAMPLE_THT_ATO = textwrap.dedent("""\
    # PJ398SM — Thonkiconn 3.5mm Mono Jack, Through-Hole
    #pragma experiment("TRAITS")
    import is_atomic_part
    import has_designator_prefix
    import has_part_picked

    component PJ398SM:
        trait is_atomic_part<manufacturer="Thonkiconn", partnumber="PJ398SM", footprint="PJ398SM.kicad_mod", symbol="PJ398SM.kicad_sym">
        trait has_designator_prefix<prefix="J">
        trait has_part_picked::by_supplier<supplier_id="lcsc", supplier_partno="C2907129", manufacturer="Thonkiconn", partno="PJ398SM">

        signal TIP ~ pin 1
        signal SLEEVE ~ pin 2
""")

SAMPLE_SRC_ATO = textwrap.dedent("""\
    from "../../parts/DAC8568SPMR/DAC8568SPMR.ato" import DAC8568SPMR
    from "../../parts/PJ398SM/PJ398SM.ato" import PJ398SM
    import Resistor
    import Capacitor

    module TestModule:
        dac1 = new DAC8568SPMR
        dac2 = new DAC8568SPMR
        j1 = new PJ398SM
        j2 = new PJ398SM
        j3 = new PJ398SM
        r1 = new Resistor
        c1 = new Capacitor
""")


class TestParsePartFile:
    def test_extracts_smd_part(self, tmp_path):
        ato = tmp_path / "DAC8568SPMR" / "DAC8568SPMR.ato"
        ato.parent.mkdir()
        ato.write_text(SAMPLE_PART_ATO)

        result = parse_part_file(ato)

        assert result is not None
        assert result["name"] == "DAC8568SPMR"
        assert result["lcsc"] == "C524819"
        assert result["mpn"] == "DAC8568SPMR"
        assert result["manufacturer"] == "TI"
        assert result["footprint"] == "TSSOP-16.kicad_mod"

    def test_extracts_tht_part(self, tmp_path):
        ato = tmp_path / "PJ398SM" / "PJ398SM.ato"
        ato.parent.mkdir()
        ato.write_text(SAMPLE_THT_ATO)

        result = parse_part_file(ato)

        assert result is not None
        assert result["name"] == "PJ398SM"
        assert result["lcsc"] == "C2907129"
        assert result["mpn"] == "PJ398SM"
        assert result["manufacturer"] == "Thonkiconn"

    def test_returns_none_for_no_traits(self, tmp_path):
        ato = tmp_path / "empty" / "empty.ato"
        ato.parent.mkdir()
        ato.write_text("# Just a comment\nmodule Foo:\n    signal x\n")

        result = parse_part_file(ato)
        assert result is None


class TestCountInstantiations:
    def test_counts_components(self, tmp_path):
        src = tmp_path / "test.ato"
        src.write_text(SAMPLE_SRC_ATO)

        counts = count_instantiations(tmp_path)

        assert counts["DAC8568SPMR"] == 2
        assert counts["PJ398SM"] == 3
        # Generic stdlib types should be excluded
        assert "Resistor" not in counts
        assert "Capacitor" not in counts

    def test_empty_directory(self, tmp_path):
        counts = count_instantiations(tmp_path)
        assert counts == {}


class TestClassifyPart:
    def test_smd_part(self):
        assert classify_part("DAC8568SPMR", "C524819") == "smd"

    def test_tht_part(self):
        assert classify_part("PJ398SM", "C2907129") == "tht"

    def test_placeholder_lcsc(self):
        assert classify_part("PGA2350", "C0000") == "manual"

    def test_empty_lcsc(self):
        assert classify_part("SomeModule", "") == "manual"

    def test_tbd_lcsc(self):
        assert classify_part("USB_C_Receptacle", "TBD") == "manual"


class TestBuildBom:
    def test_builds_complete_bom(self, tmp_path):
        # Set up parts directory
        parts_dir = tmp_path / "parts"
        dac_dir = parts_dir / "DAC8568SPMR"
        dac_dir.mkdir(parents=True)
        (dac_dir / "DAC8568SPMR.ato").write_text(SAMPLE_PART_ATO)

        jack_dir = parts_dir / "PJ398SM"
        jack_dir.mkdir()
        (jack_dir / "PJ398SM.ato").write_text(SAMPLE_THT_ATO)

        # Set up source directory
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        (src_dir / "test.ato").write_text(SAMPLE_SRC_ATO)

        bom = build_bom(parts_dir, src_dir, board_count=5)

        # Should have 2 project parts + 1 hardcoded extra
        project_parts = [p for p in bom if p.name != "JC3248A035N-1"]
        assert len(project_parts) == 2

        dac = next(p for p in bom if p.name == "DAC8568SPMR")
        assert dac.quantity == 10  # 2 instances × 5 boards
        assert dac.category == "smd"
        assert dac.lcsc == "C524819"

        jack = next(p for p in bom if p.name == "PJ398SM")
        assert jack.quantity == 15  # 3 instances × 5 boards
        assert jack.category == "tht"

    def test_board_count_multiplier(self, tmp_path):
        parts_dir = tmp_path / "parts"
        dac_dir = parts_dir / "DAC8568SPMR"
        dac_dir.mkdir(parents=True)
        (dac_dir / "DAC8568SPMR.ato").write_text(SAMPLE_PART_ATO)

        src_dir = tmp_path / "src"
        src_dir.mkdir()
        (src_dir / "test.ato").write_text("dac = new DAC8568SPMR\n")

        bom_1 = build_bom(parts_dir, src_dir, board_count=1)
        bom_5 = build_bom(parts_dir, src_dir, board_count=5)

        dac_1 = next(p for p in bom_1 if p.name == "DAC8568SPMR")
        dac_5 = next(p for p in bom_5 if p.name == "DAC8568SPMR")

        assert dac_1.quantity == 1
        assert dac_5.quantity == 5
