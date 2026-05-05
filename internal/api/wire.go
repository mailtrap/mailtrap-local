// Package api owns the HTTP layer: the chi router, the JSON wire types,
// and the handlers. Wire format is snake_case throughout to align with
// the conventions used across the rest of the Mailtrap toolchain
// (sandbox API, Mailtrap CLI).
package api

import (
	"encoding/json"
	"time"

	"github.com/mailtrap/mailtrap-local/internal/store"
)

// Address is the {name, address} pair clients see in from / to / cc /
// bcc / reply_to.
type Address struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

// AttachmentSummary is the metadata shape — bytes are fetched
// separately via /message/:id/part/:part_id.
type AttachmentSummary struct {
	PartID      string    `json:"part_id"`
	FileName    string    `json:"file_name"`
	ContentType string    `json:"content_type"`
	ContentID   string    `json:"content_id"`
	Size        int64     `json:"size"`
	Checksums   Checksums `json:"checksums"`
}

// Checksums is the trio of content fingerprints stored alongside each
// attachment.
type Checksums struct {
	MD5    string `json:"md5"`
	SHA1   string `json:"sha1"`
	SHA256 string `json:"sha256"`
}

// ListUnsubscribe mirrors the parsed `List-Unsubscribe` header.
type ListUnsubscribe struct {
	Header     string   `json:"header"`
	Links      []string `json:"links"`
	Errors     string   `json:"errors"`
	HeaderPost string   `json:"header_post"`
}

// MessageSummary is a list-row in `GET /messages` and `GET /search`.
type MessageSummary struct {
	ID          string    `json:"id"`
	MessageID   string    `json:"message_id"`
	Read        bool      `json:"read"`
	From        Address   `json:"from"`
	To          []Address `json:"to"`
	Cc          []Address `json:"cc"`
	Bcc         []Address `json:"bcc"`
	ReplyTo     []Address `json:"reply_to"`
	Subject     string    `json:"subject"`
	Created     string    `json:"created"`
	Username    string    `json:"username"`
	Tags        []string  `json:"tags"`
	Size        int64     `json:"size"`
	Attachments int       `json:"attachments"`
	Snippet     string    `json:"snippet"`
}

// MessageDetail is the full shape from `GET /message/:id`. Includes
// `envelope_from` / `envelope_to` extensions surfaced in the Tech Info
// tab; clients that don't recognise them ignore them.
type MessageDetail struct {
	ID              string              `json:"id"`
	MessageID       string              `json:"message_id"`
	From            Address             `json:"from"`
	To              []Address           `json:"to"`
	Cc              []Address           `json:"cc"`
	Bcc             []Address           `json:"bcc"`
	ReplyTo         []Address           `json:"reply_to"`
	ReturnPath      string              `json:"return_path"`
	Subject         string              `json:"subject"`
	ListUnsubscribe ListUnsubscribe     `json:"list_unsubscribe"`
	Date            string              `json:"date"`
	Tags            []string            `json:"tags"`
	Username        string              `json:"username"`
	Text            string              `json:"text"`
	HTML            string              `json:"html"`
	Size            int64               `json:"size"`
	Inline          []AttachmentSummary `json:"inline"`
	Attachments     []AttachmentSummary `json:"attachments"`

	// mailtrap-local extensions (safely ignored by clients that don't
	// know them).
	EnvelopeFrom string   `json:"envelope_from"`
	EnvelopeTo   []string `json:"envelope_to"`
}

// MessagesResponse is the envelope for `GET /messages` and `GET /search`.
type MessagesResponse struct {
	Total          int              `json:"total"`
	Unread         int              `json:"unread"`
	Count          int              `json:"count"`
	MessagesCount  int              `json:"messages_count"`
	MessagesUnread int              `json:"messages_unread"`
	Start          int              `json:"start"`
	Tags           []string         `json:"tags"`
	Messages       []MessageSummary `json:"messages"`
}

// ErrorResponse is the plain JSON error shape used everywhere.
type ErrorResponse struct {
	Error string `json:"error"`
}

// ---------------------------------------------------------------------
// Mappers — store types → wire types
// ---------------------------------------------------------------------

