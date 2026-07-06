package store

import (
	"crypto/md5"  //nolint:gosec // content fingerprint, not crypto — MD5 here is a content fingerprint, not a security primitive
	"crypto/sha1" //nolint:gosec // content fingerprint, not crypto
	"crypto/sha256"
	"encoding/hex"
)

// checksums returns hex-encoded MD5/SHA1/SHA256 of the given bytes.
// All three are stored on each attachment row and exposed via the API's
// Checksums field — clients display them and dedupe by them.
func checksums(b []byte) (string, string, string) {
	md5sum := md5.Sum(b)   //nolint:gosec
	sha1sum := sha1.Sum(b) //nolint:gosec // content fingerprint
	sha256sum := sha256.Sum256(b)
	return hex.EncodeToString(md5sum[:]),
		hex.EncodeToString(sha1sum[:]),
		hex.EncodeToString(sha256sum[:])
}
