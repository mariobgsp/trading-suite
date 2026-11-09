package stockbit

import (
	"testing"
	"time"
)

func TestNormalizeBrokers(t *testing.T) {
	now := time.Date(2026, 11, 7, 1, 0, 0, 0, time.UTC)
	raw := map[string]any{
		"data": map[string]any{
			"broker_summary": map[string]any{
				"brokers_buy": []any{
					map[string]any{"netbs_broker_code": "dh", "blot": "1200", "bval": "9,000,000", "netbs_buy_avg_price": "9800"},
					map[string]any{"netbs_broker_code": "yp", "blot": "300", "bval": "2,900,000", "netbs_buy_avg_price": "9700"},
				},
				"brokers_sell": []any{
					map[string]any{"netbs_broker_code": "cc", "slot": "500", "sval": "4,900,000", "netbs_sell_avg_price": "9800"},
				},
			},
			"bandar_detector": map[string]any{
				"top1":        map[string]any{"vol": "1200", "percent": "42.1", "amount": "9000000", "accdist": "ACC"},
				"total_buyer": "3",
			},
		},
	}
	brokers := normalizeBrokers(raw, "BBCA", "2026-11-06", now)
	if !brokers.Available || brokers.Count != 3 {
		t.Fatalf("brokers = %+v", brokers)
	}
	buy := brokers.Rows[0]
	if buy.Broker != "DH" || buy.Side != "buy" || buy.BuyLots != 1200 || buy.NetLots != 1200 {
		t.Fatalf("buy row = %+v", buy)
	}
	if buy.AvgBuyPrice == nil || *buy.AvgBuyPrice != 9800 {
		t.Fatalf("avg buy price = %v", buy.AvgBuyPrice)
	}
	sell := brokers.Rows[2]
	if sell.Side != "sell" || sell.SellLots != 500 || sell.NetLots != -500 {
		t.Fatalf("sell row = %+v", sell)
	}
	if brokers.Detector == nil || brokers.Detector.Top1 == nil || brokers.Detector.Top1.Accdist != "ACC" {
		t.Fatalf("detector = %+v", brokers.Detector)
	}
	if brokers.Top3ConcentrationPct == nil || *brokers.Top3ConcentrationPct < 99 {
		t.Fatalf("top3 = %v", brokers.Top3ConcentrationPct)
	}
}

func TestNormalizeOrderbook(t *testing.T) {
	now := time.Date(2026, 11, 7, 1, 0, 0, 0, time.UTC)
	raw := map[string]any{
		"data": map[string]any{
			"bid":   []any{map[string]any{"price": "9800", "volume": "100000"}, map[string]any{"price": "9700", "volume": "20000"}},
			"offer": []any{map[string]any{"price": "9850", "volume": "50000"}},
			"total_bid_offer": map[string]any{
				"bid":   map[string]any{"lot": "1200"},
				"offer": map[string]any{"lot": "500"},
			},
			"last_price": "9800",
			"prev":       "9700",
			"volume":     "150000",
			"value":      "1470000000",
		},
	}
	orderbook := normalizeOrderbook(raw, "BBCA", now)
	if !orderbook.Available {
		t.Fatalf("orderbook unavailable: %+v", orderbook)
	}
	if orderbook.BidLots != 1200 || orderbook.OfferLots != 500 {
		t.Fatalf("lots = %v/%v", orderbook.BidLots, orderbook.OfferLots)
	}
	if orderbook.Imbalance == nil || *orderbook.Imbalance <= 0 {
		t.Fatalf("imbalance = %v", orderbook.Imbalance)
	}
	if orderbook.BestBid == nil || *orderbook.BestBid != 9800 || orderbook.BestOffer == nil || *orderbook.BestOffer != 9850 {
		t.Fatalf("best = %v/%v", orderbook.BestBid, orderbook.BestOffer)
	}
	if orderbook.Quote == nil || orderbook.Quote.Last == nil || *orderbook.Quote.Last != 9800 {
		t.Fatalf("quote = %+v", orderbook.Quote)
	}
	if orderbook.Quote.ChangePct == nil || *orderbook.Quote.ChangePct < 1.0 {
		t.Fatalf("change pct = %v", orderbook.Quote.ChangePct)
	}
}

