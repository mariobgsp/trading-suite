package session

import (
	"errors"
	"fmt"
)

// Every failure that crosses the app's boundary carries one of these codes.
// The CLI prints it, the HTTP layer maps it to a status, and the panel switches
// on it. Nothing in this package returns a bare fmt.Errorf to a caller.
const (
	CodeNotConnected       = "not_connected"
	CodeReauthRequired     = "reauth_required"
	CodeRateLimited        = "rate_limited"
	CodeChallenge          = "challenge_required"
	CodeUpstream           = "upstream_error"
	CodeUpstreamTimeout    = "upstream_timeout"
	CodeInvalidResponse    = "invalid_response"
	CodeInvalidToken       = "invalid_token"
	CodeInvalidCookie      = "invalid_cookie"
	CodeInvalidRequest     = "invalid_request"
	CodeForbiddenOrigin    = "forbidden_origin"
	CodeTokenExpired       = "token_expired"
	CodeSessionMissing     = "session_missing"
	CodeSessionCorrupt     = "session_corrupt"
	CodePermissionDenied   = "permission_denied"
	CodeWriteFailed        = "write_failed"
	CodeAlreadyRunning     = "already_running"
	CodeAttemptNotFound    = "attempt_not_found"
	CodeInvalidTicker      = "invalid_ticker"
	CodeInvalidDate        = "invalid_date"
	CodeNotFound           = "not_found"
	CodeMethodNotAllowed   = "method_not_allowed"
	CodeBrowserNotFound    = "browser_not_found"
	CodeNoDisplay          = "no_display"
	CodeUnsupported        = "unsupported_browser"
	CodeLoginTimeout       = "login_timeout"
	CodeLoginCancelled     = "login_cancelled"
	CodeBrowserClosed      = "browser_closed"
	CodeCDPError           = "cdp_error"
	CodeScriptError        = "script_error"
	CodePipeClosed         = "pipe_closed"
	CodeLaunchFailed       = "launch_failed"
	CodeNoCredentials      = "no_credentials"
	CodeCredentialsMissing = "credentials_missing"
	CodeCredentialsInvalid = "credentials_invalid"
	CodeInvalidCredentials = "invalid_credentials"
	CodeLoginFormNotFound  = "login_form_not_found"
	CodeDaemonDown         = "daemon_unavailable"
	CodeInternal           = "internal_error"
)

// Error is the one error shape in the app. Code is stable; Message is for a
// human; Status and RetryAfter are HTTP hints. Err is never serialised.
type Error struct {
	Code       string
	Message    string
	Status     int
	RetryAfter int
	AttemptID  string
	Err        error
}

func (e *Error) Error() string {
	if e.Err != nil {
		return e.Code + ": " + e.Message + ": " + e.Err.Error()
	}
	return e.Code + ": " + e.Message
}

func (e *Error) Unwrap() error { return e.Err }

// Is matches on the code so errors.Is(err, ErrReauthRequired) survives a
// wrapped or dynamically-built error of the same family.
func (e *Error) Is(target error) bool {
	var other *Error
	return errors.As(target, &other) && other.Code == e.Code
}

// New builds an error and assigns the conventional HTTP status.
func New(code, message string) *Error {
	return &Error{Code: code, Message: message, Status: statusFor(code)}
}

// Wrap attaches a cause to a coded error.
func Wrap(code, message string, cause error) *Error {
	return &Error{Code: code, Message: message, Status: statusFor(code), Err: cause}
}

// WithRetry is a rate-limit error with the server's Retry-After hint.
func WithRetry(seconds int, message string) *Error {
	return &Error{Code: CodeRateLimited, Message: message, Status: 429, RetryAfter: seconds}
}

// WithAttempt is already_running, carrying the live attempt id so the caller
// can attach to it instead of starting a second browser.
func WithAttempt(id string) *Error {
	return &Error{Code: CodeAlreadyRunning, Message: "a login attempt is already running", Status: 409, AttemptID: id}
}

