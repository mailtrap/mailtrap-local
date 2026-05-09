package secrets

import (
	"crypto/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEncryptRoundTrip(t *testing.T) {
	t.Parallel()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, err := New(key)
	if err != nil {
		t.Fatal(err)
	}

	cases := []string{
		"",
		"hello",
		"sandbox-token-abc123",
		"a really long secret with spaces, $hell punctuation, & 🔒 emoji",
		strings.Repeat("x", 4096),
	}
	for _, want := range cases {
		ct, err := box.Encrypt(want)
		if err != nil {
			t.Fatalf("encrypt %q: %v", want, err)
		}
		got, err := box.Decrypt(ct)
		if err != nil {
			t.Fatalf("decrypt %q (ct=%q): %v", want, ct, err)
		}
		if got != want {
			t.Errorf("round-trip: got %q, want %q", got, want)
		}
	}
}

func TestEncryptEmptyPassthrough(t *testing.T) {
	t.Parallel()
	box, _ := New(make([]byte, 32))
	ct, err := box.Encrypt("")
	if err != nil {
		t.Fatal(err)
	}
	if ct != "" {
		t.Errorf("empty plaintext should encrypt to empty, got %q", ct)
	}
	pt, err := box.Decrypt("")
	if err != nil {
		t.Fatal(err)
	}
	if pt != "" {
		t.Errorf("empty ciphertext should decrypt to empty, got %q", pt)
	}
}

func TestEncryptIsRandomized(t *testing.T) {
	t.Parallel()
	box, _ := New(make([]byte, 32))
	a, _ := box.Encrypt("same input")
	b, _ := box.Encrypt("same input")
	if a == b {
		t.Errorf("two encryptions of the same plaintext produced identical output — nonce reuse?\n  a=%q b=%q", a, b)
	}
}

func TestEncryptHasPrefix(t *testing.T) {
	t.Parallel()
	box, _ := New(make([]byte, 32))
	ct, _ := box.Encrypt("anything")
	if !strings.HasPrefix(ct, Prefix) {
		t.Errorf("ciphertext missing %q prefix: %q", Prefix, ct)
	}
	if !IsEncrypted(ct) {
		t.Errorf("IsEncrypted(%q) should be true", ct)
	}
	if IsEncrypted("plain old plaintext") {
		t.Errorf("IsEncrypted on plaintext should be false")
	}
}

// TestDecryptLegacyPlaintext — values that pre-date the encryption
// migration (no prefix) come through verbatim, so the read path can
// treat them as legacy and re-encrypt on next write.
func TestDecryptLegacyPlaintext(t *testing.T) {
	t.Parallel()
	box, _ := New(make([]byte, 32))
	got, err := box.Decrypt("plain-token-no-prefix")
	if err != nil {
		t.Fatal(err)
	}
	if got != "plain-token-no-prefix" {
		t.Errorf("legacy passthrough: got %q, want %q", got, "plain-token-no-prefix")
	}
}

func TestDecryptCorrupt(t *testing.T) {
	t.Parallel()
	box, _ := New(make([]byte, 32))
	cases := []struct{ name, input string }{
		{"truncated", Prefix + "AA"},
		{"bad base64", Prefix + "!!!not-base64!!!"},
		// valid base64 but tampered ciphertext bytes — GCM tag must reject.
		{"wrong key", func() string { b, _ := New(append(make([]byte, 31), 1)); ct, _ := b.Encrypt("x"); return ct }()},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, err := box.Decrypt(c.input); err == nil {
				t.Errorf("expected error for %s, got nil", c.name)
			}
		})
	}
}

func TestKeyMustBe32Bytes(t *testing.T) {
	t.Parallel()
	for _, n := range []int{0, 16, 31, 33, 64} {
		if _, err := New(make([]byte, n)); err == nil {
			t.Errorf("New(%d-byte key) should error", n)
		}
	}
}

func TestLoadOrCreateKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mailtrap-local", "secret.key")

	key1, err := LoadOrCreateKey(path)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}
	if len(key1) != 32 {
		t.Errorf("expected 32-byte key, got %d", len(key1))
	}

	// Second call should return the same bytes.
	key2, err := LoadOrCreateKey(path)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}
	if string(key1) != string(key2) {
		t.Errorf("key changed between loads — should persist on disk")
	}

	// File mode should be 0600.
	st, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if mode := st.Mode().Perm(); mode != 0o600 {
		t.Errorf("key file mode = %v, want 0600", mode)
	}
}

func TestLoadOrCreateKeyRejectsWrongSize(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret.key")
	if err := os.WriteFile(path, []byte("too short"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreateKey(path); err == nil {
		t.Errorf("expected error on wrong-size key file")
	}
}

func TestDefaultKeyPathHonorsEnv(t *testing.T) {
	t.Setenv("MAILTRAP_LOCAL_SECRET_KEY_FILE", "/tmp/explicit/secret.key")
	got, err := DefaultKeyPath()
	if err != nil {
		t.Fatal(err)
	}
	if got != "/tmp/explicit/secret.key" {
		t.Errorf("explicit override ignored: got %q", got)
	}
}

func TestDefaultKeyPathHonorsXDG(t *testing.T) {
	t.Setenv("MAILTRAP_LOCAL_SECRET_KEY_FILE", "")
	t.Setenv("XDG_CONFIG_HOME", "/tmp/xdg")
	got, err := DefaultKeyPath()
	if err != nil {
		t.Fatal(err)
	}
	want := "/tmp/xdg/mailtrap-local/secret.key"
	if got != want {
		t.Errorf("XDG path: got %q, want %q", got, want)
	}
}
