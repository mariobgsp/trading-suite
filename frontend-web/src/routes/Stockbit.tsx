/**
 * Stockbit — the suite's native front door to the local stockbitd session keeper.
 *
 * The daemon owns the one-time browser login, the cookie jar and the token
 * refresh. This page never handles a cookie or a token itself except through
 * the proxy; it renders the session, the data and the cache.
 *
 * N: server_running — every fetch below is same-origin through the suite proxy.
 * N: daemon_url — the panel names the daemon it is forwarding to.
 * N: connected — the watchlist loader is disabled until the session is connected.
 * Codes handled here: status_error, login_failed, data_error.
 */

import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ApiError, fmtIdr, fmtNum } from "@/lib/api";
import {
	stockbitApi,
	type StockbitAttempt,
	type StockbitBrokerRow,
	type StockbitCache,
	type StockbitSnapshot,
	type StockbitStatus,
	type StockbitWatchlist,
} from "@/lib/api/stockbit";
import { planApi, type Plan, type PlanDetail } from "@/lib/api/plan";
import { ChangeBadge } from "@/components/ui";
import { Section } from "@/components/plan";
import { Page } from "./Tonight";

type Tone = "ok" | "warn" | "bad";
type Notice = { tone: Tone; text: string; code?: string };
type FormState = "idle" | "saving" | "saved" | "invalid_token" | "invalid_cookie" | "not_connected" | "error";
type DataState = "idle" | "loading" | "empty" | "partial" | "auth_required" | "rate_limited" | "upstream_error" | "invalid_ticker" | "error";
type WatchState = "idle" | "loading" | "empty" | "auth_required" | "upstream_error" | "error";
type CacheState = "loading" | "idle" | "empty" | "error";
// Credential form states: idle, saving, saved, invalid_credentials,
// credentials_missing, error.
type CredState = "idle" | "saving" | "saved" | "invalid_credentials" | "credentials_missing" | "error";

const ACTIVE_ATTEMPT = new Set(["starting", "connecting", "awaiting_login"]);
const TERMINAL_ATTEMPT = new Set(["connected", "failed", "cancelled"]);

const CODE_LABEL: Record<string, string> = {
	daemon_unavailable: "The Stockbit daemon is not running",
	unconfigured: "Stockbit is not connected",
	connected: "Connected",
	connecting: "Starting the browser",
	awaiting_login: "Waiting for your login",
	reauth_required: "Stockbit needs a fresh login",
	browser_not_found: "No Chromium browser was found",
	no_display: "No graphical display",
	unsupported_browser: "That browser cannot open the login window",
	login_timeout: "The login window timed out",
	login_cancelled: "The login was cancelled",
	invalid_token: "That access token was rejected",
	invalid_cookie: "Those cookies were rejected",
	not_connected: "Stockbit is not connected",
	credentials_missing: "No saved Stockbit sign-in",
	credentials_invalid: "The saved Stockbit sign-in is incomplete",
	invalid_credentials: "Stockbit rejected the saved sign-in",
	login_form_not_found: "The Stockbit login form was not found",
	verification_required: "Stockbit needs a verification step",
	rate_limited: "Stockbit is rate limiting",
	upstream_error: "Stockbit returned an error",
	invalid_ticker: "Not a valid IDX ticker",
	partial: "Loaded with warnings",
	empty: "No data returned",
	error: "Something failed",
};

function errorText(error: unknown): string {
	if (error instanceof ApiError) return error.message || CODE_LABEL[error.code ?? ""] || "request failed";
	if (error instanceof Error) return error.message;
	return String(error);
}

function errorCode(error: unknown): string | undefined {
	return error instanceof ApiError ? error.code : undefined;
}

function toneForState(state: string): string {
	if (state === "connected") return "var(--up)";
	if (state === "connecting" || state === "awaiting_login" || state === "loading") return "var(--accent)";
	if (state === "unconfigured" || state === "daemon_unavailable") return "var(--gold)";
	return "var(--down)";
}

function stateLabel(state: string): string {
	return CODE_LABEL[state] ?? state.replaceAll("_", " ");
}

function NoticeLine({ notice }: { notice: Notice | null }) {
	if (!notice) return null;
	const color = notice.tone === "ok" ? "var(--up)" : notice.tone === "warn" ? "var(--gold)" : "var(--down)";
	return (
		<div
			className="border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px] leading-relaxed text-[var(--text-dim)]"
			style={{ borderLeftWidth: 3, borderLeftColor: color }}
			role="status"
		>
			<span className="text-[var(--text)]">{notice.text}</span>
			{notice.code && <span className="ml-2 font-mono text-[10px] text-[var(--text-ghost)]">{notice.code}</span>}
		</div>
	);
}

