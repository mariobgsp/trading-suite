package browser

import (
	"context"
	"os"
	"strings"

	"stockbitd/internal/config"
	"testing"
	"time"
)

// TestCDPPipeSmoke is an integration probe: it launches the real browser over
// the DevTools pipe and evaluates a trivial expression. It skips when the host
// has no Chromium, so the unit suite stays portable.
func TestCDPPipeSmoke(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode")
	}
	binary := ResolveBinary(os.Getenv("STOCKBITD_BROWSER"))
	if binary == "" {
		t.Skip("no Chromium found")
	}
	profile := t.TempDir()
	conn, err := Launch(binary, profile, profile+"/browser.log", "about:blank", true)
	if err != nil {
		t.Fatalf("launch: %v", err)
	}
	defer conn.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	_, sessionID, err := conn.PickPage(ctx, "about:blank")
	if err != nil {
		t.Fatalf("pick page: %v", err)
	}
	value, err := conn.Evaluate(ctx, sessionID, "1 + 1")
	if err != nil {
		t.Fatalf("evaluate: %v", err)
	}
	if strings.TrimSpace(value) != "2" {
		t.Fatalf("evaluate = %q, want 2", value)
	}
	if _, err := conn.Cookies(ctx); err != nil {
		t.Fatalf("cookies: %v", err)
	}
}

func TestDiscoverExplainsMissingDisplay(t *testing.T) {
	t.Setenv("DISPLAY", "")
	t.Setenv("WAYLAND_DISPLAY", "")
	cfg := configForTest(t)
	caps := Discover(cfg)
	if caps.Available {
		t.Fatalf("expected unavailable without a display: %+v", caps)
	}
	if caps.Code != "no_display" {
		t.Fatalf("code = %q, want no_display", caps.Code)
	}
}

func configForTest(t *testing.T) config.Config {
	t.Helper()
	return config.Config{BrowserProfile: t.TempDir(), LoginTimeout: time.Minute, LoginURL: "about:blank"}
}
