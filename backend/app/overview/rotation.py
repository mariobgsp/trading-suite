"""Relative-rotation maps for sectors, conglomerates and industries.

The calculation is deliberately simple and documented:

    group return[t] = equal-weight mean of member returns[t]
    group index     = cumulative product of (1 + return)
    benchmark index = cumulative product of IHSG returns
    weekly          = Friday close
    RS ratio        = 100 * (group / benchmark) / SMA10(group / benchmark)
    RS momentum     = 100 * RS ratio / RS ratio shifted 4 weeks

Quadrants are read at 100. A group without enough weekly history is omitted
rather than zero-filled.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.konglo import KONGLO_GROUPS

MIN_WEEKLY_POINTS = 12
TAIL_POINTS = 8
CONGLOMERATE_ALIASES = {
    "Astra Group": "Astra Group",
    "Djarum (Hartono)": "Djarum Group",
    "Widjaja Family (Sinarmas)": "Widjaja Family",
    "Prajogo Pangestu (Barito)": "Prajogo Pangestu",
    "Anthony Salim": "Anthony Salim",
    "Aburizal Bakrie": "Aburizal Bakrie",
    "James Riady (Lippo)": "James Riady",
    "Low Tuck Kwong": "Low Tuck Kwong",
    "Happy Hapsoro": "Happy Hapsoro",
    "Tommy Soeharto (Humpuss)": "Tommy Soeharto",
    "Eddy Kusnadi Sariaatmadja": "Eddy Kusnadi Sariaatmadja",
    "Dato Sri Tahir (Mayapada)": "Dato Sri Tahir",
    "Garibaldi Thohir (Adaro)": "Garibaldi Thohir",
    "Hashim Djojohadikusumo": "Hashim Djojohadikusumo",
    "Hary Tanoe (MNC)": "Hary Tanoe",
    "Hermanto Tanoko": "Hermanto Tanoko",
    "Otto Toto Sugiri": "Otto Toto Sugiri",
    "Saratoga/Merdeka (E. Soeryadjaya)": "Saratoga / Merdeka",
    "Northstar (Samin Tan)": "Northstar Group",
    "Teddy Rachmat (Triputra)": "Teddy Rachmat",
}


def _rows_for(joined: list[dict[str, Any]], kind: str) -> dict[str, list[dict[str, Any]]]:
    groups: dict[str, list[dict[str, Any]]] = {}
    if kind == "conglomerate":
        by_ticker = {str(row["ticker"]): row for row in joined}
        for name, tickers in KONGLO_GROUPS.items():
            members = [by_ticker[t] for t in tickers if t in by_ticker]
            if len(members) >= 2:
                groups[CONGLOMERATE_ALIASES.get(name, name)] = members
        return groups

    for row in joined:
        name = str(row.get(kind) or "").strip()
        if not name:
            continue
        groups.setdefault(name, []).append(row)
    return groups


def _return_matrix(members: list[dict[str, Any]]) -> pd.Series:
    series: list[pd.Series] = []
    seen: set[str] = set()
    for row in members:
        ticker = str(row.get("ticker"))
        if ticker in seen:
            continue
        seen.add(ticker)
        closes = row.get("closes")
        if not isinstance(closes, pd.Series) or len(closes) < 5:
            continue
        returns = pd.to_numeric(closes, errors="coerce").pct_change().dropna()
        if not returns.empty:
            series.append(returns)
    if not series:
        return pd.Series(dtype=float)
    return pd.concat(series, axis=1).mean(axis=1, skipna=True).dropna()


def _quadrant(ratio: float, momentum: float) -> str:
    if ratio >= 100.0 and momentum >= 100.0:
        return "leading"
    if ratio >= 100.0:
        return "weakening"
    if momentum >= 100.0:
        return "improving"
    return "lagging"


def build_kind(
    joined: list[dict[str, Any]],
    benchmark: pd.Series,
    kind: str,
) -> dict[str, Any]:
    if not isinstance(benchmark, pd.Series) or len(benchmark) < 60:
        return {"available": False, "points": [], "groups": [], "reason": "benchmark history unavailable"}

    groups = _rows_for(joined, kind)
    points: list[dict[str, Any]] = []
    table: list[dict[str, Any]] = []
    for name, members in groups.items():
        if kind == "industry" and len(members) < 5:
            continue
        if len(members) < 2:
            continue
        returns = _return_matrix(members)
        if len(returns) < 30:
            continue
        group_index = (1.0 + returns).cumprod()
        bench_returns = (
            pd.to_numeric(benchmark, errors="coerce")
            .pct_change()
            .reindex(returns.index)
            .fillna(0.0)
        )
        bench_index = (1.0 + bench_returns).cumprod()
        weekly_group = group_index.resample("W-FRI").last().dropna()
        weekly_bench = bench_index.resample("W-FRI").last().dropna()
        aligned = pd.concat(
            [weekly_group.rename("group"), weekly_bench.rename("bench")], axis=1
        ).dropna()
        if len(aligned) < MIN_WEEKLY_POINTS:
            continue
        rs = aligned["group"] / aligned["bench"]
        ratio = 100.0 * rs / rs.rolling(10, min_periods=5).mean()
        momentum = 100.0 * ratio / ratio.shift(4)
        valid = pd.concat([ratio.rename("ratio"), momentum.rename("momentum")], axis=1).dropna()
        if len(valid) < MIN_WEEKLY_POINTS:
            continue
        current = valid.iloc[-1]
        quadrant = _quadrant(float(current["ratio"]), float(current["momentum"]))
        tail = valid.tail(TAIL_POINTS)
        points.append(
            {
                "group": name,
                "x": round(float(current["ratio"]), 2),
                "y": round(float(current["momentum"]), 2),
                "quadrant": quadrant,
                "members": len(members),
                "tail": [
                    [round(float(row["ratio"]), 2), round(float(row["momentum"]), 2)]
                    for _, row in tail.iterrows()
                ],
            }
        )
        changes = [
            float(row["change_pct"])
            for row in members
            if row.get("change_pct") is not None
        ]
        table.append(
            {
                "group": name,
                "quadrant": quadrant,
                "change_pct": round(sum(changes) / len(changes), 2) if changes else None,
                "members": len(members),
                "x": round(float(current["ratio"]), 2),
                "y": round(float(current["momentum"]), 2),
            }
        )

    table.sort(key=lambda row: (row["quadrant"], -(row["change_pct"] or -999)))
    return {
        "available": bool(points),
        "points": points,
        "groups": table,
        "count": len(points),
    }


def build_all(inputs: dict[str, Any]) -> dict[str, Any]:
    joined = inputs.get("joined") or []
    benchmark = inputs.get("benchmark")
    return {
        "sectors": build_kind(joined, benchmark, "sector"),
        "conglomerates": build_kind(joined, benchmark, "conglomerate"),
        "industries": build_kind(joined, benchmark, "industry"),
    }
