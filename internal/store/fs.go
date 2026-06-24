package store

import "os"

const dataDirPerm = 0o750

// mkdirAll wraps os.MkdirAll so the data-directory creation is testable
// in isolation later. Behavior matches the stdlib (creates parents,
// no-op if exists).
func mkdirAll(dir string) error {
	return wrapErr(
		os.MkdirAll(dir, dataDirPerm),
		"mkdir data dir",
	)
}
