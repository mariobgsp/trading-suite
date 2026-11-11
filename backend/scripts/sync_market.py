"""Weekly Yahoo → local SQLite snapshot, then warm the persisted plan.

Run it from the repository root:

    ./trading-suite sync-data            # fetch the study's 5y set, import, warm
    ./trading-suite sync-data --no-fetch # import the current study CSVs only

The study remains the transport of record (it uses curl with the UA Yahoo
accepts and a resumable manifest). This script wraps its fetch, imports the
result into `backend/data/market.db`, and computes the plan once so the app's
first request after a restart is a cache read.

The run is exclusive: a second sync while the first is alive exits with code 3
instead of interleaving two full snapshots.

The command surface emits one JSON line with `state` one of:

  running, success, failed, lock_busy, fetch_failed, repair_failed, import_failed,
  warm_failed

`running` is the initial stderr line; the others are the terminal result.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app import market_store
from app.config import DATA_DIR

LOCK_PATH = DATA_DIR / "market-sync.lock"


def _default_study_root() -> Path:
    """Resolve the study checkout without importing app.plan.

    Importing the plan package here would initialise its active bar source
    before the import, so the warmed plan would be keyed to the old CSV source
    instead of the store. Keep this path resolution local.
    """
    override = os.getenv("TRADING_DOCS_DIR")
    if override:
        return Path(override)
    return ROOT.parents[1] / "trading-backtest-docs"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--study-root", type=Path, default=_default_study_root())
    parser.add_argument("--no-fetch", action="store_true", help="import the existing CSVs only")
    parser.add_argument(
        "--no-repair",
        action="store_true",
        help="skip the study's phantom-bar repair before importing",
    )
    parser.add_argument("--sleep", type=float, default=0.7, help="seconds between Yahoo requests")
    parser.add_argument("--limit", type=int, default=None, help="fetch at most N symbols (testing)")
    parser.add_argument("--no-warm", action="store_true", help="import but do not compute the plan")
    parser.add_argument("--json", action="store_true")
    return parser


def _lock():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    handle = open(LOCK_PATH, "w")
    try:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        return None
    return handle


def _fetch(study_root: Path, sleep: float, limit: int | None) -> None:
    script = study_root / "src" / "fetch_ohlcv.py"
    if not script.exists():
        raise RuntimeError(f"the study fetcher is missing at {script}")
    command = [sys.executable, "-u", str(script), "--force", "--sleep", str(sleep)]
    if limit is not None:
        command.extend(["--limit", str(limit)])
    subprocess.run(command, cwd=str(study_root), check=True)


def _repair_phantoms(study_root: Path) -> None:
    """Run the study's own offline repair before importing.

    A fresh 5-year fetch can leave an old ticker file with rows before the
    benchmark's new start. The study's repair drops the degenerate rows and
    refreshes the manifest; without it the plan correctly refuses the source
    with DATA_UNSAFE (no_phantom_bars).
    """
    script = study_root / "scripts" / "repair_phantom_bars.py"
    if not script.exists():
        return
    subprocess.run([sys.executable, str(script), "--apply"], cwd=str(study_root), check=True)


def _warm_plan() -> dict:
    from app import plan

    # The store changed: drop both the in-memory frames and the persisted plan.
    plan.invalidate()
    started = time.time()
    payload = plan.plan_payload()
    return {
        "seconds": round(time.time() - started, 2),
        "as_of": payload.get("as_of"),
        "source": payload.get("source"),
        "cached": True,
    }


def _paper_line(step: dict[str, object]) -> str:
    """One line a timer log can be read from: orders, fills, watermark."""
    orders = step.get("orders")
    settle = step.get("settle")
    created = len(orders["created"]) if isinstance(orders, dict) and orders.get("created") else 0
    fills = len(settle["fills"]) if isinstance(settle, dict) and settle.get("fills") else 0
    through = settle.get("settled_through") if isinstance(settle, dict) else None
    return f"paper book: {created} order(s), {fills} fill(s), settled through {through}"


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    study_root = args.study_root.expanduser().resolve()
    started = time.time()
    lock = _lock()
    if lock is None:
        print(
            json.dumps(
                {"ok": False, "state": "lock_busy", "error": "another sync is already running"}
            )
        )
        return 3
    result: dict = {"ok": False, "state": "running", "study_root": str(study_root)}
    try:
        if not args.no_fetch:
            print(f"syncing Yahoo data through {study_root}", file=sys.stderr)
            _fetch(study_root, args.sleep, args.limit)
            result["fetched"] = True
        else:
            result["fetched"] = False

        if not args.no_repair:
            try:
                _repair_phantoms(study_root)
                result["repaired"] = True
            except subprocess.CalledProcessError as exc:
                result["state"] = "repair_failed"
                result["error"] = f"the phantom repair failed with exit code {exc.returncode}"
                print(json.dumps(result, default=str))
                return 1

        try:
            snapshot = market_store.import_study(study_root)
        except Exception as exc:  # noqa: BLE001 - distinguish the import from the fetch
            result["state"] = "import_failed"
            result["error"] = str(exc)
            print(json.dumps(result, default=str))
            return 1
        result["snapshot"] = snapshot
        result["db"] = str(market_store.MARKET_DB)
        if not snapshot:
            raise RuntimeError("the import produced no snapshot")
        print(
            f"imported {snapshot.get('symbols')} symbols / {snapshot.get('rows')} rows "
            f"as of {snapshot.get('as_of')}",
            file=sys.stderr,
        )

        if not args.no_warm:
            print("warming the persisted plan", file=sys.stderr)
            try:
                result["plan"] = _warm_plan()
            except Exception as exc:  # noqa: BLE001 - the data is valid even if the screen fails
                result["state"] = "warm_failed"
                result["plan_error"] = str(exc)
                print(f"plan warm failed: {exc}", file=sys.stderr)
                return 1

        # The paper book runs here and nowhere else: orders come from the plan
        # just warmed, settlement fills them at the session open that arrived in
        # this snapshot. A failure is reported but does not fail the sync - the
        # bars are good even when the book cannot book them.
        try:
            from app import paper  # local: the sync must still import bars without pandas

            step = paper.step()
            result["paper"] = step
            paper_line = _paper_line(step)
        except Exception as exc:  # noqa: BLE001 - a paper failure is not a data failure
            paper_line = ""
            result["paper_error"] = str(exc)
            print(f"paper book failed: {exc}", file=sys.stderr)

        result["ok"] = True
        result["state"] = "success"
        result["seconds"] = round(time.time() - started, 1)
        if args.json:
            print(json.dumps(result, default=str))
        else:
            print(
                f"synced {snapshot.get('symbols')} symbols, {snapshot.get('rows')} rows, "
                f"as of {snapshot.get('as_of')} in {result['seconds']}s"
            )
            if result.get("plan"):
                print(f"plan warm: {result['plan']['seconds']}s")
            if paper_line:
                print(paper_line)
        return 0
    except subprocess.CalledProcessError as exc:
        result["state"] = "fetch_failed"
        result["error"] = f"the study fetch failed with exit code {exc.returncode}"
        print(json.dumps(result, default=str))
        return 1
    except Exception as exc:  # noqa: BLE001 - one clear failure line for the timer
        result["state"] = "failed"
        result["error"] = str(exc)
        print(json.dumps(result, default=str))
        return 1
    finally:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        lock.close()


if __name__ == "__main__":
    raise SystemExit(main())