// Sentinels: used with errors.Is and returned directly when no detail is
// needed. Dynamic variants use New/Wrap and still match by code.
var (
	ErrNotConnected       = New(CodeNotConnected, "Stockbit is not connected")
	ErrReauthRequired     = New(CodeReauthRequired, "the Stockbit session needs a fresh login")
	ErrRateLimited        = New(CodeRateLimited, "Stockbit rate limit reached")
	ErrChallenge          = New(CodeChallenge, "Stockbit requires a browser challenge")
	ErrUpstream           = New(CodeUpstream, "Stockbit upstream failed")
	ErrUpstreamTimeout    = New(CodeUpstreamTimeout, "Stockbit request timed out")
	ErrInvalidResponse    = New(CodeInvalidResponse, "Stockbit returned an unexpected payload")
	ErrInvalidToken       = New(CodeInvalidToken, "invalid access token")
	ErrInvalidCookie      = New(CodeInvalidCookie, "invalid cookie input")
	ErrInvalidRequest     = New(CodeInvalidRequest, "invalid request")
	ErrForbiddenOrigin    = New(CodeForbiddenOrigin, "cross-origin request refused")
	ErrTokenExpired       = New(CodeTokenExpired, "the access token has expired")
	ErrSessionMissing     = New(CodeSessionMissing, "no session has been saved")
	ErrSessionCorrupt     = New(CodeSessionCorrupt, "the saved session is unreadable")
	ErrPermissionDenied   = New(CodePermissionDenied, "permission denied")
	ErrWriteFailed        = New(CodeWriteFailed, "could not write the session file")
	ErrAlreadyRunning     = New(CodeAlreadyRunning, "a login attempt is already running")
	ErrAttemptNotFound    = New(CodeAttemptNotFound, "login attempt not found")
	ErrInvalidTicker      = New(CodeInvalidTicker, "invalid ticker")
	ErrInvalidDate        = New(CodeInvalidDate, "invalid date; use YYYY-MM-DD")
	ErrNotFound           = New(CodeNotFound, "not found")
	ErrBrowserNotFound    = New(CodeBrowserNotFound, "no Chromium browser was found")
	ErrNoDisplay          = New(CodeNoDisplay, "no graphical display is available")
	ErrUnsupported        = New(CodeUnsupported, "this browser does not support the DevTools pipe")
	ErrLoginTimeout       = New(CodeLoginTimeout, "the login window timed out")
	ErrLoginCancelled     = New(CodeLoginCancelled, "the login was cancelled")
	ErrBrowserClosed      = New(CodeBrowserClosed, "the browser was closed before login finished")
	ErrCDP                = New(CodeCDPError, "the browser DevTools channel failed")
	ErrPipeClosed         = New(CodePipeClosed, "the browser DevTools pipe closed")
	ErrLaunchFailed       = New(CodeLaunchFailed, "the browser could not be launched")
	ErrNoCredentials      = New(CodeNoCredentials, "no Stockbit credential was found")
	ErrCredentialsMissing = New(CodeCredentialsMissing, "no saved Stockbit sign-in")
	ErrCredentialsInvalid = New(CodeCredentialsInvalid, "the saved Stockbit sign-in is incomplete")
	ErrInvalidCredentials = New(CodeInvalidCredentials, "Stockbit rejected the sign-in")
	ErrLoginFormNotFound  = New(CodeLoginFormNotFound, "the Stockbit login form was not found")
	ErrDaemonDown         = New(CodeDaemonDown, "the Stockbit daemon is not answering")
)

func statusFor(code string) int {
	switch code {
	case CodeNotConnected, CodeAlreadyRunning, CodeLoginCancelled, CodeCredentialsMissing:
		return 409
	case CodeReauthRequired, CodeNoCredentials:
		return 401
	case CodeInvalidCredentials, CodeCredentialsInvalid:
		return 400
	case CodeLoginFormNotFound:
		return 502
	case CodeRateLimited:
		return 429
	case CodeChallenge, CodeForbiddenOrigin:
		return 403
	case CodeUpstream, CodeInvalidResponse, CodeCDPError, CodeLaunchFailed:
		return 502
	case CodeUpstreamTimeout:
		return 504
	case CodeInvalidToken, CodeInvalidCookie, CodeTokenExpired, CodeInvalidTicker, CodeInvalidDate, CodeInvalidRequest:
		return 400
	case CodeAttemptNotFound, CodeNotFound:
		return 404
	case CodeMethodNotAllowed:
		return 405
	case CodeLoginTimeout:
		return 408
	case CodeBrowserNotFound, CodeNoDisplay, CodeUnsupported:
		return 503
	default:
		return 500
	}
}

// CodeOf returns the stable code for any error, falling back to internal_error.
func CodeOf(err error) string {
	var coded *Error
	if errors.As(err, &coded) {
		return coded.Code
	}
	return CodeInternal
}

// StatusOf returns the HTTP status for any error.
func StatusOf(err error) int {
	var coded *Error
	if errors.As(err, &coded) && coded.Status != 0 {
		return coded.Status
	}
	return 500
}

// MessageOf strips the code prefix. Dynamic messages are safe to show; the
// values that produced them never include tokens or cookies.
func MessageOf(err error) string {
	var coded *Error
	if errors.As(err, &coded) {
		return coded.Message
	}
	if err == nil {
		return ""
	}
	return err.Error()
}

// RetryAfterOf returns the Retry-After hint, if any.
func RetryAfterOf(err error) int {
	var coded *Error
	if errors.As(err, &coded) {
		return coded.RetryAfter
	}
	return 0
}

// retryAfterOf is the internal spelling used by this package.
func retryAfterOf(err error) int { return RetryAfterOf(err) }

// wrapHTTP keeps the cause but gives a stable message for the surface.
func wrapHTTP(status int, message string) *Error {
	code := CodeUpstream
	switch status {
	case 401:
		code = CodeReauthRequired
	case 403:
		code = CodeChallenge
	case 429:
		code = CodeRateLimited
	}
	return &Error{Code: code, Message: fmt.Sprintf("%s (HTTP %d)", message, status), Status: status}
}
