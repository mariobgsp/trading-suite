package stockbit

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"stockbitd/internal/session"
)

func stockbitTestJWT(t *testing.T, exp time.Time, username string) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, err := json.Marshal(map[string]any{"exp": exp.Unix(), "sub": "1", "username": username})
	if err != nil {
		t.Fatal(err)
	}
	return header + "." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func testSession(t *testing.T, now time.Time, refreshURL string) (*session.Manager, string) {
	t.Helper()
	store := session.NewStore(filepath.Join(t.TempDir(), "session.json"))
	manager := session.NewManager(store, session.Options{
		Now:           func() time.Time { return now },
		RefreshURLs:   []string{refreshURL},
		RefreshWindow: 10 * time.Minute,
		KeepAlive:     time.Minute,
		Logger:        testLogger(),
	})
	access := stockbitTestJWT(t, now.Add(time.Hour), "trader")
	if err := manager.AdoptToken(access, "refresh-token"); err != nil {
		t.Fatalf("adopt token: %v", err)
	}
	return manager, access
}

const brokerFixture = `{"data":{"broker_summary":{"brokers_buy":[{"netbs_broker_code":"DH","blot":"1200","bval":"9000000","netbs_buy_avg_price":"9800"}],"brokers_sell":[{"netbs_broker_code":"CC","slot":"500","sval":"4900000","netbs_sell_avg_price":"9800"}]},"bandar_detector":{"top1":{"vol":"1200","percent":"42.1","amount":"9000000","accdist":"ACC"}}}}`

const orderbookFixture = `{"data":{"bid":[{"price":"9800","volume":"100000"}],"offer":[{"price":"9850","volume":"50000"}],"total_bid_offer":{"bid":{"lot":"1000"},"offer":{"lot":"500"}},"last_price":"9800","prev":"9700","volume":"150000","value":"1470000000"}}`

func TestBrokersUsesSessionAndCaches(t *testing.T) {
	now := time.Now().UTC()
	var calls int32
	var authorization string
	var query url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		authorization = r.Header.Get("Authorization")
		query = r.URL.Query()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(brokerFixture))
	}))
	defer server.Close()
	manager, access := testSession(t, now, server.URL+"/login/refresh")
	client := New(manager, server.URL, NewCache(), testLogger())

	first, err := client.Brokers(context.Background(), "bbca", "2026-11-06", false)
	if err != nil {
		t.Fatalf("brokers: %v", err)
	}
	if !first.Available || first.Count != 2 || first.Cache.Hit {
		t.Fatalf("first = %+v", first)
	}
	if authorization != "Bearer "+access {
		t.Fatalf("authorization = %q", authorization)
	}
	if query.Get("from") != "2026-11-06" || query.Get("to") != "2026-11-06" || query.Get("transaction_type") != "TRANSACTION_TYPE_NET" {
		t.Fatalf("query = %+v", query)
	}
	second, err := client.Brokers(context.Background(), "BBCA", "2026-11-06", false)
	if err != nil {
		t.Fatalf("second brokers: %v", err)
	}
	if !second.Cache.Hit || atomic.LoadInt32(&calls) != 1 {
		t.Fatalf("cache miss on second read: calls=%d cache=%+v", calls, second.Cache)
	}
	if _, err := client.Brokers(context.Background(), "BBCA", "2026-11-06", true); err != nil {
		t.Fatalf("refresh brokers: %v", err)
	}
	if atomic.LoadInt32(&calls) != 2 {
		t.Fatalf("refresh did not bypass cache: calls=%d", calls)
	}
}

func TestSnapshotIsPartialWhenOneSectionFails(t *testing.T) {
	now := time.Now().UTC()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/emitten/BBCA/info":
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"message":"info exploded"}`))
		case r.URL.Path == "/company-price-feed/v2/orderbook/companies/BBCA":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(orderbookFixture))
		case r.URL.Path == "/marketdetectors/BBCA":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(brokerFixture))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	manager, _ := testSession(t, now, server.URL+"/login/refresh")
	client := New(manager, server.URL, NewCache(), testLogger())

	snapshot, err := client.Snapshot(context.Background(), "BBCA", false)
	if err != nil {
		t.Fatalf("snapshot: %v", err)
	}
	if !snapshot.Available {
		t.Fatalf("snapshot should be partially available: %+v", snapshot)
	}
	if snapshot.Info != nil {
		t.Fatalf("info should be absent after a 500: %+v", snapshot.Info)
	}
	if snapshot.Quote == nil || snapshot.Quote.Last == nil || *snapshot.Quote.Last != 9800 {
		t.Fatalf("quote = %+v", snapshot.Quote)
	}
	if snapshot.Brokers == nil || !snapshot.Brokers.Available {
		t.Fatalf("brokers = %+v", snapshot.Brokers)
	}
	found := false
	for _, warning := range snapshot.Warnings {
		if warning == "company info: info exploded (HTTP 500)" || warning == "company info: info exploded" {
			found = true
		}
	}
	if !found {
		t.Fatalf("warnings = %+v", snapshot.Warnings)
	}
}

func TestWatchlistGroupsAndItems(t *testing.T) {
	now := time.Now().UTC()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/watchlist":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"watchlist_id":1,"name":"Main","is_default":true,"count":1}]}`))
		case "/watchlist/1":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":{"result":[{"symbol":"BBCA","name":"BCA","last":"9800","change":"1.2"}]}}`))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	manager, _ := testSession(t, now, server.URL+"/login/refresh")
	client := New(manager, server.URL, NewCache(), testLogger())

	watchlist, err := client.Watchlist(context.Background(), false)
	if err != nil {
		t.Fatalf("watchlist: %v", err)
	}
	if len(watchlist.Groups) != 1 || watchlist.Active == nil || watchlist.Active.ID != 1 {
		t.Fatalf("groups = %+v active = %+v", watchlist.Groups, watchlist.Active)
	}
	if len(watchlist.Items) != 1 || watchlist.Items[0].Ticker != "BBCA" {
		t.Fatalf("items = %+v", watchlist.Items)
	}
	if watchlist.Items[0].Last == nil || *watchlist.Items[0].Last != 9800 {
		t.Fatalf("last = %v", watchlist.Items[0].Last)
	}
}

func TestClientMapsReauth(t *testing.T) {
	now := time.Now().UTC()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"UNAUTHORIZED"}`))
	}))
	defer server.Close()
	manager, _ := testSession(t, now, server.URL+"/login/refresh")
	client := New(manager, server.URL, NewCache(), testLogger())

	_, err := client.Brokers(context.Background(), "BBCA", "2026-11-06", false)
	if !errors.Is(err, session.ErrReauthRequired) {
		t.Fatalf("error = %v, want reauth_required", err)
	}
	if status := manager.Status(); status.State != "reauth_required" {
		t.Fatalf("status = %+v", status)
	}
}

func TestClientRejectsInvalidTickerWithoutNetwork(t *testing.T) {
	client := New(nil, "http://127.0.0.1:1", NewCache(), testLogger())
	if _, err := client.Brokers(context.Background(), "BAD TICKER", "", false); !errors.Is(err, session.ErrInvalidTicker) {
		t.Fatalf("error = %v, want invalid_ticker", err)
	}
	if _, err := client.Snapshot(context.Background(), "../etc/passwd", false); !errors.Is(err, session.ErrInvalidTicker) {
		t.Fatalf("snapshot error = %v, want invalid_ticker", err)
	}
}
