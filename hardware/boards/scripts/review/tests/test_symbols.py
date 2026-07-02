"""Unit tests for the symbol library."""
from __future__ import annotations

from review import symbols


def _pads(n: int) -> list[dict]:
    return [{"number": str(i + 1), "pin_name": "", "net": ""} for i in range(n)]


# ---------- classification ------------------------------------------------


def test_resistor_for_R_prefix():
    comp = {"ref": "R22", "value": "10kΩ", "footprint": "R0603", "pads": _pads(2)}
    assert isinstance(symbols.symbol_for(comp), symbols.Resistor)


def test_capacitor_for_C_prefix():
    comp = {"ref": "C12", "value": "100nF", "footprint": "C0603", "pads": _pads(2)}
    assert isinstance(symbols.symbol_for(comp), symbols.Capacitor)


def test_polarized_cap_detected_by_footprint():
    comp = {"ref": "C1", "value": "10µF", "footprint": "CP_Tantalum_3216", "pads": _pads(2)}
    sym = symbols.symbol_for(comp)
    assert isinstance(sym, symbols.Capacitor)
    assert sym.polarized


def test_ic_for_U_prefix():
    comp = {"ref": "U9", "value": "LDO", "footprint": "SOT-223", "pads": _pads(4)}
    assert isinstance(symbols.symbol_for(comp), symbols.IC)


def test_transistor_for_Q_prefix_3pin():
    comp = {"ref": "Q1", "value": "BC847", "footprint": "SOT-23", "pads": _pads(3)}
    assert isinstance(symbols.symbol_for(comp), symbols.Transistor)


def test_diode_for_D_prefix():
    comp = {"ref": "D5", "value": "BAV99", "footprint": "SOD-123", "pads": _pads(2)}
    assert isinstance(symbols.symbol_for(comp), symbols.Diode)


def test_led_detected_by_value():
    comp = {"ref": "D1", "value": "RED LED", "footprint": "LED_0603", "pads": _pads(2)}
    sym = symbols.symbol_for(comp)
    assert isinstance(sym, symbols.Diode)
    assert sym.is_led


def test_unannotated_resistor_by_atopile_address():
    comp = {
        "ref": "REF**",
        "display_name": "r_cc1",
        "value": "5.1kΩ",
        "footprint": "R0603",
        "pads": _pads(2),
    }
    assert isinstance(symbols.symbol_for(comp), symbols.Resistor)


def test_unannotated_transistor_by_atopile_address():
    comp = {
        "ref": "REF**",
        "display_name": "q_clk",
        "value": "SOT-23",
        "footprint": "SOT-23",
        "pads": _pads(3),
    }
    assert isinstance(symbols.symbol_for(comp), symbols.Transistor)


def test_connector_for_header_footprint():
    comp = {
        "ref": "REF**",
        "display_name": "header_a",
        "value": "ShroudedHeader2x16",
        "footprint": "ShroudedHeader2x16",
        "pads": _pads(32),
    }
    assert isinstance(symbols.symbol_for(comp), symbols.Connector)


def test_connector_for_usb_footprint():
    comp = {
        "ref": "REF**",
        "display_name": "usb",
        "value": "USB_C_Receptacle",
        "footprint": "USB_C_Receptacle",
        "pads": _pads(24),
    }
    assert isinstance(symbols.symbol_for(comp), symbols.Connector)


def test_encoder_is_connector():
    comp = {
        "ref": "REF**",
        "display_name": "enc_a",
        "value": "EC11E",
        "footprint": "EC11E",
        "pads": _pads(7),
    }
    assert isinstance(symbols.symbol_for(comp), symbols.Connector)


def test_sot23_without_ref_hint_becomes_transistor():
    comp = {
        "ref": "REF**",
        "display_name": "some_clamp",
        "value": "SOT-23",
        "footprint": "SOT-23",
        "pads": _pads(3),
    }
    assert isinstance(symbols.symbol_for(comp), symbols.Transistor)


def test_ic_for_qfn_footprint():
    comp = {
        "ref": "REF**",
        "display_name": "dac1",
        "value": "WQFN-16",
        "footprint": "WQFN-16",
        "pads": _pads(16),
    }
    assert isinstance(symbols.symbol_for(comp), symbols.IC)


# ---------- symbol properties --------------------------------------------


def test_resistor_has_two_pins_and_positive_size():
    sym = symbols.Resistor(_pads(2))
    assert sym.width > 0
    assert sym.height > 0
    assert len(sym.pins) == 2
    assert sym.pins[0].side == "t"
    assert sym.pins[1].side == "b"


def test_capacitor_has_two_pins():
    sym = symbols.Capacitor(_pads(2))
    assert len(sym.pins) == 2


def test_transistor_has_three_pins():
    sym = symbols.Transistor(_pads(3))
    assert len(sym.pins) == 3
    sides = {p.side for p in sym.pins}
    assert sides == {"l", "t", "b"}


def test_ic_sizes_with_pin_count():
    small = symbols.IC(_pads(4))
    big = symbols.IC(_pads(40))
    assert big.height > small.height
    assert len(small.pins) == 4
    assert len(big.pins) == 40


def test_ic_splits_pins_left_right():
    sym = symbols.IC(_pads(10))
    left = [p for p in sym.pins if p.side == "l"]
    right = [p for p in sym.pins if p.side == "r"]
    assert len(left) == 5
    assert len(right) == 5


def test_connector_puts_all_pins_on_right():
    sym = symbols.Connector(_pads(8))
    assert len(sym.pins) == 8
    for p in sym.pins:
        assert p.side == "r"


def test_body_svg_returns_string():
    for cls, n in [
        (symbols.Resistor, 2),
        (symbols.Capacitor, 2),
        (symbols.Inductor, 2),
        (symbols.Diode, 2),
        (symbols.Crystal, 2),
        (symbols.TestPoint, 1),
        (symbols.Transistor, 3),
        (symbols.IC, 8),
        (symbols.Connector, 6),
    ]:
        sym = cls(_pads(n))
        svg = sym.body_svg(10.0, 20.0)
        assert isinstance(svg, str)
        assert len(svg) > 0


def test_label_svg_includes_refdes_and_value():
    sym = symbols.Resistor(_pads(2))
    label = sym.label_svg(10, 20, "R22", "10kΩ")
    assert "R22" in label
    assert "10kΩ" in label
    # Uses text-anchor middle
    assert "text-anchor=\"middle\"" in label


def test_pin_abs_coordinates():
    sym = symbols.Resistor(_pads(2))
    abs_pins = sym.pin_abs(100.0, 200.0)
    assert len(abs_pins) == 2
    # Pin 1 at top (rel_y=0)
    assert abs_pins[0][2] == 200.0
    # Pin 2 at bottom (rel_y=height=14)
    assert abs_pins[1][2] == 214.0
