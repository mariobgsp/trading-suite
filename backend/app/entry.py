"""Entry-plan engine: fuses the entire dataset — technicals, bandarmology
validator, market regime, and beta — into a deterministic entry plan.

Rule-based on purpose: works offline, is testable, and never depends on an
AI key. Scores confluence (0-100), produces an entry zone / stop / targets
from the data we already compute, and states exactly what conditions must
still line up before entering.

Every input is guarded; a missing signal simply scores 0 instead of
crashing the plan.
"""

from __future__ import annotations

import math
from typing import Any

from app.ai import MODEL, call_model
from app.beta import beta_correlation
from app.indicators import compute_indicators
from app.market import fetch_history
from app.regime import regime_snapshot
from app.validator import BandarmologyAnalyzer

RISK_PCT = 0.01  # 1% of capital risked per trade (for the sizing note)


def _f(v: Any) -> float | None:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def _latest(col: list[Any] | None) -> float | None:
    if not col:
        return None
    for v in reversed(col):
        if v is not None:
            return _f(v)
    return None


def _cross_up(a: list[Any] | None, b: list[Any] | None) -> bool | None:
    """True if a crossed above b on the last bar."""
    if not a or not b or len(a) < 2:
        return None
    prev_a, cur_a = _f(a[-2]), _f(a[-1])
    prev_b, cur_b = _f(b[-2]), _f(b[-1])
    if prev_a is None or cur_a is None or prev_b is None or cur_b is None:
        return None
    return bool(prev_a <= prev_b and cur_a > cur_b)


def _trend(col: list[Any] | None, lookback: int = 5) -> float | None:
    """Slope sign of the last `lookback` bars of a column (-1/0/+1)."""
    if not col or len(col) < lookback + 1:
        return None
    vals: list[float] = []
    for v in col[-lookback - 1 :]:
        fv = _f(v)
        if fv is None:
            return None
        vals.append(fv)
    cur, prev = vals[-1], vals[0]
    return 1 if cur > prev else (-1 if cur < prev else 0)


def _recent_low(history: list[dict[str, Any]], n: int = 20) -> float | None:
    lows = [_f(r.get("low")) for r in history[-n:]]
    lows = [x for x in lows if x is not None]
    return min(lows) if lows else None


def _narrate(plan: dict[str, Any]) -> tuple[str, bool]:
    """Ask the AI for a short desk narration of the entry plan.

    Returns (text, used_ai). Deterministic fallback when the model is
    unconfigured/unreachable so the plan always has a readable
    "why / what to watch" line.
    """
    prompt = (
        "You are a senior IDX desk analyst writing a short trade narrative. "
        "Using ONLY the plan facts below, write 3-5 sentences: why this entry "
        "plan exists, the confluence that supports it, the key risk, and what "
        "would invalidate it. Plain sentences, no headers, no disclaimers.\n\n"
        f"PLAN: {plan.get('verdict')} (score {plan.get('score')}/100) "
        f"for {plan.get('ticker')}.\n"
        f"Technicals: {plan.get('technicals')}\n"
        f"Validator: {plan.get('validator')}\n"
        f"Regime: {plan.get('regime')}\n"
        f"Beta: {plan.get('beta')}\n"
        f"Entry zone: {plan.get('entry_zone')} | Stop: {plan.get('stop_loss')} | "
        f"Targets: {plan.get('targets')}\n"
        f"Signals met: {plan.get('conditions', {}).get('met', [])}\n"
        f"Triggers to confirm: {plan.get('conditions', {}).get('missing', [])}"
    )
    try:
        text = call_model(
            "You are the desk analyst for an Indonesian (IDX) trading suite.",
            prompt,
        )
        if text:
            return text, True
    except Exception as e:  # noqa: BLE001 - narration must never crash
        print(f"[entry] narration failed: {e}")

    v = plan.get("verdict") or ""
    t = plan.get("ticker") or ""
    ph = (plan.get("validator") or {}).get("bandar_phase", "?")
    flow = (plan.get("validator") or {}).get("inst_flow", "?")
    reg = (plan.get("regime") or {}).get("regime", "?")
    zone = plan.get("entry_zone") or {}
    stop = plan.get("stop_loss")
    heads: dict[str, str] = {
        "ENTER_LONG": f"Setup is {t}: confluence is green (score {plan.get('score')}/100) — ",
        "CONDITIONAL": f"Setup on {t} is forming (score {plan.get('score')}/100) but needs confirmation — ",
        "WAIT": f"No clean setup on {t} yet (score {plan.get('score')}/100) — ",
        "AVOID": f"Avoid {t} for now (score {plan.get('score')}/100) — ",
    }
    parts = [
        heads.get(v, f"{t}: "),
        f"bandar phase {ph}, {flow}, regime {reg}.",
    ]
    if zone:
        parts.append(f"Ideal entry {zone.get('from')}-{zone.get('to')}; ")
    if stop is not None:
        parts.append(f"stop at {stop}; ")
    missing = plan.get("conditions", {}).get("missing") or []
    if missing:
        parts.append("Wait for: " + "; ".join(missing[:3]) + ".")
    else:
        parts.append("No further triggers required.")
    return "".join(parts), False


