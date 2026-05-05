package store

import (
	"crypto/md5" //nolint:gosec — MD5 here is a content fingerprint, not a security primitive
	"crypto/sha1"
	"crypto/sha256"
	"encoding/hex"
)

// checksums returns hex-encoded MD5/SHA1/SHA256 of the given bytes.
// All three are stored on each attachment row and exposed via the API's
// Checksums field — clients display them and dedupe by them.
func checksums(b []byte) (md5h, sha1h, sha256h string) {
	md5sum := md5.Sum(b) //nolint:gosec
	sha1sum := sha1.Sum(b)
	sha256sum := sha256.Sum256(b)
	return hex.EncodeToString(md5sum[:]),
		hex.EncodeToString(sha1sum[:]),
		hex.EncodeToString(sha256sum[:])
}
