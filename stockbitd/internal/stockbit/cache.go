package stockbit

import (
	"sort"
	"sync"
	"time"
)

// CacheInfo is the non-secret freshness metadata returned alongside a payload.
type CacheInfo struct {
	Hit        bool   `json:"hit"`
	AgeSeconds int    `json:"age_seconds"`
	TTLSeconds int    `json:"ttl_seconds"`
	Key        string `json:"key"`
}

type cacheEntry struct {
	value   any
	savedAt time.Time
	ttl     time.Duration
}

type cacheCall struct {
	done  chan struct{}
	value any
	err   error
}

// Cache is an in-memory TTL store for Stockbit reads. It is deliberately not
// persisted: the session file is the durable thing, and a restart is allowed
// to re-read a quote.
type Cache struct {
	mu       sync.Mutex
	now      func() time.Time
	entries  map[string]cacheEntry
	inflight map[string]*cacheCall
	hits     int
	misses   int
}

// NewCache builds an empty cache.
func NewCache() *Cache {
	return &Cache{now: time.Now, entries: map[string]cacheEntry{}, inflight: map[string]*cacheCall{}}
}

// GetOrLoad serves a fresh entry or loads and stores one. Concurrent misses for
// the same key share a single upstream call. Errors are never cached.
func (c *Cache) GetOrLoad(key string, ttl time.Duration, refresh bool, load func() (any, error)) (any, CacheInfo, error) {
	info := CacheInfo{Key: key, TTLSeconds: int(ttl.Seconds())}
	c.mu.Lock()
	if call, ok := c.inflight[key]; ok {
		c.mu.Unlock()
		<-call.done
		return call.value, info, call.err
	}
	if !refresh {
		if entry, ok := c.entries[key]; ok {
			age := c.now().Sub(entry.savedAt)
			if age <= entry.ttl {
				c.hits++
				info.Hit = true
				info.AgeSeconds = int(age.Seconds())
				value := entry.value
				c.mu.Unlock()
				return value, info, nil
			}
		}
	} else {
		delete(c.entries, key)
	}
	c.misses++
	call := &cacheCall{done: make(chan struct{})}
	c.inflight[key] = call
	c.mu.Unlock()

	value, err := load()

	c.mu.Lock()
	delete(c.inflight, key)
	call.value = value
	call.err = err
	if err == nil && value != nil {
		c.entries[key] = cacheEntry{value: value, savedAt: c.now(), ttl: ttl}
	}
	c.mu.Unlock()
	close(call.done)
	return value, info, err
}

// Len is the number of live or stale entries.
func (c *Cache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.entries)
}

// Stats is the cache panel payload.
func (c *Cache) Stats() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	keys := make([]string, 0, len(c.entries))
	for key := range c.entries {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return map[string]any{
		"entries": len(c.entries),
		"keys":    keys,
		"hits":    c.hits,
		"misses":  c.misses,
		"note":    "Stockbit reads only. Session cookies live in the session file, not here.",
	}
}

// Clear empties the data cache and reports how many entries were removed.
func (c *Cache) Clear() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	removed := len(c.entries)
	c.entries = map[string]cacheEntry{}
	return removed
}
