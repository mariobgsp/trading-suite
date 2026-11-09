package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"stockbitd/internal/browser"
	"stockbitd/internal/config"
	"stockbitd/internal/credentials"
	"stockbitd/internal/session"
	"stockbitd/internal/stockbit"
)

func apiTestJWT(t *testing.T, exp time.Time, username string) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, err := json.Marshal(map[string]any{"exp": exp.Unix(), "sub": "1", "username": username})
	if err != nil {
		t.Fatal(err)
	}
	return header + "." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}

type harness struct {
	server  *httptest.Server
	client  *http.Client
	session *session.Manager
	browser *browser.Manager
}

func newHarness(t *testing.T, browserPath string) harness {
	t.Helper()
	now := time.Now().UTC()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := session.NewStore(filepath.Join(t.TempDir(), "session.json"))
	sessions := session.NewManager(store, session.Options{
		Now:           func() time.Time { return now },
		RefreshURLs:   []string{"http://127.0.0.1:1/login/refresh"},
		RefreshWindow: 10 * time.Minute,
		KeepAlive:     time.Minute,
		Logger:        logger,
	})
	if err := sessions.Load(); err != nil {
		t.Fatal(err)
	}
	home := t.TempDir()
	cfg := config.Config{
		Addr:           "127.0.0.1:0",
		Home:           home,
		SessionFile:    store.Path(),
		BrowserProfile: filepath.Join(home, "browser-profile"),
		BrowserLog:     filepath.Join(home, "browser.log"),
		Browser:        browserPath,
		LoginURL:       "about:blank",
		LoginTimeout:   2 * time.Second,
	}
	creds := credentials.NewStore(filepath.Join(t.TempDir(), "credentials.json"), "", "")
	login := browser.NewManager(cfg, sessions, creds, logger)
	data := stockbit.New(sessions, "http://127.0.0.1:1", stockbit.NewCache(), logger)
	server := httptest.NewServer(New(sessions, login, data, creds, logger).Handler())
	t.Cleanup(server.Close)
	return harness{server: server, client: server.Client(), session: sessions, browser: login}
}

func (h harness) get(t *testing.T, path string) (*http.Response, map[string]any) {
	t.Helper()
	response, err := h.client.Get(h.server.URL + path)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	return response, decodeBody(t, response)
}

func (h harness) post(t *testing.T, path string, body any, headers map[string]string) (*http.Response, map[string]any) {
	t.Helper()
	payload, _ := json.Marshal(body)
	request, err := http.NewRequest(http.MethodPost, h.server.URL+path, bytes.NewReader(payload))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := h.client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	return response, decodeBody(t, response)
}

func decodeBody(t *testing.T, response *http.Response) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	return body
}

func errorCode(body map[string]any) string {
	errorBody, _ := body["error"].(map[string]any)
	code, _ := errorBody["code"].(string)
	return code
}

func TestHealthAndStatus(t *testing.T) {
	instance := newHarness(t, "")
	response, body := instance.get(t, "/api/status")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	if body["state"] != "unconfigured" {
		t.Fatalf("state = %v", body["state"])
	}
	if _, ok := body["browser"]; !ok {
		t.Fatalf("browser capabilities missing")
	}
	if _, ok := body["cache"]; !ok {
		t.Fatalf("cache stats missing")
	}
	healthResponse, health := instance.get(t, "/api/health")
	if healthResponse.StatusCode != http.StatusOK || health["status"] != "ok" {
		t.Fatalf("health = %d %+v", healthResponse.StatusCode, health)
	}
}

func TestTokenAdoptionAndLogout(t *testing.T) {
	instance := newHarness(t, "")
	access := apiTestJWT(t, time.Now().UTC().Add(time.Hour), "trader")
	response, body := instance.post(t, "/api/session/token", map[string]any{"access_token": access, "refresh_token": "refresh"}, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("token adoption = %d %+v", response.StatusCode, body)
	}
	if body["state"] != "connected" {
		t.Fatalf("state = %v", body["state"])
	}
	_, status := instance.get(t, "/api/status")
	if status["state"] != "connected" {
		t.Fatalf("status after adoption = %+v", status)
	}
	logoutResponse, logout := instance.post(t, "/api/logout", map[string]any{}, nil)
	if logoutResponse.StatusCode != http.StatusOK || logout["state"] != "unconfigured" {
		t.Fatalf("logout = %d %+v", logoutResponse.StatusCode, logout)
	}
}

