// Command stockbitd is a Linux Stockbit session keeper.
//
// One interactive login in a real Chromium window is enough: the daemon keeps
// the cookie jar and tokens fresh, exposes a local JSON API, and serves a
// control panel at http://127.0.0.1:8787.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strings"
	"syscall"
	"time"

	"stockbitd/internal/api"
	"stockbitd/internal/browser"
	"stockbitd/internal/config"
	"stockbitd/internal/credentials"
	"stockbitd/internal/session"
	"stockbitd/internal/stockbit"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	command := os.Args[1]
	var err error
	switch command {
	case "serve":
		err = runServe(os.Args[2:])
	case "login":
		err = runLogin(os.Args[2:])
	case "status":
		err = runStatus(os.Args[2:])
	case "token":
		err = runToken(os.Args[2:])
	case "cookies":
		err = runCookies(os.Args[2:])
	case "logout":
		err = runLogout(os.Args[2:])
	case "open":
		err = runOpen(os.Args[2:])
	case "version", "--version", "-version":
		fmt.Printf("stockbitd %s (%s %s/%s)\n", api.Version, runtime.Version(), runtime.GOOS, runtime.GOARCH)
		return
	case "help", "--help", "-h":
		usage()
		return
	default:
		fmt.Fprintf(os.Stderr, "stockbitd: unknown command %q\n\n", command)
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintf(os.Stderr, "stockbitd: %v\n", err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `stockbitd — keep a Stockbit session alive on Linux

Usage:
  stockbitd serve [--addr 127.0.0.1:8787] [--open]
      Run the control panel and JSON API. The keeper refreshes tokens while it runs.

  stockbitd login [--timeout 10m] [--manual]
      With a saved sign-in, fill Stockbit's real login form automatically and
      save the cookie jar. --manual opens the plain login page instead.

  stockbitd status [--json]
      Print the session state and token runway.

  stockbitd token [--refresh TOKEN]
      Adopt an access token from stdin (and an optional refresh token).

  stockbitd cookies [--file PATH] [--access TOKEN] [--refresh TOKEN]
      Adopt a Cookie header from stdin or a file.

  stockbitd logout
      Delete the saved cookie jar.

  stockbitd open
      Open the running control panel (use serve first).

  stockbitd version | help

Environment:
  STOCKBITD_ADDR              listen address (default 127.0.0.1:8787)
  STOCKBITD_HOME              data directory (default ~/.local/share/stockbitd)
  STOCKBITD_BROWSER           Chrome/Chromium binary
  STOCKBITD_LOGIN_TIMEOUT     login window budget (default 10m)
  STOCKBITD_REFRESH_WINDOW    refresh this close to expiry (default 10m)
  STOCKBITD_KEEPALIVE         keeper tick (default 5m)
  STOCKBIT_USERNAME           saved automatic sign-in username (or the suite form)
  STOCKBIT_PASSWORD           saved automatic sign-in password
  STOCKBIT_JWT_TOKEN          headless bootstrap access token
  STOCKBIT_REFRESH_TOKEN      headless bootstrap refresh token
`)
}

func logger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
}

func buildCredentials(cfg config.Config) *credentials.Store {
	return credentials.NewStore(cfg.CredentialsFile, cfg.EnvUsername, cfg.EnvPassword)
}

func buildManager(cfg config.Config, log *slog.Logger) (*session.Manager, error) {
	store := session.NewStore(cfg.SessionFile)
	manager := session.NewManager(store, session.Options{
		HTTPClient:    &http.Client{Timeout: cfg.RequestTimeout},
		Logger:        log,
		RefreshURLs:   cfg.RefreshURLs,
		RefreshWindow: cfg.RefreshWindow,
		KeepAlive:     cfg.KeepAlive,
	})
	if err := manager.Load(); err != nil && !errors.Is(err, session.ErrSessionCorrupt) {
		return nil, err
	}
	if cfg.EnvToken != "" {
		status := manager.Status()
		if !status.Available && status.State != "connected" {
			if err := manager.AdoptToken(cfg.EnvToken, cfg.EnvRefresh); err != nil {
				log.Warn("could not adopt the bootstrap token", "code", session.CodeOf(err))
			}
		}
	}
	return manager, nil
}

