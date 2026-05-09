// Package secrets owns at-rest encryption for sensitive values stored
// in the local SQLite DB — the Mailtrap cloud API token, the SMTP relay
// password, the webhook signing secret.
//
// Threat model: a localhost-only dev tool. The DB file may end up in
// backups, disk images, or accidentally-shared `data/` directories.
// Plaintext credentials in there are bad. The encryption is **defense
// in depth** — anyone with simultaneous read access to both the DB
// file *and* the key file can still decrypt. We don't pretend
// otherwise. The win is that a casual `cp data/*.sqlite3` doesn't
// leak credentials by itself.
//
// Crypto: AES-256-GCM. Key = 32 random bytes auto-generated on first
// use, persisted at ${XDG_CONFIG_HOME:-~/.config}/mailtrap-local/secret.key
// (override with $MAILTRAP_LOCAL_SECRET_KEY_FILE). Mode 0600.
//
// Wire format on disk:   "enc:v1:<base64(nonce|ciphertext|tag)>"
// We prefix with "enc:v1:" so the read path can tell encrypted bytes
// from legacy plaintext (rows written by older binaries) and migrate
// transparently on next write.
package secrets

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Prefix marks a stored value as encrypted. Read code that doesn't
// see this prefix should treat the value as legacy plaintext (and
// re-encrypt on next write to migrate it forward).
const Prefix = "enc:v1:"

// Box is a thread-safe encrypter/decrypter using a single 32-byte key.
type Box struct {
	gcm cipher.AEAD
}

// New constructs a Box from a 32-byte key.
func New(key []byte) (*Box, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("secrets: key must be 32 bytes, got %d", len(key))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("secrets: aes init: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("secrets: gcm init: %w", err)
	}
	return &Box{gcm: gcm}, nil
}

// Encrypt returns Prefix+base64(nonce|ciphertext|tag). Empty strings
// pass through unchanged so callers don't need to special-case the
// "no value set" path.
func (b *Box) Encrypt(plaintext string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	nonce := make([]byte, b.gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", fmt.Errorf("secrets: nonce: %w", err)
	}
	ct := b.gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return Prefix + base64.RawStdEncoding.EncodeToString(ct), nil
}

// Decrypt reverses Encrypt. Values without Prefix are treated as
// legacy plaintext and returned as-is — the caller can detect the
// migration case by also checking IsEncrypted.
func (b *Box) Decrypt(stored string) (string, error) {
	if stored == "" {
		return "", nil
	}
	if !strings.HasPrefix(stored, Prefix) {
		// Legacy plaintext — return as-is. Caller may choose to
		// re-encrypt on next write to migrate.
		return stored, nil
	}
	raw, err := base64.RawStdEncoding.DecodeString(stored[len(Prefix):])
	if err != nil {
		return "", fmt.Errorf("secrets: base64: %w", err)
	}
	if len(raw) < b.gcm.NonceSize() {
		return "", errors.New("secrets: ciphertext too short")
	}
	nonce, ct := raw[:b.gcm.NonceSize()], raw[b.gcm.NonceSize():]
	pt, err := b.gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", fmt.Errorf("secrets: open: %w", err)
	}
	return string(pt), nil
}

// IsEncrypted reports whether `stored` is in the encrypted wire
// format. Useful for migration logic ("if !IsEncrypted, re-encrypt
// on next write").
func IsEncrypted(stored string) bool {
	return strings.HasPrefix(stored, Prefix)
}

// ---------------------------------------------------------------------
// Key file management
// ---------------------------------------------------------------------

// DefaultKeyPath returns the file the binary auto-generates a key at on
// first use, unless overridden by $MAILTRAP_LOCAL_SECRET_KEY_FILE.
//
//	$MAILTRAP_LOCAL_SECRET_KEY_FILE                 — explicit override
//	$XDG_CONFIG_HOME/mailtrap-local/secret.key      — XDG-respecting default
//	~/.config/mailtrap-local/secret.key             — fallback
func DefaultKeyPath() (string, error) {
	if p := os.Getenv("MAILTRAP_LOCAL_SECRET_KEY_FILE"); p != "" {
		return p, nil
	}
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("secrets: $HOME unreadable: %w", err)
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "mailtrap-local", "secret.key"), nil
}

// LoadOrCreateKey returns the 32-byte key from `path`, generating one
// (mode 0600) if the file doesn't exist. The caller usually passes
// DefaultKeyPath().
//
// Concurrency: a process-wide mutex guards the create-once code path.
// Multiple boots racing for the same file is not a normal scenario,
// but the mutex makes the test-suite happy.
var keyFileMu sync.Mutex

func LoadOrCreateKey(path string) ([]byte, error) {
	keyFileMu.Lock()
	defer keyFileMu.Unlock()

	// Existing key
	if data, err := os.ReadFile(path); err == nil {
		if len(data) != 32 {
			return nil, fmt.Errorf("secrets: %s: expected 32 bytes, got %d", path, len(data))
		}
		return data, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("secrets: read %s: %w", path, err)
	}

	// Generate a fresh key, persist with strict permissions.
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("secrets: mkdir: %w", err)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("secrets: rand: %w", err)
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, fmt.Errorf("secrets: write %s: %w", path, err)
	}
	return key, nil
}

// FromDefaultKeyFile is the most-common entrypoint: resolve the key
// path, ensure a key exists, return a ready-to-use Box.
func FromDefaultKeyFile() (*Box, error) {
	path, err := DefaultKeyPath()
	if err != nil {
		return nil, err
	}
	key, err := LoadOrCreateKey(path)
	if err != nil {
		return nil, err
	}
	return New(key)
}
