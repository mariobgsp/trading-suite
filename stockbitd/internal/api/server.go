package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"stockbitd/internal/browser"
	"stockbitd/internal/credentials"
	"stockbitd/internal/session"
	"stockbitd/internal/stockbit"
	"stockbitd/internal/web"
)

// Codes: session_corrupt, browser_not_found, no_display, already_running,
// attempt_not_found, invalid_token, token_expired, invalid_cookie,
// no_credentials, not_connected, invalid_ticker, reauth_required,
// upstream_error, not_found, method_not_allowed, invalid_request,
// forbidden_origin, credentials_invalid, write_failed.
// Version is the daemon version shown by /api/health.
const Version = "0.1.0"

// Server is the HTTP edge. Handlers validate, call one module, and return a
// typed payload; no Stockbit request is built here.
type Server struct {
	sessions *session.Manager
	login    *browser.Manager
	data     *stockbit.Client
	creds    *credentials.Store
	log      *slog.Logger
	started  time.Time
	version  string
}

// New builds the HTTP edge.
func New(sessions *session.Manager, login *browser.Manager, data *stockbit.Client, creds *credentials.Store, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}
	if creds == nil {
		creds = credentials.NewStore("", "", "")
	}
	return &Server{
		sessions: sessions,
		login:    login,
		data:     data,
		creds:    creds,
		log:      logger,
		started:  time.Now(),
		version:  Version,
	}
}

// Handler wraps the router with panic recovery, access logging and CORS.
func (s *Server) Handler() http.Handler {
	return s.logRequests(s.recoverPanics(s.cors(http.HandlerFunc(s.route))))
}

func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimSuffix(r.URL.Path, "/")
	if path == "" {
		path = "/"
	}
	switch path {
	case "/":
		s.only(w, r, http.MethodGet, s.index)
	case "/api/health":
		s.only(w, r, http.MethodGet, s.health)
	case "/api/status":
		s.only(w, r, http.MethodGet, s.status)
	case "/api/login/browser":
		s.only(w, r, http.MethodPost, s.loginStart)
	case "/api/session/token":
		s.only(w, r, http.MethodPost, s.adoptToken)
	case "/api/session/cookies":
		s.only(w, r, http.MethodPost, s.adoptCookies)
	case "/api/session/refresh":
		s.only(w, r, http.MethodPost, s.refresh)
	case "/api/session/credentials":
		s.only(w, r, http.MethodPost, s.credentialsSave)
	case "/api/session/credentials/clear":
		s.only(w, r, http.MethodPost, s.credentialsClear)
	case "/api/logout":
		s.only(w, r, http.MethodPost, s.logout)
	case "/api/data/watchlist":
		s.only(w, r, http.MethodGet, s.watchlist)
	case "/api/cache":
		s.only(w, r, http.MethodGet, s.cache)
	case "/api/cache/clear":
		s.only(w, r, http.MethodPost, s.cacheClear)
	default:
		switch {
		case strings.HasPrefix(path, "/api/login/browser/"):
			s.routeLogin(w, r, strings.TrimPrefix(path, "/api/login/browser/"))
		case strings.HasPrefix(path, "/api/data/symbol/"):
			s.onlyTicker(w, r, strings.TrimPrefix(path, "/api/data/symbol/"), s.symbol)
		case strings.HasPrefix(path, "/api/data/orderbook/"):
			s.onlyTicker(w, r, strings.TrimPrefix(path, "/api/data/orderbook/"), s.orderbook)
		case strings.HasPrefix(path, "/api/data/brokers/"):
			s.onlyTicker(w, r, strings.TrimPrefix(path, "/api/data/brokers/"), s.brokers)
		default:
			s.writeError(w, session.ErrNotFound)
		}
	}
}

func (s *Server) routeLogin(w http.ResponseWriter, r *http.Request, rest string) {
	if id, ok := strings.CutSuffix(rest, "/cancel"); ok {
		if r.Method != http.MethodPost {
			s.methodNotAllowed(w, http.MethodPost)
			return
		}
		if !s.requireJSON(w, r) {
			return
		}
		s.loginCancel(w, r, id)
		return
	}
	if r.Method != http.MethodGet {
		s.methodNotAllowed(w, http.MethodGet)
		return
	}
	s.loginPoll(w, r, rest)
}

func (s *Server) only(w http.ResponseWriter, r *http.Request, method string, handler func(http.ResponseWriter, *http.Request)) {
	if r.Method != method {
		s.methodNotAllowed(w, method)
		return
	}
	handler(w, r)
}

