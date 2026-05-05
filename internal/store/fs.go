package store

import "os"

// mkdirAll wraps os.MkdirAll so the data-directory creation is testable
// in isolation later. Behavior matches the stdlib (creates parents,
// no-op if exists).
func mkdirAll(dir string) error {
	return os.MkdirAll(dir, 0o755)
}
