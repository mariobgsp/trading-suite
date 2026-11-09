package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Codes: reauth_required, rate_limited, upstream_error, upstream_timeout,
// invalid_response.
// Refresh exchanges the refresh token for a new access token. It is
// single-flight: concurrent callers wait for one rotation, then observe the
// new access token. force skips the "still fresh" shortcut (used after a 401).
func (m *Manager) Refresh(ctx context.Context, force bool) (Status, error) {
	m.refreshMu.Lock()
	defer m.refreshMu.Unlock()

	m.mu.Lock()
	m.reloadFromDiskLocked()
	state := m.state.Clone()
	loadErr := m.loadErr
	m.mu.Unlock()
	if loadErr != nil {
		return m.Status(), loadErr
	}
	if state == nil || !state.HasCredentials() {
		return m.Status(), ErrNotConnected
	}
	now := m.now()
	if !force && state.Access.Present() && !state.Access.Expired(now, m.refreshWin) {
		return m.Status(), nil
	}
	if !state.Refresh.Present() {
		m.markReauth("no refresh token")
		return m.Status(), ErrReauthRequired
	}
	if state.Refresh.ExpiresAt > 0 && now.Unix() >= state.Refresh.ExpiresAt {
		m.markReauth("refresh token expired")
		return m.Status(), ErrReauthRequired
	}
	if len(m.refreshURLs) == 0 {
		return m.Status(), Wrap(CodeInternal, "no refresh endpoint is configured", nil)
	}

	var lastErr error
	for _, endpoint := range m.refreshURLs {
		credential, err := m.refreshOnce(ctx, endpoint, state)
		if err == nil {
			if applyErr := m.applyCredential(credential); applyErr != nil {
				return m.Status(), applyErr
			}
			m.log.Info("stockbit token refreshed", "access_expires_at", formatUnix(credential.Access.ExpiresAt))
			return m.Status(), nil
		}
		lastErr = err
		if errors.Is(err, ErrRateLimited) || errors.Is(err, ErrUpstreamTimeout) {
			break
		}
		// A 401 on one host may be a host-scoped quirk; try the other. A 5xx
		// also tries the other; the loop is bounded by the two configured URLs.
	}
	if lastErr == nil {
		lastErr = ErrUpstream
	}
	if errors.Is(lastErr, ErrReauthRequired) {
		m.markReauth("refresh token rejected")
		return m.Status(), ErrReauthRequired
	}
	return m.Status(), lastErr
}

// refreshOnce is one POST /login/refresh attempt against one host.
func (m *Manager) refreshOnce(ctx context.Context, endpoint string, state *State) (Credential, error) {
	target, err := url.Parse(endpoint)
	if err != nil {
		return Credential{}, Wrap(CodeInternal, "invalid refresh endpoint", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return Credential{}, Wrap(CodeInternal, "cannot build the refresh request", err)
	}
	request.Header.Set("Authorization", "Bearer "+state.Refresh.Value)
	request.Header.Set("Origin", m.origin)
	request.Header.Set("Referer", m.origin+"/")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", m.userAgent)
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
			return Credential{}, Wrap(CodeUpstreamTimeout, "Stockbit refresh timed out", err)
		}
		return Credential{}, Wrap(CodeUpstream, "Stockbit refresh is unreachable", err)
	}
	defer response.Body.Close()
	if jar != nil && jar.UpdateFromResponse(target, response) {
		m.persistJar(jar)
	}
	switch {
	case response.StatusCode == http.StatusUnauthorized:
		return Credential{}, ErrReauthRequired
	case response.StatusCode == http.StatusTooManyRequests:
		return Credential{}, WithRetry(retryAfter(response.Header.Get("Retry-After")), "Stockbit refresh rate limited")
	case response.StatusCode == http.StatusForbidden:
		preview := readPreview(response.Body, 4096)
		lower := strings.ToLower(preview)
		if strings.Contains(lower, "cf-mitigated") || strings.Contains(lower, "challenge") {
			return Credential{}, ErrChallenge
		}
		return Credential{}, Wrap(CodeUpstream, "Stockbit refresh refused", fmt.Errorf("status %d", response.StatusCode))
	case response.StatusCode >= 500:
		return Credential{}, Wrap(CodeUpstream, "Stockbit refresh failed upstream", fmt.Errorf("status %d", response.StatusCode))
	case response.StatusCode >= 400:
		preview := readPreview(response.Body, 4096)
		message := extractErrorMessage(preview)
		if message == "" {
			message = fmt.Sprintf("Stockbit refresh returned HTTP %d", response.StatusCode)
		}
		return Credential{}, Wrap(CodeUpstream, message, fmt.Errorf("status %d", response.StatusCode))
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if err != nil {
		return Credential{}, Wrap(CodeInvalidResponse, "cannot read the refresh response", err)
	}
	return parseRefreshPayload(data, state)
}