def entry_plan(ticker: str, force: bool = False) -> dict[str, Any]:
    """Full entry plan for a ticker (technicals + validator + regime + beta)."""
    try:
        history = fetch_history(ticker, period="1y", interval="1d", force=force) or []
    except Exception:  # noqa: BLE001
        history = []
    if not history:
        return {"ticker": ticker, "error": "no history available"}

    indicators = compute_indicators(history)
    cols = indicators["columns"]

    # ── Technical reads ────────────────────────────────────────────────────
    close = _f(history[-1].get("close"))
    rsi = _latest(cols.get("rsi"))
    macd_line = _latest(cols.get("macd_0"))
    macd_sig = _latest(cols.get("macd_1"))
    stoch_k = _latest(cols.get("stoch_0"))
    stoch_d = _latest(cols.get("stoch_1"))
    psar = _latest(cols.get("psar"))
    cmf = _latest(cols.get("cmf"))
    mfi = _latest(cols.get("mfi"))
    sma20, sma50, sma200 = (
        _latest(cols.get("sma20")),
        _latest(cols.get("sma50")),
        _latest(cols.get("sma200")),
    )
    ad_line = cols.get("ad_line")

    score = 0
    reasons: list[str] = []
    techs: dict[str, Any] = {}

    if sma20 is not None and sma50 is not None:
        golden = sma20 > sma50
        techs["golden_cross_20_50"] = golden
        score += 8 if golden else -6
        reasons.append(f"SMA20 {'>' if golden else '<'} SMA50")
    if sma20 is not None and close is not None:
        above20 = close > sma20
        techs["above_sma20"] = above20
        score += 6 if above20 else -5
    if sma200 is not None and close is not None:
        above200 = close > sma200
        techs["above_sma200"] = above200
        score += 6 if above200 else -5

    macd_up = _cross_up(cols.get("macd_0"), cols.get("macd_1"))
    techs["macd_cross_up"] = macd_up
    if macd_line is not None and macd_sig is not None:
        bull = macd_line > macd_sig
        score += 8 if bull else -6
        reasons.append(f"MACD {'bullish' if bull else 'bearish'}")
    if macd_up:
        score += 3

    stoch_up = _cross_up(cols.get("stoch_0"), cols.get("stoch_1"))
    techs["stoch_cross_up"] = stoch_up
    if stoch_k is not None and stoch_d is not None:
        bull = stoch_k > stoch_d
        score += 6 if bull else -5
    if stoch_up:
        score += 3

    if psar is not None and close is not None:
        above_sar = close > psar
        techs["price_above_psar"] = above_sar
        score += 8 if above_sar else -6
        reasons.append(f"PSAR {'below (bull)' if above_sar else 'above (bear)'}")

    if cmf is not None:
        bull = cmf > 0
        techs["cmf_positive"] = bull
        score += 6 if bull else -4
    if mfi is not None:
        techs["mfi"] = round(mfi, 1)
        if mfi > 80:
            score -= 6
            reasons.append("MFI overbought (>80)")
        elif 40 <= mfi <= 70:
            score += 4
            reasons.append("MFI in healthy 40-70 band")

    if rsi is not None:
        techs["rsi"] = round(rsi, 1)
        if rsi < 30:
            score += 3
        elif rsi > 70:
            score -= 6
        elif 45 <= rsi <= 65:
            score += 6
            reasons.append(f"RSI {round(rsi, 1)} in momentum band")

    ad_trend = _trend(ad_line)
    techs["ad_trend"] = ad_trend
    score += 6 if ad_trend == 1 else (-4 if ad_trend == -1 else 0)

    # ── Validator (bandarmology) reads ─────────────────────────────────────
    val: dict[str, Any] = {}
    try:
        vhist = fetch_history(ticker, period="6mo", interval="1d", force=force) or []
        vres = BandarmologyAnalyzer().analyze(vhist) if vhist else {}
        val = (vres or {}).get("summary") or {}
    except Exception:  # noqa: BLE001
        val = {}

    phase = (val.get("bandar_phase") or {}).get("phase", "UNKNOWN")
    inst_flow = val.get("inst_flow", "")
    intent = val.get("current_intent", "")
    conf = val.get("conf_flow_index")
    dormant = val.get("dormant_index")

    techs["bandar_phase"] = phase
    techs["inst_flow"] = inst_flow
    techs["current_intent"] = intent

    if "ACCUMULATION" in phase:
        score += 15
        reasons.append(f"Bandar phase {phase}")
    elif "MARKUP" in phase:
        score += 5
        if inst_flow == "NET BUY":
            score += 8
        reasons.append(f"Bandar phase {phase} ({inst_flow})")
    elif "DISTRIBUTION" in phase:
        score -= 12
        reasons.append(f"Distribution phase ({phase})")

    if inst_flow == "NET BUY":
        score += 8
        reasons.append("Institutional flow NET BUY")
    elif inst_flow == "NET SELL":
        score -= 8

    if "SILENT EXIT" in intent or "DISTRIBUTION" in intent:
        score -= 10
        reasons.append(f"Hidden intent: {intent}")
    elif "ACCUM" in intent or "GUARDING" in intent:
        score += 5

    if isinstance(conf, (int, float)):
        techs["conf_flow_index"] = conf
        if conf >= 3:
            score += 5
        elif conf >= 2:
            score += 3
    if isinstance(dormant, (int, float)):
        dormant_f = _f(dormant)
        if dormant_f is not None:
            techs["dormant_index"] = round(dormant_f, 1)
            if dormant_f >= 70:
                score += 2
    # ── Regime gate ────────────────────────────────────────────────────────
    regime_read: dict[str, Any] = {}
    try:
        reg = regime_snapshot(force=force)
        regime_read = {"regime": reg.get("regime"), "as_of": reg.get("as_of_date")}
    except Exception:  # noqa: BLE001
        regime_read = {}
    r = regime_read.get("regime")
    techs["regime"] = r
    if r == "BULL":
        score += 15
        reasons.append("Regime BULL")
    elif r == "CAUTION":
        score += 5
    elif r == "BEAR":
        score -= 20
        reasons.append("Regime BEAR — risk-off")

    # ── Beta / sizing context ──────────────────────────────────────────────
    beta_read: dict[str, Any] = {}
    try:
        beta_read = beta_correlation(ticker, force=force) or {}
    except Exception:  # noqa: BLE001
        beta_read = {}
    beta1y = (beta_read.get("windows") or {}).get("1y", {}).get("beta")
    beta_class = beta_read.get("classification", "UNKNOWN")
    techs["beta_classification"] = beta_class
    if beta_class in ("ELEVATED", "HIGH-BETA"):
        score -= 4
        reasons.append(f"{beta_class} — cut size")
    elif beta_class == "DEFENSIVE":
        score += 4

    score = max(0, min(100, score))

    # ── Verdict ────────────────────────────────────────────────────────────
    bull_confluence = (
        inst_flow == "NET BUY"
        and "DISTRIBUTION" not in phase
        and "SILENT EXIT" not in intent
        and r != "BEAR"
    )
    if score >= 55 and bull_confluence:
        verdict = "ENTER_LONG"
    elif score >= 35:
        verdict = "CONDITIONAL"
    elif r == "BEAR" or score <= 10 or "DISTRIBUTION" in phase:
        verdict = "AVOID"
    else:
        verdict = "WAIT"

    # ── Entry zone / stop / targets from real data ─────────────────────────
    entry_zone: dict[str, Any] = {}
    stop_loss: float | None = None
    targets: dict[str, Any] = {}
    sizing_note = ""

    if close is not None:
        recent_low = _recent_low(history, 20)
        atr = _latest(cols.get("atr"))
        support = recent_low

        if sma20 is not None and sma50 is not None:
            lo, hi = min(sma20, sma50), max(sma20, sma50)
            entry_zone = {
                "from": round(lo, 2),
                "to": round(hi, 2),
                "reference": round(close, 2),
                "note": "pullback zone between SMA20/SMA50",
            }
        elif sma20 is not None:
            entry_zone = {
                "from": round(sma20 * 0.99, 2),
                "to": round(sma20 * 1.01, 2),
                "reference": round(close, 2),
                "note": "around SMA20",
            }

        stop_candidates = [x for x in (support,) if x is not None]
        if atr is not None:
            stop_candidates.append(close - 2.0 * atr)
        stop_loss = min(stop_candidates) if stop_candidates else None

        if stop_loss is not None and close > stop_loss:
            risk = close - stop_loss
            targets = {
                "target1": round(close + risk, 2),
                "target2": round(close + 2 * risk, 2),
                "rr": 1.0,
            }
        elif stop_loss is not None:
            targets = {"note": "stop above price — no long setup"}

        size_mult = 0.5 if beta_class in ("ELEVATED", "HIGH-BETA") else 1.0
        if stop_loss is not None and close > stop_loss:
            sizing_note = (
                f"Risk {RISK_PCT * 100:.0f}% of capital; stop {stop_loss} "
                f"(Δ {abs(close - stop_loss):.0f} pts); "
                f"{'half size' if size_mult < 1 else 'full size'} — {beta_class}"
            )

    # ── Triggers for conditional setups ────────────────────────────────────
    triggers: list[str] = []
    if verdict == "CONDITIONAL":
        if bull_confluence == False and inst_flow != "NET BUY":
            triggers.append("Institutional flow flips to NET BUY")
        if not (r == "BULL" or r == "CAUTION"):
            triggers.append("Regime improves to BULL/CAUTION")
        if techs.get("price_above_psar") == False:
            triggers.append("Price reclaims above PSAR")
        if techs.get("macd_cross_up") == False:
            triggers.append("MACD line crosses above signal")
        if techs.get("stoch_cross_up") == False:
            triggers.append("Stochastic %K crosses above %D")
        if techs.get("golden_cross_20_50") == False:
            triggers.append("SMA20 crosses above SMA50")

    plan = {
        "ticker": ticker,
        "verdict": verdict,
        "score": score,
        "bias": "bullish"
        if verdict in ("ENTER_LONG", "CONDITIONAL")
        else "bearish"
        if verdict == "AVOID"
        else "neutral",
        "entry_zone": entry_zone,
        "stop_loss": round(stop_loss, 2) if stop_loss is not None else None,
        "targets": targets,
        "position_sizing": sizing_note,
        "regime": regime_read,
        "beta": {
            "classification": beta_class,
            "beta_1y": round(beta1y, 3) if beta1y is not None else None,
        },
        "technicals": {k: v for k, v in techs.items()},
        "validator": {
            "bandar_phase": phase,
            "inst_flow": inst_flow,
            "current_intent": intent,
            "conf_flow_index": conf,
            "dormant_index": dormant,
        },
        "conditions": {
            "met": [r for r in reasons if not r.startswith("Regime")][:8],
            "missing": triggers[:6],
        },
        "rationale": reasons[:12],
        "narration": "",
        "narration_model": "",
    }
    plan["narration"], plan_used_ai = _narrate(plan)
    plan["narration_model"] = MODEL if plan_used_ai else ""
    return plan
