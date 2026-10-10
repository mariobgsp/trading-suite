/**
 * Pull the latest bars, then show what they say.
 *
 * The work happens in one backend job, so this is a poll and a report rather than
 * a spinner: how many names were checked, how many were behind, what the session
 * is now, and — when a pull went badly — how many names failed. A degraded pull
 * is announced rather than swallowed, because breadth is a share of the universe
 * and a quiet third missing is a different market reading.
 *
 * On success the plan cache is dropped and every route is told to re-read, so the
 * new session and verdict appear without a page reload.
 */

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { planApi, type RefreshReport } from "@/lib/api/plan";
import { signalRefreshDone } from "@/lib/refresh";

const POLL_MS = 1_200;
const MAX_POLL_MS = 25 * 60_000;

export default function RefreshButton() {
	const [job, setJob] = useState<RefreshReport | null>(null);
	const [error, setError] = useState<string | null>(null);
	const stopped = useRef(false);
	const startedAt = useRef(0);

	useEffect(() => {
		stopped.current = false;
		return () => {
			stopped.current = true;
		};
	}, []);

	async function poll(id: string) {
		while (!stopped.current) {
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
			if (stopped.current) return;
			if (Date.now() - startedAt.current > MAX_POLL_MS) {
				setError("the refresh did not finish in time");
				return;
			}
			try {
				const next = await planApi.refreshStatus(id);
				setJob(next);
				if (next.state === "running") continue;
				if (next.state === "done") {
					api.invalidate("/api/plan");
					signalRefreshDone();
				}
				return;
			} catch (e) {
				setError(e instanceof Error ? e.message : "the refresh stopped answering");
				return;
			}
		}
	}

	async function press() {
		setError(null);
		try {
			const started = await planApi.refresh();
			startedAt.current = Date.now();
			setJob(started);
			if (started.state === "running") {
				void poll(started.id);
			} else if (started.state === "done") {
				api.invalidate("/api/plan");
				signalRefreshDone();
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : "could not start the refresh");
		}
	}

	const running = job?.state === "running";
	const progress =
		running && job && job.names_total > 0
			? Math.min(100, (job.names_checked / job.names_total) * 100)
			: 0;
	const label = running
		? job && job.names_total > 0
			? `${job.names_checked}/${job.names_total}`
			: "starting…"
		: job?.state === "done"
			? `screened ${job.session_after ?? ""}`
			: "Refresh data";

	const title = running
		? "Pulling the latest daily bars. Nothing is screened until the analysis is re-run."
		: job?.state === "done"
			? `Screened ${job.session_after} from ${job.bars_basis}${
					job.live_appended ? `, ${job.live_appended} bars appended` : ""
				}${job.degraded ? `, ${job.names_failed} names failed` : ""}.`
			: "Pull the latest daily bars and re-run the analysis on them.";

	return (
		<div className="flex items-center gap-2">
			<button
				type="button"
				onClick={() => void press()}
				disabled={running}
				title={title}
				aria-live="polite"
				className="relative border border-[var(--border)] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-dim)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:cursor-wait disabled:opacity-70"
			>
				{running ? "⋯" : "⟳"} {label}
				{running && (
					<span
						className="absolute inset-x-0 bottom-0 h-[2px] bg-[var(--up)]"
						style={{ width: `${progress}%` }}
						aria-hidden
					/>
				)}
			</button>
			{running ? (
				<button
					type="button"
					onClick={() => void planApi.cancelRefresh(job.id)}
					className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-ghost)] hover:text-[var(--text)]"
					title="Stop after the name being fetched."
				>
					stop
				</button>
			) : null}
			{!running && job?.degraded ? (
				<span
					className="font-mono text-[10px] text-[var(--gold)]"
					title={`${job.names_failed} of ${job.names_total} names could not be refreshed: ${job.failed_sample.join(", ")}`}
				>
					{job.names_failed} failed
				</span>
			) : null}
			{error ? (
				<span className="font-mono text-[10px] text-[var(--down)]" title={error}>
					refresh failed
				</span>
			) : null}
		</div>
	);
}
