"""Shared classification helpers used by both renderers.

Centralizes "is this a power net?" logic so the subcircuit renderer and
the overview renderer use the same rules. Previously both had their own
copy with a subtle startswith bug (see code review H1/H2).
"""
from __future__ import annotations


# Tokens that identify a power net. The match is *bounded*: the net name
# must either equal the token exactly, or start with `<token>-`/`<token>_`/
# `<token>.`. Raw `startswith` would match `hv_sense_fb` as a power net
# which is wrong.
_POWER_TOKENS: tuple[str, ...] = (
    "gnd", "agnd", "dgnd", "pgnd",
    "vcc", "vdd", "vss",
    "vbus", "vbat", "vin", "vout",
    "vref", "vio",
    "hv", "lv",               # atopile's high-voltage / low-voltage globals
    "5v", "+5v", "-5v",
    "3v3", "+3v3", "3v",
    "12v", "+12v", "-12v",
    "+5", "+3", "+12",
    "+1v2", "+1v8", "+2v5", "+2v8", "+3v0", "+3v3", "+5v0", "+12v0",
)


def is_power_net(name: str) -> bool:
    """Return True if `name` identifies a power or ground net.

    Matches the net name against a set of tokens with a strict boundary:
    either exact equality, or the token followed by `-`, `_`, or `.`.

    >>> is_power_net("hv")
    True
    >>> is_power_net("HV")
    True
    >>> is_power_net("hv_sense_fb")
    False
    >>> is_power_net("3v3-power-hv")
    True
    >>> is_power_net("GND")
    True
    >>> is_power_net("SCLK")
    False
    """
    if not name:
        return False
    low = name.lower()
    for tok in _POWER_TOKENS:
        if low == tok:
            return True
        if low.startswith(tok + "-") or low.startswith(tok + "_") or low.startswith(tok + "."):
            return True
    return False
