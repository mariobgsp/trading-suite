import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { api, type Announcements } from "@/lib/api";
import { usePolling } from "@/lib/usePolling";
import { SectionHeader, Skeleton } from "@/components/ui";
import { DataTable, StaleChip, type Features } from "@/components/data-table";

type Item = NonNullable<Announcements["items"]>[number];

const columns: ColumnDef<Features, Item, unknown>[] = [
	{
		header: "Title",
		accessorKey: "title",
		cell: (c) => {
			const title = String(c.getValue() ?? "—");
			const link = c.row.original.link ?? c.row.original.url;
			if (typeof link === "string" && link.length > 0) {
				return (
					<a
						href={link}
						target="_blank"
						rel="noreferrer"
						className="text-[var(--text)] hover:text-[var(--accent)] hover:underline"
					>
						{title}
					</a>
				);
			}
			return <span className="text-[var(--text)]">{title}</span>;
		},
	},
	{
		header: "Category",
		accessorKey: "category",
		cell: (c) => (
			<span className="text-[var(--text-dim)]">
				{String(c.getValue() ?? "—")}
			</span>
		),
	},
	{
		header: "Date",
		accessorKey: "date",
		cell: (c) => {
			const raw = c.getValue();
			if (typeof raw !== "string" || !raw)
				return <span className="text-[var(--text-faint)]">—</span>;
			const d = new Date(raw);
			if (Number.isNaN(d.getTime()))
				return (
					<span className="mono text-[var(--text-dim)]">
						{raw.slice(0, 10)}
					</span>
				);
			return (
				<span className="mono text-[var(--text-dim)]">
					{d.toLocaleDateString("id-ID", {
						day: "2-digit",
						month: "short",
						year: "numeric",
					})}
				</span>
			);
		},
	},
];

export const Route = createFileRoute("/announcements")({
	component: AnnouncementsPage,
});

function AnnouncementsPage() {
	const data = usePolling<Announcements>(
		() => api.get("/api/intel/announcements?limit=50"),
		60000,
		"announcements",
	);

	const unavailable = data.data && data.data.available === false;
	const items = (data.data?.items ?? []).filter(
		(i) => typeof i.title === "string",
	);

	return (
		<div>
			<SectionHeader
				title="Announcements"
				subtitle="Official IDX corporate disclosures — direct from the exchange, with PDF attachments"
			/>

			{unavailable ? (
				<div className="panel p-6">
					<div className="font-mono text-xs uppercase tracking-wider text-[var(--gold)]">
						IDX unavailable
					</div>
					<p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--text-dim)]">
						{data.data?.error ?? "The IDX endpoint did not respond."} The
						backend retries with browser impersonation; try again shortly.
					</p>
				</div>
			) : data.loading && !data.data ? (
				<Skeleton className="h-72" />
			) : (
				<>
					<div className="mb-3 flex items-center justify-between">
						<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
							{items.length} announcements · IDX direct
						</span>
						{data.data?.as_of ? (
							<StaleChip asOf={data.data.as_of} label="FEED" />
						) : null}
					</div>
					<DataTable<Item>
						columns={columns}
						data={items}
						initialSort={[{ id: "date", desc: true }]}
						empty="No announcements yet"
					/>
				</>
			)}
		</div>
	);
}
