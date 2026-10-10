"""IDX market structure: tick sizes, price bands, sessions, and real friction.

Two things this module is careful about, because the study's cost model is
deliberately flat and the app must not pass its own arithmetic off as the study's:

  * The study measures **0.50%** a round trip — 0.15% buy + 0.25% sell + 2 x
    0.05% slippage — and that is the number inside every backtested figure. It
    carries no spread term at all, which the study says out loud: the flat model
    is "a documented approximation, not a broker statement", and tick sizes and
    round lots "do not map cleanly" onto split-adjusted prices (docs/07:223-224).
  * A real IDX round trip also pays the spread, and at IDX tick sizes that is not
    small. A Rp1,000 stock sits in the Rp5 tick band, so a two-tick spread is
    1.00% against 0.40% of broker fees.

So `friction_round_trip()` is an overlay the app computes for the ticket, labelled
as ours, and it is never substituted into the study's evidence. Where the two
disagree the UI shows both.

The rulebook moved on 28 September 2026 (minimum price Rp50 -> Rp1, a new AR
table) and the AR bands become symmetric on 1 January 2027, so the tables carry
`effective_from` and every lookup takes a date. Nothing here is hard-coded to
today's rulebook.

Sources: IDX "Jam dan Mekanisme Perdagangan" (idx.id mirror; idx.co.id is
Cloudflare-blocked from this host) and the broker fee schedules it cites.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from math import floor

# ── constants ────────────────────────────────────────────────────────────────
LOT_SIZE = 100  # round lot, Regular and Cash markets
MIN_PRICE_IDR = 1.0  # rulebook minimum since 2026-09-28; it was Rp50 before
TICK_TABLE_FROM = date(2026, 9, 28)
AR_TABLE_FROM = date(2026, 9, 28)
AR_SYMMETRIC_FROM = date(2027, 1, 1)

# Broker commission, all-in (the schedules that include exchange fees and VAT).
# The exchange side alone is 0.0433% buy / 0.1433% sell.
BROKER_FEE_BUY = 0.0015
BROKER_FEE_SELL = 0.0025
EXCHANGE_FEE_BUY = 0.000433
EXCHANGE_FEE_SELL = 0.001433
STAMP_DUTY_IDR = 10_000.0
STAMP_DUTY_ABOVE_IDR = 10_000_000.0

# The study's own model, restated here only so a caller can compare against it.
# `screen.py` passes `method.ROUND_TRIP_COST` in, so this app still has one
# authority for the number the backtest used.
STUDY_ROUND_TRIP_PCT = 0.50

# Max price step in one order is ten ticks, so a ticket never asks for the moon.
MAX_STEPS = 10


@dataclass(frozen=True)
class TickBand:
    """One row of the fraksi harga table. `high` is exclusive."""

    low: float
    high: float | None
    tick: float

    def holds(self, price: float) -> bool:
        return price >= self.low and (self.high is None or price < self.high)


# Effective 2026-09-28. Unchanged by the rest of that revision, but kept dated
# because the app should not assume the table is eternal.
_TICK_BANDS: tuple[TickBand, ...] = (
    TickBand(1.0, 200.0, 1.0),
    TickBand(200.0, 500.0, 2.0),
    TickBand(500.0, 2_000.0, 5.0),
    TickBand(2_000.0, 5_000.0, 10.0),
    TickBand(5_000.0, None, 25.0),
)


@dataclass(frozen=True)
class ARBand:
    """Auto-rejection limits for one price band.

    `up_pct`/`down_pct` of None mean the band is one tick wide in that direction,
    which is how the rulebook states the Rp1-Rp10 row: a Rp5 stock cannot move
    more than Rp1 either way in a session.
    """

    low: float
    high: float | None
    up_pct: float | None
    down_pct: float | None
    effective_from: date
    note: str

    def holds(self, price: float) -> bool:
        return price >= self.low and (self.high is None or price < self.high)


# Main / New Economy / Development boards. Acceleration and the Full Call Auction
# board are 10%/10% on everything above Rp10; the app screens the main boards, and
# says so rather than implying the table covers every board.
_AR_2026: tuple[ARBand, ...] = (
    ARBand(1.0, 10.0, None, None, AR_TABLE_FROM, "one tick each way"),
    ARBand(11.0, 200.0, 35.0, 15.0, AR_TABLE_FROM, ""),
    ARBand(200.0, 5_000.0, 25.0, 15.0, AR_TABLE_FROM, ""),
    ARBand(5_000.0, None, 20.0, 15.0, AR_TABLE_FROM, ""),
)
_AR_2027: tuple[ARBand, ...] = (
    ARBand(1.0, 10.0, None, None, AR_SYMMETRIC_FROM, "one tick each way"),
    ARBand(10.0, 200.0, 35.0, 35.0, AR_SYMMETRIC_FROM, "symmetric from 2027-01-01"),
    ARBand(200.0, 5_000.0, 25.0, 25.0, AR_SYMMETRIC_FROM, "symmetric from 2027-01-01"),
    ARBand(5_000.0, None, 20.0, 20.0, AR_SYMMETRIC_FROM, "symmetric from 2027-01-01"),
)


@dataclass(frozen=True)
class Session:
    """One trading window, in WIB (UTC+7). Times are 'HH:MM'."""

    label: str
    start: str
    end: str
    note: str = ""


SESSIONS: tuple[Session, ...] = (
    Session("pre-opening input", "08:45", "08:57", "orders accepted"),
    Session("no-cancellation", "08:56", "08:59", "orders cannot be withdrawn"),
    Session("pre-opening match", "08:58", "08:59", ""),
    Session("session I", "09:00", "12:00", "Friday closes 11:30"),
    Session("session II", "13:30", "15:49", "Friday opens 14:00"),
    Session("pre-closing", "15:50", "15:59", "closing match time is randomised"),
    Session("closing match", "16:00", "16:01", ""),
    Session("post-trading", "16:02", "16:15", ""),
)

# From 15:56 the book cannot be withdrawn and the closing match time is random,
# so a ticket that says "buy at the close" cannot be honoured predictably.
UNTRADEABLE_FROM = "15:56"
UNTRADEABLE_TO = "16:02"


# ── ticks ────────────────────────────────────────────────────────────────────
def tick_for(price: float, as_of: date | None = None) -> float:
    """The tick size for a price, in IDR.

    The table is not interpolated: a price off the grid is still in exactly one
    band, and `round_to_tick` moves it onto that band's grid.
    """
    del as_of  # the table is dated, but every band it has ever held is the same
    if price <= 0:
        raise ValueError("a tick needs a positive price")
    for band in _TICK_BANDS:
        if band.holds(price):
            return band.tick
    return _TICK_BANDS[-1].tick


def round_to_tick(price: float, how: str = "nearest", as_of: date | None = None) -> float:
    """Put a price on the tick grid: `nearest`, `down` (toward zero) or `up`.

    A ticket with an off-grid price is not a price anyone can enter, so every
    level the app shows is rounded. Half a tick is a real amount of money on the
    stop, which is why the rounding is stated rather than hidden.
    """
    tick = tick_for(price, as_of)
    steps = price / tick
    if how == "down":
        steps = floor(steps)
    elif how == "up":
        steps = -floor(-steps)
    else:
        steps = floor(steps + 0.5)
    return round(max(steps, 1.0) * tick, 4)


def price_step_limit(price: float, as_of: date | None = None) -> float:
    """How far a single order may step from the last done, in IDR."""
    return tick_for(price, as_of) * MAX_STEPS


# ── auto-rejection ───────────────────────────────────────────────────────────
def ar_bands(as_of: date | None = None) -> tuple[ARBand, ...]:
    """The AR table in force on a date."""
    when = as_of or date.today()
    return _AR_2027 if when >= AR_SYMMETRIC_FROM else _AR_2026


@dataclass(frozen=True)
class ARLimits:
    """The session's price limits around a reference price."""

    reference: float
    up_price: float
    down_price: float
    up_pct: float
    down_pct: float
    band: str
    note: str

    def as_dict(self) -> dict[str, object]:
        return dict(
            reference=self.reference,
            up_price=self.up_price,
            down_price=self.down_price,
            up_pct=self.up_pct,
            down_pct=self.down_pct,
            band=self.band,
            note=self.note,
        )