func TestNormalizeInfo(t *testing.T) {
	raw := map[string]any{"data": map[string]any{"name": "Bank Central Asia", "sector": "Financials", "sub_sector": "Banks", "shares": "123000000000"}}
	info := normalizeInfo(raw, "BBCA")
	if !info.Available || info.Name != "Bank Central Asia" || info.Sector != "Financials" {
		t.Fatalf("info = %+v", info)
	}
	if info.Shares == nil || *info.Shares != 123000000000 {
		t.Fatalf("shares = %v", info.Shares)
	}
}

func TestNormalizeWatchlist(t *testing.T) {
	groupsRaw := map[string]any{"data": []any{
		map[string]any{"watchlist_id": "1", "name": "Main", "is_default": true, "count": "2"},
		map[string]any{"watchlist_id": "2", "name": "Second"},
	}}
	groups := normalizeWatchlistGroups(groupsRaw)
	if len(groups) != 2 || groups[0].ID != 1 || !groups[0].IsDefault || groups[0].Name != "Main" {
		t.Fatalf("groups = %+v", groups)
	}
	itemsRaw := map[string]any{"data": map[string]any{"result": []any{
		map[string]any{"symbol": "bbca", "name": "BCA", "last": "9800", "change": "1.2"},
		map[string]any{"company_code": "BBRI", "name": "BRI"},
	}}}
	items := normalizeWatchlistItems(itemsRaw)
	if len(items) != 2 || items[0].Ticker != "BBCA" || items[1].Ticker != "BBRI" {
		t.Fatalf("items = %+v", items)
	}
	if items[0].ChangePct == nil || *items[0].ChangePct != 1.2 {
		t.Fatalf("change = %v", items[0].ChangePct)
	}
}

func TestNormalizeTickerAndDate(t *testing.T) {
	for input, want := range map[string]string{"bbca": "BBCA", " BBCA.JK ": "BBCA", "bbri": "BBRI"} {
		got, err := NormalizeTicker(input)
		if err != nil || got != want {
			t.Fatalf("NormalizeTicker(%q) = %q, %v", input, got, err)
		}
	}
	for _, input := range []string{"", "BAD TICKER", "../etc/passwd", "TOOLONGTICKER"} {
		if _, err := NormalizeTicker(input); err == nil {
			t.Fatalf("NormalizeTicker(%q) did not fail", input)
		}
	}
	client := &Client{now: func() time.Time { return time.Date(2026, 11, 7, 0, 30, 0, 0, time.UTC) }}
	date, err := client.normalizeDate("")
	if err != nil || date != "2026-11-07" {
		t.Fatalf("default date = %q, %v", date, err)
	}
	if _, err := client.normalizeDate("2026-13-01"); err == nil {
		t.Fatalf("invalid date did not fail")
	}
}

func TestCacheGetOrLoad(t *testing.T) {
	now := time.Date(2026, 11, 7, 1, 0, 0, 0, time.UTC)
	cache := NewCache()
	cache.now = func() time.Time { return now }
	loads := 0
	load := func() (any, error) { loads++; return "value", nil }
	first, info, err := cache.GetOrLoad("k", time.Minute, false, load)
	if err != nil || first != "value" || info.Hit {
		t.Fatalf("first = %v, %+v, %v", first, info, err)
	}
	second, info, err := cache.GetOrLoad("k", time.Minute, false, load)
	if err != nil || second != "value" || !info.Hit {
		t.Fatalf("second = %v, %+v, %v", second, info, err)
	}
	now = now.Add(2 * time.Minute)
	_, _, err = cache.GetOrLoad("k", time.Minute, false, load)
	if err != nil || loads != 2 {
		t.Fatalf("expired load count = %d, err %v", loads, err)
	}
	if cleared := cache.Clear(); cleared != 1 {
		t.Fatalf("cleared = %d", cleared)
	}
}
