package session

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func testJWT(t *testing.T, exp time.Time, username string) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, err := json.Marshal(map[string]any{
		"exp":      exp.Unix(),
		"sub":      "1",
		"username": username,
		"email":    username + "@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	return header + "." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}

func newTestManager(t *testing.T, now time.Time, refreshURL string) (*Manager, *Store) {
	t.Helper()
	dir := t.TempDir()
	store := NewStore(filepath.Join(dir, "session.json"))
	mgr := NewManager(store, Options{
		Now:           func() time.Time { return now },
		RefreshURLs:   []string{refreshURL},
		RefreshWindow: 10 * time.Minute,
		KeepAlive:     time.Minute,
	})
	return mgr, store
}

func seededState(t *testing.T, now time.Time, accessExpiry time.Time) *State {
	t.Helper()
	return &State{
		Version:       StateVersion,
		Access:        Token{Value: testJWT(t, accessExpiry, "trader"), ExpiresAt: accessExpiry.Unix()},
		Refresh:       Token{Value: "refresh-token-1", ExpiresAt: now.Add(20 * 24 * time.Hour).Unix()},
		User:          User{ID: 7, Username: "trader", Fullname: "The Trader"},
		Source:        "test",
		CreatedAt:     now.Add(-time.Hour).Unix(),
		UpdatedAt:     now.Add(-time.Hour).Unix(),
		LastRefreshAt: 0,
	}
}

func TestStoreRoundTripAndPermissions(t *testing.T) {
	dir := t.TempDir()
	store := NewStore(filepath.Join(dir, "session.json"))
	now := time.Now().UTC()
	state := seededState(t, now, now.Add(time.Hour))
	if err := store.Save(state); err != nil {
		t.Fatalf("save: %v", err)
	}
	info, err := os.Stat(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("session mode = %o, want 600", mode)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if loaded.Access.Value != state.Access.Value {
		t.Fatalf("access token did not round-trip")
	}
	if err := store.Remove(); err != nil {
		t.Fatalf("remove: %v", err)
	}
	if _, err := store.Load(); !errorsIs(err, ErrSessionMissing) {
		t.Fatalf("missing session error = %v", err)
	}
}

func TestStoreCorruptIsReportedNotReplaced(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "session.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	store := NewStore(path)
	if _, err := store.Load(); !errorsIs(err, ErrSessionCorrupt) {
		t.Fatalf("corrupt error = %v", err)
	}
	data, _ := os.ReadFile(path)
	if string(data) != "{not json" {
		t.Fatalf("store rewrote a corrupt file")
	}
}

func TestStatusUnconfiguredThenConnected(t *testing.T) {
	now := time.Now().UTC()
	mgr, _ := newTestManager(t, now, "http://127.0.0.1:1/refresh")
	if status := mgr.Status(); status.State != "unconfigured" || status.Available {
		t.Fatalf("empty status = %+v", status)
	}
	state := seededState(t, now, now.Add(time.Hour))
	if err := mgr.update(func(target *State) error {
		*target = *state
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	status := mgr.Status()
	if status.State != "connected" || !status.Available {
		t.Fatalf("connected status = %+v", status)
	}
	if status.User == nil || status.User.Username != "trader" {
		t.Fatalf("user missing from status")
	}
	encoded, _ := json.Marshal(status)
	if bytes.Contains(encoded, []byte(state.Access.Value)) || bytes.Contains(encoded, []byte(state.Refresh.Value)) {
		t.Fatalf("status leaked a token: %s", encoded)
	}
	if status.Cookies.Count == 0 {
		t.Fatalf("credential cookie was not persisted")
	}
}

func TestRefreshRotatesTokensAndRewritesCredentialCookie(t *testing.T) {
	now := time.Now().UTC()
	newAccess := testJWT(t, now.Add(2*time.Hour), "trader")
	var gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":{"access":{"token":%q,"expired_at":%q},"refresh":{"token":"refresh-token-2","expired_at":%q}}}`,
			newAccess, FormatExpiry(now.Add(2*time.Hour).Unix()), FormatExpiry(now.Add(30*24*time.Hour).Unix()))
	}))
	defer server.Close()

	mgr, store := newTestManager(t, now, server.URL)
	state := seededState(t, now, now.Add(-time.Hour))
	state.Access = Token{Value: testJWT(t, now.Add(-time.Hour), "trader"), ExpiresAt: now.Add(-time.Hour).Unix()}
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	if err := mgr.Load(); err != nil {
		t.Fatal(err)
	}
	status, err := mgr.Refresh(context.Background(), false)
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if gotAuth != "Bearer refresh-token-1" {
		t.Fatalf("refresh authorization = %q", gotAuth)
	}
	if status.State != "connected" || !status.Available {
		t.Fatalf("status after refresh = %+v", status)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Access.Value != newAccess {
		t.Fatalf("access token was not rotated")
	}
	if loaded.Refresh.Value != "refresh-token-2" {
		t.Fatalf("refresh token was not rotated")
	}
	if loaded.LastRefreshAt != now.Unix() {
		t.Fatalf("last refresh = %d, want %d", loaded.LastRefreshAt, now.Unix())
	}
	credential, err := CredentialFromCookies(loaded.Cookies)
	if err != nil {
		t.Fatalf("credential cookie: %v", err)
	}
	if credential.Access.Value != newAccess || credential.Refresh.Value != "refresh-token-2" {
		t.Logf("loaded cookies: %+v", loaded.Cookies)
		t.Logf("credential: %+v", credential)
		t.Fatalf("credential cookie carries stale tokens")
	}
}

func TestRefreshSingleFlight(t *testing.T) {
	now := time.Now().UTC()
	var refreshes int32
	newAccess := testJWT(t, now.Add(2*time.Hour), "trader")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&refreshes, 1)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":{"access":{"token":%q},"refresh":{"token":"refresh-token-2"}}}`, newAccess)
	}))
	defer server.Close()

	mgr, store := newTestManager(t, now, server.URL)
	state := seededState(t, now, now.Add(-time.Hour))
	state.Access = Token{Value: testJWT(t, now.Add(-time.Hour), "trader"), ExpiresAt: now.Add(-time.Hour).Unix()}
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	if err := mgr.Load(); err != nil {
		t.Fatal(err)
	}
	var wait sync.WaitGroup
	for index := 0; index < 8; index++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if _, err := mgr.Ensure(context.Background()); err != nil {
				t.Errorf("ensure: %v", err)
			}
		}()
	}
	wait.Wait()
	if got := atomic.LoadInt32(&refreshes); got != 1 {
		t.Fatalf("refresh calls = %d, want 1", got)
	}
}

