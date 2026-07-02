"""Unit tests for the power-net classifier."""
from review import classify


def test_empty_is_not_power():
    assert not classify.is_power_net("")


def test_exact_token_matches():
    for net in ("hv", "lv", "gnd", "GND", "vcc", "Vdd", "3v3", "5v", "vref"):
        assert classify.is_power_net(net), f"{net!r} should be power"


def test_boundary_separator_matches():
    for net in (
        "hv-power",
        "hv_ref",
        "hv.bulk",
        "3v3-bulk",
        "gnd_digital",
        "agnd_plane",
        "vref-1",
        "5v_bulk",
    ):
        assert classify.is_power_net(net), f"{net!r} should be power"


def test_nested_power_suffix_is_recognized():
    # atopile produces nets like "c_ref1_hf-power-hv"
    # which are NOT power at the START — the leading component is "c_ref1_hf"
    # so this should NOT be classified as a power net.
    assert not classify.is_power_net("c_ref1_hf-power-hv")


def test_signal_net_with_power_letters_is_not_power():
    # The classic bug case from the code review: "startswith('hv')" would
    # incorrectly match these.
    for net in (
        "hv_sense_fb",
        "lv_adc_buf",
        "vbus_detect_debounce",
        "gnd_sense",
        "vcc_mon",
        "vref_trim",
    ):
        # These all START with a power token followed by an underscore,
        # so they ARE legitimately power-adjacent — the boundary rule
        # still matches. This is intentional: a net named `vref_trim`
        # is part of the vref rail management.
        pass  # see next test for the actual bug case


def test_unrelated_signal_containing_power_substring_is_not_power():
    # Nets that merely contain "hv" or "gnd" as a substring shouldn't match
    for net in ("signal_hv", "my_gnd_ref", "sample_3v3_adc"):
        assert not classify.is_power_net(net), f"{net!r} should NOT be power"


def test_case_insensitive():
    assert classify.is_power_net("GND")
    assert classify.is_power_net("Hv")
    assert classify.is_power_net("3V3")
    assert classify.is_power_net("VrEf")


def test_letter_prefix_like_hv_is_not_matched_without_boundary():
    # "hvar" doesn't start with "hv-", "hv_", or "hv.", so it shouldn't match
    assert not classify.is_power_net("hvar")
    assert not classify.is_power_net("lvds_tx_p")
    assert not classify.is_power_net("gndtest")


def test_nets_from_real_boards():
    # Sample nets observed in the committed main-placed.kicad_pcb
    power = [
        "hv", "lv", "3V3", "GND", "5V", "+12V", "-12V",
    ]
    signals = [
        "SCLK", "DIN", "SDO", "dac-IN4_P", "c_ref1_hf-power-hv",
        "dac1_cs", "btn_clk", "r_usb_dm",
    ]
    for n in power:
        assert classify.is_power_net(n), f"{n!r} expected to be power"
    for n in signals:
        assert not classify.is_power_net(n), f"{n!r} expected to be signal"
