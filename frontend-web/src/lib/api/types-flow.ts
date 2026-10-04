/** Intel flow: Konglo (conglomerate groups), Ownership, Owner cross-holdings, Sector rotation, Foreign flow. */

export interface KongloMember {
	ticker: string;
	price: number | null;
	change_percent: number | null;
	net_foreign_idr: number | null;
}

export interface KongloGroup {
	group: string;
	count_saham: number;
	avg_change_percent: number | null;
	net_foreign_idr: number;
	members: KongloMember[];
}

export interface KongloResponse {
	available: boolean;
	error?: string;
	groups_counted: number;
	tickers_mapped: number;
	groups: KongloGroup[];
}

export interface OwnershipStructure {
	ticker: string;
	available: boolean;
	error?: string;
	note?: string;
	as_of?: string;
	name?: string;
	sector?: string;
	sub_sector?: string;
	listing_date?: string;
	shareholders?: {
		name: string;
		shares: number | null;
		percent: number | null;
		category: string;
		controlling: boolean;
	}[];
	board?: {
		direktur: { name: string; position: string }[];
		komisaris: { name: string; position: string }[];
	};
	subsidiaries?: { name: string; percent: number | null }[];
}

export interface OwnershipSnapshot {
	date: string;
	holders: {
		name: string;
		percent: number | null;
		category: string;
		controlling: boolean;
	}[];
}

export interface OwnershipChanges {
	from_date: string;
	to_date: string;
	entered: { name: string; percent: number | null }[];
	exited: { name: string; percent: number | null }[];
	changed: { name: string; from: number; to: number; delta: number }[];
	crossed: {
		name: string;
		from: number;
		to: number;
		threshold: number;
		dir: "above" | "below";
	}[];
}

export interface OwnershipHistory {
	ticker: string;
	available: boolean;
	snapshots: OwnershipSnapshot[];
	changes: OwnershipChanges | null;
}

export interface OwnerHoldingsMatch {
	ticker: string;
	name?: string;
	percent: number | null;
	category: string;
	controlling: boolean;
	as_of?: string;
}

export interface OwnerHoldingsIssuer {
	ticker: string;
	name?: string;
}

export interface OwnerHoldings {
	query: string;
	available: boolean;
	issuers_scanned: number;
	matches: OwnerHoldingsMatch[];
	issuers?: OwnerHoldingsIssuer[];
}

export interface ValidAccum {
	ticker: string;
	name?: string;
	days: number;
	price_move: number;
	peak_move?: number | null;
	buy_share: number;
	stage: string;
	flow_agrees?: boolean;
}

export interface RotationMover {
	ticker: string;
	name?: string;
	price: number | null;
	change_percent: number;
}

export interface RotationSector {
	sector: string;
	count: number;
	gainers: number;
	losers: number;
	avg_change_percent: number;
	avg5: number | null;
	avg20: number | null;
	rank: number | null;
	rank_delta: number | null;
	movers?: {
		gainers: RotationMover[];
		losers: RotationMover[];
	};
	valid_accumulation?: ValidAccum[];
}

export interface RotationHistory {
	as_of?: string;
	days_archived: number;
	dates: string[];
	sectors: RotationSector[];
	error?: string;
}

/** Per-broker row inside a foreign-flow detail. */
export interface IntelForeignRow {
	broker: string;
	side: "buy" | "sell";
	type: string;
	lots: number;
	value_idr: number;
	avg_price: number;
}

/** Per-ticker foreign flow detail. */
export interface ForeignFlow {
	ticker: string;
	available: boolean;
	error?: string;
	as_of?: string;
	price?: number;
	net_foreign_lots?: number;
	net_foreign_idr?: number;
	foreign_buy_lots?: number;
	foreign_sell_lots?: number;
	foreign_buy_idr?: number;
	foreign_sell_idr?: number;
	total_volume?: number;
	broker_count?: number;
	rows?: IntelForeignRow[];
}

/** Universe-wide foreign flow rollup. */
export interface ForeignFlowUniverse {
	available: boolean;
	error?: string;
	count?: number;
	as_of?: string;
	rows?: {
		ticker: string;
		name: string;
		sector: string;
		price: number;
		change_percent: number;
		net_foreign_idr: number;
		net_foreign_lots: number;
		foreign_buy_lots: number;
		foreign_sell_lots: number;
		foreign_buy_idr: number;
		foreign_sell_idr: number;
		volume?: number;
	}[];
}
