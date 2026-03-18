"""TME API client for component pricing and availability.

Queries tme.eu REST API for real-time stock and tiered pricing.
Free with a TME developer account.

Auth: HMAC token/secret signing.
  - Set TME_TOKEN + TME_SECRET env vars, or
  - Store in ~/.config/requencer/tme.json:
    {"token": "...", "secret": "..."}

Register at https://developers.tme.eu/en

Key endpoints:
  - Products/Search — find products by MPN keyword
  - Products/GetPricesAndStocks — batch pricing + stock (up to 50 symbols)
"""

import base64
import hashlib
import hmac
import json
import os
import urllib.parse
from pathlib import Path

import requests

from procurement.types import Offer, SupplierResult

API_BASE = "https://api.tme.eu"
CONFIG_PATH = Path.home() / ".config" / "requencer" / "tme.json"


def _get_credentials() -> tuple[str, str] | None:
    """Load TME API credentials from env vars or config file."""
    token = os.environ.get("TME_TOKEN", "")
    secret = os.environ.get("TME_SECRET", "")

    if token and secret:
        return token, secret

    if CONFIG_PATH.exists():
        try:
            config = json.loads(CONFIG_PATH.read_text())
            return config["token"], config["secret"]
        except (json.JSONDecodeError, KeyError):
            pass

    return None


