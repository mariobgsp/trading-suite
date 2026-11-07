package browser

import (
	"os"
	"path/filepath"
	"testing"

	"stockbitd/internal/config"
)

func TestResetProfileOnlyInsideHome(t *testing.T) {
	home := t.TempDir()
	profile := filepath.Join(home, "browser-profile")
	if err := os.MkdirAll(filepath.Join(profile, "Default"), 0o700); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Home: home, BrowserProfile: profile}
	if err := ResetProfile(cfg); err != nil {
		t.Fatalf("reset: %v", err)
	}
	if _, err := os.Stat(profile); !os.IsNotExist(err) {
		t.Fatalf("profile still exists after reset")
	}

	outside := t.TempDir()
	if err := os.WriteFile(filepath.Join(outside, "keep"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	refused := config.Config{Home: home, BrowserProfile: outside}
	if err := ResetProfile(refused); err == nil {
		t.Fatalf("reset removed a profile outside HOME")
	}
	if _, err := os.Stat(filepath.Join(outside, "keep")); err != nil {
		t.Fatalf("outside profile was damaged: %v", err)
	}
}
