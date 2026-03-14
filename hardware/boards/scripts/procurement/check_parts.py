#!/usr/bin/env python3
"""Check parts availability and pricing for Requencer BOM.

Parses .ato schematic files to build BOM, checks JLCPCB stock for SMD parts,
and queries Nexar/Octopart for multi-supplier pricing on THT/manual parts.

Usage:
    python check_parts.py [--boards N] [--skip-jlcpcb] [--skip-nexar] [--json FILE]

Requires: requests (pip install requests)
"""

import argparse
import json
import sys
from pathlib import Path

# Resolve paths relative to this script
SCRIPT_DIR = Path(__file__).resolve().parent
BOARDS_DIR = SCRIPT_DIR.parent.parent  # hardware/boards/
PARTS_DIR = BOARDS_DIR / "parts"
SRC_DIR = BOARDS_DIR / "elec" / "src"
BUILD_DIR = BOARDS_DIR / "build"
DB_CACHE = BUILD_DIR / "jlcpcb-parts.sqlite3"

sys.path.insert(0, str(SCRIPT_DIR.parent))
from procurement.bom_parser import Part, build_bom
from procurement.jlcpcb_stock import StockInfo, check_stock, ensure_db
from procurement.nexar_client import NexarClient, SupplierResult

# ANSI colors
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"


def _status_icon(ok: bool, warn: bool = False) -> str:
    if ok:
        return f"{GREEN}OK{RESET}"
    if warn:
        return f"{YELLOW}WARN{RESET}"
    return f"{RED}FAIL{RESET}"


def _fmt_price(price: float | None, currency: str = "USD") -> str:
    if price is None:
        return "  N/A"
    sym = "$" if currency == "USD" else currency + " "
    return f"{sym}{price:.2f}"


def _fmt_stock(stock: int) -> str:
    if stock < 0:
        return "In stock"
    return f"{stock:,}"


def print_smd_report(
    smd_parts: list[Part],
    stock_info: dict[str, StockInfo],
    issues: list[str],
) -> float:
    """Print SMD parts table. Returns estimated total cost."""
    print(f"\n{BOLD}SMD PARTS (JLCPCB Assembly){RESET}")
    print(
        f"  {'Part':<20} {'MPN':<18} {'Qty':>5}  {'LCSC':<10} "
        f"{'Stock':>8}  {'Library':<9} {'Price/ea':>8}  Status"
    )
    print("  " + "-" * 100)

    total = 0.0
    for part in sorted(smd_parts, key=lambda p: p.name):
        info = stock_info.get(part.lcsc, StockInfo(
            lcsc=part.lcsc, description="", stock=0, price=None,
            library_type="", found=False,
        ))

        ok = info.found and info.stock >= part.quantity
        warn = info.found and 0 < info.stock < part.quantity

        price_str = _fmt_price(info.price)
        if info.price:
            total += info.price * part.quantity

        status = _status_icon(ok, warn)
        if not info.found:
            status = f"{RED}NOT FOUND{RESET}"
        elif info.stock < part.quantity:
            status = f"{YELLOW}LOW ({_fmt_stock(info.stock)}){RESET}"
            issues.append(
                f"{part.name}: Only {_fmt_stock(info.stock)} in stock "
                f"at JLCPCB (need {part.quantity})"
            )

        print(
            f"  {part.name:<20} {part.mpn:<18} {part.quantity:>5}  "
            f"{part.lcsc:<10} {_fmt_stock(info.stock):>8}  "
            f"{info.library_type:<9} {price_str:>8}  {status}"
        )

    return total


