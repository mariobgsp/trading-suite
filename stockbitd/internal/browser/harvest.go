package browser

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"regexp"
	"strings"

	"stockbitd/internal/session"
)

// Codes: invalid_cookie, invalid_token, no_credentials.
// PageState is what the login poll reads out of the page: the legacy local
// storage keys plus document.cookie. The CDP cookie list is the primary source;
// this is the second chance when a build writes tokens somewhere else.
type PageState struct {
	At    string `json:"at"`
	Ar    string `json:"ar"`
	Au    string `json:"au"`
	Cred  string `json:"cred"`
	Href  string `json:"href"`
	Title string `json:"title"`
}

var jwtPattern = regexp.MustCompile(`[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}`)

// ParsePageJSON decodes the evaluate result. Empty or non-JSON storage is a
// normal pre-login state, not a fatal error.
func ParsePageJSON(raw string) (PageState, error) {
	state := PageState{}
	text := strings.TrimSpace(raw)
	if text == "" {
		return state, nil
	}
	if err := json.Unmarshal([]byte(text), &state); err != nil {
		return state, session.Wrap(session.CodeInvalidCookie, "the page storage is not JSON", err)
	}
	return state, nil
}

// Harvest chooses the strongest credential available: the credentialStorage
// cookie, then document.cookie, then the legacy at/ar localStorage values.
func Harvest(cookies []session.Cookie, page PageState) (session.Harvest, error) {
	collected := session.FilterStockbit(cookies)

	if credential, err := session.CredentialFromCookies(collected); err == nil && credential.Access.Present() {
		return harvestFromCredential(credential, collected)
	}

	if strings.TrimSpace(page.Cred) != "" {
		if pageCookies, err := session.ParseCookieHeader(page.Cred); err == nil {
			pageCookies = session.FilterStockbit(pageCookies)
			collected = append(collected, pageCookies...)
			if credential, err := session.CredentialFromCookies(pageCookies); err == nil && credential.Access.Present() {
				return harvestFromCredential(credential, collected)
			}
		}
	}

	access := decodeLegacyToken(page.At)
	refresh := decodeLegacyToken(page.Ar)
	if refresh == "" {
		// A refresh token is often opaque, not a JWT; keep it as written.
		refresh = strings.TrimSpace(page.Ar)
	}
	user := decodeLegacyUser(page.Au)
	if access == "" {
		return session.Harvest{}, session.ErrNoCredentials
	}
	if !session.IsJWT(access) {
		return session.Harvest{}, session.ErrInvalidToken
	}
	claims, _ := session.DecodeJWT(access)
	user = user.Merge(session.User{ID: claims.UserID, Username: claims.Username, Fullname: claims.Name, Email: claims.Email})
	return session.Harvest{AccessToken: access, RefreshToken: refresh, User: user, Cookies: collected, Source: "browser"}, nil
}

func harvestFromCredential(credential session.Credential, cookies []session.Cookie) (session.Harvest, error) {
	access := strings.TrimSpace(credential.Access.Value)
	if access == "" {
		return session.Harvest{}, session.ErrNoCredentials
	}
	if !session.IsJWT(access) {
		return session.Harvest{}, session.ErrInvalidToken
	}
	return session.Harvest{
		AccessToken:  access,
		RefreshToken: credential.Refresh.Value,
		User:         credential.User,
		Cookies:      cookies,
		Source:       "browser",
	}, nil
}

// decodeLegacyToken recovers a token from a value an older Stockbit build may
// have written as raw text, base64, URL-encoded JSON, or a wrapper object.
func decodeLegacyToken(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}
	if session.IsJWT(value) {
		return value
	}
	for _, decoded := range decodeVariants(value) {
		trimmed := strings.TrimSpace(decoded)
		if session.IsJWT(trimmed) {
			return trimmed
		}
		if token := tokenFromJSON(trimmed); token != "" {
			return token
		}
	}
	if match := jwtPattern.FindString(value); match != "" {
		return match
	}
	return ""
}

func tokenFromJSON(text string) string {
	if !strings.HasPrefix(text, "{") && !strings.HasPrefix(text, "\"") {
		return ""
	}
	var direct string
	if err := json.Unmarshal([]byte(text), &direct); err == nil && session.IsJWT(direct) {
		return direct
	}
	var object map[string]any
	if err := json.Unmarshal([]byte(text), &object); err != nil {
		return ""
	}
	for _, key := range []string{"token", "access_token", "refresh_token"} {
		if value, ok := object[key].(string); ok && session.IsJWT(value) {
			return value
		}
	}
	for _, key := range []string{"access", "refresh", "data"} {
		if nested, ok := object[key].(map[string]any); ok {
			if value, ok := nested["token"].(string); ok && session.IsJWT(value) {
				return value
			}
		}
	}
	return ""
}

func decodeLegacyUser(raw string) session.User {
	value := strings.TrimSpace(raw)
	if value == "" {
		return session.User{}
	}
	for _, decoded := range decodeVariants(value) {
		var user session.User
		if err := json.Unmarshal([]byte(decoded), &user); err == nil && !user.Empty() {
			return user
		}
	}
	return session.User{}
}

func decodeVariants(value string) []string {
	out := []string{value}
	for _, encoding := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.StdEncoding} {
		if decoded, err := encoding.DecodeString(value); err == nil {
			out = append(out, string(decoded))
		}
	}
	if decoded, err := urlUnescape(value); err == nil {
		out = append(out, decoded)
	}
	if len(out) > 1 {
		// One extra pass catches base64(URL-encoded JSON), an older encoding
		// combination that appears in the wild.
		for _, candidate := range append([]string(nil), out[1:]...) {
			if decoded, err := urlUnescape(candidate); err == nil {
				out = append(out, decoded)
			}
		}
	}
	return out
}

func urlUnescape(value string) (string, error) {
	decoded, err := urlQueryUnescape(value)
	return decoded, err
}

func urlQueryUnescape(value string) (string, error) {
	return url.QueryUnescape(value)
}
