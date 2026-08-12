import type { JournalEntry, Lot, Position, RealizedTrade, PortfolioState, TickerQuote } from './types';

/**
 * JavaScript port of the Python FIFO engine.
 * Processes journal entries and computes portfolio state entirely in the browser.
 * All values normalised to IDR.
 */
export function computePortfolio(
  journal: JournalEntry[],
  quotes: Map<string, TickerQuote>,
  liveForex: number,
): PortfolioState {
  let cashIDR = 0;
  const lots: Record<string, Lot[]> = {};
  const realizedTrades: RealizedTrade[] = [];

  const toIDR = (amount: number, currency: string, forex: number) =>
    currency.toUpperCase() === 'IDR' ? amount : amount * forex;

  // We approximate historical forex with live rate since we don't have
  // historical data in the browser. The GitHub Actions engine uses exact rates.
  const getForex = (_date: string, currency: string) =>
    currency.toUpperCase() === 'IDR' ? 1 : liveForex;

  for (const e of journal) {
    const action = e.action.toUpperCase();
    const currency = (e.currency || 'USD').toUpperCase();
    const forex = getForex(e.date, currency);
    const priceIDR = toIDR(e.price, currency, forex);

    if (action === 'DEPOSIT') {
      cashIDR += toIDR(e.price * e.qty, currency, forex);
      continue;
    }
    if (action === 'WITHDRAW') {
      cashIDR -= toIDR(e.price * e.qty, currency, forex);
      continue;
    }
    if (action === 'BUY') {
      cashIDR -= priceIDR * e.qty;
      if (!lots[e.ticker]) lots[e.ticker] = [];
      lots[e.ticker].push({
        qty: e.qty,
        price_native: e.price,
        price_idr: priceIDR,
        date: e.date,
        currency,
        forex_rate: forex,
        sl_price: e.sl_price || 0,
        tp_price: e.tp_price || 0,
        trailing_stop_pct: e.trailing_stop_pct || 0,
      });
      continue;
    }
    if (action === 'SELL') {
      const proceedsIDR = priceIDR * e.qty;
      cashIDR += proceedsIDR;
      let remaining = e.qty;
      let costBasisIDR = 0;
      const tickerLots = lots[e.ticker] || [];

      while (remaining > 1e-12 && tickerLots.length > 0) {
        const lot = tickerLots[0];
        const take = Math.min(remaining, lot.qty);
        costBasisIDR += take * lot.price_idr;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-12) tickerLots.shift();
      }

      realizedTrades.push({
        date: e.date,
        ticker: e.ticker,
        qty: e.qty,
        sell_price_native: e.price,
        sell_price_idr: priceIDR,
        currency,
        cost_basis_idr: Math.round(costBasisIDR * 100) / 100,
        proceeds_idr: Math.round(proceedsIDR * 100) / 100,
        realized_pnl_idr: Math.round((proceedsIDR - costBasisIDR) * 100) / 100,
        system_generated: e.system_generated || false,
        reason: e.reason || '',
      });
    }
  }

  // Build positions from remaining lots
  const positions: Position[] = [];
  let totalPortfolioIDR = 0;

  for (const [ticker, tickerLots] of Object.entries(lots)) {
    const activeLots = tickerLots.filter(l => l.qty > 1e-12);
    if (activeLots.length === 0) continue;

    const totalQty = activeLots.reduce((s, l) => s + l.qty, 0);
    const avgBuyNative = activeLots.reduce((s, l) => s + l.qty * l.price_native, 0) / totalQty;
    const avgBuyIDR = activeLots.reduce((s, l) => s + l.qty * l.price_idr, 0) / totalQty;
    const totalCostIDR = activeLots.reduce((s, l) => s + l.qty * l.price_idr, 0);

    const quote = quotes.get(ticker);
    const nativeCurrency = quote?.currency || activeLots[0].currency;
    const currentPriceNative = quote?.current_price ?? null;
    const currentPriceIDR = currentPriceNative != null
      ? toIDR(currentPriceNative, nativeCurrency, nativeCurrency.toUpperCase() === 'IDR' ? 1 : liveForex)
      : avgBuyIDR;

    const totalValueIDR = currentPriceIDR * totalQty;
    const unrealizedPnlIDR = totalValueIDR - totalCostIDR;
    totalPortfolioIDR += totalValueIDR;

    positions.push({
      ticker,
      qty: Math.round(totalQty * 1e8) / 1e8,
      avg_buy_price_native: Math.round(avgBuyNative * 1e4) / 1e4,
      avg_buy_price_idr: Math.round(avgBuyIDR * 100) / 100,
      current_price_native: currentPriceNative,
      current_price_idr: Math.round(currentPriceIDR * 100) / 100,
      native_currency: nativeCurrency,
      total_value_idr: Math.round(totalValueIDR * 100) / 100,
      total_cost_idr: Math.round(totalCostIDR * 100) / 100,
      unrealized_pnl_idr: Math.round(unrealizedPnlIDR * 100) / 100,
      unrealized_pnl_pct: totalCostIDR ? Math.round((unrealizedPnlIDR / totalCostIDR) * 10000) / 100 : 0,
      daily_change_pct: quote?.daily_change_pct ?? null,
    });
  }

  const totalRealizedPnl = realizedTrades.reduce((s, t) => s + t.realized_pnl_idr, 0);

  return {
    cash_idr: Math.round(cashIDR * 100) / 100,
    total_portfolio_value_idr: Math.round(totalPortfolioIDR * 100) / 100,
    net_worth_idr: Math.round((cashIDR + totalPortfolioIDR) * 100) / 100,
    live_forex_usdidr: liveForex,
    positions,
    realized_trades: realizedTrades,
    total_realized_pnl_idr: Math.round(totalRealizedPnl * 100) / 100,
  };
}
