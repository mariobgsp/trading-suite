package stockbit

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"
)

func mapValue(value any) map[string]any {
	if value == nil {
		return nil
	}
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return nil
}

func listValue(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case map[string]any:
		for _, key := range []string{"result", "items", "data", "rows"} {
			if nested, ok := typed[key].([]any); ok {
				return nested
			}
		}
	}
	return nil
}

func firstOf(values map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := values[key]; ok && value != nil {
			return value
		}
	}
	return nil
}

func mapFirst(values map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		if nested := mapValue(values[key]); nested != nil {
			return nested
		}
	}
	return nil
}

func num(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		number, _ := typed.Float64()
		return number
	case string:
		text := strings.TrimSpace(typed)
		text = strings.ReplaceAll(text, ",", "")
		text = strings.TrimSuffix(text, "%")
		if text == "" || text == "-" || strings.EqualFold(text, "null") {
			return 0
		}
		number, _ := strconv.ParseFloat(text, 64)
		return number
	case bool:
		if typed {
			return 1
		}
	}
	return 0
}

func numPtr(value any) *float64 {
	if value == nil {
		return nil
	}
	if text, ok := value.(string); ok {
		trimmed := strings.TrimSpace(text)
		if trimmed == "" || trimmed == "-" || strings.EqualFold(trimmed, "null") {
			return nil
		}
	}
	number := num(value)
	return &number
}

func text(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case json.Number:
		return typed.String()
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "true" || typed == "1" || typed == "yes"
	case float64:
		return typed != 0
	}
	return false
}

func normalizeBrokers(raw map[string]any, ticker, date string, now time.Time) *Brokers {
	out := &Brokers{
		Ticker:   ticker,
		Date:     date,
		AsOf:     now.UTC().Format(time.RFC3339),
		Rows:     []BrokerRow{},
		Warnings: []string{},
	}
	data := mapValue(raw["data"])
	if data == nil {
		data = raw
	}
	summary := mapFirst(data, "broker_summary", "brokers")
	if summary == nil {
		summary = data
	}
	out.Rows = append(out.Rows, brokerRows(firstOf(summary, "brokers_buy", "buy", "buyers"), "buy")...)
	out.Rows = append(out.Rows, brokerRows(firstOf(summary, "brokers_sell", "sell", "sellers"), "sell")...)
	out.Count = len(out.Rows)
	out.Detector = normalizeDetector(mapFirst(data, "bandar_detector", "detector"))

	buys := make([]BrokerRow, 0, len(out.Rows))
	for _, row := range out.Rows {
		if row.Side == "buy" && row.NetLots > 0 {
			buys = append(buys, row)
		}
	}
	sort.SliceStable(buys, func(i, j int) bool { return buys[i].NetLots > buys[j].NetLots })
	var total, top3 float64
	for index, row := range buys {
		total += row.NetLots
		if index < 3 {
			top3 += row.NetLots
		}
	}
	if total > 0 {
		pct := top3 / total * 100
		out.Top3ConcentrationPct = &pct
	}
	out.Available = len(out.Rows) > 0 || out.Detector != nil
	if !out.Available {
		out.Warnings = append(out.Warnings, "no broker rows for this date")
	}
	return out
}

func brokerRows(value any, side string) []BrokerRow {
	list := listValue(value)
	if list == nil {
		if single := mapValue(value); single != nil {
			list = []any{single}
		}
	}
	rows := make([]BrokerRow, 0, len(list))
	for _, item := range list {
		row := mapValue(item)
		if row == nil {
			continue
		}
		broker := strings.ToUpper(text(firstOf(row, "netbs_broker_code", "broker_code", "broker", "code")))
		if broker == "" {
			continue
		}
		buyLots := num(firstOf(row, "blot", "buy_lots", "buy_lot", "buy_volume"))
		sellLots := num(firstOf(row, "slot", "sell_lots", "sell_lot", "sell_volume"))
		buyValue := num(firstOf(row, "bval", "buy_value", "value_buy"))
		sellValue := num(firstOf(row, "sval", "sell_value", "value_sell"))
		if side == "sell" && sellLots == 0 {
			sellLots = num(firstOf(row, "lot", "volume_lot", "blot"))
		}
		if side == "buy" && buyLots == 0 {
			buyLots = num(firstOf(row, "lot", "volume_lot", "blot"))
		}
		netLots := buyLots - sellLots
		if side == "sell" && netLots > 0 {
			netLots = -netLots
		}
		if side == "buy" && netLots < 0 {
			netLots = -netLots
		}
		rows = append(rows, BrokerRow{
			Broker:       broker,
			Side:         side,
			BuyLots:      buyLots,
			SellLots:     sellLots,
			NetLots:      netLots,
			BuyValue:     buyValue,
			SellValue:    sellValue,
			NetValue:     buyValue - sellValue,
			AvgBuyPrice:  numPtr(firstOf(row, "netbs_buy_avg_price", "buy_avg_price", "avg_buy")),
			AvgSellPrice: numPtr(firstOf(row, "netbs_sell_avg_price", "sell_avg_price", "avg_sell")),
			Type:         text(firstOf(row, "type", "investor_type")),
		})
	}
	return rows
}

