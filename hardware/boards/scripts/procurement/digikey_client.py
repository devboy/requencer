"""DigiKey API client for component pricing and availability.

Queries the DigiKey Product Information API v4 for real-time
stock and tiered pricing. Free tier: 1000 searches/day.

Auth: OAuth2 client credentials flow (headless, no browser popup).
  - Set DIGIKEY_CLIENT_ID + DIGIKEY_CLIENT_SECRET env vars, or
  - Store in ~/.config/requencer/digikey.json:
    {"client_id": "...", "client_secret": "..."}

Register at https://developer.digikey.com/
Create a "Production" app with Product Information API v4 access.
"""

import json
import os
import time
from pathlib import Path

import requests

from procurement.types import Offer, SupplierResult

TOKEN_URL = "https://api.digikey.com/v1/oauth2/token"
SEARCH_URL = "https://api.digikey.com/products/v4/search/keyword"
CONFIG_PATH = Path.home() / ".config" / "requencer" / "digikey.json"


def _get_credentials() -> tuple[str, str] | None:
    """Load DigiKey API credentials from env vars or config file."""
    client_id = os.environ.get("DIGIKEY_CLIENT_ID", "")
    client_secret = os.environ.get("DIGIKEY_CLIENT_SECRET", "")

    if client_id and client_secret:
        return client_id, client_secret

    if CONFIG_PATH.exists():
        try:
            config = json.loads(CONFIG_PATH.read_text())
            return config["client_id"], config["client_secret"]
        except (json.JSONDecodeError, KeyError):
            pass

    return None


def _get_token(client_id: str, client_secret: str) -> str:
    """Exchange client credentials for an OAuth2 access token."""
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def _search_keyword(
    token: str, client_id: str, mpn: str, quantity: int
) -> SupplierResult:
    """Search DigiKey by keyword (MPN) and return parsed offers."""
    headers = {
        "Authorization": f"Bearer {token}",
        "X-DIGIKEY-Client-Id": client_id,
        "Content-Type": "application/json",
        "X-DIGIKEY-Locale-Site": "DE",
        "X-DIGIKEY-Locale-Language": "en",
        "X-DIGIKEY-Locale-Currency": "EUR",
    }

    body = {
        "Keywords": mpn,
        "RecordCount": 5,
        "RecordStartPosition": 0,
        "ExcludeMarketPlaceProducts": True,
    }

    resp = requests.post(
        SEARCH_URL,
        headers=headers,
        json=body,
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    products = data.get("Products", [])
    if not products:
        return SupplierResult(mpn=mpn, manufacturer="", found=False)

    # Find best match: prefer exact MPN match
    product = products[0]
    for p in products:
        if p.get("ManufacturerProductNumber", "").upper() == mpn.upper():
            product = p
            break

    manufacturer = product.get("Manufacturer", {}).get("Name", "")
    stock = product.get("QuantityAvailable", 0)
    buy_url = product.get("ProductUrl", "")

    # v4 API nests pricing inside ProductVariations (one per packaging type).
    # Pick the variation with the smallest MOQ (typically "Cut Tape").
    variations = product.get("ProductVariations", [])
    best_variation = None
    for v in variations:
        if v.get("MarketPlace"):
            continue
        if best_variation is None:
            best_variation = v
        elif (v.get("MinimumOrderQuantity", 1) or 1) < (best_variation.get("MinimumOrderQuantity", 1) or 1):
            best_variation = v

    if best_variation:
        moq = best_variation.get("MinimumOrderQuantity", 1) or 1
        price_breaks = best_variation.get("StandardPricing", [])
        unit_price, currency = _find_best_price(price_breaks, quantity)
    else:
        # Fall back to top-level UnitPrice if no variations
        moq = product.get("MinimumOrderQuantity", 1) or 1
        top_price = product.get("UnitPrice")
        unit_price = float(top_price) if top_price is not None else None
        currency = "EUR"

    offers = [Offer(
        seller="DigiKey",
        seller_url="https://www.digikey.de",
        stock=stock,
        moq=moq,
        unit_price=unit_price,
        currency=currency,
        buy_url=buy_url,
    )]

    return SupplierResult(
        mpn=mpn, manufacturer=manufacturer, offers=offers
    )


def _find_best_price(
    price_breaks: list[dict], quantity: int
) -> tuple[float | None, str]:
    """Find the best unit price from DigiKey's tiered pricing.

    DigiKey returns: [{"BreakQuantity": 1, "UnitPrice": 1.23, "TotalPrice": 1.23}, ...]
    """
    if not price_breaks:
        return None, "EUR"

    sorted_breaks = sorted(price_breaks, key=lambda p: p.get("BreakQuantity", 1))

    best_price = None
    for p in sorted_breaks:
        if p.get("BreakQuantity", 1) <= quantity:
            try:
                best_price = float(p["UnitPrice"])
            except (ValueError, TypeError, KeyError):
                continue

    if best_price is None and sorted_breaks:
        try:
            best_price = float(sorted_breaks[0]["UnitPrice"])
        except (ValueError, TypeError, KeyError):
            pass

    return best_price, "EUR"


class DigikeyClient:
    """DigiKey API client with OAuth2 authentication."""

    def __init__(self):
        self._token: str | None = None
        self._token_time: float = 0
        self._credentials = _get_credentials()

    @property
    def available(self) -> bool:
        return self._credentials is not None

    def _ensure_token(self):
        """Get or refresh the OAuth2 token."""
        if self._token and (time.time() - self._token_time) < 3000:
            return
        if not self._credentials:
            raise RuntimeError("DigiKey credentials not configured")
        self._token = _get_token(*self._credentials)
        self._token_time = time.time()

    def search(self, mpn: str, quantity: int = 5) -> SupplierResult:
        """Search for a part by MPN. Returns supplier offers sorted by price."""
        self._ensure_token()
        return _search_keyword(
            self._token, self._credentials[0], mpn, quantity
        )

    def search_batch(
        self, parts: list[tuple[str, int]], delay: float = 0.5
    ) -> dict[str, SupplierResult]:
        """Search multiple parts with rate limiting.

        Args:
            parts: List of (mpn, quantity) tuples.
            delay: Seconds between requests (rate limiting).

        Returns:
            Dict mapping MPN to SupplierResult.
        """
        self._ensure_token()
        results: dict[str, SupplierResult] = {}

        for i, (mpn, qty) in enumerate(parts):
            if i > 0:
                time.sleep(delay)
            try:
                results[mpn] = _search_keyword(
                    self._token, self._credentials[0], mpn, qty
                )
            except requests.RequestException as e:
                results[mpn] = SupplierResult(
                    mpn=mpn, manufacturer="", found=False, error=str(e)
                )

        return results
