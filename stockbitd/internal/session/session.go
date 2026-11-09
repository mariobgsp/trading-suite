package session

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

// Codes owned by this file: session_corrupt, not_connected, reauth_required,
// rate_limited, challenge_required, upstream_error, upstream_timeout,
// invalid_response, invalid_token, token_expired, invalid_cookie,
// write_failed, no_credentials.
// StateVersion is bumped when the session file shape changes incompatibly.
const StateVersion = 1

const defaultUserAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"

const defaultOrigin = "https://stockbit.com"

// User is the public account projection. No token or password lives here.
type User struct {
	ID          int64     `json:"id,omitempty"`
	Username    string    `json:"username,omitempty"`
	Fullname    string    `json:"fullname,omitempty"`
	Name        string    `json:"name,omitempty"`
	Email       string    `json:"email,omitempty"`
	Avatar      string    `json:"avatar,omitempty"`
	Country     string    `json:"country,omitempty"`
	WatchlistID int64     `json:"watchlist_id,omitempty"`
	Privilege   Privilege `json:"privilege,omitempty"`
}

// Privilege accepts Stockbit's object form ({"code":"gold"}) and the string
// form an older build wrote. It survives both without failing the whole user.
type Privilege struct {
	Code string `json:"code,omitempty"`
}

func (p Privilege) MarshalJSON() ([]byte, error) { return json.Marshal(p.Code) }

