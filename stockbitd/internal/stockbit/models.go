package stockbit

// Quote is the price slice the panel shows. Optional numbers stay pointers so
// the surface can render "—" instead of a fabricated zero.
type Quote struct {
	Last      *float64 `json:"last,omitempty"`
	Change    *float64 `json:"change,omitempty"`
	ChangePct *float64 `json:"change_pct,omitempty"`
	Open      *float64 `json:"open,omitempty"`
	High      *float64 `json:"high,omitempty"`
	Low       *float64 `json:"low,omitempty"`
	Prev      *float64 `json:"prev,omitempty"`
	Volume    *float64 `json:"volume,omitempty"`
	Value     *float64 `json:"value,omitempty"`
	Frequency *float64 `json:"frequency,omitempty"`
	AsOf      string   `json:"as_of,omitempty"`
}

// Info is the company identity, normalized across Stockbit's field names.
type Info struct {
	Ticker      string   `json:"ticker"`
	Available   bool     `json:"available"`
	Name        string   `json:"name,omitempty"`
	Sector      string   `json:"sector,omitempty"`
	SubSector   string   `json:"sub_sector,omitempty"`
	Industry    string   `json:"industry,omitempty"`
	ListingDate string   `json:"listing_date,omitempty"`
	Shares      *float64 `json:"shares,omitempty"`
	MarketCap   *float64 `json:"market_cap,omitempty"`
	Logo        string   `json:"logo,omitempty"`
	Description string   `json:"description,omitempty"`
}

// OrderbookLevels is the depth count, not a full book.
type OrderbookLevels struct {
	Bid   int `json:"bid"`
	Offer int `json:"offer"`
}

// Orderbook is the bid/offer imbalance readout plus the price quote the
// endpoint already carries.
type Orderbook struct {
	Ticker    string          `json:"ticker"`
	Available bool            `json:"available"`
	AsOf      string          `json:"as_of,omitempty"`
	BidLots   float64         `json:"bid_lots"`
	OfferLots float64         `json:"offer_lots"`
	Imbalance *float64        `json:"imbalance,omitempty"`
	SpreadPct *float64        `json:"spread_pct,omitempty"`
	BestBid   *float64        `json:"best_bid,omitempty"`
	BestOffer *float64        `json:"best_offer,omitempty"`
	Levels    OrderbookLevels `json:"levels"`
	Quote     *Quote          `json:"quote,omitempty"`
	Warnings  []string        `json:"warnings,omitempty"`
}

// BrokerRow is one net broker row from the market detector.
type BrokerRow struct {
	Broker       string   `json:"broker"`
	Side         string   `json:"side"`
	BuyLots      float64  `json:"buy_lots"`
	SellLots     float64  `json:"sell_lots"`
	NetLots      float64  `json:"net_lots"`
	BuyValue     float64  `json:"buy_value"`
	SellValue    float64  `json:"sell_value"`
	NetValue     float64  `json:"net_value"`
	AvgBuyPrice  *float64 `json:"avg_buy_price,omitempty"`
	AvgSellPrice *float64 `json:"avg_sell_price,omitempty"`
	Type         string   `json:"type,omitempty"`
}

// BandarLevel is one of top1/top3/top5/avg from the bandar detector.
type BandarLevel struct {
	Volume  *float64 `json:"volume,omitempty"`
	Percent *float64 `json:"percent,omitempty"`
	Amount  *float64 `json:"amount,omitempty"`
	Accdist string   `json:"accdist,omitempty"`
}

// BandarDetector is the summarised accumulation/distribution block.
type BandarDetector struct {
	Top1                *BandarLevel `json:"top1,omitempty"`
	Top3                *BandarLevel `json:"top3,omitempty"`
	Top5                *BandarLevel `json:"top5,omitempty"`
	Avg                 *BandarLevel `json:"avg,omitempty"`
	TotalBuyer          *float64     `json:"total_buyer,omitempty"`
	TotalSeller         *float64     `json:"total_seller,omitempty"`
	NumberBrokerBuysell *float64     `json:"number_broker_buysell,omitempty"`
	BrokerAccdist       string       `json:"broker_accdist,omitempty"`
	Volume              *float64     `json:"volume,omitempty"`
	Value               *float64     `json:"value,omitempty"`
	Average             *float64     `json:"average,omitempty"`
}

// Brokers is the per-ticker broker summary for one date.
type Brokers struct {
	Ticker               string          `json:"ticker"`
	Date                 string          `json:"date"`
	Available            bool            `json:"available"`
	AsOf                 string          `json:"as_of"`
	Count                int             `json:"count"`
	Rows                 []BrokerRow     `json:"rows"`
	Top3ConcentrationPct *float64        `json:"top3_concentration_pct,omitempty"`
	Detector             *BandarDetector `json:"detector,omitempty"`
	Warnings             []string        `json:"warnings,omitempty"`
	Cache                CacheInfo       `json:"cache"`
}

// WatchlistGroup is one personal watchlist.
type WatchlistGroup struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	IsDefault bool   `json:"is_default"`
	Count     int    `json:"count"`
}

// WatchlistItem is one name in a group.
type WatchlistItem struct {
	Ticker    string   `json:"ticker"`
	Name      string   `json:"name,omitempty"`
	Last      *float64 `json:"last,omitempty"`
	ChangePct *float64 `json:"change_pct,omitempty"`
	Volume    *float64 `json:"volume,omitempty"`
	Value     *float64 `json:"value,omitempty"`
}

// Watchlist is the personal side of Stockbit.
type Watchlist struct {
	Available bool             `json:"available"`
	AsOf      string           `json:"as_of"`
	Groups    []WatchlistGroup `json:"groups"`
	Active    *WatchlistGroup  `json:"active,omitempty"`
	Items     []WatchlistItem  `json:"items"`
	Warnings  []string         `json:"warnings,omitempty"`
	Cache     CacheInfo        `json:"cache"`
}

// SymbolSnapshot is the composed one-ticker view the data panel renders.
type SymbolSnapshot struct {
	Ticker    string     `json:"ticker"`
	Available bool       `json:"available"`
	AsOf      string     `json:"as_of"`
	Info      *Info      `json:"info,omitempty"`
	Quote     *Quote     `json:"quote,omitempty"`
	Orderbook *Orderbook `json:"orderbook,omitempty"`
	Brokers   *Brokers   `json:"brokers,omitempty"`
	Warnings  []string   `json:"warnings"`
	Cache     CacheInfo  `json:"cache"`
}
