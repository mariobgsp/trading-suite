/** Locale-aware formatters for IDR, plain numbers, and signed percentages. */

export const fmtIdr = (
	v: number | null | undefined,
	compact = false,
): string => {
	if (v == null || Number.isNaN(v)) return "—";
	if (compact) {
		if (Math.abs(v) >= 1e12) return `Rp ${(v / 1e12).toFixed(2)} T`;
		if (Math.abs(v) >= 1e9) return `Rp ${(v / 1e9).toFixed(1)} M`;
		if (Math.abs(v) >= 1e6) return `Rp ${(v / 1e6).toFixed(1)} Jt`;
	}
	return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
};

export const fmtNum = (v: number | null | undefined, digits = 2): string => {
	if (v == null || Number.isNaN(v)) return "—";
	return v.toLocaleString("id-ID", { maximumFractionDigits: digits });
};

export const fmtPct = (v: number | null | undefined): string => {
	if (v == null || Number.isNaN(v)) return "—";
	const sign = v > 0 ? "+" : "";
	return `${sign}${v.toFixed(2)}%`;
};
