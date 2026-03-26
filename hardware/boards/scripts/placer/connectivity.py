"""Net graph, wave distances, circuit detection, and cluster building.

Pure graph algorithms — no external dependencies beyond types.
"""

from __future__ import annotations

from collections import defaultdict

from .dtypes import Board, Cluster, Component, Net


def build_net_graph(board: Board,
                    use_rotation_nets: bool = False) -> dict[str, list[str]]:
    """Build net_name → list of component IDs mapping from Board.nets.

    Only includes nets connecting 2+ components.
    When use_rotation_nets=True, uses Board.rotation_nets (includes power)
    for rotation scoring where pad orientation matters even for power.
    """
    nets = board.rotation_nets if (use_rotation_nets and board.rotation_nets) else board.nets
    net_to_ids: dict[str, set[str]] = defaultdict(set)
    for net in nets:
        for comp_id, _pin_id in net.connections:
            net_to_ids[net.id].add(comp_id)

    return {net_id: sorted(ids) for net_id, ids in net_to_ids.items()
            if len(ids) >= 2}


def build_adjacency(net_graph: dict[str, list[str]],
                    addrs: set[str] | None = None
                    ) -> dict[str, dict[str, int]]:
    """Build adjacency graph: addr → {neighbor: shared_net_count}.

    If addrs is provided, only include those addresses.
    """
    graph: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for _net, connected in net_graph.items():
        filtered = [a for a in connected if addrs is None or a in addrs]
        for i in range(len(filtered)):
            for j in range(i + 1, len(filtered)):
                graph[filtered[i]][filtered[j]] += 1
                graph[filtered[j]][filtered[i]] += 1
    return graph


def connectivity_sort(addrs: list[str],
                      net_graph: dict[str, list[str]]) -> list[str]:
    """Order components so electrically-connected ones are adjacent.

    Greedy BFS: start from most-connected node, always visit the
    unvisited neighbor with the strongest connection.
    """
    if not addrs:
        return []

    addr_set = set(addrs)
    graph = build_adjacency(net_graph, addr_set)

    remaining = set(addrs)
    ordered: list[str] = []

    while remaining:
        start = max(
            remaining,
            key=lambda a: (sum(graph[a].get(n, 0) for n in remaining)
                           if a in graph else 0),
        )
        remaining.remove(start)
        ordered.append(start)

        current = start
        while True:
            neighbors = {
                n: w for n, w in graph.get(current, {}).items()
                if n in remaining
            }
            if not neighbors:
                # Try to find any remaining node connected to ordered
                best = None
                best_w = 0
                for r in remaining:
                    for o in ordered:
                        w = graph.get(r, {}).get(o, 0)
                        if w > best_w:
                            best = r
                            best_w = w
                if best and best_w > 0:
                    remaining.remove(best)
                    ordered.append(best)
                    current = best
                    continue
                break
            best_neighbor = max(neighbors, key=neighbors.get)  # type: ignore
            remaining.remove(best_neighbor)
            ordered.append(best_neighbor)
            current = best_neighbor

    return ordered


def build_circuits(net_graph: dict[str, list[str]],
                   all_ids: set[str]) -> list[set[str]]:
    """Compute connected components using union-find.

    Components with no net connections form singleton circuits.
    """
    parent: dict[str, str] = {}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]  # path compression
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for addr in all_ids:
        parent[addr] = addr

    for _net, addrs in net_graph.items():
        if len(addrs) < 2:
            continue
        first = addrs[0]
        for other in addrs[1:]:
            if other in parent:
                union(first, other)

    groups: dict[str, set[str]] = defaultdict(set)
    for addr in all_ids:
        if addr in parent:
            groups[find(addr)].add(addr)

    return list(groups.values())


