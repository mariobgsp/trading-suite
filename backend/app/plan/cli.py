"""CLI for the plan: tonight's answer without the browser.

Run through the runner (`./trading-suite plan ...`) or directly:

    cd backend && .venv/bin/python -m app.plan.cli plan
"""

from __future__ import annotations

import argparse
import json
from datetime import date

from app.plan import detail, method_card, plan, size_ticket
from app.plan import momentum as MO


def _pct(v: float | None) -> str:
    return "—" if v is None else f"{v * 100:.1f}%"


def _num(v: float | None, fmt: str = "{:+,.2f}") -> str:
    return "—" if v is None else fmt.format(v)


# ── text renderers ───────────────────────────────────────────────────────────
def _print_plan(d: dict) -> None:
    v = d["verdict"]
    print(f"{d['session_label']} — {d['headline']}")
    print(f"verdict: {v['state']} · {v['action']}")
    print(f"next session: {d['next_session']} ({d['next_session_basis']})")
    reg = d["regime"]
    print(
        f"regime: {reg['band']} · breadth {reg['breadth'] * 100:.1f}% of "
        f"{reg['universe_size']} names · {reg['action']}"
    )

    cands = d["candidates"]
    print(f"\ncandidates: {len(cands)}")
    for c in cands:
        g = c["geometry"]
        print(
            f"  {c['ticker']:<8} close {c['close']:>11,.0f}  target {g['target_price']:>11,.0f}  "
            f"stop {g['stop_price']:>11,.0f}  size {g['position_idr'] or '—'}"
        )
    if not cands:
        print("watchlist (one condition away):")
        for w in d["watchlist"][:8]:
            print(f"  {w['ticker']:<8} blocked by {w['blocked_by']:<18} {w['distance_text']}")

    ev = d["evidence"]
    print(f"\nevidence: {ev['family']} x {ev['exit_method']}")
    print(
        f"  searched : win {_pct(ev['win_rate'])}  avg {_num(ev['avg_ret_pct'])}%  "
        f"trades {ev['oos_trades']}"
    )
    cor = d.get("corrected") or {}
    if cor:
        print(
            f"  corrected: win {_pct(cor.get('win_rate'))}  avg {_num(cor.get('avg_ret_pct'))}%  "
            f"trades {cor.get('oos_trades')}"
        )
    cov = d["coverage"]
    print(
        f"\ncoverage: {cov.get('names_on_session')}/{cov.get('codes')} names on session, "
        f"phantom bars dropped {cov.get('phantom_bars_dropped')}"
    )
    checks = v.get("integrity") or []
    failed = [c["key"] for c in checks if not c["ok"]]
    print(
        f"integrity: {len(checks) - len(failed)}/{len(checks)} checks pass"
        + (f" — FAILED: {', '.join(failed)}" if failed else "")
    )


def _print_name(d: dict) -> None:
    print(f"{d['ticker']} — in plan: {d['in_plan']} · as of {d['as_of']}")
    print(
        f"close {d['close']} · rs {d['rs_rating']} · breadth {d['breadth']:.2f} · "
        f"breakout level {d['breakout_level']}"
    )
    for g in d["gates"]:
        mark = "✓" if g["passed"] else "✗"
        print(f"  {mark} {g['label']:<32} {g['text']}")
    if d["geometry"]:
        g = d["geometry"]
        print(
            f"geometry: target {g['target_price']} · stop {g['stop_price']} · "
            f"size {g['position_idr'] or '—'}"
        )


def _print_method(d: dict) -> None:
    print(f"method: {d['family']} x {d['exit_method']}")
    print(f"family: {d['family_summary']}")
    ev = d["evidence"]
    print(f"searched : win {_pct(ev['win_rate'])}  avg {_num(ev['avg_ret_pct'])}%")
    cor = d.get("corrected") or {}
    print(f"corrected: win {_pct(cor.get('win_rate'))}  avg {_num(cor.get('avg_ret_pct'))}%")
    hold = d.get("holdout") or {}
    print(f"holdout verdict: {hold.get('verdict')}")
    shipped = d.get("shipped") or {}
    print(f"shipped chain measured at: {shipped.get('summary') or shipped}")


