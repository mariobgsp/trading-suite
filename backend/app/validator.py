"""Bandarmology / smart-money validator service.

Faithful port of ihsg-stock-validator/main.py (StockAnalyzer) to a JSON
service: same indicator math, bandar phase detection, hidden-intent radar,
liquidity classification — but returns structured results for the web UI
instead of printing.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from app.indicators import history_to_frame


def _safe_float(val: Any) -> float | None:
    try:
        v = float(val)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


class BandarmologyAnalyzer:
    """Smart-money analysis for a single ticker (validator algorithm)."""

    def __init__(self) -> None:
        pass

    # ── indicators (verbatim from ihsg-stock-validator) ───────────────────

    def calculate_rsi(self, series: pd.Series, length: int = 14) -> pd.Series:
        delta = series.diff()
        gain = (delta.where(delta > 0, 0)).ewm(alpha=1 / length, min_periods=length).mean()
        loss = (-delta.where(delta < 0, 0)).ewm(alpha=1 / length, min_periods=length).mean()
        rs = gain / loss
        return pd.Series(100 - (100 / (1 + rs)))

    def calculate_vwap_rolling(self, df: pd.DataFrame, window: int = 20) -> pd.Series:
        v = df["Volume"]
        p = df["Close"]
        return pd.Series((p * v).rolling(window).sum() / v.rolling(window).sum())

    def calculate_nvi(self, close: pd.Series, volume: pd.Series) -> pd.Series:
        nvi_vals: list[float] = [1000.0]
        vol_arr = volume.values
        close_arr = close.values
        for i in range(1, len(close)):
            if vol_arr[i] < vol_arr[i - 1]:
                new_val = nvi_vals[-1] * (close_arr[i] / close_arr[i - 1])
                nvi_vals.append(new_val)
            else:
                nvi_vals.append(nvi_vals[-1])
        return pd.Series(nvi_vals, index=close.index)

    def calculate_advanced_metrics(self, df: pd.DataFrame) -> pd.DataFrame:
        change = df["Close"].diff()
        df["inst_flow"] = change * df["Volume"]
        df["inst_flow_ma"] = df["inst_flow"].rolling(5).mean()

        try:
            from core.indicators import cmf, mfi  # pyright: ignore[reportAttributeAccessIssue]

            df["cmf"] = cmf(df, period=20)
            df["mfi"] = mfi(df, period=14)
        except Exception:  # noqa: BLE001 - money-flow extras must never break analysis
            df["cmf"] = float("nan")
            df["mfi"] = float("nan")

        epsilon = 1e-7
        abs_return = df["Close"].pct_change().abs()
        dollar_vol = df["Close"] * df["Volume"]
        df["retail_liquidity"] = (abs_return / (dollar_vol + epsilon)) * 1_000_000_000
        df["inv_retail_liquidity"] = (dollar_vol / (abs_return + epsilon)) / 1_000_000_000

        vol_ratio = df["Volume"] / (df["Volume"].rolling(20).max() + epsilon)
        range_ratio = (df["High"] - df["Low"]) / (
            (df["High"] - df["Low"]).rolling(20).max() + epsilon
        )
        df["dormant_index"] = (1 - ((vol_ratio + range_ratio) / 2)) * 100

        c1 = (df["Close"] > df["Close"].ewm(span=20).mean()).astype(int)
        c2 = (df["Close"] > df["vwap"]).astype(int)
        c3 = (df["nvi"] > df["nvi_ma"]).astype(int)
        c4 = (df["Volume"] > df["vol_ma"]).astype(int)
        df["conf_flow_index"] = c1 + c2 + c3 + c4
        return df

    # ── analysis ──────────────────────────────────────────────────────────

    def check_liquidity(self, df: pd.DataFrame) -> dict[str, Any]:
        avg_value = (df["Close"] * df["Volume"]).rolling(20).mean().iloc[-1]
        avg_value = _safe_float(avg_value) or 0.0

        if avg_value > 10_000_000_000:
            status, level = "HIGH LIQUIDITY", "high"
        elif avg_value > 1_000_000_000:
            status, level = "LIQUID", "liquid"
        elif avg_value > 200_000_000:
            status, level = "SMALL CAP (Volatile)", "small"
        else:
            status, level = "ILLIQUID", "illiquid"

        return {
            "status": status,
            "level": level,
            "avg_value_idr": round(avg_value, 0),
            "avg_value_display": _format_idr(avg_value),
            "is_small_cap": level in ("small", "illiquid"),
        }

    def get_bandar_phase(self, price: float, vwap: float) -> dict[str, Any]:
        if vwap == 0:
            return {"phase": "UNKNOWN", "gap_pct": 0.0}
        diff = ((price - vwap) / vwap) * 100
        if diff < -2.0:
            phase = "ACCUMULATION (Undervalued)"
        elif -2.0 <= diff <= 2.0:
            phase = "BASE / HOLD (Fair Value)"
        else:
            phase = "MARKUP / DISTRIBUTION (Overvalued)"
        return {"phase": phase, "gap_pct": round(diff, 2)}

    def detect_hidden_intent(
        self,
        curr: pd.Series,
        prev: pd.Series,
        vwap: float,
        is_small_cap: bool = False,
    ) -> str:
        vol = _safe_float(curr["Volume"]) or 0.0
        avg_vol = _safe_float(curr["vol_ma"]) or 0.0
        if avg_vol <= 0:
            avg_vol = 1.0

        range_hl = (_safe_float(curr["High"]) or 0.0) - (_safe_float(curr["Low"]) or 0.0)
        if range_hl == 0:
            mfm = 0.0
        else:
            mfm = (
                (_safe_float(curr["Close"]) or 0.0)
                - (_safe_float(curr["Low"]) or 0.0)
                - ((_safe_float(curr["High"]) or 0.0) - (_safe_float(curr["Close"]) or 0.0))
            ) / range_hl

        prev_close = _safe_float(prev["Close"]) or 0.0
        curr_close = _safe_float(curr["Close"]) or 0.0
        chg = (curr_close - prev_close) / prev_close if prev_close > 0 else 0.0
        is_price_up = chg > 0.001
        is_price_down = chg < -0.001
        is_flat = abs(chg) < 0.005

        vol_threshold_spike = 1.1 if is_small_cap else 1.3
        vol_threshold_low = 0.5 if is_small_cap else 0.6

        if curr_close > vwap * 1.02 and vol > avg_vol and mfm < -0.1:
            return "DISTRIBUTION (Profit Taking)"
        if is_price_up and mfm < -0.1:
            return "SILENT EXIT (Jebakan)"
        if (
            is_small_cap
            and vol < vol_threshold_low
            and is_flat
            and curr_close >= (_safe_float(curr["Low"]) or 0.0)
        ):
            return "GUARDING (Supply Dried)"
        if (is_price_down or is_flat) and mfm > 0.05:
            return "SILENT ACCUM (Serok)"
        if vol > vol_threshold_spike * avg_vol and is_flat:
            return "ABSORPTION (Siap Naik)" if mfm > 0 else "CHURN (Tukar Barang)"
        if is_price_up and vol > avg_vol:
            return "MARKUP (Strong Buy)"
        if is_price_down and vol > avg_vol:
            return "MARKDOWN (Strong Sell)"
        if vol < vol_threshold_low * avg_vol:
            return (
                "ABANDONED (Ditinggal)"
                if is_small_cap and is_price_down
                else "LOW VOL (Wait & See)"
            )
        return "NORMAL"

    # ── entry point ───────────────────────────────────────────────────────

    def analyze(self, history: list[dict[str, Any]], days: int = 30) -> dict[str, Any]:
        df = history_to_frame(history)
        if len(df) < 30:
            return {"error": "Not enough data (need >= 30 bars)"}

        df["vol_ma"] = df["Volume"].rolling(20).mean()
        df["vwap"] = self.calculate_vwap_rolling(df, 20)
        df["nvi"] = self.calculate_nvi(pd.Series(df["Close"]), pd.Series(df["Volume"]))
        df["nvi_ma"] = df["nvi"].rolling(20).mean()
        df = self.calculate_advanced_metrics(df)

        curr = df.iloc[-1]
        prev = df.iloc[-2]
        liq = self.check_liquidity(df)

        chg_pct = 0.0
        prev_close_val = _safe_float(prev["Close"]) or 0.0
        curr_close_val = _safe_float(curr["Close"]) or 0.0
        if prev_close_val > 0:
            chg_pct = (curr_close_val - prev_close_val) / prev_close_val * 100

        rsi = self.calculate_rsi(pd.Series(df["Close"])).iloc[-1]
        vwap = _safe_float(curr["vwap"]) or 0.0
        phase = self.get_bandar_phase(_safe_float(curr["Close"]) or 0.0, vwap)
        nvi_curr = _safe_float(curr["nvi"]) or 0.0
        nvi_ma = _safe_float(curr["nvi_ma"]) or 0.0
        sm_status = "Inflow (Akumulasi)" if nvi_curr > nvi_ma else "Outflow (Distribusi)"

        inst_flow = _safe_float(curr["inst_flow_ma"]) or 0.0
        inst_flow_str = "NET BUY" if inst_flow > 0 else "NET SELL"
        dormant = _safe_float(curr["dormant_index"]) or 0.0
        conf_raw = _safe_float(curr["conf_flow_index"]) or 0
        cmf_val = _safe_float(curr.get("cmf"))
        mfi_val = _safe_float(curr.get("mfi"))
        try:
            conf_idx = int(conf_raw)
        except (OverflowError, ValueError):
            conf_idx = 0
        if conf_idx == 4:
            conf_str = "Strong"
        elif conf_idx == 3:
            conf_str = "Good"
        elif conf_idx == 2:
            conf_str = "Neutral"
        else:
            conf_str = "Weak"

        # Historical intent radar — newest session first (descending).
        radar: list[dict[str, Any]] = []
        subset = df.iloc[-days:]
        for i in range(len(subset)):
            idx = subset.index[i]
            loc = df.index.get_loc(idx)
            if not isinstance(loc, int) or loc == 0:
                continue
            row_curr = df.iloc[loc]
            row_prev = df.iloc[loc - 1]
            pct = 0.0
            rp_close = _safe_float(row_prev["Close"]) or 0.0
            rc_close = _safe_float(row_curr["Close"]) or 0.0
            if rp_close > 0:
                pct = (rc_close - rp_close) / rp_close * 100
            rc_conf_raw = _safe_float(row_curr["conf_flow_index"]) or 0
            try:
                rc_conf = int(rc_conf_raw)
            except (OverflowError, ValueError):
                rc_conf = 0
            intent = self.detect_hidden_intent(
                row_curr, row_prev, _safe_float(row_curr["vwap"]) or 0.0, liq["is_small_cap"]
            )
            radar.append(
                {
                    "date": str(idx.date()) if hasattr(idx, "date") else str(idx),
                    "close": _safe_float(row_curr["Close"]),
                    "change_pct": round(pct, 2),
                    "vwap": _safe_float(row_curr["vwap"]),
                    "inst_flow": _safe_float(row_curr["inst_flow"]),
                    "absorption": _safe_float(row_curr["inv_retail_liquidity"]),
                    "retail": _safe_float(row_curr["retail_liquidity"]),
                    "conf_flow": rc_conf,
                    "intent": intent,
                }
            )
        radar.reverse()  # newest session first in the UI table

        current_intent = self.detect_hidden_intent(curr, prev, vwap, liq["is_small_cap"])

        return {
            "summary": {
                "close": _safe_float(curr["Close"]),
                "change_pct": round(chg_pct, 2),
                "liquidity": liq,
                "vwap": round(vwap, 0),
                "bandar_phase": phase,
                "inst_flow": inst_flow_str,
                "inst_flow_ma": round(inst_flow, 0),
                "conf_flow_index": conf_idx,
                "conf_flow_label": conf_str,
                "dormant_index": round(dormant, 1),
                "cmf": round(cmf_val, 3) if cmf_val is not None else None,
                "mfi": round(mfi_val, 1) if mfi_val is not None else None,
                "rsi": round(_safe_float(rsi) or 0.0, 1),
                "nvi_status": sm_status,
                "small_cap_mode": liq["is_small_cap"],
                "current_intent": current_intent,
            },
            "radar": radar,
        }


def _format_idr(val: float) -> str:
    if val >= 1_000_000_000_000:
        return f"Rp {val / 1_000_000_000_000:.1f} T"
    if val >= 1_000_000_000:
        return f"Rp {val / 1_000_000_000:.1f} M"
    if val >= 1_000_000:
        return f"Rp {val / 1_000_000:.1f} Jt"
    return f"Rp {val:,.0f}"
