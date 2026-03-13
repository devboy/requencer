#!/usr/bin/env python3
"""Import a FreeRouting Specctra SES file into a KiCad PCB.

Workaround for pcbnew.ImportSpecctraSES() which requires an active
KiCad GUI window and silently fails in headless/scripted mode
(KiCad GitLab #14339).

Parses the SES file's (routes) section and creates PCB_TRACK and
PCB_VIA objects directly via the pcbnew Python API.

Usage:
    python3 import_ses.py <board.kicad_pcb> <board.ses> [output.kicad_pcb]

NOTE: FreeRouting may occasionally route a trace to a pad's X,Y position on a layer
where the pad has no copper, without inserting a via. This can happen due to routing
congestion or optimizer decisions. A "via stitching pass" after track/via import
detects such cases (track endpoints near wrong-layer pads with no correct-layer pad
nearby) and auto-inserts a via + bridge trace.
"""

import math
import os
import re
import sys


def parse_sexp(text):
    """Minimal S-expression parser for SES files."""
    tokens = re.findall(r'\(|\)|"[^"]*"|[^\s()]+', text)
    pos = [0]

    def parse():
        if pos[0] >= len(tokens):
            return None
        tok = tokens[pos[0]]
        if tok == '(':
            pos[0] += 1
            lst = []
            while pos[0] < len(tokens) and tokens[pos[0]] != ')':
                lst.append(parse())
            pos[0] += 1  # skip ')'
            return lst
        else:
            pos[0] += 1
            # Strip quotes
            if tok.startswith('"') and tok.endswith('"'):
                return tok[1:-1]
            # Try numeric
            try:
                return int(tok)
            except ValueError:
                try:
                    return float(tok)
                except ValueError:
                    return tok

    result = []
    while pos[0] < len(tokens):
        r = parse()
        if r is not None:
            result.append(r)
    return result[0] if len(result) == 1 else result


def find_node(sexp, name):
    """Find a named sub-node in an S-expression list."""
    if not isinstance(sexp, list):
        return None
    for item in sexp:
        if isinstance(item, list) and len(item) > 0 and item[0] == name:
            return item
    return None


def find_all(sexp, name):
    """Find all named sub-nodes."""
    results = []
    if not isinstance(sexp, list):
        return results
    for item in sexp:
        if isinstance(item, list) and len(item) > 0 and item[0] == name:
            results.append(item)
    return results