func (p *Privilege) UnmarshalJSON(data []byte) error {
	text := strings.TrimSpace(string(data))
	if text == "" || text == "null" {
		return nil
	}
	if strings.HasPrefix(text, "\"") {
		var code string
		if err := json.Unmarshal(data, &code); err != nil {
			return err
		}
		p.Code = code
		return nil
	}
	var object struct {
		Code string `json:"code"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(data, &object); err != nil {
		return err
	}
	if object.Code != "" {
		p.Code = object.Code
	} else {
		p.Code = object.Name
	}
	return nil
}

// DisplayName is what the panel puts next to the status dot.
func (u User) DisplayName() string {
	if u.Fullname != "" {
		return u.Fullname
	}
	if u.Name != "" {
		return u.Name
	}
	return u.Username
}

// Empty reports whether the account projection is still unknown.
func (u User) Empty() bool {
	return u.ID == 0 && u.Username == "" && u.Fullname == "" && u.Name == "" && u.Email == ""
}

// Merge fills gaps without overwriting a known value.
func (u User) Merge(other User) User {
	if other.ID != 0 {
		u.ID = other.ID
	}
	if other.Username != "" {
		u.Username = other.Username
	}
	if other.Fullname != "" {
		u.Fullname = other.Fullname
	}
	if other.Name != "" {
		u.Name = other.Name
	}
	if other.Email != "" {
		u.Email = other.Email
	}
	if other.Avatar != "" {
		u.Avatar = other.Avatar
	}
	if other.Country != "" {
		u.Country = other.Country
	}
	if other.WatchlistID != 0 {
		u.WatchlistID = other.WatchlistID
	}
	if other.Privilege.Code != "" {
		u.Privilege = other.Privilege
	}
	return u
}

// State is the one record persisted to disk. Times are unix seconds so the
// file compares cleanly and survives a timezone change.
type State struct {
	Version       int      `json:"version"`
	Access        Token    `json:"access"`
	Refresh       Token    `json:"refresh"`
	User          User     `json:"user"`
	Cookies       []Cookie `json:"cookies,omitempty"`
	Source        string   `json:"source,omitempty"`
	CreatedAt     int64    `json:"created_at,omitempty"`
	UpdatedAt     int64    `json:"updated_at,omitempty"`
	LastRefreshAt int64    `json:"last_refresh_at,omitempty"`
	Generation    int64    `json:"generation,omitempty"`
	ReauthReason  string   `json:"reauth_reason,omitempty"`
}

// HasCredentials reports whether either token is present.
func (s *State) HasCredentials() bool {
	return s != nil && (s.Access.Present() || s.Refresh.Present())
}

// Clone deep-copies the record so callers can read it without holding a lock.
func (s *State) Clone() *State {
	if s == nil {
		return nil
	}
	out := *s
	out.Cookies = append([]Cookie(nil), s.Cookies...)
	return &out
}

// Harvest is what the browser login hands back: tokens, account, cookies.
type Harvest struct {
	AccessToken  string
	RefreshToken string
	User         User
	Cookies      []Cookie
	Source       string
}

// TokenStatus is the safe, non-secret view of one token.
type TokenStatus struct {
	Present          bool   `json:"present"`
	ExpiresAt        string `json:"expires_at,omitempty"`
	ExpiresInSeconds int64  `json:"expires_in_seconds,omitempty"`
	Expired          bool   `json:"expired"`
}

// CookieStatus is a count, never a value.
type CookieStatus struct {
	Count     int      `json:"count"`
	Domains   []string `json:"domains"`
	UpdatedAt string   `json:"updated_at,omitempty"`
}

// SessionStatus is the provenance and maintenance history of the file.
type SessionStatus struct {
	Path          string `json:"path"`
	Source        string `json:"source,omitempty"`
	CreatedAt     string `json:"created_at,omitempty"`
	UpdatedAt     string `json:"updated_at,omitempty"`
	LastRefreshAt string `json:"last_refresh_at,omitempty"`
	Generation    int64  `json:"generation,omitempty"`
}

// Status is the panel/API view. It never contains a token or cookie value.
type Status struct {
	State        string        `json:"state"`
	Available    bool          `json:"available"`
	User         *User         `json:"user,omitempty"`
	Access       TokenStatus   `json:"access"`
	Refresh      TokenStatus   `json:"refresh"`
	Cookies      CookieStatus  `json:"cookies"`
	Session      SessionStatus `json:"session"`
	ReauthReason string        `json:"reauth_reason,omitempty"`
	Error        string        `json:"error,omitempty"`
	ErrorCode    string        `json:"error_code,omitempty"`
	Warnings     []string      `json:"warnings"`
}

// Options are the injectable edges of Manager. Tests use a fake clock and
// httptest URLs; production uses the defaults.
type Options struct {
	HTTPClient    *http.Client
	Now           func() time.Time
	Logger        *slog.Logger
	RefreshURLs   []string
	RefreshWindow time.Duration
	KeepAlive     time.Duration
	UserAgent     string
	Origin        string
}

// Manager owns the session record, the live cookie jar, refresh single-flight
// and the keepalive decision. One instance is shared by the API and CLI.
type Manager struct {
	store       *Store
	http        *http.Client
	now         func() time.Time
	log         *slog.Logger
	refreshURLs []string
	refreshWin  time.Duration
	keepAlive   time.Duration
	userAgent   string
	origin      string

	mu         sync.RWMutex
	state      *State
	jar        *Jar
	fileMod    time.Time
	loadErr    error
	generation int64

	refreshMu     sync.Mutex
	nextKeepAlive time.Time
}

// NewManager builds a manager around a store. It does not touch the network or disk.
func NewManager(store *Store, opts Options) *Manager {
	httpClient := opts.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	now := opts.Now
	if now == nil {
		now = time.Now
	}
	logger := opts.Logger
	if logger == nil {
		logger = slog.Default()
	}
	refreshWindow := opts.RefreshWindow
	if refreshWindow <= 0 {
		refreshWindow = 10 * time.Minute
	}
	keepAlive := opts.KeepAlive
	if keepAlive <= 0 {
		keepAlive = 5 * time.Minute
	}
	userAgent := opts.UserAgent
	if userAgent == "" {
		userAgent = defaultUserAgent
	}
	origin := opts.Origin
	if origin == "" {
		origin = defaultOrigin
	}
	return &Manager{
		store:       store,
		http:        httpClient,
		now:         now,
		log:         logger,
		refreshURLs: append([]string(nil), opts.RefreshURLs...),
		refreshWin:  refreshWindow,
		keepAlive:   keepAlive,
		userAgent:   userAgent,
		origin:      origin,
		state:       newState(),
		jar:         NewJar(nil),
	}
}

func newState() *State {
	return &State{Version: StateVersion}
}

// SessionPath is the persisted location, for the status surface.
func (m *Manager) SessionPath() string { return m.store.Path() }

// Load reads the file once at startup. A missing file is a normal empty state;
// a corrupt file is an error the status surface must show.
func (m *Manager) Load() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	state, err := m.store.Load()
	if errors.Is(err, ErrSessionMissing) {
		m.state = newState()
		m.jar = NewJar(nil)
		m.fileMod = time.Time{}
		m.loadErr = nil
		return nil
	}
	if err != nil {
		m.loadErr = err
		return err
	}
	m.state = state
	m.jar = NewJar(state.Cookies)
	m.fileMod = m.store.ModTime()
	m.loadErr = nil
	return nil
}

// reloadFromDiskLocked picks up a CLI login or logout while the server runs.
// The caller holds mu.
func (m *Manager) reloadFromDiskLocked() {
	mod := m.store.ModTime()
	if mod.IsZero() {
		if m.state != nil && m.state.HasCredentials() {
			m.state = newState()
			m.jar = NewJar(nil)
			m.fileMod = time.Time{}
		}
		m.loadErr = nil
		return
	}
	if !m.fileMod.IsZero() && !mod.After(m.fileMod) {
		return
	}
	state, err := m.store.Load()
	if err != nil {
		m.loadErr = err
		return
	}
	m.state = state
	m.jar = NewJar(state.Cookies)
	m.fileMod = mod
	m.loadErr = nil
}

// Status is a pure view of the current session, safe for the panel.
func (m *Manager) Status() Status {
	m.mu.Lock()
	m.reloadFromDiskLocked()
	state := m.state.Clone()
	loadErr := m.loadErr
	jar := m.jar
	cookieCount := 0
	var domains []string
	if jar != nil {
		cookieCount = jar.Len()
		domains = jar.Domains()
	}
	m.mu.Unlock()
	status := buildStatus(state, loadErr, m.now())
	status.Session.Path = m.store.Path()
	status.Cookies.Count = cookieCount
	status.Cookies.Domains = domains
	if len(domains) == 0 {
		status.Cookies.Domains = []string{}
	}
	if state != nil {
		status.Cookies.UpdatedAt = formatUnix(state.UpdatedAt)
	}
	if status.Warnings == nil {
		status.Warnings = []string{}
	}
	return status
}

func buildStatus(state *State, loadErr error, now time.Time) Status {
	status := Status{State: "unconfigured", Warnings: []string{}}
	if loadErr != nil {
		status.State = "error"
		status.Error = MessageOf(loadErr)
		status.ErrorCode = CodeOf(loadErr)
		return status
	}
	if state == nil || !state.HasCredentials() {
		return status
	}
	status.Session.Source = state.Source
	status.Session.CreatedAt = formatUnix(state.CreatedAt)
	status.Session.UpdatedAt = formatUnix(state.UpdatedAt)
	status.Session.LastRefreshAt = formatUnix(state.LastRefreshAt)
	status.Session.Generation = state.Generation
	if !state.User.Empty() {
		user := state.User
		status.User = &user
	}
	status.Access = tokenStatus(state.Access, now)
	status.Refresh = tokenStatus(state.Refresh, now)
	status.ReauthReason = state.ReauthReason

	nowUnix := now.Unix()
	refreshValid := state.Refresh.Present() && (state.Refresh.ExpiresAt == 0 || nowUnix < state.Refresh.ExpiresAt)
	accessValid := state.Access.Present() && (state.Access.ExpiresAt == 0 || nowUnix < state.Access.ExpiresAt)

	switch {
	case state.ReauthReason != "":
		status.State = "reauth_required"
		status.Warnings = append(status.Warnings, state.ReauthReason)
	case accessValid:
		status.State = "connected"
		status.Available = true
	case refreshValid:
		// The access token has lapsed; the refresh token keeps the session
		// alive. Ensure() refreshes before the next request.
		status.State = "connected"
		status.Available = true
		status.Warnings = append(status.Warnings, "access token expired; the next request refreshes it")
	default:
		status.State = "reauth_required"
		status.Warnings = append(status.Warnings, "refresh token expired; log in again")
	}
	if !state.Refresh.Present() {
		status.Warnings = append(status.Warnings, "no refresh token; this session cannot be maintained automatically")
	} else if state.Refresh.ExpiresAt > 0 {
		left := state.Refresh.ExpiresAt - nowUnix
		if left > 0 && left < 3*86400 {
			status.Warnings = append(status.Warnings, fmt.Sprintf("refresh token expires in %d hours", left/3600))
		}
	}
	return status
}

func tokenStatus(token Token, now time.Time) TokenStatus {
	out := TokenStatus{Present: token.Present()}
	if !token.Present() {
		return out
	}
	if token.ExpiresAt > 0 {
		out.ExpiresAt = formatUnix(token.ExpiresAt)
		left := token.ExpiresAt - now.Unix()
		if left < 0 {
			left = 0
		}
		out.ExpiresInSeconds = left
		out.Expired = now.Unix() >= token.ExpiresAt
	}
	return out
}

// Ensure returns a usable access token, refreshing first when it has lapsed.
func (m *Manager) Ensure(ctx context.Context) (string, error) {
	m.mu.Lock()
	m.reloadFromDiskLocked()
	state := m.state.Clone()
	loadErr := m.loadErr
	m.mu.Unlock()
	if loadErr != nil {
		return "", loadErr
	}
	if state == nil || !state.HasCredentials() {
		return "", ErrNotConnected
	}
	if state.ReauthReason != "" {
		return "", reauthError(state.ReauthReason)
	}
	now := m.now()
	if state.Access.Present() && !state.Access.Expired(now, 2*time.Minute) {
		return state.Access.Value, nil
	}
	if !state.Refresh.Present() {
		if state.Access.Present() {
			return "", reauthError("access token expired; log in again")
		}
		return "", ErrNotConnected
	}
	if state.Refresh.ExpiresAt > 0 && now.Unix() >= state.Refresh.ExpiresAt {
		return "", reauthError("refresh token expired")
	}
	if _, err := m.Refresh(ctx, false); err != nil {
		return "", err
	}
	m.mu.Lock()
	current := m.state.Clone()
	m.mu.Unlock()
	if current == nil || !current.Access.Present() {
		return "", ErrReauthRequired
	}
	return current.Access.Value, nil
}

// RequestJSON performs one authenticated Stockbit call. A 401 buys exactly one
// refresh and one retry; a second 401 marks the session as needing a login.
func (m *Manager) RequestJSON(ctx context.Context, method, rawURL string, query url.Values, payload any) (map[string]any, error) {
	target, err := buildURL(rawURL, query)
	if err != nil {
		return nil, err
	}
	access, err := m.Ensure(ctx)
	if err != nil {
		return nil, err
	}
	result, err := m.doOnce(ctx, method, target, access, payload)
	if err == nil {
		return result, nil
	}
	if !errors.Is(err, errUnauthorized) {
		return nil, err
	}
	if _, refreshErr := m.Refresh(ctx, true); refreshErr != nil {
		return nil, refreshErr
	}
	m.mu.Lock()
	current := ""
	if m.state != nil {
		current = m.state.Access.Value
	}
	m.mu.Unlock()
	if current == "" || current == access {
		m.markReauth("access token rejected after refresh")
		return nil, ErrReauthRequired
	}
	result, retryErr := m.doOnce(ctx, method, target, current, payload)
	if retryErr != nil && errors.Is(retryErr, ErrReauthRequired) {
		m.markReauth("access token rejected after refresh")
	}
	return result, retryErr
}

// doOnce is the HTTP edge. It owns cookies, headers, status mapping and the
// bounded body read; it never logs a token, a cookie or a full body.
func (m *Manager) doOnce(ctx context.Context, method string, target *url.URL, access string, payload any) (map[string]any, error) {
	var body io.Reader
	if payload != nil {
		blob, err := json.Marshal(payload)
		if err != nil {
			return nil, Wrap(CodeInternal, "cannot encode the request body", err)
		}
		body = bytes.NewReader(blob)
	}
	request, err := http.NewRequestWithContext(ctx, method, target.String(), body)
	if err != nil {
		return nil, Wrap(CodeInternal, "cannot build the Stockbit request", err)
	}
	request.Header.Set("Authorization", "Bearer "+access)
	request.Header.Set("Origin", m.origin)
	request.Header.Set("Referer", m.origin+"/")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Accept-Language", "en-GB,en-US;q=0.9,en;q=0.8,id;q=0.7")
	request.Header.Set("User-Agent", m.userAgent)
	if payload != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	m.mu.RLock()
	jar := m.jar
	m.mu.RUnlock()
	if jar != nil {
		for _, cookie := range jar.ForURL(target) {
			request.AddCookie(cookie)
		}
	}
	response, err := m.http.Do(request)
	if err != nil {
		if ctx.Err() != nil || errors.Is(err, context.DeadlineExceeded) {
			return nil, Wrap(CodeUpstreamTimeout, "Stockbit request timed out", err)
		}
		return nil, Wrap(CodeUpstream, "Stockbit is unreachable", err)
	}
	defer response.Body.Close()
	if jar != nil && jar.UpdateFromResponse(target, response) {
		m.persistJar(jar)
	}
	switch {
	case response.StatusCode == http.StatusUnauthorized:
		return nil, Wrap(CodeReauthRequired, "Stockbit rejected the access token", errUnauthorized)
	case response.StatusCode == http.StatusTooManyRequests:
		return nil, WithRetry(retryAfter(response.Header.Get("Retry-After")), "Stockbit rate limit reached")
	case response.StatusCode == http.StatusForbidden:
		preview := readPreview(response.Body, 4096)
		lower := strings.ToLower(preview)
		if strings.Contains(lower, "cf-mitigated") || strings.Contains(lower, "challenge") || strings.Contains(lower, "captcha") {
			return nil, ErrChallenge
		}
		return nil, Wrap(CodeUpstream, "Stockbit refused the request", fmt.Errorf("status %d", response.StatusCode))
	case response.StatusCode >= 500:
		preview := readPreview(response.Body, 4096)
		message := extractErrorMessage(preview)
		if message == "" {
			message = "Stockbit upstream failed"
		}
		return nil, Wrap(CodeUpstream, message, fmt.Errorf("status %d", response.StatusCode))
	case response.StatusCode >= 400:
		preview := readPreview(response.Body, 4096)
		message := extractErrorMessage(preview)
		if message == "" {
			message = fmt.Sprintf("Stockbit returned HTTP %d", response.StatusCode)
		}
		return nil, Wrap(CodeUpstream, message, fmt.Errorf("status %d", response.StatusCode))
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return nil, Wrap(CodeInvalidResponse, "cannot read the Stockbit response", err)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return map[string]any{}, nil
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		return nil, Wrap(CodeInvalidResponse, "Stockbit returned a non-JSON body", err)
	}
	return out, nil
}

// persistJar writes Set-Cookie changes back to disk. If the response carried a
// rotated credentialStorage cookie, its tokens become the state's tokens.
func (m *Manager) persistJar(jar *Jar) {
	if jar == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == nil || jar != m.jar {
		return
	}
	cookies := jar.All()
	if sameCookiesSorted(m.state.Cookies, cookies) {
		return
	}
	m.state.Cookies = cookies
	if credential, ok := jar.Credential(); ok && credential.Access.Present() {
		m.state.Access = credential.Access
		if credential.Refresh.Present() {
			m.state.Refresh = credential.Refresh
		}
		if !credential.User.Empty() {
			m.state.User = m.state.User.Merge(credential.User)
		}
	}
	m.state.UpdatedAt = m.now().Unix()
	if err := m.store.Save(m.state); err != nil {
		m.log.Warn("session save failed", "code", CodeOf(err))
		return
	}
	m.fileMod = m.store.ModTime()
}

// update is the single write path for session mutations. The caller supplies
// only the change; update owns timestamps, generation, the credential cookie
// and the atomic save.
func (m *Manager) update(fn func(*State) error) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.reloadFromDiskLocked()
	if m.jar == nil {
		m.jar = NewJar(nil)
	}
	state := m.state.Clone()
	if state == nil {
		state = newState()
	}
	if err := fn(state); err != nil {
		return err
	}
	now := m.now().Unix()
	state.UpdatedAt = now
	if state.CreatedAt == 0 {
		state.CreatedAt = now
	}
	m.jar.Merge(state.Cookies)
	if state.Access.Present() {
		m.jar.SetCredential(Credential{Access: state.Access, Refresh: state.Refresh, User: state.User})
	} else {
		m.jar.Delete(credentialCookie, "stockbit.com", "/")
	}
	state.Cookies = m.jar.All()
	generation := m.generation + 1
	state.Generation = generation
	if err := m.store.Save(state); err != nil {
		return err
	}
	m.state = state
	m.generation = generation
	m.fileMod = m.store.ModTime()
	m.loadErr = nil
	return nil
}

// AdoptToken stores a pasted access token (and optional refresh token).
func (m *Manager) AdoptToken(access, refresh string) error {
	access = cleanToken(access)
	refresh = cleanToken(refresh)
	if access == "" {
		return ErrInvalidToken
	}
	if !IsJWT(access) {
		return Wrap(CodeInvalidToken, "the access token is not a JWT", nil)
	}
	claims, err := DecodeJWT(access)
	if err != nil {
		return err
	}
	now := m.now()
	accessToken := Token{Value: access, ExpiresAt: claims.Exp}
	if accessToken.ExpiresAt > 0 && accessToken.ExpiresAt <= now.Unix() && refresh == "" {
		return ErrTokenExpired
	}
	return m.update(func(state *State) error {
		state.Access = accessToken
		if refresh != "" {
			state.Refresh = Token{Value: refresh}
		}
		if state.User.Empty() {
			state.User = claimsUser(claims)
		} else {
			state.User = state.User.Merge(claimsUser(claims))
		}
		state.Source = "token"
		state.ReauthReason = ""
		return nil
	})
}

// AdoptCookies stores a Cookie header or JSON cookie list. If the list carries
// credentialStorage, its tokens are adopted without a separate token argument.
func (m *Manager) AdoptCookies(input, access, refresh string) error {
	cookies, err := ParseCookieInput(input)
	if err != nil {
		return err
	}
	cookies = FilterStockbit(cookies)
	if len(cookies) == 0 {
		return Wrap(CodeInvalidCookie, "none of the cookies belong to stockbit.com", nil)
	}
	credential, credentialErr := CredentialFromCookies(cookies)
	access = cleanToken(access)
	refresh = cleanToken(refresh)
	if access == "" && credentialErr == nil {
		access = credential.Access.Value
		if refresh == "" {
			refresh = credential.Refresh.Value
		}
	}
	if access == "" {
		m.mu.RLock()
		existing := m.state.Clone()
		m.mu.RUnlock()
		if existing == nil || !existing.HasCredentials() {
			return ErrNoCredentials
		}
		// Cookies alone can still refresh an existing session; keep tokens.
		return m.update(func(state *State) error {
			state.Cookies = append(state.Cookies, cookies...)
			state.Source = "cookies"
			return nil
		})
	}
	if !IsJWT(access) {
		return Wrap(CodeInvalidToken, "the access token in the cookies is not a JWT", nil)
	}
	claims, err := DecodeJWT(access)
	if err != nil {
		return err
	}
	return m.update(func(state *State) error {
		state.Cookies = append(state.Cookies, cookies...)
		state.Access = Token{Value: access, ExpiresAt: claims.Exp}
		if refresh != "" {
			state.Refresh = Token{Value: refresh}
		}
		if credentialErr == nil && !credential.User.Empty() {
			state.User = state.User.Merge(credential.User)
		} else if state.User.Empty() {
			state.User = claimsUser(claims)
		} else {
			state.User = state.User.Merge(claimsUser(claims))
		}
		state.Source = "cookies"
		state.ReauthReason = ""
		return nil
	})
}

// AdoptHarvest stores what the browser login captured and resets the reauth
// state, so the keeper resumes on the next tick.
func (m *Manager) AdoptHarvest(harvest Harvest) error {
	access := cleanToken(harvest.AccessToken)
	refresh := cleanToken(harvest.RefreshToken)
	if access == "" {
		return ErrNoCredentials
	}
	if !IsJWT(access) {
		return Wrap(CodeInvalidToken, "the harvested access token is not a JWT", nil)
	}
	claims, err := DecodeJWT(access)
	if err != nil {
		return err
	}
	source := harvest.Source
	if source == "" {
		source = "browser"
	}
	cookies := FilterStockbit(harvest.Cookies)
	return m.update(func(state *State) error {
		state.Access = Token{Value: access, ExpiresAt: claims.Exp}
		if refresh != "" {
			state.Refresh = Token{Value: refresh}
		}
		if !harvest.User.Empty() {
			state.User = state.User.Merge(harvest.User)
		} else if state.User.Empty() {
			state.User = claimsUser(claims)
		}
		state.Cookies = append(state.Cookies, cookies...)
		state.Source = source
		state.ReauthReason = ""
		return nil
	})
}

// Logout removes the file and resets memory. It cannot fail because the file
// was already gone.
func (m *Manager) Logout() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if err := m.store.Remove(); err != nil {
		return err
	}
	m.state = newState()
	m.jar = NewJar(nil)
	m.fileMod = time.Time{}
	m.loadErr = nil
	m.generation++
	m.nextKeepAlive = time.Time{}
	return nil
}

// KeepAlive refreshes before expiry while the daemon runs, so the cookie jar
// does not go cold between nightly sessions.
func (m *Manager) KeepAlive(ctx context.Context) {
	if m.keepAlive <= 0 {
		return
	}
	ticker := time.NewTicker(m.keepAlive)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := m.MaybeRefresh(ctx); err != nil {
				m.log.Debug("keepalive skipped", "code", CodeOf(err))
			}
		}
	}
}

// MaybeRefresh is one keeper decision, exported for tests and the manual path.
func (m *Manager) MaybeRefresh(ctx context.Context) error {
	m.mu.Lock()
	m.reloadFromDiskLocked()
	state := m.state.Clone()
	loadErr := m.loadErr
	m.mu.Unlock()
	if loadErr != nil {
		return loadErr
	}
	if state == nil || !state.HasCredentials() || state.ReauthReason != "" {
		return nil
	}
	now := m.now()
	if !m.nextKeepAlive.IsZero() && now.Before(m.nextKeepAlive) {
		return nil
	}
	refreshValid := state.Refresh.Present() && (state.Refresh.ExpiresAt == 0 || now.Unix() < state.Refresh.ExpiresAt)
	if !refreshValid {
		return nil
	}
	if state.Access.Present() && !state.Access.Expired(now, m.refreshWin) {
		return nil
	}
	if _, err := m.Refresh(ctx, false); err != nil {
		if errors.Is(err, ErrReauthRequired) {
			return err
		}
		// Transient upstream trouble: try again in five minutes, not on the
		// next tick, so an outage does not become a request storm.
		m.nextKeepAlive = now.Add(5 * time.Minute)
		return err
	}
	m.nextKeepAlive = time.Time{}
	return nil
}

// Generation changes on every adopt/logout, for callers that cache status.
func (m *Manager) Generation() int64 {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.generation
}

func reauthError(reason string) *Error {
	if reason == "" {
		reason = "log in to Stockbit again"
	}
	return &Error{Code: CodeReauthRequired, Message: reason, Status: 401}
}

func claimsUser(claims Claims) User {
	user := User{ID: claims.UserID, Username: claims.Username, Fullname: claims.Name, Email: claims.Email}
	return user
}

func cleanToken(raw string) string {
	value := strings.TrimSpace(raw)
	value = strings.TrimPrefix(value, "Bearer ")
	value = strings.TrimSpace(value)
	value = strings.Trim(value, "\"'")
	return value
}

func buildURL(raw string, query url.Values) (*url.URL, error) {
	target, err := url.Parse(raw)
	if err != nil {
		return nil, Wrap(CodeInternal, "invalid Stockbit URL", err)
	}
	if query != nil {
		params := target.Query()
		for key, values := range query {
			for _, value := range values {
				params.Add(key, value)
			}
		}
		target.RawQuery = params.Encode()
	}
	return target, nil
}

func readPreview(reader io.Reader, limit int64) string {
	if reader == nil {
		return ""
	}
	data, err := io.ReadAll(io.LimitReader(reader, limit))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func extractErrorMessage(preview string) string {
	if preview == "" {
		return ""
	}
	var body map[string]any
	if err := json.Unmarshal([]byte(preview), &body); err == nil {
		for _, key := range []string{"message", "error", "detail", "error_type"} {
			if value, ok := body[key].(string); ok && strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		}
	}
	text := strings.Join(strings.Fields(preview), " ")
	if len(text) > 180 {
		text = text[:180] + "..."
	}
	return text
}

func retryAfter(header string) int {
	header = strings.TrimSpace(header)
	if header == "" {
		return 0
	}
	var seconds int
	if _, err := fmt.Sscanf(header, "%d", &seconds); err == nil && seconds >= 0 {
		return seconds
	}
	if when, err := http.ParseTime(header); err == nil {
		delta := int(time.Until(when).Seconds())
		if delta > 0 {
			return delta
		}
	}
	return 0
}

func formatUnix(seconds int64) string {
	if seconds <= 0 {
		return ""
	}
	return time.Unix(seconds, 0).UTC().Format(time.RFC3339)
}

func sameCookiesSorted(a, b []Cookie) bool {
	left := append([]Cookie(nil), a...)
	right := append([]Cookie(nil), b...)
	sort.Slice(left, func(i, j int) bool { return cookieLess(left[i], left[j]) })
	sort.Slice(right, func(i, j int) bool { return cookieLess(right[i], right[j]) })
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func cookieLess(a, b Cookie) bool {
	if a.Domain != b.Domain {
		return a.Domain < b.Domain
	}
	if a.Path != b.Path {
		return a.Path < b.Path
	}
	return a.Name < b.Name
}

// errUnauthorized marks the specific 401 path so RequestJSON can refresh once
// without treating a not_connected error as an upstream 401.
var errUnauthorized = errors.New("stockbit: http 401")
