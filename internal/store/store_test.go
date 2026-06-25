package store

import (
	"context"
	"crypto/rand"
	"testing"

	"github.com/mailtrap/mailtrap-local/internal/secrets"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// withSecrets wraps a Store with a freshly-keyed secrets.Box. Used by
// the encryption tests; the default newTestStore stays unencrypted so
// the rest of the suite reads SQL columns verbatim.
func withSecrets(t *testing.T, s *Store) *Store {
	t.Helper()
	key := make([]byte, 32)
	_, err := rand.Read(key)
	require.NoError(t, err)
	box, err := secrets.New(key)
	require.NoError(t, err)
	s.SetSecrets(box)
	return s
}

// helper — a Store backed by :memory:. Each test gets a fresh DB so
// they're independent under -parallel.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenMemory()
	require.NoError(t, err)
	t.Cleanup(func() { _ = s.Close() })
	return s
}

// fixturePayload returns a deterministic IngestPayload for round-trip
// tests. Single recipient, single attachment.
func fixturePayload(subject, fromAddr, toAddr, category string) *IngestPayload {
	return &IngestPayload{
		SMTPFrom:  fromAddr,
		SMTPTo:    []string{toAddr},
		MessageID: "<msg-" + subject + "@test>",
		From:      &Address{Name: "Sender", Address: fromAddr},
		To:        []Address{{Name: "Recipient", Address: toAddr}},
		Subject:   subject,
		Category:  category,
		Text:      "Hello " + subject,
		HTML:      "<p>Hello " + subject + "</p>",
		Raw:       []byte("From: " + fromAddr + "\r\nSubject: " + subject + "\r\n\r\nbody\r\n"),
		Snippet:   "Hello " + subject,
	}
}

func TestInsertAndGet(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	id, err := s.Insert(ctx, fixturePayload("Welcome", "a@x.test", "b@y.test", "welcome"))
	require.NoError(t, err)
	require.NotEmpty(t, id)

	m, err := s.Get(ctx, id)
	require.NoError(t, err)
	assert.Equal(t, "Welcome", m.Subject)
	assert.Equal(t, "a@x.test", m.FromAddress)
	require.Len(t, m.ToAddresses, 1)
	assert.Equal(t, "b@y.test", m.ToAddresses[0].Address)
	require.NotNil(t, m.Category)
	assert.Equal(t, "welcome", *m.Category)
	assert.False(t, m.Read())
	assert.Equal(t, "b@y.test", m.RecipientsText)
}

func TestGetLatestAlias(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	_, _ = s.Insert(ctx, fixturePayload("first", "a@x", "b@y", ""))
	id2, _ := s.Insert(ctx, fixturePayload("second", "a@x", "b@y", ""))

	m, err := s.Get(ctx, "latest")
	require.NoError(t, err)
	assert.Equal(t, id2, m.ID)
}

func TestGetNotFound(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)

	_, err := s.Get(context.Background(), "nonexistent")
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestList(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	_, _ = s.Insert(ctx, fixturePayload("first", "a@x", "b@y", "welcome"))
	_, _ = s.Insert(ctx, fixturePayload("second", "a@x", "b@y", "newsletter"))
	_, _ = s.Insert(ctx, fixturePayload("third", "a@x", "b@y", "welcome"))

	res, err := s.List(ctx, ListOpts{Limit: 50})
	require.NoError(t, err)
	assert.Equal(t, 3, res.Total)
	assert.Equal(t, 3, res.Unread)
	require.Len(t, res.Messages, 3)
	// Newest-first ordering
	assert.Equal(t, "third", res.Messages[0].Subject)

	// AllCategories — distinct, sorted
	want := []string{"newsletter", "welcome"}
	assert.Equal(t, want, res.AllCategories)

	// Filter by category
	res, _ = s.List(ctx, ListOpts{Limit: 50, Category: "welcome"})
	assert.Equal(t, 2, res.Total)
}