def print_tht_report(
    tht_parts: list[Part],
    nexar_results: dict[str, SupplierResult],
    issues: list[str],
) -> float:
    """Print THT/manual parts table. Returns estimated total cost."""
    print(f"\n{BOLD}THT / MANUAL ORDER PARTS{RESET}")

    if not nexar_results:
        # No Nexar data — just list parts with search URLs
        print(
            f"  {'Part':<20} {'MPN':<18} {'Qty':>5}  Note"
        )
        print("  " + "-" * 80)
        for part in sorted(tht_parts, key=lambda p: p.name):
            note = part.note or f"Search: mouser.com, digikey.com"
            print(f"  {part.name:<20} {part.mpn:<18} {part.quantity:>5}  {DIM}{note}{RESET}")
        return 0.0

    print(
        f"  {'Part':<20} {'MPN':<18} {'Qty':>5}  "
        f"{'Best Source':<18} {'Price/ea':>8}  {'Stock':>10}  URL"
    )
    print("  " + "-" * 110)

    total = 0.0
    for part in sorted(tht_parts, key=lambda p: p.name):
        result = nexar_results.get(part.mpn)
        if not result or not result.offers:
            note = part.note or "No supplier data"
            print(
                f"  {part.name:<20} {part.mpn:<18} {part.quantity:>5}  "
                f"{DIM}{note}{RESET}"
            )
            if not part.note:
                issues.append(f"{part.name} ({part.mpn}): No supplier found via Nexar")
            continue

        best = result.offers[0]
        price_str = _fmt_price(best.unit_price, best.currency)
        if best.unit_price:
            total += best.unit_price * part.quantity

        stock_str = _fmt_stock(best.stock) if best.stock else "Check"
        url = best.buy_url[:60] if best.buy_url else ""

        print(
            f"  {part.name:<20} {part.mpn:<18} {part.quantity:>5}  "
            f"{best.seller:<18} {price_str:>8}  {stock_str:>10}  {DIM}{url}{RESET}"
        )

        if best.stock == 0:
            issues.append(
                f"{part.name} ({part.mpn}): Out of stock at {best.seller}"
            )

    return total


def print_manual_report(manual_parts: list[Part], issues: list[str]):
    """Print parts that need manual sourcing."""
    if not manual_parts:
        return

    print(f"\n{BOLD}MANUAL SOURCE PARTS{RESET}")
    for part in manual_parts:
        note = part.note or "No standard distributor"
        print(f"  {YELLOW}!{RESET} {part.name} ({part.mpn}) x{part.quantity}: {note}")
        issues.append(f"{part.name} ({part.mpn}): {note}")


def print_issues(issues: list[str]):
    """Print issues summary."""
    if not issues:
        print(f"\n{GREEN}{BOLD}No issues found!{RESET}")
        return

    print(f"\n{BOLD}ISSUES ({len(issues)}){RESET}")
    for issue in issues:
        print(f"  {YELLOW}-{RESET} {issue}")


def write_json_report(
    bom: list[Part],
    stock_info: dict[str, StockInfo],
    nexar_results: dict[str, SupplierResult],
    output_path: Path,
):
    """Write machine-readable JSON report."""
    report = {
        "parts": [],
        "generated_by": "check_parts.py",
    }

    for part in bom:
        entry = {
            "name": part.name,
            "mpn": part.mpn,
            "manufacturer": part.manufacturer,
            "lcsc": part.lcsc,
            "quantity": part.quantity,
            "category": part.category,
        }

        if part.lcsc in stock_info:
            s = stock_info[part.lcsc]
            entry["jlcpcb"] = {
                "stock": s.stock,
                "price": s.price,
                "library_type": s.library_type,
                "found": s.found,
            }

        if part.mpn in nexar_results:
            r = nexar_results[part.mpn]
            entry["suppliers"] = [
                {
                    "seller": o.seller,
                    "price": o.unit_price,
                    "currency": o.currency,
                    "stock": o.stock,
                    "moq": o.moq,
                    "url": o.buy_url,
                }
                for o in r.offers[:5]  # Top 5 offers
            ]

        report["parts"].append(entry)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2))
    print(f"\n  JSON report: {output_path}")


