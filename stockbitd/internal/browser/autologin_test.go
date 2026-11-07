package browser

import (
	"encoding/json"
	"strings"
	"testing"

	"stockbitd/internal/credentials"
)

func TestFillLoginScriptEscapesCredentials(t *testing.T) {
	creds := credentials.Credentials{Username: `a"b\c<>`, Password: "p@ss'\"<>&"}
	script := fillLoginScript(creds)
	user, _ := json.Marshal(creds.Username)
	pass, _ := json.Marshal(creds.Password)
	if !strings.Contains(script, string(user)) {
		t.Fatalf("script does not contain the JSON-escaped username: %s", script)
	}
	if !strings.Contains(script, string(pass)) {
		t.Fatalf("script does not contain the JSON-escaped password")
	}
	if !strings.Contains(script, "#username") || !strings.Contains(script, "#password") {
		t.Fatalf("script does not target the Stockbit fields")
	}
	if !strings.Contains(script, "Masuk") {
		t.Fatalf("script does not target the Masuk submit button")
	}
	if strings.Contains(script, "var user = a\"") {
		t.Fatalf("username was not JSON-escaped")
	}
}

func TestLoginStateScriptTargetsTheFormAndErrors(t *testing.T) {
	for _, marker := range []string{"#username", "#password", "password salah", "verifikasi", "verification code"} {
		if !strings.Contains(loginStateScript, marker) {
			t.Fatalf("login state script missing %q", marker)
		}
	}
}
