/** Format number as Rupiah: Rp 10.000.000 */
export function idr(n: number | null | undefined): string {
  if (n == null) return '—';
  const neg = n < 0;
  const s = Math.abs(Math.round(n)).toLocaleString('id-ID');
  return (neg ? '-' : '') + 'Rp ' + s;
}

/** Format percentage with sign */
export function pct(n: number | null | undefined): string {
  if (n == null) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

/** Generate a simple unique ID */
export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Get today's date as YYYY-MM-DD in WIB */
export function todayWIB(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}
