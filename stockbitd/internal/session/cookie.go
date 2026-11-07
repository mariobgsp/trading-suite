package session

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// Codes: invalid_cookie, invalid_token, no_credentials.
// Cookie is the persisted form of one browser cookie. Domain and Path keep
// their wire values; Expires is unix seconds (0 means a session cookie).
type Cookie struct {
	Name     string `json:"name"`
	Value    string `json:"value"`
	Domain   string `json:"domain"`
	Path     string `json:"path"`
	Expires  int64  `json:"expires,omitempty"`
	Secure   bool   `json:"secure,omitempty"`
	HTTPOnly bool   `json:"http_only,omitempty"`
	SameSite string `json:"same_site,omitempty"`
}

// Credential is what the Stockbit credentialStorage cookie carries: the two
// tokens and the public account projection. It is never serialised by the API.
type Credential struct {
	Access  Token `json:"access"`
	Refresh Token `json:"refresh"`
	User    User  `json:"user"`
}

const credentialCookie = "credentialStorage"

// Jar is the in-memory cookie store. It is deliberately small: path/domain
// matching, expiry, and the credential cookie codec. It is not a public suffix
// list; stockbit.com is the only domain this app keeps.
type Jar struct {
	mu      sync.RWMutex
	cookies []Cookie
}

// NewJar builds a jar from persisted cookies, dropping expired entries.
func NewJar(cookies []Cookie) *Jar {
	jar := &Jar{}
	now := time.Now().Unix()
	for _, cookie := range cookies {
		if cookie.Expires > 0 && cookie.Expires <= now {
			continue
		}
		jar.setLocked(cookie)
	}
	return jar
}

// All returns a copy of every cookie, sorted for stable persistence.
func (j *Jar) All() []Cookie {
	j.mu.RLock()
	defer j.mu.RUnlock()
	out := append([]Cookie(nil), j.cookies...)
	sort.Slice(out, func(a, b int) bool {
		if out[a].Domain != out[b].Domain {
			return out[a].Domain < out[b].Domain
		}
		if out[a].Path != out[b].Path {
			return out[a].Path < out[b].Path
		}
		return out[a].Name < out[b].Name
	})
	return out
}

// Len is the number of retained cookies.
func (j *Jar) Len() int {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return len(j.cookies)
}

// Domains is the sorted set of cookie domains, for the status panel only.
func (j *Jar) Domains() []string {
	j.mu.RLock()
	defer j.mu.RUnlock()
	seen := make(map[string]struct{}, len(j.cookies))
	for _, cookie := range j.cookies {
		seen[normalizeDomain(cookie.Domain)] = struct{}{}
	}
	out := make([]string, 0, len(seen))
	for domain := range seen {
		out = append(out, domain)
	}
	sort.Strings(out)
	return out
}

func (j *Jar) setLocked(cookie Cookie) {
	cookie.Name = strings.TrimSpace(cookie.Name)
	if cookie.Name == "" {
		return
	}
	if cookie.Domain == "" {
		cookie.Domain = "stockbit.com"
	}
	if cookie.Path == "" {
		cookie.Path = "/"
	}
	for index := range j.cookies {
		existing := j.cookies[index]
		if existing.Name == cookie.Name && normalizeDomain(existing.Domain) == normalizeDomain(cookie.Domain) && existing.Path == cookie.Path {
			j.cookies[index] = cookie
			return
		}
	}
	j.cookies = append(j.cookies, cookie)
}

func (j *Jar) deleteLocked(name, domain, path string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	out := j.cookies[:0]
	removed := false
	for _, cookie := range j.cookies {
		if cookie.Name == name && (domain == "" || normalizeDomain(cookie.Domain) == normalizeDomain(domain)) && (path == "" || cookie.Path == path) {
			removed = true
			continue
		}
		out = append(out, cookie)
	}
	j.cookies = out
	return removed
}

// Delete removes a cookie and reports whether anything changed.
func (j *Jar) Delete(name, domain, path string) bool {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.deleteLocked(name, domain, path)
}

// Merge adds stockbit cookies and reports whether the jar changed.
func (j *Jar) Merge(cookies []Cookie) bool {
	changed := false
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, cookie := range FilterStockbit(cookies) {
		if cookie.Expires > 0 && cookie.Expires <= time.Now().Unix() {
			if j.deleteLocked(cookie.Name, cookie.Domain, cookie.Path) {
				changed = true
			}
			continue
		}
		replaced := false
		for index := range j.cookies {
			existing := j.cookies[index]
			if existing.Name != cookie.Name || normalizeDomain(existing.Domain) != normalizeDomain(cookie.Domain) || existing.Path != cookie.Path {
				continue
			}
			if existing.Value != cookie.Value || existing.Expires != cookie.Expires || existing.Secure != cookie.Secure || existing.HTTPOnly != cookie.HTTPOnly || existing.SameSite != cookie.SameSite {
				changed = true
			}
			j.cookies[index] = cookie
			replaced = true
			break
		}
		if !replaced {
			j.cookies = append(j.cookies, cookie)
			changed = true
		}
	}
	return changed
}

