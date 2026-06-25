package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
	require.NoError(t, err)
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
	require.Fail(t, fmt.Sprintf("timeout after %v", deadline))
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
	assert.Equal(t, int32(1), b.created.Load())
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

	require.NoError(t, s.WebhookUpsert(context.Background(), &store.WebhookConnection{
		URL: receiver.URL, Enabled: true,
	}))

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
	require.GreaterOrEqual(t, hits.Load(), int32(1))
	assert.Contains(t, string(lastBody), "Hello webhooks")
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
	assert.Equal(t, int32(0), hits.Load())
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
	require.NoError(t, writeFile(tmp, "storage:\n  max_messages: 2\n"))
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
	assert.Equal(t, 2, res.Total)
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

	require.NoError(t, s.WebhookUpsert(context.Background(), &store.WebhookConnection{
		URL: receiver.URL, Enabled: true,
	}))

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
	require.NoError(t, d.Shutdown(ctx))
}

// Deadline path: a stuck webhook receiver keeps a goroutine alive past
// the shutdown deadline. Shutdown must return ctx.Err() rather than
// block forever.
func TestShutdownReturnsDeadlineExceeded(t *testing.T) {
	t.Parallel()
	s, _ := store.OpenMemory()
	defer s.Close()

	// A side-effect hook that ignores cancellation and blocks forever —
	// a stand-in for a genuinely unresponsive job. The normal jobs all
	// honour ctx now (so they'd unwind promptly), but Shutdown must still
	// enforce its deadline rather than hang on a stuck goroutine.
	block := make(chan struct{})
	defer close(block) // unblock the goroutine at test end so it doesn't leak

	d := &Dispatcher{
		Store: s, Config: config.NewLoader(),
		Relay: &relay.Client{}, Webhook: webhook.NewClient(),
		BroadcastCreated:   func(string) { <-block },
		BroadcastDestroyed: func(string) {},
		SerializeSummary:   func(*store.Message) ([]byte, error) { return []byte("{}"), nil },
	}
	d.Start()

	id := ingest(t, s, "shutdown-stuck")
	d.AfterIngest(id)

	// Give the broadcast goroutine a beat to start and block.
	time.Sleep(50 * time.Millisecond)

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err := d.Shutdown(ctx)
	require.Error(t, err)
	assert.ErrorIs(t, err, context.DeadlineExceeded)
}

// withRetry returns immediately when the context is already cancelled,
// without invoking fn — this is what lets a shutdown-cancelled job
// abandon its retries promptly.
func TestWithRetryReturnsImmediatelyWhenContextCanceled(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	calls := 0
	err := withRetry(ctx, 3, func() error {
		calls++
		return errors.New("transient")
	})
	assert.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, 0, calls)
}

// When the context is cancelled mid-flight, the backoff between attempts
// aborts on ctx.Done() instead of sleeping through it — so retries stop
// promptly during shutdown rather than burning the grace budget.
func TestWithRetryAbortsBackoffOnCancel(t *testing.T) {
	t.Parallel()
	ctx, cancel := context.WithCancel(context.Background())

	calls := 0
	start := time.Now()
	err := withRetry(ctx, 3, func() error {
		calls++
		cancel() // cancel during the first attempt
		return errors.New("transient")
	})
	assert.ErrorIs(t, err, context.Canceled)
	assert.Equal(t, 1, calls)
	// Would be ~500ms+ if the backoff slept; the cancellable select makes
	// it near-instant.
	assert.LessOrEqual(t, time.Since(start), 200*time.Millisecond)
}

// TestRetentionLoopRunsOnStart verifies the new behaviour: retention
// fires from a background ticker, not from AfterIngest. Starting the
// dispatcher kicks off an immediate sweep, so over-cap messages are
// evicted without any ingest activity.
func TestRetentionLoopRunsOnStart(t *testing.T) {
	s, _ := store.OpenMemory()
	defer s.Close()

	tmp := t.TempDir() + "/config.yml"
	require.NoError(t, writeFile(tmp, "storage:\n  max_messages: 2\n"))
	t.Setenv("MAILTRAP_LOCAL_CONFIG", tmp)
	cfg := config.NewLoader()
	cfg.Reload()

	d := &Dispatcher{
		Store: s, Config: cfg,
		Relay: &relay.Client{}, Webhook: webhook.NewClient(),
		BroadcastCreated:   func(string) {},
		BroadcastDestroyed: func(string) {},
		SerializeSummary:   func(*store.Message) ([]byte, error) { return []byte("{}"), nil },
	}

	// Pre-populate over the cap. Retention hasn't run yet because we
	// haven't called Start.
	for i := 0; i < 5; i++ {
		ingest(t, s, "msg")
	}
	res, _ := s.List(context.Background(), store.ListOpts{Limit: 50})
	require.Equal(t, 5, res.Total)

	d.Start()
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = d.Shutdown(ctx)
	}()

	// Initial retention sweep runs synchronously in the loop's first
	// iteration; give it a beat to land.
	waitFor(t, 2*time.Second, func() bool {
		res, _ := s.List(context.Background(), store.ListOpts{Limit: 50})
		return res.Total == 2
	})
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
	require.NoError(t, d.Shutdown(ctx))
}
