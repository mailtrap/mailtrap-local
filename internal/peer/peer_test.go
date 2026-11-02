package peer

import (
	"net"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAllowsLoopbackByDefault(t *testing.T) {
	t.Parallel()
	var l AllowList
	assert.True(t, l.Allows("127.0.0.1:50000"))
	assert.True(t, l.Allows("127.0.0.5:50000"))
	assert.True(t, l.Allows("[::1]:50000"))
	assert.True(t, l.Allows("[::ffff:127.0.0.1]:50000"))
	assert.False(t, l.Allows("192.168.1.5:50000"))
	assert.False(t, l.Allows("[fe80::1%en0]:50000"))
	assert.False(t, l.Allows("not-an-address"))
}

func TestParseAndAllow(t *testing.T) {
	t.Parallel()
	l, err := Parse("172.16.0.0/12, 192.168.65.1")
	require.NoError(t, err)
	assert.True(t, l.Allows("172.17.0.1:50000"))
	assert.True(t, l.Allows("192.168.65.1:50000"))
	assert.False(t, l.Allows("192.168.65.2:50000"))
	assert.False(t, l.Allows("10.0.0.1:50000"))
	assert.True(t, l.Allows("127.0.0.1:50000"))
}

func TestParseIPv4MappedRange(t *testing.T) {
	t.Parallel()
	l, err := Parse("::ffff:192.168.1.0/120")
	require.NoError(t, err)
	assert.True(t, l.Allows("192.168.1.42:50000"))
	assert.True(t, l.Allows("[::ffff:192.168.1.42]:50000"))
	assert.False(t, l.Allows("192.168.2.1:50000"))
}

func TestSubnets(t *testing.T) {
	t.Parallel()
	l := subnets([]net.Addr{
		&net.IPNet{IP: net.ParseIP("127.0.0.1"), Mask: net.CIDRMask(8, 32)},
		&net.IPNet{IP: net.ParseIP("192.168.208.2").To4(), Mask: net.CIDRMask(20, 32)},
		&net.IPNet{IP: net.ParseIP("10.88.0.5"), Mask: net.CIDRMask(112, 128)},
		&net.IPNet{IP: net.ParseIP("fd00:1::2"), Mask: net.CIDRMask(64, 128)},
		&net.IPNet{IP: net.ParseIP("fe80::1"), Mask: net.CIDRMask(64, 128)},
		&net.IPAddr{IP: net.ParseIP("172.17.0.2")},
	})
	assert.Equal(t, []string{"192.168.208.0/20", "10.88.0.0/16", "fd00:1::/64"}, toStrings(l))
	assert.True(t, l.Allows("192.168.208.1:50000"))
	assert.False(t, l.Allows("192.168.1.5:50000"))
	assert.False(t, l.Allows("[fe80::2]:50000"))
}

func toStrings(l AllowList) []string {
	out := make([]string, 0, len(l))
	for _, p := range l {
		out = append(out, p.String())
	}
	return out
}

func TestParseEmpty(t *testing.T) {
	t.Parallel()
	l, err := Parse("")
	require.NoError(t, err)
	assert.Empty(t, l)
}

func TestParseRejectsInvalid(t *testing.T) {
	t.Parallel()
	for _, s := range []string{"nope", "10.0.0.0/33", "10.0.0.1,,10.0.0.2", "::ffff:0.0.0.0/64"} {
		_, err := Parse(s)
		assert.Error(t, err, s)
	}
}
