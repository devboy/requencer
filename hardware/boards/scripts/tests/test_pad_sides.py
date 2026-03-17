"""Tests for extract_pad_sides() — no pcbnew dependency."""

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from placement.helpers import extract_pad_sides


# ---------------------------------------------------------------------------
# Fake mocks
# ---------------------------------------------------------------------------

class FakePad:
    def __init__(self, x_mm, y_mm, net_name):
        self._x = x_mm
        self._y = y_mm
        self._net = net_name

    def GetPosition(self):
        return FakeVector(self._x * 1e6, self._y * 1e6)

    def GetNetname(self):
        return self._net


class FakeVector:
    def __init__(self, x, y):
        self.x = x
        self.y = y


class FakePcbnew:
    @staticmethod
    def ToMM(val):
        return val / 1e6


class FakeFootprint:
    def __init__(self, pads):
        self._pads = pads

    def Pads(self):
        return self._pads

    def GetPosition(self):
        return FakeVector(0, 0)


# ---------------------------------------------------------------------------
# QFN-16 (DAC80508 WQFN-16, 3×3 mm)
# ---------------------------------------------------------------------------
#
# West  (x=-1.45): y=-0.75,-0.25,+0.25,+0.75  → OUT0-OUT3
# South (y=+1.45): x=-0.75,-0.25,+0.25,+0.75  → OUT4-OUT7
# East  (x=+1.45): y=+0.75,+0.25,-0.25,-0.75  → VIO,SDO,SCLK,SYNC
# North (y=-1.45): x=+0.75,+0.25,-0.25,-0.75  → DIN,AVDD,VREF,GND
# Center (0,0): thermal pad, net GND
# Power nets: {"GND", "AVDD", "VIO"}

QFN_PADS = [
    # West side
    FakePad(-1.45, -0.75, "OUT0"),
    FakePad(-1.45, -0.25, "OUT1"),
    FakePad(-1.45,  0.25, "OUT2"),
    FakePad(-1.45,  0.75, "OUT3"),
    # South side
    FakePad(-0.75,  1.45, "OUT4"),
    FakePad(-0.25,  1.45, "OUT5"),
    FakePad( 0.25,  1.45, "OUT6"),
    FakePad( 0.75,  1.45, "OUT7"),
    # East side
    FakePad( 1.45,  0.75, "VIO"),
    FakePad( 1.45,  0.25, "SDO"),
    FakePad( 1.45, -0.25, "SCLK"),
    FakePad( 1.45, -0.75, "SYNC"),
    # North side
    FakePad( 0.75, -1.45, "DIN"),
    FakePad( 0.25, -1.45, "AVDD"),
    FakePad(-0.25, -1.45, "VREF"),
    FakePad(-0.75, -1.45, "GND"),
    # Center thermal pad
    FakePad( 0.0,   0.0,  "GND"),
]

QFN_POWER_NETS = {"GND", "AVDD", "VIO"}

QFN_FP = FakeFootprint(QFN_PADS)
PCBNEW = FakePcbnew()


class TestExtractPadSidesQFN:
    def _result(self):
        return extract_pad_sides(QFN_FP, PCBNEW, QFN_POWER_NETS)

    def test_four_edges_populated(self):
        r = self._result()
        assert len(r["W"]) > 0
        assert len(r["S"]) > 0
        assert len(r["E"]) > 0
        assert len(r["N"]) > 0

    def test_west_has_outputs(self):
        r = self._result()
        assert set(r["W"]) == {"OUT0", "OUT1", "OUT2", "OUT3"}

    def test_south_has_outputs(self):
        r = self._result()
        assert set(r["S"]) == {"OUT4", "OUT5", "OUT6", "OUT7"}

    def test_east_has_spi(self):
        # VIO is a power net → filtered out; SDO, SCLK, SYNC remain
        r = self._result()
        assert set(r["E"]) == {"SDO", "SCLK", "SYNC"}

    def test_north_has_din_and_vref(self):
        # AVDD and GND are power nets → filtered; DIN and VREF remain
        r = self._result()
        assert set(r["N"]) == {"DIN", "VREF"}

    def test_thermal_pad_skipped(self):
        # Center pad (0,0) should never appear in any side list
        r = self._result()
        all_nets = r["N"] + r["S"] + r["E"] + r["W"]
        # GND is filtered by power_nets, but more importantly the center
        # threshold should have excluded it before the power check.
        # Either way it must not appear here.
        assert all_nets.count("GND") == 0


