package session

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// Codes: invalid_token.
// Token is the pair Stockbit keeps for access and refresh credentials. The
// value is a secret and is never logged or returned by the API.
type Token struct {
	Value     string `json:"token"`
	ExpiresAt int64  `json:"expires_at,omitempty"`
}

// Present reports whether a token string exists.
func (t Token) Present() bool { return strings.TrimSpace(t.Value) != "" }

// Expiry is the token's wall-clock expiry, zero when unknown.
func (t Token) Expiry() time.Time {
	if t.ExpiresAt <= 0 {
		return time.Time{}
	}
	return time.Unix(t.ExpiresAt, 0).UTC()
}

// Expired reports whether the token is past its expiry, allowing a small skew.
func (t Token) Expired(now time.Time, skew time.Duration) bool {
	if t.ExpiresAt <= 0 {
		return false
	}
	return !now.Add(skew).Before(t.Expiry())
}

// UnmarshalJSON accepts the shapes Stockbit uses: expires_at as a number or
// expired_at as a formatted UTC string, plus the token itself.
func (t *Token) UnmarshalJSON(data []byte) error {
	var raw struct {
		Token     string          `json:"token"`
		Value     string          `json:"value"`
		ExpiresAt json.RawMessage `json:"expires_at"`
		ExpiredAt json.RawMessage `json:"expired_at"`
		ExpireAt  json.RawMessage `json:"expire_at"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	t.Value = strings.TrimSpace(raw.Token)
	if t.Value == "" {
		t.Value = strings.TrimSpace(raw.Value)
	}
	for _, field := range []json.RawMessage{raw.ExpiresAt, raw.ExpiredAt, raw.ExpireAt} {
		if len(field) == 0 || string(field) == "null" {
			continue
		}
		var value any
		if err := json.Unmarshal(field, &value); err != nil {
			continue
		}
		if seconds := DecodeExpiry(value); seconds > 0 {
			t.ExpiresAt = seconds
			break
		}
	}
	if t.ExpiresAt == 0 {
		if claims, err := DecodeJWT(t.Value); err == nil && claims.Exp > 0 {
			t.ExpiresAt = claims.Exp
		}
	}
	return nil
}

// Claims is the small, non-secret projection of a JWT payload.
type Claims struct {
	Exp      int64
	Sub      string
	Username string
	Name     string
	Email    string
	UserID   int64
}

// DecodeJWT reads the payload of a Stockbit access token. It never verifies a
// signature: the token is ours, and the server is the authority on validity.
func DecodeJWT(raw string) (Claims, error) {
	value := strings.TrimSpace(strings.TrimPrefix(raw, "Bearer "))
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return Claims{}, ErrInvalidToken
	}
	payload, err := decodeSegment(parts[1])
	if err != nil {
		return Claims{}, Wrap(CodeInvalidToken, "the JWT payload is not base64url", err)
	}
	var body map[string]any
	if err := json.Unmarshal(payload, &body); err != nil {
		return Claims{}, Wrap(CodeInvalidToken, "the JWT payload is not JSON", err)
	}
	claims := Claims{
		Exp:      int64(asFloat(body["exp"])),
		Sub:      asString(body["sub"]),
		Username: asString(body["username"]),
		Name:     asString(body["name"]),
		Email:    asString(body["email"]),
		UserID:   int64(asFloat(firstValue(body, "user_id", "userId", "uid"))),
	}
	return claims, nil
}

func decodeSegment(segment string) ([]byte, error) {
	if data, err := base64.RawURLEncoding.DecodeString(segment); err == nil {
		return data, nil
	}
	return base64.URLEncoding.DecodeString(segment)
}

// DecodeExpiry turns Stockbit's several expiry encodings into unix seconds.
// Unknown values return 0; the caller treats an unknown expiry as "do not
// pre-emptively refresh".
func DecodeExpiry(value any) int64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case time.Time:
		if typed.IsZero() {
			return 0
		}
		return typed.Unix()
	case json.Number:
		return numberToUnix(string(typed))
	case float64:
		return floatToUnix(typed)
	case int:
		return floatToUnix(float64(typed))
	case int64:
		return floatToUnix(float64(typed))
	case string:
		text := strings.TrimSpace(typed)
		if text == "" || text == "-" {
			return 0
		}
		if number, err := strconv.ParseFloat(text, 64); err == nil {
			return floatToUnix(number)
		}
		formats := []string{
			time.RFC3339,
			time.RFC3339Nano,
			"2006-01-02 15:04:05",
			"2006-01-02T15:04:05",
			"2006-01-02 15:04",
			"2006-01-02",
		}
		for _, format := range formats {
			if parsed, err := time.Parse(format, text); err == nil {
				return parsed.UTC().Unix()
			}
		}
	}
	return 0
}

func numberToUnix(text string) int64 {
	number, err := strconv.ParseFloat(text, 64)
	if err != nil {
		return 0
	}
	return floatToUnix(number)
}

func floatToUnix(value float64) int64 {
	if value <= 0 {
		return 0
	}
	// Milliseconds are common in mobile payloads; seconds are the default.
	if value > 1e12 {
		return int64(value / 1000)
	}
	return int64(value)
}

// FormatExpiry renders the format Stockbit writes into its credential cookie.
func FormatExpiry(seconds int64) string {
	if seconds <= 0 {
		return ""
	}
	return time.Unix(seconds, 0).UTC().Format("2006-01-02 15:04:05")
}

// IsJWT reports the cheap shape test used before accepting a pasted token.
func IsJWT(value string) bool {
	clean := strings.TrimSpace(strings.TrimPrefix(value, "Bearer "))
	if clean == "" || strings.ContainsAny(clean, "{}%") {
		return false
	}
	return strings.Count(clean, ".") == 2 && len(clean) > 20
}

func asString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return fmt.Sprintf("%v", typed)
	default:
		return ""
	}
}

func asFloat(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		number, _ := typed.Float64()
		return number
	case string:
		number, _ := strconv.ParseFloat(strings.ReplaceAll(strings.TrimSpace(typed), ",", ""), 64)
		return number
	default:
		return 0
	}
}

func firstValue(values map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := values[key]; ok && value != nil {
			return value
		}
	}
	return nil
}
