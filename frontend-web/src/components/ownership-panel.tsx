"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { api, fmtNum, type OwnerHoldings } from "@/lib/api";

// Deep view module extracted from ownership/page.tsx (674→ ~280).
// Deletion test: deleting this scatters rank/cum + filter/sort back into page.

type ShareholderRow = {
  name: string;
  shares: number | null;
  percent: number | null;
  category: string;
  controlling: boolean;
};

type SortKey = "name" | "shares" | "percent";
type RankedRow = ShareholderRow & { rank: number; cum: number };

export function ShareholdersPanel({
  rows,
  ticker,
  onSelectTicker,
}: {
  rows: ShareholderRow[];
  ticker: string;
  onSelectTicker: (t: string) => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("percent");
  const [sortDesc, setSortDesc] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);

  const cats = useMemo(
    () => [...new Set(rows.map((r) => r.category || "—"))].sort(),
    [rows],
  );

  const ranked = useMemo<RankedRow[]>(() => {
    // ponytail: O(n²) cumulative over tiny holder list; fine at this scale.
    const sorted = [...rows].sort(
      (a, b) => (b.percent ?? 0) - (a.percent ?? 0),
    );
    return sorted.map((r, i) => ({
      ...r,
      rank: i + 1,
      cum: sorted.slice(0, i + 1).reduce((s, x) => s + (x.percent ?? 0), 0),
    }));
  }, [rows]);

  const totalPct = useMemo(
    () => rows.reduce((s, r) => s + (r.percent ?? 0), 0),
    [rows],
  );
  const top3 = ranked.slice(0, 3).reduce((s, r) => s + (r.percent ?? 0), 0);
  const maxPct = Math.max(...ranked.map((r) => r.percent ?? 0), 0.0001);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ranked
      .filter((r) => !cat || (r.category || "—") === cat)
      .filter((r) => !needle || r.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        const dir = sortDesc ? -1 : 1;
        if (sortKey === "name") return a.name.localeCompare(b.name) * dir * -1;
        // SAFETY: sortKey narrowed to shares|percent (numbers) by branch above
        const av = a[sortKey] as unknown as number;
        const bv = b[sortKey] as unknown as number;
        return (av - bv) * dir;
      });
  }, [ranked, q, cat, sortKey, sortDesc]);

  if (rows.length === 0) {
    return (
      <div className="panel mb-4 p-4">
        <p className="text-xs text-[var(--text-faint)]">
          No shareholder data for {ticker}.
        </p>
      </div>
    );
  }

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDesc((d) => !d);
    else {
      setSortKey(key);
      setSortDesc(key !== "name");
    }
  };
  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDesc ? " ↓" : " ↑") : "";
  const th =
    "cursor-pointer select-none py-1 text-left font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)] hover:text-[var(--accent)]";
  const td = "border-b border-[var(--line)] py-1.5 text-xs";

  return (
    <div className="panel mb-4 p-4" style={{ contentVisibility: "auto" }}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wider text-[var(--text-dim)]">
          Shareholders · {ticker}
        </h2>
        <span className="hidden font-mono text-[10px] text-[var(--text-faint)] sm:inline">
          click row for detail · click header to sort
        </span>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] text-[var(--text-faint)]">
        <span className="text-[var(--text-dim)]">{rows.length} holders</span>
        <span>
          top-1{" "}
          <b className="text-[var(--gold)]">
            {fmtNum(ranked[0]?.percent ?? 0, 2)}%
          </b>
        </span>
        <span>
          top-3 <b className="text-[var(--text)]">{fmtNum(top3, 2)}%</b>
        </span>
        <span>Σ disclosed {fmtNum(totalPct, 2)}%</span>
        {totalPct < 100 && (
          <span>
            public float ≈{" "}
            <b className="text-[var(--accent)]">{fmtNum(100 - totalPct, 2)}%</b>
          </span>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter holders…"
          className="panel-2 w-44 px-2 py-1 font-mono text-[11px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:outline-none"
        />
        {cats.length > 1 &&
          cats.map((c) => (
            <button
              key={c}
              onClick={() => setCat(cat === c ? null : c)}
              className={`rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                cat === c
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "panel-2 text-[var(--text-dim)] hover:text-[var(--accent)]"
              }`}
            >
              {c}
            </button>
          ))}
        {(cat || q) && (
          <button
            onClick={() => {
              setCat(null);
              setQ("");
            }}
            className="font-mono text-[10px] text-[var(--down)] hover:underline"
          >
            clear ×
          </button>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>#</th>
              <th
                className={`${th} ${arrow("name")}`}
                onClick={() => toggleSort("name")}
              >
                Holder{arrow("name")}
              </th>
              <th className={th}>Category</th>
              <th
                className={`${th} text-right ${arrow("shares")}`}
                onClick={() => toggleSort("shares")}
              >
                Shares{arrow("shares")}
              </th>
              <th
                className={`${th} text-right ${arrow("percent")}`}
                onClick={() => toggleSort("percent")}
              >
                Stake %{arrow("percent")}
              </th>
              <th className={`${th} text-right`}>Σ cum%</th>
            </tr>
          </thead>
          <tbody>
            {view.map((r) => {
              const open = openId === r.rank;
              const pct = r.percent ?? 0;
              return (
                <Fragment key={r.rank}>
                  <tr
                    className={`cursor-pointer hover:bg-[var(--panel-2)] ${open ? "bg-[var(--panel-2)]" : ""}`}
                    onClick={() => setOpenId(open ? null : r.rank)}
                  >
                    <td
                      className={`${td} font-mono text-[10px] text-[var(--text-faint)]`}
                    >
                      {open ? "▾" : "▸"} {r.rank}
                    </td>
                    <td className={`${td} font-semibold text-[var(--text)]`}>
                      {r.name}
                      {r.controlling && (
                        <span className="ml-2 rounded-sm bg-[var(--gold)] text-[var(--gold-fg)] px-1 font-mono text-[8px] font-bold uppercase text-white">
                          controlling
                        </span>
                      )}
                    </td>
                    <td className={`${td} text-[var(--text-dim)]`}>
                      {r.category || "—"}
                    </td>
                    <td
                      className={`${td} tabular text-right text-[var(--text)]`}
                    >
                      {fmtNum(r.shares, 0)}
                    </td>
                    <td className={td}>
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-sm bg-[var(--line)]">
                          <div
                            className="h-full bg-[var(--gold)]"
                            style={{
                              width: `${Math.min(100, (pct / maxPct) * 100)}%`,
                            }}
                          />
                        </div>
                        <span className="tabular w-14 text-right font-semibold text-[var(--text)]">
                          {fmtNum(pct, 2)}%
                        </span>
                      </div>
                    </td>
                    <td
                      className={`${td} tabular text-right text-[var(--text-dim)]`}
                    >
                      {fmtNum(r.cum, 2)}%
                    </td>
                  </tr>
                  {open && (
                    <tr className="bg-[var(--panel)]">
                      <td
                        colSpan={6}
                        className="border-b border-[var(--line)] pb-3 pl-8 pr-4 pt-1"
                      >
                        <div className="flex flex-wrap gap-x-8 gap-y-1 font-mono text-[10px] text-[var(--text-dim)]">
                          <span>
                            exact shares{" "}
                            <b className="text-[var(--text)]">
                              {r.shares != null
                                ? r.shares.toLocaleString("id-ID")
                                : "—"}
                            </b>
                          </span>
                          <span>
                            share of disclosed{" "}
                            <b className="text-[var(--text)]">
                              {totalPct > 0
                                ? `${fmtNum((pct / totalPct) * 100, 1)}%`
                                : "—"}
                            </b>
                          </span>
                          <span>
                            cumulative through rank {r.rank}{" "}
                            <b className="text-[var(--text)]">
                              {fmtNum(r.cum, 2)}%
                            </b>
                          </span>
                          <span>
                            category{" "}
                            <b className="text-[var(--text)]">
                              {r.category || "—"}
                            </b>
                          </span>
                          <span>
                            control{" "}
                            <b
                              className={
                                r.controlling
                                  ? "text-[var(--gold)]"
                                  : "text-[var(--text)]"
                              }
                            >
                              {r.controlling
                                ? "CONTROLLING"
                                : "non-controlling"}
                            </b>
                          </span>
                        </div>
                        <OwnerElsewhere
                          key={r.name}
                          name={r.name}
                          current={ticker}
                          onSelectTicker={onSelectTicker}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card fallback */}
      <div className="divide-y divide-[var(--line)] md:hidden">
        {view.map((r) => {
          const open = openId === r.rank;
          const pct = r.percent ?? 0;
          return (
            <div
              key={r.rank}
              className={`py-3 ${open ? "bg-[var(--panel-2)]" : ""}`}
            >
              <button
                onClick={() => setOpenId(open ? null : r.rank)}
                className="flex w-full items-start justify-between gap-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-[var(--text)]">
                    {r.rank}. {r.name}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--text-faint)]">
                    {r.category || "—"} · {fmtNum(pct, 2)}% · Σ{" "}
                    {fmtNum(r.cum, 2)}%
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[11px] text-[var(--text-faint)]">
                  {open ? "▾" : "▸"}
                </span>
              </button>
              {open && (
                <div className="mt-2 border-t border-[var(--line)] pt-2">
                  <div className="font-mono text-[10px] leading-relaxed text-[var(--text-dim)]">
                    shares{" "}
                    {r.shares != null ? r.shares.toLocaleString("id-ID") : "—"}{" "}
                    · {r.controlling ? "CONTROLLING" : "non-controlling"}
                  </div>
                  <OwnerElsewhere
                    name={r.name}
                    current={ticker}
                    onSelectTicker={onSelectTicker}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {view.length === 0 && (
        <p className="py-3 text-center font-mono text-[10px] text-[var(--text-faint)]">
          no holders match the current filter
        </p>
      )}
    </div>
  );
}

function OwnerElsewhere({
  name,
  current,
  onSelectTicker,
}: {
  name: string;
  current: string;
  onSelectTicker: (t: string) => void;
}) {
  const [res, setRes] = useState<OwnerHoldings | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const path = `/api/intel/owner/holdings?name=${encodeURIComponent(name)}`;
    api
      .getCached<OwnerHoldings>(path)
      .then((d) => {
        if (alive) setRes(d);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [name]);

  if (failed) return null;
  const matches = (res?.matches ?? []).filter((m) => m.ticker !== current);
  const matchTickers = new Set(matches.map((m) => m.ticker));
  const restIssuers = (res?.issuers ?? []).filter(
    (i) => i.ticker !== current && !matchTickers.has(i.ticker),
  );
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
        Also holds{res ? ` · ${res.issuers_scanned} issuers scanned` : ""}
      </span>
      {!res && (
        <span className="font-mono text-[10px] text-[var(--text-faint)]">
          searching…
        </span>
      )}
      {matches.map((m) => (
        <button
          key={m.ticker}
          onClick={() => onSelectTicker(m.ticker)}
          title={`${m.category || "holder"}${m.controlling ? " · controlling" : ""}${m.as_of ? ` · as of ${m.as_of}` : ""}`}
          className={`max-w-[22rem] truncate rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-bold ${
            m.controlling
              ? "bg-[var(--gold)] text-[var(--gold-fg)]"
              : "panel-2 text-[var(--accent)] hover:text-black"
          }`}
        >
          {m.name || m.ticker}
          <span className="opacity-60"> {m.ticker}</span>
          {m.percent != null ? ` ${fmtNum(m.percent, 2)}%` : ""}
        </button>
      ))}
      {restIssuers.map((i) => (
        <button
          key={i.ticker}
          onClick={() => onSelectTicker(i.ticker)}
          title={i.name || i.ticker}
          className="max-w-[22rem] truncate rounded-sm px-1.5 py-0.5 font-mono text-[10px] panel-2 text-[var(--text-faint)] hover:text-[var(--accent)]"
        >
          {i.name || i.ticker}
          <span className="opacity-60"> {i.ticker}</span>
        </button>
      ))}
      {res && matches.length === 0 && res.issuers_scanned === 0 && (
        <span className="font-mono text-[10px] text-[var(--text-faint)]">
          archive is empty — load some companies first
        </span>
      )}
    </div>
  );
}