def main():
    parser = argparse.ArgumentParser(description="Check Requencer parts availability")
    parser.add_argument(
        "--boards", type=int, default=5,
        help="Number of boards to order (default: 5)",
    )
    parser.add_argument(
        "--skip-jlcpcb", action="store_true",
        help="Skip JLCPCB stock check (offline mode)",
    )
    parser.add_argument(
        "--skip-nexar", action="store_true",
        help="Skip Nexar multi-supplier pricing",
    )
    parser.add_argument(
        "--json", type=str, default=None,
        help="Write JSON report to this path",
    )
    args = parser.parse_args()

    print(f"{BOLD}=== REQUENCER BOM — Parts Check ({args.boards} boards) ==={RESET}")

    # Step 1: Parse BOM
    print(f"\n{BOLD}Parsing .ato files...{RESET}")
    bom = build_bom(PARTS_DIR, SRC_DIR, board_count=args.boards)
    smd_parts = [p for p in bom if p.category == "smd"]
    tht_parts = [p for p in bom if p.category == "tht"]
    manual_parts = [p for p in bom if p.category == "manual"]

    print(f"  Found {len(bom)} unique parts: "
          f"{len(smd_parts)} SMD, {len(tht_parts)} THT, {len(manual_parts)} manual")

    issues: list[str] = []

    # Step 2: JLCPCB stock check
    stock_info: dict[str, StockInfo] = {}
    if not args.skip_jlcpcb:
        print(f"\n{BOLD}Checking JLCPCB stock...{RESET}")
        try:
            db_path = ensure_db(DB_CACHE)
            lcsc_numbers = [p.lcsc for p in smd_parts if p.lcsc not in ("", "C0000", "TBD")]
            # Also check THT parts that have LCSC numbers
            lcsc_numbers += [p.lcsc for p in tht_parts if p.lcsc not in ("", "C0000", "TBD")]
            stock_info = check_stock(db_path, lcsc_numbers)
            print(f"  Checked {len(stock_info)} parts")
        except Exception as e:
            print(f"  {RED}JLCPCB stock check failed: {e}{RESET}")
            print("  Use --skip-jlcpcb to skip this step")

    # Step 3: Nexar multi-supplier pricing
    nexar_results: dict[str, SupplierResult] = {}
    nexar = NexarClient()
    if not args.skip_nexar and nexar.available:
        print(f"\n{BOLD}Querying Nexar/Octopart for supplier pricing...{RESET}")
        try:
            search_parts = [(p.mpn, p.quantity) for p in tht_parts]
            nexar_results = nexar.search_batch(search_parts)
            print(f"  Got pricing for {len(nexar_results)} parts")
        except Exception as e:
            print(f"  {RED}Nexar query failed: {e}{RESET}")
    elif not args.skip_nexar and not nexar.available:
        print(f"\n{DIM}Nexar API not configured — skipping multi-supplier pricing.{RESET}")
        print(f"{DIM}  Set NEXAR_CLIENT_ID + NEXAR_CLIENT_SECRET env vars,{RESET}")
        print(f"{DIM}  or create ~/.config/requencer/nexar.json{RESET}")
        print(f"{DIM}  Register at https://nexar.com/api (free tier: 1000 parts/month){RESET}")

    # Step 4: Print reports
    smd_total = 0.0
    tht_total = 0.0
    if smd_parts:
        smd_total = print_smd_report(smd_parts, stock_info, issues)
    if tht_parts:
        tht_total = print_tht_report(tht_parts, nexar_results, issues)
    if manual_parts:
        print_manual_report(manual_parts, issues)

    print_issues(issues)

    # Cost summary
    print(f"\n{BOLD}ESTIMATED COST ({args.boards} boards){RESET}")
    if smd_total:
        print(f"  JLCPCB SMD parts:     ${smd_total:>8.2f}")
    if tht_total:
        print(f"  THT manual-order:     ${tht_total:>8.2f}")
    grand = smd_total + tht_total
    if grand:
        print(f"  {'─' * 30}")
        print(f"  Total parts cost:     ${grand:>8.2f}")
    print(f"\n{DIM}  Note: Excludes PCB fabrication, assembly fees, shipping, and passives "
          f"(auto-picked by Atopile).{RESET}")

    # Step 5: JSON report
    json_path = Path(args.json) if args.json else BUILD_DIR / "parts-report.json"
    write_json_report(bom, stock_info, nexar_results, json_path)

    # Exit code: 1 if any issues
    sys.exit(1 if issues else 0)


if __name__ == "__main__":
    main()
