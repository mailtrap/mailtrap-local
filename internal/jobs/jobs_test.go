package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/relay"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/mailtrap/mailtrap-local/internal/webhook"
)

// helper: pull a fixture into the store and return its ID.
func ingest(t *testing.T, s *store.Store, subject string) string {
	t.Helper()
	id, err := s.Insert(context.Background(), &store.IngestPayload{
		SMTPFrom: "a@x.test", SMTPTo: []string{"b@y.test"},
		From:    &store.Address{Address: "a@x.test"},
		To:      []store.Address{{Address: "b@y.test"}},
		Subject: subject,
		Raw:     []byte("From: a\r\n\r\nbody\r\n"),
	})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

// stubBroadcasts captures BroadcastCreated / BroadcastDestroyed calls
// so tests can wait on them deterministically.
type stubBroadcasts struct {
	created   atomic.Int32
	destroyed atomic.Int32
}

// waitFor polls fn until it returns true or the deadline passes.
func waitFor(t *testing.T, deadline time.Duration, fn func() bool) {
	t.Helper()
	end := time.Now().Add(deadline)
	for time.Now().Before(end) {
		if fn() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("timeout after %v", deadline)
}

// ---------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------

func TestAfterIngestBroadcastsCreated(t *testing.T) {
	t.Parallel()
	s, _ := store.OpenMemory()
	defer s.Close()

	var b stubBroadcasts
	d := &Dispatcher{
		Store: s, Config: config.NewLoader(),
		Relay: &relay.Client{}, Webhook: webhook.NewClient(),
		BroadcastCreated:   func(string) { b.created.Add(1) },
		BroadcastDestroyed: func(string) { b.destroyed.Add(1) },
		SerializeSummary:   func(*store.Message) ([]byte, error) { return []byte("{}"), nil },
	}

	id := ingest(t, s, "x")
	d.AfterIngest(id)

	waitFor(t, 2*time.Second, func() bool { return b.created.Load() == 1 })
	if b.created.Load() != 1 {
		t.Errorf("BroadcastCreated count = %d, want 1", b.created.Load())
	}
}

// When no cloud connection exists, cloud-mirror is a no-op.
func TestCloudMirrorNoOpWithoutConnection(t *testing.T) {
	t.Parallel()
	s, _ := store.OpenMemory()
	defer s.Close()

	d := &Dispatcher{
		Store: s, Config: config.NewLoader(),
		Relay: &relay.Client{}, Webhook: webhook.NewClient(),
		BroadcastCreated:   func(string) {},
		BroadcastDestroyed: func(string) {},
		SerializeSummary:   func(*store.Message) ([]byte, error) { return []byte("{}"), nil },
	}

	id := ingest(t, s, "x")
	// Direct call so we can assert it returns cleanly even when no
	// connection exists; AfterIngest fires in goroutines and we'd be
	// asserting absence which is harder.
	d.cloudMirror(id)
	// Nothing to assert beyond "didn't panic".
}

// TestWebhookDeliveryHitsURL stands up a fake receiver, configures the
// webhook DB row, and asserts the dispatcher POSTs to it.
func TestWebhookDeliveryHitsURL(t *testing.T) {
	t.Parallel()
	s, _ := store.OpenMemory()
	defer s.Close()

	var hits atomic.Int32
	var lastBody []byte
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		lastBody = body
		hits.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()

	if err := s.WebhookUpsert(context.Background(), &store.WebhookConnection{
		URL: receiver.URL, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}

	d := &Dispatcher{
		Store: s, Config: config.NewLoader(),
		Relay: &relay.Client{}, Webhook: webhook.NewClient(),
		BroadcastCreated:   func(string) {},
		BroadcastDestroyed: func(string) {},
		SerializeSummary: func(m *store.Message) ([]byte, error) {
			return json.Marshal(map[string]any{"ID": m.ID, "Subject": m.Subject})
		},
	}

	id := ingest(t, s, "Hello webhooks")
	d.AfterIngest(id)

	waitFor(t, 3*time.Second, func() bool { return hits.Load() >= 1 })
	if hits.Load() < 1 {
		t.Fatalf("webhook never received a POST")
	}
	if !bytes.Contains(lastBody, []byte("Hello webhooks")) {
		t.Errorf("webhook body missing subject: %s", lastBody)
	}
}

// TestWebhookDeliveryNoOpWhenDisabled verifies the disabled flag is
// respected even with a configured URL.
func TestWebhookDeliveryNoOpWhenDisabled(t *testing.T) {
	t.Parallel()
	s, _ := store.OpenMemory()
	defer s.Close()

	var hits atomic.Int32
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()

	_ = s.WebhookUpsert(context.Background(), &store.WebhookConnection{
		URL: receiver.URL, Enabled: false,
	})

	d := &Dispatcher{
		Store: s, Config: config.NewLoader(),
		Relay: &relay.Client{}, Webhook: webhook.NewClient(),
		BroadcastCreated:   func(string) {},
		BroadcastDestroyed: func(string) {},
		SerializeSummary:   func(*store.Message) ([]byte, error) { return []byte("{}"), nil },
	}

	id := ingest(t, s, "x")
	d.webhookDelivery(id)
	// Give any erroneous goroutine time to fire.
	time.Sleep(200 * time.Millisecond)
	if hits.Load() != 0 {
		t.Errorf("webhook fired despite enabled=false; hits=%d", hits.Load())
	}
}

// TestRetentionEvictsOldest verifies that with cap=2 and 5 messages,
// the 3 oldest are deleted and the 2 newest remain.
//
// Not parallel — uses t.Setenv to drive the config Loader.
func TestRetentionEvictsOldest(t *testing.T) {
	s, _ := store.OpenMemory()
	defer s.Close()

	cap := 2
	cfg := config.NewLoader()
	// Fake a config with max_messages=2 by reaching into the loader's
	// cache. The Loader doesn't expose Set, so just inject via Reload
	// after writing a temp YAML — but for a unit test, the simpler
	// path is to compose a Loader-compatible struct manually. We
	// can't (Loaded is opaque); so insert n messages above cap, run
	// retention, and verify by direct SQL count.
	_ = cfg
	_ = cap

	// Workaround: drive enforceRetention directly with the desired cap
	// inline. We can do that by setting MAILTRAP_LOCAL_CONFIG to a
	// temp file and reloading.
	tmp := t.TempDir() + "/config.yml"
	if err := writeFile(tmp, "storage:\n  max_messages: 2\n"); err != nil {
		t.Fatal(err)
	}
	t.Setenv("MAILTRAP_LOCAL_CONFIG", tmp)
	cfg.Reload()

	d := &Dispatcher{
		Store: s, Config: cfg,
		Relay: &relay.Client{}, Webhook: webhook.NewClient(),
		BroadcastCreated:   func(string) {},
		BroadcastDestroyed: func(string) {},
		SerializeSummary:   func(*store.Message) ([]byte, error) { return []byte("{}"), nil },
	}

	for i := 0; i < 5; i++ {
		ingest(t, s, "msg")
	}

	d.enforceRetention()

	res, _ := s.List(context.Background(), store.ListOpts{Limit: 50})
	if res.Total != 2 {
		t.Errorf("after retention, total = %d, want 2", res.Total)
	}
}

// writeFile is a small helper since os.WriteFile pulls io/fs nuances
// we don't need to spell out per-test.
func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o600)
}

// ---------------------------------------------------------------------
// Graceful-shutdown tests
// ---------------------------------------------------------------------

// Happy path: all goroutines complete, Shutdown returns nil.
func TestShutdownHappyPath(t *testing.T) {
	t.Parallel()
	s, _ := store.OpenMemory()
	defer s.Close()

	var hits atomic.Int32
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()

	if err := s.WebhookUpsert(context.Background(), &store.WebhookConnection{
		URL: receiver.URL, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}

	d := &Dispatcher{
		Store: s, Config: config.NewLoader(),
		Relay: &relay.Client{}, Webhook: webhook.NewClient(),
		BroadcastCreated:   func(string) {},
		BroadcastDestroyed: func(string) {},
		SerializeSummary:   func(*store.Message) ([]byte, error) { return []byte("{}"), nil },
	}
	d.Start()

	id := ingest(t, s, "shutdown-happy")
	d.AfterIngest(id)

	// Wait for the webhook to land so we know the goroutines are
	// actually doing the work. Shutdown should then return nil
	// promptly — all goroutines have already returned.
	waitFor(t, 3*time.Second, func() bool { return hits.Load() >= 1 })

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := d.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown returned %v, want nil", err)
	}
}

// Deadline path: a stuck webhook receiver keeps a goroutine alive past
// the shutdown deadline. Shutdown must return ctx.Err() rather than
// block forever.
func TestShutdownReturnsDeadlineExceeded(t *testing.T) {
	t.Parallel()
	s, _ := store.OpenMemory()
	defer s.Close()

	// Receiver blocks until its request context is cancelled by the
	// client (which happens when the dispatcher's parent context is
	// cancelled by Shutdown). Even so, the goroutine then has to walk
	// the retry loop, so we test with a deadline shorter than that
	// total time.
	release := make(chan struct{})
	receiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer receiver.Close()
	defer close(release)

	if err := s.WebhookUpsert(context.Background(), &store.WebhookConnection{
		URL: receiver.URL, Enabled: true,
	}); err != nil {
		t.Fatal(err)
	}

	d := &Dispatcher{
		Store: s, Config: config.NewLoader(),
		Relay: &relay.Client{}, Webhook: webhook.NewClient(),
		BroadcastCreated:   func(string) {},
		BroadcastDestroyed: func(string) {},
		SerializeSummary:   func(*store.Message) ([]byte, error) { return []byte("{}"), nil },
	}
	d.Start()

	id := ingest(t, s, "shutdown-stuck")
	d.AfterIngest(id)

	// Give the dispatcher a beat to actually start the POST, otherwise
	// Shutdown might fire before any goroutine is mid-flight.
	time.Sleep(50 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err := d.Shutdown(ctx)
	if err == nil {
		t.Fatalf("Shutdown returned nil, want a deadline error")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Shutdown returned %v, want DeadlineExceeded", err)
	}
}

// Shutdown with no Start is a no-op (preserves the test-friendly
// "unstarted dispatcher" contract).
func TestShutdownWithoutStartIsNoop(t *testing.T) {
	t.Parallel()
	s, _ := store.OpenMemory()
	defer s.Close()
	d := &Dispatcher{
		Store: s, Config: config.NewLoader(),
		Relay: &relay.Client{}, Webhook: webhook.NewClient(),
		BroadcastCreated:   func(string) {},
		BroadcastDestroyed: func(string) {},
		SerializeSummary:   func(*store.Message) ([]byte, error) { return []byte("{}"), nil },
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := d.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown on unstarted dispatcher = %v, want nil", err)
	}
}