def compute_wave_distances(net_graph: dict[str, list[str]],
                           fixed_ids: set[str],
                           free_ids: set[str]
                           ) -> tuple[dict[str, int], set[str]]:
    """BFS from fixed components through the net graph.

    Wave 0 = free components sharing a net with a fixed component.
    Returns (wave_map, orphans).
    """
    # Build adjacency
    adj: dict[str, set[str]] = defaultdict(set)
    for _net, addrs in net_graph.items():
        for a in addrs:
            for b in addrs:
                if a != b:
                    adj[a].add(b)

    wave_map: dict[str, int] = {}
    visited = set(fixed_ids)
    frontier = set(fixed_ids)
    wave = 0

    while frontier:
        next_frontier: set[str] = set()
        for addr in frontier:
            for neighbor in adj.get(addr, set()):
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                if neighbor in free_ids:
                    wave_map[neighbor] = wave
                next_frontier.add(neighbor)
        frontier = next_frontier
        wave += 1

    orphans = free_ids - set(wave_map.keys())
    return wave_map, orphans


_PASSIVE_PREFIXES = ("r_", "c_", "l_", "r.", "c.", "l.")


def _is_passive_id(comp_id: str) -> bool:
    """Check if component ID looks like a passive (R, C, L)."""
    parts = comp_id.rsplit(".", 1)
    leaf = parts[-1] if len(parts) > 1 else comp_id
    return any(leaf.lower().startswith(p) for p in _PASSIVE_PREFIXES)


def build_clusters(components: dict[str, Component],
                   net_graph: dict[str, list[str]]) -> list[Cluster]:
    """Build hierarchical clusters from connectivity and address prefixes.

    Algorithm:
    1. Group by address prefix (first dotted segment)
    2. Find anchors: non-passive ICs with most net connections per group
    3. Find satellites: non-passive ICs sharing 2+ nets with anchor
    4. Assign passives to satellites by shared net count
    5. Remaining passives become bypass caps
    """
    from .geometry import classify_pins_by_edge

    # Build per-component net lists
    comp_nets: dict[str, list[str]] = defaultdict(list)
    for net_id, addrs in net_graph.items():
        for addr in addrs:
            if addr in components:
                comp_nets[addr].append(net_id)

    # Build adjacency
    adjacency: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for _net, addrs in net_graph.items():
        group_addrs = [a for a in addrs if a in components]
        for i in range(len(group_addrs)):
            for j in range(i + 1, len(group_addrs)):
                adjacency[group_addrs[i]][group_addrs[j]] += 1
                adjacency[group_addrs[j]][group_addrs[i]] += 1

    # Group by prefix
    groups: dict[str, list[str]] = defaultdict(list)
    for comp_id in components:
        if "." in comp_id:
            prefix = comp_id.split(".")[0]
            groups[prefix].append(comp_id)

    clusters: list[Cluster] = []
    assigned: set[str] = set()

    for _prefix, group_ids in groups.items():
        # Find anchor candidates: non-passive with >4 pins and pins on 3+ edges
        anchor_candidates = []
        for cid in group_ids:
            comp = components[cid]
            if _is_passive_id(cid) or len(comp.pins) <= 4:
                continue
            edge_map = classify_pins_by_edge(comp)
            edges_with_pins = sum(1 for pins in edge_map.values() if pins)
            if edges_with_pins >= 3:
                anchor_candidates.append(cid)

        if not anchor_candidates:
            continue

        anchor_candidates.sort(
            key=lambda a: len(comp_nets.get(a, [])), reverse=True)

        for anchor_id in anchor_candidates:
            if anchor_id in assigned:
                continue

            satellites: dict[str, list[str]] = {}
            for other_id in group_ids:
                if other_id == anchor_id or other_id in assigned:
                    continue
                if _is_passive_id(other_id):
                    continue
                shared = adjacency[anchor_id].get(other_id, 0)
                if shared >= 2:
                    satellites[other_id] = []
                    assigned.add(other_id)

            # Assign passives to satellites
            unassigned: list[str] = []
            for other_id in group_ids:
                if other_id == anchor_id or other_id in assigned:
                    continue
                if not _is_passive_id(other_id):
                    continue
                best_sat = None
                best_count = 0
                for sat_id in satellites:
                    shared = adjacency[other_id].get(sat_id, 0)
                    if shared > best_count:
                        best_sat = sat_id
                        best_count = shared
                if best_sat and best_count > 0:
                    satellites[best_sat].append(other_id)
                    assigned.add(other_id)
                else:
                    unassigned.append(other_id)

            bypass = []
            for cid in unassigned:
                bypass.append(cid)
                assigned.add(cid)

            assigned.add(anchor_id)
            clusters.append(Cluster(
                anchor=anchor_id,
                satellites=satellites,
                bypass=bypass,
            ))

    return clusters