// toWireAddrs converts a slice of stored addresses to the wire shape.
// Always returns a non-nil slice so JSON renders `[]` not `null`.
func toWireAddrs(in []store.Address) []Address {
	out := make([]Address, 0, len(in))
	for _, a := range in {
		out = append(out, Address{Name: a.Name, Address: a.Address})
	}
	return out
}

// WireSummary is the package-public wrapper around toWireSummary so
// other packages (e.g. main.go's broadcast helper) can produce the
// exact same JSON the list endpoint emits.
func WireSummary(m *store.Message, attachmentsCount int) MessageSummary {
	return toWireSummary(m, attachmentsCount)
}

// WireDetail is the package-public wrapper around toWireDetail.
func WireDetail(m *store.Message, inline, attachments []store.Part) MessageDetail {
	return toWireDetail(m, inline, attachments)
}

func toWireSummary(m *store.Message, attachmentsCount int) MessageSummary {
	return MessageSummary{
		ID:          m.ID,
		MessageID:   m.MessageID,
		Read:        m.Read(),
		From:        Address{Name: m.FromName, Address: m.FromAddress},
		To:          toWireAddrs(m.ToAddresses),
		Cc:          toWireAddrs(m.CcAddresses),
		Bcc:         toWireAddrs(m.BccAddresses),
		ReplyTo:     toWireAddrs(m.ReplyTo),
		Subject:     m.Subject,
		Created:     m.CreatedAt.UTC().Format(time.RFC3339Nano),
		Username:    "", // no SMTP AUTH — single-user local tool
		Tags:        tagsFromCategory(m.Category),
		Size:        m.Size,
		Attachments: attachmentsCount,
		Snippet:     m.Snippet,
	}
}

func toWireDetail(m *store.Message, inline, attachments []store.Part) MessageDetail {
	dateStr := ""
	if m.Date != nil {
		dateStr = m.Date.UTC().Format(time.RFC3339Nano)
	} else {
		dateStr = m.CreatedAt.UTC().Format(time.RFC3339Nano)
	}

	listUnsub := emptyListUnsubscribe()
	if len(m.ListUnsubscribe) > 0 {
		_ = json.Unmarshal(m.ListUnsubscribe, &listUnsub)
	}

	return MessageDetail{
		ID:              m.ID,
		MessageID:       m.MessageID,
		From:            Address{Name: m.FromName, Address: m.FromAddress},
		To:              toWireAddrs(m.ToAddresses),
		Cc:              toWireAddrs(m.CcAddresses),
		Bcc:             toWireAddrs(m.BccAddresses),
		ReplyTo:         toWireAddrs(m.ReplyTo),
		ReturnPath:      m.ReturnPath,
		Subject:         m.Subject,
		ListUnsubscribe: listUnsub,
		Date:            dateStr,
		Tags:            tagsFromCategory(m.Category),
		Username:        "",
		Text:            m.TextBody,
		HTML:            m.HTML,
		Size:            m.Size,
		Inline:          partsToWire(inline),
		Attachments:     partsToWire(attachments),
		EnvelopeFrom:    m.SMTPFrom,
		EnvelopeTo:      nonNilStrings(m.SMTPTo),
	}
}

func partsToWire(in []store.Part) []AttachmentSummary {
	out := make([]AttachmentSummary, 0, len(in))
	for _, p := range in {
		out = append(out, AttachmentSummary{
			PartID:      p.PartID,
			FileName:    p.Filename,
			ContentType: p.ContentType,
			ContentID:   p.ContentID,
			Size:        p.Size,
			Checksums: Checksums{
				MD5:    p.ChecksumMD5,
				SHA1:   p.ChecksumSHA1,
				SHA256: p.ChecksumSHA256,
			},
		})
	}
	return out
}

// tagsFromCategory packages the optional category as a 0- or 1-element
// array, preserving the documented `tags: string[]` wire shape.
func tagsFromCategory(cat *string) []string {
	if cat == nil || *cat == "" {
		return []string{}
	}
	return []string{*cat}
}

func nonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func emptyListUnsubscribe() ListUnsubscribe {
	return ListUnsubscribe{Header: "", Links: []string{}, Errors: "", HeaderPost: ""}
}
