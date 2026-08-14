import {
	columnVisibilityFeature,
	createCoreRowModel,
	createSortedRowModel,
	flexRender,
	rowSortingFeature,
	tableFeatures,
	useTable,
	type ColumnDef,
	type RowData,
	type SortingState,
} from "@tanstack/react-table";
import { useEffect, useState } from "react";
import { fmtIdr, fmtNum, fmtPct } from "@/lib/api";

// Statically-declared feature set (v9 recommendation): core features are
// auto-included; row-sorting plus its row models are wired explicitly.
const features = tableFeatures({
	columnVisibilityFeature,
	rowSortingFeature,
	coreRowModel: createCoreRowModel(),
	sortedRowModel: createSortedRowModel(),
});
type Features = typeof features;

export type { Features };

/**
 * Staleness chip — when was this data last refreshed upstream.
 * Shows a live dot when fresh, gold when older than the refresh window.
 */
export function StaleChip({
	asOf,
	intervalMs = 30000,
	label = "UPDATED",
}: {
	asOf?: string;
	intervalMs?: number;
	label?: string;
}) {
	const [now, setNow] = useState(() => Date.now());
	// 10s ticker keeps the chip honest without re-rendering the table.
	useEffect(() => {
		const id = setInterval(() => setNow(Date.now()), 10000);
		return () => clearInterval(id);
	}, []);
	if (!asOf) return null;
	const ts = new Date(asOf).getTime();
	if (Number.isNaN(ts)) return null;
	const age = Math.max(0, now - ts);
	const stale = age > intervalMs * 3;
	const secs = Math.round(age / 1000);
	const text =
		secs < 60
			? `${secs}s`
			: secs < 3600
				? `${Math.round(secs / 60)}m`
				: `${Math.round(secs / 3600)}h`;
	return (
		<span className={`stale-chip ${stale ? "stale" : ""}`} title={asOf}>
			<span className={`stale-dot ${stale ? "stale" : ""}`} />
			{label} {text} AGO
		</span>
	);
}

/* ── Table cell renderers (dense desk register) ─────────────────────────── */

/** Right-aligned mono number with tabular figures. */
export function NumCell({
	value,
	digits = 0,
}: {
	value: number | null | undefined;
	digits?: number;
}) {
	return (
		<span className="mono text-[var(--text)]">{fmtNum(value, digits)}</span>
	);
}

/** IDR value cell, compact (Jt/M/T suffixes). */
export function IdrCell({ value }: { value: number | null | undefined }) {
	return <span className="mono text-[var(--text)]">{fmtIdr(value, true)}</span>;
}

/** Change % with sign + arrow, never color alone. */
export function PctCell({ value }: { value: number | null | undefined }) {
	if (value == null || Number.isNaN(value)) {
		return <span className="mono text-[var(--text-faint)]">—</span>;
	}
	const up = value >= 0;
	return (
		<span
			className={`mono font-semibold ${up ? "text-[var(--up)]" : "text-[var(--down)]"}`}
		>
			{up ? "▲ " : "▼ "}
			{fmtPct(value)}
		</span>
	);
}

/**
 * Dense, sortable data table built on TanStack Table.
 *
 * Markup is fully ours (headless), so it inherits the desk register:
 * 10px mono headers, 12px rows, right-aligned tabular numbers, hairline
 * separators, directional row tinting via `rowTone`.
 */
export function DataTable<T extends RowData>({
	columns,
	data,
	rowTone,
	initialSort,
	empty = "No data",
}: {
	columns: ColumnDef<Features, T, unknown>[];
	data: T[];
	rowTone?: (row: T) => "up" | "down" | undefined;
	initialSort?: SortingState;
	empty?: string;
}) {
	const [sorting, setSorting] = useState<SortingState>(initialSort ?? []);
	const table = useTable<Features, T>({
		features,
		data,
		columns,
		state: { sorting },
		onSortingChange: setSorting,
	});

	if (data.length === 0) {
		return (
			<div className="flex h-24 items-center justify-center border border-dashed border-[var(--border)] text-xs text-[var(--text-faint)]">
				{empty}
			</div>
		);
	}

	return (
		<div className="table-wrap">
			<table className="data-table">
				<thead>
					{table.getHeaderGroups().map((hg) => (
						<tr key={hg.id}>
							{hg.headers.map((header) => {
								const sortable = header.column.getCanSort();
								const sorted = header.column.getIsSorted();
								return (
									<th
										key={header.id}
										className={`${sortable ? "sortable" : ""} ${
											(
												header.column.columnDef.meta as
													| { align?: string }
													| undefined
											)?.align === "right"
												? "numeric"
												: ""
										}`}
										onClick={
											sortable
												? header.column.getToggleSortingHandler()
												: undefined
										}
									>
										{flexRender(
											header.column.columnDef.header,
											header.getContext(),
										)}
										{sorted ? (sorted === "asc" ? " ↑" : " ↓") : ""}
									</th>
								);
							})}
						</tr>
					))}
				</thead>
				<tbody>
					{table.getRowModel().rows.map((row) => {
						const tone = rowTone?.(row.original);
						return (
							<tr
								key={row.id}
								className={
									tone === "up" ? "row-up" : tone === "down" ? "row-down" : ""
								}
							>
								{row.getVisibleCells().map((cell) => (
									<td key={cell.id}>
										{flexRender(cell.column.columnDef.cell, cell.getContext())}
									</td>
								))}
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
