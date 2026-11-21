import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	bandCopy,
	columnPresetCopy,
	featuredStrategy,
	ratingCopy,
	screenCopy,
	strategyCopy,
	verdictCopy,
	TERMS,
} from "./present.ts";

describe("verdictCopy", () => {
	it("maps all four backend states to plain Indonesian", () => {
		assert.match(verdictCopy("ENTER").title, /Aturan mengizinkan beli/);
		assert.match(verdictCopy("WAIT").title, /Tunggu dulu/);
		assert.match(verdictCopy("NO_TRADE").title, /bukan waktunya beli/);
		assert.match(verdictCopy("DATA_UNSAFE").title, /Data belum bisa dipakai/);
	});
	it("falls back neutrally for an unknown state, keeping the raw code visible nowhere invented", () => {
		const copy = verdictCopy("SOMETHING_NEW");
		assert.match(copy.title, /Status belum dikenal/);
		assert.equal(copy.tone, "var(--text-ghost)");
		assert.ok(copy.novice.length > 0 && copy.action.length > 0);
	});
});

describe("bandCopy", () => {
	it("maps the three bands to everyday words with advice", () => {
		assert.equal(bandCopy("trending").tone, "var(--up)");
		assert.match(bandCopy("sideways").advice, /jangan beli/);
		assert.match(bandCopy("capitulation").advice, /mengamati/);
	});
	it("falls back neutrally for an unknown band", () => {
		const copy = bandCopy("unknown-band");
		assert.equal(copy.label, "unknown-band");
		assert.equal(copy.tone, "var(--text-ghost)");
	});
});

describe("screenCopy", () => {
	it("gives every scanner filter a plain task name and keeps the technical definition on demand", () => {
		for (const key of ["all", "tier1", "tier1_setup", "capitulation", "breakout", "relative_strength", "quiet_vol"]) {
			const copy = screenCopy(key, { label: "x", definition: "teknis" });
			assert.ok(copy.label.length > 0, key);
			assert.ok(copy.meaning.length > 0, key);
		}
	});
	it("falls back to the backend label and definition for an unknown key", () => {
		const copy = screenCopy("new_filter", { label: "Backend Label", definition: "Backend definition" });
		assert.equal(copy.label, "Backend Label");
		assert.equal(copy.meaning, "Backend definition");
	});
});

describe("strategyCopy", () => {
	it("describes every compare-engine strategy in one plain sentence", () => {
		for (const key of [
			"buyhold",
			"tsmom",
			"momentum",
			"meanreversion",
			"pullback",
			"breakout",
			"mildmover",
			"golden_cross",
			"cross_3_5",
			"cross_9_21",
			"gate_sma200",
		]) {
			assert.ok(strategyCopy(key).length > 0, `missing copy for ${key}`);
		}
	});
	it("returns empty string rather than inventing text for an unknown strategy", () => {
		assert.equal(strategyCopy("brand_new"), "");
	});
});

describe("featuredStrategy", () => {
	const row = (strategy: string, trades: number, total: number | null) =>
		({
			strategy,
			label: strategy,
			kin: "",
			stats: {
				total_trades: trades,
				total_return_pct: total as never,
				max_drawdown_pct: 0,
				win_rate: 0,
			},
			alpha_vs_index_pct: null,
		}) as never;

	it("never crowns a strategy with zero trades", () => {
		assert.equal(featuredStrategy([row("flat", 0, 0.0)]), null);
	});
	it("never lets buy-hold be the featured strategy (it is the baseline)", () => {
		assert.equal(featuredStrategy([row("buyhold", 1, 99.0)]), null);
	});
	it("picks the best closed-trade return, even when it is negative", () => {
		const winner = featuredStrategy([
			row("a", 3, -12.5),
			row("b", 5, -4.0),
			row("c", 0, 0.0),
		]);
		assert.equal(winner && (winner as { strategy: string }).strategy, "b");
	});
	it("ignores rows whose return is null, not NaN", () => {
		const winner = featuredStrategy([row("a", 2, null), row("b", 1, -1.0)]);
		assert.equal(winner && (winner as { strategy: string }).strategy, "b");
	});
	it("returns null when nothing traded at all", () => {
		assert.equal(featuredStrategy([]), null);
	});
});

describe("TERMS", () => {
	it("explains support and resistance in everyday words", () => {
		assert.match(TERMS.support, /memantulkan/);
		assert.match(TERMS.resistance, /menahan kenaikan/);
		assert.match(TERMS.drawdown, /titik tertinggi/);
	});
});

describe("columnPresetCopy", () => {
	it("names the three scanner column presets", () => {
		assert.equal(columnPresetCopy("ringkas").label, "Ringkas");
		assert.equal(columnPresetCopy("performa").label, "Performa");
		assert.equal(columnPresetCopy("teknikal").label, "Teknikal");
	});
});

describe("ratingCopy", () => {
	it("maps the 5-step technical rating to everyday words", () => {
		assert.equal(ratingCopy("STRONG_BUY").label, "Beli kuat");
		assert.equal(ratingCopy("NEUTRAL").label, "Netral");
		assert.equal(ratingCopy("STRONG_SELL").label, "Jual kuat");
	});
	it("falls back to the raw code for unknown ratings", () => {
		assert.equal(ratingCopy("SOMETHING_NEW").tone, "var(--text-ghost)");
	});
});
