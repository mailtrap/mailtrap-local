package store

import (
	"context"
	"crypto/rand"
	"strings"
	"testing"

	"github.com/mailtrap/mailtrap-local/internal/secrets"
)

// withSecrets wraps a Store with a freshly-keyed secrets.Box. Used by
// the encryption tests; the default newTestStore stays unencrypted so
// the rest of the suite reads SQL columns verbatim.
func withSecrets(t *testing.T, s *Store) *Store {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	box, err := secrets.New(key)
	if err != nil {
		t.Fatal(err)
	}
	s.SetSecrets(box)
	return s
}

// helper — a Store backed by :memory:. Each test gets a fresh DB so
// they're independent under -parallel.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := OpenMemory()
	if err != nil {
		t.Fatalf("open memory store: %v", err)
	}
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
	if err != nil {
		t.Fatalf("insert: %v", err)
	}
	if id == "" {
		t.Fatal("expected a non-empty ID")
	}

	m, err := s.Get(ctx, id)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if m.Subject != "Welcome" {
		t.Errorf("subject = %q, want Welcome", m.Subject)
	}
	if m.FromAddress != "a@x.test" {
		t.Errorf("from = %q, want a@x.test", m.FromAddress)
	}
	if len(m.ToAddresses) != 1 || m.ToAddresses[0].Address != "b@y.test" {
		t.Errorf("to = %v, want [b@y.test]", m.ToAddresses)
	}
	if m.Category == nil || *m.Category != "welcome" {
		t.Errorf("category = %v, want 'welcome'", m.Category)
	}
	if m.Read() {
		t.Error("expected Read=false on fresh insert")
	}
	if m.RecipientsText != "b@y.test" {
		t.Errorf("recipients_text = %q, want b@y.test", m.RecipientsText)
	}
}

func TestGetLatestAlias(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	_, _ = s.Insert(ctx, fixturePayload("first", "a@x", "b@y", ""))
	id2, _ := s.Insert(ctx, fixturePayload("second", "a@x", "b@y", ""))

	m, err := s.Get(ctx, "latest")
	if err != nil {
		t.Fatalf("get latest: %v", err)
	}
	if m.ID != id2 {
		t.Errorf("latest = %s, want %s", m.ID, id2)
	}
}

func TestGetNotFound(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)

	_, err := s.Get(context.Background(), "nonexistent")
	if err != ErrNotFound {
		t.Errorf("expected ErrNotFound, got %v", err)
	}
}

func TestList(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	_, _ = s.Insert(ctx, fixturePayload("first", "a@x", "b@y", "welcome"))
	_, _ = s.Insert(ctx, fixturePayload("second", "a@x", "b@y", "newsletter"))
	_, _ = s.Insert(ctx, fixturePayload("third", "a@x", "b@y", "welcome"))

	res, err := s.List(ctx, ListOpts{Limit: 50})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if res.Total != 3 || res.Unread != 3 {
		t.Errorf("total=%d unread=%d, want 3/3", res.Total, res.Unread)
	}
	if len(res.Messages) != 3 {
		t.Fatalf("got %d messages, want 3", len(res.Messages))
	}
	// Newest-first ordering
	if res.Messages[0].Subject != "third" {
		t.Errorf("first msg = %q, want 'third'", res.Messages[0].Subject)
	}

	// AllCategories — distinct, sorted
	want := []string{"newsletter", "welcome"}
	if !equalStrings(res.AllCategories, want) {
		t.Errorf("AllCategories = %v, want %v", res.AllCategories, want)
	}

	// Filter by category
	res, _ = s.List(ctx, ListOpts{Limit: 50, Category: "welcome"})
	if res.Total != 2 {
		t.Errorf("filtered total = %d, want 2", res.Total)
	}
}

func TestMarkReadAndUnread(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	id1, _ := s.Insert(ctx, fixturePayload("a", "a@x", "b@y", ""))
	id2, _ := s.Insert(ctx, fixturePayload("b", "a@x", "b@y", ""))

	// Single
	if err := s.MarkAsRead(ctx, id1); err != nil {
		t.Fatalf("mark as read: %v", err)
	}
	m, _ := s.Get(ctx, id1)
	if !m.Read() {
		t.Error("id1 expected to be read")
	}
	m, _ = s.Get(ctx, id2)
	if m.Read() {
		t.Error("id2 should still be unread")
	}

	// Bulk to unread
	if err := s.MarkRead(ctx, false); err != nil {
		t.Fatalf("bulk unread: %v", err)
	}
	m, _ = s.Get(ctx, id1)
	if m.Read() {
		t.Error("after bulk unread, id1 should be unread")
	}

	// Bulk to read
	if err := s.MarkRead(ctx, true); err != nil {
		t.Fatalf("bulk read: %v", err)
	}
	m, _ = s.Get(ctx, id2)
	if !m.Read() {
		t.Error("after bulk read, id2 should be read")
	}
}

