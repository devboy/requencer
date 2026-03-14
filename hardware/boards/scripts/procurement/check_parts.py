#!/usr/bin/env python3
"""Check parts availability and pricing for Requencer BOM.

Parses .ato schematic files to build BOM, checks JLCPCB stock for SMD parts,
and queries TME/DigiKey/Nexar for multi-supplier pricing on THT/manual parts.

Usage:
    python check_parts.py [--boards N] [--skip-jlcpcb] [--suppliers tme,digikey] [--json FILE]

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
from procurement.types import Offer, SupplierResult

# ANSI colors
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
BOLD = "\033[1m"
DIM = "\033[2m"
RESET = "\033[0m"

VALID_SUPPLIERS = {"tme", "digikey", "nexar"}

# Hardcoded pricing for parts not on mainstream distributors.
# These get merged into supplier results so they show up with pricing
# instead of "No supplier data".
MANUAL_PRICING = {
    "PJ398SM": {
        "seller": "Thonk",
        "url": "https://www.thonk.co.uk/shop/thonkiconn/",
        "unit_price": 0.43,  # £0.37 excl VAT
        "currency": "EUR",
        "stock": -1,
    },
    "WQP-PJ366ST": {
        "seller": "Thonk",
        "url": "https://www.thonk.co.uk/shop/thonkiconn/",
        "unit_price": 0.55,  # £0.47 excl VAT
        "currency": "EUR",
        "stock": -1,
    },
    "TC002-N11AS1XT-RGB": {
        "seller": "Mouser",
        "url": "https://www.mouser.com/ProductDetail/Well-Buying/TC002-N11AS1XT-RGB",
        "unit_price": 3.69,  # 100+ tier pricing
        "currency": "EUR",
        "stock": 72,
    },
    "WQP518MA": {
        "seller": "Thonk",
        "url": "https://www.thonk.co.uk/shop/thonkiconn/",
        "unit_price": 0.43,  # £0.37 excl VAT (same as PJ398SM)
        "currency": "EUR",
        "stock": -1,
    },
    "PJS008U-3000-0": {
        "seller": "LCSC",
        "url": "https://www.lcsc.com/product-detail/C3177022.html",
        "unit_price": 1.13,  # $1.23 USD
        "currency": "EUR",
        "stock": -1,
    },
    "PIM722": {
        "seller": "Pimoroni",
        "url": "https://shop.pimoroni.com/products/pga2350",
        "unit_price": 10.50,  # £9.00
        "currency": "EUR",
        "stock": -1,
    },
    "JC3248A035N-1": {
        "seller": "AliExpress",
        "url": "",
        "unit_price": 15.00,  # ~€11-15 depending on seller
        "currency": "EUR",
        "stock": -1,
    },
}


def _build_manual_results() -> dict[str, SupplierResult]:
    """Convert MANUAL_PRICING into SupplierResult objects."""
    results = {}
    for mpn, info in MANUAL_PRICING.items():
        results[mpn] = SupplierResult(
            mpn=mpn,
            manufacturer="",
            offers=[Offer(
                seller=info["seller"],
                seller_url=info["url"],
                stock=info["stock"],
                moq=1,
                unit_price=info["unit_price"],
                currency=info["currency"],
                buy_url=info["url"],
            )],
        )
    return results


def _status_icon(ok: bool, warn: bool = False) -> str:
    if ok:
        return f"{GREEN}OK{RESET}"
    if warn:
        return f"{YELLOW}WARN{RESET}"
    return f"{RED}FAIL{RESET}"


def _fmt_price(price: float | None, currency: str = "USD") -> str:
    if price is None:
        return "  N/A"
    sym = {"USD": "$", "EUR": "€"}.get(currency, currency + " ")
    return f"{sym}{price:.2f}"


def _fmt_stock(stock: int) -> str:
    if stock < 0:
        return "In stock"
    return f"{stock:,}"


def _create_client(name: str):
    """Create a supplier client by name. Returns (client, display_name)."""
    if name == "tme":
        from procurement.tme_client import TmeClient
        return TmeClient(), "TME"
    elif name == "digikey":
        from procurement.digikey_client import DigikeyClient
        return DigikeyClient(), "DigiKey"
    elif name == "nexar":
        from procurement.nexar_client import NexarClient
        return NexarClient(), "Nexar"
    else:
        raise ValueError(f"Unknown supplier: {name}")


def _merge_results(
    all_results: list[dict[str, SupplierResult]],
) -> dict[str, SupplierResult]:
    """Merge results from multiple suppliers into a single dict.

    For each MPN, combines all offers from all suppliers, sorted by price.
    """
    merged: dict[str, SupplierResult] = {}

    for results in all_results:
        for mpn, result in results.items():
            if mpn not in merged:
                merged[mpn] = SupplierResult(
                    mpn=mpn,
                    manufacturer=result.manufacturer,
                    offers=list(result.offers),
                    found=result.found,
                )
            else:
                existing = merged[mpn]
                existing.offers.extend(result.offers)
                if not existing.manufacturer and result.manufacturer:
                    existing.manufacturer = result.manufacturer
                if result.found:
                    existing.found = True

    # Sort each MPN's offers by price (cheapest first, None last)
    for result in merged.values():
        result.offers.sort(
            key=lambda o: (o.unit_price is None, o.unit_price or 999999)
        )

    return merged


def query_suppliers(
    supplier_names: list[str],
    parts: list[tuple[str, int]],
) -> dict[str, SupplierResult]:
    """Query multiple suppliers and merge results."""
    all_results: list[dict[str, SupplierResult]] = []

    for name in supplier_names:
        client, display = _create_client(name)

        if not client.available:
            _print_setup_hint(name)
            continue

        print(f"  Querying {display}...")
        try:
            results = client.search_batch(parts)
            found_count = sum(1 for r in results.values() if r.found)
            print(f"    Got pricing for {found_count}/{len(parts)} parts")
            all_results.append(results)
        except Exception as e:
            print(f"    {RED}{display} query failed: {e}{RESET}")

    return _merge_results(all_results)


def _print_setup_hint(name: str):
    """Print setup instructions for a supplier that's not configured."""
    hints = {
        "tme": (
            "TME API not configured — skipping.",
            "Set TME_TOKEN + TME_SECRET env vars,",
            "or create ~/.config/requencer/tme.json",
            "Register at https://developers.tme.eu/en",
        ),
        "digikey": (
            "DigiKey API not configured — skipping.",
            "Set DIGIKEY_CLIENT_ID + DIGIKEY_CLIENT_SECRET env vars,",
            "or create ~/.config/requencer/digikey.json",
            "Register at https://developer.digikey.com/",
        ),
        "nexar": (
            "Nexar API not configured — skipping.",
            "Set NEXAR_CLIENT_ID + NEXAR_CLIENT_SECRET env vars,",
            "or create ~/.config/requencer/nexar.json",
            "Register at https://nexar.com/api (free tier: 1000 parts/month)",
        ),
    }
    lines = hints.get(name, (f"{name} not configured — skipping.",))
    for line in lines:
        print(f"  {DIM}{line}{RESET}")


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
            issues.append(
                f"{part.name} ({part.lcsc}): Not found in JLCPCB DB "
                f"(out of stock or delisted)"
            )
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
    supplier_results: dict[str, SupplierResult],
    issues: list[str],
) -> float:
    """Print THT/manual parts table. Returns estimated total cost."""
    print(f"\n{BOLD}THT / MANUAL ORDER PARTS{RESET}")

    if not supplier_results:
        # No supplier data — just list parts with search URLs
        print(
            f"  {'Part':<20} {'MPN':<18} {'Qty':>5}  Note"
        )
        print("  " + "-" * 80)
        for part in sorted(tht_parts, key=lambda p: p.name):
            note = part.note or f"Search: tme.eu, digikey.de, mouser.com"
            print(f"  {part.name:<20} {part.mpn:<18} {part.quantity:>5}  {DIM}{note}{RESET}")
        return 0.0

    print(
        f"  {'Part':<20} {'MPN':<18} {'Qty':>5}  "
        f"{'Best Source':<18} {'Price/ea':>8}  {'Stock':>10}  URL"
    )
    print("  " + "-" * 110)

    total = 0.0
    for part in sorted(tht_parts, key=lambda p: p.name):
        result = supplier_results.get(part.mpn)
        if not result or not result.offers:
            note = part.note or "No supplier data"
            print(
                f"  {part.name:<20} {part.mpn:<18} {part.quantity:>5}  "
                f"{DIM}{note}{RESET}"
            )
            if not part.note:
                issues.append(f"{part.name} ({part.mpn}): No supplier found")
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