func (s *Server) onlyTicker(w http.ResponseWriter, r *http.Request, ticker string, handler func(http.ResponseWriter, *http.Request)) {
	if r.Method != http.MethodGet {
		s.methodNotAllowed(w, http.MethodGet)
		return
	}
	r.SetPathValue("ticker", ticker)
	handler(w, r)
}

func (s *Server) index(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = w.Write(web.Index)
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, map[string]any{
		"status":         "ok",
		"version":        s.version,
		"uptime_seconds": int(time.Since(s.started).Seconds()),
	})
}

func (s *Server) status(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, s.statusPayload())
}

// statusPayload is one session view shared by every route that changes the
// session, so the suite always gets the credentials block too.
func (s *Server) statusPayload() map[string]any {
	status := s.sessions.Status()
	payload := map[string]any{
		"state":         status.State,
		"available":     status.Available,
		"user":          status.User,
		"access":        status.Access,
		"refresh":       status.Refresh,
		"cookies":       status.Cookies,
		"session":       status.Session,
		"reauth_reason": status.ReauthReason,
		"warnings":      status.Warnings,
		"browser":       s.login.Capabilities(),
		"credentials":   s.creds.Status(),
		"server": map[string]any{
			"version":        s.version,
			"uptime_seconds": int(time.Since(s.started).Seconds()),
		},
		"cache": s.data.CacheStats(),
	}
	if status.Error != "" {
		payload["error"] = status.Error
		payload["error_code"] = status.ErrorCode
	}
	if attempt, ok := s.login.Current(); ok {
		payload["login"] = attempt
	}
	return payload
}

func (s *Server) loginStart(w http.ResponseWriter, r *http.Request) {
	if !s.requireJSON(w, r) {
		return
	}
	var body struct {
		Manual bool `json:"manual"`
	}
	if !s.decodeBody(w, r, &body) {
		return
	}
	attempt, err := s.login.Start(body.Manual)
	if errors.Is(err, session.ErrAlreadyRunning) {
		s.writeJSON(w, http.StatusConflict, map[string]any{
			"error": map[string]any{
				"code":    session.CodeAlreadyRunning,
				"message": session.MessageOf(err),
			},
			"attempt": attempt,
		})
		return
	}
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.writeJSON(w, http.StatusAccepted, map[string]any{"attempt": attempt})
}

func (s *Server) loginPoll(w http.ResponseWriter, _ *http.Request, id string) {
	attempt, ok := s.login.Get(id)
	if !ok {
		s.writeError(w, session.ErrAttemptNotFound)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"attempt": attempt})
}

func (s *Server) loginCancel(w http.ResponseWriter, _ *http.Request, id string) {
	attempt, ok := s.login.Cancel(id)
	if !ok {
		s.writeError(w, session.ErrAttemptNotFound)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"attempt": attempt})
}

type tokenRequest struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func (s *Server) adoptToken(w http.ResponseWriter, r *http.Request) {
	if !s.requireJSON(w, r) {
		return
	}
	var body tokenRequest
	if !s.decodeBody(w, r, &body) {
		return
	}
	if err := s.sessions.AdoptToken(body.AccessToken, body.RefreshToken); err != nil {
		s.writeError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, s.statusPayload())
}

type cookieRequest struct {
	Cookie       string          `json:"cookie"`
	Cookies      json.RawMessage `json:"cookies"`
	AccessToken  string          `json:"access_token"`
	RefreshToken string          `json:"refresh_token"`
}

