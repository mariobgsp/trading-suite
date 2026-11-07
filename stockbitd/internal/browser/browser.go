package browser

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"stockbitd/internal/config"
	"stockbitd/internal/credentials"
	"stockbitd/internal/session"
)

// Codes: browser_not_found, no_display, unsupported_browser, login_timeout,
// login_cancelled, browser_closed, cdp_error, launch_failed, already_running,
// attempt_not_found, invalid_credentials, login_form_not_found, script_error.
// Capabilities is what the discover step can promise before a window opens.
type Capabilities struct {
	Available bool   `json:"available"`
	Binary    string `json:"binary,omitempty"`
	Version   string `json:"version,omitempty"`
	Display   bool   `json:"display"`
	Headless  bool   `json:"headless"`
	Profile   string `json:"profile"`
	Code      string `json:"code,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// Attempt is the observable login job. The panel polls it; the CLI waits on it.
type Attempt struct {
	ID           string        `json:"id"`
	State        string        `json:"state"`
	Message      string        `json:"message"`
	Error        string        `json:"error,omitempty"`
	ErrorCode    string        `json:"error_code,omitempty"`
	StartedAt    time.Time     `json:"started_at"`
	FinishedAt   *time.Time    `json:"finished_at,omitempty"`
	BrowserOpen  bool          `json:"browser_open"`
	Browser      string        `json:"browser,omitempty"`
	User         *session.User `json:"user,omitempty"`
	Reused       bool          `json:"reused,omitempty"`
	Auto         bool          `json:"auto,omitempty"`
	Username     string        `json:"username,omitempty"`
	Verification bool          `json:"verification,omitempty"`
}

const (
	attemptStarting      = "starting"
	attemptConnecting    = "connecting"
	attemptAwaitingLogin = "awaiting_login"
	attemptConnected     = "connected"
	attemptFailed        = "failed"
	attemptCancelled     = "cancelled"
)

// Manager owns at most one live login window and keeps the last attempts for
// the panel. It depends on session.Manager but never reaches into its fields.
type Manager struct {
	cfg    config.Config
	sess   *session.Manager
	creds  *credentials.Store
	log    *slog.Logger
	now    func() time.Time
	mu     sync.Mutex
	items  map[string]*Attempt
	order  []string
	live   string
	stops  map[string]context.CancelFunc
	caps   Capabilities
	capsAt time.Time
}

// NewManager wires the login manager to the session store.
func NewManager(cfg config.Config, sess *session.Manager, creds *credentials.Store, logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	if creds == nil {
		creds = credentials.NewStore("", "", "")
	}
	return &Manager{
		cfg:   cfg,
		sess:  sess,
		creds: creds,
		log:   logger,
		now:   time.Now,
		items: make(map[string]*Attempt),
		stops: make(map[string]context.CancelFunc),
	}
}

// Capabilities discovers the browser, caching the probe for thirty seconds so
// a two-second status poll does not fork Chrome every time.
func (m *Manager) Capabilities() Capabilities {
	m.mu.Lock()
	if !m.capsAt.IsZero() && m.now().Sub(m.capsAt) < 30*time.Second {
		caps := m.caps
		m.mu.Unlock()
		return caps
	}
	m.mu.Unlock()
	caps := Discover(m.cfg)
	m.mu.Lock()
	m.caps = caps
	m.capsAt = m.now()
	m.mu.Unlock()
	return caps
}

// Discover decides whether this host can open a login window at all.
func Discover(cfg config.Config) Capabilities {
	display := strings.TrimSpace(os.Getenv("DISPLAY")) != "" || strings.TrimSpace(os.Getenv("WAYLAND_DISPLAY")) != ""
	caps := Capabilities{Display: display, Headless: cfg.Headless, Profile: cfg.BrowserProfile}
	if !display && !cfg.Headless {
		caps.Code = session.CodeNoDisplay
		caps.Reason = "no DISPLAY or WAYLAND_DISPLAY; use the token/cookie fallback or run with a graphical session"
		return caps
	}
	binary := ResolveBinary(cfg.Browser)
	if binary == "" {
		caps.Code = session.CodeBrowserNotFound
		caps.Reason = "install Chrome/Chromium, set STOCKBITD_BROWSER, or use the token/cookie fallback"
		return caps
	}
	version := browserVersion(binary)
	if strings.Contains(strings.ToLower(version), "firefox") {
		caps.Code = session.CodeUnsupported
		caps.Reason = "Firefox does not expose the Chrome DevTools pipe; use Chrome, Chromium, Brave or Edge"
		return caps
	}
	caps.Available = true
	caps.Binary = binary
	caps.Version = strings.TrimSpace(version)
	return caps
}

// ResolveBinary finds a Chromium-family browser: explicit path, PATH, then the
// Playwright cache that this workspace already has.
func ResolveBinary(explicit string) string {
	if explicit = strings.TrimSpace(explicit); explicit != "" {
		if isExecutable(explicit) {
			return explicit
		}
		return ""
	}
	for _, name := range []string{
		"google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
		"brave-browser", "brave", "microsoft-edge", "microsoft-edge-stable",
	} {
		if path, err := exec.LookPath(name); err == nil && isExecutable(path) {
			return path
		}
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	patterns := []string{
		filepath.Join(home, ".cache", "ms-playwright", "chrome-linux64", "chrome"),
		filepath.Join(home, ".cache", "ms-playwright", "chrome-*", "chrome-linux*", "chrome"),
		filepath.Join(home, ".cache", "ms-playwright", "chromium-*", "chrome-linux*", "chrome"),
		filepath.Join(home, ".cache", "ms-playwright", "chrome-*", "chrome-mac*", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
		filepath.Join(home, "Library", "Caches", "ms-playwright", "chrome-*", "chrome-mac*", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"),
	}
	var found []string
	for _, pattern := range patterns {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			continue
		}
		found = append(found, matches...)
	}
	sort.Strings(found)
	for _, candidate := range found {
		if isExecutable(candidate) {
			return candidate
		}
	}
	return ""
}

func isExecutable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return false
	}
	return info.Mode()&0o111 != 0
}

func browserVersion(binary string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, binary, "--version").CombinedOutput()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

// Start opens one login attempt, or returns the live one. The caller polls
// Get until the state is terminal. If saved credentials exist and manual is
// false, the worker fills the real Stockbit form instead of waiting for a human
// to type; manual=true opens the plain login page.
func (m *Manager) Start(manual bool) (Attempt, error) {
	status := m.creds.Status()
	auto := !manual && status.Configured
	m.mu.Lock()
	if m.live != "" {
		if current, ok := m.items[m.live]; ok && isActive(current) {
			reused := cloneAttempt(current)
			reused.Reused = true
			m.mu.Unlock()
			return reused, session.WithAttempt(reused.ID)
		}
	}
	m.pruneLocked()
	id := newAttemptID()
	message := "preparing the browser"
	if auto {
		message = "preparing the automatic Stockbit sign-in"
	}
	attempt := &Attempt{
		ID:        id,
		State:     attemptStarting,
		Message:   message,
		StartedAt: m.now(),
		Auto:      auto,
		Username:  status.Username,
	}
	m.items[id] = attempt
	m.order = append(m.order, id)
	m.live = id
	ctx, cancel := context.WithTimeout(context.Background(), m.cfg.LoginTimeout)
	m.stops[id] = cancel
	initial := cloneAttempt(attempt)
	m.mu.Unlock()

	go m.run(ctx, id, auto)
	return initial, nil
}

// ResetProfile cancels the live attempt and removes the dedicated Chromium
// profile, so "Disconnect" does not leave a logged-in browser behind. It only
// removes a profile inside STOCKBITD_HOME; a custom outside path is refused.
func (m *Manager) ResetProfile() error {
	m.mu.Lock()
	if id := m.live; id != "" {
		if stop := m.stops[id]; stop != nil {
			stop()
		}
	}
	m.mu.Unlock()
	return ResetProfile(m.cfg)
}

// ResetProfile is the package form used by the CLI logout command.
func ResetProfile(cfg config.Config) error {
	if strings.TrimSpace(cfg.BrowserProfile) == "" {
		return nil
	}
	if !pathInside(cfg.BrowserProfile, cfg.Home) {
		return session.New(session.CodePermissionDenied, "refusing to remove a browser profile outside STOCKBITD_HOME")
	}
	// Give a cancelled login a moment to close its window; removing a live
	// profile would leave a lock and a half-deleted tree.
	time.Sleep(300 * time.Millisecond)
	return os.RemoveAll(cfg.BrowserProfile)
}

func pathInside(path, root string) bool {
	if strings.TrimSpace(root) == "" {
		return false
	}
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator))
}

// Get returns one attempt copy.
func (m *Manager) Get(id string) (Attempt, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	attempt, ok := m.items[id]
	if !ok {
		return Attempt{}, false
	}
	return cloneAttempt(attempt), true
}

// Cancel stops the live attempt. The browser closes in the worker; the state
// is terminal immediately so the panel does not wait on cleanup.
func (m *Manager) Cancel(id string) (Attempt, bool) {
	m.mu.Lock()
	attempt, ok := m.items[id]
	if !ok {
		m.mu.Unlock()
		return Attempt{}, false
	}
	if isActive(attempt) {
		m.finishLocked(id, attemptCancelled, session.CodeLoginCancelled, "the login was cancelled", nil)
	}
	copy := cloneAttempt(attempt)
	cancel := m.stops[id]
	m.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	return copy, true
}

// Current returns the live attempt, if any.
func (m *Manager) Current() (Attempt, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.live == "" {
		return Attempt{}, false
	}
	attempt, ok := m.items[m.live]
	if !ok {
		return Attempt{}, false
	}
	return cloneAttempt(attempt), true
}

func (m *Manager) run(ctx context.Context, id string, auto bool) {
	var loginCreds credentials.Credentials
	if auto {
		loaded, _, err := m.creds.Load()
		if err != nil {
			m.fail(id, session.CodeOf(err), session.MessageOf(err))
			return
		}
		loginCreds = loaded
	}
	m.set(id, func(attempt *Attempt) {
		attempt.State = attemptConnecting
		attempt.Message = "finding the browser"
	})
	caps := m.Capabilities()
	if !caps.Available {
		m.fail(id, caps.Code, caps.Reason)
		return
	}
	m.set(id, func(attempt *Attempt) {
		attempt.Message = "launching the browser"
		attempt.Browser = caps.Binary
	})
	conn, err := Launch(caps.Binary, m.cfg.BrowserProfile, m.cfg.BrowserLog, m.cfg.LoginURL, m.cfg.Headless)
	if err != nil {
		m.fail(id, session.CodeOf(err), session.MessageOf(err))
		return
	}
	defer conn.Close()
	initialMessage := "log in to Stockbit in the browser window; this panel updates by itself"
	if auto {
		initialMessage = "signing in automatically as " + loginCreds.Username
	}
	m.set(id, func(attempt *Attempt) {
		attempt.BrowserOpen = true
		attempt.State = attemptAwaitingLogin
		attempt.Message = initialMessage
	})
	_, pageSession, err := conn.PickPage(ctx, m.cfg.LoginURL)
	if err != nil {
		m.failFromContext(id, ctx, err)
		return
	}
	lastPick := m.now()
	autoDeadline := m.now().Add(25 * time.Second)
	autoSubmitted := false
	for {
		select {
		case <-ctx.Done():
			m.failFromContext(id, ctx, ctx.Err())
			return
		case <-time.After(time.Second):
		}
		if m.now().Sub(lastPick) > 15*time.Second {
			if _, refreshed, pickErr := conn.PickPage(ctx, m.cfg.LoginURL); pickErr == nil {
				pageSession = refreshed
				lastPick = m.now()
			}
		}
		if auto && !autoSubmitted {
			stateRaw, stateErr := conn.Evaluate(ctx, pageSession, loginStateScript)
			if stateErr != nil {
				if conn.Closed() {
					m.fail(id, session.CodeBrowserClosed, "the browser was closed before login finished")
					return
				}
				if _, refreshed, pickErr := conn.PickPage(ctx, m.cfg.LoginURL); pickErr == nil {
					pageSession = refreshed
					lastPick = m.now()
				}
			} else {
				var state loginPageState
				if err := json.Unmarshal([]byte(stateRaw), &state); err == nil {
					switch {
					case state.Invalid:
						m.fail(id, session.CodeInvalidCredentials, "Stockbit rejected the saved sign-in; update it on the Stockbit screen")
						return
					case state.User && state.Pass:
						result, fillErr := conn.Evaluate(ctx, pageSession, fillLoginScript(loginCreds))
						if fillErr != nil {
							if conn.Closed() {
								m.fail(id, session.CodeBrowserClosed, "the browser was closed before login finished")
								return
							}
							// A form that navigates as it submits destroys the JS
							// context, so the fill result can be lost even though
							// the login is proceeding. Wait for the cookie instead
							// of closing the window.
							autoSubmitted = true
							m.set(id, func(attempt *Attempt) {
								attempt.Message = "Stockbit is checking the sign-in…"
							})
							if _, refreshed, pickErr := conn.PickPage(ctx, m.cfg.LoginURL); pickErr == nil {
								pageSession = refreshed
								lastPick = m.now()
							}
							continue
						}
						switch strings.TrimSpace(result) {
						case "submitted":
							autoSubmitted = true
							m.set(id, func(attempt *Attempt) {
								attempt.Message = "Stockbit is checking the sign-in…"
							})
						case "form_not_ready":
							// The form is still being hydrated; try next tick.
						default:
							m.fail(id, session.CodeLoginFormNotFound, "the Stockbit login form changed; open the window to check it")
							return
						}
					case state.Verification:
						autoSubmitted = true
						m.set(id, func(attempt *Attempt) {
							attempt.Verification = true
							attempt.Message = "Stockbit is asking for verification in the window"
						})
					case m.now().After(autoDeadline):
						m.fail(id, session.CodeLoginFormNotFound, "the Stockbit login form did not appear")
						return
					}
				}
			}
		}
		if auto && autoSubmitted {
			// After the submit, a rejected password or a verification step can
			// appear. Read it so the panel can tell the user what to do, and
			// stop early on a definite rejection.
			if stateRaw, stateErr := conn.Evaluate(ctx, pageSession, loginStateScript); stateErr == nil {
				var state loginPageState
				if json.Unmarshal([]byte(stateRaw), &state) == nil {
					if state.Invalid {
						m.fail(id, session.CodeInvalidCredentials, "Stockbit rejected the saved sign-in; update it on the Stockbit screen")
						return
					}
					if state.Verification {
						m.set(id, func(attempt *Attempt) {
							attempt.Verification = true
							attempt.Message = "Stockbit is asking for verification in the window"
						})
					}
				}
			}
		}
		cookies, cookieErr := conn.Cookies(ctx)
		if cookieErr != nil {
			if conn.Closed() {
				m.fail(id, session.CodeBrowserClosed, "the browser was closed before login finished")
				return
			}
			continue
		}
		raw, evalErr := conn.Evaluate(ctx, pageSession, pageStorageScript)
		if evalErr != nil {
			if conn.Closed() {
				m.fail(id, session.CodeBrowserClosed, "the browser was closed before login finished")
				return
			}
			// A cross-origin login hop can make localStorage unreadable while
			// the credential cookie is already set. Reattach if possible and
			// still harvest from the cookie list below.
			if _, refreshed, pickErr := conn.PickPage(ctx, m.cfg.LoginURL); pickErr == nil {
				pageSession = refreshed
				lastPick = m.now()
			}
		}
		page, _ := ParsePageJSON(raw)
		harvest, harvestErr := Harvest(cookies, page)
		if harvestErr != nil {
			if errors.Is(harvestErr, session.ErrNoCredentials) {
				m.set(id, func(attempt *Attempt) {
					attempt.Message = "waiting for the Stockbit login in the browser window"
				})
				continue
			}
			// A partially written credential cookie is normal during login;
			// wait for the next poll instead of failing the attempt.
			continue
		}
		if adoptErr := m.sess.AdoptHarvest(harvest); adoptErr != nil {
			m.fail(id, session.CodeOf(adoptErr), session.MessageOf(adoptErr))
			return
		}
		user := cloneUser(harvest.User)
		m.set(id, func(attempt *Attempt) {
			attempt.State = attemptConnected
			attempt.Message = "Stockbit is connected"
			attempt.User = user
			attempt.BrowserOpen = false
			attempt.Verification = false
			now := m.now()
			attempt.FinishedAt = &now
			attempt.Error = ""
			attempt.ErrorCode = ""
		})
		m.clearLive(id)
		return
	}
}

func (m *Manager) failFromContext(id string, ctx context.Context, err error) {
	switch {
	case errors.Is(ctx.Err(), context.Canceled) || errors.Is(err, context.Canceled):
		m.finish(id, attemptCancelled, session.CodeLoginCancelled, "the login was cancelled")
	case errors.Is(ctx.Err(), context.DeadlineExceeded) || errors.Is(err, context.DeadlineExceeded):
		m.fail(id, session.CodeLoginTimeout, "the login window timed out")
	default:
		m.fail(id, session.CodeCDPError, session.MessageOf(err))
	}
}

func (m *Manager) fail(id, code, message string) {
	m.finish(id, attemptFailed, code, message)
}

func (m *Manager) finish(id, state, code, message string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.finishLocked(id, state, code, message, nil)
}

func (m *Manager) finishLocked(id, state, code, message string, user *session.User) {
	attempt, ok := m.items[id]
	if !ok || !isActive(attempt) {
		return
	}
	now := m.now()
	attempt.State = state
	attempt.Message = message
	attempt.ErrorCode = code
	attempt.Error = message
	attempt.FinishedAt = &now
	attempt.BrowserOpen = false
	if user != nil {
		attempt.User = user
	}
	if m.live == id {
		m.live = ""
	}
	if stop, ok := m.stops[id]; ok {
		stop()
		delete(m.stops, id)
	}
}

func (m *Manager) set(id string, update func(*Attempt)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	attempt, ok := m.items[id]
	if !ok || !isActive(attempt) {
		return
	}
	update(attempt)
}

func (m *Manager) clearLive(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.live == id {
		m.live = ""
	}
	if stop, ok := m.stops[id]; ok {
		stop()
		delete(m.stops, id)
	}
}

func (m *Manager) pruneLocked() {
	cutoff := m.now().Add(-time.Hour)
	kept := make([]string, 0, len(m.order))
	for _, id := range m.order {
		attempt, ok := m.items[id]
		if !ok {
			continue
		}
		if !isActive(attempt) && attempt.FinishedAt != nil && attempt.FinishedAt.Before(cutoff) {
			delete(m.items, id)
			continue
		}
		kept = append(kept, id)
	}
	if len(kept) > 20 {
		kept = kept[len(kept)-20:]
	}
	allowed := make(map[string]struct{}, len(kept))
	for _, id := range kept {
		allowed[id] = struct{}{}
	}
	for id := range m.items {
		if _, ok := allowed[id]; !ok {
			delete(m.items, id)
		}
	}
	m.order = kept
}

func isActive(attempt *Attempt) bool {
	return attempt != nil && (attempt.State == attemptStarting || attempt.State == attemptConnecting || attempt.State == attemptAwaitingLogin)
}

func cloneAttempt(attempt *Attempt) Attempt {
	copy := *attempt
	copy.User = cloneUserValue(attempt.User)
	if attempt.FinishedAt != nil {
		finished := *attempt.FinishedAt
		copy.FinishedAt = &finished
	}
	return copy
}

func cloneUser(user session.User) *session.User {
	return cloneUserValue(&user)
}

func cloneUserValue(user *session.User) *session.User {
	if user == nil || user.Empty() {
		return nil
	}
	copy := *user
	return &copy
}

func newAttemptID() string {
	buffer := make([]byte, 8)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("a%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buffer)
}

// loginPageState is the small, non-secret view of the login form used to decide
// whether to fill it, whether Stockbit rejected the saved pair, or whether a
// human verification is now needed.
type loginPageState struct {
	User         bool   `json:"user"`
	Pass         bool   `json:"pass"`
	Invalid      bool   `json:"invalid"`
	Verification bool   `json:"verification"`
	Href         string `json:"href"`
}

const loginStateScript = `(function(){
  var text = (document.body.innerText || '').toLowerCase();
  var invalid = text.indexOf('email atau username atau password salah') >= 0
    || text.indexOf('username atau password salah') >= 0
    || text.indexOf('password salah') >= 0
    || text.indexOf('incorrect password') >= 0
    || text.indexOf('invalid password') >= 0
    || text.indexOf('wrong password') >= 0
    || text.indexOf('login gagal') >= 0;
  var verification = text.indexOf('verifikasi') >= 0
    || text.indexOf('kode verifikasi') >= 0
    || text.indexOf('verification code') >= 0
    || text.indexOf('one-time') >= 0
    || text.indexOf('challenge') >= 0;
  return JSON.stringify({ user: !!document.querySelector('#username'), pass: !!document.querySelector('#password'), invalid: invalid, verification: verification, href: location.href });
})()`

// fillLoginScript fills the real Stockbit login form and submits it. It uses the
// native value setter so React sees the change. The values are JSON-escaped and
// travel only over the private DevTools pipe.
func fillLoginScript(creds credentials.Credentials) string {
	username, _ := json.Marshal(creds.Username)
	password, _ := json.Marshal(creds.Password)
	return `(function(){
  var user = document.querySelector('#username');
  var pass = document.querySelector('#password');
  if (!user || !pass) return 'form_not_ready';
  var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  var set = function(el, value) {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set(user, ` + string(username) + `);
  set(pass, ` + string(password) + `);
  var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
  var submit = buttons.filter(function(b){ return b.type === 'submit' && b.textContent.trim() === 'Masuk'; })[0]
    || buttons.filter(function(b){ return b.type === 'submit'; })[0];
  if (!submit) return 'submit_not_found';
  submit.click();
  return 'submitted';
})()`
}

// pageStorageScript reads the legacy keys and document.cookie. It never logs in
// or changes page state.
const pageStorageScript = `(function(){
  var out = {href: location.href, title: document.title};
  try { out.at = localStorage.getItem('at'); } catch (e) {}
  try { out.ar = localStorage.getItem('ar'); } catch (e) {}
  try { out.au = localStorage.getItem('au'); } catch (e) {}
  try { out.cred = document.cookie; } catch (e) {}
  return JSON.stringify(out);
})()`
