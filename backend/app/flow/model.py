"""Shapes for the Flow research surface.

This package is deliberately separate from `app.plan`. The nightly plan runs a
walk-forward measured rule; the Flow surface is a *proxy* for bandarmology-style
pressure and must never be blended into the plan's evidence or verdict.

The dataclasses here are the public contract. They keep the API honest: every
card carries its source and quality, and no field pretends to be the vendor's
proprietary LPM level.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class SourceInfo:
    """Where the numbers came from, and how much to trust them."""

    bars: str
    flow: str
    quality: str  # "proxy" | "measured" | "unavailable"
    as_of: str = ""
    available: bool = True
    warnings: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return {
            "bars": self.bars,
            "flow": self.flow,
            "quality": self.quality,
            "as_of": self.as_of,
            "available": self.available,
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True)
class FlowCard:
    """One name on the Flow screen."""

    ticker: str
    name: str
    as_of: str
    price: float | None
    previous_close: float | None
    change_pct: float | None
    value_5d_idr: float | None
    technicals: dict[str, Any]
    flow: dict[str, Any]
    tags: dict[str, Any]
    source: SourceInfo
    warnings: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return {
            "ticker": self.ticker,
            "name": self.name,
            "as_of": self.as_of,
            "price": self.price,
            "previous_close": self.previous_close,
            "change_pct": self.change_pct,
            "value_5d_idr": self.value_5d_idr,
            "technicals": self.technicals,
            "flow": self.flow,
            "tags": self.tags,
            "source": self.source.as_dict(),
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True)
class FlowSeries:
    """The chart series for one name.

    `lpm_score` is dimensionless and proxy-only. `lpm_price_space` exists for
    backward compatibility with the old `/api/intel/stockbit/lpm` shape, but it
    is a transformation of the proxy, not a measured price level.
    """

    ticker: str
    dates: list[str]
    price: list[float | None]
    lpm_score: list[float | None]
    lpm_price_space: list[float | None]
    intensity: list[float | None]
    foreign_net_idr: list[float | None]
    money_flow: list[float | None]
    source: SourceInfo
    parameters: dict[str, Any] = field(default_factory=dict)
    warnings: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return {
            "ticker": self.ticker,
            "dates": self.dates,
            "price": self.price,
            "lpm_score": self.lpm_score,
            "lpm_price_space": self.lpm_price_space,
            "intensity": self.intensity,
            "foreign_net_idr": self.foreign_net_idr,
            "money_flow": self.money_flow,
            "source": self.source.as_dict(),
            "quality": self.source.quality,
            "parameters": self.parameters,
            "warnings": list(self.warnings),
        }
