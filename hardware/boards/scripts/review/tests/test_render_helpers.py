"""Unit tests for pure helpers in the render modules.

The rendering code itself is verified visually (SVG → PNG → eyeball),
but the pure helper functions are worth testing directly so they don't
regress silently.
"""
from __future__ import annotations

from review import render_overview, render_subcircuit


# --------------------------------------------------------------------------
# render_subcircuit
# --------------------------------------------------------------------------

def test_truncate_passes_through_short_strings():
    assert render_subcircuit._truncate("abc") == "abc"


def test_truncate_shortens_long_strings():
    long = "a_very_long_net_name_that_should_be_truncated"
    result = render_subcircuit._truncate(long, n=10)
    assert len(result) == 10
    assert result.endswith("…")


def test_escape_escapes_xml_special_chars():
    assert render_subcircuit._escape("a&b<c>d\"e") == "a&amp;b&lt;c&gt;d&quot;e"


def test_escape_leaves_normal_strings_alone():
    assert render_subcircuit._escape("SCLK") == "SCLK"


def test_short_value_prefers_value_for_annotated_component():
    comp = {
        "ref": "R22",
        "value": "10kΩ",
        "display_name": "r_pitch",
        "footprint": "R0603",
    }
    assert render_subcircuit._short_value(comp) == "10kΩ"


def test_short_value_uses_display_name_for_unannotated_component():
    comp = {
        "ref": "REF**",
        "value": "SOT-23",
        "display_name": "q_clk",
        "footprint": "SOT-23",
    }
    assert render_subcircuit._short_value(comp) == "q_clk"


def test_short_value_falls_back_to_footprint_when_all_else_empty():
    comp = {
        "ref": "REF**",
        "value": "",
        "display_name": "",
        "footprint": "WQFN-16",
    }
    assert render_subcircuit._short_value(comp) == "WQFN-16"


def test_pin_stub_svg_produces_non_empty_for_each_side():
    for side in ("l", "r", "t", "b"):
        out = render_subcircuit._pin_stub_svg(side, 100.0, 50.0, "SCLK", "1")
        assert "<line" in out
        assert "<text" in out
        assert "SCLK" in out


def test_pin_stub_svg_includes_pad_number():
    out = render_subcircuit._pin_stub_svg("r", 10, 10, "VREF", "7")
    assert 'class="padnum">7<' in out


def test_pin_stub_svg_marks_unconnected_as_NC():
    out = render_subcircuit._pin_stub_svg("r", 10, 10, "", "1")
    assert "NC" in out


def test_pin_stub_svg_uses_power_class_for_power_nets():
    out = render_subcircuit._pin_stub_svg("r", 10, 10, "hv", "1")
    assert "netlabel-power" in out
    assert "stub-power" in out


def test_pin_stub_svg_uses_signal_class_for_signal_nets():
    out = render_subcircuit._pin_stub_svg("r", 10, 10, "SCLK", "1")
    assert "netlabel\"" in out  # not netlabel-power


# --------------------------------------------------------------------------
# render_overview
# --------------------------------------------------------------------------

def test_subcircuit_box_size_scales_with_component_count():
    small_w, small_h = render_overview._subcircuit_box_size(1)
    big_w, big_h = render_overview._subcircuit_box_size(80)
    assert big_w > small_w
    assert big_h > small_h


def test_subcircuit_box_size_bounded():
    # Even a huge component count shouldn't produce absurd dimensions
    w, h = render_overview._subcircuit_box_size(10000)
    assert w < 500
    assert h < 500


def test_is_interface_subcircuit_true_for_connector_names():
    assert render_overview._is_interface_subcircuit("usb")
    assert render_overview._is_interface_subcircuit("sd")
    assert render_overview._is_interface_subcircuit("connector")
    assert render_overview._is_interface_subcircuit("midi")
    assert render_overview._is_interface_subcircuit("lcd_fpc")
    assert render_overview._is_interface_subcircuit("enc_a")


def test_is_interface_subcircuit_false_for_signal_processing_blocks():
    assert not render_overview._is_interface_subcircuit("dac")
    assert not render_overview._is_interface_subcircuit("mcu")
    assert not render_overview._is_interface_subcircuit("power")
    assert not render_overview._is_interface_subcircuit("discretes")