def print_manual_report(
    manual_parts: list[Part],
    supplier_results: dict[str, SupplierResult],
) -> float:
    """Print parts that need manual sourcing. Returns estimated total cost."""
    if not manual_parts:
        return 0.0

    print(f"\n{BOLD}MANUAL SOURCE PARTS{RESET}")
    total = 0.0
    for part in manual_parts:
        result = supplier_results.get(part.mpn)
        if result and result.offers and result.offers[0].unit_price is not None:
            best = result.offers[0]
            price_str = _fmt_price(best.unit_price, best.currency)
            total += best.unit_price * part.quantity
            stock_str = _fmt_stock(best.stock) if best.stock else ""
            print(
                f"  {part.name:<20} {part.mpn:<18} {part.quantity:>5}  "
                f"{best.seller:<18} {price_str:>8}  {stock_str:>10}"
            )
        elif result and result.offers:
            best = result.offers[0]
            print(f"  {part.name:<20} {part.mpn:<18} {part.quantity:>5}  {best.seller:<18} {'TBD':>8}")
        else:
            note = part.note or "No standard distributor"
            print(f"  {YELLOW}!{RESET} {part.name} ({part.mpn}) x{part.quantity}: {note}")
    return total


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
    supplier_results: dict[str, SupplierResult],
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

        if part.mpn in supplier_results:
            r = supplier_results[part.mpn]
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


