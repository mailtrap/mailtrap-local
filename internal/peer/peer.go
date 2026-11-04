// Package peer decides which client addresses may connect. mailtrap-local
// has no auth, so the connection's source address is the only thing that
// separates "this machine" from everything else on the network.
//
// Loopback is always allowed. AllowList adds extra ranges for setups
// where same-machine traffic arrives from another address — inside a
// Docker container, the host's connections come from the bridge gateway.
package peer

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"strings"
)

var (
	errEmptyEntry        = errors.New("empty entry")
	errShortMappedPrefix = errors.New("IPv4-mapped range must be /96 or longer")
)

// mappedPrefixBits is the ::ffff:0:0/96 prefix that IPv4-mapped
// addresses share.
const mappedPrefixBits = 96

// AllowList is a set of address ranges allowed in addition to loopback.
type AllowList []netip.Prefix

// Parse reads a comma-separated list of IPs and CIDR ranges, e.g.
// "172.16.0.0/12,192.168.65.1". Empty input yields an empty list.
func Parse(s string) (AllowList, error) {
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	var out AllowList
	for entry := range strings.SplitSeq(s, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			return nil, fmt.Errorf("allow-from %q: %w", s, errEmptyEntry)
		}
		if strings.Contains(entry, "/") {
			p, err := netip.ParsePrefix(entry)
			if err != nil {
				return nil, fmt.Errorf("allow-from %q: %w", entry, err)
			}
			// Allows compares unmapped addresses, so store an IPv4-mapped
			// range as the IPv4 range it covers.
			if p.Addr().Is4In6() {
				if p.Bits() < mappedPrefixBits {
					return nil, fmt.Errorf("allow-from %q: %w", entry, errShortMappedPrefix)
				}
				p = netip.PrefixFrom(p.Addr().Unmap(), p.Bits()-mappedPrefixBits)
			}
			out = append(out, p.Masked())
			continue
		}
		a, err := netip.ParseAddr(entry)
		if err != nil {
			return nil, fmt.Errorf("allow-from %q: %w", entry, err)
		}
		out = append(out, netip.PrefixFrom(a.Unmap(), a.Unmap().BitLen()))
	}
	return out, nil
}

// AttachedNetworks returns the subnets of this machine's non-loopback
// interfaces. Inside a container these are its Docker networks: the
// host's traffic arrives from their gateway, and sibling containers from
// inside them, whichever address pool Docker picked.
func AttachedNetworks() (AllowList, error) {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil, fmt.Errorf("list interface addresses: %w", err)
	}
	return subnets(addrs), nil
}

// subnets keeps the networks of global unicast addresses; link-local
// ranges would admit anything on the same link.
func subnets(addrs []net.Addr) AllowList {
	var out AllowList
	for _, addr := range addrs {
		ipn, ok := addr.(*net.IPNet)
		if !ok {
			continue
		}
		a, ok := netip.AddrFromSlice(ipn.IP)
		if !ok {
			continue
		}
		a = a.Unmap()
		if !a.IsGlobalUnicast() {
			continue
		}
		ones, bits := ipn.Mask.Size()
		if bits == net.IPv6len*8 && a.Is4() {
			ones -= mappedPrefixBits
		}
		out = append(out, netip.PrefixFrom(a, ones).Masked())
	}
	return out
}

// Allows reports whether a "host:port" remote address (net.Conn
// RemoteAddr / http.Request.RemoteAddr) may connect.
func (l AllowList) Allows(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	a, err := netip.ParseAddr(host)
	if err != nil {
		return false
	}
	a = a.Unmap().WithZone("")
	if a.IsLoopback() {
		return true
	}
	for _, p := range l {
		if p.Contains(a) {
			return true
		}
	}
	return false
}
