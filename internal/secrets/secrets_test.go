package secrets

import (
	"crypto/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEncryptRoundTrip(t *testing.T) {
	t.Parallel()
	key := make([]byte, 32)
	_, _ = rand.Read(key)
	box, err := New(key)
	require.NoError(t, err)

	cases := []string{
		"",
		"hello",
		"sandbox-token-abc123",
		"a really long secret with spaces, $hell punctuation, & 🔒 emoji",
		strings.Repeat("x", 4096),
	}
	for _, want := range cases {
		ct, err := box.Encrypt(want)
		require.NoError(t, err)
		got, err := box.Decrypt(ct)
		require.NoError(t, err)
		assert.Equal(t, want, got)
	}
}

func TestEncryptEmptyPassthrough(t *testing.T) {
	t.Parallel()
	box, _ := New(make([]byte, 32))
	ct, err := box.Encrypt("")
	require.NoError(t, err)
	assert.Empty(t, ct)
	pt, err := box.Decrypt("")
	require.NoError(t, err)
	assert.Empty(t, pt)
}

func TestEncryptIsRandomized(t *testing.T) {
	t.Parallel()
	box, _ := New(make([]byte, 32))
	a, _ := box.Encrypt("same input")
	b, _ := box.Encrypt("same input")
	assert.NotEqual(t, a, b)
}

func TestEncryptHasPrefix(t *testing.T) {
	t.Parallel()
	box, _ := New(make([]byte, 32))
	ct, _ := box.Encrypt("anything")
	assert.True(t, strings.HasPrefix(ct, Prefix))
	assert.True(t, IsEncrypted(ct))
	assert.False(t, IsEncrypted("plain old plaintext"))
}

// TestDecryptLegacyPlaintext — values that pre-date the encryption
// migration (no prefix) come through verbatim, so the read path can
// treat them as legacy and re-encrypt on next write.
func TestDecryptLegacyPlaintext(t *testing.T) {
	t.Parallel()
	box, _ := New(make([]byte, 32))
	got, err := box.Decrypt("plain-token-no-prefix")
	require.NoError(t, err)
	assert.Equal(t, "plain-token-no-prefix", got)
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
			_, err := box.Decrypt(c.input)
			assert.Error(t, err)
		})
	}
}

func TestKeyMustBe32Bytes(t *testing.T) {
	t.Parallel()
	for _, n := range []int{0, 16, 31, 33, 64} {
		_, err := New(make([]byte, n))
		assert.Error(t, err)
	}
}

func TestLoadOrCreateKey(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "mailtrap-local", "secret.key")

	key1, err := LoadOrCreateKey(path)
	require.NoError(t, err)
	assert.Len(t, key1, 32)

	key2, err := LoadOrCreateKey(path)
	require.NoError(t, err)
	assert.Equal(t, string(key1), string(key2))

	st, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), st.Mode().Perm())
}

func TestLoadOrCreateKeyRejectsWrongSize(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "secret.key")
	require.NoError(t, os.WriteFile(path, []byte("too short"), 0o600))
	_, err := LoadOrCreateKey(path)
	assert.Error(t, err)
}

func TestDefaultKeyPathHonorsEnv(t *testing.T) {
	t.Setenv("MAILTRAP_LOCAL_SECRET_KEY_FILE", "/tmp/explicit/secret.key")
	got, err := DefaultKeyPath()
	require.NoError(t, err)
	assert.Equal(t, "/tmp/explicit/secret.key", got)
}

func TestDefaultKeyPathHonorsXDG(t *testing.T) {
	t.Setenv("MAILTRAP_LOCAL_SECRET_KEY_FILE", "")
	t.Setenv("XDG_CONFIG_HOME", "/tmp/xdg")
	got, err := DefaultKeyPath()
	require.NoError(t, err)
	assert.Equal(t, "/tmp/xdg/mailtrap-local/secret.key", got)
}
