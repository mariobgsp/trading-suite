package browser

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"stockbitd/internal/session"
)

// Codes: cdp_error, pipe_closed, script_error.
// Conn is one Chrome process reached over the DevTools pipe. The pipe is fd 3
// (browser reads) and fd 4 (browser writes); no WebSocket or port is opened.
type Conn struct {
	cmd      *exec.Cmd
	in       io.WriteCloser
	out      io.ReadCloser
	reader   *bufio.Reader
	logFile  *os.File
	mu       sync.Mutex
	nextID   int
	msgs     chan cdpMessage
	done     chan struct{}
	closed   error
	closeOne sync.Once
	shutOne  sync.Once
	netOnce  sync.Once
}

type cdpMessage struct {
	ID     int             `json:"id"`
	Method string          `json:"method"`
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// TargetInfo is the slice of a CDP target the login flow needs.
type TargetInfo struct {
	TargetID string `json:"targetId"`
	Type     string `json:"type"`
	URL      string `json:"url"`
	Title    string `json:"title"`
}

// Launch starts Chrome with the DevTools pipe and the dedicated login profile.
// It returns once the process is running; the caller still needs PickPage.
func Launch(binary, profileDir, logPath, loginURL string, headless bool) (*Conn, error) {
	if err := os.MkdirAll(profileDir, 0o700); err != nil {
		return nil, session.Wrap(session.CodePermissionDenied, "cannot create the browser profile directory", err)
	}
	cleanStaleProfileLock(profileDir)
	inRead, inWrite, err := os.Pipe()
	if err != nil {
		return nil, session.Wrap(session.CodeLaunchFailed, "cannot create the DevTools input pipe", err)
	}
	outRead, outWrite, err := os.Pipe()
	if err != nil {
		inRead.Close()
		inWrite.Close()
		return nil, session.Wrap(session.CodeLaunchFailed, "cannot create the DevTools output pipe", err)
	}
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		inRead.Close()
		inWrite.Close()
		outRead.Close()
		outWrite.Close()
		return nil, session.Wrap(session.CodePermissionDenied, "cannot open the browser log", err)
	}
	args := []string{
		"--user-data-dir=" + profileDir,
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-background-networking",
		"--remote-debugging-pipe",
		"--window-size=1280,900",
	}
	if headless {
		args = append(args, "--headless=new", "--disable-gpu")
	}
	args = append(args, loginURL)
	command := exec.Command(binary, args...)
	command.ExtraFiles = []*os.File{inRead, outWrite}
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	command.Stdout = logFile
	command.Stderr = logFile
	command.WaitDelay = 2 * time.Second
	if err := command.Start(); err != nil {
		inRead.Close()
		inWrite.Close()
		outRead.Close()
		outWrite.Close()
		logFile.Close()
		return nil, session.Wrap(session.CodeLaunchFailed, "cannot launch the browser", err)
	}
	inRead.Close()
	outWrite.Close()
	conn := &Conn{
		cmd:     command,
		in:      inWrite,
		out:     outRead,
		reader:  bufio.NewReaderSize(outRead, 1<<20),
		logFile: logFile,
		msgs:    make(chan cdpMessage, 256),
		done:    make(chan struct{}),
	}
	go conn.readLoop()
	return conn, nil
}

// cleanStaleProfileLock removes Chrome's SingletonLock when it points at a
// process that no longer exists. An unclean kill otherwise makes the next
// login fail with "the profile is in use".
func cleanStaleProfileLock(profileDir string) {
	lock := filepath.Join(profileDir, "SingletonLock")
	target, err := os.Readlink(lock)
	if err != nil {
		return
	}
	index := strings.LastIndex(target, "-")
	if index < 0 || index == len(target)-1 {
		return
	}
	pid, err := strconv.Atoi(target[index+1:])
	if err != nil || pid <= 0 {
		return
	}
	if err := syscall.Kill(pid, 0); err == nil || errors.Is(err, syscall.EPERM) {
		return
	}
	_ = os.Remove(lock)
	_ = os.Remove(filepath.Join(profileDir, "SingletonSocket"))
	_ = os.Remove(filepath.Join(profileDir, "SingletonCookie"))
}

