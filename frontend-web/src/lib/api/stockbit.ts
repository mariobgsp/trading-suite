/**
 * The suite's view of the local stockbitd session keeper.
 *
 * The daemon owns the cookie jar and the browser login; the FastAPI proxy
 * forwards its JSON unchanged. The screen is the only consumer of these types.
 *
 * Codes: daemon_unavailable, reauth_required, http_error.
 */

import { api } from "./transport";

export type StockbitTokenStatus = {
	present: boolean;
	expires_at?: string;
	expires_in_seconds?: number;
	expired: boolean;
};

export type StockbitUser = {
	id?: number;
	username?: string;
	fullname?: string;
	name?: string;
	email?: string;
};

export type StockbitBrowser = {
	available: boolean;
	binary?: string;
	version?: string;
	display: boolean;
	headless: boolean;
	profile?: string;
	code?: string;
	reason?: string;
};

export type StockbitCookies = {
	count: number;
	domains: string[];
	updated_at?: string;
};

export type StockbitSession = {
	path?: string;
	source?: string;
	created_at?: string;
	updated_at?: string;
	last_refresh_at?: string;
	generation?: number;
};

export type StockbitAttempt = {
	id: string;
	state: string;
	message: string;
	error?: string;
	error_code?: string;
	started_at: string;
	finished_at?: string;
	browser_open: boolean;
	browser?: string;
	user?: StockbitUser;
	reused?: boolean;
	/** True when the daemon filled the real login form with the saved sign-in. */
	auto?: boolean;
	username?: string;
	/** The browser is waiting for a human verification/captcha in the window. */
	verification?: boolean;
};

export type StockbitCredentials = {
	configured: boolean;
	source?: "file" | "env" | string;
	username?: string;
};

export type StockbitStatus = {
	state: string;
	available: boolean;
	user?: StockbitUser | null;
	access: StockbitTokenStatus;
	refresh: StockbitTokenStatus;
	cookies: StockbitCookies;
	session: StockbitSession;
	reauth_reason?: string;
	error?: string;
	error_code?: string;
	warnings: string[];
	browser?: StockbitBrowser;
	credentials?: StockbitCredentials;
	server?: { version: string; uptime_seconds: number };
	cache?: StockbitCache;
	daemon_url?: string;
	login?: StockbitAttempt | null;
};

export type StockbitQuote = {
	last?: number;
	change?: number;
	change_pct?: number;
	open?: number;
	high?: number;
	low?: number;
	prev?: number;
	volume?: number;
	value?: number;
	frequency?: number;
	as_of?: string;
};

export type StockbitInfo = {
	ticker?: string;
	available: boolean;
	name?: string;
	sector?: string;
	sub_sector?: string;
	industry?: string;
	listing_date?: string;
	shares?: number;
	market_cap?: number;
	logo?: string;
	description?: string;
};

export type StockbitOrderbook = {
	ticker: string;
	available: boolean;
	as_of?: string;
	bid_lots: number;
	offer_lots: number;
	imbalance?: number;
	spread_pct?: number;
	best_bid?: number;
	best_offer?: number;
	levels?: { bid: number; offer: number };
	quote?: StockbitQuote;
	warnings?: string[];
};

export type StockbitBrokerRow = {
	broker: string;
	side: string;
	buy_lots: number;
	sell_lots: number;
	net_lots: number;
	buy_value: number;
	sell_value: number;
	net_value: number;
	avg_buy_price?: number;
	avg_sell_price?: number;
	type?: string;
};

export type StockbitBrokers = {
	ticker: string;
	date: string;
	available: boolean;
	as_of?: string;
	count: number;
	rows: StockbitBrokerRow[];
	top3_concentration_pct?: number;
	warnings?: string[];
	cache?: StockbitCacheInfo;
};

export type StockbitCacheInfo = {
	hit: boolean;
	age_seconds: number;
	ttl_seconds: number;
	key: string;
};

export type StockbitSnapshot = {
	ticker: string;
	available: boolean;
	as_of: string;
	info?: StockbitInfo;
	quote?: StockbitQuote;
	orderbook?: StockbitOrderbook;
	brokers?: StockbitBrokers;
	warnings: string[];
	cache?: StockbitCacheInfo;
};

export type StockbitWatchlistItem = {
	ticker: string;
	name?: string;
	last?: number;
	change_pct?: number;
	volume?: number;
	value?: number;
};

export type StockbitWatchlistGroup = {
	id: number;
	name: string;
	is_default: boolean;
	count: number;
};

export type StockbitWatchlist = {
	available: boolean;
	as_of: string;
	groups: StockbitWatchlistGroup[];
	active?: StockbitWatchlistGroup;
	items: StockbitWatchlistItem[];
	warnings?: string[];
	cache?: StockbitCacheInfo;
};

export type StockbitCache = {
	entries: number;
	keys: string[];
	hits: number;
	misses: number;
	note: string;
};

const flag = (value: boolean) => (value ? "?refresh=1" : "");

export const stockbitApi = {
	/** Live daemon status; never cached in the browser. */
	status: () => api.get<StockbitStatus>("/api/stockbit/status"),
	/** Start the login. With saved credentials the daemon fills the real form;
	 *  manual=true opens the plain Stockbit login page instead. */
	startLogin: (manual = false) =>
		api.post<{ attempt: StockbitAttempt }>("/api/stockbit/login", { manual }),
	login: (id: string) =>
		api.get<{ attempt: StockbitAttempt }>(`/api/stockbit/login/${encodeURIComponent(id)}`),
	cancelLogin: (id: string) =>
		api.post<{ attempt: StockbitAttempt }>(
			`/api/stockbit/login/${encodeURIComponent(id)}/cancel`,
			{},
		),
	adoptToken: (access: string, refresh = "") =>
		api.post<StockbitStatus>("/api/stockbit/session/token", {
			access_token: access,
			refresh_token: refresh,
		}),
	adoptCookies: (cookie: string) =>
		api.post<StockbitStatus>("/api/stockbit/session/cookies", { cookie }),
	refresh: () => api.post<StockbitStatus>("/api/stockbit/session/refresh", {}),
	saveCredentials: (username: string, password: string) =>
		api.post<StockbitStatus>("/api/stockbit/session/credentials", { username, password }),
	clearCredentials: () =>
		api.post<StockbitStatus>("/api/stockbit/session/credentials/clear", {}),
	logout: () => api.post<StockbitStatus>("/api/stockbit/logout", {}),
	symbol: (ticker: string, refresh = false) =>
		api.get<StockbitSnapshot>(
			`/api/stockbit/symbol/${encodeURIComponent(ticker.toUpperCase())}${flag(refresh)}`,
		),
	watchlist: (refresh = false) =>
		api.get<StockbitWatchlist>(`/api/stockbit/watchlist${flag(refresh)}`),
	cache: () => api.get<StockbitCache>("/api/stockbit/cache"),
	clearCache: () => api.post<{ cleared: number }>("/api/stockbit/cache/clear", {}),
};