export default function Stockbit() {
	const [status, setStatus] = useState<StockbitStatus | null>(null);
	const [statusError, setStatusError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState<StockbitAttempt | null>(null);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [ticker, setTicker] = useState("BBCA");
	const [submittedTicker, setSubmittedTicker] = useState<string | null>(null);
	const [refreshData, setRefreshData] = useState(false);
	const [snapshot, setSnapshot] = useState<StockbitSnapshot | null>(null);
	const [dataState, setDataState] = useState<DataState>("idle");
	const [dataNotice, setDataNotice] = useState<Notice | null>(null);
	const [watchlist, setWatchlist] = useState<StockbitWatchlist | null>(null);
	const [watchState, setWatchState] = useState<WatchState>("idle");
	const [watchNotice, setWatchNotice] = useState<Notice | null>(null);
	const [cache, setCache] = useState<StockbitCache | null>(null);
	const [cacheState, setCacheState] = useState<CacheState>("loading");
	const [formState, setFormState] = useState<FormState>("idle");
	const [formError, setFormError] = useState<Notice | null>(null);
	const [token, setToken] = useState("");
	const [refreshToken, setRefreshToken] = useState("");
	const [cookie, setCookie] = useState("");
	const autoTried = useRef(false);
	const [credUser, setCredUser] = useState("");
	const [credPass, setCredPass] = useState("");
	const [credState, setCredState] = useState<CredState>("idle");
	const [credError, setCredError] = useState<Notice | null>(null);
	const [showCredForm, setShowCredForm] = useState(false);

	const attemptActive = attempt !== null && ACTIVE_ATTEMPT.has(attempt.state);
	const connected = status?.state === "connected";
	const viewState =
		attempt && ACTIVE_ATTEMPT.has(attempt.state)
			? attempt.state === "awaiting_login"
				? "awaiting_login"
				: "connecting"
			: status?.state ?? (statusError ? "error" : "loading");

	async function refreshStatus() {
		try {
			const next = await stockbitApi.status();
			setStatus(next);
			setStatusError(null);
			if (!attempt && next.login && ACTIVE_ATTEMPT.has(next.login.state)) setAttempt(next.login);
		} catch (error) {
			setStatusError(errorText(error));
		}
	}

	async function loadCache() {
		setCacheState("loading");
		try {
			const next = await stockbitApi.cache();
			setCache(next);
			setCacheState(next.entries > 0 ? "idle" : "empty");
		} catch {
			setCacheState("error");
		}
	}

	useEffect(() => {
		let alive = true;
		async function tick() {
			try {
				const next = await stockbitApi.status();
				if (!alive) return;
				setStatus(next);
				setStatusError(null);
				if (!attempt && next.login && ACTIVE_ATTEMPT.has(next.login.state)) setAttempt(next.login);
			} catch (error) {
				if (alive) setStatusError(errorText(error));
			}
		}
		void tick();
		void loadCache();
		const timer = window.setInterval(tick, 4000);
		return () => {
			alive = false;
			window.clearInterval(timer);
		};
		// The interval owns the status loop; attempt polling has its own effect.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const attemptId = attempt && ACTIVE_ATTEMPT.has(attempt.state) ? attempt.id : null;
	useEffect(() => {
		if (!attemptId) return;
		let alive = true;
		const timer = window.setInterval(async () => {
			try {
				const next = await stockbitApi.login(attemptId);
				if (!alive) return;
				setAttempt(next.attempt);
				if (TERMINAL_ATTEMPT.has(next.attempt.state)) {
					window.clearInterval(timer);
					if (next.attempt.state === "connected") {
						setNotice({ tone: "ok", text: "Stockbit is connected. The cookie jar is saved." });
						await refreshStatus();
						await loadCache();
					} else if (next.attempt.state === "failed") {
						setNotice({
							tone: "bad",
							text: next.attempt.error || stateLabel(next.attempt.error_code || "login_failed"),
							code: next.attempt.error_code,
						});
						await refreshStatus();
					} else {
						setNotice({ tone: "warn", text: "The login was cancelled." });
						await refreshStatus();
					}
				}
			} catch (error) {
				if (!alive) return;
				if (error instanceof ApiError && error.status === 404) {
					window.clearInterval(timer);
					setAttempt(null);
					await refreshStatus();
				}
			}
		}, 1000);
		return () => {
			alive = false;
			window.clearInterval(timer);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [attemptId]);

	// If a saved sign-in exists, start it without waiting for a click. The ref
	// makes this one attempt per mount: a wrong password shows the form instead
	// of an auto-login loop.
	useEffect(() => {
		if (autoTried.current || !status) return;
		if (status.state === "connected" || status.state === "daemon_unavailable") return;
		if (status.login && ACTIVE_ATTEMPT.has(status.login.state)) return;
		if (!status.credentials?.configured) return;
		autoTried.current = true;
		void startLogin(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [status]);

	async function startLogin(manual = false) {
		autoTried.current = true;
		setAttempt(null);
		setFormError(null);
		setNotice({
			tone: "warn",
			text: manual
				? "Opening the Stockbit login window; this page updates when the session lands."
				: "Opening the browser to sign in with your saved Stockbit account. If Stockbit asks for a verification code, PIN or challenge, finish it in the window.",
		});
		try {
			const next = await stockbitApi.startLogin(manual);
			setAttempt(next.attempt);
			setShowCredForm(false);
		} catch (error) {
			if (error instanceof ApiError && error.status === 409 && error.attempt) {
				setAttempt(error.attempt as StockbitAttempt);
				return;
			}
			setNotice({ tone: "bad", text: errorText(error), code: errorCode(error) });
		}
	}

	async function saveAndSignIn() {
		if (!credUser.trim() || !credPass) {
			setCredState("invalid_credentials");
			setCredError({ tone: "bad", text: "Enter the Stockbit email/username and password.", code: "invalid_credentials" });
			return;
		}
		setCredState("saving");
		setCredError(null);
		autoTried.current = true;
		try {
			const next = await stockbitApi.saveCredentials(credUser.trim(), credPass);
			setStatus(next);
			setCredUser(next.credentials?.username ?? credUser.trim());
			setCredPass("");
			setCredState("saved");
			setShowCredForm(false);
			await startLogin(false);
		} catch (error) {
			const code = errorCode(error) ?? "invalid_credentials";
			setCredState(code === "invalid_credentials" || code === "credentials_missing" ? code : "error");
			setCredError({ tone: "bad", text: errorText(error), code });
		}
	}

	async function saveCredentialsOnly() {
		if (!credUser.trim() || !credPass) {
			setCredState("invalid_credentials");
			setCredError({ tone: "bad", text: "Enter the Stockbit email/username and password.", code: "invalid_credentials" });
			return;
		}
		setCredState("saving");
		setCredError(null);
		try {
			const next = await stockbitApi.saveCredentials(credUser.trim(), credPass);
			setStatus(next);
			setCredUser(next.credentials?.username ?? credUser.trim());
			setCredPass("");
			setCredState("saved");
			setShowCredForm(false);
			setNotice({ tone: "ok", text: "Saved for the next automatic sign-in." });
		} catch (error) {
			const code = errorCode(error) ?? "invalid_credentials";
			setCredState(code === "invalid_credentials" || code === "credentials_missing" ? code : "error");
			setCredError({ tone: "bad", text: errorText(error), code });
		}
	}

	function openCredentialForm() {
		setCredUser(status?.credentials?.username ?? "");
		setCredPass("");
		setCredError(null);
		setCredState("idle");
		setShowCredForm(true);
	}

	async function clearSaved() {
		try {
			const next = await stockbitApi.clearCredentials();
			setStatus(next);
			setCredState("idle");
			setCredError(null);
			if (next.credentials?.configured) {
				setNotice({ tone: "warn", text: "The file was removed, but the environment still provides a sign-in. Unset STOCKBIT_USERNAME/PASSWORD to forget it.", code: "credentials_missing" });
			} else {
				setNotice({ tone: "ok", text: "The saved sign-in was forgotten. The current session stays until it expires or you disconnect." });
			}
		} catch (error) {
			setNotice({ tone: "bad", text: errorText(error), code: errorCode(error) });
		}
	}

	async function cancelLogin() {
		if (!attempt) return;
		try {
			const next = await stockbitApi.cancelLogin(attempt.id);
			setAttempt(next.attempt);
			setNotice({ tone: "warn", text: "The login was cancelled." });
			await refreshStatus();
		} catch (error) {
			setNotice({ tone: "bad", text: errorText(error), code: errorCode(error) });
		}
	}

	async function refreshSession() {
		setNotice(null);
		try {
			const next = await stockbitApi.refresh();
			setStatus(next);
			setNotice({ tone: "ok", text: "The access token was refreshed and the cookie jar updated." });
		} catch (error) {
			setNotice({ tone: "bad", text: errorText(error), code: errorCode(error) });
			await refreshStatus();
		}
	}

	async function logout() {
		if (!window.confirm("Disconnect Stockbit? The session cookies and the dedicated browser profile will be deleted. The saved automatic sign-in is kept; use Forget saved sign-in to remove it.")) return;
		autoTried.current = true;
		setNotice(null);
		try {
			const next = await stockbitApi.logout();
			setStatus(next);
			setAttempt(null);
			setSnapshot(null);
			setWatchlist(null);
			setNotice({ tone: "ok", text: "Disconnected. The session file and browser profile are gone." });
			await loadCache();
		} catch (error) {
			setNotice({ tone: "bad", text: errorText(error), code: errorCode(error) });
		}
	}

	async function saveToken() {
		if (!token.trim()) {
			setFormState("invalid_token");
			setFormError({ tone: "bad", text: "Paste an access token first.", code: "invalid_token" });
			return;
		}
		setFormState("saving");
		setFormError(null);
		try {
			const next = await stockbitApi.adoptToken(token.trim(), refreshToken.trim());
			setStatus(next);
			setFormState("saved");
			setFormError({ tone: "ok", text: "The token was saved." });
			setToken("");
			setRefreshToken("");
			await loadCache();
		} catch (error) {
			const code = errorCode(error) ?? "invalid_token";
			setFormState(code === "invalid_cookie" || code === "not_connected" ? code : "error");
			setFormError({ tone: "bad", text: errorText(error), code });
		}
	}

	async function saveCookies() {
		if (!cookie.trim()) {
			setFormState("invalid_cookie");
			setFormError({ tone: "bad", text: "Paste a Cookie header first.", code: "invalid_cookie" });
			return;
		}
		setFormState("saving");
		setFormError(null);
		try {
			const next = await stockbitApi.adoptCookies(cookie.trim());
			setStatus(next);
			setFormState("saved");
			setFormError({ tone: "ok", text: "The cookies were saved." });
			setCookie("");
			await loadCache();
		} catch (error) {
			const code = errorCode(error) ?? "invalid_cookie";
			setFormState(code === "invalid_token" || code === "not_connected" ? code : "error");
			setFormError({ tone: "bad", text: errorText(error), code });
		}
	}

	async function loadSymbol(target?: string) {
		const clean = (target ?? ticker).trim().toUpperCase();
		if (!clean) {
			setDataState("invalid_ticker");
			setDataNotice({ tone: "bad", text: "Enter a ticker.", code: "invalid_ticker" });
			return;
		}
		setTicker(clean);
		setSubmittedTicker(clean);
		setDataState("loading");
		setDataNotice(null);
		try {
			const next = await stockbitApi.symbol(clean, refreshData);
			setSnapshot(next);
			if (!next.available) {
				setDataState("empty");
				setDataNotice({ tone: "warn", text: next.warnings.join(" · ") || "Stockbit returned no data.", code: "empty" });
			} else if (next.warnings.length > 0) {
				setDataState("partial");
				setDataNotice({ tone: "warn", text: next.warnings.join(" · "), code: "partial" });
			} else {
				setDataState("idle");
				setDataNotice(null);
			}
		} catch (error) {
			const code = errorCode(error);
			setSnapshot(null);
			if (code === "reauth_required" || code === "not_connected") {
				setDataState("auth_required");
				setDataNotice({ tone: "warn", text: "Connect Stockbit in the session panel first.", code: "auth_required" });
			} else if (code === "rate_limited") {
				setDataState("rate_limited");
				setDataNotice({ tone: "warn", text: errorText(error), code });
			} else if (code === "invalid_ticker") {
				setDataState("invalid_ticker");
				setDataNotice({ tone: "bad", text: "That is not a valid IDX ticker.", code });
			} else if (code === "upstream_error") {
				setDataState("upstream_error");
				setDataNotice({ tone: "bad", text: errorText(error), code });
			} else {
				setDataState("error");
				setDataNotice({ tone: "bad", text: errorText(error), code });
			}
		}
	}

	async function loadWatchlist() {
		setWatchState("loading");
		setWatchNotice(null);
		try {
			const next = await stockbitApi.watchlist();
			setWatchlist(next);
			setWatchState(next.items.length > 0 ? "idle" : "empty");
			if (next.items.length === 0) setWatchNotice({ tone: "warn", text: "The active watchlist is empty.", code: "empty" });
		} catch (error) {
			const code = errorCode(error);
			if (code === "reauth_required" || code === "not_connected") {
				setWatchState("auth_required");
				setWatchNotice({ tone: "warn", text: "Connect Stockbit first.", code: "auth_required" });
			} else if (code === "upstream_error") {
				setWatchState("upstream_error");
				setWatchNotice({ tone: "bad", text: errorText(error), code });
			} else {
				setWatchState("error");
				setWatchNotice({ tone: "bad", text: errorText(error), code });
			}
		}
	}

	async function clearCache() {
		try {
			await stockbitApi.clearCache();
			await loadCache();
			setNotice({ tone: "ok", text: "The daemon data cache was cleared; the session is untouched." });
		} catch (error) {
			setCacheState("error");
			setNotice({ tone: "bad", text: errorText(error), code: errorCode(error) });
		}
	}

	return (
		<Page>
			<header className="mb-8">
				<p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-ghost)]">
					Companion session
				</p>
				<h1 className="mt-2 font-display text-[34px] leading-none tracking-[-0.02em] text-[var(--text)] sm:text-[40px]">
					Stockbit session
				</h1>
				<p className="mt-3 max-w-[80ch] text-[14px] leading-relaxed text-[var(--text-dim)]">
					Save your Stockbit account once and the local <span className="font-mono text-[var(--text)]">stockbitd</span>{" "}
					companion signs you in automatically, then keeps the cookies and the access token fresh. This page is the
					suite's front door to it: the daemon owns the session, the suite only proxies the data and the state. The
					Flow detail requests can use the same session for their broker rows.
				</p>
				<div className="mt-4 flex flex-wrap items-center gap-3 font-mono text-[10px] text-[var(--text-ghost)]">
					<span>daemon {status?.daemon_url ?? "http://127.0.0.1:8787"}</span>
					<span>·</span>
					<Link to="/flow" className="underline underline-offset-2 hover:text-[var(--text)]">
						Flow broker detail
					</Link>
					<span>·</span>
					<Link to="/method" className="underline underline-offset-2 hover:text-[var(--text)]">
						what the suite trades
					</Link>
				</div>
			</header>

			<Section
				title="Session"
				subtitle="The daemon opens the Chromium login window and fills Stockbit's own form with the saved account. It saves the cookie jar with mode 0600 and refreshes the token while it runs; a verification code or challenge from Stockbit still needs that one step in the window."
				right={
					<span className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: toneForState(viewState) }}>
						{viewState === "loading" ? "checking…" : stateLabel(viewState)}
					</span>
				}
			>
				<div className="border border-[var(--border)] bg-[var(--panel)] p-5">
					<div className="flex flex-wrap items-center gap-3">
						<span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: toneForState(viewState) }} aria-hidden />
						<span className="font-display text-[20px] text-[var(--text)]">{stateLabel(viewState)}</span>
						{status?.user && (
							<span className="font-mono text-[11px] text-[var(--text-faint)]">
								{status.user.fullname || status.user.username || "Stockbit account"}
							</span>
						)}
						{status?.session?.source && <span className="tag">{status.session.source}</span>}
					</div>

					{statusError && (
						<div className="mt-4 border border-[var(--border)] border-l-[3px] border-l-[var(--down)] bg-[var(--panel-2)] p-3 text-[12px] text-[var(--text-dim)]">
							The suite backend is not answering: {statusError}
						</div>
					)}

					<div className="mt-4">
						<NoticeLine notice={notice} />
					</div>

					{(viewState === "loading" || status === null) && !statusError && (
						<p className="mt-4 font-mono text-[12px] text-[var(--text-faint)]">Reading the daemon status…</p>
					)}

					{viewState === "daemon_unavailable" && (
						<div className="mt-4 space-y-3">
							<div className="border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel-2)] p-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
								<p className="text-[var(--text)]">The Stockbit companion is not running.</p>
								<p className="mt-1">
									Start it with <span className="font-mono text-[var(--text)]">./trading-suite run</span> (the runner starts it when it is
									built) or run <span className="font-mono text-[var(--text)]">stockbitd serve --open</span> on this machine.
								</p>
								{status?.error && <p className="mt-2 font-mono text-[11px] text-[var(--text-ghost)]">{status.error}</p>}
								{status?.daemon_url && <p className="mt-1 font-mono text-[11px] text-[var(--text-ghost)]">daemon: {status.daemon_url}</p>}
							</div>
							<button
								type="button"
								onClick={() => void refreshStatus()}
								className="border border-[var(--border-strong)] bg-[var(--panel-2)] px-3 py-1.5 font-mono text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]"
							>
								Retry status
							</button>
						</div>
					)}

					{attemptActive && attempt && (
						<div className="mt-4 space-y-3">
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-mono text-[12px] text-[var(--text-dim)]">{attempt.message}</span>
								{attempt.auto && <span className="tag">automatic sign-in</span>}
								{attempt.verification && <span className="tag">verification needed</span>}
							</div>
							<div className="h-1.5 overflow-hidden bg-[var(--panel-3)]">
								<div className="h-full w-1/3 animate-pulse bg-[var(--accent)]" />
							</div>
							<p className="max-w-[72ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
								{attempt.auto
									? "The daemon fills Stockbit's own login form with the saved account and submits it. If Stockbit asks for a verification code, PIN or a challenge, finish it in the window; the cookie is captured and saved as soon as the session lands."
									: "The Chromium window is on stockbit.com. Log in with whichever method Stockbit offers; the daemon reads the resulting cookie and closes the window when the session lands."}
							</p>
							{attempt.verification && (
								<div className="border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel-2)] p-3 text-[12px] text-[var(--text-dim)]">
									Stockbit is asking for verification in the window. Complete that one step there; the automatic sign-in
									continues by itself once it is accepted.
								</div>
							)}
							<button
								type="button"
								onClick={() => void cancelLogin()}
								className="border border-[var(--border-strong)] bg-[var(--panel-2)] px-3 py-1.5 font-mono text-[11px] text-[var(--down)] hover:bg-[var(--down-dim)]"
							>
								Cancel login
							</button>
						</div>
					)}

					{viewState === "connected" && status && (
						<div className="mt-4 space-y-4">
							<div className="grid gap-3 sm:grid-cols-3">
								<Stat label="Access token" value={left(status.access.expires_in_seconds)} />
								<Stat label="Refresh token" value={left(status.refresh.expires_in_seconds)} />
								<Stat label="Cookies" value={fmtNum(status.cookies.count, 0)} />
							</div>
							<div className="grid gap-x-6 gap-y-2 font-mono text-[11px] text-[var(--text-faint)] sm:grid-cols-2">
								<div>
									<span className="text-[var(--text-ghost)]">account</span>{" "}
									{status.user?.username || status.user?.email || "—"}
								</div>
								<div>
									<span className="text-[var(--text-ghost)]">last refresh</span>{" "}
									{status.session.last_refresh_at || "not yet"}
								</div>
								<div className="break-all">
									<span className="text-[var(--text-ghost)]">session file</span> {status.session.path || "—"}
								</div>
								<div>
									<span className="text-[var(--text-ghost)]">cookie domains</span>{" "}
									{status.cookies.domains.join(", ") || "—"}
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3 font-mono text-[10px] text-[var(--text-faint)]">
								<span className="uppercase tracking-[0.12em] text-[var(--text-ghost)]">automatic sign-in</span>
								{status.credentials?.configured ? (
									<>
										<span>
											saved for {status.credentials.username || "this account"}
											{status.credentials.source ? ` (${status.credentials.source})` : ""}
										</span>
										{status.credentials.source !== "env" && (
											<button type="button" onClick={() => void clearSaved()} className="underline underline-offset-2 hover:text-[var(--text)]">
												Forget saved sign-in
											</button>
										)}
										{status.credentials.source === "env" && (
											<span>from the environment; unset STOCKBIT_USERNAME/PASSWORD to remove it</span>
										)}
									</>
								) : (
									<button type="button" onClick={openCredentialForm} className="underline underline-offset-2 hover:text-[var(--text)]">
										Save it for the next reconnect
									</button>
								)}
							</div>
							{showCredForm && (
								<CredentialsForm
									username={credUser}
									password={credPass}
									state={credState}
									error={credError}
									onUsername={setCredUser}
									onPassword={setCredPass}
									onSubmit={() => void saveCredentialsOnly()}
									onCancel={() => setShowCredForm(false)}
									submitLabel="Save for next time"
								/>
							)}
							{warnings(status.warnings)}
							<div className="flex flex-wrap gap-2">
								<button type="button" onClick={() => void refreshSession()} className="primary">
									Refresh token now
								</button>
								<button type="button" onClick={() => void loadWatchlist()} className="secondary">
									Load watchlist
								</button>
								<button type="button" onClick={() => void logout()} className="danger ml-auto">
									Disconnect
								</button>
							</div>
						</div>
					)}

					{!attemptActive && viewState !== "daemon_unavailable" && viewState !== "loading" && viewState !== "connected" && (
						<div className="mt-4 space-y-4">
							{status?.browser && !status.browser.available && status.browser.reason && (
								<div className="border border-[var(--border)] border-l-[3px] border-l-[var(--bad,var(--down))] bg-[var(--panel-2)] p-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
									<span className="text-[var(--text)]">The browser cannot open the login window.</span>{" "}
									{status.browser.reason}
									{status.browser.code && <span className="ml-2 font-mono text-[10px] text-[var(--text-ghost)]">{status.browser.code}</span>}
								</div>
							)}

							{status?.credentials?.configured ? (
								<div className="space-y-3">
									<div className="border border-[var(--border)] border-l-[3px] border-l-[var(--accent)] bg-[var(--panel-2)] p-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
										<p className="text-[var(--text)]">
											Automatic sign-in is saved for{" "}
											<span className="font-mono">{status.credentials.username || "this Stockbit account"}</span>
											{status.credentials.source ? ` (${status.credentials.source})` : ""}.
										</p>
										<p className="mt-1">
											The daemon opens Chromium and fills Stockbit's own login form with it. If Stockbit asks for a
											verification code, PIN or a challenge, finish that one step in the window; the session is captured
											and saved as soon as it lands.
										</p>
										{viewState === "reauth_required" && (
											<p className="mt-1 text-[var(--gold)]">
												The refresh token expired; this saved sign-in will rebuild the cookie jar automatically.
											</p>
										)}
										{viewState === "error" && status?.error && (
											<p className="mt-1 text-[var(--down)]">{status.error}</p>
										)}
									</div>
									<div className="flex flex-wrap items-center gap-2">
										<button
											type="button"
											onClick={() => void startLogin(false)}
											disabled={status?.browser?.available === false}
											className="primary"
										>
											Sign in automatically again
										</button>
										<button type="button" onClick={openCredentialForm} className="secondary">
											Change saved sign-in
										</button>
										{status.credentials.source !== "env" && (
											<button type="button" onClick={() => void clearSaved()} className="danger ml-auto">
												Forget saved sign-in
											</button>
										)}
									</div>
									{status.credentials.source === "env" && (
										<p className="font-mono text-[10px] text-[var(--text-ghost)]">
											This sign-in comes from STOCKBIT_USERNAME/PASSWORD; unset them to forget it.
										</p>
									)}
									{showCredForm && (
										<CredentialsForm
											username={credUser}
											password={credPass}
											state={credState}
											error={credError}
											onUsername={setCredUser}
											onPassword={setCredPass}
											onSubmit={() => void saveAndSignIn()}
											onCancel={() => setShowCredForm(false)}
											submitLabel="Save and sign in"
										/>
									)}
									<p className="font-mono text-[10px] text-[var(--text-ghost)]">
										The automatic attempt runs once when this page opens. A failed sign-in does not loop; update the
										account above or use the fallback below.
									</p>
								</div>
							) : (
								<div className="space-y-3">
									<div className="border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel-2)] p-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
										<p className="text-[var(--text)]">
											Stockbit has no app passwords. Save your stockbit.com account once and the daemon will fill the
											real login form for you.
										</p>
										<p className="mt-1">
											The password is stored locally with mode 0600; the suite never prints it and never returns it.
											The browser window opens only to perform the sign-in, and a verification code, PIN or challenge
											from Stockbit still needs that one step in the window.
										</p>
									</div>
									<CredentialsForm
										username={credUser}
										password={credPass}
										state={credState}
										error={credError}
										onUsername={setCredUser}
										onPassword={setCredPass}
										onSubmit={() => void saveAndSignIn()}
										onCancel={undefined}
										submitLabel="Save and sign in"
									/>
								</div>
							)}

							<FallbackForms
								token={token}
								refreshToken={refreshToken}
								cookie={cookie}
								formState={formState}
								formError={formError}
								onToken={setToken}
								onRefresh={setRefreshToken}
								onCookie={setCookie}
								onSaveToken={() => void saveToken()}
								onSaveCookies={() => void saveCookies()}
								onManual={() => void startLogin(true)}
							/>
						</div>
					)}
				</div>
			</Section>

			<Section
				title="Data"
				subtitle="Quote, company info, orderbook imbalance and the per-broker net rows, read through the saved session."
				right={status?.cache ? `${status.cache.hits} cache hits` : undefined}
			>
				<div className="flex flex-wrap items-end gap-3">
					<label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
						ticker
						<input
							value={ticker}
							onChange={(event) => setTicker(event.target.value.toUpperCase())}
							onKeyDown={(event) => {
								if (event.key === "Enter") void loadSymbol();
							}}
							maxLength={8}
							className="w-[140px] border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[12px] text-[var(--text)]"
						/>
					</label>
					<label className="flex items-center gap-2 font-mono text-[11px] text-[var(--text-faint)]">
						<input type="checkbox" checked={refreshData} onChange={(event) => setRefreshData(event.target.checked)} />
						refresh
					</label>
					<button type="button" onClick={() => void loadSymbol()} disabled={dataState === "loading"} className="primary">
						{dataState === "loading" ? "Reading…" : "Fetch snapshot"}
					</button>
				</div>
				<div className="mt-4">
					<NoticeLine notice={dataNotice} />
				</div>
				{dataState === "loading" && (
					<p className="mt-4 font-mono text-[12px] text-[var(--text-faint)]">Reading Stockbit…</p>
				)}
				{snapshot && dataState !== "loading" && (
					<div className="mt-4 space-y-5">
						<SnapshotView snapshot={snapshot} />
					</div>
				)}
				{!snapshot && dataState !== "loading" && dataState === "idle" && (
					<p className="mt-4 font-mono text-[12px] text-[var(--text-ghost)]">
						Enter a ticker and fetch the snapshot. The daemon caches the reads; the cache panel below shows them.
					</p>
				)}
			</Section>

			<StockbitAnalysis
				ticker={submittedTicker}
				snapshot={snapshot}
				onSelect={(next) => {
					setTicker(next);
					void loadSymbol(next);
				}}
			/>

			<Section
				title="Personal watchlist"
				subtitle="The groups that belong to this Stockbit account, read from the daemon."
				right={watchlist?.active?.name}
			>
				<div className="flex flex-wrap items-center gap-3">
					<button
						type="button"
						onClick={() => void loadWatchlist()}
						disabled={!connected || watchState === "loading"}
						className="secondary"
					>
						{watchState === "loading" ? "Loading…" : "Load watchlist"}
					</button>
					{!connected && <span className="font-mono text-[10px] text-[var(--text-ghost)]">connect Stockbit first</span>}
				</div>
				<div className="mt-4">
					<NoticeLine notice={watchNotice} />
				</div>
				{watchlist && watchlist.items.length > 0 && (
					<div className="mt-4 overflow-x-auto border border-[var(--border)] bg-[var(--panel)]">
						<table className="w-full border-collapse text-left">
							<thead>
								<tr className="border-b border-[var(--border)] font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
									<th className="px-3 py-2">Ticker</th>
									<th className="px-3 py-2">Name</th>
									<th className="px-3 py-2 text-right">Last</th>
									<th className="px-3 py-2 text-right">Change</th>
								</tr>
							</thead>
							<tbody>
								{watchlist.items.slice(0, 40).map((item) => (
									<tr key={item.ticker} className="border-b border-[var(--border)] last:border-0">
										<td className="px-3 py-2 font-mono text-[12px] text-[var(--text)]">{item.ticker}</td>
										<td className="px-3 py-2 text-[12px] text-[var(--text-dim)]">{item.name ?? "—"}</td>
										<td className="px-3 py-2 text-right font-mono text-[12px] text-[var(--text-dim)]">{fmtIdr(item.last)}</td>
										<td className="px-3 py-2 text-right">
											<ChangeBadge value={item.change_pct} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{watchState === "empty" && <p className="mt-4 font-mono text-[12px] text-[var(--text-ghost)]">The active watchlist is empty.</p>}
				{watchState === "error" && !watchNotice && <p className="mt-4 font-mono text-[12px] text-[var(--text-down)]">The watchlist failed.</p>}
			</Section>

			<Section
				title="Daemon cache"
				subtitle="Stockbit reads cached inside the companion. The session cookies are not in this cache and clearing it does not disconnect you."
				right={cache ? `${cache.entries} entries` : undefined}
			>
				{cacheState === "loading" && <p className="font-mono text-[12px] text-[var(--text-faint)]">Reading cache…</p>}
				{cacheState === "error" && <p className="font-mono text-[12px] text-[var(--text-down)]">The cache endpoint failed.</p>}
				{cache && (
					<div className="space-y-3">
						<div className="grid gap-3 sm:grid-cols-3">
							<Stat label="Entries" value={fmtNum(cache.entries, 0)} />
							<Stat label="Hits" value={fmtNum(cache.hits, 0)} />
							<Stat label="Misses" value={fmtNum(cache.misses, 0)} />
						</div>
						{cache.keys.length > 0 && (
							<ul className="max-h-40 overflow-y-auto border border-[var(--border)] bg-[var(--panel)] p-3 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
								{cache.keys.map((key) => (
									<li key={key}>{key}</li>
								))}
							</ul>
						)}
						<button type="button" onClick={() => void clearCache()} className="danger">
							Clear data cache
						</button>
					</div>
				)}
			</Section>

			<footer className="mt-12 border-t border-[var(--border)] pt-5 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
				<p>
					The session belongs to the local stockbitd companion, not to this app. The daemon keeps the cookie jar and
					refreshes the token; the suite proxies its JSON. The session file lives outside the repository and is written
					with mode 0600. <Link to="/flow" className="underline underline-offset-2 hover:text-[var(--text)]">Flow</Link>{" "}
					can use the same session for its broker detail.
				</p>
			</footer>
		</Page>
	);
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="border border-[var(--border)] bg-[var(--panel-2)] p-3">
			<div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">{label}</div>
			<div className="mt-1 font-mono text-[15px] tabular-nums text-[var(--text)]">{value}</div>
		</div>
	);
}

function warnings(items: string[] | undefined) {
	if (!items || items.length === 0) return null;
	return (
		<ul className="space-y-1 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
			{items.map((item) => (
				<li key={item}>· {item}</li>
			))}
		</ul>
	);
}

function left(seconds: number | undefined): string {
	if (seconds == null) return "unknown";
	if (seconds <= 0) return "expired";
	const days = Math.floor(seconds / 86400);
	if (days >= 1) return `${days}d ${Math.floor((seconds % 86400) / 3600)}h`;
	const hours = Math.floor(seconds / 3600);
	if (hours >= 1) return `${hours}h ${Math.floor((seconds % 3600) / 60)}m`;
	return `${Math.max(1, Math.floor(seconds / 60))}m`;
}

function SnapshotView({ snapshot }: { snapshot: StockbitSnapshot }) {
	const quote = snapshot.quote;
	return (
		<>
			<div className="flex flex-wrap items-end justify-between gap-3">
				<div>
					<span className="font-display text-[26px] text-[var(--text)]">{snapshot.ticker}</span>
					{snapshot.info?.name && <span className="ml-2 text-[13px] text-[var(--text-dim)]">{snapshot.info.name}</span>}
				</div>
				{quote && (
					<div className="flex items-center gap-3">
						<span className="font-mono text-[22px] tabular-nums text-[var(--text)]">{fmtIdr(quote.last)}</span>
						<ChangeBadge value={quote.change_pct} />
					</div>
				)}
			</div>
			{quote && (
				<div className="grid gap-3 sm:grid-cols-3">
					<Stat label="Open" value={fmtIdr(quote.open)} />
					<Stat label="High / low" value={`${fmtIdr(quote.high)} / ${fmtIdr(quote.low)}`} />
					<Stat label="Volume" value={fmtNum(quote.volume, 0)} />
				</div>
			)}
			{snapshot.info?.available && (
				<div className="grid gap-x-6 gap-y-2 border border-[var(--border)] bg-[var(--panel-2)] p-4 font-mono text-[11px] text-[var(--text-faint)] sm:grid-cols-2">
					<div>
						<span className="text-[var(--text-ghost)]">sector</span> {snapshot.info.sector || "—"}
						{snapshot.info.sub_sector ? ` · ${snapshot.info.sub_sector}` : ""}
					</div>
					<div>
						<span className="text-[var(--text-ghost)]">industry</span> {snapshot.info.industry || "—"}
					</div>
					<div>
						<span className="text-[var(--text-ghost)]">listed</span> {snapshot.info.listing_date || "—"}
					</div>
					<div>
						<span className="text-[var(--text-ghost)]">market cap</span> {fmtIdr(snapshot.info.market_cap, true)}
					</div>
				</div>
			)}
			{snapshot.orderbook?.available && (
				<div className="border border-[var(--border)] bg-[var(--panel-2)] p-4">
					<div className="flex items-baseline justify-between font-mono text-[11px] text-[var(--text-faint)]">
						<span>orderbook imbalance</span>
						<span className="tabular text-[var(--text)]">
							{snapshot.orderbook.imbalance == null ? "—" : snapshot.orderbook.imbalance.toFixed(3)}
						</span>
					</div>
					<div className="mt-2 flex h-1.5 overflow-hidden bg-[var(--panel-3)]">
						<div
							className="h-full bg-[var(--up)]"
							style={{ width: `${Math.round(((Math.max(-1, Math.min(1, snapshot.orderbook.imbalance ?? 0)) + 1) / 2) * 100)}%` }}
						/>
						<div className="h-full flex-1 bg-[var(--down)]" />
					</div>
					<div className="mt-2 flex justify-between font-mono text-[10px] text-[var(--text-ghost)]">
						<span>bid {fmtNum(snapshot.orderbook.bid_lots, 0)} lots</span>
						<span>offer {fmtNum(snapshot.orderbook.offer_lots, 0)} lots</span>
					</div>
					<div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--text-ghost)]">
						<span>best bid {fmtIdr(snapshot.orderbook.best_bid)}</span>
						<span>best offer {fmtIdr(snapshot.orderbook.best_offer)}</span>
					</div>
				</div>
			)}
			{snapshot.brokers?.available && snapshot.brokers.rows.length > 0 && (
				<div className="overflow-x-auto border border-[var(--border)] bg-[var(--panel)]">
					<div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)] px-3 py-2 font-mono text-[10px] text-[var(--text-ghost)]">
						<span>broker net rows · {snapshot.brokers.date}</span>
						<span>
							{snapshot.brokers.top3_concentration_pct == null
								? "—"
								: `top3 ${snapshot.brokers.top3_concentration_pct.toFixed(1)}%`}
						</span>
					</div>
					<table className="w-full border-collapse text-left">
						<thead>
							<tr className="border-b border-[var(--border)] font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">
								<th className="px-3 py-2">Broker</th>
								<th className="px-3 py-2">Side</th>
								<th className="px-3 py-2 text-right">Net lots</th>
								<th className="px-3 py-2 text-right">Net value</th>
								<th className="px-3 py-2 text-right">Avg price</th>
							</tr>
						</thead>
						<tbody>
							{snapshot.brokers.rows.slice(0, 12).map((row: StockbitBrokerRow, index) => (
								<tr key={`${row.broker}-${row.side}-${index}`} className="border-b border-[var(--border)] last:border-0">
									<td className="px-3 py-1.5 font-mono text-[12px] text-[var(--text)]">{row.broker}</td>
									<td className="px-3 py-1.5 font-mono text-[11px]" style={{ color: row.side === "buy" ? "var(--up)" : "var(--down)" }}>
										{row.side}
									</td>
									<td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums" style={{ color: row.net_lots >= 0 ? "var(--up)" : "var(--down)" }}>
										{fmtNum(row.net_lots, 0)}
									</td>
									<td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-[var(--text-dim)]">
										{fmtIdr(row.net_value, true)}
									</td>
									<td className="px-3 py-1.5 text-right font-mono text-[11px] tabular-nums text-[var(--text-dim)]">
										{fmtIdr(row.side === "buy" ? row.avg_buy_price : row.avg_sell_price)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
			<div className="font-mono text-[10px] text-[var(--text-ghost)]">
				as of {snapshot.as_of}
				{snapshot.cache ? ` · cache ${snapshot.cache.hit ? snapshot.cache.age_seconds + "s" : "computed"}` : ""}
			</div>
		</>
	);
}

function CredentialsForm({
	username,
	password,
	state,
	error,
	onUsername,
	onPassword,
	onSubmit,
	onCancel,
	submitLabel,
}: {
	username: string;
	password: string;
	state: CredState;
	error: Notice | null;
	onUsername: (value: string) => void;
	onPassword: (value: string) => void;
	onSubmit: () => void;
	onCancel?: () => void;
	submitLabel: string;
}) {
	return (
		<form
			className="space-y-3 border border-[var(--border)] bg-[var(--panel-2)] p-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--text-ghost)]">
				automatic Stockbit sign-in
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
					email or username
					<input
						value={username}
						onChange={(event) => onUsername(event.target.value)}
						autoComplete="username"
						spellCheck={false}
						className="w-full border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[12px] text-[var(--text)]"
					/>
				</label>
				<label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
					password
					<input
						type="password"
						value={password}
						onChange={(event) => onPassword(event.target.value)}
						autoComplete="current-password"
						className="w-full border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[12px] text-[var(--text)]"
					/>
				</label>
			</div>
			{error && <NoticeLine notice={error} />}
			<div className="flex flex-wrap items-center gap-2">
				<button type="submit" disabled={state === "saving"} className="primary">
					{state === "saving" ? "saving…" : state === "saved" ? "saved" : submitLabel}
				</button>
				{onCancel && (
					<button type="button" onClick={onCancel} className="secondary">
						Cancel
					</button>
				)}
				<span className="font-mono text-[10px] text-[var(--text-ghost)]">stored locally · mode 0600 · never returned by the API</span>
			</div>
			<p className="font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
				The daemon opens a real Chromium window and fills Stockbit's own form. A verification code, PIN or challenge
				from Stockbit is a step only you can complete in that window.
			</p>
		</form>
	);
}

function FallbackForms({
	token,
	refreshToken,
	cookie,
	formState,
	formError,
	onToken,
	onRefresh,
	onCookie,
	onSaveToken,
	onSaveCookies,
	onManual,
}: {
	token: string;
	refreshToken: string;
	cookie: string;
	formState: FormState;
	formError: Notice | null;
	onToken: (value: string) => void;
	onRefresh: (value: string) => void;
	onCookie: (value: string) => void;
	onSaveToken: () => void;
	onSaveCookies: () => void;
	onManual?: () => void;
}) {
	return (
		<details className="border-t border-[var(--border)] pt-4">
			<summary className="cursor-pointer font-mono text-[11px] text-[var(--text-dim)] hover:text-[var(--text)]">
				Use a token or a Cookie header instead
			</summary>
			<div className="mt-3 space-y-4">
				{onManual && (
					<div className="space-y-2 border-b border-[var(--border)] pb-3">
						<button type="button" onClick={onManual} className="secondary">
							Open the Stockbit login window manually
						</button>
						<p className="font-mono text-[10px] text-[var(--text-ghost)]">
							For a different account, or when Stockbit changes its form. The saved automatic sign-in is not used.
						</p>
					</div>
				)}
				<p className="max-w-[76ch] text-[12px] leading-relaxed text-[var(--text-faint)]">
					If the browser window is unavailable, copy the value from DevTools. The Cookie header route normally carries
					the <span className="font-mono text-[var(--text)]">credentialStorage</span> cookie and therefore the tokens.
				</p>
				{formError && <NoticeLine notice={formError} />}
				<form
					className="space-y-2"
					onSubmit={(event) => {
						event.preventDefault();
						onSaveToken();
					}}
				>
					<label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
						access token
						<textarea
							value={token}
							onChange={(event) => onToken(event.target.value)}
							placeholder="eyJhbGciOi…"
							spellCheck={false}
							rows={3}
							className="w-full border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)]"
						/>
					</label>
					<label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
						refresh token (optional, recommended)
						<input
							value={refreshToken}
							onChange={(event) => onRefresh(event.target.value)}
							placeholder="refresh token"
							spellCheck={false}
							className="w-full border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)]"
						/>
					</label>
					<button type="submit" disabled={formState === "saving"} className="secondary">
						{formState === "saving" ? "saving…" : formState === "saved" ? "saved" : "Save token"}
					</button>
				</form>
				<form
					className="space-y-2 border-t border-[var(--border)] pt-3"
					onSubmit={(event) => {
						event.preventDefault();
						onSaveCookies();
					}}
				>
					<label className="grid gap-1 font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">
						cookie header
						<textarea
							value={cookie}
							onChange={(event) => onCookie(event.target.value)}
							placeholder="credentialStorage=%7B…; other=value"
							spellCheck={false}
							rows={3}
							className="w-full border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 font-mono text-[11px] text-[var(--text)]"
						/>
					</label>
					<button type="submit" disabled={formState === "saving"} className="secondary">
						{formState === "saving" ? "saving…" : formState === "saved" ? "saved" : "Save cookies"}
					</button>
				</form>
				<p className="font-mono text-[10px] text-[var(--text-ghost)]">
					form states: idle, saving, saved, invalid_token, invalid_cookie, not_connected, error
				</p>
			</div>
		</details>
	);
}

/* ── analysis and recommendation ─────────────────────────────────────────── */

// Codes handled here: plan_unavailable, data_error.
// N: plan_available — the recommendation is the study-backed plan; when the
//    study is missing the Stockbit snapshot still renders, explicitly as context.
type AnalysisState = "loading" | "idle" | "empty" | "partial" | "plan_unavailable" | "error";

function StockbitAnalysis({
	ticker,
	snapshot,
	onSelect,
}: {
	ticker: string | null;
	snapshot: StockbitSnapshot | null;
	onSelect: (ticker: string) => void;
}) {
	const [plan, setPlan] = useState<Plan | null>(null);
	const [planState, setPlanState] = useState<AnalysisState>("loading");
	const [planError, setPlanError] = useState<string | null>(null);
	const [detail, setDetail] = useState<PlanDetail | null>(null);
	const [detailState, setDetailState] = useState<AnalysisState>("idle");
	const [detailError, setDetailError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		planApi
			.plan()
			.then((next) => {
				if (!alive) return;
				setPlan(next);
				setPlanError(null);
				setPlanState(next.candidates.length + next.watchlist.length > 0 ? "idle" : "empty");
			})
			.catch((error) => {
				if (!alive) return;
				const code = errorCode(error);
				setPlanError(errorText(error));
				setPlanState(code === "plan_unavailable" || error instanceof ApiError && (error.status === 404 || error.status >= 500) ? "plan_unavailable" : "error");
			});
		return () => {
			alive = false;
		};
	}, []);

	useEffect(() => {
		if (!ticker) {
			setDetail(null);
			setDetailState("idle");
			return;
		}
		let alive = true;
		setDetail(null);
		setDetailError(null);
		setDetailState("loading");
		planApi
			.detail(ticker)
			.then((next) => {
				if (!alive) return;
				setDetail(next);
				setDetailState(next.gates.length > 0 ? "idle" : "empty");
			})
			.catch((error) => {
				if (!alive) return;
				setDetailError(errorText(error));
				setDetailState(error instanceof ApiError && (error.status === 404 || error.status >= 500) ? "plan_unavailable" : "error");
			});
		return () => {
			alive = false;
		};
	}, [ticker]);

	const planMissing = planState === "plan_unavailable" || planState === "error";
	const partial = planMissing && detail !== null;
	const evidence = plan?.corrected ?? plan?.evidence ?? null;
	// Evidence.win_rate is a fraction (0.7632); avg_ret_pct is already a percent.
	const winRate = evidence?.win_rate == null ? null : evidence.win_rate * 100;
	const verdictState = plan?.verdict.state ?? null;

	return (
		<Section
			title="Analysis & recommendation"
			subtitle="The suite's measured plan for this name, with the Stockbit broker flow shown beside it as context. The plan's verdict does not take Stockbit rows as an input."
			right={
				verdictState ? (
					<span className="font-mono text-[11px] uppercase tracking-[0.14em]" style={{ color: verdictTone(verdictState) }}>
						{verdictState}
					</span>
				) : undefined
			}
		>
			<div className="space-y-5">
				{planState === "loading" && (
					<p className="font-mono text-[12px] text-[var(--text-faint)]">Reading tonight's plan…</p>
				)}
				{(planState === "error" || planState === "plan_unavailable") && (
					<div className="border border-[var(--border)] border-l-[3px] border-l-[var(--gold)] bg-[var(--panel-2)] p-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
						<span className="text-[var(--text)]">The plan is unavailable.</span>{" "}
						{planError || "The study artifacts could not be read."} The Stockbit snapshot above is still shown, as
						context only. See{" "}
						<Link to="/method" className="underline underline-offset-2 hover:text-[var(--text)]">
							the method page
						</Link>
						.
						<span className="ml-2 font-mono text-[10px] text-[var(--text-ghost)]">plan_unavailable</span>
					</div>
				)}
				{partial && (
					<div className="border border-[var(--border)] bg-[var(--panel-2)] p-3 font-mono text-[11px] text-[var(--text-faint)]">
						partial · the name's gates are available but the nightly plan is not.
					</div>
				)}

				{plan && <PlanStrip plan={plan} onSelect={onSelect} />}

				{planState === "empty" && plan && (
					<div className="border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px] leading-relaxed text-[var(--text-dim)]">
						<span className="text-[var(--text)]">No names clear the chain tonight.</span> {plan.verdict.headline}
					</div>
				)}

				{!ticker && (
					<p className="font-mono text-[12px] text-[var(--text-ghost)]">
						Fetch a snapshot above to see the name-level gates and the recommendation.
					</p>
				)}
				{detailState === "loading" && (
					<p className="font-mono text-[12px] text-[var(--text-faint)]">Reading the gates for {ticker}…</p>
				)}
				{detailState === "error" || detailState === "plan_unavailable" ? (
					<div className="border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px] text-[var(--text-dim)]">
						The name analysis failed: {detailError || "the plan did not answer."}
						{detailState === "plan_unavailable" && (
							<span className="ml-2 font-mono text-[10px] text-[var(--text-ghost)]">plan_unavailable</span>
						)}
					</div>
				) : null}

				{detail && <AnalysisDetail detail={detail} plan={plan} />}

				{plan && verdictState && detail && (
					<RecommendationCard plan={plan} detail={detail} snapshot={snapshot} />
				)}

				{snapshot?.brokers?.available && snapshot.brokers.rows.length > 0 && <BrokerContext snapshot={snapshot} />}

				{evidence && (
					<div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-[var(--border)] pt-3 font-mono text-[10px] text-[var(--text-ghost)]">
						<span>
							method {evidence.role.replaceAll("_", " ")}: {winRate == null ? "—" : winRate.toFixed(2) + "%"} win /{" "}
							{evidence.avg_ret_pct == null ? "—" : evidence.avg_ret_pct.toFixed(2) + "%"} per trade
						</span>
						<span>{evidence.oos_trades == null ? "" : evidence.oos_trades + " trades"}</span>
						<Link to="/method" className="underline underline-offset-2 hover:text-[var(--text)]">
							the measured method
						</Link>
					</div>
				)}
			</div>
		</Section>
	);
}

function PlanStrip({ plan, onSelect }: { plan: Plan; onSelect: (ticker: string) => void }) {
	const candidates = plan.candidates.slice(0, 4);
	const watchlist = plan.watchlist.slice(0, 4);
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)] p-4">
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
				<span className="font-display text-[18px] text-[var(--text)]">{plan.verdict.state}</span>
				<span className="text-[12px] leading-relaxed text-[var(--text-dim)]">{plan.verdict.headline}</span>
				<span className="ml-auto font-mono text-[10px] text-[var(--text-ghost)]">
					{plan.regime.band} · breadth {fmtNum(plan.regime.breadth * 100, 1)}%
				</span>
			</div>
			<p className="mt-2 max-w-[80ch] text-[12px] leading-relaxed text-[var(--text-faint)]">{plan.verdict.action}</p>
			{(candidates.length > 0 || watchlist.length > 0) && (
				<div className="mt-3 flex flex-wrap gap-2">
					{candidates.map((candidate) => (
						<button
							key={candidate.ticker}
							type="button"
							onClick={() => onSelect(candidate.ticker)}
							className="border border-[var(--up)]/40 bg-[var(--up-dim)] px-2 py-1 font-mono text-[11px] text-[var(--up)]"
							title="In tonight's plan; load the Stockbit snapshot"
						>
							{candidate.ticker} · in plan
						</button>
					))}
					{watchlist.map((item) => (
						<button
							key={item.ticker}
							type="button"
							onClick={() => onSelect(item.ticker)}
							className="border border-[var(--border-strong)] bg-[var(--panel-2)] px-2 py-1 font-mono text-[11px] text-[var(--text-dim)]"
							title="Watching; load the Stockbit snapshot"
						>
							{item.ticker} · {item.blocked_by.replaceAll("_", " ")}
						</button>
					))}
				</div>
			)}
			{plan.candidates.length === 0 && plan.watchlist.length === 0 && (
				<p className="mt-3 font-mono text-[11px] text-[var(--text-ghost)]">No names to recommend tonight.</p>
			)}
		</div>
	);
}

function AnalysisDetail({ detail, plan }: { detail: PlanDetail; plan: Plan | null }) {
	const blockedLabel = detail.gates.find((gate) => gate.key === detail.blocked_by)?.label ?? detail.blocked_by ?? "—";
	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-mono text-[12px] text-[var(--text)]">{detail.ticker}</span>
				<span className="font-mono text-[10px] text-[var(--text-ghost)]">
					{detail.in_plan ? "in the plan" : "not in the plan"} · RS {fmtNum(detail.rs_rating, 0)} · breadth{" "}
					{fmtNum(detail.breadth * 100, 0)}%
				</span>
			</div>
			<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
				{detail.gates.map((gate) => (
					<div key={gate.key} className="border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2">
						<div className="flex items-baseline justify-between gap-2">
							<span className="font-mono text-[10px] uppercase tracking-[0.1em] text-[var(--text-faint)]">{gate.label}</span>
							<span className="font-mono text-[10px]" style={{ color: gate.passed ? "var(--up)" : "var(--gold)" }}>
								{gate.passed ? "open" : "shut"}
							</span>
						</div>
						<p className="mt-1 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">{gate.text}</p>
					</div>
				))}
			</div>
			<div className="grid gap-x-6 gap-y-1 font-mono text-[11px] text-[var(--text-faint)] sm:grid-cols-2">
				<div>
					<span className="text-[var(--text-ghost)]">blocked by</span> {detail.in_plan ? "—" : blockedLabel}
				</div>
				<div>
					<span className="text-[var(--text-ghost)]">distance</span> {detail.distance_text ?? "—"}
				</div>
				<div>
					<span className="text-[var(--text-ghost)]">close</span> {fmtIdr(detail.close)}
				</div>
				<div>
					<span className="text-[var(--text-ghost)]">turnover</span> {fmtIdr(detail.turnover_idr, true)}
				</div>
			</div>
			{detail.geometry && (
				<div className="grid gap-3 sm:grid-cols-4">
					<Stat label="Entry" value={fmtIdr(detail.geometry.entry_ref)} />
					<Stat label="Target" value={fmtIdr(detail.geometry.target_price)} />
					<Stat label="Stop" value={fmtIdr(detail.geometry.stop_price)} />
					<Stat label="Sized" value={detail.geometry.position_idr == null ? "not sizeable" : fmtIdr(detail.geometry.position_idr, true)} />
				</div>
			)}
			{plan && detail.in_plan && detail.geometry?.position_idr == null && (
				<p className="font-mono text-[10px] text-[var(--gold)]">
					The study's sizing rule rejects this name; it appears in the plan without a ticket.
				</p>
			)}
			{(!detail.in_plan || plan?.verdict.state !== "ENTER") && (
				<p className="font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
					This entry, target and stop is the method's geometry for the name, not a ticket. The recommendation below is
					the decision.
				</p>
			)}
		</div>
	);
}

function RecommendationCard({
	plan,
	detail,
	snapshot,
}: {
	plan: Plan;
	detail: PlanDetail;
	snapshot: StockbitSnapshot | null;
}) {
	const verdict = plan.verdict.state;
	let tone: Tone = "warn";
	let title = "No ticket tonight";
	let body = plan.verdict.detail;
	if (verdict === "DATA_UNSAFE") {
		tone = "bad";
		title = "No ticket: data unsafe";
		body = "The method withholds every ticket when the data cannot be trusted; this includes this name.";
	} else if (verdict !== "ENTER") {
		tone = "warn";
		title = `No ticket: the verdict is ${verdict}`;
		body = plan.verdict.action;
	} else if (detail.in_plan && detail.geometry?.position_idr != null) {
		tone = "ok";
		title = "In tonight's plan";
		body = `The plan sizes this at ${fmtIdr(detail.geometry.position_idr, true)} with a ${fmtIdr(detail.geometry.target_price)} target and ${fmtIdr(detail.geometry.stop_price)} stop. The ticket and the exit are on the name page.`;
	} else if (detail.in_plan) {
		tone = "warn";
		title = "In the plan, not sizeable";
		body = "The name clears the chain but the study's sizing rule rejects it, so there is no ticket.";
	} else {
		tone = "warn";
		title = "Not in tonight's plan";
		const blocked = detail.gates.find((gate) => gate.key === detail.blocked_by)?.label ?? detail.blocked_by ?? "a gate";
		body = `Blocked by ${blocked}${detail.distance_text ? ": " + detail.distance_text : ""}. The Stockbit rows below are context, not a reason to override the chain.`;
	}
	const toneColor = tone === "ok" ? "var(--up)" : tone === "bad" ? "var(--down)" : "var(--gold)";
	return (
		<div className="border border-[var(--border)] bg-[var(--panel)] p-4" style={{ borderLeftWidth: 3, borderLeftColor: toneColor }}>
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-display text-[16px] text-[var(--text)]">{title}</span>
				<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-ghost)]">recommendation</span>
			</div>
			<p className="mt-2 max-w-[80ch] text-[12px] leading-relaxed text-[var(--text-dim)]">{body}</p>
			{snapshot?.brokers?.available && (
				<p className="mt-2 font-mono text-[10px] text-[var(--text-ghost)]">
					Stockbit broker rows exist for {snapshot.brokers.date}; they are context only and are never an input to this verdict.
				</p>
			)}
			<Link
				to="/name/$ticker"
				params={{ ticker: detail.ticker }}
				className="mt-2 inline-block font-mono text-[11px] text-[var(--accent)] underline underline-offset-2 hover:text-[var(--text)]"
			>
				Open the name page
			</Link>
		</div>
	);
}