// UpdateFromResponse merges Set-Cookie values and reports whether it changed.
func (j *Jar) UpdateFromResponse(request *url.URL, response *http.Response) bool {
	if response == nil || request == nil {
		return false
	}
	now := time.Now()
	changed := false
	cookies := make([]Cookie, 0, len(response.Cookies()))
	for _, item := range response.Cookies() {
		domain := item.Domain
		if domain == "" {
			domain = request.Hostname()
		}
		if !isStockbitDomain(domain) {
			continue
		}
		if item.MaxAge < 0 || (!item.Expires.IsZero() && item.Expires.Before(now)) {
			if j.Delete(item.Name, domain, item.Path) {
				changed = true
			}
			continue
		}
		cookie := Cookie{
			Name:     item.Name,
			Value:    item.Value,
			Domain:   domain,
			Path:     item.Path,
			Secure:   item.Secure,
			HTTPOnly: item.HttpOnly,
			SameSite: sameSiteString(item.SameSite),
		}
		if !item.Expires.IsZero() {
			cookie.Expires = item.Expires.Unix()
		}
		cookies = append(cookies, cookie)
	}
	if j.Merge(cookies) {
		changed = true
	}
	return changed
}

// ForURL returns the cookies that must accompany a request to u, deduplicated
// by name with the most specific path winning, as RFC 6265 expects.
func (j *Jar) ForURL(u *url.URL) []*http.Cookie {
	if u == nil {
		return nil
	}
	now := time.Now().Unix()
	host := strings.ToLower(u.Hostname())
	path := u.EscapedPath()
	if path == "" {
		path = "/"
	}
	secure := strings.EqualFold(u.Scheme, "https")

	type chosen struct {
		cookie Cookie
	}
	picked := map[string]chosen{}
	j.mu.RLock()
	for _, cookie := range j.cookies {
		if cookie.Expires > 0 && cookie.Expires <= now {
			continue
		}
		if !cookieDomainMatch(host, cookie.Domain) {
			continue
		}
		if !cookiePathMatch(path, cookie.Path) {
			continue
		}
		if cookie.Secure && !secure {
			continue
		}
		if existing, ok := picked[cookie.Name]; !ok || len(cookie.Path) > len(existing.cookie.Path) {
			picked[cookie.Name] = chosen{cookie: cookie}
		}
	}
	j.mu.RUnlock()
	names := make([]string, 0, len(picked))
	for name := range picked {
		names = append(names, name)
	}
	sort.Strings(names)
	out := make([]*http.Cookie, 0, len(names))
	for _, name := range names {
		cookie := picked[name].cookie
		out = append(out, &http.Cookie{Name: cookie.Name, Value: cookie.Value, Path: cookie.Path, Domain: cookie.Domain, Secure: cookie.Secure, HttpOnly: cookie.HTTPOnly})
	}
	return out
}

// Credential reads and decodes the credentialStorage cookie.
func (j *Jar) Credential() (Credential, bool) {
	j.mu.RLock()
	defer j.mu.RUnlock()
	var best *Cookie
	for index := range j.cookies {
		cookie := &j.cookies[index]
		if cookie.Name != credentialCookie {
			continue
		}
		if best == nil || len(cookie.Path) > len(best.Path) {
			best = cookie
		}
	}
	if best == nil {
		return Credential{}, false
	}
	credential, err := ParseCredentialCookie(best.Value)
	if err != nil || !credential.Access.Present() {
		return Credential{}, false
	}
	return credential, true
}

