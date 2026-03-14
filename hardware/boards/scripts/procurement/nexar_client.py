"""Nexar/Octopart GraphQL client for multi-supplier pricing.

Queries the Nexar API (which includes Octopart data) for component
availability and pricing across multiple distributors.

Free tier: 1000 parts/month — sufficient for ~15 unique THT parts.

Credentials: Set NEXAR_CLIENT_ID + NEXAR_CLIENT_SECRET env vars,
or store in ~/.config/requencer/nexar.json:
  {"client_id": "...", "client_secret": "..."}

Register at https://nexar.com/api to get credentials.
"""

import json
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

import requests

TOKEN_URL = "https://identity.nexar.com/connect/token"
GRAPHQL_URL = "https://api.nexar.com/graphql"
CONFIG_PATH = Path.home() / ".config" / "requencer" / "nexar.json"

# Distributors known to ship to Germany
DE_FRIENDLY_SELLERS = {
    "Mouser", "Mouser Electronics", "DigiKey", "Digi-Key", "Digi-Key Electronics",
    "Farnell", "element14", "RS Components", "TME", "Reichelt",
    "LCSC", "LCSC Electronics", "Arrow", "Arrow Electronics",
    "Rutronik", "Distrelec", "Conrad",
}

SEARCH_QUERY = """
query SearchMPN($mpn: String!) {
  supSearch(q: $mpn, limit: 5) {
    results {
      part {
        mpn
        manufacturer {
          name
        }
        bestDatasheet {
          url
        }
        sellers {
          company {
            name
            homepageUrl
          }
          offers {
            inventoryLevel
            moq
            clickUrl
            prices {
              quantity
              price
              currency
            }
          }
        }
      }
    }
  }
}
"""


@dataclass
class Offer:
    seller: str
    seller_url: str
    stock: int  # -1 means "in stock" (exact qty unknown)
    moq: int
    unit_price: float | None
    currency: str
    buy_url: str


@dataclass
class SupplierResult:
    mpn: str
    manufacturer: str
    offers: list[Offer] = field(default_factory=list)
    found: bool = True
    error: str = ""


def _get_credentials() -> tuple[str, str] | None:
    """Load Nexar API credentials from env vars or config file."""
    client_id = os.environ.get("NEXAR_CLIENT_ID", "")
    client_secret = os.environ.get("NEXAR_CLIENT_SECRET", "")

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


def _parse_inventory_level(level: int | None) -> int:
    """Convert Nexar inventory level to a stock count.

    Nexar returns inventory levels as integers. 0 means out of stock,
    positive values indicate stock quantity.
    """
    if level is None:
        return 0
    return max(0, level)


def _find_best_price(prices: list[dict], quantity: int) -> tuple[float | None, str]:
    """Find the best unit price for a given quantity from a tiered price list."""
    if not prices:
        return None, ""

    # Sort by quantity break ascending
    sorted_prices = sorted(prices, key=lambda p: p.get("quantity", 1))

    # Find the highest quantity break <= our quantity
    best_price = None
    currency = ""
    for p in sorted_prices:
        if p.get("quantity", 1) <= quantity:
            try:
                best_price = float(p["price"])
                currency = p.get("currency", "USD")
            except (ValueError, TypeError):
                continue

    # If no break found, use the lowest break
    if best_price is None and sorted_prices:
        try:
            best_price = float(sorted_prices[0]["price"])
            currency = sorted_prices[0].get("currency", "USD")
        except (ValueError, TypeError):
            pass

    return best_price, currency


def search_part(
    token: str, mpn: str, quantity: int = 5, filter_de: bool = True
) -> SupplierResult:
    """Search for a part by MPN and return supplier offers."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    resp = requests.post(
        GRAPHQL_URL,
        headers=headers,
        json={"query": SEARCH_QUERY, "variables": {"mpn": mpn}},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()

    if "errors" in data:
        return SupplierResult(
            mpn=mpn, manufacturer="", found=False,
            error=data["errors"][0].get("message", "Unknown error"),
        )

    results = data.get("data", {}).get("supSearch", {}).get("results", [])
    if not results:
        return SupplierResult(mpn=mpn, manufacturer="", found=False)

    # Use the first matching result
    part = results[0].get("part", {})
    mfr = part.get("manufacturer", {}).get("name", "")

    offers = []
    for seller_data in part.get("sellers", []):
        seller_name = seller_data.get("company", {}).get("name", "")

        # Filter to DE-friendly sellers if requested
        if filter_de and seller_name not in DE_FRIENDLY_SELLERS:
            continue

        seller_url = seller_data.get("company", {}).get("homepageUrl", "")

        for offer_data in seller_data.get("offers", []):
            stock = _parse_inventory_level(offer_data.get("inventoryLevel"))
            moq = offer_data.get("moq", 1) or 1
            buy_url = offer_data.get("clickUrl", "")

            unit_price, currency = _find_best_price(
                offer_data.get("prices", []), quantity
            )

            offers.append(Offer(
                seller=seller_name,
                seller_url=seller_url,
                stock=stock,
                moq=moq,
                unit_price=unit_price,
                currency=currency,
                buy_url=buy_url,
            ))

    # Sort by price (cheapest first), None prices last
    offers.sort(key=lambda o: (o.unit_price is None, o.unit_price or 999999))

    return SupplierResult(mpn=mpn, manufacturer=mfr, offers=offers)


class NexarClient:
    """Manages Nexar API authentication and provides part search."""

    def __init__(self):
        self._token: str | None = None
        self._token_time: float = 0
        self._credentials = _get_credentials()

    @property
    def available(self) -> bool:
        return self._credentials is not None

    def _ensure_token(self):
        """Get or refresh the OAuth2 token (tokens last ~1 hour)."""
        if self._token and (time.time() - self._token_time) < 3000:
            return
        if not self._credentials:
            raise RuntimeError("Nexar credentials not configured")
        self._token = _get_token(*self._credentials)
        self._token_time = time.time()

    def search(self, mpn: str, quantity: int = 5) -> SupplierResult:
        """Search for a part by MPN. Returns supplier offers sorted by price."""
        self._ensure_token()
        return search_part(self._token, mpn, quantity)

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
        results = {}
        for i, (mpn, qty) in enumerate(parts):
            if i > 0:
                time.sleep(delay)
            try:
                results[mpn] = self.search(mpn, qty)
            except requests.RequestException as e:
                results[mpn] = SupplierResult(
                    mpn=mpn, manufacturer="", found=False, error=str(e),
                )
        return results
