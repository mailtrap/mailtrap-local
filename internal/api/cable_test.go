package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func wsURL(httpBase string) string {
	return "ws" + strings.TrimPrefix(httpBase, "http") + "/cable"
}

func TestCableRejectsNonLoopbackOrigin(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	hdr := http.Header{"Origin": {"https://evil.example"}}
	_, resp, err := websocket.DefaultDialer.Dial(wsURL(ts.URL), hdr)
	require.Error(t, err)
	require.NotNil(t, resp)
	assert.Equal(t, http.StatusForbidden, resp.StatusCode)
}

func TestCableAcceptsLoopbackOrigin(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	hdr := http.Header{"Origin": {ts.URL}}
	conn, resp, err := websocket.DefaultDialer.Dial(wsURL(ts.URL), hdr)
	require.NoError(t, err)
	require.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	_ = conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	_ = conn.Close()
}

func TestCableAcceptsMissingOrigin(t *testing.T) {
	t.Parallel()
	_, ts := newTestServer(t)

	conn, resp, err := websocket.DefaultDialer.Dial(wsURL(ts.URL), nil)
	require.NoError(t, err)
	require.Equal(t, http.StatusSwitchingProtocols, resp.StatusCode)
	_ = conn.WriteMessage(websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	_ = conn.Close()
}

func TestCableReceivesBroadcast(t *testing.T) {
	t.Parallel()
	srv, ts := newTestServer(t)
	_ = ts

	conn, _, err := websocket.DefaultDialer.Dial(wsURL(ts.URL), nil)
	require.NoError(t, err)
	defer func() { _ = conn.Close() }()

	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	srv.Hub.BroadcastCreated(json.RawMessage(`{"id":"live-1","subject":"Hi"}`))

	_, msg, err := conn.ReadMessage()
	require.NoError(t, err)
	assert.Contains(t, string(msg), `"type":"created"`)
	assert.Contains(t, string(msg), "live-1")
}