func normalizeDetector(raw map[string]any) *BandarDetector {
	if len(raw) == 0 {
		return nil
	}
	detector := &BandarDetector{
		Top1:                normalizeBandarLevel(mapValue(raw["top1"])),
		Top3:                normalizeBandarLevel(mapValue(raw["top3"])),
		Top5:                normalizeBandarLevel(mapValue(raw["top5"])),
		Avg:                 normalizeBandarLevel(mapValue(raw["avg"])),
		TotalBuyer:          numPtr(raw["total_buyer"]),
		TotalSeller:         numPtr(raw["total_seller"]),
		NumberBrokerBuysell: numPtr(raw["number_broker_buysell"]),
		BrokerAccdist:       text(firstOf(raw, "broker_accdist", "accdist")),
		Volume:              numPtr(raw["volume"]),
		Value:               numPtr(raw["value"]),
		Average:             numPtr(raw["average"]),
	}
	return detector
}

func normalizeBandarLevel(raw map[string]any) *BandarLevel {
	if len(raw) == 0 {
		return nil
	}
	return &BandarLevel{
		Volume:  numPtr(firstOf(raw, "vol", "volume")),
		Percent: numPtr(firstOf(raw, "percent", "percentage")),
		Amount:  numPtr(firstOf(raw, "amount", "value")),
		Accdist: text(firstOf(raw, "accdist", "acc_dist")),
	}
}

func normalizeOrderbook(raw map[string]any, ticker string, now time.Time) *Orderbook {
	out := &Orderbook{Ticker: ticker, AsOf: now.UTC().Format(time.RFC3339), Warnings: []string{}}
	data := mapValue(raw["data"])
	if data == nil {
		data = raw
	}
	bids := listValue(firstOf(data, "bid", "bids", "buy"))
	offers := listValue(firstOf(data, "offer", "offers", "sell"))
	bidLots := 0.0
	for _, level := range bids {
		bidLots += levelLots(level)
	}
	offerLots := 0.0
	for _, level := range offers {
		offerLots += levelLots(level)
	}
	if tbo := mapFirst(data, "total_bid_offer", "total_bid_offer_lot"); tbo != nil {
		if total := num(firstOf(mapValue(tbo["bid"]), "lot", "lots", "volume_lot")); total > 0 {
			bidLots = total
		}
		if total := num(firstOf(mapValue(tbo["offer"]), "lot", "lots", "volume_lot")); total > 0 {
			offerLots = total
		}
	}
	out.BidLots = bidLots
	out.OfferLots = offerLots
	out.Levels = OrderbookLevels{Bid: len(bids), Offer: len(offers)}
	totalLots := bidLots + offerLots
	if totalLots > 0 {
		imbalance := (bidLots - offerLots) / totalLots
		out.Imbalance = &imbalance
	}
	if len(bids) > 0 {
		out.BestBid = numPtr(firstOf(mapValue(bids[0]), "price", "bid", "last"))
	}
	if len(offers) > 0 {
		out.BestOffer = numPtr(firstOf(mapValue(offers[0]), "price", "offer", "last"))
	}
	if out.BestBid != nil && out.BestOffer != nil && *out.BestBid > 0 && *out.BestOffer > 0 {
		mid := (*out.BestBid + *out.BestOffer) / 2
		if mid > 0 {
			spread := (*out.BestOffer - *out.BestBid) / mid * 100
			out.SpreadPct = &spread
		}
	}
	out.Quote = quoteFromData(data, now)
	out.Available = out.Quote != nil || len(bids) > 0 || len(offers) > 0
	if !out.Available {
		out.Warnings = append(out.Warnings, "the orderbook payload was empty")
	}
	return out
}

func levelLots(value any) float64 {
	level := mapValue(value)
	if level == nil {
		return 0
	}
	if lots := num(firstOf(level, "lot", "lots", "volume_lot", "bid_lot", "offer_lot")); lots > 0 {
		return lots
	}
	volume := num(firstOf(level, "volume", "vol", "shares"))
	if volume > 0 {
		return volume / 100
	}
	return 0
}