func (c *Conn) readLoop() {
	defer c.shutdown(nil)
	for {
		raw, err := c.reader.ReadBytes(0)
		if err != nil {
			if !errors.Is(err, io.EOF) {
				c.shutdown(err)
			}
			return
		}
		raw = raw[:len(raw)-1]
		if len(raw) == 0 {
			continue
		}
		var message cdpMessage
		if err := json.Unmarshal(raw, &message); err != nil {
			continue
		}
		if message.ID == 0 {
			// Events (Runtime.consoleAPICalled, Network.*) are intentionally
			// dropped: this app only waits for command responses.
			continue
		}
		select {
		case c.msgs <- message:
		case <-c.done:
			return
		}
	}
}

func (c *Conn) shutdown(cause error) {
	c.shutOne.Do(func() {
		c.closed = cause
		close(c.done)
		_ = c.in.Close()
		_ = c.out.Close()
	})
}

// Closed reports whether the browser pipe has gone away.
func (c *Conn) Closed() bool {
	select {
	case <-c.done:
		return true
	default:
		return false
	}
}

// Call sends one CDP command and waits for its response. Calls are serialised:
// one in-flight command at a time, which is enough for the login poll.
func (c *Conn) Call(ctx context.Context, method string, params any, sessionID string) (json.RawMessage, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.Closed() {
		return nil, session.ErrPipeClosed
	}
	c.nextID++
	id := c.nextID
	payload := map[string]any{"id": id, "method": method}
	if params != nil {
		payload["params"] = params
	}
	if sessionID != "" {
		payload["sessionId"] = sessionID
	}
	blob, err := json.Marshal(payload)
	if err != nil {
		return nil, session.Wrap(session.CodeCDPError, "cannot encode the CDP command", err)
	}
	blob = append(blob, 0)
	if _, err := c.in.Write(blob); err != nil {
		c.shutdown(err)
		return nil, session.Wrap(session.CodePipeClosed, "cannot write to the browser pipe", err)
	}
	timeout := 20 * time.Second
	if deadline, ok := ctx.Deadline(); ok {
		if until := time.Until(deadline); until > 0 && until < timeout {
			timeout = until
		}
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil, session.Wrap(session.CodeUpstreamTimeout, "the CDP call was cancelled", ctx.Err())
		case <-c.done:
			return nil, session.ErrPipeClosed
		case <-timer.C:
			return nil, session.New(session.CodeCDPError, "the CDP call timed out")
		case message := <-c.msgs:
			if message.ID != id {
				continue
			}
			if message.Error != nil {
				return nil, session.New(session.CodeCDPError, fmt.Sprintf("CDP %s: %s", method, message.Error.Message))
			}
			return message.Result, nil
		}
	}
}

// Evaluate runs one expression in the page and returns its value. The login
// script returns a JSON string, so the common case is a string round-trip.
func (c *Conn) Evaluate(ctx context.Context, sessionID, expression string) (string, error) {
	result, err := c.Call(ctx, "Runtime.evaluate", map[string]any{
		"expression":    expression,
		"returnByValue": true,
		"awaitPromise":  true,
	}, sessionID)
	if err != nil {
		return "", err
	}
	var parsed struct {
		Result struct {
			Type        string          `json:"type"`
			Value       json.RawMessage `json:"value"`
			Description string          `json:"description"`
		} `json:"result"`
		Exception *struct {
			Text      string `json:"text"`
			Exception struct {
				Description string `json:"description"`
			} `json:"exception"`
		} `json:"exceptionDetails"`
	}
	if err := json.Unmarshal(result, &parsed); err != nil {
		return "", session.Wrap(session.CodeCDPError, "cannot decode the CDP evaluation", err)
	}
	if parsed.Exception != nil {
		message := parsed.Exception.Exception.Description
		if message == "" {
			message = parsed.Exception.Text
		}
		return "", session.New(session.CodeScriptError, message)
	}
	if len(parsed.Result.Value) == 0 || string(parsed.Result.Value) == "undefined" {
		return "", nil
	}
	if parsed.Result.Type == "string" {
		var text string
		if err := json.Unmarshal(parsed.Result.Value, &text); err == nil {
			return text, nil
		}
	}
	return string(parsed.Result.Value), nil
}

