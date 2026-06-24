package api

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWireSummary(t *testing.T) {
	t.Parallel()
	created := time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC)
	cat := "welcome"
	msg := &store.Message{
		ID:          "id-1",
		MessageID:   "<msg@test>",
		FromName:    "Alice",
		FromAddress: "alice@example.com",
		ToAddresses: []store.Address{{Name: "Bob", Address: "bob@example.com"}},
		Subject:     "Hello",
		Category:    &cat,
		Size:        42,
		Snippet:     "Hello world",
		CreatedAt:   created,
	}

	got := WireSummary(msg, 2)

	assert.Equal(t, "id-1", got.ID)
	assert.Equal(t, "<msg@test>", got.MessageID)
	assert.False(t, got.Read)
	assert.Equal(t, "Alice", got.From.Name)
	assert.Equal(t, "alice@example.com", got.From.Address)
	require.Len(t, got.To, 1)
	assert.Equal(t, "bob@example.com", got.To[0].Address)
	assert.Equal(t, "Hello", got.Subject)
	assert.Equal(t, created.Format(time.RFC3339Nano), got.Created)
	assert.Equal(t, []string{"welcome"}, got.Tags)
	assert.Equal(t, int64(42), got.Size)
	assert.Equal(t, 2, got.Attachments)
	assert.Equal(t, "Hello world", got.Snippet)
	assert.Empty(t, got.Username)
	assert.NotNil(t, got.Cc)
	assert.NotNil(t, got.Bcc)
	assert.NotNil(t, got.ReplyTo)
}

func TestWireDetail(t *testing.T) {
	t.Parallel()
	created := time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC)
	date := time.Date(2024, 5, 31, 8, 30, 0, 0, time.UTC)
	listUnsub, err := json.Marshal(ListUnsubscribe{
		Header: "List-Unsubscribe: <mailto:unsub@example.com>",
		Links:  []string{"mailto:unsub@example.com"},
	})
	require.NoError(t, err)

	msg := &store.Message{
		ID:              "id-2",
		MessageID:       "<detail@test>",
		SMTPFrom:        "env-from@example.com",
		SMTPTo:          []string{"rcpt@example.com"},
		FromName:        "Sender",
		FromAddress:     "sender@example.com",
		ToAddresses:     []store.Address{{Address: "rcpt@example.com"}},
		ReturnPath:      "bounce@example.com",
		Subject:         "Detail test",
		Date:            &date,
		TextBody:        "plain text",
		HTML:            "<p>html</p>",
		Size:            100,
		ListUnsubscribe: listUnsub,
		CreatedAt:       created,
	}

	inline := []store.Part{{
		PartID: "inline-1", Filename: "logo.png", ContentType: "image/png",
		Size: 512, ChecksumMD5: "md5", ChecksumSHA1: "sha1", ChecksumSHA256: "sha256",
	}}
	attachments := []store.Part{{
		PartID: "att-1", Filename: "doc.pdf", ContentType: "application/pdf", Size: 1024,
	}}

	got := WireDetail(msg, inline, attachments)

	assert.Equal(t, "id-2", got.ID)
	assert.Equal(t, date.Format(time.RFC3339Nano), got.Date)
	assert.Equal(t, "env-from@example.com", got.EnvelopeFrom)
	assert.Equal(t, []string{"rcpt@example.com"}, got.EnvelopeTo)
	assert.Equal(t, "plain text", got.Text)
	assert.Equal(t, "<p>html</p>", got.HTML)
	assert.Equal(t, "List-Unsubscribe: <mailto:unsub@example.com>", got.ListUnsubscribe.Header)
	require.Len(t, got.Inline, 1)
	assert.Equal(t, "inline-1", got.Inline[0].PartID)
	assert.Equal(t, "md5", got.Inline[0].Checksums.MD5)
	require.Len(t, got.Attachments, 1)
	assert.Equal(t, "doc.pdf", got.Attachments[0].FileName)
}

func TestWireDetailFallsBackToCreatedWhenDateMissing(t *testing.T) {
	t.Parallel()
	created := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	msg := &store.Message{
		ID: "id-3", CreatedAt: created,
	}

	got := WireDetail(msg, nil, nil)
	assert.Equal(t, created.Format(time.RFC3339Nano), got.Date)
	assert.NotNil(t, got.Inline)
	assert.NotNil(t, got.Attachments)
	assert.Equal(t, []string{}, got.EnvelopeTo)
}

func TestTagsFromCategory(t *testing.T) {
	t.Parallel()
	assert.Equal(t, []string{}, tagsFromCategory(nil))
	empty := ""
	assert.Equal(t, []string{}, tagsFromCategory(&empty))
	cat := "newsletter"
	assert.Equal(t, []string{"newsletter"}, tagsFromCategory(&cat))
}
