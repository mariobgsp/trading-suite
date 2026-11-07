// Package credentials stores the one Stockbit password the daemon may reuse to
// sign in automatically.
//
// It is deliberately tiny: a 0600 JSON file, an environment fallback, and a
// public status that never includes the password. The browser login fills the
// real Stockbit form with these values; the password is never sent anywhere
// else.
package credentials

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"stockbitd/internal/session"
)

// Codes: credentials_missing, credentials_invalid, write_failed,
// permission_denied.

// Credentials is the pair the login form needs. It is never serialised by the
// status surface.
type Credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// Status is the safe public projection.
type Status struct {
	Configured bool   `json:"configured"`
	Source     string `json:"source,omitempty"`
	Username   string `json:"username,omitempty"`
}

// Store owns the credentials file and the environment fallback.
type Store struct {
	path        string
	envUsername string
	envPassword string
	mu          sync.Mutex
}

// NewStore points the store at a file and optional environment values.
func NewStore(path, envUsername, envPassword string) *Store {
	return &Store{path: path, envUsername: strings.TrimSpace(envUsername), envPassword: envPassword}
}

// Load returns the first configured pair: the file, then the environment.
func (s *Store) Load() (Credentials, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *Store) loadLocked() (Credentials, string, error) {
	if s.path != "" {
		data, err := os.ReadFile(s.path)
		switch {
		case err == nil:
			var creds Credentials
			if err := json.Unmarshal(data, &creds); err != nil {
				return Credentials{}, "file", session.Wrap(session.CodeCredentialsInvalid, "the saved sign-in is not valid JSON", err)
			}
			creds.Username = strings.TrimSpace(creds.Username)
			if creds.Username == "" || creds.Password == "" {
				return Credentials{}, "file", session.ErrCredentialsInvalid
			}
			// A copied file may be world-readable; fix it quietly on load.
			_ = os.Chmod(s.path, 0o600)
			return creds, "file", nil
		case errors.Is(err, os.ErrNotExist):
			// fall through to env
		case errors.Is(err, os.ErrPermission):
			return Credentials{}, "file", session.Wrap(session.CodePermissionDenied, "cannot read the saved sign-in", err)
		default:
			return Credentials{}, "file", session.Wrap(session.CodeCredentialsInvalid, "cannot read the saved sign-in", err)
		}
	}
	if s.envUsername != "" && s.envPassword != "" {
		return Credentials{Username: s.envUsername, Password: s.envPassword}, "env", nil
	}
	return Credentials{}, "", session.ErrCredentialsMissing
}

// Status never loads the password into the returned value.
func (s *Store) Status() Status {
	creds, source, err := s.Load()
	if err != nil {
		return Status{Configured: false, Source: source}
	}
	return Status{Configured: true, Source: source, Username: creds.Username}
}

// Save writes the pair atomically with mode 0600.
func (s *Store) Save(username, password string) error {
	username = strings.TrimSpace(username)
	if username == "" || password == "" {
		return session.ErrCredentialsInvalid
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.path == "" {
		return session.Wrap(session.CodeWriteFailed, "no credentials path is configured", nil)
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return session.Wrap(session.CodePermissionDenied, "cannot create the credentials directory", err)
	}
	blob, err := json.Marshal(Credentials{Username: username, Password: password})
	if err != nil {
		return session.Wrap(session.CodeWriteFailed, "cannot encode the saved sign-in", err)
	}
	blob = append(blob, byte(0x0a))
	tmp := s.path + ".tmp"
	file, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return session.Wrap(session.CodeWriteFailed, "cannot write the saved sign-in", err)
	}
	if _, err := file.Write(blob); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return session.Wrap(session.CodeWriteFailed, "cannot write the saved sign-in", err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return session.Wrap(session.CodeWriteFailed, "cannot write the saved sign-in", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(tmp)
		return session.Wrap(session.CodeWriteFailed, "cannot write the saved sign-in", err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return session.Wrap(session.CodeWriteFailed, "cannot write the saved sign-in", err)
	}
	_ = os.Chmod(s.path, 0o600)
	return nil
}

// Clear removes the file. The environment fallback, if any, remains.
func (s *Store) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.path == "" {
		return nil
	}
	if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return session.Wrap(session.CodeWriteFailed, "cannot remove the saved sign-in", err)
	}
	return nil
}
