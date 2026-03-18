"""Shared data types for supplier pricing clients.

All supplier clients (TME, DigiKey, Nexar) return these same types,
enabling uniform aggregation in check_parts.py.
"""

from dataclasses import dataclass, field


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
