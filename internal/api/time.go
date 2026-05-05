package api

import "time"

// timeNow is a small indirection so tests can freeze the clock if they
// need to. Not currently swapped, but cheap to keep.
func timeNow() time.Time { return time.Now().UTC() }