func TestTokenAdoptionRejectsGarbage(t *testing.T) {
	instance := newHarness(t, "")
	response, body := instance.post(t, "/api/session/token", map[string]any{"access_token": "not-a-jwt"}, nil)
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d %+v", response.StatusCode, body)
	}
	if code := errorCode(body); code != "invalid_token" {
		t.Fatalf("code = %q", code)
	}
}

func TestMutatingRequiresJSON(t *testing.T) {
	instance := newHarness(t, "")
	request, _ := http.NewRequest(http.MethodPost, instance.server.URL+"/api/logout", nil)
	response, err := instance.client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body := decodeBody(t, response)
	if response.StatusCode != http.StatusUnsupportedMediaType {
		t.Fatalf("status = %d %+v", response.StatusCode, body)
	}
	if code := errorCode(body); code != "invalid_request" {
		t.Fatalf("code = %q", code)
	}
}

func TestDataEndpointsRequireConnection(t *testing.T) {
	instance := newHarness(t, "")
	response, body := instance.get(t, "/api/data/symbol/BBCA")
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d %+v", response.StatusCode, body)
	}
	if code := errorCode(body); code != "not_connected" {
		t.Fatalf("code = %q", code)
	}
	watchResponse, watchBody := instance.get(t, "/api/data/watchlist")
	if watchResponse.StatusCode != http.StatusConflict {
		t.Fatalf("watchlist status = %d %+v", watchResponse.StatusCode, watchBody)
	}
}

func TestInvalidTickerAndUnknownRoutes(t *testing.T) {
	instance := newHarness(t, "")
	response, body := instance.get(t, "/api/data/symbol/BAD!")
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("ticker status = %d %+v", response.StatusCode, body)
	}
	if code := errorCode(body); code != "invalid_ticker" {
		t.Fatalf("ticker code = %q", code)
	}
	notFound, notFoundBody := instance.get(t, "/api/nope")
	if notFound.StatusCode != http.StatusNotFound || errorCode(notFoundBody) != "not_found" {
		t.Fatalf("not found = %d %+v", notFound.StatusCode, notFoundBody)
	}
	methodResponse, methodBody := instance.post(t, "/api/health", map[string]any{}, nil)
	if methodResponse.StatusCode != http.StatusMethodNotAllowed || errorCode(methodBody) != "method_not_allowed" {
		t.Fatalf("method = %d %+v", methodResponse.StatusCode, methodBody)
	}
}

func TestCORS(t *testing.T) {
	instance := newHarness(t, "")
	request, _ := http.NewRequest(http.MethodOptions, instance.server.URL+"/api/status", nil)
	request.Header.Set("Origin", "http://127.0.0.1:5173")
	request.Header.Set("Access-Control-Request-Method", "GET")
	response, err := instance.client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("preflight = %d", response.StatusCode)
	}
	if got := response.Header.Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5173" {
		t.Fatalf("allow origin = %q", got)
	}
	blocked, blockedBody := instance.post(t, "/api/logout", map[string]any{}, map[string]string{"Origin": "https://evil.example"})
	if blocked.StatusCode != http.StatusForbidden {
		t.Fatalf("blocked = %d %+v", blocked.StatusCode, blockedBody)
	}
	if code := errorCode(blockedBody); code != "forbidden_origin" {
		t.Fatalf("blocked code = %q", code)
	}
}

