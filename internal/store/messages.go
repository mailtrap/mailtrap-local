package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

// Address mirrors the wire shape (PascalCase keys come from the JSON
// tags on api.Address, not here). Internally we always carry it as
// {Name, Address}.
type Address struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

// Part is the persisted shape for an inline image or attachment.
// Mirrors the columns of the `attachments` table.
type Part struct {
	ID             int64 // attachments.id
	MessageID      string
	PartID         string
	Filename       string
	ContentType    string
	ContentID      string
	Disposition    string // "inline" | "attachment"
	Size           int64
	Content        []byte
	ChecksumMD5    string
	ChecksumSHA1   string
	ChecksumSHA256 string
}

// Message is the in-memory view of a row in `messages` plus its
// attachments (loaded on demand). Times are kept as time.Time;
// JSON-shaped columns are unmarshalled into typed slices.
type Message struct {
	ID              string
	SMTPFrom        string
	SMTPTo          []string
	MessageID       string
	FromName        string
	FromAddress     string
	ToAddresses     []Address
	CcAddresses     []Address
	BccAddresses    []Address
	ReplyTo         []Address
	ReturnPath      string
	Subject         string
	Date            *time.Time // nullable — only set when the Date header parsed
	Category        *string    // nullable
	TextBody        string
	HTML            string
	Raw             []byte
	Size            int64
	Snippet         string
	RecipientsText  string
	ListUnsubscribe json.RawMessage // nullable JSON object; nil when absent
	ReadAt          *time.Time      // nil = unread
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Read reports whether the message has been opened.
func (m *Message) Read() bool { return m.ReadAt != nil }

// IngestPayload is the decoded form of the JSON the SMTP layer hands us.
// Same field set as the /api/v1/ingest contract — snake_case keys so the
// HTTP and in-process paths share one struct, and so captured payloads
// stay readable in logs.
type IngestPayload struct {
	SMTPFrom    string    `json:"smtp_from"`
	SMTPTo      []string  `json:"smtp_to"`
	MessageID   string    `json:"message_id"`
	From        *Address  `json:"from"`
	To          []Address `json:"to"`
	Cc          []Address `json:"cc"`
	Bcc         []Address `json:"bcc"`
	ReplyTo     []Address `json:"reply_to"`
	ReturnPath  string    `json:"return_path"`
	Subject     string    `json:"subject"`
	Date        string    `json:"date"`
	Category    string    `json:"category"`
	Text        string    `json:"text"`
	HTML        string    `json:"html"`
	Raw         []byte    `json:"raw"`
	Size        int       `json:"size"`
	Snippet     string    `json:"snippet"`
	Inlines     []PartIn  `json:"inlines"`
	Attachments []PartIn  `json:"attachments"`
}

// PartIn is the decoded inline/attachment shape on the way in.
type PartIn struct {
	PartID      string `json:"part_id"`
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	ContentID   string `json:"content_id"`
	Size        int    `json:"size"`
	Content     []byte `json:"content"` // base64-decoded by encoding/json
}

// Insert persists a message + its attachments in a single transaction.
// The message ID is generated here (10-byte url-safe base64). Returns
// the assigned ID.
func (s *Store) Insert(ctx context.Context, p *IngestPayload) (string, error) {
	id, err := newID()
	if err != nil {
		return "", err
	}

	from := Address{}
	if p.From != nil {
		from = *p.From
	}

	toJSON := mustMarshal(p.To)
	ccJSON := mustMarshal(p.Cc)
	bccJSON := mustMarshal(p.Bcc)
	replyToJSON := mustMarshal(p.ReplyTo)
	smtpToJSON := mustMarshal(p.SMTPTo)

	var dateStr *string
	if p.Date != "" {
		dateStr = &p.Date
	}
	var categoryStr *string
	if cat := strings.TrimSpace(p.Category); cat != "" {
		categoryStr = &cat
	}

	recipientsText := buildRecipientsText(p.To, p.Cc, p.Bcc)

	size := int64(p.Size)
	if size == 0 {
		size = int64(len(p.Raw))
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck — rolled back if Commit not called

	const insertMsg = `
		INSERT INTO messages (
			id, smtp_from, smtp_to, message_id,
			from_name, from_address,
			to_addresses, cc_addresses, bcc_addresses, reply_to,
			return_path, subject, date, category,
			text_body, html, raw, size, snippet,
			recipients_text
		) VALUES (?,?,?,?, ?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?,?, ?)
	`
	if _, err := tx.ExecContext(ctx, insertMsg,
		id, p.SMTPFrom, smtpToJSON, p.MessageID,
		from.Name, from.Address,
		toJSON, ccJSON, bccJSON, replyToJSON,
		p.ReturnPath, p.Subject, dateStr, categoryStr,
		p.Text, p.HTML, p.Raw, size, p.Snippet,
		recipientsText,
	); err != nil {
		return "", fmt.Errorf("insert message: %w", err)
	}

	for _, part := range p.Inlines {
		if err := insertPart(ctx, tx, id, "inline", part); err != nil {
			return "", err
		}
	}
	for _, part := range p.Attachments {
		if err := insertPart(ctx, tx, id, "attachment", part); err != nil {
			return "", err
		}
	}

	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}
	return id, nil
}

func insertPart(ctx context.Context, tx *sql.Tx, msgID, disposition string, p PartIn) error {
	const stmt = `
		INSERT INTO attachments (
			message_id, part_id, filename, content_type, content_id,
			disposition, size, content,
			checksum_md5, checksum_sha1, checksum_sha256
		) VALUES (?,?,?,?,?, ?,?,?, ?,?,?)
	`
	size := int64(p.Size)
	if size == 0 {
		size = int64(len(p.Content))
	}
	md5h, sha1h, sha256h := checksums(p.Content)
	_, err := tx.ExecContext(ctx, stmt,
		msgID, p.PartID, p.Filename, p.ContentType, p.ContentID,
		disposition, size, p.Content,
		md5h, sha1h, sha256h,
	)
	if err != nil {
		return fmt.Errorf("insert attachment: %w", err)
	}
	return nil
}

// ListOpts narrows + paginates `List`.
type ListOpts struct {
	Start    int    // 0-based offset, clamped to [0, 1_000_000] by caller
	Limit    int    // 1..200
	Category string // optional exact-match filter (empty = no narrowing)
}

// ListResult is the aggregate List() returns. Counts reflect the
// filtered scope (matching ListOpts.Category if set); AllCategories is
// distinct categories across the *unfiltered* sandbox so the caller
// can render a category picker without a second roundtrip.
type ListResult struct {
	Total          int
	Unread         int
	AllCategories  []string
	Messages       []*Message
	AttachmentsCnt map[string]int // ID → count (cheap to fetch alongside)
}

// List loads page of messages newest-first, plus the totals + category
// list a list endpoint needs.
func (s *Store) List(ctx context.Context, opts ListOpts) (*ListResult, error) {
	if opts.Limit <= 0 {
		opts.Limit = 50
	}

	scopeWhere, scopeArgs := buildScope(opts.Category)

	var total, unread int
	if err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM messages "+scopeWhere, scopeArgs...,
	).Scan(&total); err != nil {
		return nil, fmt.Errorf("count: %w", err)
	}
	unreadWhere := scopeWhere
	if unreadWhere == "" {
		unreadWhere = "WHERE read_at IS NULL"
	} else {
		unreadWhere += " AND read_at IS NULL"
	}
	if err := s.db.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM messages "+unreadWhere, scopeArgs...,
	).Scan(&unread); err != nil {
		return nil, fmt.Errorf("count unread: %w", err)
	}

	cats, err := s.AllCategories(ctx)
	if err != nil {
		return nil, err
	}

	pageQuery := `
		SELECT ` + messageColumns + `
		FROM messages
		` + scopeWhere + `
		ORDER BY created_at DESC, rowid DESC
		LIMIT ? OFFSET ?
	`
	args := append(append([]any{}, scopeArgs...), opts.Limit, opts.Start)
	rows, err := s.db.QueryContext(ctx, pageQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("page query: %w", err)
	}
	defer rows.Close()

	var msgs []*Message
	for rows.Next() {
		m, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		msgs = append(msgs, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	counts, err := s.attachmentCounts(ctx, msgs)
	if err != nil {
		return nil, err
	}

	return &ListResult{
		Total:          total,
		Unread:         unread,
		AllCategories:  cats,
		Messages:       msgs,
		AttachmentsCnt: counts,
	}, nil
}

// Get returns the message with the given ID, or ErrNotFound.
//
// `latest` is honored as an alias for "most recent message" so the SPA
// can deep-link to /api/v1/message/latest in dev.
func (s *Store) Get(ctx context.Context, id string) (*Message, error) {
	if id == "latest" {
		row := s.db.QueryRowContext(ctx, `
			SELECT `+messageColumns+`
			FROM messages
			ORDER BY created_at DESC, rowid DESC
			LIMIT 1
		`)
		m, err := scanMessage(row)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return m, err
	}
	row := s.db.QueryRowContext(ctx, `
		SELECT `+messageColumns+`
		FROM messages WHERE id = ?
	`, id)
	m, err := scanMessage(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return m, err
}

// AllCategories returns the distinct non-null `category` values, sorted.
func (s *Store) AllCategories(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT category FROM messages
		WHERE category IS NOT NULL AND category != ''
		ORDER BY category ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("categories: %w", err)
	}
	defer rows.Close()
	var cats []string
	for rows.Next() {
		var c string
		if err := rows.Scan(&c); err != nil {
			return nil, err
		}
		cats = append(cats, c)
	}
	return cats, rows.Err()
}

// AttachmentsCount is the public version that takes IDs directly —
// used by main.go's live-broadcast helper which has the ID, not a
// *Message slice.
func (s *Store) AttachmentsCount(ctx context.Context, ids []string) (map[string]int, error) {
	msgs := make([]*Message, len(ids))
	for i, id := range ids {
		msgs[i] = &Message{ID: id}
	}
	return s.attachmentCounts(ctx, msgs)
}

// attachmentCounts batches the per-message COUNT(*) into one query
// rather than N+1.
func (s *Store) attachmentCounts(ctx context.Context, msgs []*Message) (map[string]int, error) {
	out := make(map[string]int, len(msgs))
	if len(msgs) == 0 {
		return out, nil
	}
	placeholders := strings.Repeat("?,", len(msgs))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, len(msgs))
	for i, m := range msgs {
		args[i] = m.ID
		out[m.ID] = 0 // ensure key exists even when no attachments
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT message_id, COUNT(*)
		FROM attachments
		WHERE message_id IN (`+placeholders+`)
		  AND disposition = 'attachment'
		GROUP BY message_id
	`, args...)
	if err != nil {
		return nil, fmt.Errorf("attachment counts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

const messageColumns = `
	id, smtp_from, smtp_to, message_id,
	from_name, from_address,
	to_addresses, cc_addresses, bcc_addresses, reply_to,
	return_path, subject, date, category,
	text_body, html, raw, size, snippet,
	recipients_text, list_unsubscribe, read_at,
	created_at, updated_at
`

// scanner is the subset of *sql.Row / *sql.Rows we actually need, so
// scanMessage can serve both.
type scanner interface {
	Scan(dest ...any) error
}

func scanMessage(s scanner) (*Message, error) {
	var (
		m                                    Message
		smtpToJSON                           string
		toJSON, ccJSON, bccJSON, replyToJSON string
		dateStr, categoryStr                 sql.NullString
		listUnsubJSON, readAtStr             sql.NullString
		createdAtStr, updatedAtStr           string
	)
	err := s.Scan(
		&m.ID, &m.SMTPFrom, &smtpToJSON, &m.MessageID,
		&m.FromName, &m.FromAddress,
		&toJSON, &ccJSON, &bccJSON, &replyToJSON,
		&m.ReturnPath, &m.Subject, &dateStr, &categoryStr,
		&m.TextBody, &m.HTML, &m.Raw, &m.Size, &m.Snippet,
		&m.RecipientsText, &listUnsubJSON, &readAtStr,
		&createdAtStr, &updatedAtStr,
	)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(smtpToJSON), &m.SMTPTo); err != nil {
		m.SMTPTo = []string{} // tolerant: corrupt JSON shouldn't 500 the list endpoint
	}
	_ = json.Unmarshal([]byte(toJSON), &m.ToAddresses)
	_ = json.Unmarshal([]byte(ccJSON), &m.CcAddresses)
	_ = json.Unmarshal([]byte(bccJSON), &m.BccAddresses)
	_ = json.Unmarshal([]byte(replyToJSON), &m.ReplyTo)
	if dateStr.Valid {
		if t, err := time.Parse(time.RFC3339Nano, dateStr.String); err == nil {
			m.Date = &t
		}
	}
	if categoryStr.Valid {
		v := categoryStr.String
		m.Category = &v
	}
	if listUnsubJSON.Valid && listUnsubJSON.String != "" {
		m.ListUnsubscribe = json.RawMessage(listUnsubJSON.String)
	}
	if readAtStr.Valid {
		if t, err := time.Parse(time.RFC3339Nano, readAtStr.String); err == nil {
			m.ReadAt = &t
		}
	}
	if t, err := time.Parse(time.RFC3339Nano, createdAtStr); err == nil {
		m.CreatedAt = t
	}
	if t, err := time.Parse(time.RFC3339Nano, updatedAtStr); err == nil {
		m.UpdatedAt = t
	}
	return &m, nil
}

func buildScope(category string) (string, []any) {
	if category == "" {
		return "", nil
	}
	return "WHERE category = ?", []any{category}
}

func buildRecipientsText(to, cc, bcc []Address) string {
	parts := make([]string, 0, len(to)+len(cc)+len(bcc))
	for _, set := range [][]Address{to, cc, bcc} {
		for _, a := range set {
			if a.Address != "" {
				parts = append(parts, a.Address)
			}
		}
	}
	return strings.Join(parts, " ")
}

// newID returns a 10-byte url-safe base64 ID — matches the historical
// shape Message#assign_id produced (`SecureRandom.urlsafe_base64(10)`),
// so existing UI/clients that capture IDs see the same length/charset.
func newID() (string, error) {
	var b [10]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func mustMarshal(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		// If our own data fails to round-trip through JSON, that's a
		// programmer bug — panic loudly rather than silently corrupt rows.
		panic(fmt.Sprintf("store: marshal: %v (value=%v)", err, v))
	}
	if len(b) == 0 {
		return "[]"
	}
	if string(b) == "null" {
		return "[]"
	}
	return string(b)
}