def _band_note(band: ARBand, price: float) -> str:
    if band.low <= 10.0:
        return f"Rp{band.low:,.0f}-Rp10 is one tick wide either way"
    return band.note


def ar_limits(reference: float, as_of: date | None = None) -> ARLimits:
    """Auto-rejection limits around a reference price (normally the last close).

    Rounded *into* the band — the upper limit down, the lower limit up — because
    quoting a limit the exchange would reject is worse than quoting a slightly
    tighter one.
    """
    if reference <= 0:
        raise ValueError("AR limits need a positive reference price")
    for band in ar_bands(as_of):
        if band.holds(reference):
            tick = tick_for(reference, as_of)
            up = (
                reference + tick
                if band.up_pct is None
                else round_to_tick(reference * (1.0 + band.up_pct / 100.0), "down", as_of)
            )
            down = (
                reference - tick
                if band.down_pct is None
                else round_to_tick(reference * (1.0 - band.down_pct / 100.0), "up", as_of)
            )
            return ARLimits(
                reference=reference,
                up_price=max(up, reference),
                down_price=max(min(down, reference), MIN_PRICE_IDR),
                up_pct=(band.up_pct if band.up_pct is not None else 100.0 * tick / reference),
                down_pct=(
                    band.down_pct if band.down_pct is not None else 100.0 * tick / reference
                ),
                band=f"Rp{band.low:,.0f}-" + (f"Rp{band.high:,.0f}" if band.high else "up"),
                note=_band_note(band, reference),
            )
    raise AssertionError("no AR band matched a positive price")