function BrokerContext({ snapshot }: { snapshot: StockbitSnapshot }) {
	const rows = snapshot.brokers?.rows ?? [];
	const buys = [...rows].filter((row) => row.side === "buy").sort((a, b) => b.net_lots - a.net_lots).slice(0, 3);
	const sells = [...rows].filter((row) => row.side === "sell").sort((a, b) => a.net_lots - b.net_lots).slice(0, 3);
	return (
		<div className="border border-[var(--border)] bg-[var(--panel-2)] p-4">
			<div className="flex flex-wrap items-baseline justify-between gap-2">
				<span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--text-faint)]">Stockbit broker flow · context</span>
				<span className="font-mono text-[10px] text-[var(--text-ghost)]">{snapshot.brokers?.date}</span>
			</div>
			<div className="mt-2 grid gap-3 sm:grid-cols-2">
				<div>
					<div className="font-mono text-[10px] text-[var(--up)]">net buyers</div>
					<ul className="mt-1 space-y-0.5 font-mono text-[11px] text-[var(--text-dim)]">
						{buys.map((row) => (
							<li key={row.broker + row.side} className="flex justify-between gap-3">
								<span>{row.broker}</span>
								<span className="tabular text-[var(--up)]">{fmtNum(row.net_lots, 0)} lots</span>
							</li>
						))}
						{buys.length === 0 && <li className="text-[var(--text-ghost)]">no net buyers</li>}
					</ul>
				</div>
				<div>
					<div className="font-mono text-[10px] text-[var(--down)]">net sellers</div>
					<ul className="mt-1 space-y-0.5 font-mono text-[11px] text-[var(--text-dim)]">
						{sells.map((row) => (
							<li key={row.broker + row.side} className="flex justify-between gap-3">
								<span>{row.broker}</span>
								<span className="tabular text-[var(--down)]">{fmtNum(row.net_lots, 0)} lots</span>
							</li>
						))}
						{sells.length === 0 && <li className="text-[var(--text-ghost)]">no net sellers</li>}
					</ul>
				</div>
			</div>
			<p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--text-ghost)]">
				These rows come from Stockbit, not from the plan. The method's verdict is measured on its own bars and gates; use
				this block to read the tape, not to overrule the plan.
			</p>
		</div>
	);
}

function verdictTone(state: string): string {
	if (state === "ENTER") return "var(--up)";
	if (state === "DATA_UNSAFE") return "var(--down)";
	return "var(--gold)";
}