func (s *Server) adoptCookies(w http.ResponseWriter, r *http.Request) {
	if !s.requireJSON(w, r) {
		return
	}
	var body cookieRequest
	if !s.decodeBody(w, r, &body) {
		return
	}
	input := strings.TrimSpace(body.Cookie)
	if input == "" && len(body.Cookies) > 0 {
		input = string(body.Cookies)
	}
	if input == "" {
		s.writeError(w, session.New(session.CodeInvalidCookie, "provide cookie or cookies"))
		return
	}
	if err := s.sessions.AdoptCookies(input, body.AccessToken, body.RefreshToken); err != nil {
		s.writeError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, s.statusPayload())
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	if !s.requireJSON(w, r) {
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	if _, err := s.sessions.Refresh(ctx, true); err != nil {
		s.writeError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, s.statusPayload())
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if !s.requireJSON(w, r) {
		return
	}
	if err := s.sessions.Logout(); err != nil {
		s.writeError(w, err)
		return
	}
	if err := s.login.ResetProfile(); err != nil {
		s.log.Warn("could not reset the browser profile", "code", session.CodeOf(err))
	}
	s.writeJSON(w, http.StatusOK, s.statusPayload())
}

type credentialsRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

func (s *Server) credentialsSave(w http.ResponseWriter, r *http.Request) {
	if !s.requireJSON(w, r) {
		return
	}
	var body credentialsRequest
	if !s.decodeBody(w, r, &body) {
		return
	}
	if err := s.creds.Save(body.Username, body.Password); err != nil {
		s.writeError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, s.statusPayload())
}

func (s *Server) credentialsClear(w http.ResponseWriter, r *http.Request) {
	if !s.requireJSON(w, r) {
		return
	}
	if err := s.creds.Clear(); err != nil {
		s.writeError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, s.statusPayload())
}

func (s *Server) symbol(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	snapshot, err := s.data.Snapshot(ctx, r.PathValue("ticker"), queryBool(r, "refresh"))
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, snapshot)
}

func (s *Server) orderbook(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	orderbook, err := s.data.Orderbook(ctx, r.PathValue("ticker"), queryBool(r, "refresh"))
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, orderbook)
}

func (s *Server) brokers(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	brokers, err := s.data.Brokers(ctx, r.PathValue("ticker"), r.URL.Query().Get("date"), queryBool(r, "refresh"))
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, brokers)
}

func (s *Server) watchlist(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()
	watchlist, err := s.data.Watchlist(ctx, queryBool(r, "refresh"))
	if err != nil {
		s.writeError(w, err)
		return
	}
	s.writeJSON(w, http.StatusOK, watchlist)
}

func (s *Server) cache(w http.ResponseWriter, _ *http.Request) {
	s.writeJSON(w, http.StatusOK, s.data.CacheStats())
}

func (s *Server) cacheClear(w http.ResponseWriter, r *http.Request) {
	if !s.requireJSON(w, r) {
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{"cleared": s.data.ClearCache()})
}

func (s *Server) requireJSON(w http.ResponseWriter, r *http.Request) bool {
	contentType := r.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		s.writeError(w, &session.Error{
			Code:    session.CodeInvalidRequest,
			Message: "Content-Type must be application/json",
			Status:  http.StatusUnsupportedMediaType,
		})
		return false
	}
	return true
}

func (s *Server) decodeBody(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		s.writeError(w, session.Wrap(session.CodeInvalidRequest, "the request body is not valid JSON", err))
		return false
	}
	if decoder.More() {
		s.writeError(w, session.New(session.CodeInvalidRequest, "the request body has trailing data"))
		return false
	}
	return true
}

func (s *Server) methodNotAllowed(w http.ResponseWriter, method string) {
	w.Header().Set("Allow", method)
	s.writeError(w, &session.Error{
		Code:    session.CodeMethodNotAllowed,
		Message: "method not allowed; use " + method,
		Status:  http.StatusMethodNotAllowed,
	})
}

func (s *Server) writeError(w http.ResponseWriter, err error) {
	status := session.StatusOf(err)
	if status < 400 {
		status = http.StatusInternalServerError
	}
	retry := session.RetryAfterOf(err)
	if retry > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(retry))
	}
	s.writeJSON(w, status, map[string]any{
		"error": map[string]any{
			"code":        session.CodeOf(err),
			"message":     session.MessageOf(err),
			"retry_after": retry,
		},
	})
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		s.log.Debug("response encode failed", "code", session.CodeOf(err))
	}
}

func queryBool(r *http.Request, key string) bool {
	value := strings.ToLower(strings.TrimSpace(r.URL.Query().Get(key)))
	return value == "1" || value == "true" || value == "yes"
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" {
			if !isLoopbackOrigin(origin) {
				if r.Method == http.MethodOptions || r.Method != http.MethodGet {
					s.writeError(w, session.ErrForbiddenOrigin)
					return
				}
			} else {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Access-Control-Max-Age", "600")
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isLoopbackOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return false
	}
	host := parsed.Hostname()
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

func (s *Server) recoverPanics(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.log.Error("panic serving request", "path", r.URL.Path)
				s.writeError(w, &session.Error{Code: session.CodeInternal, Message: "internal error", Status: http.StatusInternalServerError})
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		s.log.Info("http", "method", r.Method, "path", r.URL.Path, "status", recorder.status, "ms", time.Since(started).Milliseconds())
	})
}