func TestLoginAttemptFailsWithoutABrowser(t *testing.T) {
	t.Setenv("DISPLAY", ":0")
	t.Setenv("WAYLAND_DISPLAY", "")
	instance := newHarness(t, "/nonexistent/chrome")
	response, body := instance.post(t, "/api/login/browser", map[string]any{}, nil)
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("start = %d %+v", response.StatusCode, body)
	}
	attempt, _ := body["attempt"].(map[string]any)
	id, _ := attempt["id"].(string)
	if id == "" {
		t.Fatalf("attempt id missing: %+v", body)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_, polled := instance.get(t, "/api/login/browser/"+id)
		current, _ := polled["attempt"].(map[string]any)
		state, _ := current["state"].(string)
		if state == "failed" {
			if code, _ := current["error_code"].(string); code != "browser_not_found" {
				t.Fatalf("error_code = %q, attempt = %+v", code, current)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("login attempt did not fail")
}

func TestUnknownAttempt(t *testing.T) {
	instance := newHarness(t, "")
	response, body := instance.get(t, "/api/login/browser/nope")
	if response.StatusCode != http.StatusNotFound || errorCode(body) != "attempt_not_found" {
		t.Fatalf("status = %d %+v", response.StatusCode, body)
	}
}

func TestCredentialsSaveStatusAndClear(t *testing.T) {
	instance := newHarness(t, "")
	response, body := instance.post(t, "/api/session/credentials", map[string]any{
		"username": "trader@example.com",
		"password": "very-secret",
	}, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("save = %d %+v", response.StatusCode, body)
	}
	credentialBody, _ := body["credentials"].(map[string]any)
	if credentialBody["configured"] != true || credentialBody["username"] != "trader@example.com" {
		t.Fatalf("credentials = %+v", body["credentials"])
	}
	for _, value := range body {
		if text, ok := value.(string); ok && text == "very-secret" {
			t.Fatalf("the password leaked into the status")
		}
	}
	_, status := instance.get(t, "/api/status")
	statusCredentials, _ := status["credentials"].(map[string]any)
	if statusCredentials["configured"] != true {
		t.Fatalf("status credentials = %+v", status["credentials"])
	}
	clearResponse, cleared := instance.post(t, "/api/session/credentials/clear", map[string]any{}, nil)
	if clearResponse.StatusCode != http.StatusOK {
		t.Fatalf("clear = %d %+v", clearResponse.StatusCode, cleared)
	}
	clearedCredentials, _ := cleared["credentials"].(map[string]any)
	if clearedCredentials["configured"] != false {
		t.Fatalf("cleared credentials = %+v", cleared["credentials"])
	}
}

func TestLoginStartMarksTheSavedSignIn(t *testing.T) {
	t.Setenv("DISPLAY", ":0")
	instance := newHarness(t, "/nonexistent/chrome")
	if _, body := instance.post(t, "/api/session/credentials", map[string]any{
		"username": "trader",
		"password": "secret",
	}, nil); body == nil {
		t.Fatal("credentials were not accepted")
	}
	response, body := instance.post(t, "/api/login/browser", map[string]any{}, nil)
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("start = %d %+v", response.StatusCode, body)
	}
	attempt, _ := body["attempt"].(map[string]any)
	if attempt["auto"] != true || attempt["username"] != "trader" {
		t.Fatalf("attempt = %+v", attempt)
	}
	id, _ := attempt["id"].(string)
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		_, polled := instance.get(t, "/api/login/browser/"+id)
		current, _ := polled["attempt"].(map[string]any)
		if state, _ := current["state"].(string); state == "failed" {
			if code, _ := current["error_code"].(string); code != "browser_not_found" {
				t.Fatalf("error_code = %q, attempt = %+v", code, current)
			}
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("login attempt did not fail")
}

func TestCacheClear(t *testing.T) {
	instance := newHarness(t, "")
	response, body := instance.get(t, "/api/cache")
	if response.StatusCode != http.StatusOK {
		t.Fatalf("cache status = %d %+v", response.StatusCode, body)
	}
	clearResponse, cleared := instance.post(t, "/api/cache/clear", map[string]any{}, nil)
	if clearResponse.StatusCode != http.StatusOK {
		t.Fatalf("clear status = %d %+v", clearResponse.StatusCode, cleared)
	}
	if _, ok := cleared["cleared"]; !ok {
		t.Fatalf("cleared count missing: %+v", cleared)
	}
}
