package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/mailtrap/mailtrap-local/internal/store"
)

const maxListStart = 1_000_000

// listMessages handles GET /api/v1/messages.
func (s *Server) listMessages(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	start := clamp(parseInt(q.Get("start"), 0), 0, maxListStart)
	limit := clamp(parseInt(q.Get("limit"), defaultLimit), 1, maxLimit)
	category := strings.TrimSpace(q.Get("category"))

	res, err := s.Store.List(r.Context(), store.ListOpts{
		Start: start, Limit: limit, Category: category,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	summaries := make([]MessageSummary, 0, len(res.Messages))
	for _, m := range res.Messages {
		summaries = append(summaries, toWireSummary(m, res.AttachmentsCnt[m.ID]))
	}

	writeJSON(w, http.StatusOK, MessagesResponse{
		Total:          res.Total,
		Unread:         res.Unread,
		Count:          len(summaries),
		MessagesCount:  res.Total,
		MessagesUnread: res.Unread,
		Start:          start,
		Tags:           nonNilStrings(res.AllCategories),
		Messages:       summaries,
	})
}

// search handles GET /api/v1/search.
func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	query := q.Get("query")
	start := clamp(parseInt(q.Get("start"), 0), 0, maxListStart)
	limit := clamp(parseInt(q.Get("limit"), defaultLimit), 1, maxLimit)
	category := strings.TrimSpace(q.Get("category"))

	cats, _ := s.Store.AllCategories(r.Context())

	if len(store.SplitTokens(query)) == 0 {
		writeJSON(w, http.StatusOK, MessagesResponse{
			Tags:     nonNilStrings(cats),
			Messages: []MessageSummary{},
			Start:    start,
		})
		return
	}

	res, err := s.Store.Search(r.Context(), store.SearchOpts{
		Query: query, Start: start, Limit: limit, Category: category,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	summaries := make([]MessageSummary, 0, len(res.Messages))
	for _, m := range res.Messages {
		summaries = append(summaries, toWireSummary(m, res.AttachmentsCnt[m.ID]))
	}

	writeJSON(w, http.StatusOK, MessagesResponse{
		Total:          res.Total,
		Unread:         res.Unread,
		Count:          len(summaries),
		MessagesCount:  res.Total,
		MessagesUnread: res.Unread,
		Start:          start,
		Tags:           nonNilStrings(res.AllCategories),
		Messages:       summaries,
	})
}

// getMessage handles GET /api/v1/message/:id. Side effect: marks the
// message as read.
func (s *Server) getMessage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	m, err := s.Store.Get(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	// Best-effort mark-as-read; failure to mark shouldn't fail the GET.
	if !m.Read() {
		_ = s.Store.MarkAsRead(r.Context(), m.ID)
		// Reflect locally so the response carries the read flag.
		now := timeNow()
		m.ReadAt = &now
	}

	inline, _ := s.Store.LoadInline(r.Context(), m.ID)
	atts, _ := s.Store.LoadAttachments(r.Context(), m.ID)
	writeJSON(w, http.StatusOK, toWireDetail(m, inline, atts))
}

// rawMessage handles GET /api/v1/message/:id/raw — returns RFC822 source
// as text/plain. ?dl=1 forces download via Content-Disposition.
func (s *Server) rawMessage(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	m, err := s.Store.Get(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	disp := "inline"
	if r.URL.Query().Get("dl") != "" {
		disp = "attachment"
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	// text/plain + nosniff (set globally) keeps this from being sniffed
	// into HTML; the CSP is belt-and-suspenders for the raw RFC822 source.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.Header().Set("Content-Disposition", disp+`; filename="`+m.ID+`.eml"`)
	_, _ = w.Write(m.Raw) //nolint:gosec // raw RFC822 download; not rendered as HTML
}

// headers handles GET /api/v1/message/:id/headers — returns parsed
// headers as { Name: [values] }, alphabetized.
func (s *Server) headers(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	m, err := s.Store.Get(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Message not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	headersMap := map[string][]string{}
	if len(m.Raw) > 0 {
		// bytes.NewReader avoids copying the raw message into a string.
		if msg, err := mail.ReadMessage(bytes.NewReader(m.Raw)); err == nil {
			for k, vs := range msg.Header {
				headersMap[k] = append(headersMap[k], vs...)
			}
		}
	}

	// encoding/json marshals map keys in sorted order, so the response is
	// alphabetized by header name without any extra work here.
	writeJSON(w, http.StatusOK, headersMap)
}

// part handles GET /api/v1/message/:id/part/:part_id — attachment bytes
// with the original Content-Type.
func (s *Server) part(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	partID := chi.URLParam(r, "part_id")
	p, err := s.Store.LoadPartByID(r.Context(), id, partID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "Part not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ct := p.ContentType
	if ct == "" {
		ct = "application/octet-stream"
	}
	w.Header().Set("Content-Type", ct)
	// Defense in depth: a part is attacker-controlled bytes with an
	// attacker-controlled Content-Type (e.g. text/html or image/svg+xml,
	// both of which can carry script). Serving it inline would render it
	// in the app origin. Always force a download, and lock the response
	// down with a CSP that disallows everything in case a browser renders
	// it anyway.
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	filename := p.Filename
	if filename == "" && p.ContentID != "" {
		filename = p.ContentID
	}
	if filename == "" {
		filename = "attachment"
	}
	w.Header().Set("Content-Disposition", `attachment; filename="`+sanitizeFilename(filename)+`"`)
	_, _ = w.Write(p.Content) //nolint:gosec // attachment bytes; Content-Type set explicitly
}

// updateRead handles PUT /api/v1/messages — bulk read/unread toggle.
// Body: { read: bool, ids?: [strings] }. With ids, marks just those;
// without, marks ALL.
func (s *Server) updateRead(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Read bool     `json:"read"`
		IDs  []string `json:"ids"`
	}
	if r.ContentLength != 0 {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeError(w, http.StatusBadRequest, "decode body: "+err.Error())
			return
		}
	}
	ids := nonBlank(body.IDs)
	if err := s.Store.MarkRead(r.Context(), body.Read, ids...); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("ok"))
}

// destroyMessages handles DELETE /api/v1/messages.
//
// Body shape:
//
//	{ "ids": ["abc", "def"] }   delete those specific messages
//	{ "all": true }             wipe the entire sandbox
//
// Both empty body and unrecognised shapes are rejected with 422 to
// keep "wipe everything" explicit. Earlier versions of this handler
// treated an empty body as "delete all", which meant a malformed JSON
// request silently fell through to a full mailbox wipe — the kind of
// bug that turns a typo in a curl one-liner into a data loss event.
func (s *Server) destroyMessages(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
		All bool     `json:"all"`
	}
	if r.ContentLength == 0 {
		writeError(w, http.StatusUnprocessableEntity,
			"DELETE /api/v1/messages requires a JSON body: {\"ids\":[...]} or {\"all\":true}")
		return
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "decode body: "+err.Error())
		return
	}
	ids := nonBlank(body.IDs)
	if len(ids) == 0 && !body.All {
		writeError(w, http.StatusUnprocessableEntity,
			"specify {\"ids\":[...]} to delete specific messages, or {\"all\":true} to wipe the sandbox")
		return
	}

	deleted, err := s.Store.Delete(r.Context(), ids...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// Live broadcast — best-effort.
	if s.Hub != nil {
		for _, id := range deleted {
			s.Hub.BroadcastDestroyed(id)
		}
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte("ok"))
}

// sanitizeFilename strips characters that could break out of the quoted
// Content-Disposition filename parameter. net/http already drops CR/LF
// from header values, but a stray double-quote or backslash would still
// corrupt the parameter (and the original came from attacker-controlled
// mail), so remove them.
func sanitizeFilename(name string) string {
	return strings.NewReplacer(`"`, "", `\`, "").Replace(name)
}

func nonBlank(s []string) []string {
	out := make([]string, 0, len(s))
	for _, v := range s {
		if strings.TrimSpace(v) != "" {
			out = append(out, v)
		}
	}
	return out
}
