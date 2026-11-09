package session

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

func TestDecodeJWT(t *testing.T) {
	now := time.Now().UTC()
	token := testJWT(t, now.Add(time.Hour), "trader")
	claims, err := DecodeJWT(token)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if claims.Username != "trader" || claims.Exp != now.Add(time.Hour).Unix() {
		t.Fatalf("claims = %+v", claims)
	}
	if _, err := DecodeJWT("not-a-jwt"); err == nil {
		t.Fatalf("invalid token did not fail")
	}
}

func TestDecodeExpiryFormats(t *testing.T) {
	expected := time.Date(2026, 11, 7, 8, 0, 0, 0, time.UTC).Unix()
	epoch := time.Unix(expected, 0).UTC()
	cases := []any{
		float64(expected),
		json.Number(fmt.Sprintf("%d", expected)),
		fmt.Sprintf("%d", expected),
		epoch.Format(time.RFC3339),
		epoch.Format("2006-01-02 15:04:05"),
		float64(expected * 1000),
	}
	for _, value := range cases {
		if got := DecodeExpiry(value); got != expected {
			t.Fatalf("DecodeExpiry(%v) = %d, want %d", value, got, expected)
		}
	}
	if got := DecodeExpiry(nil); got != 0 {
		t.Fatalf("nil expiry = %d", got)
	}
	if got := DecodeExpiry("not a date"); got != 0 {
		t.Fatalf("garbage expiry = %d", got)
	}
}

func TestTokenUnmarshalExpiredAt(t *testing.T) {
	var token Token
	if err := json.Unmarshal([]byte(`{"token":"abc","expired_at":"2026-11-07 08:00:00"}`), &token); err != nil {
		t.Fatal(err)
	}
	if token.Value != "abc" || token.ExpiresAt != time.Date(2026, 11, 7, 8, 0, 0, 0, time.UTC).Unix() {
		t.Fatalf("token = %+v", token)
	}
	var numeric Token
	if err := json.Unmarshal([]byte(`{"token":"abc","expires_at":1794018000}`), &numeric); err != nil {
		t.Fatal(err)
	}
	if numeric.ExpiresAt != 1794018000 {
		t.Fatalf("numeric expiry = %d", numeric.ExpiresAt)
	}
}

func TestIsJWTRejectsEncodedCookie(t *testing.T) {
	now := time.Now().UTC()
	credential := Credential{Access: Token{Value: testJWT(t, now.Add(time.Hour), "u")}}
	encoded, _ := EncodeCredentialCookie(credential)
	if IsJWT(encoded) {
		t.Fatalf("an encoded credential cookie was mistaken for a JWT")
	}
	if !IsJWT(credential.Access.Value) {
		t.Fatalf("a real JWT was rejected")
	}
}