def _sign_request(
    endpoint: str, params: dict, token: str, secret: str
) -> dict:
    """Sign a TME API request using HMAC-SHA1.

    TME uses OAuth 1.0-style HMAC signing:
    1. Build the full URL
    2. Sort all params (including Token) alphabetically
    3. URL-encode and concatenate as POST&url&params
    4. HMAC-SHA1 with the app secret
    5. Add ApiSignature to params
    """
    url = f"{API_BASE}{endpoint}.json"
    params["Token"] = token

    # Sort params and build the signature base string
    sorted_params = sorted(params.items())
    encoded_params = urllib.parse.urlencode(sorted_params, quote_via=urllib.parse.quote)

    # Signature base: POST&url&params (all percent-encoded)
    base_string = "&".join([
        "POST",
        urllib.parse.quote(url, safe=""),
        urllib.parse.quote(encoded_params, safe=""),
    ])

    # HMAC-SHA1 signature
    sig = hmac.new(
        secret.encode("utf-8"),
        base_string.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    params["ApiSignature"] = base64.b64encode(sig).decode("utf-8")

    return params


def _search_symbol(token: str, secret: str, mpn: str) -> str | None:
    """Search TME for a product symbol matching the given MPN."""
    endpoint = "/Products/Search"
    params = {
        "Country": "DE",
        "Language": "EN",
        "SearchPlain": mpn,
    }
    signed = _sign_request(endpoint, params, token, secret)

    resp = requests.post(
        f"{API_BASE}{endpoint}.json",
        data=signed,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    products = data.get("Data", {}).get("ProductList", [])
    if not products:
        return None

    # Prefer exact MPN match, fall back to first result
    for product in products:
        if product.get("OriginalSymbol", "").upper() == mpn.upper():
            return product["Symbol"]

    return products[0].get("Symbol")


def _get_prices_and_stocks(
    token: str, secret: str, symbols: list[str], country: str = "DE", currency: str = "EUR"
) -> dict:
    """Batch fetch prices and stocks for up to 50 TME symbols."""
    endpoint = "/Products/GetPricesAndStocks"
    params = {
        "Country": country,
        "Language": "EN",
        "Currency": currency,
    }
    # TME expects SymbolList as indexed params: SymbolList[0], SymbolList[1], ...
    for i, sym in enumerate(symbols):
        params[f"SymbolList[{i}]"] = sym

    signed = _sign_request(endpoint, params, token, secret)

    resp = requests.post(
        f"{API_BASE}{endpoint}.json",
        data=signed,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


class TmeClient:
    """TME API client with HMAC authentication."""

    def __init__(self):
        self._credentials = _get_credentials()

    @property
    def available(self) -> bool:
        return self._credentials is not None

    def search(self, mpn: str, quantity: int = 5) -> SupplierResult:
        """Search for a part by MPN. Returns supplier offers sorted by price."""
        if not self._credentials:
            raise RuntimeError("TME credentials not configured")

        token, secret = self._credentials

        # Step 1: Find the TME symbol for this MPN
        symbol = _search_symbol(token, secret, mpn)
        if not symbol:
            return SupplierResult(mpn=mpn, manufacturer="", found=False)

        # Step 2: Get prices and stock
        data = _get_prices_and_stocks(token, secret, [symbol])
        products = data.get("Data", {}).get("ProductList", [])

        if not products:
            return SupplierResult(mpn=mpn, manufacturer="", found=False)

        product = products[0]
        stock = product.get("Amount", 0)
        moq = product.get("MinAmount", 1) or 1

        # Parse tiered pricing
        price_list = product.get("PriceList", [])
        unit_price, currency = _find_best_price(price_list, quantity)

        buy_url = f"https://www.tme.eu/en/details/{symbol}/"

        offers = [Offer(
            seller="TME",
            seller_url="https://www.tme.eu",
            stock=stock,
            moq=moq,
            unit_price=unit_price,
            currency=currency,
            buy_url=buy_url,
        )]

        return SupplierResult(mpn=mpn, manufacturer="", offers=offers)

    def search_batch(
        self, parts: list[tuple[str, int]], delay: float = 0.3
    ) -> dict[str, SupplierResult]:
        """Search multiple parts. Uses batch pricing endpoint where possible.

        Args:
            parts: List of (mpn, quantity) tuples.
            delay: Seconds between requests (rate limiting).

        Returns:
            Dict mapping MPN to SupplierResult.
        """
        if not self._credentials:
            raise RuntimeError("TME credentials not configured")

        import time

        token, secret = self._credentials
        results: dict[str, SupplierResult] = {}

        # Step 1: Resolve MPN → TME symbol for each part
        mpn_to_symbol: dict[str, str] = {}
        mpn_to_qty: dict[str, int] = {}

        for i, (mpn, qty) in enumerate(parts):
            if i > 0:
                time.sleep(delay)
            mpn_to_qty[mpn] = qty
            try:
                symbol = _search_symbol(token, secret, mpn)
                if symbol:
                    mpn_to_symbol[mpn] = symbol
                else:
                    results[mpn] = SupplierResult(mpn=mpn, manufacturer="", found=False)
            except requests.RequestException as e:
                results[mpn] = SupplierResult(
                    mpn=mpn, manufacturer="", found=False, error=str(e)
                )

        # Step 2: Batch fetch prices for all resolved symbols (up to 50 at a time)
        symbols = list(mpn_to_symbol.values())
        symbol_to_mpn = {v: k for k, v in mpn_to_symbol.items()}

        for batch_start in range(0, len(symbols), 50):
            batch = symbols[batch_start:batch_start + 50]
            if batch_start > 0:
                time.sleep(delay)

            try:
                data = _get_prices_and_stocks(token, secret, batch)
                products = data.get("Data", {}).get("ProductList", [])

                for product in products:
                    symbol = product.get("Symbol", "")
                    mpn = symbol_to_mpn.get(symbol, "")
                    if not mpn:
                        continue

                    stock = product.get("Amount", 0)
                    moq = product.get("MinAmount", 1) or 1
                    qty = mpn_to_qty.get(mpn, 5)

                    price_list = product.get("PriceList", [])
                    unit_price, currency = _find_best_price(price_list, qty)

                    buy_url = f"https://www.tme.eu/en/details/{symbol}/"

                    results[mpn] = SupplierResult(
                        mpn=mpn,
                        manufacturer="",
                        offers=[Offer(
                            seller="TME",
                            seller_url="https://www.tme.eu",
                            stock=stock,
                            moq=moq,
                            unit_price=unit_price,
                            currency=currency,
                            buy_url=buy_url,
                        )],
                    )
            except requests.RequestException as e:
                for sym in batch:
                    mpn = symbol_to_mpn.get(sym, "")
                    if mpn and mpn not in results:
                        results[mpn] = SupplierResult(
                            mpn=mpn, manufacturer="", found=False, error=str(e)
                        )

        return results


def _find_best_price(
    price_list: list[dict], quantity: int
) -> tuple[float | None, str]:
    """Find the best unit price from TME's tiered price list.

    TME returns: [{"Amount": 1, "PriceValue": 1.23}, {"Amount": 10, "PriceValue": 1.10}, ...]
    """
    if not price_list:
        return None, "EUR"

    sorted_prices = sorted(price_list, key=lambda p: p.get("Amount", 1))

    best_price = None
    for p in sorted_prices:
        if p.get("Amount", 1) <= quantity:
            try:
                best_price = float(p["PriceValue"])
            except (ValueError, TypeError, KeyError):
                continue

    # Fall back to lowest tier
    if best_price is None and sorted_prices:
        try:
            best_price = float(sorted_prices[0]["PriceValue"])
        except (ValueError, TypeError, KeyError):
            pass

    return best_price, "EUR"
