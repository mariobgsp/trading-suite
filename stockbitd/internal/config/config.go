// Package config resolves the stockbitd runtime settings from the environment.
//
// One seam for every path and duration: tests construct a Config directly, and
// the CLI and HTTP server never read the environment themselves.
package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultAddr        = "127.0.0.1:8787"
	DefaultBaseURL     = "https://exodus.stockbit.com"
	DefaultLoginURL    = "https://stockbit.com/login"
	DefaultLoginOrigin = "https://stockbit.com"
)

// RefreshURLs is tried in order. The web client uses exodus.api with cookies;
// the plain exodus host is the fallback when the cookie-scoped host refuses.
var DefaultRefreshURLs = []string{
	"https://exodus.api.stockbit.com/login/refresh",
	"https://exodus.stockbit.com/login/refresh",
}

// Codes: config_invalid, home_unresolved.
// Config is everything the app needs before it starts. It is a record, not a
// god-object: nothing here fetches, persists or logs.
type Config struct {
	Addr            string
	Home            string
	SessionFile     string
	BrowserProfile  string
	BrowserLog      string
	Browser         string
	CredentialsFile string
	EnvUsername     string
	EnvPassword     string
	LoginURL        string
	BaseURL         string
	RefreshURLs     []string
	LoginTimeout    time.Duration
	RefreshWindow   time.Duration
	KeepAlive       time.Duration
	RequestTimeout  time.Duration
	Headless        bool
	EnvToken        string
	EnvRefresh      string
}

// Load resolves settings and validates what can be validated cheaply. A bad
// address is a config_invalid error, not a panic in net.Listen.
func Load() (Config, error) {
	home, err := resolveHome()
	if err != nil {
		return Config{}, NewError(CodeHomeUnresolved, "cannot resolve the data directory: "+err.Error())
	}
	addr := envString("STOCKBITD_ADDR", DefaultAddr)
	if err := validateAddr(addr); err != nil {
		return Config{}, NewError(CodeConfigInvalid, "STOCKBITD_ADDR: "+err.Error())
	}
	cfg := Config{
		Addr:            addr,
		Home:            home,
		SessionFile:     filepath.Join(home, "session.json"),
		BrowserProfile:  filepath.Join(home, "browser-profile"),
		BrowserLog:      filepath.Join(home, "browser.log"),
		Browser:         strings.TrimSpace(os.Getenv("STOCKBITD_BROWSER")),
		CredentialsFile: filepath.Join(home, "credentials.json"),
		EnvUsername:     strings.TrimSpace(firstEnv("STOCKBIT_USERNAME", "STOCKBIT_EMAIL")),
		EnvPassword:     cleanPassword(os.Getenv("STOCKBIT_PASSWORD")),
		LoginURL:        envString("STOCKBITD_LOGIN_URL", DefaultLoginURL),
		BaseURL:         strings.TrimRight(envString("STOCKBITD_BASE_URL", DefaultBaseURL), "/"),
		RefreshURLs:     resolveRefreshURLs(),
		LoginTimeout:    envDuration("STOCKBITD_LOGIN_TIMEOUT", 10*time.Minute),
		RefreshWindow:   envDuration("STOCKBITD_REFRESH_WINDOW", 10*time.Minute),
		KeepAlive:       envDuration("STOCKBITD_KEEPALIVE", 5*time.Minute),
		RequestTimeout:  envDuration("STOCKBITD_REQUEST_TIMEOUT", 30*time.Second),
		Headless:        envBool("STOCKBITD_HEADLESS", false),
		EnvToken:        cleanSecret(os.Getenv("STOCKBIT_JWT_TOKEN")),
		EnvRefresh:      cleanSecret(os.Getenv("STOCKBIT_REFRESH_TOKEN")),
	}
	if st := envString("STOCKBITD_SESSION_FILE", ""); st != "" {
		cfg.SessionFile = st
	}
	if bp := envString("STOCKBITD_BROWSER_PROFILE", ""); bp != "" {
		cfg.BrowserProfile = bp
	}
	if cf := envString("STOCKBITD_CREDENTIALS_FILE", ""); cf != "" {
		cfg.CredentialsFile = cf
	}
	return cfg, nil
}

func resolveHome() (string, error) {
	if explicit := strings.TrimSpace(os.Getenv("STOCKBITD_HOME")); explicit != "" {
		return filepath.Clean(explicit), nil
	}
	if xdg := strings.TrimSpace(os.Getenv("XDG_DATA_HOME")); xdg != "" {
		return filepath.Join(xdg, "stockbitd"), nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".local", "share", "stockbitd"), nil
}

func resolveRefreshURLs() []string {
	raw := strings.TrimSpace(os.Getenv("STOCKBITD_REFRESH_URLS"))
	if raw == "" {
		return append([]string(nil), DefaultRefreshURLs...)
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if value := strings.TrimSpace(part); value != "" {
			out = append(out, value)
		}
	}
	if len(out) == 0 {
		return append([]string(nil), DefaultRefreshURLs...)
	}
	return out
}

func validateAddr(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return err
	}
	if host == "" {
		return errors.New("host is empty")
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 1 || number > 65535 {
		return fmt.Errorf("port %q is not a valid port", port)
	}
	return nil
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func cleanPassword(raw string) string {
	value := strings.TrimSpace(raw)
	value = strings.Trim(value, "\"'")
	return value
}

func envString(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envDuration(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	if seconds, err := strconv.Atoi(raw); err == nil {
		if seconds < 0 {
			return fallback
		}
		return time.Duration(seconds) * time.Second
	}
	if parsed, err := time.ParseDuration(raw); err == nil && parsed > 0 {
		return parsed
	}
	return fallback
}

func envBool(name string, fallback bool) bool {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(raw)
	if err != nil {
		return fallback
	}
	return parsed
}

func cleanSecret(raw string) string {
	value := strings.TrimSpace(raw)
	value = strings.TrimPrefix(value, "Bearer ")
	value = strings.TrimSpace(value)
	value = strings.Trim(value, "\"'")
	if value == "" {
		return ""
	}
	return value
}
