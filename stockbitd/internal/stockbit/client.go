package stockbit

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"stockbitd/internal/session"
)

var tickerPattern = regexp.MustCompile("^[A-Z]{1,6}$")

var jakarta = time.FixedZone("WIB", 7*60*60)

// Codes: not_connected, reauth_required, rate_limited, challenge_required,
// upstream_error, upstream_timeout, invalid_response, invalid_ticker,
// invalid_date.
// Client is the Stockbit data seam. It validates tickers, builds the upstream
// paths, normalizes the payloads and caches successful reads. It never stores
// credentials; session.Manager owns those.
type Client struct {
	session *session.Manager
	baseURL string
	cache   *Cache
	now     func() time.Time
	log     *slog.Logger
}

// New builds a client over a live session.
func New(manager *session.Manager, baseURL string, cache *Cache, logger *slog.Logger) *Client {
	if cache == nil {
		cache = NewCache()
	}
	if logger == nil {
		logger = slog.Default()
	}
	return &Client{
		session: manager,
		baseURL: strings.TrimRight(baseURL, "/"),
		cache:   cache,
		now:     time.Now,
		log:     logger,
	}
}

// NormalizeTicker accepts BBCA or BBCA.JK and rejects anything path-like.
func NormalizeTicker(raw string) (string, error) {
	value := strings.ToUpper(strings.TrimSpace(raw))
	value = strings.TrimSuffix(value, ".JK")
	if !tickerPattern.MatchString(value) {
		return "", session.ErrInvalidTicker
	}
	return value, nil
}

// NormalizeDate accepts YYYY-MM-DD; empty means today in Jakarta.
func (c *Client) normalizeDate(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return c.now().In(jakarta).Format("2006-01-02"), nil
	}
	parsed, err := time.ParseInLocation("2006-01-02", value, jakarta)
	if err != nil {
		return "", session.ErrInvalidDate
	}
	return parsed.Format("2006-01-02"), nil
}

