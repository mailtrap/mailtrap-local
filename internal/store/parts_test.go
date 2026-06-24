package store

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSplitTokens(t *testing.T) {
	t.Parallel()
	assert.Equal(t, []string{"hello", "world"}, SplitTokens("  hello   world  "))
	assert.Nil(t, SplitTokens(""))
	assert.Nil(t, SplitTokens("   "))
}

func TestLoadInlineAndAttachments(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	p := fixturePayload("parts", "a@x", "b@y", "")
	p.Inlines = []PartIn{{
		PartID: "inline-1", Filename: "logo.png", ContentType: "image/png",
		Size: 4, Content: []byte("png!"),
	}}
	p.Attachments = []PartIn{{
		PartID: "att-1", Filename: "doc.txt", ContentType: "text/plain",
		Size: 5, Content: []byte("hello"),
	}}
	id, err := s.Insert(ctx, p)
	require.NoError(t, err)

	inline, err := s.LoadInline(ctx, id)
	require.NoError(t, err)
	require.Len(t, inline, 1)
	assert.Equal(t, "inline-1", inline[0].PartID)
	assert.Equal(t, "inline", inline[0].Disposition)

	attachments, err := s.LoadAttachments(ctx, id)
	require.NoError(t, err)
	require.Len(t, attachments, 1)
	assert.Equal(t, "att-1", attachments[0].PartID)
}

func TestLoadPartByID(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	p := fixturePayload("lookup", "a@x", "b@y", "")
	p.Attachments = []PartIn{{
		PartID: "42", Filename: "x.txt", ContentType: "text/plain",
		Size: 3, Content: []byte("abc"),
	}}
	id, err := s.Insert(ctx, p)
	require.NoError(t, err)

	part, err := s.LoadPartByID(ctx, id, "42")
	require.NoError(t, err)
	assert.Equal(t, "x.txt", part.Filename)
	assert.Equal(t, []byte("abc"), part.Content)

	_, err = s.LoadPartByID(ctx, id, "missing")
	assert.ErrorIs(t, err, ErrNotFound)
}

func TestAttachmentsCount(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	p := fixturePayload("counts", "a@x", "b@y", "")
	p.Attachments = []PartIn{
		{PartID: "1", Filename: "a.txt", ContentType: "text/plain", Size: 1, Content: []byte("a")},
		{PartID: "2", Filename: "b.txt", ContentType: "text/plain", Size: 1, Content: []byte("b")},
	}
	id, err := s.Insert(ctx, p)
	require.NoError(t, err)

	counts, err := s.AttachmentsCount(ctx, []string{id, "nonexistent"})
	require.NoError(t, err)
	assert.Equal(t, 2, counts[id])
	assert.Equal(t, 0, counts["nonexistent"])
}

func TestRelayAndWebhookDelete(t *testing.T) {
	t.Parallel()
	s := newTestStore(t)
	ctx := context.Background()

	require.NoError(t, s.RelayUpsert(ctx, &RelayConnection{
		Host: "smtp.example.com", Port: 587, Auth: "plain", TLS: "auto",
	}))
	require.NoError(t, s.RelayDelete(ctx))
	_, err := s.RelayGet(ctx)
	assert.ErrorIs(t, err, ErrNotFound)

	require.NoError(t, s.WebhookUpsert(ctx, &WebhookConnection{
		URL: "https://hooks.example.com", Enabled: true,
	}))
	require.NoError(t, s.WebhookDelete(ctx))
	_, err = s.WebhookGet(ctx)
	assert.ErrorIs(t, err, ErrNotFound)
}
