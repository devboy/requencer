"""Apply design rules from design-rules.json to a KiCad board.

Shared by autoroute.py (Step 1: pre-DSN export) and import_ses.py (pre-save).
"""

import json
import os
import re


def load_rules(rules_path=None):
    """Load design rules from JSON config."""
    if rules_path is None:
        rules_path = os.path.join(os.path.dirname(__file__), '..', '..', 'design-rules.json')
    with open(rules_path) as f:
        return json.load(f)


def apply_rules(board, pcbnew, rules=None):
    """Apply design rules and netclass assignments to a KiCad board.

    Args:
        board: pcbnew.BOARD instance
        pcbnew: pcbnew module (passed in to avoid import issues in different environments)
        rules: dict from load_rules(), or None to load from default path
    """
    if rules is None:
        rules = load_rules()

    ds = board.GetDesignSettings()

    # Board-level minimums
    bm = rules['board_minimums']
    ds.m_TrackMinWidth = pcbnew.FromMM(bm['track_min_width'])
    ds.m_MinClearance = pcbnew.FromMM(bm['min_clearance'])
    ds.m_ViasMinSize = pcbnew.FromMM(bm['via_min_size'])
    ds.m_ViasMinDrill = pcbnew.FromMM(bm['via_min_drill'])
    ds.m_ViasMinAnnularWidth = pcbnew.FromMM(bm['via_min_annular_width'])
    ds.m_CopperEdgeClearance = pcbnew.FromMM(bm['copper_edge_clearance'])
    ds.m_HoleClearance = pcbnew.FromMM(bm['hole_clearance'])
    ds.m_HoleToHoleMin = pcbnew.FromMM(bm['hole_to_hole_min'])
    ds.m_MinThroughDrill = pcbnew.FromMM(bm['min_through_drill'])

    # Solder mask
    sm = rules['solder_mask']
    ds.m_SolderMaskExpansion = pcbnew.FromMM(sm['expansion'])
    ds.m_SolderMaskMinWidth = pcbnew.FromMM(sm['min_width'])

    # Silkscreen
    ss = rules['silkscreen']
    ds.m_MinSilkTextHeight = pcbnew.FromMM(ss['min_text_height'])
    ds.m_MinSilkTextThickness = pcbnew.FromMM(ss['min_text_thickness'])

    # Netclasses
    nc_defs = rules['netclasses']
    ns = ds.m_NetSettings

    # Default netclass
    if 'Default' in nc_defs:
        nc = ns.GetDefaultNetclass()
        d = nc_defs['Default']
        nc.SetClearance(pcbnew.FromMM(d['clearance']))
        nc.SetTrackWidth(pcbnew.FromMM(d['track_width']))
        nc.SetViaDiameter(pcbnew.FromMM(d['via_diameter']))
        nc.SetViaDrill(pcbnew.FromMM(d['via_drill']))

    # Custom netclasses
    for name, d in nc_defs.items():
        if name == 'Default':
            continue
        nc = pcbnew.NETCLASS(name)
        nc.SetTrackWidth(pcbnew.FromMM(d['track_width']))
        nc.SetClearance(pcbnew.FromMM(d['clearance']))
        nc.SetViaDiameter(pcbnew.FromMM(d['via_diameter']))
        nc.SetViaDrill(pcbnew.FromMM(d['via_drill']))
        ns.SetNetclass(name, nc)

    # Net-to-netclass assignments
    assignments = rules.get('net_assignments', {})
    net_names = [str(n) for n in board.GetNetInfo().NetsByName()]
    for netclass_name, patterns in assignments.items():
        for net_name in net_names:
            for pattern in patterns:
                if pattern.startswith('^') or '\\' in pattern:
                    # Regex pattern
                    if re.match(pattern, net_name):
                        ns.SetNetclassPatternAssignment(net_name, netclass_name)
                        break
                else:
                    # Exact match
                    if net_name == pattern:
                        ns.SetNetclassPatternAssignment(net_name, netclass_name)
                        break
