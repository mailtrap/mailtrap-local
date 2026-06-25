package config

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestCloudLocked(t *testing.T) {
	t.Parallel()
	token, sid := "t", int64(1)
	mirror := true
	locked := CloudLocked(Cloud{
		APIToken:      &token,
		SandboxID:     &sid,
		MirrorEnabled: &mirror,
	})
	assert.True(t, locked["api_token"])
	assert.True(t, locked["sandbox_id"])
	assert.True(t, locked["mirror_enabled"])
	assert.False(t, CloudLocked(Cloud{})["api_token"])
}
