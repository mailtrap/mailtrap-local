package smtpd

import (
	"context"
	"net"
	"net/smtp"
	"strings"
	"testing"

	"github.com/jhillyerd/enmime/v2"
	"github.com/mailtrap/mailtrap-local/internal/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
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
			t.Parallel()
			env, err := enmime.ReadEnvelope(strings.NewReader(tc.raw))
			require.NoError(t, err)
			got := extractCategory(env)
			assert.Equal(t, tc.want, got)
		})
	}
}

// TestBuildPayloadIncludesCategory wires extract through buildPayload.
func TestBuildPayloadIncludesCategory(t *testing.T) {
	t.Parallel()
	raw := "From: a@example.com\r\nTo: b@example.com\r\nX-MT-Category: Welcome\r\n\r\nhi\r\n"
	env, err := enmime.ReadEnvelope(strings.NewReader(raw))
	require.NoError(t, err)
	p := buildPayload(env, []byte(raw), "a@example.com", []string{"b@example.com"})
	assert.Equal(t, "Welcome", p.Category)
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
			t.Parallel()
			got := expandListenAddrs(tc.in)
			require.Equal(t, tc.want, got)
		})
	}
}

// TestEndToEndIngest brings up an SMTP listener on a random port, sends
// a real DATA payload, and asserts the message landed in the store
// with the right shape + that AfterInsert fired with the correct ID.
func TestEndToEndIngest(t *testing.T) {
	st, err := store.OpenMemory()
	require.NoError(t, err)
	defer func() { _ = st.Close() }()

	var afterInsertID string
	srv := &Server{
		// Random ephemeral port — avoids collision with anything else.
		Listen:      "127.0.0.1:0",
		Store:       st,
		AfterInsert: func(id string) { afterInsertID = id },
	}
	require.NoError(t, srv.Start())
	defer func() { srv.Close() }()

	addr := srv.Addrs()[0]
	c, err := smtp.Dial(addr)
	require.NoError(t, err)
	defer func() { _ = c.Close() }()

	require.NoError(t, c.Hello("test"))
	require.NoError(t, c.Mail("sender@example.test"))
	require.NoError(t, c.Rcpt("rcpt@example.test"))
	w, err := c.Data()
	require.NoError(t, err)
	body := strings.NewReader(
		"From: Sender <sender@example.test>\r\n" +
			"To: rcpt@example.test\r\n" +
			"Subject: Hello via SMTP\r\n" +
			"X-MT-Category: welcome\r\n" +
			"\r\n" +
			"body line\r\n",
	)
	_, err = body.WriteTo(w)
	require.NoError(t, err)
	require.NoError(t, w.Close())
	require.NoError(t, c.Quit())

	// Verify the row landed.
	res, err := st.List(context.Background(), store.ListOpts{Limit: 10})
	require.NoError(t, err)
	require.Equal(t, 1, res.Total)
	got := res.Messages[0]
	assert.Equal(t, "Hello via SMTP", got.Subject)
	require.NotNil(t, got.Category)
	assert.Equal(t, "welcome", *got.Category)
	assert.NotEmpty(t, afterInsertID)
	assert.Equal(t, got.ID, afterInsertID)
}

// TestRejectEmptyData ensures we don't persist a row for an empty DATA
// body — go-smtp returns ([]byte{}, nil) when a client closes after
// sending DATA without bytes.
func TestRejectEmptyData(t *testing.T) {
	st, _ := store.OpenMemory()
	defer func() { _ = st.Close() }()

	srv := &Server{Listen: "127.0.0.1:0", Store: st}
	require.NoError(t, srv.Start())
	defer func() { srv.Close() }()

	addr := srv.Addrs()[0]
	c, err := smtp.Dial(addr)
	require.NoError(t, err)
	_ = c.Hello("test")
	_ = c.Mail("a@b")
	_ = c.Rcpt("c@d")
	w, _ := c.Data()
	// Close immediately — empty body.
	_ = w.Close()
	_ = c.Quit()
	_ = c.Close()

	res, err := st.List(context.Background(), store.ListOpts{Limit: 10})
	require.NoError(t, err)
	assert.Equal(t, 0, res.Total)
}

// silence the unused-import warning for net (used transitively below)
var _ = net.IPv4