def parse_suppliers(value: str) -> list[str]:
    """Parse --suppliers flag value into a list of supplier names."""
    if value == "all":
        return sorted(VALID_SUPPLIERS)
    names = [s.strip().lower() for s in value.split(",")]
    invalid = set(names) - VALID_SUPPLIERS
    if invalid:
        raise argparse.ArgumentTypeError(
            f"Unknown supplier(s): {', '.join(invalid)}. "
            f"Valid: {', '.join(sorted(VALID_SUPPLIERS))}, all"
        )
    return names


def main():
    parser = argparse.ArgumentParser(description="Check Requencer parts availability")
    parser.add_argument(
        "--boards", type=int, default=5,
        help="Number of PCBs to order with SMD assembly (default: 5)",
    )
    parser.add_argument(
        "--kits", type=int, default=None,
        help="Number of complete kits to build (THT + manual parts). Defaults to --boards.",
    )
    parser.add_argument(
        "--skip-jlcpcb", action="store_true",
        help="Skip JLCPCB stock check (offline mode)",
    )
    parser.add_argument(
        "--suppliers", type=str, default="tme,digikey",
        help="Comma-separated supplier list: tme, digikey, nexar, all (default: tme,digikey)",
    )
    parser.add_argument(
        "--json", type=str, default=None,
        help="Write JSON report to this path",
    )
    args = parser.parse_args()
    kits = args.kits if args.kits is not None else args.boards

    supplier_names = parse_suppliers(args.suppliers)

    print(f"{BOLD}=== REQUENCER BOM — Parts Check ({args.boards} boards, {kits} kits) ==={RESET}")

    # Step 1: Parse BOM
    # SMD parts use board_count (assembled by JLCPCB on every PCB)
    # THT/manual parts use kit count (only fully assemble some boards)
    print(f"\n{BOLD}Parsing .ato files...{RESET}")
    smd_bom = build_bom(PARTS_DIR, SRC_DIR, board_count=args.boards)
    kit_bom = build_bom(PARTS_DIR, SRC_DIR, board_count=kits)
    smd_parts = [p for p in smd_bom if p.category == "smd"]
    tht_parts = [p for p in kit_bom if p.category == "tht"]
    manual_parts = [p for p in kit_bom if p.category == "manual"]
    bom = smd_parts + tht_parts + manual_parts

    print(f"  Found {len(bom)} unique parts: "
          f"{len(smd_parts)} SMD (×{args.boards}), "
          f"{len(tht_parts)} THT (×{kits}), "
          f"{len(manual_parts)} manual (×{kits})")

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

    # Step 3: Multi-supplier pricing
    supplier_results: dict[str, SupplierResult] = {}
    all_mpns = {p.mpn for p in tht_parts + manual_parts}

    # Inject hardcoded pricing for parts not on mainstream distributors
    manual_results = _build_manual_results()
    for mpn, result in manual_results.items():
        if mpn in all_mpns:
            supplier_results[mpn] = result

    if supplier_names and tht_parts:
        # Only query API for parts that don't have manual pricing
        search_parts = [(p.mpn, p.quantity) for p in tht_parts if p.mpn not in manual_results]
        if search_parts:
            suppliers_str = ", ".join(s.upper() for s in supplier_names)
            print(f"\n{BOLD}Querying suppliers ({suppliers_str}) for THT pricing...{RESET}")
            api_results = query_suppliers(supplier_names, search_parts)
            supplier_results.update(api_results)

    # Step 4: Print reports
    smd_total = 0.0
    tht_total = 0.0
    if smd_parts:
        smd_total = print_smd_report(smd_parts, stock_info, issues)
    if tht_parts:
        tht_total = print_tht_report(tht_parts, supplier_results, issues)
    manual_total = 0.0
    if manual_parts:
        manual_total = print_manual_report(manual_parts, supplier_results)

    print_issues(issues)

    # Cost summary
    print(f"\n{BOLD}ESTIMATED COST ({args.boards} PCBs + {kits} complete kits){RESET}")
    if smd_total:
        print(f"  JLCPCB SMD (×{args.boards}):     ${smd_total:>8.2f}")
    if tht_total:
        print(f"  THT parts (×{kits}):       ${tht_total:>8.2f}")
    if manual_total:
        print(f"  Manual parts (×{kits}):    ${manual_total:>8.2f}")
    grand = smd_total + tht_total + manual_total
    if grand:
        print(f"  {'─' * 30}")
        print(f"  Total parts cost:     ${grand:>8.2f}")
    print(f"\n{DIM}  Note: Excludes PCB fabrication, assembly fees, shipping, and passives "
          f"(auto-picked by Atopile).{RESET}")

    # Step 5: JSON report
    json_path = Path(args.json) if args.json else BUILD_DIR / "parts-report.json"
    write_json_report(bom, stock_info, supplier_results, json_path)

    # Exit code: 1 if any issues
    sys.exit(1 if issues else 0)


if __name__ == "__main__":
    main()
