package credentials

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"stockbitd/internal/session"
)

func TestSaveLoadStatusClear(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	store := NewStore(path, "", "")
	if _, _, err := store.Load(); !errorsIs(err, session.ErrCredentialsMissing) {
		t.Fatalf("empty load = %v", err)
	}
	if err := store.Save("trader@example.com", "p@ss word"); err != nil {
		t.Fatalf("save: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := info.Mode().Perm(); mode != 0o600 {
		t.Fatalf("credentials mode = %o", mode)
	}
	creds, source, err := store.Load()
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if source != "file" || creds.Username != "trader@example.com" || creds.Password != "p@ss word" {
		t.Fatalf("creds = %+v source=%s", creds, source)
	}
	status := store.Status()
	if !status.Configured || status.Source != "file" || status.Username != "trader@example.com" {
		t.Fatalf("status = %+v", status)
	}
	blob, _ := json.Marshal(status)
	if strings.Contains(string(blob), "p@ss") {
		t.Fatalf("status leaked the password: %s", blob)
	}
	if err := store.Clear(); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if _, _, err := store.Load(); !errorsIs(err, session.ErrCredentialsMissing) {
		t.Fatalf("cleared load = %v", err)
	}
}

func TestEnvFallbackAndFilePrecedence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	store := NewStore(path, "env@example.com", "env-password")
	creds, source, err := store.Load()
	if err != nil || source != "env" || creds.Password != "env-password" {
		t.Fatalf("env load = %+v %s %v", creds, source, err)
	}
	if err := store.Save("file@example.com", "file-password"); err != nil {
		t.Fatal(err)
	}
	creds, source, err = store.Load()
	if err != nil || source != "file" || creds.Username != "file@example.com" {
		t.Fatalf("file precedence = %+v %s %v", creds, source, err)
	}
	if err := store.Clear(); err != nil {
		t.Fatal(err)
	}
	creds, source, err = store.Load()
	if err != nil || source != "env" || creds.Username != "env@example.com" {
		t.Fatalf("env after clear = %+v %s %v", creds, source, err)
	}
}

func TestInvalidAndCorrupt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials.json")
	store := NewStore(path, "", "")
	if err := store.Save("", "password"); !errorsIs(err, session.ErrCredentialsInvalid) {
		t.Fatalf("empty username = %v", err)
	}
	if err := store.Save("user", ""); !errorsIs(err, session.ErrCredentialsInvalid) {
		t.Fatalf("empty password = %v", err)
	}
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.Load(); !errorsIs(err, session.ErrCredentialsInvalid) {
		t.Fatalf("corrupt = %v", err)
	}
	if status := store.Status(); status.Configured {
		t.Fatalf("corrupt status = %+v", status)
	}
}

func errorsIs(err, target error) bool {
	if err == nil {
		return false
	}
	type iser interface{ Is(error) bool }
	if typed, ok := err.(iser); ok {
		return typed.Is(target)
	}
	return false
}
