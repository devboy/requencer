"""Tests for per-component courtyard padding."""

from placement.place_components import get_component_padding


class TestGetComponentPadding:
    def test_no_config_returns_zeros(self):
        assert get_component_padding("leds.tlc1", {}) == (0.0, 0.0, 0.0, 0.0)

    def test_exact_match(self):
        cfg = {"leds.tlc1": {"left": 1.0, "right": 2.0, "top": 3.0, "bottom": 4.0}}
        assert get_component_padding("leds.tlc1", cfg) == (1.0, 2.0, 3.0, 4.0)

    def test_prefix_match(self):
        cfg = {"leds.tlc": {"left": 2.0, "right": 2.0, "top": 2.0, "bottom": 2.0}}
        assert get_component_padding("leds.tlc1", cfg) == (2.0, 2.0, 2.0, 2.0)
        assert get_component_padding("leds.tlc2", cfg) == (2.0, 2.0, 2.0, 2.0)

    def test_no_match_returns_zeros(self):
        cfg = {"leds.tlc": {"left": 2.0, "right": 2.0, "top": 2.0, "bottom": 2.0}}
        assert get_component_padding("buttons.sr1", cfg) == (0.0, 0.0, 0.0, 0.0)

    def test_partial_sides_default_to_zero(self):
        cfg = {"lcd_fpc": {"top": 5.0}}
        assert get_component_padding("lcd_fpc", cfg) == (0.0, 0.0, 5.0, 0.0)

    def test_single_side_only(self):
        cfg = {"display.": {"bottom": 3.5}}
        assert get_component_padding("display.header", cfg) == (0.0, 0.0, 0.0, 3.5)

    def test_first_matching_prefix_wins(self):
        cfg = {
            "leds.": {"left": 1.0},
            "leds.tlc": {"left": 5.0},
        }
        # Dict iteration order: "leds." matches first
        result = get_component_padding("leds.tlc1", cfg)
        assert result[0] == 1.0

    def test_empty_addr_no_crash(self):
        cfg = {"leds.": {"left": 1.0}}
        assert get_component_padding("", cfg) == (0.0, 0.0, 0.0, 0.0)

    def test_multiple_rules_independent(self):
        cfg = {
            "leds.tlc": {"left": 2.0, "right": 2.0, "top": 2.0, "bottom": 2.0},
            "lcd_fpc": {"top": 5.0, "bottom": 3.0},
        }
        assert get_component_padding("leds.tlc1", cfg) == (2.0, 2.0, 2.0, 2.0)
        assert get_component_padding("lcd_fpc", cfg) == (0.0, 0.0, 5.0, 3.0)
        assert get_component_padding("midi.opto", cfg) == (0.0, 0.0, 0.0, 0.0)


class TestAutoFromPins:
    def test_auto_padding_returns_uniform_max(self):
        # base=2.5, per_signal_pin=0.5, edge_counts: N=2, S=4, E=3, W=4
        # edge paddings: N=2.5+1.0=3.5, S=2.5+2.0=4.5, E=2.5+1.5=4.0, W=2.5+2.0=4.5
        # max = 4.5
        cfg = {"dacs.dac": {"auto_from_pins": True, "base": 2.5, "per_signal_pin": 0.5}}
        edge_counts = {"N": 2, "S": 4, "E": 3, "W": 4}
        result = get_component_padding("dacs.dac1", cfg, edge_signal_counts=edge_counts)
        assert result == (4.5, 4.5, 4.5, 4.5)

    def test_auto_padding_without_edge_counts_uses_base(self):
        cfg = {"dacs.dac": {"auto_from_pins": True, "base": 2.5, "per_signal_pin": 0.5}}
        result = get_component_padding("dacs.dac1", cfg)
        assert result == (2.5, 2.5, 2.5, 2.5)

    def test_explicit_padding_still_works(self):
        cfg = {
            "dacs.dac": {"auto_from_pins": True, "base": 2.5, "per_signal_pin": 0.5},
            "dac.opamp": {"left": 2.0, "right": 2.0, "top": 2.0, "bottom": 2.0},
        }
        result = get_component_padding("dac.opamp1", cfg, edge_signal_counts={"N": 10})
        assert result == (2.0, 2.0, 2.0, 2.0)

    def test_no_match_returns_zeros(self):
        cfg = {"dacs.dac": {"auto_from_pins": True, "base": 2.5, "per_signal_pin": 0.5}}
        result = get_component_padding("power.reg", cfg, edge_signal_counts={"N": 5})
        assert result == (0.0, 0.0, 0.0, 0.0)