func TestMarkReadAndUnread(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	id1, _ := s.Insert(ctx, fixturePayload("a", "a@x", "b@y", ""))
	id2, _ := s.Insert(ctx, fixturePayload("b", "a@x", "b@y", ""))

	// Single
	require.NoError(t, s.MarkAsRead(ctx, id1))
	m, _ := s.Get(ctx, id1)
	assert.True(t, m.Read())
	m, _ = s.Get(ctx, id2)
	assert.False(t, m.Read())

	// Bulk to unread
	require.NoError(t, s.MarkRead(ctx, false))
	m, _ = s.Get(ctx, id1)
	assert.False(t, m.Read())

	// Bulk to read
	require.NoError(t, s.MarkRead(ctx, true))
	m, _ = s.Get(ctx, id2)
	assert.True(t, m.Read())
}

func TestDelete(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	id1, _ := s.Insert(ctx, fixturePayload("a", "a@x", "b@y", ""))
	id2, _ := s.Insert(ctx, fixturePayload("b", "a@x", "b@y", ""))
	_, _ = s.Insert(ctx, fixturePayload("c", "a@x", "b@y", ""))

	deleted, err := s.Delete(ctx, id1, id2)
	require.NoError(t, err)
	assert.Len(t, deleted, 2)

	res, _ := s.List(ctx, ListOpts{Limit: 50})
	assert.Equal(t, 1, res.Total)

	// Empty IDs == truncate
	all, err := s.Delete(ctx)
	require.NoError(t, err)
	assert.Len(t, all, 1)
	res, _ = s.List(ctx, ListOpts{Limit: 50})
	assert.Equal(t, 0, res.Total)
}

func TestSearchMultiTokenAnd(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	_, _ = s.Insert(ctx, fixturePayload("Welcome aboard", "a@x.test", "alice@example.com", "welcome"))
	_, _ = s.Insert(ctx, fixturePayload("Reset your password", "auth@x.test", "alice@example.com", "transactional"))
	_, _ = s.Insert(ctx, fixturePayload("Receipt #1234", "billing@x.test", "alice@example.com", "billing"))

	cases := []struct {
		name, query string
		wantCount   int
	}{
		{"single token by subject", "welcome", 1},
		{"single token by from", "billing", 1},
		{"single token by recipient", "alice@example", 3},
		{"AND across columns — only Welcome row matches both", "welcome alice", 1},
		{"AND with no overlap", "welcome billing", 0},
		{"case insensitive", "WELCOME", 1},
		{"empty query yields nothing", "", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := s.Search(ctx, SearchOpts{Query: tc.query, Limit: 50})
			require.NoError(t, err)
			got := len(res.Messages)
			assert.Equal(t, tc.wantCount, got)
		})
	}
}

// Existing DBs that predate the FTS5 index have rows in `messages`
// but nothing in `messages_fts` — Open() should rebuild the index on
// first boot so Search works without requiring a re-ingest.
func TestSearchBackfillsOnOpen(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	// Insert two rows, then wipe the FTS index to simulate an
	// upgraded-from-pre-FTS5 DB.
	_, _ = s.Insert(ctx, fixturePayload("Hello FTS world", "a@x", "b@y", ""))
	_, _ = s.Insert(ctx, fixturePayload("Goodbye later", "c@x", "d@y", ""))
	_, err := s.db.Exec(`INSERT INTO messages_fts(messages_fts) VALUES('delete-all')`)
	require.NoError(t, err)
	// Sanity: search returns nothing now (FTS index is empty).
	res, _ := s.Search(ctx, SearchOpts{Query: "hello", Limit: 50})
	require.Empty(t, res.Messages)

	// Re-running applySchema() triggers the backfill path.
	require.NoError(t, s.applySchema())
	// fixturePayload puts "Hello <subject>" in Text for every row, so
	// both rows match — we just want non-zero, indicating the index
	// was rebuilt from the existing content table.
	res, _ = s.Search(ctx, SearchOpts{Query: "hello", Limit: 50})
	assert.Len(t, res.Messages, 2)
	res, _ = s.Search(ctx, SearchOpts{Query: "goodbye", Limit: 50})
	assert.Len(t, res.Messages, 1)
}

