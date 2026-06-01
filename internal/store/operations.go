package store

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// Delete removes the listed message IDs (and their attachments via the
// FK CASCADE). When ids is empty, deletes ALL messages — matches the
// "DELETE without IDs == truncate" wire contract.
//
// Returns the IDs that were actually deleted (so the caller can
// broadcast destroyed events on the live channel).
func (s *Store) Delete(ctx context.Context, ids ...string) ([]string, error) {
	if len(ids) == 0 {
		// Pull all IDs first so we can broadcast them.
		all, err := s.allIDs(ctx)
		if err != nil {
			return nil, err
		}
		if _, err := s.db.ExecContext(ctx, `DELETE FROM messages`); err != nil {
			return nil, fmt.Errorf("delete all: %w", err)
		}
		return all, nil
	}
	placeholders, args := inClause(ids)
	// Restrict the returned IDs to ones that actually existed before
	// delete, so a duplicate or unknown ID in the body doesn't show up
	// in the broadcast list.
	existing, err := s.filterExisting(ctx, ids)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(ctx,
		`DELETE FROM messages WHERE id IN (`+placeholders+`)`, args...,
	); err != nil {
		return nil, fmt.Errorf("delete: %w", err)
	}
	return existing, nil
}

// MarkRead sets read_at on the listed IDs. With no IDs, marks ALL.
// `read=true`  → read_at = now;  `read=false` → read_at = NULL.
func (s *Store) MarkRead(ctx context.Context, read bool, ids ...string) error {
	var (
		query string
		args  []any
	)
	if read {
		nowStr := time.Now().UTC().Format(time.RFC3339Nano)
		if len(ids) == 0 {
			query = `UPDATE messages SET read_at = ?`
			args = []any{nowStr}
		} else {
			placeholders, ph := inClause(ids)
			query = `UPDATE messages SET read_at = ? WHERE id IN (` + placeholders + `)`
			args = append([]any{nowStr}, ph...)
		}
	} else {
		if len(ids) == 0 {
			query = `UPDATE messages SET read_at = NULL`
		} else {
			placeholders, ph := inClause(ids)
			query = `UPDATE messages SET read_at = NULL WHERE id IN (` + placeholders + `)`
			args = ph
		}
	}
	if _, err := s.db.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	return nil
}

// MarkAsRead is the convenience used on GET /message/:id (single-row
// equivalent of MarkRead(true, id)).
func (s *Store) MarkAsRead(ctx context.Context, id string) error {
	return s.MarkRead(ctx, true, id)
}

// LoadInline returns the inline parts (Disposition='inline') for a
// message, ordered by id. Caller pre-decides whether the bytes are
// needed (this loads them); for list contexts, bytes are wasted IO.
func (s *Store) LoadInline(ctx context.Context, msgID string) ([]Part, error) {
	return s.loadParts(ctx, msgID, "inline")
}

// LoadAttachments returns the regular attachments.
func (s *Store) LoadAttachments(ctx context.Context, msgID string) ([]Part, error) {
	return s.loadParts(ctx, msgID, "attachment")
}

