#!/usr/bin/env python3
"""Autoroute a KiCad PCB using FreeRouting (headless).

Pure Python replacement for autoroute.sh. Same 6-step workflow:
  1. Load board, fix REF** designators, apply design rules, export DSN
  2. Check SES cache by DSN hash → run FreeRouting if miss
  3. Import routed SES back into KiCad PCB (via import_ses)
  4. Check unrouted nets (DSN vs SES comparison)
  5. Cleanup dangling tracks/vias
  6. Run DRC via kicad-cli subprocess

Usage:
    python autoroute.py <input.kicad_pcb> [output.kicad_pcb]

Requires: KiCad 9, Java (brew openjdk), FreeRouting JAR
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BOARDS_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", ".."))
BOARD_CONFIG_PATH = os.path.join(BOARDS_DIR, "board-config.json")
CACHE_DIR = os.path.join(BOARDS_DIR, "build", "route-cache")


def _load_routing_config():
    """Load routing settings from board-config.json with env var overrides."""
    with open(BOARD_CONFIG_PATH) as f:
        config = json.load(f)
    rc = config.get("routing", {})
    return {
        "max_passes": int(os.environ.get("FREEROUTING_MP", rc.get("max_passes", 20))),
        "threads": int(os.environ.get("FREEROUTING_MT", rc.get("threads", 1))),
        "oit": int(os.environ.get("FREEROUTING_OIT", rc.get("optimization_improvement_threshold", 1))),
        "timeout": int(os.environ.get("FREEROUTING_TIMEOUT", rc.get("timeout", 3600))),
        "java_opts": os.environ.get("FREEROUTING_JAVA_OPTS", rc.get("java_opts", "-Xmx512m")),
        "headless": os.environ.get("FREEROUTING_HEADLESS", str(rc.get("headless", True))).lower() == "true",
        "ses_min_size": rc.get("ses_min_size_bytes", 50000),
    }


def _find_freerouting_jar(headless):
    """Find the FreeRouting JAR file.

    Auto-select: v1.9.0 for GUI mode (working optimizer, default),
    v2.0.1 for headless (only version with --gui.enabled=false).
    v2.1.0: DO NOT UPGRADE — routing regressions (#461, #513).
    """
    custom = os.environ.get("FREEROUTING_JAR")
    if custom:
        return custom

    tools_dir = os.path.join(BOARDS_DIR, "tools")
    if headless:
        headless_jar = os.path.join(tools_dir, "freerouting-2.0.1.jar")
        if os.path.isfile(headless_jar):
            return headless_jar
    gui_jar = os.path.join(tools_dir, "freerouting-1.9.0.jar")
    if os.path.isfile(gui_jar):
        return gui_jar
    # Fallback: any versioned jar
    import glob
    jars = sorted(glob.glob(os.path.join(tools_dir, "freerouting-*.jar")))
    if jars:
        return jars[-1]
    print(f"ERROR: No FreeRouting JAR found in {tools_dir}")
    sys.exit(1)


def _find_java():
    """Find Java binary."""
    return os.environ.get("JAVA", "/opt/homebrew/opt/openjdk/bin/java")


def _verify_tools(java, jar, kicad_cli):
    """Verify required tools exist."""
    for tool in [java, kicad_cli]:
        if not (shutil.which(tool) or os.path.isfile(tool)):
            print(f"ERROR: Missing tool: {tool}")
            sys.exit(1)
    if not os.path.isfile(jar):
        print(f"ERROR: Missing FreeRouting JAR: {jar}")
        sys.exit(1)


def step1_export_dsn(input_pcb, work_dir):
    """Load board, fix refs, apply design rules, export DSN.

    Returns (dsn_path, patched_pcb_path).
    """
    # Add parent dir to path for design_rules import
    sys.path.insert(0, os.path.join(SCRIPT_DIR, ".."))
    from common.design_rules import apply_rules

    import pcbnew

    board = pcbnew.LoadBoard(os.path.abspath(input_pcb))
    print(f"  Loaded: {len(board.GetFootprints())} footprints, {board.GetNetCount()} nets")

    # Fix unassigned reference designators (atopile leaves some as REF**)
    existing_refs = set()
    unassigned = []
    for fp in board.GetFootprints():
        ref = fp.GetReference()
        if ref == 'REF**' or ref.startswith('REF*'):
            unassigned.append(fp)
        else:
            existing_refs.add(ref)

    if unassigned:
        print(f"  Fixing {len(unassigned)} unassigned reference designators...")
        for i, fp in enumerate(unassigned):
            new_ref = f"X{i+1}"
            while new_ref in existing_refs:
                new_ref = f"X{i+1000}"
                i += 1000
            fp.SetReference(new_ref)
            existing_refs.add(new_ref)

    apply_rules(board, pcbnew)

    # Save patched board for SES import later
    patched_path = os.path.join(work_dir, "board_patched.kicad_pcb")
    pcbnew.SaveBoard(patched_path, board)
    print(f"  Patched board saved: {os.path.getsize(patched_path)} bytes")

    # Export DSN
    dsn_path = os.path.join(work_dir, "board.dsn")
    ok = pcbnew.ExportSpecctraDSN(board, dsn_path)
    if not ok:
        print("  ERROR: DSN export failed!")
        sys.exit(1)

    # Strip non-ASCII characters (e.g. Ω in resistor values) to avoid
    # FreeRouting GUI warning popups that require manual dismissal
    with open(dsn_path, "r", encoding="utf-8") as f:
        dsn_content = f.read()
    cleaned = dsn_content.encode("ascii", errors="ignore").decode("ascii")
    if len(cleaned) != len(dsn_content):
        with open(dsn_path, "w", encoding="ascii") as f:
            f.write(cleaned)
        print(f"  Stripped non-ASCII characters from DSN")

    print(f"  DSN exported: {os.path.getsize(dsn_path)} bytes")
    return dsn_path, patched_path


def step2_run_freerouting(dsn_path, work_dir, routing_cfg):
    """Run FreeRouting, using SES cache when possible.

    Returns path to SES file.
    """
    ses_path = os.path.join(work_dir, "board.ses")

    # Check DSN cache
    with open(dsn_path, "rb") as f:
        dsn_hash = hashlib.sha256(f.read()).hexdigest()
    cached_ses = os.path.join(CACHE_DIR, f"{dsn_hash}.ses")

    if os.path.isfile(cached_ses):
        print(f"  Cache HIT: reusing SES from previous run (hash: {dsn_hash[:12]}...)")
        shutil.copy2(cached_ses, ses_path)
    else:
        print(f"  Cache MISS: will run FreeRouting (hash: {dsn_hash[:12]}...)")

        # Write freerouting.json settings file
        # Override stale freerouting.json in $TMPDIR to ensure our CLI settings take effect.
        tmpdir = os.environ.get("TMPDIR", "/tmp")
        fr_settings = os.path.join(tmpdir, "freerouting.json")
        settings = {
            "max_passes": routing_cfg["max_passes"],
            "num_threads": routing_cfg["threads"],
            "board_update_strategy": "GREEDY",
            "item_selection_strategy": "PRIORITIZED",
            "optimization_improvement_threshold": float(routing_cfg["oit"]),
            "disable_analytics": True,
            "dialog_confirmation_timeout": 0,
        }
        with open(fr_settings, "w") as f:
            json.dump(settings, f)
        print(f"  Wrote freerouting.json: max_passes={routing_cfg['max_passes']}, "
              f"oit={routing_cfg['oit']}, threads={routing_cfg['threads']}")

        # Verify settings file
        with open(fr_settings) as f:
            check = json.load(f)
        if check["max_passes"] != routing_cfg["max_passes"]:
            print(f"  ERROR: freerouting.json verification failed")
            sys.exit(1)

        java = _find_java()
        jar = _find_freerouting_jar(routing_cfg["headless"])
        java_opts = routing_cfg["java_opts"].split()

        if routing_cfg["headless"]:
            print(f"Step 2: Running Freerouting headless (max_passes={routing_cfg['max_passes']}, "
                  f"timeout={routing_cfg['timeout']}s, java={routing_cfg['java_opts']})...")
            cmd = [
                java, *java_opts, "-Duser.language=en", "-jar", jar,
                "--gui.enabled=false",
                "-de", dsn_path,
                "-do", ses_path,
                "-dr", os.path.join(work_dir, "board.rules"),
                f"--router.max_passes={routing_cfg['max_passes']}",
                "-dct", "0",
            ]
        else:
            print(f"Step 2: Running Freerouting GUI (max_passes={routing_cfg['max_passes']}, "
                  f"threads={routing_cfg['threads']}, oit={routing_cfg['oit']}, "
                  f"timeout={routing_cfg['timeout']}s, java={routing_cfg['java_opts']})...")
            cmd = [
                java, *java_opts, "-Duser.language=en", "-jar", jar,
                "-de", dsn_path,
                "-do", ses_path,
                "-dr", os.path.join(work_dir, "board.rules"),
                "-mp", str(routing_cfg["max_passes"]),
                "-mt", str(routing_cfg["threads"]),
                "-oit", str(routing_cfg["oit"]),
                "-dct", "0",
            ]

        try:
            subprocess.run(
                cmd, timeout=routing_cfg["timeout"] + 30,
                check=False, capture_output=False,
            )
        except subprocess.TimeoutExpired:
            print(f"WARNING: Freerouting timed out after {routing_cfg['timeout']}s "
                  f"— using partial result if available")

        # Check if FreeRouting rewrote settings
        try:
            with open(fr_settings) as f:
                after = json.load(f)
            if after.get("max_passes") != routing_cfg["max_passes"]:
                print(f"  WARNING: FreeRouting rewrote freerouting.json on exit "
                      f"(max_passes={after.get('max_passes')})")
        except (json.JSONDecodeError, FileNotFoundError):
            pass

    if not os.path.isfile(ses_path):
        print("ERROR: Freerouting did not produce a .ses file")
        sys.exit(1)

    ses_size = os.path.getsize(ses_path)
    print(f"  SES produced: {ses_size} bytes")

    if ses_size < routing_cfg["ses_min_size"]:
        print(f"ERROR: SES file too small ({ses_size} bytes) — "
              f"Freerouting likely failed or exited early")
        print("  Expected ~100KB+ for a routed board. Check Freerouting output above.")
        sys.exit(1)

    # Cache the SES
    os.makedirs(CACHE_DIR, exist_ok=True)
    shutil.copy2(ses_path, cached_ses)
    print(f"  SES cached: {dsn_hash[:12]}...")

    return ses_path


def step3_import_ses(patched_pcb, ses_path, output_pcb):
    """Import routed SES back into KiCad PCB.

    Uses import_ses module directly instead of subprocess.
    """
    print("Step 3: Importing routed SES...")
    sys.path.insert(0, os.path.join(SCRIPT_DIR, ".."))
    from routing.import_ses import import_ses
    try:
        import_ses(patched_pcb, ses_path, output_pcb)
    except Exception as e:
        # import_ses may fail due to KiCad's stdpbase.cpp assert (#14339)
        # — check output file exists instead of relying on exit code
        print(f"  WARNING: import_ses raised: {e}")

    if not os.path.isfile(output_pcb):
        print("ERROR: SES import failed — output PCB not created")
        sys.exit(1)


def step4_check_unrouted(work_dir):
    """Check for unrouted nets (DSN vs SES net names)."""
    print("Step 4: Checking for unrouted nets...")
    dsn_path = os.path.join(work_dir, "board.dsn")
    ses_path = os.path.join(work_dir, "board.ses")

    with open(dsn_path) as f:
        dsn = f.read()
    with open(ses_path) as f:
        ses = f.read()

    # Match both quoted and unquoted net names in DSN
    dsn_all = re.findall(r'\(net\s+(?:"([^"]+)"|(\S+))\s*\(pins\s+([^)]+)\)', dsn)
    dsn_nets = {}
    for q, u, pins in dsn_all:
        name = q or u
        pin_count = len(pins.strip().split())
        dsn_nets[name] = pin_count

    routable = {n for n, p in dsn_nets.items() if p >= 2}

    # Match net names in SES
    ses_nets = set()
    for q, u in re.findall(r'\(net\s+(?:"([^"]+)"|(\S+))', ses):
        n = q or u
        if n:
            ses_nets.add(n)

    unrouted = sorted(routable - ses_nets)
    print(f"  {len(routable)} routable DSN nets, {len(ses_nets)} SES nets")

    if unrouted:
        print(f"  {len(unrouted)} unrouted:")
        for n in unrouted:
            print(f"    - {n} ({dsn_nets[n]} pads)")
        print("  WARNING: Routing is incomplete — DRC (Step 6) will report these as unconnected.")
        return False
    else:
        print("  All nets routed")
        return True


def step5_cleanup_dangling(output_pcb):
    """Remove dangling tracks/vias from FreeRouting optimizer artifacts."""
    print("Step 5: Cleaning up dangling tracks and vias...")
    import pcbnew

    board = pcbnew.LoadBoard(output_pcb)
    conn = board.GetConnectivity()

    tracks = list(board.GetTracks())
    to_remove = []
    for t in tracks:
        is_via = t.GetClass() == "PCB_VIA"
        if is_via:
            if conn.TestTrackEndpointDangling(t, True):
                to_remove.append(t)
        else:
            if (conn.TestTrackEndpointDangling(t, True) and
                    conn.TestTrackEndpointDangling(t, False)):
                to_remove.append(t)

    if to_remove:
        for t in to_remove:
            board.Remove(t)
        pcbnew.SaveBoard(output_pcb, board)

    print(f"  Removed {len(to_remove)} orphaned items "
          f"({len(tracks)} -> {len(tracks) - len(to_remove)} tracks+vias)")


def _load_expected_drc_errors(board_type):
    """Load expected DRC errors for a board from board-config.json."""
    try:
        with open(BOARD_CONFIG_PATH) as f:
            cfg = json.load(f)
        return cfg.get("drc", {}).get(board_type, {}).get("expected_errors", [])
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def _is_expected_error(violation, expected_errors):
    """Check if a DRC violation matches any expected error pattern."""
    desc = violation.get("description", "")
    items = violation.get("items", [])
    component_refs = set()
    for item in items:
        item_desc = item.get("description", "")
        # Extract component reference: "PTH pad 2 [cs] of X54" -> "X54"
        match = re.search(r'\bof\s+(\S+)\s*$', item_desc)
        if match:
            component_refs.add(match.group(1))

    for expected in expected_errors:
        pattern = expected.get("description", "")
        component = expected.get("component", "")
        if pattern and pattern in desc:
            if not component or component in component_refs:
                return True
    return False


def step6_run_drc(output_pcb, work_dir, board_type="control"):
    """Run DRC — fail on unexpected errors or unconnected items."""
    print("Step 6: Running design rule check...")

    from common.kicad_env import get_kicad_cli
    kicad_cli = get_kicad_cli()

    drc_report = os.path.join(work_dir, "drc-report.json")
    subprocess.run(
        [kicad_cli, "pcb", "drc",
         "--output", drc_report,
         "--format", "json",
         "--severity-all",
         output_pcb],
        check=False, capture_output=True,
    )

    if not os.path.isfile(drc_report):
        print("  ERROR: DRC report not generated — cannot verify board")
        sys.exit(1)

    # Copy report next to output for inspection
    drc_dest = os.path.splitext(output_pcb)[0] + "-drc.json"
    shutil.copy2(drc_report, drc_dest)

    # Parse DRC results
    with open(drc_report) as f:
        report = json.load(f)

    violations = report.get("violations", [])
    unconnected = report.get("unconnected_items", [])
    errors = [v for v in violations if v.get("severity", "") == "error"]
    warnings = [v for v in violations if v.get("severity", "") == "warning"]

    # Split errors into expected vs unexpected
    expected_patterns = _load_expected_drc_errors(board_type)
    expected_errors = [e for e in errors if _is_expected_error(e, expected_patterns)]
    unexpected_errors = [e for e in errors if not _is_expected_error(e, expected_patterns)]

    print(f"  {len(errors)} errors ({len(expected_errors)} expected, {len(unexpected_errors)} unexpected), "
          f"{len(warnings)} warnings, {len(unconnected)} unconnected")

    if expected_errors:
        seen = {}
        for v in expected_errors:
            desc = v.get("description", v.get("type", "unknown"))
            seen[desc] = seen.get(desc, 0) + 1
        for desc, count in sorted(seen.items(), key=lambda x: -x[1]):
            print(f"  - [expected] {desc} (x{count})")

    if unexpected_errors:
        seen = {}
        for v in unexpected_errors:
            desc = v.get("description", v.get("type", "unknown"))
            seen[desc] = seen.get(desc, 0) + 1
        for desc, count in sorted(seen.items(), key=lambda x: -x[1]):
            print(f"  - [UNEXPECTED] {desc} (x{count})")

    if unconnected:
        nets = {}
        for item in unconnected:
            for pad in item.get("items", []):
                d = pad.get("description", "")
                if "[" in d and "]" in d:
                    net = d.split("[")[1].split("]")[0]
                    nets[net] = nets.get(net, 0) + 1
                    break
        top_nets = sorted(nets.items(), key=lambda x: -x[1])[:10]
        print(f"  Unconnected nets (top {min(10, len(top_nets))}):")
        for net, count in top_nets:
            print(f"    - {net} ({count} items)")
        if len(nets) > 10:
            print(f"    ... and {len(nets) - 10} more nets")

    # STRICT: fail on unexpected errors or any unconnected items
    if unexpected_errors or unconnected:
        print(f"  FAIL: DRC check failed. Review: {drc_dest}")
        sys.exit(1)

    print("  PASS: DRC clean" if not expected_errors else "  PASS: DRC clean (expected errors only)")


def _detect_board_type(pcb_path):
    """Detect board type from PCB filename (e.g. 'control-placed.kicad_pcb' -> 'control')."""
    basename = os.path.basename(pcb_path).lower()
    for board_type in ("control", "main"):
        if board_type in basename:
            return board_type
    return "unknown"


def autoroute(input_pcb, output_pcb=None):
    """Run the full autorouting pipeline."""
    if output_pcb is None:
        output_pcb = input_pcb

    board_type = _detect_board_type(input_pcb)

    # Ensure scripts parent is on path for imports
    scripts_dir = os.path.normpath(os.path.join(SCRIPT_DIR, ".."))
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)

    # Set up KiCad environment
    from common.kicad_env import setup_kicad_env, get_kicad_cli
    setup_kicad_env()

    routing_cfg = _load_routing_config()
    java = _find_java()
    jar = _find_freerouting_jar(routing_cfg["headless"])
    kicad_cli = get_kicad_cli()
    _verify_tools(java, jar, kicad_cli)

    print(f"=== Autorouting {input_pcb} ===")

    with tempfile.TemporaryDirectory() as work_dir:
        # Step 1: Export DSN
        print("Step 1: Exporting DSN...")
        dsn_path, patched_pcb = step1_export_dsn(input_pcb, work_dir)

        # Step 2: Run FreeRouting (or use cache)
        ses_path = step2_run_freerouting(dsn_path, work_dir, routing_cfg)

        # Step 3: Import SES
        step3_import_ses(patched_pcb, ses_path, output_pcb)

        # Step 4: Check unrouted nets
        step4_check_unrouted(work_dir)

        # Step 5: Cleanup dangling tracks
        step5_cleanup_dangling(output_pcb)

        # Step 6: DRC
        step6_run_drc(output_pcb, work_dir, board_type)

    print(f"=== Autorouting complete: {output_pcb} ===")


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <input.kicad_pcb> [output.kicad_pcb]")
        sys.exit(1)

    input_pcb = sys.argv[1]
    output_pcb = sys.argv[2] if len(sys.argv) > 2 else None
    autoroute(input_pcb, output_pcb)


if __name__ == "__main__":
    main()