func TestDelete(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	id1, _ := s.Insert(ctx, fixturePayload("a", "a@x", "b@y", ""))
	id2, _ := s.Insert(ctx, fixturePayload("b", "a@x", "b@y", ""))
	_, _ = s.Insert(ctx, fixturePayload("c", "a@x", "b@y", ""))

	deleted, err := s.Delete(ctx, id1, id2)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if len(deleted) != 2 {
		t.Errorf("deleted ids count = %d, want 2", len(deleted))
	}

	res, _ := s.List(ctx, ListOpts{Limit: 50})
	if res.Total != 1 {
		t.Errorf("after delete, total = %d, want 1", res.Total)
	}

	// Empty IDs == truncate
	all, err := s.Delete(ctx)
	if err != nil {
		t.Fatalf("delete all: %v", err)
	}
	if len(all) != 1 {
		t.Errorf("delete all returned %d ids, want 1", len(all))
	}
	res, _ = s.List(ctx, ListOpts{Limit: 50})
	if res.Total != 0 {
		t.Errorf("after delete all, total = %d, want 0", res.Total)
	}
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
			if err != nil {
				t.Fatalf("search: %v", err)
			}
			got := len(res.Messages)
			if got != tc.wantCount {
				t.Errorf("query %q: got %d messages, want %d", tc.query, got, tc.wantCount)
			}
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
	if _, err := s.db.Exec(`INSERT INTO messages_fts(messages_fts) VALUES('delete-all')`); err != nil {
		t.Fatalf("simulate stale FTS: %v", err)
	}
	// Sanity: search returns nothing now (FTS index is empty).
	res, _ := s.Search(ctx, SearchOpts{Query: "hello", Limit: 50})
	if len(res.Messages) != 0 {
		t.Fatalf("pre-backfill search should return 0, got %d", len(res.Messages))
	}

	// Re-running applySchema() triggers the backfill path.
	if err := s.applySchema(); err != nil {
		t.Fatal(err)
	}
	// fixturePayload puts "Hello <subject>" in Text for every row, so
	// both rows match — we just want non-zero, indicating the index
	// was rebuilt from the existing content table.
	res, _ = s.Search(ctx, SearchOpts{Query: "hello", Limit: 50})
	if len(res.Messages) != 2 {
		t.Errorf("after backfill: search for 'hello' returned %d, want 2", len(res.Messages))
	}
	res, _ = s.Search(ctx, SearchOpts{Query: "goodbye", Limit: 50})
	if len(res.Messages) != 1 {
		t.Errorf("after backfill: search for 'goodbye' returned %d, want 1", len(res.Messages))
	}
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
			if err != nil {
				t.Fatalf("search: %v", err)
			}
			if got := len(res.Messages); got != tc.want {
				t.Errorf("query %q: got %d, want %d", tc.query, got, tc.want)
			}
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
	if err != nil {
		t.Fatalf("search: %v", err)
	}
	if len(res.Messages) != 1 || !strings.Contains(res.Messages[0].Subject, "50%") {
		t.Errorf("expected exactly the 50%% row; got %d results: %v",
			len(res.Messages), res.Messages)
	}
}

