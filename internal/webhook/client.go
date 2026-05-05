// Package webhook delivers HMAC-signed POSTs to a configured receiver
// URL on every newly captured message. Best-effort with simple retry.
package webhook

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
)

const (
	openTimeout = 5 * time.Second
	readTimeout = 10 * time.Second
)

// Client is stateless. One HTTP client is shared across deliveries so
// keep-alive connections amortize.
type Client struct {
	HTTP *http.Client
}

func NewClient() *Client {
	return &Client{
		HTTP: &http.Client{Timeout: openTimeout + readTimeout},
	}
}

// Deliver POSTs `payload` to `url`, signing with `secret` if non-empty.
// Returns nil on 2xx, *PermanentError on 4xx (don't retry), or a
// generic error on 5xx / network blips.
func (c *Client) Deliver(ctx context.Context, url, secret string, payload []byte) error {
	return c.post(ctx, url, secret, payload, "message.created")
}

// SendTestPing fires a synthetic event to the URL; used by the dialog's
// "Send test" button.
func (c *Client) SendTestPing(ctx context.Context, url, secret string) error {
	payload, _ := json.Marshal(map[string]any{
		"Event":     "test",
		"Timestamp": time.Now().UTC().Format(time.RFC3339Nano),
		"ID":        uuid.NewString(),
		"Subject":   "Test ping from mailtrap-local",
		"From":      map[string]string{"Name": "mailtrap-local", "Address": "noreply@mailtrap.local"},
		"To":        []map[string]string{{"Name": "", "Address": "you@example.test"}},
	})
	return c.post(ctx, url, secret, payload, "test")
}

// PermanentError signals "don't retry".
type PermanentError struct{ Msg string }

func (e *PermanentError) Error() string { return e.Msg }

func (c *Client) post(ctx context.Context, url, secret string, payload []byte, event string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "mailtrap-local-webhook/1")
	req.Header.Set("X-Mailtrap-Local-Event", event)
	if secret != "" {
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write(payload)
		req.Header.Set("X-Mailtrap-Local-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	}

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("post %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	buf := make([]byte, 512)
	n, _ := resp.Body.Read(buf)
	msg := fmt.Sprintf("POST %s → %d: %s", url, resp.StatusCode, string(buf[:n]))
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return &PermanentError{Msg: msg}
	}
	return fmt.Errorf("%s", msg)
}