def estimate_hpwl(positions: dict[str, tuple[float, float]],
                  net_graph: dict[str, list[str]]) -> float:
    """Estimate total half-perimeter wirelength.

    positions: component_id → (x, y).
    """
    total = 0.0
    for _net, addrs in net_graph.items():
        xs = []
        ys = []
        for addr in addrs:
            pos = positions.get(addr)
            if pos is not None:
                xs.append(pos[0])
                ys.append(pos[1])
        if len(xs) >= 2:
            total += (max(xs) - min(xs)) + (max(ys) - min(ys))
    return total


def identify_bypass_caps(board: Board,
                         config_map: dict[str, str] | None = None,
                         ) -> dict[str, str]:
    """Identify bypass/decoupling caps and map each to its associated IC.

    If config_map is provided (from board-config.json bypass_caps section),
    uses it directly — only includes caps that exist on the board.

    Otherwise falls back to heuristic detection:
      1. It's a passive with leaf name starting with 'c_'
      2. ALL of its nets (in rotation_nets) are power nets
      3. A non-passive in the same address group shares ≥1 power net

    Returns {bypass_cap_id: associated_ic_id}.
    The IC is chosen by most shared power nets, tiebroken by pin count.
    """
    # Config-based bypass map: use explicit mapping from board-config.json
    if config_map:
        comp_ids = {c.id for c in board.components}
        return {cap: ic for cap, ic in config_map.items()
                if cap in comp_ids and ic in comp_ids
                and not cap.startswith("_")}  # skip _comment keys

    if not board.power_nets:
        return {}

    # Heuristic fallback: detect from netlist
    rot_graph = build_net_graph(board, use_rotation_nets=True)

    # Per-component: which nets it appears on
    comp_nets: dict[str, set[str]] = defaultdict(set)
    for net_id, comp_ids in rot_graph.items():
        for cid in comp_ids:
            comp_nets[cid].add(net_id)

    # Index components by id
    comp_map = {c.id: c for c in board.components}

    # Group by address prefix
    groups: dict[str, list[str]] = defaultdict(list)
    for c in board.components:
        if "." in c.id:
            prefix = c.id.split(".")[0]
            groups[prefix].append(c.id)

    # Compute net fanout (number of components per net) to distinguish
    # real power rails from low-fanout filter/reference nets.
    net_fanout: dict[str, int] = {}
    for net_id, comp_ids in rot_graph.items():
        net_fanout[net_id] = len(comp_ids)

    # GND-like nets (always high fanout, always valid for bypass)
    gnd_nets = {n for n in board.power_nets
                if n.lower() in ("hv", "gnd", "agnd", "dgnd", "pgnd",
                                 "lv", "vss", "avss", "dvss")}

    bypass_map: dict[str, str] = {}

    for cid, comp in comp_map.items():
        # Must be a capacitor passive
        if "." not in cid:
            continue
        leaf = cid.rsplit(".", 1)[1]
        if not leaf.lower().startswith("c_"):
            continue

        # All nets must be power nets
        nets = comp_nets.get(cid, set())
        if not nets:
            continue
        if not nets.issubset(board.power_nets):
            continue

        # Exclude filter caps: if the cap's supply net is low-fanout (≤4)
        # AND also connects to a resistor, it's likely an RC filter output
        # (voltage divider), not a bypass cap. High-fanout supply nets
        # (real power rails like 3.3V) often have resistors for pull-ups
        # — those caps are still bypass caps.
        supply_nets = nets - gnd_nets
        prefix = cid.split(".")[0]
        is_filter = False
        for snet in supply_nets:
            fanout = net_fanout.get(snet, 0)
            if fanout > 4:
                continue  # High-fanout rail — resistors are pull-ups, not filters
            for other_id in rot_graph.get(snet, []):
                if other_id == cid:
                    continue
                other_leaf = other_id.rsplit(".", 1)[1] if "." in other_id else other_id
                if other_leaf.lower().startswith("r_"):
                    is_filter = True
                    break
            if is_filter:
                break
        if is_filter:
            continue

        # Find non-passive ICs in same group sharing power nets.
        # Collect ALL equivalent candidates (same shared count + pin count)
        # to distribute caps evenly across identical ICs.
        prefix = cid.split(".")[0]
        group_ids = groups.get(prefix, [])

        best_shared = 0
        best_pins = 0
        candidates: list[str] = []

        for other_id in group_ids:
            if other_id == cid:
                continue
            if _is_passive_id(other_id):
                continue
            other_nets = comp_nets.get(other_id, set())
            shared = len(nets & other_nets)
            if shared == 0:
                continue
            other_pins = len(comp_map[other_id].pins)
            if (shared > best_shared or
                    (shared == best_shared and other_pins > best_pins)):
                best_shared = shared
                best_pins = other_pins
                candidates = [other_id]
            elif shared == best_shared and other_pins == best_pins:
                candidates.append(other_id)

        if candidates:
            # Prefer IC whose leaf name best matches the cap name.
            # Uses prefix matching: c_op1_n → "op1" matches "opamp1".
            # This handles cases like c_dac1_2 → dac1 (not dac2).
            import re
            cap_leaf = cid.rsplit(".", 1)[1].lstrip("c_")

            def _name_affinity(ic_id: str) -> int:
                """Score how well cap name matches IC name."""
                ic_leaf = ic_id.rsplit(".", 1)[1].lower()
                # Extract alpha prefix + number from cap: c_op1_n → ("op", "1")
                m = re.match(r'([a-z]+)(\d+)', cap_leaf)
                if m:
                    alpha, num = m.group(1), m.group(2)
                    # Check if IC leaf starts with same alpha prefix and
                    # contains the same number
                    if ic_leaf.startswith(alpha) and num in re.findall(r'\d+', ic_leaf):
                        return 100  # "op"+"1" matches "opamp1"
                    # Check if IC leaf contains the number (weaker match)
                    if num in re.findall(r'\d+', ic_leaf):
                        return 10
                # Fallback: shared numbers
                cap_nums = set(re.findall(r'\d+', cap_leaf))
                ic_nums = set(re.findall(r'\d+', ic_leaf))
                return len(cap_nums & ic_nums)

            # Try naming affinity across ALL ICs with any shared power net
            all_with_shared = []
            for other_id in group_ids:
                if other_id == cid or _is_passive_id(other_id):
                    continue
                other_nets = comp_nets.get(other_id, set())
                if len(nets & other_nets) > 0:
                    all_with_shared.append(other_id)

            if all_with_shared:
                max_affinity = max(_name_affinity(ic) for ic in all_with_shared)
                if max_affinity > 0:
                    candidates = [ic for ic in all_with_shared
                                  if _name_affinity(ic) == max_affinity]

            # Among remaining candidates, distribute round-robin.
            ic_load = {ic: sum(1 for v in bypass_map.values() if v == ic)
                       for ic in candidates}
            best_ic = min(candidates, key=lambda ic: ic_load.get(ic, 0))
            bypass_map[cid] = best_ic

    return bypass_map
