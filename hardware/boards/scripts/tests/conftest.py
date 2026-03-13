"""Shared fixtures for placement tests."""

import pytest

from placement.strategies import AntiAffinityRule, BoardContext, ComponentInfo, Placement


@pytest.fixture
def small_board_ctx():
    """A synthetic 50x50mm board with 5 free components and 2 fixed.

    Net graph:
      net1: fixed_a, comp_a, comp_b
      net2: comp_b, comp_c
      net3: fixed_b, comp_d, comp_e
      net4: comp_a, comp_d
    """
    fixed = {
        "fixed_a": Placement(x=10.0, y=10.0, side="F"),
        "fixed_b": Placement(x=40.0, y=40.0, side="F"),
    }
    fixed_info = {
        "fixed_a": ComponentInfo(
            address="fixed_a", width=5.0, height=5.0,
            is_tht=True, pin_count=4, nets=["net1"],
        ),
        "fixed_b": ComponentInfo(
            address="fixed_b", width=5.0, height=5.0,
            is_tht=True, pin_count=4, nets=["net3"],
        ),
    }
    free = {
        "comp_a": ComponentInfo(
            address="comp_a", width=5.0, height=3.0,
            is_tht=False, pin_count=4,
            nets=["net1", "net4"],
        ),
        "comp_b": ComponentInfo(
            address="comp_b", width=4.0, height=2.0,
            is_tht=False, pin_count=2,
            nets=["net1", "net2"],
        ),
        "comp_c": ComponentInfo(
            address="comp_c", width=3.0, height=2.0,
            is_tht=False, pin_count=2,
            nets=["net2"],
        ),
        "comp_d": ComponentInfo(
            address="comp_d", width=6.0, height=4.0,
            is_tht=False, pin_count=8,
            nets=["net3", "net4"],
        ),
        "comp_e": ComponentInfo(
            address="comp_e", width=3.0, height=2.0,
            is_tht=False, pin_count=2,
            nets=["net3"],
        ),
    }
    net_graph = {
        "net1": ["fixed_a", "comp_a", "comp_b"],
        "net2": ["comp_b", "comp_c"],
        "net3": ["fixed_b", "comp_d", "comp_e"],
        "net4": ["comp_a", "comp_d"],
    }
    return BoardContext(
        width=50.0,
        height=50.0,
        fixed=fixed,
        free=free,
        net_graph=net_graph,
        config={},
        fixed_info=fixed_info,
    )


@pytest.fixture
def tht_board_ctx():
    """Board with a mix of THT and SMD components."""
    fixed = {
        "header_a": Placement(x=10.0, y=25.0, side="F"),
    }
    fixed_info = {
        "header_a": ComponentInfo(
            address="header_a", width=6.0, height=20.0,
            is_tht=True, pin_count=16, nets=["net1"],
            cx_offset=0.0, cy_offset=8.0,  # origin at pin 1, body extends downward
        ),
    }
    free = {
        "tht_comp": ComponentInfo(
            address="tht_comp", width=8.0, height=10.0,
            is_tht=True, pin_count=6,
            nets=["net1"],
        ),
        "smd_front": ComponentInfo(
            address="smd_front", width=3.0, height=2.0,
            is_tht=False, pin_count=2,
            nets=["net1"],
        ),
        "smd_back": ComponentInfo(
            address="smd_back", width=3.0, height=2.0,
            is_tht=False, pin_count=2,
            nets=["net1"],
        ),
    }
    net_graph = {
        "net1": ["header_a", "tht_comp", "smd_front", "smd_back"],
    }
    return BoardContext(
        width=40.0,
        height=50.0,
        fixed=fixed,
        free=free,
        net_graph=net_graph,
        config={},
        fixed_info=fixed_info,
    )


@pytest.fixture
def anti_affinity_ctx():
    """100x100mm board with a fixed 'hot' regulator and a free 'sensitive' DAC.

    The anti-affinity rule requires 30mm minimum distance between them.
    Other free components have no anti-affinity constraints.
    """
    fixed = {
        "power.reg_5v": Placement(x=15.0, y=15.0, side="F"),
    }
    fixed_info = {
        "power.reg_5v": ComponentInfo(
            address="power.reg_5v", width=6.0, height=7.0,
            is_tht=False, pin_count=3, nets=["net_5v"],
        ),
    }
    free = {
        "dacs.dac_a": ComponentInfo(
            address="dacs.dac_a", width=5.0, height=8.0,
            is_tht=False, pin_count=16,
            nets=["net_spi", "net_5v"],
        ),
        "logic.shift_reg": ComponentInfo(
            address="logic.shift_reg", width=4.0, height=5.0,
            is_tht=False, pin_count=16,
            nets=["net_spi"],
        ),
        "passive.cap1": ComponentInfo(
            address="passive.cap1", width=2.0, height=1.0,
            is_tht=False, pin_count=2,
            nets=["net_5v"],
        ),
    }
    net_graph = {
        "net_spi": ["dacs.dac_a", "logic.shift_reg"],
        "net_5v": ["power.reg_5v", "dacs.dac_a", "passive.cap1"],
    }
    rules = [
        AntiAffinityRule(from_pattern="power.", to_pattern="dacs.", min_mm=30.0),
    ]
    return BoardContext(
        width=100.0,
        height=100.0,
        fixed=fixed,
        free=free,
        net_graph=net_graph,
        config={},
        fixed_info=fixed_info,
        anti_affinity=rules,
    )