// SetCredential writes tokens/user back into the credentialStorage cookie, the
// way the Stockbit web client would after a refresh. It reports whether the
// jar changed.
func (j *Jar) SetCredential(credential Credential) bool {
	if !credential.Access.Present() {
		return j.Delete(credentialCookie, "stockbit.com", "/")
	}
	value, err := EncodeCredentialCookie(credential)
	if err != nil {
		return false
	}
	expires := credential.Refresh.ExpiresAt
	if expires <= 0 {
		expires = time.Now().Add(30 * 24 * time.Hour).Unix()
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	before := append([]Cookie(nil), j.cookies...)
	j.setLocked(Cookie{Name: credentialCookie, Value: value, Domain: "stockbit.com", Path: "/", Expires: expires})
	return !sameCookies(before, j.cookies)
}

// ParseCookieInput accepts a Cookie header ("a=b; c=d"), a JSON array of
// cookies, or a JSON object with a cookies field. The panel exposes both the
// header and the JSON route because DevTools offers the header form.
func ParseCookieInput(input string) ([]Cookie, error) {
	text := strings.TrimSpace(input)
	text = strings.TrimSpace(strings.TrimPrefix(text, "Cookie:"))
	if text == "" {
		return nil, ErrInvalidCookie
	}
	if strings.HasPrefix(text, "[") {
		var cookies []Cookie
		if err := json.Unmarshal([]byte(text), &cookies); err != nil {
			return nil, Wrap(CodeInvalidCookie, "the cookie JSON is invalid", err)
		}
		return normalizeParsedCookies(cookies)
	}
	if strings.HasPrefix(text, "{") {
		var wrapper struct {
			Cookies []Cookie `json:"cookies"`
		}
		if err := json.Unmarshal([]byte(text), &wrapper); err == nil && len(wrapper.Cookies) > 0 {
			return normalizeParsedCookies(wrapper.Cookies)
		}
		var single Cookie
		if err := json.Unmarshal([]byte(text), &single); err == nil && single.Name != "" {
			return normalizeParsedCookies([]Cookie{single})
		}
		return nil, Wrap(CodeInvalidCookie, "the cookie JSON has no cookies", nil)
	}
	return ParseCookieHeader(text)
}

// ParseCookieHeader parses the header form copied from DevTools.
func ParseCookieHeader(header string) ([]Cookie, error) {
	text := strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(header), "Cookie:"))
	if text == "" {
		return nil, ErrInvalidCookie
	}
	cookies := make([]Cookie, 0, 8)
	for _, part := range strings.Split(text, ";") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name, value, found := strings.Cut(part, "=")
		name = strings.TrimSpace(name)
		if !found || name == "" {
			continue
		}
		cookies = append(cookies, Cookie{Name: name, Value: strings.TrimSpace(value), Domain: "stockbit.com", Path: "/"})
	}
	if len(cookies) == 0 {
		return nil, Wrap(CodeInvalidCookie, "the Cookie header has no name=value pairs", nil)
	}
	return cookies, nil
}

func normalizeParsedCookies(cookies []Cookie) ([]Cookie, error) {
	if len(cookies) == 0 {
		return nil, Wrap(CodeInvalidCookie, "no cookies were provided", nil)
	}
	for index := range cookies {
		if cookies[index].Name == "" {
			return nil, Wrap(CodeInvalidCookie, "a cookie has no name", nil)
		}
		if cookies[index].Domain == "" {
			cookies[index].Domain = "stockbit.com"
		}
		if cookies[index].Path == "" {
			cookies[index].Path = "/"
		}
	}
	return cookies, nil
}

// FilterStockbit keeps only stockbit.com cookies. Third-party analytics and
// recaptcha cookies from the login window are intentionally discarded.
func FilterStockbit(cookies []Cookie) []Cookie {
	out := make([]Cookie, 0, len(cookies))
	for _, cookie := range cookies {
		domain := cookie.Domain
		if domain == "" {
			domain = "stockbit.com"
		}
		if !isStockbitDomain(domain) {
			continue
		}
		cookie.Domain = normalizeDomain(domain)
		if cookie.Path == "" {
			cookie.Path = "/"
		}
		out = append(out, cookie)
	}
	return out
}

// CredentialFromCookies finds the credentialStorage cookie and parses it.
func CredentialFromCookies(cookies []Cookie) (Credential, error) {
	for _, cookie := range cookies {
		if cookie.Name != credentialCookie || !isStockbitDomain(cookie.Domain) {
			continue
		}
		credential, err := ParseCredentialCookie(cookie.Value)
		if err != nil {
			return Credential{}, err
		}
		if !credential.Access.Present() {
			return Credential{}, ErrNoCredentials
		}
		return credential, nil
	}
	return Credential{}, ErrNoCredentials
}