func TestConnectionsCRUD(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	// Cloud
	if err := s.CloudUpsert(ctx, &CloudConnection{
		APIToken: "tok", SandboxID: 1234, MirrorEnabled: true,
	}); err != nil {
		t.Fatalf("cloud upsert: %v", err)
	}
	c, err := s.CloudGet(ctx)
	if err != nil {
		t.Fatalf("cloud get: %v", err)
	}
	if c.SandboxID != 1234 || !c.MirrorEnabled {
		t.Errorf("cloud get = %+v", c)
	}
	_ = s.CloudDelete(ctx)
	if _, err := s.CloudGet(ctx); err != ErrNotFound {
		t.Errorf("after delete: %v, want ErrNotFound", err)
	}

	// Relay
	if err := s.RelayUpsert(ctx, &RelayConnection{
		Host: "smtp.example.com", Port: 587,
		Username: "u", Password: "p",
		Auth: "plain", TLS: "auto",
		AutoRelayEnabled: true,
		OverrideFrom:     "noreply@verified.test",
	}); err != nil {
		t.Fatalf("relay upsert: %v", err)
	}
	r, err := s.RelayGet(ctx)
	if err != nil {
		t.Fatalf("relay get: %v", err)
	}
	if r.Host != "smtp.example.com" || !r.AutoRelayEnabled || r.OverrideFrom != "noreply@verified.test" {
		t.Errorf("relay get = %+v", r)
	}

	// Webhook
	if err := s.WebhookUpsert(ctx, &WebhookConnection{
		URL: "https://hooks.example.com/x", Secret: "shh", Enabled: true,
	}); err != nil {
		t.Fatalf("webhook upsert: %v", err)
	}
	w, err := s.WebhookGet(ctx)
	if err != nil {
		t.Fatalf("webhook get: %v", err)
	}
	if w.URL == "" || !w.Enabled || w.Secret != "shh" {
		t.Errorf("webhook get = %+v", w)
	}
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
	if len(atts) != 1 {
		t.Fatalf("expected 1 attachment after insert, got %d", len(atts))
	}

	if _, err := s.Delete(ctx, id); err != nil {
		t.Fatalf("delete: %v", err)
	}
	atts, _ = s.LoadAttachments(ctx, id)
	if len(atts) != 0 {
		t.Errorf("expected 0 attachments after delete; got %d", len(atts))
	}
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
	if err := s.CloudUpsert(ctx, &CloudConnection{APIToken: token, SandboxID: 7}); err != nil {
		t.Fatal(err)
	}
	if err := s.RelayUpsert(ctx, &RelayConnection{
		Host: "smtp.x", Port: 587, Username: "u", Password: passwd, Auth: "plain", TLS: "auto",
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.WebhookUpsert(ctx, &WebhookConnection{
		URL: "https://h.x/", Secret: whSec, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}

	// Raw DB rows must NOT contain the plaintext anywhere.
	var rawTok, rawPass, rawSec string
	_ = s.DB().QueryRowContext(ctx, `SELECT api_token FROM cloud_connections`).Scan(&rawTok)
	_ = s.DB().QueryRowContext(ctx, `SELECT password FROM relay_connections`).Scan(&rawPass)
	_ = s.DB().QueryRowContext(ctx, `SELECT secret FROM webhook_connections`).Scan(&rawSec)

	if strings.Contains(rawTok, token) {
		t.Errorf("api_token row leaked plaintext: %q", rawTok)
	}
	if strings.Contains(rawPass, passwd) {
		t.Errorf("relay password row leaked plaintext: %q", rawPass)
	}
	if strings.Contains(rawSec, whSec) {
		t.Errorf("webhook secret row leaked plaintext: %q", rawSec)
	}
	for _, raw := range []string{rawTok, rawPass, rawSec} {
		if !secrets.IsEncrypted(raw) {
			t.Errorf("expected encrypted prefix on raw row, got %q", raw)
		}
	}

	// Round-trip via the public API still yields plaintext.
	c, _ := s.CloudGet(ctx)
	r, _ := s.RelayGet(ctx)
	w, _ := s.WebhookGet(ctx)
	if c.APIToken != token {
		t.Errorf("cloud APIToken round-trip: got %q, want %q", c.APIToken, token)
	}
	if r.Password != passwd {
		t.Errorf("relay Password round-trip: got %q, want %q", r.Password, passwd)
	}
	if w.Secret != whSec {
		t.Errorf("webhook Secret round-trip: got %q, want %q", w.Secret, whSec)
	}
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
	if rawTok != "legacy-tok" {
		t.Fatalf("setup: expected plaintext row, got %q", rawTok)
	}

	// 2. Attach a Box and read. Get should return plaintext AND
	//    re-encrypt the row in place.
	withSecrets(t, s)

	c, err := s.CloudGet(ctx)
	if err != nil || c.APIToken != "legacy-tok" {
		t.Fatalf("cloud get after attach: %+v err=%v", c, err)
	}
	r, err := s.RelayGet(ctx)
	if err != nil || r.Password != "legacy-pass" {
		t.Fatalf("relay get after attach: %+v err=%v", r, err)
	}
	w, err := s.WebhookGet(ctx)
	if err != nil || w.Secret != "legacy-sec" {
		t.Fatalf("webhook get after attach: %+v err=%v", w, err)
	}

	// 3. The rows on disk are now encrypted.
	_ = s.DB().QueryRowContext(ctx, `SELECT api_token FROM cloud_connections`).Scan(&rawTok)
	if !secrets.IsEncrypted(rawTok) {
		t.Errorf("after migrate read, api_token still plaintext: %q", rawTok)
	}
	var rawPass, rawSec string
	_ = s.DB().QueryRowContext(ctx, `SELECT password FROM relay_connections`).Scan(&rawPass)
	_ = s.DB().QueryRowContext(ctx, `SELECT secret FROM webhook_connections`).Scan(&rawSec)
	if !secrets.IsEncrypted(rawPass) {
		t.Errorf("after migrate read, relay password still plaintext: %q", rawPass)
	}
	if !secrets.IsEncrypted(rawSec) {
		t.Errorf("after migrate read, webhook secret still plaintext: %q", rawSec)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