func TestRefreshRejectedMarksReauth(t *testing.T) {
	now := time.Now().UTC()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"UNAUTHORIZED"}`))
	}))
	defer server.Close()
	mgr, store := newTestManager(t, now, server.URL)
	state := seededState(t, now, now.Add(-time.Hour))
	state.Access = Token{Value: testJWT(t, now.Add(-time.Hour), "trader"), ExpiresAt: now.Add(-time.Hour).Unix()}
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	if err := mgr.Load(); err != nil {
		t.Fatal(err)
	}
	if _, err := mgr.Refresh(context.Background(), true); !errorsIs(err, ErrReauthRequired) {
		t.Fatalf("refresh error = %v, want reauth_required", err)
	}
	status := mgr.Status()
	if status.State != "reauth_required" {
		t.Fatalf("status = %+v", status)
	}
	loaded, _ := store.Load()
	if loaded.ReauthReason == "" {
		t.Fatalf("reauth reason was not persisted")
	}
}

func TestRequestRetriesOnceAfter401(t *testing.T) {
	now := time.Now().UTC()
	oldAccess := testJWT(t, now.Add(time.Hour), "trader")
	newAccess := testJWT(t, now.Add(3*time.Hour), "trader")
	var dataCalls int32
	var refreshCalls int32
	mux := http.NewServeMux()
	mux.HandleFunc("/data", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&dataCalls, 1)
		if r.Header.Get("Authorization") != "Bearer "+newAccess {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"message":"UNAUTHORIZED"}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	mux.HandleFunc("/refresh", func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&refreshCalls, 1)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":{"access":{"token":%q},"refresh":{"token":"refresh-token-2"}}}`, newAccess)
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	mgr, store := newTestManager(t, now, server.URL+"/refresh")
	state := seededState(t, now, now.Add(time.Hour))
	state.Access = Token{Value: oldAccess, ExpiresAt: now.Add(time.Hour).Unix()}
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	if err := mgr.Load(); err != nil {
		t.Fatal(err)
	}
	result, err := mgr.RequestJSON(context.Background(), http.MethodGet, server.URL+"/data", nil, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	if result["ok"] != true {
		t.Fatalf("result = %+v", result)
	}
	if got := atomic.LoadInt32(&dataCalls); got != 2 {
		t.Fatalf("data calls = %d, want 2", got)
	}
	if got := atomic.LoadInt32(&refreshCalls); got != 1 {
		t.Fatalf("refresh calls = %d, want 1", got)
	}
}