def _print_size(d: dict) -> None:
    g = d["geometry"]
    print(f"price {d['price']} · exit {d['exit_method']}")
    print(
        f"target {g['target_price']} · stop {g['stop_price']} · tick {g['tick_idr']}"
    )
    print(
        f"position {g['position_idr'] or '—'} ({g['lots'] or '—'} lots) · "
        f"basis {g['sizing_basis']} · participation {g['participation_pct']}"
    )
    for note in g.get("notes") or []:
        print(f"  {note}")


def _print_momentum(d: dict) -> None:
    print(f"momentum scan — {d['as_of']}")
    print(f"entry: {d['entry']['description']}")
    print(f"exit : {d['exit']['description']}")
    ev = d["evidence"]
    print(
        f"evidence ({ev['exit_method']}): win {_pct(ev['win_rate'])}  "
        f"avg {_num(ev['avg_ret_pct'])}%  trades {ev['oos_trades']}"
    )
    print(d["label"])
    print(f"\nhits: {d['hit_count']}")
    for h in d["hits"]:
        print(
            f"  {h['ticker']:<8} close {h['close']:>11,.0f}  mom {h['mom_pct']:+.2f}%  "
            f"target {h['target_price']:>11,.0f}  stop {h['stop_price']:>11,.0f}  "
            f"size {h['position_idr'] or '—'}"
        )
    print("\nmeasured momentum rows (best average first):")
    for r in d["ledger"][:12]:
        print(
            f"  {r['exit_method']:<16} win {_pct(r['win_rate']):>8}  "
            f"avg {_num(r['avg_ret_pct'])}%  n {r['oos_trades']}"
        )


# ── subcommand handlers ──────────────────────────────────────────────────────
def _cmd_plan(args: argparse.Namespace) -> int:
    when = date.fromisoformat(args.as_of) if args.as_of else None
    result = plan(when, args.exit).as_dict()
    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        _print_plan(result)
    return 0


def _cmd_name(args: argparse.Namespace) -> int:
    result = detail(args.ticker)
    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        _print_name(result)
    return 0


def _cmd_method(args: argparse.Namespace) -> int:
    result = method_card()
    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        _print_method(result)
    return 0


def _cmd_size(args: argparse.Namespace) -> int:
    result = size_ticket(args.price, args.turnover, args.risk_budget, args.exit)
    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        _print_size(result)
    return 0


def _cmd_momentum(args: argparse.Namespace) -> int:
    when = date.fromisoformat(args.as_of) if args.as_of else None
    result = MO.scan(when)
    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        _print_momentum(result)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="trading-suite plan",
        description="The nightly IDX plan, from the CLI.",
    )
    sub = p.add_subparsers(dest="command", required=True)

    sp = sub.add_parser("plan", help="tonight's verdict")
    sp.add_argument("--as-of", help="replay an earlier session (YYYY-MM-DD)")
    sp.add_argument("--exit", help="measured exit name (default lt_13_35_95)")
    sp.add_argument("--json", action="store_true")
    sp.set_defaults(func=_cmd_plan)

    sn = sub.add_parser("name", help="one ticker's gates")
    sn.add_argument("ticker")
    sn.add_argument("--json", action="store_true")
    sn.set_defaults(func=_cmd_name)

    sm = sub.add_parser("method", help="the rule chain and its proof")
    sm.add_argument("--json", action="store_true")
    sm.set_defaults(func=_cmd_method)

    ss = sub.add_parser("size", help="size one order")
    ss.add_argument("--price", required=True, type=float)
    ss.add_argument("--turnover", type=float, default=None)
    ss.add_argument("--risk-budget", type=float, default=None)
    ss.add_argument("--exit", default=None)
    ss.add_argument("--json", action="store_true")
    ss.set_defaults(func=_cmd_size)

    mo = sub.add_parser("momentum", help="the momentum scan (never a ticket)")
    mo.add_argument("--as-of", help="replay an earlier session (YYYY-MM-DD)")
    mo.add_argument("--json", action="store_true")
    mo.set_defaults(func=_cmd_momentum)

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