// LoadPartByID looks up a single attachment row by its message + the
// MIME part identifier the parser assigned. Returns ErrNotFound when
// missing.
func (s *Store) LoadPartByID(ctx context.Context, msgID, partID string) (*Part, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, message_id, part_id, filename, content_type, content_id,
		       disposition, size, content,
		       checksum_md5, checksum_sha1, checksum_sha256
		FROM attachments
		WHERE message_id = ? AND part_id = ?
		LIMIT 1
	`, msgID, partID)
	var p Part
	err := row.Scan(
		&p.ID, &p.MessageID, &p.PartID, &p.Filename, &p.ContentType, &p.ContentID,
		&p.Disposition, &p.Size, &p.Content,
		&p.ChecksumMD5, &p.ChecksumSHA1, &p.ChecksumSHA256,
	)
	if err != nil {
		// sql.ErrNoRows → ErrNotFound
		if err.Error() == "sql: no rows in result set" {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// SearchOpts narrows search results.
type SearchOpts struct {
	Query    string
	Start    int
	Limit    int
	Category string // optional further narrowing
}

// Search runs a multi-token AND search against the FTS5 index. Each
// whitespace-separated token is wrapped as a quoted phrase, then
// joined with spaces — FTS5's default AND-of-phrases semantics gives
// the same "every token matches somewhere" behaviour the old LIKE
// implementation had, but with an actual index doing the work.
func (s *Store) Search(ctx context.Context, opts SearchOpts) (*ListResult, error) {
	tokens := splitTokens(opts.Query)
	if len(tokens) == 0 {
		// Caller should short-circuit when query is blank, but be defensive.
		return &ListResult{
			Total: 0, Unread: 0, AllCategories: nil, Messages: nil,
			AttachmentsCnt: map[string]int{},
		}, nil
	}

	matchExpr := buildFTSMatchExpr(tokens)
	args := []any{matchExpr}
	categoryClause := ""
	if opts.Category != "" {
		categoryClause = " AND m.category = ?"
		args = append(args, opts.Category)
	}

	var total, unread int
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM messages m JOIN messages_fts f ON f.rowid = m.rowid
		WHERE messages_fts MATCH ?`+categoryClause,
		args...,
	).Scan(&total); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM messages m JOIN messages_fts f ON f.rowid = m.rowid
		WHERE messages_fts MATCH ?`+categoryClause+` AND m.read_at IS NULL`,
		args...,
	).Scan(&unread); err != nil {
		return nil, err
	}

	cats, err := s.AllCategories(ctx)
	if err != nil {
		return nil, err
	}

	limit := opts.Limit
	if limit <= 0 {
		limit = 50
	}
	pageArgs := append(append([]any{}, args...), limit, opts.Start)
	rows, err := s.db.QueryContext(ctx, `
		SELECT `+messageColumnsM+`
		FROM messages m JOIN messages_fts f ON f.rowid = m.rowid
		WHERE messages_fts MATCH ?`+categoryClause+`
		ORDER BY m.created_at DESC, m.rowid DESC
		LIMIT ? OFFSET ?
	`, pageArgs...)
	if err != nil {
		return nil, err
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

// SplitTokens is exported for the API package, which short-circuits
// blank queries before opening a DB connection.
func SplitTokens(q string) []string { return splitTokens(q) }

// ---------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------

func (s *Store) loadParts(ctx context.Context, msgID, disposition string) ([]Part, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, message_id, part_id, filename, content_type, content_id,
		       disposition, size, content,
		       checksum_md5, checksum_sha1, checksum_sha256
		FROM attachments
		WHERE message_id = ? AND disposition = ?
		ORDER BY id ASC
	`, msgID, disposition)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Part
	for rows.Next() {
		var p Part
		if err := rows.Scan(
			&p.ID, &p.MessageID, &p.PartID, &p.Filename, &p.ContentType, &p.ContentID,
			&p.Disposition, &p.Size, &p.Content,
			&p.ChecksumMD5, &p.ChecksumSHA1, &p.ChecksumSHA256,
		); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (s *Store) allIDs(ctx context.Context) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM messages`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (s *Store) filterExisting(ctx context.Context, ids []string) ([]string, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	placeholders, args := inClause(ids)
	rows, err := s.db.QueryContext(ctx,
		`SELECT id FROM messages WHERE id IN (`+placeholders+`)`, args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// inClause builds a "?,?,?" placeholder string + matching []any args.
func inClause(ids []string) (string, []any) {
	if len(ids) == 0 {
		return "", nil
	}
	placeholders := strings.Repeat("?,", len(ids))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return placeholders, args
}

func splitTokens(q string) []string {
	var out []string
	for _, t := range strings.Fields(strings.TrimSpace(q)) {
		if t != "" {
			out = append(out, t)
		}
	}
	return out
}

// buildFTSMatchExpr turns a slice of whitespace-split user tokens into
// an FTS5 MATCH expression. Each token is wrapped in double quotes so
// FTS5 operators inside the token (parens, hyphens, AND/OR, etc.) are
// treated as literal text, and suffixed with `*` so partial typing
// matches (typing "foo" finds "foobar"). Internal double quotes are
// escaped per FTS5's "" rule. Tokens are space-joined: FTS5's default
// is implicit AND across phrases.
func buildFTSMatchExpr(tokens []string) string {
	if len(tokens) == 0 {
		return ""
	}
	parts := make([]string, 0, len(tokens))
	for _, t := range tokens {
		parts = append(parts, `"`+strings.ReplaceAll(t, `"`, `""`)+`"*`)
	}
	return strings.Join(parts, " ")
}
