package session

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Codes: session_missing, session_corrupt, permission_denied, write_failed.
// Store owns the one file that keeps the session alive across restarts. It is
// atomic and 0600; a corrupt file is reported, never silently replaced.
type Store struct {
	path string
	mu   sync.Mutex
}

// NewStore points a store at one absolute path.
func NewStore(path string) *Store {
	return &Store{path: path}
}

// Path is the session file location, shown in status and logs.
func (s *Store) Path() string { return s.path }

// Load reads the session. A missing file is ErrSessionMissing; a file that is
// not valid JSON is ErrSessionCorrupt. Both are distinguishable by code.
func (s *Store) Load() (*State, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, ErrSessionMissing
		}
		if errors.Is(err, os.ErrPermission) {
			return nil, Wrap(CodePermissionDenied, "cannot read the session file", err)
		}
		return nil, Wrap(CodeSessionCorrupt, "cannot read the session file", err)
	}
	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, Wrap(CodeSessionCorrupt, "the session file is not valid JSON", err)
	}
	if state.Version == 0 {
		state.Version = StateVersion
	}
	return &state, nil
}

// Save writes the session atomically: temp file, fsync, rename, chmod 0600.
func (s *Store) Save(state *State) error {
	if state == nil {
		return Wrap(CodeWriteFailed, "refusing to write a nil session", nil)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.path), 0o700); err != nil {
		return classifyWrite(err)
	}
	blob, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return Wrap(CodeWriteFailed, "cannot encode the session", err)
	}
	blob = append(blob, '\n')
	tmp := s.path + ".tmp"
	file, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return classifyWrite(err)
	}
	if _, err := file.Write(blob); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return classifyWrite(err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		_ = os.Remove(tmp)
		return classifyWrite(err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(tmp)
		return classifyWrite(err)
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return classifyWrite(err)
	}
	// Rename keeps the temp file's mode on Linux, but chmod defensively in case
	// an editor or a restore replaced the file behind us.
	_ = os.Chmod(s.path, 0o600)
	return nil
}

// Remove deletes the session file. Missing is success.
func (s *Store) Remove() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		if errors.Is(err, os.ErrPermission) {
			return Wrap(CodePermissionDenied, "cannot remove the session file", err)
		}
		return Wrap(CodeWriteFailed, "cannot remove the session file", err)
	}
	return nil
}

// ModTime is the file's modification time, zero when it does not exist.
func (s *Store) ModTime() time.Time {
	info, err := os.Stat(s.path)
	if err != nil {
		return time.Time{}
	}
	return info.ModTime()
}

func classifyWrite(err error) error {
	if errors.Is(err, os.ErrPermission) {
		return Wrap(CodePermissionDenied, "cannot write the session file", err)
	}
	return Wrap(CodeWriteFailed, "cannot write the session file", err)
}