// parseRefreshPayload accepts the shapes the web client sees: data.access and
// data.refresh with token/expired_at, optionally nested one level deeper, and
// the flat access_token/refresh_token variant used by older clients.
func parseRefreshPayload(data []byte, state *State) (Credential, error) {
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return Credential{}, Wrap(CodeInvalidResponse, "the refresh response is not JSON", err)
	}
	dataMap := mapValue(raw["data"])
	if nested := mapValue(dataMap["data"]); len(nested) > 0 {
		dataMap = nested
	}
	if len(dataMap) == 0 {
		dataMap = raw
	}
	access := tokenFromMap(mapValue(dataMap["access"]))
	if access.Value == "" {
		access = tokenFromString(asString(dataMap["access_token"]))
	}
	refresh := tokenFromMap(mapValue(dataMap["refresh"]))
	if refresh.Value == "" {
		refresh = tokenFromString(asString(dataMap["refresh_token"]))
	}
	if access.Value == "" {
		message := extractErrorMessage(string(data))
		if message == "" {
			message = "the refresh response carried no access token"
		}
		return Credential{}, Wrap(CodeInvalidResponse, message, nil)
	}
	if access.ExpiresAt == 0 {
		if claims, err := DecodeJWT(access.Value); err == nil {
			access.ExpiresAt = claims.Exp
		}
	}
	if refresh.Value == "" {
		refresh = state.Refresh
	} else if refresh.ExpiresAt == 0 && refresh.Value == state.Refresh.Value {
		refresh.ExpiresAt = state.Refresh.ExpiresAt
	}
	user := state.User
	if rawUser := mapValue(dataMap["user"]); len(rawUser) > 0 {
		if blob, err := json.Marshal(rawUser); err == nil {
			var parsed User
			if json.Unmarshal(blob, &parsed) == nil {
				user = user.Merge(parsed)
			}
		}
	}
	return Credential{Access: access, Refresh: refresh, User: user}, nil
}

func (m *Manager) applyCredential(credential Credential) error {
	return m.update(func(state *State) error {
		state.Access = credential.Access
		if credential.Refresh.Present() {
			state.Refresh = credential.Refresh
		}
		if !credential.User.Empty() {
			state.User = state.User.Merge(credential.User)
		}
		state.ReauthReason = ""
		state.LastRefreshAt = m.now().Unix()
		return nil
	})
}

func (m *Manager) markReauth(reason string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.state == nil {
		return
	}
	m.state.ReauthReason = reason
	m.state.UpdatedAt = m.now().Unix()
	if err := m.store.Save(m.state); err != nil {
		m.log.Warn("could not persist the reauth marker", "code", CodeOf(err))
		return
	}
	m.fileMod = m.store.ModTime()
}

func tokenFromMap(value map[string]any) Token {
	if len(value) == 0 {
		return Token{}
	}
	token := Token{Value: asString(firstValue(value, "token", "value", "access_token", "refresh_token"))}
	for _, key := range []string{"expired_at", "expires_at", "expire_at", "expiredAt"} {
		if raw, ok := value[key]; ok && raw != nil {
			if seconds := DecodeExpiry(raw); seconds > 0 {
				token.ExpiresAt = seconds
				break
			}
		}
	}
	return token
}

func tokenFromString(value string) Token {
	value = strings.TrimSpace(value)
	if value == "" {
		return Token{}
	}
	token := Token{Value: value}
	if claims, err := DecodeJWT(value); err == nil {
		token.ExpiresAt = claims.Exp
	}
	return token
}

func mapValue(value any) map[string]any {
	if value == nil {
		return nil
	}
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	return nil
}