def import_ses(board_path, ses_path, output_path=None):
    """Import SES routes into a KiCad PCB."""
    try:
        import pcbnew
    except ImportError:
        print("pcbnew not available. Run with KiCad's Python.")
        sys.exit(1)

    if output_path is None:
        output_path = board_path

    # Load board
    board = pcbnew.LoadBoard(board_path)

    # Fix unassigned reference designators (match autoroute.sh)
    existing_refs = set()
    unassigned = []
    for fp in board.GetFootprints():
        ref = fp.GetReference()
        if ref == 'REF**' or ref.startswith('REF*'):
            unassigned.append(fp)
        else:
            existing_refs.add(ref)

    if unassigned:
        for i, fp in enumerate(unassigned):
            new_ref = f"X{i+1}"
            while new_ref in existing_refs:
                new_ref = f"X{i+1000}"
                i += 1000
            fp.SetReference(new_ref)
            existing_refs.add(new_ref)

    # Apply design rules from shared config (JLCPCB + eurorack best practices).
    # Edit hardware/boards/design-rules.json to change netclasses, clearances, etc.
    import sys as _sys
    _scripts_dir = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
    if _scripts_dir not in _sys.path:
        _sys.path.insert(0, _scripts_dir)
    from common.design_rules import apply_rules
    apply_rules(board, pcbnew)

    # Parse SES
    with open(ses_path) as f:
        ses = parse_sexp(f.read())

    # Get resolution (units per mm or um)
    resolution_node = find_node(ses, 'resolution')
    if not resolution_node:
        # Check inside routes
        routes = find_node(ses, 'routes')
        if routes:
            resolution_node = find_node(routes, 'resolution')

    res_unit = 'um'
    res_value = 10
    if resolution_node and len(resolution_node) >= 3:
        res_unit = resolution_node[1]
        res_value = resolution_node[2]

    def ses_to_mm(val):
        """Convert SES coordinate to mm."""
        if res_unit == 'um':
            return val / (res_value * 1000.0)
        elif res_unit == 'mil':
            return val * 0.0254 / res_value
        else:  # mm
            return val / res_value

    # Build net name → net code lookup
    net_by_name = {}
    for net in board.GetNetInfo().NetsByName():
        net_by_name[str(net)] = board.GetNetInfo().GetNetItem(str(net))

    # Map layer names
    layer_map = {}
    for i in range(64):
        name = board.GetLayerName(i)
        if name:
            layer_map[name] = i

    # Build pad position index per net for endpoint snapping.
    # FreeRouting's SES coordinates can be up to ~10µm off from KiCad pad centers
    # due to coordinate system round-trip (KiCad nm → SES resolution units → mm → nm).
    # Snapping track endpoints to nearby pads fixes DRC "unconnected" false positives.
    SNAP_TOLERANCE_NM = 10000  # 10 µm — covers precision errors without false snaps
    pad_positions = {}  # net_code -> [(x_nm, y_nm)]
    # Extended pad info for via stitching: net_code -> [(x_nm, y_nm, layer_set, ref, pad_num)]
    pad_info = {}
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            nc = pad.GetNetCode()
            if nc > 0:
                pos = pad.GetPosition()
                pad_positions.setdefault(nc, []).append((pos.x, pos.y))
                layers = pad.GetLayerSet()
                pad_info.setdefault(nc, []).append(
                    (pos.x, pos.y, layers, fp.GetReference(), pad.GetNumber()))

    def snap_to_pad(x_mm, y_mm, net_code):
        """Snap a point to the nearest pad on the same net if within tolerance."""
        pads = pad_positions.get(net_code)
        if not pads:
            return x_mm, y_mm
        x_nm = pcbnew.FromMM(x_mm)
        y_nm = pcbnew.FromMM(y_mm)
        best_dist = SNAP_TOLERANCE_NM + 1
        best_x, best_y = x_nm, y_nm
        for px, py in pads:
            dx = x_nm - px
            dy = y_nm - py
            dist = math.sqrt(dx * dx + dy * dy)
            if dist < best_dist:
                best_dist = dist
                best_x, best_y = px, py
        if best_dist <= SNAP_TOLERANCE_NM:
            return pcbnew.ToMM(best_x), pcbnew.ToMM(best_y)
        return x_mm, y_mm

    snap_count = 0

    # Parse routes section
    routes = find_node(ses, 'routes')
    if not routes:
        print("  ERROR: No routes section in SES")
        sys.exit(1)

    network_out = find_node(routes, 'network_out')
    if not network_out:
        print("  ERROR: No network_out in routes")
        sys.exit(1)

    # Collect layer names actually used in SES wire paths (for via layer mapping)
    layers_used = set()
    for net_node in find_all(network_out, 'net'):
        for wire in find_all(net_node, 'wire'):
            path = find_node(wire, 'path')
            if path and len(path) >= 2:
                layers_used.add(path[1])

    track_count = 0
    via_count = 0
    skipped_nets = set()
    missing_layers = set()

    for net_node in find_all(network_out, 'net'):
        if len(net_node) < 2:
            continue
        net_name = str(net_node[1])  # SES numeric net names parse as int

        # Look up net code
        net_info = net_by_name.get(net_name)
        if net_info is None:
            skipped_nets.add(net_name)
            continue
        net_code = net_info.GetNetCode()

        # Process wires
        for wire in find_all(net_node, 'wire'):
            path = find_node(wire, 'path')
            if not path or len(path) < 4:
                continue

            layer_name = path[1]
            width_ses = path[2]
            width_mm = ses_to_mm(width_ses)

            layer_id = layer_map.get(layer_name)
            if layer_id is None:
                missing_layers.add(layer_name)
                continue

            # Extract coordinate pairs
            coords = path[3:]
            points = []
            i = 0
            while i + 1 < len(coords):
                x = ses_to_mm(coords[i])
                y = -ses_to_mm(coords[i + 1])  # KiCad Y is inverted vs SES
                points.append((x, y))
                i += 2

            # Snap first and last points to nearest pad on same net
            if points:
                orig = points[0]
                points[0] = snap_to_pad(points[0][0], points[0][1], net_code)
                if points[0] != orig:
                    snap_count += 1
            if len(points) > 1:
                orig = points[-1]
                points[-1] = snap_to_pad(points[-1][0], points[-1][1], net_code)
                if points[-1] != orig:
                    snap_count += 1

            # Create track segments between consecutive points
            for j in range(len(points) - 1):
                track = pcbnew.PCB_TRACK(board)
                track.SetStart(pcbnew.VECTOR2I(pcbnew.FromMM(points[j][0]),
                                                pcbnew.FromMM(points[j][1])))
                track.SetEnd(pcbnew.VECTOR2I(pcbnew.FromMM(points[j + 1][0]),
                                              pcbnew.FromMM(points[j + 1][1])))
                track.SetWidth(pcbnew.FromMM(width_mm))
                track.SetLayer(layer_id)
                track.SetNetCode(net_code)
                board.Add(track)
                track_count += 1

        # Process vias
        for via_node in find_all(net_node, 'via'):
            if len(via_node) < 4:
                continue
            via_type = via_node[1]  # e.g. "Via[0-3]_600:300_um"
            via_x_raw = ses_to_mm(via_node[2])
            via_y_raw = -ses_to_mm(via_node[3])
            via_x, via_y = snap_to_pad(via_x_raw, via_y_raw, net_code)
            if (via_x, via_y) != (via_x_raw, via_y_raw):
                snap_count += 1

            # Parse via dimensions from type string
            # Format: Via[start-end]_size:drill_unit
            via_match = re.match(r'Via\[(\d+)-(\d+)\]_(\d+):(\d+)_(\w+)', via_type)
            if via_match:
                start_layer = int(via_match.group(1))
                end_layer = int(via_match.group(2))
                size_val = int(via_match.group(3))
                drill_val = int(via_match.group(4))
                unit = via_match.group(5)
                if unit == 'um':
                    via_size_mm = size_val / 1000.0
                    via_drill_mm = drill_val / 1000.0
                else:
                    via_size_mm = size_val * 0.0254  # mil
                    via_drill_mm = drill_val * 0.0254
            else:
                # Default via dimensions
                via_size_mm = 0.6
                via_drill_mm = 0.3
                start_layer = 0
                end_layer = 3

            via = pcbnew.PCB_VIA(board)
            via.SetPosition(pcbnew.VECTOR2I(pcbnew.FromMM(via_x),
                                             pcbnew.FromMM(via_y)))
            via.SetWidth(pcbnew.FromMM(via_size_mm))
            via.SetDrill(pcbnew.FromMM(via_drill_mm))
            via.SetNetCode(net_code)

            # Map SES layer indices to KiCad layer IDs in physical stackup order.
            # SES uses 0=F.Cu, 1=In1.Cu, 2=In2.Cu, ..., N=B.Cu (physical order).
            # KiCad IDs: F.Cu=0, B.Cu=2, In1.Cu=4, In2.Cu=6, ... (B.Cu out of order).
            # Build list in physical order: F.Cu, In1..InN, B.Cu.
            cu_layers = []
            fcu = layer_map.get('F.Cu')
            if fcu is not None:
                cu_layers.append(fcu)
            for i in range(1, 31):
                lid = layer_map.get(f'In{i}.Cu')
                if lid is not None and f'In{i}.Cu' in layers_used:
                    cu_layers.append(lid)
            bcu = layer_map.get('B.Cu')
            if bcu is not None:
                cu_layers.append(bcu)

            if start_layer == 0 and end_layer >= len(cu_layers) - 1:
                via.SetViaType(pcbnew.VIATYPE_THROUGH)
            else:
                via.SetViaType(pcbnew.VIATYPE_BLIND_BURIED)

            via.SetLayerPair(cu_layers[min(start_layer, len(cu_layers) - 1)],
                             cu_layers[min(end_layer, len(cu_layers) - 1)])

            board.Add(via)
            via_count += 1

    # --- Via stitching pass ---
    # FreeRouting occasionally routes a trace to a pad's X,Y on a layer where the
    # pad has no copper, without inserting a via. This pass detects such cases and
    # inserts bridging vias. To avoid false positives from nearby pads of the same
    # net on different layers, we only stitch when the track endpoint is NOT already
    # near a correct-layer pad (i.e., the endpoint is only close to wrong-layer pads).
    stitch_count = 0
    VIA_STITCH_TOLERANCE_NM = 50000  # 50 µm

    # Build set of existing via positions per net to avoid duplicates
    existing_vias = set()  # (net_code, x_nm, y_nm)
    for track in board.GetTracks():
        if isinstance(track, pcbnew.PCB_VIA):
            pos = track.GetPosition()
            existing_vias.add((track.GetNetCode(), pos.x, pos.y))

    # Scan all tracks we just imported
    for track in board.GetTracks():
        if isinstance(track, pcbnew.PCB_VIA):
            continue
        net_code = track.GetNetCode()
        if net_code <= 0:
            continue
        track_layer = track.GetLayer()
        pads = pad_info.get(net_code, [])
        if not pads:
            continue

        # Check both endpoints of the track
        for endpoint in [track.GetStart(), track.GetEnd()]:
            ex, ey = endpoint.x, endpoint.y

            # First pass: check if this endpoint is near ANY correct-layer pad
            near_correct_pad = False
            wrong_layer_candidates = []
            for px, py, player_set, ref, pad_num in pads:
                dx = ex - px
                dy = ey - py
                dist = math.sqrt(dx * dx + dy * dy)
                if dist > VIA_STITCH_TOLERANCE_NM:
                    continue
                if player_set.Contains(track_layer):
                    near_correct_pad = True
                    break
                else:
                    wrong_layer_candidates.append((dist, px, py, player_set, ref, pad_num))

            # Only stitch if endpoint is near a wrong-layer pad but NOT near a correct one
            if near_correct_pad or not wrong_layer_candidates:
                continue

            # Pick closest wrong-layer pad
            wrong_layer_candidates.sort(key=lambda c: c[0])
            dist, px, py, player_set, ref, pad_num = wrong_layer_candidates[0]

            # Skip if we already placed a via here
            if (net_code, px, py) in existing_vias:
                continue

            # Find which copper layer the pad actually has
            target_layer = None
            for lid in [layer_map.get('F.Cu'), layer_map.get('B.Cu')]:
                if lid is not None and player_set.Contains(lid):
                    target_layer = lid
                    break
            if target_layer is None:
                for i in range(1, 31):
                    lid = layer_map.get(f'In{i}.Cu')
                    if lid is not None and player_set.Contains(lid):
                        target_layer = lid
                        break
            if target_layer is None:
                continue

            net_name_str = board.GetNetInfo().GetNetItem(net_code).GetNetname() if board.GetNetInfo().GetNetItem(net_code) else '?'
            track_layer_name = board.GetLayerName(track_layer)
            target_layer_name = board.GetLayerName(target_layer)
            print(f"    Stitch: {net_name_str} — track on {track_layer_name} near {ref} pad {pad_num} (needs {target_layer_name}), dist={dist/1000:.1f}µm")

            # Insert via at pad center
            via = pcbnew.PCB_VIA(board)
            via.SetPosition(pcbnew.VECTOR2I(px, py))
            via.SetWidth(pcbnew.FromMM(0.6))
            via.SetDrill(pcbnew.FromMM(0.3))
            via.SetNetCode(net_code)
            via.SetViaType(pcbnew.VIATYPE_THROUGH)
            via.SetLayerPair(layer_map.get('F.Cu', 0), layer_map.get('B.Cu', 2))
            board.Add(via)

            # Short connecting trace on the target layer if endpoint isn't at pad center
            if dist > 100:  # > 0.1 µm
                bridge = pcbnew.PCB_TRACK(board)
                bridge.SetStart(pcbnew.VECTOR2I(px, py))
                bridge.SetEnd(pcbnew.VECTOR2I(ex, ey))
                bridge.SetLayer(target_layer)
                bridge.SetWidth(track.GetWidth())
                bridge.SetNetCode(net_code)
                board.Add(bridge)

            existing_vias.add((net_code, px, py))
            stitch_count += 1

    # Save — delete stale .kicad_pro first so SaveBoard creates a fresh one
    # with our netclass/design-rule settings. kicad-cli reads netclass data
    # from the .kicad_pro file, not the .kicad_pcb file.
    pro_path = os.path.splitext(output_path)[0] + '.kicad_pro'
    if os.path.exists(pro_path):
        os.remove(pro_path)
    pcbnew.SaveBoard(output_path, board)

    print(f"  Imported: {track_count} tracks, {via_count} vias, {snap_count} endpoints snapped to pads")
    if stitch_count:
        print(f"  Stitched: {stitch_count} vias added for wrong-layer trace endpoints")
    if skipped_nets:
        print(f"  Skipped {len(skipped_nets)} unmatched nets: {', '.join(sorted(skipped_nets)[:5])}")
    if missing_layers:
        print(f"  Missing layers: {', '.join(sorted(missing_layers))}")
    print(f"  Saved to {output_path}")

    return track_count, via_count


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <board.kicad_pcb> <board.ses> [output.kicad_pcb]")
        sys.exit(1)

    board_path = sys.argv[1]
    ses_path = sys.argv[2]
    output_path = sys.argv[3] if len(sys.argv) > 3 else None

    import_ses(board_path, ses_path, output_path)