// QA caught a bug: search was only matching complete words. Typing a
// partial word should still find messages whose tokens start with it.
func TestSearchPrefixMatch(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	_, _ = s.Insert(ctx, fixturePayload("Welcome aboard", "a@x.test", "alice@example.com", ""))
	_, _ = s.Insert(ctx, fixturePayload("Receipt #1234", "b@x.test", "bob@example.com", ""))

	cases := []struct {
		name, query string
		want        int
	}{
		{"subject prefix", "wel", 1},
		{"subject longer prefix", "welco", 1},
		{"recipient prefix", "ali", 1},
		{"from prefix", "billi", 0}, // 'billi' shouldn't match — no row starts a token with that
		{"no match", "zzzzz", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := s.Search(ctx, SearchOpts{Query: tc.query, Limit: 50})
			require.NoError(t, err)
			got := len(res.Messages)
			assert.Equal(t, tc.want, got)
		})
	}
}

func TestSearchEscapesLikeWildcards(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	// "50%" should match the literal % only — not act as a LIKE wildcard.
	p := fixturePayload("50% off this week", "a@x", "b@y", "")
	p.Text = "Promo 50% off"
	_, _ = s.Insert(ctx, p)

	noPercent := fixturePayload("Receipt #1234", "a@x", "b@y", "")
	_, _ = s.Insert(ctx, noPercent)

	res, err := s.Search(ctx, SearchOpts{Query: "50%", Limit: 50})
	require.NoError(t, err)
	require.Len(t, res.Messages, 1)
	assert.Contains(t, res.Messages[0].Subject, "50%")
}

func TestConnectionsCRUD(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	// Cloud
	require.NoError(t, s.CloudUpsert(ctx, &CloudConnection{
		APIToken: "tok", SandboxID: 1234, MirrorEnabled: true,
	}))
	c, err := s.CloudGet(ctx)
	require.NoError(t, err)
	assert.Equal(t, int64(1234), c.SandboxID)
	assert.True(t, c.MirrorEnabled)
	_ = s.CloudDelete(ctx)
	_, err = s.CloudGet(ctx)
	assert.ErrorIs(t, err, ErrNotFound)

	// Relay
	require.NoError(t, s.RelayUpsert(ctx, &RelayConnection{
		Host: "smtp.example.com", Port: 587,
		Username: "u", Password: "p",
		Auth: "plain", TLS: "auto",
		AutoRelayEnabled: true,
		OverrideFrom:     "noreply@verified.test",
	}))
	r, err := s.RelayGet(ctx)
	require.NoError(t, err)
	assert.Equal(t, "smtp.example.com", r.Host)
	assert.True(t, r.AutoRelayEnabled)
	assert.Equal(t, "noreply@verified.test", r.OverrideFrom)

	// Webhook
	require.NoError(t, s.WebhookUpsert(ctx, &WebhookConnection{
		URL: "https://hooks.example.com/x", Secret: "shh", Enabled: true,
	}))
	w, err := s.WebhookGet(ctx)
	require.NoError(t, err)
	assert.NotEmpty(t, w.URL)
	assert.True(t, w.Enabled)
	assert.Equal(t, "shh", w.Secret)
}

func TestRetentionEvictsByCascade(t *testing.T) {
	// Smoke that attachment rows go away when their parent message is
	// deleted — confirms the FK CASCADE in schema.sql actually runs.
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	p := fixturePayload("with-att", "a@x", "b@y", "")
	p.Attachments = []PartIn{{
		PartID: "1", Filename: "x.txt", ContentType: "text/plain",
		Size: 5, Content: []byte("hello"),
	}}
	id, _ := s.Insert(ctx, p)

	atts, _ := s.LoadAttachments(ctx, id)
	require.Len(t, atts, 1)

	_, err := s.Delete(ctx, id)
	require.NoError(t, err)
	atts, _ = s.LoadAttachments(ctx, id)
	assert.Empty(t, atts)
}

