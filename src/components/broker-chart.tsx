"use client";

import { useEffect, useRef } from "react";

// Deep ChartSurface for Broker Intel — single lightweight-charts seam.
// Extracted from brokerintel/page.tsx:819 → thin caller.

interface BrokerDay {
  date: string;
  price?: number | null;
  top3_net: number;
}
interface BrokerHistory {
  dates: string[];
  per_day: BrokerDay[];
  series: Record<string, number[]>;
}

export function BrokerChart({
  history,
  brokerPick,
}: {
  history: BrokerHistory;
  brokerPick: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current || !history.dates.length) return;
    let disposed = false;
    let chart: unknown = null;
    let retry = 0;

    const draw = async () => {
      try {
        const lc = await import("lightweight-charts");
        if (disposed || !ref.current) return;
        // SAFETY: dynamic import shape not typed; guarded by typeof check below
        const createChart = (
          lc as unknown as {
            createChart: (el: HTMLElement, opts: unknown) => unknown;
          }
        ).createChart;
        if (typeof createChart !== "function")
          throw new Error("no createChart");
        // SAFETY: createChart result has no official TS type; guarded by typeof check
        const c = createChart(ref.current, {
          height: 260,
          layout: {
            background: { color: "transparent" },
            textColor: "#9aa0a6",
          },
          grid: {
            vertLines: { color: "rgba(255,255,255,0.06)" },
            horzLines: { color: "rgba(255,255,255,0.06)" },
          },
          timeScale: { timeVisible: true },
          rightPriceScale: { borderColor: "rgba(255,255,255,0.12)" },
        }) as unknown as {
          addLineSeries: (o: unknown) => { setData: (d: unknown) => void };
          addHistogramSeries: (o: unknown) => { setData: (d: unknown) => void };
          timeScale: () => { fitContent: () => void };
          applyOptions: (o: unknown) => void;
          remove: () => void;
        };
        chart = c;
        // SAFETY: lightweight-charts Time is string alias; date strings valid
        const toTime = (d: string) => d as unknown as string;
        const priceLine = c.addLineSeries({
          color: "#f5c542",
          lineWidth: 1.5,
          priceScaleId: "right",
        });
        const priceData = history.per_day
          .filter((d) => d.price != null)
          .map((d) => ({ time: toTime(d.date), value: d.price as number }));
        if (priceData.length) priceLine.setData(priceData);

        const vals: number[] = brokerPick
          ? (history.series[brokerPick] ?? [])
          : history.per_day.map((d) => d.top3_net);
        const line = c.addHistogramSeries({
          color: "#7fb7ff",
          priceScaleId: "left",
        });
        const histData = history.dates.map((d, i) => ({
          time: toTime(d),
          value: vals[i] ?? 0,
          color:
            (vals[i] ?? 0) >= 0
              ? "rgba(90,200,120,0.85)"
              : "rgba(240,90,90,0.85)",
        }));
        line.setData(histData);
        c.timeScale().fitContent();
        const ro = new ResizeObserver(() =>
          c.applyOptions({ width: ref.current!.clientWidth }),
        );
        ro.observe(ref.current!);
        return () => ro.disconnect();
      } catch {
        if (retry < 1) {
          retry++;
          setTimeout(draw, 300);
        }
      }
    };
    draw();
    return () => {
      disposed = true;
      try {
        // SAFETY: chart is unknown from dynamic import; remove guarded by optional chaining
        (chart as unknown as { remove?: () => void })?.remove?.();
      } catch {
        /* already disposed */
      }
    };
  }, [history, brokerPick]);

  const vals: number[] = brokerPick
    ? (history.series[brokerPick] ?? [])
    : history.per_day.map((d) => d.top3_net);
  const maxAbs = Math.max(1, ...vals.map((v) => Math.abs(v)));

  return (
    <div>
      <div
        ref={ref}
        className="w-full rounded-md border border-[var(--line)] bg-[var(--panel-2)]"
        style={{ height: 260 }}
      />
      <div className="mt-3 hidden h-16 items-end gap-1 lg:flex">
        {vals.slice(-40).map((v, i) => (
          <div
            key={i}
            className="flex-1"
            title={`${history.dates[history.dates.length - vals.length + i]}: ${v.toFixed(0)} lots`}
            style={{
              height: `${Math.max(4, (Math.abs(v) / maxAbs) * 100)}%`,
              background: v >= 0 ? "var(--up)" : "var(--down)",
              opacity: 0.75,
            }}
          />
        ))}
      </div>
    </div>
  );
}
