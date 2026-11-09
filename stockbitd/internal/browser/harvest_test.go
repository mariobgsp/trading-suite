package browser

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"stockbitd/internal/config"
	"stockbitd/internal/session"
)

func browserTestJWT(t *testing.T, exp time.Time, username string) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"HS256","typ":"JWT"}`))
	payload, err := json.Marshal(map[string]any{"exp": exp.Unix(), "sub": "1", "username": username})
	if err != nil {
		t.Fatal(err)
	}
	return header + "." + base64.RawURLEncoding.EncodeToString(payload) + ".signature"
}

func TestHarvestFromCredentialCookie(t *testing.T) {
	now := time.Now().UTC()
	access := browserTestJWT(t, now.Add(time.Hour), "trader")
	credential := session.Credential{
		Access:  session.Token{Value: access, ExpiresAt: now.Add(time.Hour).Unix()},
		Refresh: session.Token{Value: "refresh-token"},
		User:    session.User{ID: 3, Username: "trader", Fullname: "The Trader"},
	}
	encoded, err := session.EncodeCredentialCookie(credential)
	if err != nil {
		t.Fatal(err)
	}
	cookies := []session.Cookie{
		{Name: "credentialStorage", Value: encoded, Domain: "stockbit.com", Path: "/"},
		{Name: "cf_clearance", Value: "cloudflare", Domain: ".stockbit.com", Path: "/"},
		{Name: "ga", Value: "x", Domain: ".google.com", Path: "/"},
	}
	harvest, err := Harvest(cookies, PageState{})
	if err != nil {
		t.Fatalf("harvest: %v", err)
	}
	if harvest.AccessToken != access || harvest.RefreshToken != "refresh-token" {
		t.Fatalf("tokens = %+v", harvest)
	}
	if harvest.User.Username != "trader" {
		t.Fatalf("user = %+v", harvest.User)
	}
	if len(harvest.Cookies) != 2 {
		t.Fatalf("cookies = %+v", harvest.Cookies)
	}
	for _, cookie := range harvest.Cookies {
		if cookie.Domain == ".google.com" {
			t.Fatalf("third-party cookie survived")
		}
	}
}

func TestHarvestFromDocumentCookie(t *testing.T) {
	now := time.Now().UTC()
	access := browserTestJWT(t, now.Add(time.Hour), "trader")
	credential := session.Credential{Access: session.Token{Value: access}, Refresh: session.Token{Value: "refresh"}}
	encoded, _ := session.EncodeCredentialCookie(credential)
	page := PageState{Cred: "credentialStorage=" + encoded + "; other=1"}
	harvest, err := Harvest(nil, page)
	if err != nil {
		t.Fatalf("harvest: %v", err)
	}
	if harvest.AccessToken != access {
		t.Fatalf("access = %q", harvest.AccessToken)
	}
}

func TestHarvestFromLegacyStorage(t *testing.T) {
	now := time.Now().UTC()
	access := browserTestJWT(t, now.Add(time.Hour), "legacy")
	user, _ := json.Marshal(map[string]any{"id": 4, "username": "legacy", "fullname": "Legacy User"})
	page := PageState{
		At: base64.RawURLEncoding.EncodeToString([]byte(access)),
		Ar: "legacy-refresh",
		Au: base64.RawURLEncoding.EncodeToString(user),
	}
	harvest, err := Harvest(nil, page)
	if err != nil {
		t.Fatalf("harvest: %v", err)
	}
	if harvest.AccessToken != access || harvest.RefreshToken != "legacy-refresh" {
		t.Fatalf("tokens = %+v", harvest)
	}
	if harvest.User.Username != "legacy" || harvest.User.Fullname != "Legacy User" {
		t.Fatalf("user = %+v", harvest.User)
	}
}

func TestHarvestWithoutCredentials(t *testing.T) {
	if _, err := Harvest(nil, PageState{}); !isSessionError(err, session.ErrNoCredentials) {
		t.Fatalf("error = %v, want no_credentials", err)
	}
	cookies := []session.Cookie{{Name: "other", Value: "1", Domain: "stockbit.com", Path: "/"}}
	if _, err := Harvest(cookies, PageState{At: "not-a-token"}); !isSessionError(err, session.ErrNoCredentials) {
		t.Fatalf("error = %v, want no_credentials", err)
	}
}

func TestParsePageJSON(t *testing.T) {
	page, err := ParsePageJSON(`{"at":"a","ar":"r","href":"https://stockbit.com"}`)
	if err != nil {
		t.Fatal(err)
	}
	if page.At != "a" || page.Ar != "r" {
		t.Fatalf("page = %+v", page)
	}
	if _, err := ParsePageJSON("not json"); err == nil {
		t.Fatalf("garbage page did not fail")
	}
	if page, err := ParsePageJSON(""); err != nil || page.At != "" {
		t.Fatalf("empty page = %+v, %v", page, err)
	}
}

func TestDiscoverMissingExplicitBinary(t *testing.T) {
	t.Setenv("DISPLAY", ":0")
	t.Setenv("WAYLAND_DISPLAY", "")
	cfg := config.Config{Browser: "/nonexistent/chrome", BrowserProfile: t.TempDir(), LoginURL: "about:blank"}
	caps := Discover(cfg)
	if caps.Available {
		t.Fatalf("expected unavailable: %+v", caps)
	}
	if caps.Code != session.CodeBrowserNotFound {
		t.Fatalf("code = %q", caps.Code)
	}
}

func TestResolveBinaryAcceptsExplicitPath(t *testing.T) {
	resolved := ResolveBinary("/home/mariobgsp/.cache/ms-playwright/chrome-linux64/chrome")
	if resolved == "" {
		t.Skip("the local Chrome for Testing binary is not present")
	}
	if !strings.Contains(resolved, "chrome") {
		t.Fatalf("resolved = %q", resolved)
	}
}

func isSessionError(err, target error) bool {
	if err == nil {
		return false
	}
	type iser interface{ Is(error) bool }
	if typed, ok := err.(iser); ok {
		return typed.Is(target)
	}
	return false
}
