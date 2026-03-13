#!/usr/bin/env python3
"""Score routed variants and select the best one.

Reads {variant}-result.json files produced by autoroute.py, ranks passing
variants by weighted score, and copies the winner to {board}-placed.kicad_pcb
and {board}-routed.kicad_pcb.

Usage:
    python select_best.py --board control --build-dir boards/build
"""

import argparse
import json
import os
import shutil
import sys


def load_results(build_dir, board, variants):
    """Load result JSON files for all variants.

    Returns list of (variant_name, result_dict) tuples.
    Missing result files are treated as failures.
    """
    results = []
    for variant in variants:
        result_path = os.path.join(build_dir, f"{board}-{variant}-result.json")
        if not os.path.exists(result_path):
            results.append((variant, {
                "status": "fail",
                "reason": f"Result file not found: {result_path}",
            }))
            continue
        with open(result_path) as f:
            data = json.load(f)
        results.append((variant, data))
    return results


def score_variant(result, weights):
    """Compute weighted score for a passing variant. Lower is better."""
    via_count = result.get("via_count", 0)
    trace_length = result.get("trace_length_mm", 0.0)
    warnings = result.get("drc_warnings", 0)

    return (via_count * weights.get("via_count", 1.0) +
            trace_length * weights.get("trace_length_mm", 0.1) +
            warnings * weights.get("drc_warnings", 0.5))


def select_best(build_dir, board, variants, weights=None):
    """Score variants and copy the winner.

    Returns (winner_name, score) or None if all failed.
    """
    if weights is None:
        weights = {"via_count": 1.0, "trace_length_mm": 0.1,
                    "drc_warnings": 0.5}

    results = load_results(build_dir, board, variants)

    # Partition into pass/fail
    passing = []
    failing = []
    for variant, result in results:
        status = result.get("status", "fail")
        unconnected = result.get("unconnected_count", 0)

        if status == "fail" or unconnected > 0:
            reason = result.get("reason", "unknown")
            if unconnected > 0:
                reason = f"{unconnected} unconnected nets"
            failing.append((variant, reason))
            continue

        score = score_variant(result, weights)
        passing.append((variant, result, score))

    # Report
    print(f"\n{'='*60}")
    print(f"  Variant selection: {board}")
    print(f"{'='*60}")

    if failing:
        print(f"\n  FAILED ({len(failing)}):")
        for variant, reason in failing:
            print(f"    {variant}: {reason}")

    if not passing:
        print(f"\n  ALL VARIANTS FAILED — no valid routing for {board}")
        print(f"  Check build artifacts in {build_dir}/ for inspection")
        return None

    # Rank by score (lower is better)
    passing.sort(key=lambda x: x[2])

    print(f"\n  PASSING ({len(passing)}):")
    for i, (variant, result, score) in enumerate(passing):
        marker = " <-- WINNER" if i == 0 else ""
        vias = result.get("via_count", "?")
        trace = result.get("trace_length_mm", "?")
        warns = result.get("drc_warnings", 0)
        print(f"    {variant}: score={score:.1f} "
              f"(vias={vias}, trace={trace}mm, warnings={warns}){marker}")

    # Copy winner
    winner_name, winner_result, winner_score = passing[0]

    placed_src = os.path.join(build_dir, f"{board}-{winner_name}.kicad_pcb")
    routed_src = os.path.join(build_dir,
                               f"{board}-{winner_name}-routed.kicad_pcb")
    placed_dst = os.path.join(build_dir, f"{board}-placed.kicad_pcb")
    routed_dst = os.path.join(build_dir, f"{board}-routed.kicad_pcb")

    if os.path.exists(placed_src):
        shutil.copy2(placed_src, placed_dst)
        print(f"\n  Placed:  {placed_dst}")
    else:
        print(f"\n  WARNING: placed PCB not found: {placed_src}")

    if os.path.exists(routed_src):
        shutil.copy2(routed_src, routed_dst)
        print(f"  Routed:  {routed_dst}")
    else:
        print(f"  WARNING: routed PCB not found: {routed_src}")

    print(f"{'='*60}\n")
    return winner_name, winner_score


def main():
    parser = argparse.ArgumentParser(
        description="Score routed variants and select the best one.",
    )
    parser.add_argument("--board", required=True,
                        choices=["control", "main"],
                        help="Board name")
    parser.add_argument("--build-dir", required=True,
                        help="Build directory containing variant files")
    parser.add_argument("--config", default=None,
                        help="Path to board-config.json")
    args = parser.parse_args()

    # Load variant list from config
    config_path = args.config
    if config_path is None:
        config_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "board-config.json",
        )

    with open(config_path) as f:
        config = json.load(f)

    # Per-board variants override, falling back to top-level
    board_cfg = config.get("boards", {}).get(args.board, {})
    placement_cfg = board_cfg.get("placement", {})
    variants_cfg = placement_cfg.get("variants",
                                      config.get("placement", {}).get(
                                          "variants", []))

    if not variants_cfg:
        print("No variants configured. Nothing to select.")
        sys.exit(1)

    variant_names = [v["name"] for v in variants_cfg]
    weights = config.get("placement", {}).get("score_weights",
                                               {"via_count": 1.0,
                                                "trace_length_mm": 0.1,
                                                "drc_warnings": 0.5})

    result = select_best(args.build_dir, args.board, variant_names, weights)
    if result is None:
        sys.exit(1)


if __name__ == "__main__":
    main()
