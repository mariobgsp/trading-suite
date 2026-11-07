package web

import _ "embed"

// Index is the single-page control panel. It is embedded so the binary has no
// runtime asset directory.
//
//go:embed index.html
var Index []byte