// ParseCredentialCookie decodes the URL-encoded zustand blob carried by
// credentialStorage. It also accepts a bare access token for manual input.
func ParseCredentialCookie(raw string) (Credential, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return Credential{}, ErrInvalidCookie
	}
	jsonLike := strings.HasPrefix(value, "{") || strings.HasPrefix(value, "%7B") || strings.HasPrefix(value, "%7b")
	if !jsonLike && IsJWT(value) {
		claims, err := DecodeJWT(value)
		if err != nil {
			return Credential{}, err
		}
		return Credential{Access: Token{Value: value, ExpiresAt: claims.Exp}}, nil
	}
	decoded, err := decodeURIComponent(value)
	if err != nil {
		return Credential{}, Wrap(CodeInvalidCookie, "the credential cookie is not URL-encoded JSON", err)
	}
	decoded = strings.TrimSpace(decoded)
	if strings.HasPrefix(decoded, "%7B") || strings.HasPrefix(decoded, "%7b") {
		if twice, err := url.QueryUnescape(decoded); err == nil {
			decoded = strings.TrimSpace(twice)
		}
	}
	var outer struct {
		State   json.RawMessage `json:"state"`
		Version int             `json:"version"`
	}
	if err := json.Unmarshal([]byte(decoded), &outer); err != nil {
		return Credential{}, Wrap(CodeInvalidCookie, "the credential cookie is not JSON", err)
	}
	state := outer.State
	if len(state) == 0 || string(state) == "null" {
		state = json.RawMessage(decoded)
	}
	var credential Credential
	if err := json.Unmarshal(state, &credential); err != nil {
		return Credential{}, Wrap(CodeInvalidCookie, "the credential state has an unexpected shape", err)
	}
	if credential.Access.Value == "" {
		return Credential{}, ErrNoCredentials
	}
	return credential, nil
}

// EncodeCredentialCookie produces the URL-encoded JSON the web client keeps.
func EncodeCredentialCookie(credential Credential) (string, error) {
	user := map[string]any{
		"id":       credential.User.ID,
		"username": credential.User.Username,
		"fullname": credential.User.DisplayName(),
		"email":    credential.User.Email,
		"avatar":   credential.User.Avatar,
		"country":  credential.User.Country,
	}
	if credential.User.WatchlistID > 0 {
		user["watchlist_id"] = credential.User.WatchlistID
	}
	if credential.User.Privilege.Code != "" {
		user["privilege"] = map[string]any{"code": credential.User.Privilege.Code}
	}
	access := map[string]any{"token": credential.Access.Value}
	if credential.Access.ExpiresAt > 0 {
		access["expired_at"] = FormatExpiry(credential.Access.ExpiresAt)
	}
	refresh := map[string]any{"token": credential.Refresh.Value}
	if credential.Refresh.ExpiresAt > 0 {
		refresh["expired_at"] = FormatExpiry(credential.Refresh.ExpiresAt)
	}
	payload := map[string]any{
		"state": map[string]any{
			"user":    user,
			"access":  access,
			"refresh": refresh,
		},
		"version": 0,
	}
	blob, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	return encodeURIComponent(string(blob)), nil
}

func encodeURIComponent(value string) string {
	encoded := url.QueryEscape(value)
	return strings.ReplaceAll(encoded, "+", "%20")
}

func decodeURIComponent(value string) (string, error) {
	decoded, err := url.QueryUnescape(value)
	if err == nil {
		return decoded, nil
	}
	decoded, pathErr := url.PathUnescape(value)
	if pathErr != nil {
		return "", fmt.Errorf("unescape: %w", err)
	}
	return decoded, nil
}

func normalizeDomain(domain string) string {
	return strings.ToLower(strings.TrimSuffix(strings.TrimSpace(domain), "."))
}

func isStockbitDomain(domain string) bool {
	normalized := strings.TrimPrefix(normalizeDomain(domain), ".")
	return normalized == "stockbit.com" || strings.HasSuffix(normalized, ".stockbit.com")
}

func cookieDomainMatch(host, domain string) bool {
	normalizedHost := strings.ToLower(strings.TrimSuffix(host, "."))
	original := normalizeDomain(domain)
	normalizedDomain := strings.TrimPrefix(original, ".")
	if normalizedDomain == "" {
		return false
	}
	if normalizedHost == normalizedDomain {
		return true
	}
	return strings.HasPrefix(original, ".") && strings.HasSuffix(normalizedHost, "."+normalizedDomain)
}

func cookiePathMatch(requestPath, cookiePath string) bool {
	if cookiePath == "" || cookiePath == "/" {
		return true
	}
	if requestPath == cookiePath {
		return true
	}
	if strings.HasPrefix(requestPath, cookiePath) {
		return strings.HasSuffix(cookiePath, "/") || requestPath[len(cookiePath)] == '/'
	}
	return false
}

func sameSiteString(sameSite http.SameSite) string {
	switch sameSite {
	case http.SameSiteStrictMode:
		return "Strict"
	case http.SameSiteLaxMode:
		return "Lax"
	case http.SameSiteNoneMode:
		return "None"
	default:
		return ""
	}
}

func snapshotLocked(cookies []Cookie) []Cookie {
	return append([]Cookie(nil), cookies...)
}

func sameCookies(a, b []Cookie) bool {
	if len(a) != len(b) {
		return false
	}
	for index := range a {
		if a[index] != b[index] {
			return false
		}
	}
	return true
}
