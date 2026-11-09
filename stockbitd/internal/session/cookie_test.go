package session

import (
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestCredentialCookieRoundTrip(t *testing.T) {
	now := time.Now().UTC()
	credential := Credential{
		Access:  Token{Value: testJWT(t, now.Add(time.Hour), "trader"), ExpiresAt: now.Add(time.Hour).Unix()},
		Refresh: Token{Value: "refresh-token", ExpiresAt: now.Add(10 * 24 * time.Hour).Unix()},
		User:    User{ID: 7, Username: "trader", Fullname: "The Trader", Email: "trader@example.com", Privilege: Privilege{Code: "gold"}},
	}
	encoded, err := EncodeCredentialCookie(credential)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(encoded, "%7B") {
		t.Fatalf("credential cookie is not URL-encoded JSON: %q", encoded[:20])
	}
	parsed, err := ParseCredentialCookie(encoded)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if parsed.Access.Value != credential.Access.Value {
		t.Fatalf("access token did not round-trip")
	}
	if parsed.Refresh.Value != "refresh-token" {
		t.Fatalf("refresh token did not round-trip")
	}
	if parsed.User.Username != "trader" || parsed.User.Fullname != "The Trader" {
		t.Fatalf("user did not round-trip: %+v", parsed.User)
	}
	if parsed.User.Privilege.Code != "gold" {
		t.Fatalf("privilege did not round-trip: %+v", parsed.User.Privilege)
	}
}

func TestParseCredentialRawJSONAndBareJWT(t *testing.T) {
	now := time.Now().UTC()
	jwt := testJWT(t, now.Add(time.Hour), "trader")
	raw := `{"state":{"access":{"token":"` + jwt + `"},"refresh":{"token":"r"},"user":{"username":"trader"}},"version":0}`
	parsed, err := ParseCredentialCookie(raw)
	if err != nil {
		t.Fatalf("raw json: %v", err)
	}
	if parsed.Access.Value != jwt {
		t.Fatalf("raw json access token mismatch")
	}
	bare, err := ParseCredentialCookie(jwt)
	if err != nil {
		t.Fatalf("bare jwt: %v", err)
	}
	if bare.Access.Value != jwt {
		t.Fatalf("bare jwt mismatch")
	}
}

func TestParseCookieHeaderAndJSON(t *testing.T) {
	cookies, err := ParseCookieHeader("Cookie: a=1; b=two=2; empty=")
	if err != nil {
		t.Fatal(err)
	}
	if len(cookies) != 3 {
		t.Fatalf("parsed %d cookies, want 3", len(cookies))
	}
	if cookies[1].Value != "two=2" {
		t.Fatalf("value with = lost: %q", cookies[1].Value)
	}
	jsonCookies, err := ParseCookieInput(`[{"name":"x","value":"y","domain":".stockbit.com"}]`)
	if err != nil {
		t.Fatal(err)
	}
	if len(jsonCookies) != 1 || jsonCookies[0].Path != "/" {
		t.Fatalf("json cookies = %+v", jsonCookies)
	}
	if _, err := ParseCookieInput("   "); err == nil {
		t.Fatalf("empty cookie input did not fail")
	}
}

func TestJarDomainPathExpiryAndSecure(t *testing.T) {
	jar := NewJar(nil)
	jar.Merge([]Cookie{
		{Name: "root", Value: "1", Domain: "stockbit.com", Path: "/"},
		{Name: "sub", Value: "2", Domain: ".stockbit.com", Path: "/"},
		{Name: "api", Value: "3", Domain: ".stockbit.com", Path: "/api"},
		{Name: "secure", Value: "4", Domain: ".stockbit.com", Path: "/", Secure: true},
		{Name: "old", Value: "5", Domain: ".stockbit.com", Path: "/", Expires: time.Now().Add(-time.Hour).Unix()},
		{Name: "foreign", Value: "6", Domain: ".google.com", Path: "/"},
	})
	exodus, _ := url.Parse("https://exodus.stockbit.com/api/data")
	names := map[string]bool{}
	for _, cookie := range jar.ForURL(exodus) {
		names[cookie.Name] = true
	}
	if !names["sub"] || !names["api"] {
		t.Fatalf("subdomain cookies missing: %+v", names)
	}
	if names["root"] {
		t.Fatalf("host-only stockbit.com cookie was sent to exodus")
	}
	if !names["secure"] {
		t.Fatalf("secure cookie missing on https")
	}
	if names["old"] || names["foreign"] {
		t.Fatalf("expired or foreign cookie was sent: %+v", names)
	}
	plain, _ := url.Parse("http://exodus.stockbit.com/")
	for _, cookie := range jar.ForURL(plain) {
		if cookie.Name == "secure" {
			t.Fatalf("secure cookie sent over http")
		}
	}
	if got := jar.Len(); got != 4 {
		t.Fatalf("jar len = %d, want 4 after dropping expired", got)
	}
}

func TestUpdateFromResponseMergesAndDeletes(t *testing.T) {
	jar := NewJar([]Cookie{{Name: "old", Value: "1", Domain: ".stockbit.com", Path: "/"}})
	request, _ := url.Parse("https://exodus.stockbit.com/")
	response := &http.Response{Header: http.Header{}}
	response.Header.Add("Set-Cookie", "fresh=2; Domain=.stockbit.com; Path=/; Max-Age=3600")
	response.Header.Add("Set-Cookie", "old=; Domain=.stockbit.com; Path=/; Max-Age=0")
	if changed := jar.UpdateFromResponse(request, response); !changed {
		t.Fatalf("UpdateFromResponse reported no change")
	}
	names := map[string]string{}
	for _, cookie := range jar.ForURL(request) {
		names[cookie.Name] = cookie.Value
	}
	if names["fresh"] != "2" {
		t.Fatalf("fresh cookie missing: %+v", names)
	}
	if _, ok := names["old"]; ok {
		t.Fatalf("deleted cookie still present")
	}
}

func TestCredentialFromCookiesAndFilter(t *testing.T) {
	now := time.Now().UTC()
	credential := Credential{Access: Token{Value: testJWT(t, now.Add(time.Hour), "trader")}, Refresh: Token{Value: "r"}}
	encoded, _ := EncodeCredentialCookie(credential)
	cookies := FilterStockbit([]Cookie{
		{Name: credentialCookie, Value: encoded, Domain: "stockbit.com", Path: "/"},
		{Name: "ga", Value: "x", Domain: ".google.com", Path: "/"},
	})
	if len(cookies) != 1 {
		t.Fatalf("foreign cookie survived: %+v", cookies)
	}
	parsed, err := CredentialFromCookies(cookies)
	if err != nil {
		t.Fatalf("credential: %v", err)
	}
	if parsed.Access.Value != credential.Access.Value {
		t.Fatalf("credential access mismatch")
	}
}

func TestSetCredentialUpdatesTheJar(t *testing.T) {
	jar := NewJar(nil)
	now := time.Now().UTC()
	first := Credential{Access: Token{Value: testJWT(t, now.Add(time.Hour), "one")}, Refresh: Token{Value: "r1"}}
	if !jar.SetCredential(first) {
		t.Fatalf("SetCredential reported no change")
	}
	second := Credential{Access: Token{Value: testJWT(t, now.Add(time.Hour), "two")}, Refresh: Token{Value: "r2"}}
	if !jar.SetCredential(second) {
		t.Fatalf("SetCredential reported no change on rotation")
	}
	parsed, ok := jar.Credential()
	if !ok || parsed.Access.Value != second.Access.Value || parsed.Refresh.Value != "r2" {
		t.Fatalf("credential was not replaced: %+v", parsed)
	}
}