# ---------------------------------------------------------------------------
# TSSOP-14 op-amp (pads only on W and E)
# ---------------------------------------------------------------------------
#
# TSSOP-14: 7 pads on each side, pitch 0.65 mm, span ≈ 3.9 mm vertically
# W (x=-2.5): pins 1-7  → IN+, IN-, VS-, OUT, NC, NC, NC  (VS- is power)
# E (x=+2.5): pins 8-14 → NC, NC, NC, OUT2, VS+, IN2-, IN2+  (VS+ is power)

TSSOP_PADS = [
    # West side (pin 1–7)
    FakePad(-2.5, -1.95, "IN_P"),
    FakePad(-2.5, -1.30, "IN_N"),
    FakePad(-2.5, -0.65, "VS_NEG"),
    FakePad(-2.5,  0.00, "OUT_A"),
    FakePad(-2.5,  0.65, ""),        # NC
    FakePad(-2.5,  1.30, ""),        # NC
    FakePad(-2.5,  1.95, ""),        # NC
    # East side (pin 8–14)
    FakePad( 2.5,  1.95, ""),        # NC
    FakePad( 2.5,  1.30, ""),        # NC
    FakePad( 2.5,  0.65, ""),        # NC
    FakePad( 2.5,  0.00, "OUT_B"),
    FakePad( 2.5, -0.65, "VS_POS"),
    FakePad( 2.5, -1.30, "IN2_N"),
    FakePad( 2.5, -1.95, "IN2_P"),
]

TSSOP_POWER_NETS = {"VS_NEG", "VS_POS"}

TSSOP_FP = FakeFootprint(TSSOP_PADS)


class TestExtractPadSidesTSSOP:
    def _result(self):
        return extract_pad_sides(TSSOP_FP, PCBNEW, TSSOP_POWER_NETS)

    def test_only_west_and_east(self):
        r = self._result()
        assert len(r["N"]) == 0
        assert len(r["S"]) == 0
        assert len(r["W"]) > 0
        assert len(r["E"]) > 0

    def test_power_filtered(self):
        r = self._result()
        all_nets = r["N"] + r["S"] + r["E"] + r["W"]
        assert "VS_NEG" not in all_nets
        assert "VS_POS" not in all_nets

    def test_west_signals(self):
        r = self._result()
        # Only named non-power nets: IN_P, IN_N, OUT_A
        assert set(r["W"]) == {"IN_P", "IN_N", "OUT_A"}

    def test_east_signals(self):
        r = self._result()
        assert set(r["E"]) == {"OUT_B", "IN2_N", "IN2_P"}


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

class TestExtractPadSidesEdgeCases:
    def test_empty_footprint(self):
        fp = FakeFootprint([])
        r = extract_pad_sides(fp, PCBNEW, set())
        assert r == {"N": [], "S": [], "E": [], "W": []}

    def test_single_pad_returns_empty(self):
        # With one pad, min_x == max_x and min_y == max_y.
        # span_x = span_y = 0, so center_thresh = 0.1.
        # The pad is at the center (cx=py=0 relative to itself), so
        # abs(px - cx) == 0 < 0.1 → skipped as center pad.
        fp = FakeFootprint([FakePad(1.0, 1.0, "SIG")])
        r = extract_pad_sides(fp, PCBNEW, set())
        assert r == {"N": [], "S": [], "E": [], "W": []}

    def test_two_pads_opposite_sides(self):
        # Two pads: west and east
        fp = FakeFootprint([
            FakePad(-1.0, 0.0, "SIG_W"),
            FakePad( 1.0, 0.0, "SIG_E"),
        ])
        r = extract_pad_sides(fp, PCBNEW, set())
        assert "SIG_W" in r["W"]
        assert "SIG_E" in r["E"]
        assert r["N"] == []
        assert r["S"] == []
