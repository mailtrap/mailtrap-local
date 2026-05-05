package smtpd

import (
	"context"
	"net"
	"net/smtp"
	"strings"
	"testing"

	"github.com/jhillyerd/enmime/v2"
	"github.com/mailtrap/mailtrap-local/internal/store"
)

// TestExtractCategory pins the X-MT-Category > Category precedence.
func TestExtractCategory(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, raw, want string
	}{
		{
			"X-MT-Category alone",
			"From: a@x\r\nX-MT-Category: Welcome\r\n\r\nbody\r\n",
			"Welcome",
		},
		{
			"Category alone (fallback)",
			"From: a@x\r\nCategory: Welcome\r\n\r\nbody\r\n",
			"Welcome",
		},
		{
			"X-MT-Category wins over Category",
			"From: a@x\r\nCategory: Lower\r\nX-MT-Category: Higher\r\n\r\nbody\r\n",
			"Higher",
		},
		{
			"neither header",
			"From: a@x\r\nSubject: x\r\n\r\nbody\r\n",
			"",
		},
		{
			"trims whitespace",
			"From: a@x\r\nX-MT-Category:    Welcome   \r\n\r\nbody\r\n",
			"Welcome",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env, err := enmime.ReadEnvelope(strings.NewReader(tc.raw))
			if err != nil {
				t.Fatalf("read envelope: %v", err)
			}
			got := extractCategory(env)
			if got != tc.want {
				t.Errorf("got %q, want %q", got, tc.want)
			}
		})
	}
}

// TestBuildPayloadIncludesCategory wires extract through buildPayload.
func TestBuildPayloadIncludesCategory(t *testing.T) {
	t.Parallel()
	raw := "From: a@example.com\r\nTo: b@example.com\r\nX-MT-Category: Welcome\r\n\r\nhi\r\n"
	env, err := enmime.ReadEnvelope(strings.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	p := buildPayload(env, []byte(raw), "a@example.com", []string{"b@example.com"})
	if p.Category != "Welcome" {
		t.Errorf("payload.Category = %q, want Welcome", p.Category)
	}
}

// TestExpandListenAddrs validates the localhost dual-stack expansion.
func TestExpandListenAddrs(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want []string
	}{
		{"127.0.0.1:3535", []string{"127.0.0.1:3535", "[::1]:3535"}},
		{"localhost:3535", []string{"127.0.0.1:3535", "[::1]:3535"}},
		{"0.0.0.0:3535", []string{"0.0.0.0:3535"}},
		{"127.0.0.1:3535,[::1]:3535", []string{"127.0.0.1:3535", "[::1]:3535"}},
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			got := expandListenAddrs(tc.in)
			if len(got) != len(tc.want) {
				t.Fatalf("got %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("[%d] got %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// TestEndToEndIngest brings up an SMTP listener on a random port, sends
// a real DATA payload, and asserts the message landed in the store
// with the right shape + that AfterInsert fired with the correct ID.
func TestEndToEndIngest(t *testing.T) {
	st, err := store.OpenMemory()
	if err != nil {
		t.Fatalf("open memory: %v", err)
	}
	defer st.Close()

	var afterInsertID string
	srv := &Server{
		// Random ephemeral port — avoids collision with anything else.
		Listen:      "127.0.0.1:0",
		Store:       st,
		AfterInsert: func(id string) { afterInsertID = id },
	}
	if err := srv.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	defer srv.Close()

	addr := srv.Addrs()[0]
	c, err := smtp.Dial(addr)
	if err != nil {
		t.Fatalf("dial %s: %v", addr, err)
	}
	defer c.Close()

	if err := c.Hello("test"); err != nil {
		t.Fatalf("HELO: %v", err)
	}
	if err := c.Mail("sender@example.test"); err != nil {
		t.Fatalf("MAIL: %v", err)
	}
	if err := c.Rcpt("rcpt@example.test"); err != nil {
		t.Fatalf("RCPT: %v", err)
	}
	w, err := c.Data()
	if err != nil {
		t.Fatalf("DATA: %v", err)
	}
	body := strings.NewReader(
		"From: Sender <sender@example.test>\r\n" +
			"To: rcpt@example.test\r\n" +
			"Subject: Hello via SMTP\r\n" +
			"X-MT-Category: welcome\r\n" +
			"\r\n" +
			"body line\r\n",
	)
	if _, err := body.WriteTo(w); err != nil {
		t.Fatalf("write data: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close data: %v", err)
	}
	if err := c.Quit(); err != nil {
		t.Fatalf("QUIT: %v", err)
	}

	// Verify the row landed.
	res, err := st.List(context.Background(), store.ListOpts{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 1 {
		t.Fatalf("total = %d, want 1", res.Total)
	}
	got := res.Messages[0]
	if got.Subject != "Hello via SMTP" {
		t.Errorf("subject = %q", got.Subject)
	}
	if got.Category == nil || *got.Category != "welcome" {
		t.Errorf("category = %v", got.Category)
	}
	if afterInsertID == "" {
		t.Error("AfterInsert was not called")
	}
	if afterInsertID != got.ID {
		t.Errorf("AfterInsert id = %q, want %q", afterInsertID, got.ID)
	}
}

// TestRejectEmptyData ensures we don't persist a row for an empty DATA
// body — go-smtp returns ([]byte{}, nil) when a client closes after
// sending DATA without bytes.
func TestRejectEmptyData(t *testing.T) {
	st, _ := store.OpenMemory()
	defer st.Close()

	srv := &Server{Listen: "127.0.0.1:0", Store: st}
	if err := srv.Start(); err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	addr := srv.Addrs()[0]
	c, err := smtp.Dial(addr)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	_ = c.Hello("test")
	_ = c.Mail("a@b")
	_ = c.Rcpt("c@d")
	w, _ := c.Data()
	// Close immediately — empty body.
	_ = w.Close()
	_ = c.Quit()
	c.Close()

	res, err := st.List(context.Background(), store.ListOpts{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 0 {
		t.Errorf("expected no messages persisted; total = %d", res.Total)
	}
}

// silence the unused-import warning for net (used transitively below)
var _ = net.IPv4