func (c *Client) get(ctx context.Context, path string, query url.Values) (map[string]any, error) {
	raw, err := c.session.RequestJSON(ctx, http.MethodGet, c.baseURL+path, query, nil)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

// Brokers fetches the per-broker net summary for one date.
func (c *Client) Brokers(ctx context.Context, ticker, date string, refresh bool) (*Brokers, error) {
	ticker, err := NormalizeTicker(ticker)
	if err != nil {
		return nil, err
	}
	date, err = c.normalizeDate(date)
	if err != nil {
		return nil, err
	}
	key := "brokers:" + ticker + ":" + date
	value, info, err := c.cache.GetOrLoad(key, 15*time.Minute, refresh, func() (any, error) {
		query := url.Values{}
		query.Set("from", date)
		query.Set("to", date)
		query.Set("transaction_type", "TRANSACTION_TYPE_NET")
		query.Set("market_board", "MARKET_BOARD_REGULER")
		query.Set("investor_type", "INVESTOR_TYPE_ALL")
		query.Set("limit", "25")
		raw, fetchErr := c.get(ctx, "/marketdetectors/"+ticker, query)
		if fetchErr != nil {
			return nil, fetchErr
		}
		return normalizeBrokers(raw, ticker, date, c.now()), nil
	})
	if err != nil {
		return nil, err
	}
	brokers, ok := value.(*Brokers)
	if !ok || brokers == nil {
		return nil, session.ErrInvalidResponse
	}
	out := *brokers
	out.Cache = info
	return &out, nil
}

// Orderbook fetches the depth and the price quote for one ticker.
func (c *Client) Orderbook(ctx context.Context, ticker string, refresh bool) (*Orderbook, error) {
	ticker, err := NormalizeTicker(ticker)
	if err != nil {
		return nil, err
	}
	key := "orderbook:" + ticker
	value, _, err := c.cache.GetOrLoad(key, 60*time.Second, refresh, func() (any, error) {
		raw, fetchErr := c.get(ctx, "/company-price-feed/v2/orderbook/companies/"+ticker, nil)
		if fetchErr != nil {
			return nil, fetchErr
		}
		return normalizeOrderbook(raw, ticker, c.now()), nil
	})
	if err != nil {
		return nil, err
	}
	orderbook, ok := value.(*Orderbook)
	if !ok || orderbook == nil {
		return nil, session.ErrInvalidResponse
	}
	return orderbook, nil
}

// Info fetches the company identity. It changes rarely, so it is cached a day.
func (c *Client) Info(ctx context.Context, ticker string, refresh bool) (*Info, error) {
	ticker, err := NormalizeTicker(ticker)
	if err != nil {
		return nil, err
	}
	key := "info:" + ticker
	value, _, err := c.cache.GetOrLoad(key, 24*time.Hour, refresh, func() (any, error) {
		raw, fetchErr := c.get(ctx, "/emitten/"+ticker+"/info", nil)
		if fetchErr != nil {
			return nil, fetchErr
		}
		return normalizeInfo(raw, ticker), nil
	})
	if err != nil {
		return nil, err
	}
	info, ok := value.(*Info)
	if !ok || info == nil {
		return nil, session.ErrInvalidResponse
	}
	return info, nil
}

// Snapshot composes the three reads the panel shows. A dead session fails the
// whole snapshot; a single failing section is a warning and partial data.
func (c *Client) Snapshot(ctx context.Context, ticker string, refresh bool) (*SymbolSnapshot, error) {
	ticker, err := NormalizeTicker(ticker)
	if err != nil {
		return nil, err
	}
	key := "snapshot:" + ticker
	value, info, err := c.cache.GetOrLoad(key, 60*time.Second, refresh, func() (any, error) {
		info, infoErr := c.Info(ctx, ticker, refresh)
		orderbook, orderbookErr := c.Orderbook(ctx, ticker, refresh)
		brokers, brokersErr := c.Brokers(ctx, ticker, "", refresh)
		if fatal := fatalSessionError(infoErr, orderbookErr, brokersErr); fatal != nil {
			return nil, fatal
		}
		snapshot := &SymbolSnapshot{
			Ticker:    ticker,
			AsOf:      c.now().UTC().Format(time.RFC3339),
			Info:      info,
			Orderbook: orderbook,
			Brokers:   brokers,
			Warnings:  []string{},
		}
		if orderbook != nil {
			snapshot.Quote = orderbook.Quote
		}
		if infoErr != nil {
			snapshot.Warnings = append(snapshot.Warnings, "company info: "+session.MessageOf(infoErr))
		}
		if orderbookErr != nil {
			snapshot.Warnings = append(snapshot.Warnings, "orderbook: "+session.MessageOf(orderbookErr))
		}
		if brokersErr != nil {
			snapshot.Warnings = append(snapshot.Warnings, "brokers: "+session.MessageOf(brokersErr))
		}
		snapshot.Available = (info != nil && info.Available) || (orderbook != nil && orderbook.Available) || (brokers != nil && brokers.Available)
		if !snapshot.Available {
			if failure := firstFailure(infoErr, orderbookErr, brokersErr); failure != nil {
				return nil, failure
			}
			snapshot.Warnings = append(snapshot.Warnings, "no Stockbit data was returned for this ticker")
		}
		return snapshot, nil
	})
	if err != nil {
		return nil, err
	}
	snapshot, ok := value.(*SymbolSnapshot)
	if !ok || snapshot == nil {
		return nil, session.ErrInvalidResponse
	}
	out := *snapshot
	out.Cache = info
	return &out, nil
}

// Watchlist reads the personal groups and the default group's items.
func (c *Client) Watchlist(ctx context.Context, refresh bool) (*Watchlist, error) {
	value, info, err := c.cache.GetOrLoad("watchlist", 5*time.Minute, refresh, func() (any, error) {
		raw, fetchErr := c.get(ctx, "/watchlist", url.Values{"page": []string{"1"}, "limit": []string{"500"}})
		if fetchErr != nil {
			return nil, fetchErr
		}
		groups := normalizeWatchlistGroups(raw)
		out := &Watchlist{
			Available: true,
			AsOf:      c.now().UTC().Format(time.RFC3339),
			Groups:    groups,
			Items:     []WatchlistItem{},
			Warnings:  []string{},
		}
		if len(groups) == 0 {
			out.Warnings = append(out.Warnings, "no watchlist groups were returned")
			return out, nil
		}
		active := groups[0]
		for _, group := range groups {
			if group.IsDefault {
				active = group
				break
			}
		}
		rawItems, itemsErr := c.get(ctx, "/watchlist/"+strconv.FormatInt(active.ID, 10), url.Values{"page": []string{"1"}, "limit": []string{"500"}})
		if itemsErr != nil {
			out.Warnings = append(out.Warnings, "watchlist items: "+session.MessageOf(itemsErr))
			out.Active = &active
			return out, nil
		}
		items := normalizeWatchlistItems(rawItems)
		if active.Count == 0 {
			active.Count = len(items)
		}
		out.Active = &active
		out.Items = items
		return out, nil
	})
	if err != nil {
		return nil, err
	}
	watchlist, ok := value.(*Watchlist)
	if !ok || watchlist == nil {
		return nil, session.ErrInvalidResponse
	}
	out := *watchlist
	out.Cache = info
	return &out, nil
}

// CacheStats is the cache panel payload.
func (c *Client) CacheStats() map[string]any { return c.cache.Stats() }

// ClearCache empties the data cache; the session file is untouched.
func (c *Client) ClearCache() int { return c.cache.Clear() }

func firstFailure(errs ...error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}

func fatalSessionError(errs ...error) error {
	for _, err := range errs {
		if err == nil {
			continue
		}
		if errors.Is(err, session.ErrReauthRequired) || errors.Is(err, session.ErrNotConnected) {
			return err
		}
	}
	return nil
}