func runServe(args []string) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	addr := flags.String("addr", "", "listen address (default from STOCKBITD_ADDR)")
	openPanel := flags.Bool("open", false, "open the control panel in the desktop browser")
	if err := flags.Parse(args); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if strings.TrimSpace(*addr) != "" {
		cfg.Addr = strings.TrimSpace(*addr)
	}
	log := logger()
	manager, err := buildManager(cfg, log)
	if err != nil {
		return err
	}
	creds := buildCredentials(cfg)
	login := browser.NewManager(cfg, manager, creds, log)
	data := stockbit.New(manager, cfg.BaseURL, stockbit.NewCache(), log)
	handler := api.New(manager, login, data, creds, log)

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      45 * time.Second,
		IdleTimeout:       90 * time.Second,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go manager.KeepAlive(ctx)
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	panelURL := panelAddress(cfg.Addr)
	if *openPanel && panelHealthy(panelURL) {
		// The user service is already running; just open the panel instead of
		// failing on a busy port.
		return openBrowser(panelURL)
	}
	listener, err := net.Listen("tcp", cfg.Addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", cfg.Addr, err)
	}
	log.Info("stockbitd serving", "url", panelURL, "home", cfg.Home, "session", cfg.SessionFile)
	if !isLoopbackHost(cfg.Addr) {
		log.Warn("the API is bound to a non-loopback address and has no authentication")
	}
	if *openPanel {
		go func() {
			time.Sleep(300 * time.Millisecond)
			if err := openBrowser(panelURL); err != nil {
				log.Warn("could not open the panel", "error", err)
			}
		}()
	}
	log.Info("session", "state", manager.Status().State)
	if err := server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func runLogin(args []string) error {
	flags := flag.NewFlagSet("login", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	timeout := flags.Duration("timeout", 0, "login window budget (default STOCKBITD_LOGIN_TIMEOUT)")
	manual := flags.Bool("manual", false, "open the login page instead of filling the saved sign-in")
	if err := flags.Parse(args); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	if *timeout > 0 {
		cfg.LoginTimeout = *timeout
	}
	log := logger()
	manager, err := buildManager(cfg, log)
	if err != nil {
		return err
	}
	login := browser.NewManager(cfg, manager, buildCredentials(cfg), log)
	attempt, err := login.Start(*manual)
	if err != nil && !errors.Is(err, session.ErrAlreadyRunning) {
		return err
	}
	fmt.Fprintf(os.Stderr, "stockbitd: login attempt %s\n", attempt.ID)
	if attempt.State == "failed" {
		return &codedFailure{Code: attempt.ErrorCode, Message: attempt.Error}
	}
	for {
		time.Sleep(600 * time.Millisecond)
		current, ok := login.Get(attempt.ID)
		if !ok {
			return session.ErrAttemptNotFound
		}
		switch current.State {
		case "connected":
			fmt.Fprintln(os.Stderr)
			return printStatus(manager.Status(), false)
		case "failed":
			return &codedFailure{Code: current.ErrorCode, Message: current.Error}
		case "cancelled":
			return session.ErrLoginCancelled
		default:
			if current.Message != "" {
				fmt.Fprintf(os.Stderr, "\rstockbitd: %s…", current.Message)
			}
		}
	}
}

func runStatus(args []string) error {
	flags := flag.NewFlagSet("status", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	asJSON := flags.Bool("json", false, "print JSON")
	if err := flags.Parse(args); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	log := logger()
	manager, err := buildManager(cfg, log)
	if err != nil {
		return err
	}
	status := manager.Status()
	if *asJSON {
		return printStatus(status, true)
	}
	return printStatus(status, false)
}

func runToken(args []string) error {
	flags := flag.NewFlagSet("token", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	access := flags.String("access", "", "access token (otherwise read from stdin)")
	refresh := flags.String("refresh", "", "refresh token")
	if err := flags.Parse(args); err != nil {
		return err
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	value := strings.TrimSpace(*access)
	if value == "" {
		data, readErr := io.ReadAll(io.LimitReader(os.Stdin, 1<<20))
		if readErr != nil {
			return readErr
		}
		value = strings.TrimSpace(string(data))
	}
	if value == "" {
		return &codedFailure{Code: session.CodeInvalidToken, Message: "no access token was provided"}
	}
	manager, err := buildManager(cfg, logger())
	if err != nil {
		return err
	}
	if err := manager.AdoptToken(value, *refresh); err != nil {
		return err
	}
	return printStatus(manager.Status(), false)
}

func runCookies(args []string) error {
	flags := flag.NewFlagSet("cookies", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	file := flags.String("file", "", "file containing the Cookie header")
	access := flags.String("access", "", "optional access token")
	refresh := flags.String("refresh", "", "optional refresh token")
	if err := flags.Parse(args); err != nil {
		return err
	}
	var input []byte
	var err error
	if strings.TrimSpace(*file) != "" {
		input, err = os.ReadFile(*file)
	} else {
		input, err = io.ReadAll(io.LimitReader(os.Stdin, 4<<20))
	}
	if err != nil {
		return err
	}
	value := strings.TrimSpace(string(input))
	if value == "" {
		return &codedFailure{Code: session.CodeInvalidCookie, Message: "no Cookie header was provided"}
	}
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	manager, err := buildManager(cfg, logger())
	if err != nil {
		return err
	}
	if err := manager.AdoptCookies(value, *access, *refresh); err != nil {
		return err
	}
	return printStatus(manager.Status(), false)
}

func runLogout(_ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	manager := session.NewManager(session.NewStore(cfg.SessionFile), session.Options{Logger: logger()})
	if err := manager.Logout(); err != nil {
		return err
	}
	if err := browser.ResetProfile(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "stockbitd: warning: %v\n", err)
	}
	return printStatus(manager.Status(), false)
}

func runOpen(_ []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	url := panelAddress(cfg.Addr)
	if !panelHealthy(url) {
		return fmt.Errorf("the control panel is not running at %s; start it with: stockbitd serve", url)
	}
	return openBrowser(url)
}

func panelHealthy(url string) bool {
	client := &http.Client{Timeout: 1500 * time.Millisecond}
	response, err := client.Get(url + "/api/health")
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode == http.StatusOK
}

// N: session_file — status works before one exists (unconfigured); the file
// is read, never required. The CLI state is one of unconfigured, connected,
// reauth_required or error; the JSON form is the same session.Status the panel
// reads.
func printStatus(status session.Status, asJSON bool) error {
	if asJSON {
		encoder := json.NewEncoder(os.Stdout)
		encoder.SetIndent("", "  ")
		return encoder.Encode(status)
	}
	fmt.Printf("state: %s\n", status.State)
	if status.User != nil {
		fmt.Printf("user: %s\n", displayUser(status.User.Username, status.User.Fullname, status.User.Email))
	}
	fmt.Printf("access: %s\n", describeToken(status.Access))
	fmt.Printf("refresh: %s\n", describeToken(status.Refresh))
	fmt.Printf("cookies: %d", status.Cookies.Count)
	if len(status.Cookies.Domains) > 0 {
		fmt.Printf(" (%s)", strings.Join(status.Cookies.Domains, ", "))
	}
	fmt.Println()
	if status.Session.Path != "" {
		fmt.Printf("session: %s (source %s)\n", status.Session.Path, valueOr(status.Session.Source, "unknown"))
	}
	if status.ReauthReason != "" {
		fmt.Printf("reason: %s\n", status.ReauthReason)
	}
	for _, warning := range status.Warnings {
		fmt.Printf("warning: %s\n", warning)
	}
	if status.State == "error" {
		return &codedFailure{Code: status.ErrorCode, Message: status.Error}
	}
	return nil
}

func describeToken(token session.TokenStatus) string {
	if !token.Present {
		return "missing"
	}
	if token.ExpiresAt == "" {
		return "present (expiry unknown)"
	}
	if token.Expired {
		return "expired at " + token.ExpiresAt
	}
	return fmt.Sprintf("expires in %s (%s)", humanDuration(time.Duration(token.ExpiresInSeconds)*time.Second), token.ExpiresAt)
}

func humanDuration(value time.Duration) string {
	if value <= 0 {
		return "0m"
	}
	days := int(value.Hours()) / 24
	if days >= 1 {
		return fmt.Sprintf("%dd %dh", days, int(value.Hours())%24)
	}
	hours := int(value.Hours())
	if hours >= 1 {
		return fmt.Sprintf("%dh %dm", hours, int(value.Minutes())%60)
	}
	return fmt.Sprintf("%dm", int(value.Minutes()))
}

func displayUser(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return "unknown"
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func panelAddress(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "http://127.0.0.1:8787"
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		host = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(host, port)
}

func isLoopbackHost(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	return host == "127.0.0.1" || host == "localhost" || host == "::1"
}

func openBrowser(url string) error {
	command := exec.Command("xdg-open", url)
	if err := command.Start(); err != nil {
		return fmt.Errorf("xdg-open: %w", err)
	}
	return nil
}

type codedFailure struct {
	Code    string
	Message string
}

func (e *codedFailure) Error() string {
	if e.Message == "" {
		return e.Code
	}
	return e.Code + ": " + e.Message
}