func quoteFromData(data map[string]any, now time.Time) *Quote {
	quote := &Quote{
		Last:      numPtr(firstOf(data, "last_price", "last", "close", "price", "current_price")),
		Open:      numPtr(firstOf(data, "open", "open_price", "openPrice")),
		High:      numPtr(firstOf(data, "high", "high_price", "day_high")),
		Low:       numPtr(firstOf(data, "low", "low_price", "day_low")),
		Prev:      numPtr(firstOf(data, "prev", "previous_price", "prev_close", "previous_close")),
		Volume:    numPtr(firstOf(data, "volume", "vol", "total_volume")),
		Value:     numPtr(firstOf(data, "value", "turnover", "total_value")),
		Frequency: numPtr(firstOf(data, "frequency", "freq", "trade_count")),
		AsOf:      text(firstOf(data, "last_update", "as_of", "updated_at", "date")),
	}
	quote.Change = numPtr(firstOf(data, "change", "change_value", "net_change"))
	quote.ChangePct = numPtr(firstOf(data, "change_percentage", "change_pct", "percentage", "percent", "pct"))
	if quote.Change == nil && quote.Last != nil && quote.Prev != nil {
		change := *quote.Last - *quote.Prev
		quote.Change = &change
	}
	if quote.ChangePct == nil && quote.Change != nil && quote.Prev != nil && *quote.Prev != 0 {
		pct := *quote.Change / *quote.Prev * 100
		quote.ChangePct = &pct
	}
	if quote.AsOf == "" {
		quote.AsOf = now.UTC().Format(time.RFC3339)
	}
	if quote.Last == nil && quote.Change == nil && quote.Volume == nil && quote.Open == nil && quote.High == nil && quote.Low == nil {
		return nil
	}
	return quote
}

func normalizeInfo(raw map[string]any, ticker string) *Info {
	data := mapValue(raw["data"])
	if data == nil {
		data = raw
	}
	info := &Info{
		Ticker:      ticker,
		Name:        text(firstOf(data, "name", "company_name", "emiten_name", "fullname")),
		Sector:      text(firstOf(data, "sector", "sector_name")),
		SubSector:   text(firstOf(data, "sub_sector", "subsector", "sub_industry")),
		Industry:    text(firstOf(data, "industry", "industry_name")),
		ListingDate: text(firstOf(data, "listing_date", "listed_date", "ipo_date")),
		Shares:      numPtr(firstOf(data, "shares", "shares_outstanding", "listed_shares")),
		MarketCap:   numPtr(firstOf(data, "market_cap", "marketcap", "market_capitalization")),
		Logo:        text(firstOf(data, "logo", "logo_url", "image")),
		Description: text(firstOf(data, "description", "about", "profile")),
	}
	info.Available = info.Name != "" || info.Sector != "" || info.Logo != ""
	return info
}

func normalizeWatchlistGroups(raw map[string]any) []WatchlistGroup {
	payload := raw["data"]
	list := listValue(payload)
	if list == nil {
		data := mapValue(payload)
		if data != nil {
			list = listValue(firstOf(data, "result", "watchlists", "groups"))
			if list == nil {
				list = []any{data}
			}
		}
	}
	groups := make([]WatchlistGroup, 0, len(list))
	seen := map[int64]struct{}{}
	for _, item := range list {
		group := mapValue(item)
		if group == nil {
			continue
		}
		id := int64(num(firstOf(group, "watchlist_id", "id", "watchlistId")))
		if id == 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		groups = append(groups, WatchlistGroup{
			ID:        id,
			Name:      text(firstOf(group, "name", "title", "watchlist_name")),
			IsDefault: boolValue(firstOf(group, "is_default", "default")),
			Count:     int(num(firstOf(group, "count", "total", "items_count"))),
		})
	}
	return groups
}

func normalizeWatchlistItems(raw map[string]any) []WatchlistItem {
	data := mapValue(raw["data"])
	list := listValue(firstOf(raw, "data", "result", "items"))
	if list == nil && data != nil {
		list = listValue(firstOf(data, "result", "items", "companies"))
	}
	items := make([]WatchlistItem, 0, len(list))
	for _, entry := range list {
		item := mapValue(entry)
		if item == nil {
			continue
		}
		ticker := strings.ToUpper(text(firstOf(item, "symbol", "company_code", "ticker", "code")))
		if ticker == "" {
			continue
		}
		items = append(items, WatchlistItem{
			Ticker:    ticker,
			Name:      text(firstOf(item, "name", "company_name", "emiten_name")),
			Last:      numPtr(firstOf(item, "last", "last_price", "price", "close")),
			ChangePct: numPtr(firstOf(item, "change", "change_pct", "percentage", "percent")),
			Volume:    numPtr(firstOf(item, "volume", "vol")),
			Value:     numPtr(firstOf(item, "value", "turnover")),
		})
	}
	return items
}
