package config

// Error codes are part of the public surface: the CLI prints them, the HTTP
// API returns them, and the web panel switches on them. They are stable.

const (
	CodeConfigInvalid  = "config_invalid"
	CodeHomeUnresolved = "home_unresolved"
)

// Error is a configuration failure with a machine-readable code.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// NewError builds a configuration error.
func NewError(code, message string) *Error {
	return &Error{Code: code, Message: message}
}