// TestSecretsEncryptedAtRest — with a Box attached, every sensitive
// column actually contains ciphertext (not the plaintext) on disk,
// and the user-facing Get/Upsert API still returns plaintext.
func TestSecretsEncryptedAtRest(t *testing.T) {
	t.Parallel()
	s := withSecrets(t, newTestStore(t))
	ctx := context.Background()

	const (
		token  = "sandbox-tok-secret-abc"
		passwd = "smtp-relay-passw0rd"
		whSec  = "webhook-shh-shh"
	)
	require.NoError(t, s.CloudUpsert(ctx, &CloudConnection{APIToken: token, SandboxID: 7}))
	require.NoError(t, s.RelayUpsert(ctx, &RelayConnection{
		Host: "smtp.x", Port: 587, Username: "u", Password: passwd, Auth: "plain", TLS: "auto",
	}))
	require.NoError(t, s.WebhookUpsert(ctx, &WebhookConnection{
		URL: "https://h.x/", Secret: whSec, Enabled: true,
	}))

	// Raw DB rows must NOT contain the plaintext anywhere.
	var rawTok, rawPass, rawSec string
	_ = s.DB().QueryRowContext(ctx, `SELECT api_token FROM cloud_connections`).Scan(&rawTok)
	_ = s.DB().QueryRowContext(ctx, `SELECT password FROM relay_connections`).Scan(&rawPass)
	_ = s.DB().QueryRowContext(ctx, `SELECT secret FROM webhook_connections`).Scan(&rawSec)

	assert.NotContains(t, rawTok, token)
	assert.NotContains(t, rawPass, passwd)
	assert.NotContains(t, rawSec, whSec)
	for _, raw := range []string{rawTok, rawPass, rawSec} {
		assert.True(t, secrets.IsEncrypted(raw))
	}

	// Round-trip via the public API still yields plaintext.
	c, _ := s.CloudGet(ctx)
	r, _ := s.RelayGet(ctx)
	w, _ := s.WebhookGet(ctx)
	assert.Equal(t, token, c.APIToken)
	assert.Equal(t, passwd, r.Password)
	assert.Equal(t, whSec, w.Secret)
}

// TestSecretsLazyMigratesPlaintext — rows written by an old binary
// (plaintext, no Box) are returned correctly by Get and re-written as
// ciphertext on the same call. Subsequent reads see ciphertext only.
func TestSecretsLazyMigratesPlaintext(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	// 1. Write rows the OLD way (no encryption box attached).
	_ = s.CloudUpsert(ctx, &CloudConnection{APIToken: "legacy-tok", SandboxID: 1})
	_ = s.RelayUpsert(ctx, &RelayConnection{Host: "h", Port: 1, Password: "legacy-pass", Auth: "plain", TLS: "auto"})
	_ = s.WebhookUpsert(ctx, &WebhookConnection{URL: "https://h", Secret: "legacy-sec", Enabled: true})

	// Confirm: no prefix, plaintext on disk.
	var rawTok string
	_ = s.DB().QueryRowContext(ctx, `SELECT api_token FROM cloud_connections`).Scan(&rawTok)
	require.Equal(t, "legacy-tok", rawTok)

	// 2. Attach a Box and read. Get should return plaintext AND
	//    re-encrypt the row in place.
	withSecrets(t, s)

	c, err := s.CloudGet(ctx)
	require.NoError(t, err)
	require.Equal(t, "legacy-tok", c.APIToken)
	r, err := s.RelayGet(ctx)
	require.NoError(t, err)
	require.Equal(t, "legacy-pass", r.Password)
	w, err := s.WebhookGet(ctx)
	require.NoError(t, err)
	require.Equal(t, "legacy-sec", w.Secret)

	// 3. The rows on disk are now encrypted.
	_ = s.DB().QueryRowContext(ctx, `SELECT api_token FROM cloud_connections`).Scan(&rawTok)
	assert.True(t, secrets.IsEncrypted(rawTok))
	var rawPass, rawSec string
	_ = s.DB().QueryRowContext(ctx, `SELECT password FROM relay_connections`).Scan(&rawPass)
	_ = s.DB().QueryRowContext(ctx, `SELECT secret FROM webhook_connections`).Scan(&rawSec)
	assert.True(t, secrets.IsEncrypted(rawPass))
	assert.True(t, secrets.IsEncrypted(rawSec))
}