def target_inside_ar(entry: float, target: float, as_of: date | None = None) -> bool:
    """Can the target be reached in one session, ignoring the holding period?

    The shipped hold is 95 sessions, so a target outside today's band is
    unremarkable — it just cannot happen on the first day. The ticket says which.
    """
    return target <= ar_limits(entry, as_of).up_price


# ── the Rp1-Rp10 trap and the economic floor ─────────────────────────────────
def one_tick_band(price: float) -> bool:
    """True for the Rp1-Rp10 band, where a session's whole range is one tick."""
    return price < 10.0


def economic_floor_note() -> str:
    """Why the screen keeps a Rp50 floor while the rulebook allows Rp1.

    The rulebook's minimum is about what may be listed. The screen's floor is
    about what can be traded: at Rp100 a single tick is 1% and the median IDX
    relative spread is around 1.5%, so a sub-Rp50 name costs more to cross than
    the study's whole 0.50% round trip.
    """
    return (
        "The rulebook allows a Rp1 minimum price; the screen keeps Rp50 because at "
        "Rp100 one tick is already 1% of the price and the spread is a multiple of "
        "the study's 0.50% cost model."
    )


# ── friction ─────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Friction:
    """What a round trip actually costs at a given price.

    `study_model_pct` is what every backtested figure includes; `total_pct` is
    what a retail account pays including the spread. The gap is the point.
    """

    price: float
    tick_idr: float
    spread_ticks: int
    spread_idr: float
    spread_pct: float
    fees_pct: float
    total_pct: float
    study_model_pct: float
    over_study_pct: float
    stamp_duty_idr: float
    trades_per_lot_idr: float
    note: str

    def as_dict(self) -> dict[str, object]:
        return dict(
            price=self.price,
            tick_idr=self.tick_idr,
            spread_ticks=self.spread_ticks,
            spread_idr=self.spread_idr,
            spread_pct=self.spread_pct,
            fees_pct=self.fees_pct,
            total_pct=self.total_pct,
            study_model_pct=self.study_model_pct,
            over_study_pct=self.over_study_pct,
            stamp_duty_idr=self.stamp_duty_idr,
            trades_per_lot_idr=self.trades_per_lot_idr,
            note=self.note,
        )