// Cookies asks the browser for every cookie, including HttpOnly ones that
// document.cookie cannot see.
func (c *Conn) Cookies(ctx context.Context) ([]session.Cookie, error) {
	result, err := c.Call(ctx, "Storage.getCookies", nil, "")
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Cookies []struct {
			Name     string  `json:"name"`
			Value    string  `json:"value"`
			Domain   string  `json:"domain"`
			Path     string  `json:"path"`
			Expires  float64 `json:"expires"`
			HTTPOnly bool    `json:"httpOnly"`
			Secure   bool    `json:"secure"`
			SameSite string  `json:"sameSite"`
			Session  bool    `json:"session"`
		} `json:"cookies"`
	}
	if err := json.Unmarshal(result, &parsed); err != nil {
		return nil, session.Wrap(session.CodeCDPError, "cannot decode the cookie list", err)
	}
	cookies := make([]session.Cookie, 0, len(parsed.Cookies))
	for _, item := range parsed.Cookies {
		cookie := session.Cookie{
			Name:     item.Name,
			Value:    item.Value,
			Domain:   item.Domain,
			Path:     item.Path,
			Secure:   item.Secure,
			HTTPOnly: item.HTTPOnly,
			SameSite: item.SameSite,
		}
		if !item.Session && item.Expires > 0 {
			cookie.Expires = int64(item.Expires)
		}
		cookies = append(cookies, cookie)
	}
	return session.FilterStockbit(cookies), nil
}

// Targets lists open targets.
func (c *Conn) Targets(ctx context.Context) ([]TargetInfo, error) {
	result, err := c.Call(ctx, "Target.getTargets", nil, "")
	if err != nil {
		return nil, err
	}
	var parsed struct {
		Targets []TargetInfo `json:"targetInfos"`
	}
	if err := json.Unmarshal(result, &parsed); err != nil {
		return nil, session.Wrap(session.CodeCDPError, "cannot decode the target list", err)
	}
	return parsed.Targets, nil
}

// Attach creates a flattened session for a page target and enables the
// domains the login poll uses.
func (c *Conn) Attach(ctx context.Context, targetID string) (string, error) {
	result, err := c.Call(ctx, "Target.attachToTarget", map[string]any{
		"targetId": targetID,
		"flatten":  true,
	}, "")
	if err != nil {
		return "", err
	}
	var parsed struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(result, &parsed); err != nil || parsed.SessionID == "" {
		return "", session.New(session.CodeCDPError, "CDP did not return a page session")
	}
	_, _ = c.Call(ctx, "Runtime.enable", nil, parsed.SessionID)
	_, _ = c.Call(ctx, "Page.enable", nil, parsed.SessionID)
	return parsed.SessionID, nil
}

// PickPage waits for the launched page, creating one if the initial navigation
// did not produce a target. It returns the target and attached session ids.
func (c *Conn) PickPage(ctx context.Context, loginURL string) (string, string, error) {
	deadline := time.Now().Add(12 * time.Second)
	created := false
	for {
		targets, err := c.Targets(ctx)
		if err != nil {
			return "", "", err
		}
		var chosen *TargetInfo
		for index := range targets {
			target := &targets[index]
			if target.Type != "page" {
				continue
			}
			if chosen == nil || strings.Contains(target.URL, "stockbit.com") {
				chosen = target
			}
			if strings.Contains(target.URL, "stockbit.com") {
				break
			}
		}
		if chosen != nil {
			if sessionID, err := c.Attach(ctx, chosen.TargetID); err == nil {
				return chosen.TargetID, sessionID, nil
			}
		}
		if chosen == nil && !created && time.Now().After(deadline) {
			created = true
			result, err := c.Call(ctx, "Target.createTarget", map[string]any{"url": loginURL}, "")
			if err != nil {
				return "", "", err
			}
			var parsed struct {
				TargetID string `json:"targetId"`
			}
			_ = json.Unmarshal(result, &parsed)
			if parsed.TargetID != "" {
				if sessionID, err := c.Attach(ctx, parsed.TargetID); err == nil {
					return parsed.TargetID, sessionID, nil
				}
			}
		}
		select {
		case <-ctx.Done():
			return "", "", ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}

// Close asks the browser to exit, then kills the whole process group. Chrome
// spawns children; terminating only the parent leaves renderers behind.
func (c *Conn) Close() {
	c.closeOne.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		_, _ = c.Call(ctx, "Browser.close", nil, "")
		cancel()
		c.shutdown(nil)
		if c.cmd != nil && c.cmd.Process != nil {
			pid := c.cmd.Process.Pid
			_ = syscall.Kill(-pid, syscall.SIGTERM)
			done := make(chan struct{})
			go func() {
				_ = c.cmd.Wait()
				close(done)
			}()
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				_ = syscall.Kill(-pid, syscall.SIGKILL)
				<-done
			}
		}
		if c.logFile != nil {
			_ = c.logFile.Close()
		}
	})
}
