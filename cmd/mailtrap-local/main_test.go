package main

import "testing"

func TestRequireLoopback(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		addr    string
		wantErr bool
	}{
		// Accepted: explicit loopback.
		{"v4 loopback", "127.0.0.1:3535", false},
		{"v4 loopback alt", "127.0.0.5:3535", false},
		{"v6 loopback", "[::1]:3535", false},
		{"localhost", "localhost:3535", false},

		// Rejected: all-interfaces shortcuts.
		{"empty host (all ifaces)", ":3535", true},
		{"0.0.0.0", "0.0.0.0:3535", true},
		{"v6 unspecified", "[::]:3535", true},

		// Rejected: non-loopback public/private IPs.
		{"lan v4", "192.168.1.10:3535", true},
		{"public v4", "8.8.8.8:3535", true},

		// Rejected: hostnames other than "localhost" — we don't resolve.
		{"arbitrary host", "smtp.example.com:3535", true},

		// Rejected: garbage.
		{"missing port", "127.0.0.1", true},
		{"empty", "", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := requireLoopback(tc.addr)
			if (err != nil) != tc.wantErr {
				t.Errorf("requireLoopback(%q): wantErr=%v, got %v", tc.addr, tc.wantErr, err)
			}
		})
	}
}
