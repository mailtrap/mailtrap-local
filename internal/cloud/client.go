// Package cloud is the Mailtrap Sandbox Send API client.
//
// Forwards a stored Message to the connected cloud sandbox at
// https://sandbox.api.mailtrap.io/api/send/{sandbox_id}. Same payload
// shape Mailtrap's hosted SDKs emit, with a reserved-headers list that
// matches the Send API's accepted set, and a transient/permanent error
// taxonomy so the dispatcher knows when to retry.
package cloud

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/mailtrap/mailtrap-local/internal/store"
)

const defaultEndpoint = "https://sandbox.api.mailtrap.io"

// Client targets a specific sandbox via API token. One Client per
// connected sandbox; built fresh each call site since auth is cheap.
//
// BaseURL defaults to the production sandbox endpoint when zero. Tests
// override it by pointing at an httptest.Server; future staging-env
// support could use it the same way.
type Client struct {
	APIToken  string
	SandboxID int64
	BaseURL   string
	HTTP      *http.Client
}

// NewClient with a sane 15s timeout.
func NewClient(apiToken string, sandboxID int64) *Client {
	return &Client{
		APIToken:  apiToken,
		SandboxID: sandboxID,
		HTTP:      &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) base() string {
	if c.BaseURL != "" {
		return c.BaseURL
	}
	return defaultEndpoint
}

// Send forwards a Message + its attachments to the connected sandbox.
// Returns nil on 2xx, ErrPermanent for 4xx (don't retry), or a generic
// error for 5xx / network blips (do retry).
func (c *Client) Send(ctx context.Context, m *store.Message, inline, attachments []store.Part) error {
	body := buildPayload(m, inline, attachments)
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		fmt.Sprintf("%s/api/send/%d", c.base(), c.SandboxID),
		bytes.NewReader(raw))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.APIToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("post: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	buf := make([]byte, 1024)
	n, _ := resp.Body.Read(buf)
	msg := fmt.Sprintf("Mailtrap API %d: %s", resp.StatusCode, string(buf[:n]))
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return &PermanentError{Msg: msg}
	}
	return fmt.Errorf("%s", msg)
}

// PermanentError signals "don't retry" (bad token, malformed payload,
// disabled sandbox).
type PermanentError struct{ Msg string }

func (e *PermanentError) Error() string { return e.Msg }

// reservedHeaders are the header names the Send API generates or
// consumes as structured fields. Including them in `headers` would
// either conflict with platform-set values or be silently dropped.
// Also excludes the category headers since they're promoted to a
// top-level field.
var reservedHeaders = func() map[string]bool {
	m := map[string]bool{}
	for _, h := range []string{
		"from", "to", "cc", "bcc", "reply-to", "subject", "date", "message-id",
		"mime-version", "content-type", "content-transfer-encoding",
		"received", "return-path", "dkim-signature",
		"category", "x-mt-category",
	} {
		m[h] = true
	}
	return m
}()

func buildPayload(m *store.Message, inline, attachments []store.Part) map[string]any {
	from := map[string]any{"email": m.FromAddress}
	if m.FromName != "" {
		from["name"] = m.FromName
	}

	out := map[string]any{
		"from":    from,
		"to":      addressList(m.ToAddresses),
		"subject": m.Subject,
	}
	if cc := addressList(m.CcAddresses); len(cc) > 0 {
		out["cc"] = cc
	}
	if bcc := addressList(m.BccAddresses); len(bcc) > 0 {
		out["bcc"] = bcc
	}

	text, html := m.TextBody, m.HTML
	if text != "" {
		out["text"] = text
	}
	if html != "" {
		out["html"] = html
	}
	// Mailtrap rejects emails with neither body — fall back to "".
	if text == "" && html == "" {
		out["text"] = ""
	}

	// Promote category to a top-level Send API field.
	if m.Category != nil && *m.Category != "" {
		out["category"] = *m.Category
	}

	if h := extractCustomHeaders(m.Raw); len(h) > 0 {
		out["headers"] = h
	}

	parts := append([]store.Part{}, inline...)
	parts = append(parts, attachments...)
	if len(parts) > 0 {
		out["attachments"] = encodeParts(parts)
	}
	return out
}

func addressList(addrs []store.Address) []map[string]any {
	out := make([]map[string]any, 0, len(addrs))
	for _, a := range addrs {
		if a.Address == "" {
			continue
		}
		entry := map[string]any{"email": a.Address}
		if a.Name != "" {
			entry["name"] = a.Name
		}
		out = append(out, entry)
	}
	return out
}

func extractCustomHeaders(raw []byte) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	msg, err := mail.ReadMessage(bytes.NewReader(raw))
	if err != nil {
		return nil
	}
	out := map[string]string{}
	for k, vs := range msg.Header {
		if reservedHeaders[strings.ToLower(k)] {
			continue
		}
		if len(vs) > 0 {
			out[k] = vs[0]
		}
	}
	return out
}

func encodeParts(parts []store.Part) []map[string]any {
	out := make([]map[string]any, 0, len(parts))
	for _, p := range parts {
		entry := map[string]any{
			"content": base64.StdEncoding.EncodeToString(p.Content),
		}
		fn := p.Filename
		if fn == "" {
			fn = strings.Trim(p.ContentID, "<>")
		}
		if fn == "" {
			fn = "attachment"
		}
		entry["filename"] = fn
		if p.ContentType != "" {
			entry["type"] = p.ContentType
		}
		if p.Disposition == "inline" {
			entry["disposition"] = "inline"
		} else {
			entry["disposition"] = "attachment"
		}
		if cid := strings.Trim(p.ContentID, "<>"); cid != "" {
			entry["content_id"] = cid
		}
		out = append(out, entry)
	}
	return out
}
