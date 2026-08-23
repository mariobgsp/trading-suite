"use client";

import { api } from "@/lib/api";
import Shell from "@/components/Shell";
import { SectionHeader, Skeleton } from "@/components/ui";
import { usePolling } from "@/lib/usePolling";

interface AnnouncementItem {
	title?: string;
	link?: string;
	url?: string;
	date?: string;
	category?: string;
	ticker?: string;
	[field: string]: unknown;
}

interface Announcements {
	available: boolean;
	error?: string;
	count?: number;
	as_of?: string;
	items?: AnnouncementItem[];
}

export default function AnnouncementsPage() {
	const data = usePolling<Announcements>(
		() => api.get("/api/intel/announcements?limit=50"),
		60000,
		"announcements",
	);

	const unavailable = data.data && data.data.available === false;
	const items = (data.data?.items ?? []).filter(
		(i) => typeof i.title === "string",
	);
	// ponytail: pre-sorted by date desc; add column sorting if users need it
	const sorted = [...items].sort((a, b) =>
		(b.date ?? "").localeCompare(a.date ?? ""),
	);

	return (
		<Shell>
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
						{data.data?.error ?? "The IDX endpoint did not respond."} The backend
						retries with browser impersonation; try again shortly.
					</p>
				</div>
			) : data.loading && !data.data ? (
				<Skeleton className="h-72" />
			) : (
				<>
					<div className="mb-3 flex items-center justify-between">
						<span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
							{sorted.length} announcements · IDX direct
						</span>
						{data.data?.as_of ? (
							<span className="panel-2 px-2 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
								FEED · as of {String(data.data.as_of).slice(0, 10)}
							</span>
						) : null}
					</div>
					<div className="panel overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-[var(--border)] text-left font-mono text-[9px] uppercase tracking-wider text-[var(--text-faint)]">
									<th className="px-3 py-2">Title</th>
									<th className="px-3 py-2">Category</th>
									<th className="px-3 py-2">Date</th>
								</tr>
							</thead>
							<tbody>
								{sorted.map((i, idx) => {
									const link = i.link ?? i.url;
									return (
										<tr
											key={idx}
											className="border-b border-[var(--line)]/50 last:border-b-0 hover:bg-[var(--panel-2)]"
										>
											<td className="px-3 py-2 text-[var(--text)]">
												{typeof link === "string" && link.length > 0 ? (
													<a
														href={link}
														target="_blank"
														rel="noreferrer"
														className="hover:text-[var(--accent)] hover:underline"
													>
														{i.title as string}
													</a>
												) : (
													(i.title as string)
												)}
											</td>
											<td className="px-3 py-2 text-[var(--text-dim)]">
												{i.category ?? "—"}
											</td>
											<td className="tabular px-3 py-2 font-mono text-[11px] text-[var(--text-dim)]">
												{(() => {
													const raw = i.date;
													if (typeof raw !== "string" || !raw)
														return <span className="text-[var(--text-faint)]">—</span>;
													const d = new Date(raw);
													if (Number.isNaN(d.getTime())) return raw.slice(0, 10);
													return d.toLocaleDateString("id-ID", {
														day: "2-digit",
														month: "short",
														year: "numeric",
													});
												})()}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
						{sorted.length === 0 && (
							<p className="px-3 py-6 text-center text-sm text-[var(--text-faint)]">
								No announcements yet
							</p>
						)}
					</div>
				</>
			)}
		</Shell>
	);
}