func TestAdoptCookiesParsesCredentialStorage(t *testing.T) {
	now := time.Now().UTC()
	mgr, store := newTestManager(t, now, "http://127.0.0.1:1/refresh")
	access := testJWT(t, now.Add(time.Hour), "cookie-user")
	credential := Credential{
		Access:  Token{Value: access, ExpiresAt: now.Add(time.Hour).Unix()},
		Refresh: Token{Value: "refresh-cookie", ExpiresAt: now.Add(10 * 24 * time.Hour).Unix()},
		User:    User{ID: 9, Username: "cookie-user", Fullname: "Cookie User"},
	}
	encoded, err := EncodeCredentialCookie(credential)
	if err != nil {
		t.Fatal(err)
	}
	header := "credentialStorage=" + encoded + "; other=1"
	if err := mgr.AdoptCookies(header, "", ""); err != nil {
		t.Fatalf("adopt cookies: %v", err)
	}
	status := mgr.Status()
	if status.State != "connected" || status.User == nil || status.User.Username != "cookie-user" {
		t.Fatalf("status = %+v", status)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Access.Value != access || loaded.Refresh.Value != "refresh-cookie" {
		t.Logf("adopted state: %+v", loaded)
		t.Logf("adopted cookies: %+v", loaded.Cookies)
		t.Fatalf("tokens were not adopted")
	}
	if loaded.User.Fullname != "Cookie User" {
		t.Fatalf("user was not adopted: %+v", loaded.User)
	}
	if loaded.Source != "cookies" {
		t.Fatalf("source = %q", loaded.Source)
	}
}

func TestAdoptTokenRejectsExpiredWithoutRefresh(t *testing.T) {
	now := time.Now().UTC()
	mgr, _ := newTestManager(t, now, "http://127.0.0.1:1/refresh")
	expired := testJWT(t, now.Add(-time.Hour), "trader")
	if err := mgr.AdoptToken(expired, ""); !errorsIs(err, ErrTokenExpired) {
		t.Fatalf("error = %v, want token_expired", err)
	}
	if err := mgr.AdoptToken("not-a-jwt", ""); !errorsIs(err, ErrInvalidToken) {
		t.Fatalf("error = %v, want invalid_token", err)
	}
}

func TestLogoutRemovesFile(t *testing.T) {
	now := time.Now().UTC()
	mgr, store := newTestManager(t, now, "http://127.0.0.1:1/refresh")
	state := seededState(t, now, now.Add(time.Hour))
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	if err := mgr.Load(); err != nil {
		t.Fatal(err)
	}
	if err := mgr.Logout(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(store.Path()); !os.IsNotExist(err) {
		t.Fatalf("session file still exists")
	}
	if status := mgr.Status(); status.State != "unconfigured" {
		t.Fatalf("status after logout = %+v", status)
	}
}

func TestKeepAliveRefreshesOnlyInsideWindow(t *testing.T) {
	now := time.Now().UTC()
	var refreshes int32
	newAccess := testJWT(t, now.Add(2*time.Hour), "trader")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&refreshes, 1)
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"data":{"access":{"token":%q},"refresh":{"token":"refresh-token-2"}}}`, newAccess)
	}))
	defer server.Close()
	mgr, store := newTestManager(t, now, server.URL)
	state := seededState(t, now, now.Add(time.Hour))
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	if err := mgr.Load(); err != nil {
		t.Fatal(err)
	}
	if err := mgr.MaybeRefresh(context.Background()); err != nil {
		t.Fatalf("fresh maybe refresh: %v", err)
	}
	if got := atomic.LoadInt32(&refreshes); got != 0 {
		t.Fatalf("refreshed a token with a full hour left")
	}
	state.Access = Token{Value: testJWT(t, now.Add(4*time.Minute), "trader"), ExpiresAt: now.Add(4 * time.Minute).Unix()}
	if err := store.Save(state); err != nil {
		t.Fatal(err)
	}
	if err := mgr.MaybeRefresh(context.Background()); err != nil {
		t.Fatalf("windowed maybe refresh: %v", err)
	}
	if got := atomic.LoadInt32(&refreshes); got != 1 {
		t.Fatalf("refresh calls = %d, want 1", got)
	}
}

func errorsIs(err, target error) bool {
	if err == nil {
		return false
	}
	type iser interface{ Is(error) bool }
	if typed, ok := err.(iser); ok {
		return typed.Is(target)
	}
	return false
}