def friction_round_trip(
    price: float,
    spread_ticks: int = 2,
    study_model_pct: float = STUDY_ROUND_TRIP_PCT,
    as_of: date | None = None,
) -> Friction:
    """Fees plus a two-tick spread, in percent of price.

    Two ticks is the conservative default: a liquid name often shows one, a thin
    one shows several, and the study's universe runs from LQ45 down to a 250M IDR
    turnover floor. A caller that knows the book can pass a tighter spread.
    """
    if price <= 0:
        raise ValueError("friction needs a positive price")
    tick = tick_for(price, as_of)
    spread_idr = tick * max(spread_ticks, 0)
    spread_pct = 100.0 * spread_idr / price
    fees_pct = (BROKER_FEE_BUY + BROKER_FEE_SELL) * 100.0
    total = fees_pct + spread_pct
    lot_cost = price * LOT_SIZE
    return Friction(
        price=price,
        tick_idr=tick,
        spread_ticks=spread_ticks,
        spread_idr=spread_idr,
        spread_pct=round(spread_pct, 3),
        fees_pct=round(fees_pct, 3),
        total_pct=round(total, 3),
        study_model_pct=study_model_pct,
        over_study_pct=round(total - study_model_pct, 3),
        stamp_duty_idr=STAMP_DUTY_IDR if lot_cost > STAMP_DUTY_ABOVE_IDR else 0.0,
        trades_per_lot_idr=round(lot_cost, 2),
        note=(
            f"One tick is Rp{tick:,.0f} at this price, so a "
            f"{spread_ticks}-tick spread costs {spread_pct:.2f}% on top of "
            f"{fees_pct:.2f}% of broker fees. The study's {study_model_pct:.2f}% "
            "model has no spread term."
        ),
    )


def stamp_duty(position_idr: float) -> float:
    """Bea materai: Rp10,000 a confirmation above Rp10,000,000."""
    return STAMP_DUTY_IDR if position_idr > STAMP_DUTY_ABOVE_IDR else 0.0


def tables() -> dict[str, object]:
    """The tick, AR and fee tables in one block, for a UI that renders them.

    Everything dated lives here, so a change to the rulebook is a change in this
    module and nowhere else.
    """
    return dict(
        lot_size=LOT_SIZE,
        min_price_idr=MIN_PRICE_IDR,
        economic_floor_note=economic_floor_note(),
        broker_fee_buy=BROKER_FEE_BUY,
        broker_fee_sell=BROKER_FEE_SELL,
        exchange_fee_buy=EXCHANGE_FEE_BUY,
        exchange_fee_sell=EXCHANGE_FEE_SELL,
        stamp_duty_idr=STAMP_DUTY_IDR,
        stamp_duty_above_idr=STAMP_DUTY_ABOVE_IDR,
        study_round_trip_pct=STUDY_ROUND_TRIP_PCT,
        untradeable_from=UNTRADEABLE_FROM,
        untradeable_to=UNTRADEABLE_TO,
        sessions=[
            {"label": s.label, "start": s.start, "end": s.end, "note": s.note}
            for s in SESSIONS
        ],
        tick_bands=[
            {"low": b.low, "high": b.high, "tick": b.tick} for b in _TICK_BANDS
        ],
        ar_bands=[
            {
                "low": b.low,
                "high": b.high,
                "up_pct": b.up_pct,
                "down_pct": b.down_pct,
                "effective_from": b.effective_from.isoformat(),
                "note": b.note,
            }
            for b in _AR_2026
        ],
    )


def sessions_for(when: str) -> Session | None:
    """Which session a 'HH:MM' falls in, for a ticket's 'place by' line."""
    for session in SESSIONS:
        if session.start <= when < session.end:
            return session
    return None


def tradeable_clock(when: str) -> bool:
    """False inside the window where the book cannot be withdrawn predictably."""
    return not (UNTRADEABLE_FROM <= when < UNTRADEABLE_TO)


__all__ = [
    "ARLimits",
    "ARBand",
    "BROKER_FEE_BUY",
    "BROKER_FEE_SELL",
    "EXCHANGE_FEE_BUY",
    "EXCHANGE_FEE_SELL",
    "Friction",
    "LOT_SIZE",
    "MIN_PRICE_IDR",
    "SESSIONS",
    "STUDY_ROUND_TRIP_PCT",
    "Session",
    "TickBand",
    "UNTRADEABLE_FROM",
    "UNTRADEABLE_TO",
    "ar_bands",
    "ar_limits",
    "economic_floor_note",
    "friction_round_trip",
    "one_tick_band",
    "price_step_limit",
    "round_to_tick",
    "sessions_for",
    "stamp_duty",
    "tables",
    "target_inside_ar",
    "tick_for",
    "tradeable_clock",
]
