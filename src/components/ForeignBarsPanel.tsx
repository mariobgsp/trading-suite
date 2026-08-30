"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { api, fmtNum, type ForeignFlowUniverse } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";

type Props = {
  enabled: boolean;
  onToggle: (v: boolean) => void;
};

export default function ForeignBarsPanel({ enabled, onToggle }: Props) {
  const [expanded, setExpanded] = useState(enabled);

  // When disabled, interval null = no fetch/poll, no initial load
  const universe = usePolling<ForeignFlowUniverse>(
    () => api.getCached<ForeignFlowUniverse>("/api/intel/foreign/universe"),
    enabled ? 60000 : null,
    enabled ? "foreign-universe" : "disabled",
    { cacheKey: enabled ? "/api/intel/foreign/universe" : undefined },
  );

  const rows = useMemo(() => {
    const r = universe.data?.rows ?? [];
    return r.filter(
      (x) =>
        typeof x.net_foreign_idr === "number" &&
        typeof x.foreign_buy_lots === "number" &&
        typeof x.foreign_sell_lots === "number",
    );
  }, [universe.data]);

  const topBuy = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.foreign_buy_lots - a.foreign_buy_lots)
        .slice(0, 10),
    [rows],
  );
  const topSell = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.foreign_sell_lots - a.foreign_sell_lots)
        .slice(0, 10),
    [rows],
  );
  const maxBuy = topBuy[0]?.foreign_buy_lots || 1;
  const maxSell = topSell[0]?.foreign_sell_lots || 1;

  return (
    <div className="panel mt-4 overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              const next = !expanded;
              setExpanded(next);
              if (next && !enabled) onToggle(true);
            }}
            className="flex items-center gap-2 text-left"
          >
            <span className="text-sm font-bold tracking-tight text-[var(--text)]">
              Foreign Flow
            </span>
            <span className="font-mono text-[11px] text-[var(--text-faint)]">
              {enabled ? "· bars · top 10 buy / sell" : "· disabled"}
            </span>
            <span className="ml-1 text-[11px] text-[var(--text-faint)]">
              {expanded ? "▾" : "▸"}
            </span>
          </button>
          {universe.data?.as_of && enabled && expanded ? (
            <span className="hidden sm:inline panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
              as of {String(universe.data.as_of).slice(0, 10)}
            </span>
          ) : null}
        </div>
        <button
          onClick={() => {
            const next = !enabled;
            onToggle(next);
            setExpanded(next);
          }}
          className={`rounded-pill px-3 py-1.5 font-mono text-[11px] font-semibold transition-all ${enabled ? "bg-[var(--accent)] text-black" : "bg-[var(--panel-2)] text-[var(--text-faint)] hover:text-[var(--text-dim)]"}`}
        >
          {enabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      {!expanded ? (
        <div className="px-4 py-3 font-mono text-[11px] text-[var(--text-faint)]">
          {enabled
            ? "Collapsed — click ▸ to expand."
            : "Enable to load foreign flow bars (one IDX call, cached 1h)."}
        </div>
      ) : !enabled ? (
        <div className="px-4 py-3 font-mono text-[11px] text-[var(--text-faint)]">
          Disabled — no network. Enable to fetch.
        </div>
      ) : universe.loading && !universe.data ? (
        <div className="px-4 py-8 font-mono text-xs text-[var(--text-faint)]">
          loading foreign flow…
        </div>
      ) : universe.data?.available === false ? (
        <div className="px-4 py-3 font-mono text-xs text-[var(--gold)]">
          IDX unavailable — {universe.data?.error ?? "try again shortly."}
        </div>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <BarCol
            title="Top Buy"
            tone="up"
            rows={topBuy}
            max={maxBuy}
            valueKey="foreign_buy_lots"
          />
          <BarCol
            title="Top Sell"
            tone="down"
            rows={topSell}
            max={maxSell}
            valueKey="foreign_sell_lots"
          />
        </div>
      )}
    </div>
  );
}

function BarCol({
  title,
  tone,
  rows,
  max,
  valueKey,
}: {
  title: string;
  tone: "up" | "down";
  rows: NonNullable<ForeignFlowUniverse["rows"]>[number][];
  max: number;
  valueKey: "foreign_buy_lots" | "foreign_sell_lots";
}) {
  return (
    <div>
      <div
        className={`mb-2 font-mono text-[11px] font-bold uppercase tracking-wider ${tone === "up" ? "text-[var(--up)]" : "text-[var(--down)]"}`}
      >
        {title}
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const v = r[valueKey] as number;
          const pct = Math.max(4, Math.round((v / max) * 100));
          return (
            <Link
              key={r.ticker}
              href={`/profiler?ticker=${encodeURIComponent(r.ticker)}`}
              className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-[var(--panel-2)]"
            >
              <span className="w-12 shrink-0 font-mono text-xs font-bold text-[var(--text)] group-hover:text-[var(--accent)]">
                {r.ticker}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block h-2 rounded bg-[var(--panel-3)]">
                  <span
                    className={`block h-2 rounded ${tone === "up" ? "bg-[var(--up)]" : "bg-[var(--down)]"}`}
                    style={{ width: `${pct}%` }}
                  />
                </span>
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-[11px] text-[var(--text-dim)]">
                {fmtNum(v, 0)} lots
              </span>
            </Link>
          );
        })}
        {rows.length === 0 ? (
          <div className="font-mono text-xs text-[var(--text-faint)]">
            no data
          </div>
        ) : null}
      </div>
    </div>
  );
}
