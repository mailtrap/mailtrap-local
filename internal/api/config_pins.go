package api

import (
	"github.com/mailtrap/mailtrap-local/internal/config"
	"github.com/mailtrap/mailtrap-local/internal/store"
)

func (s *Server) connCfg() *config.Loaded {
	if s.Config == nil {
		return &config.Loaded{}
	}
	return s.Config.Get()
}

func tokenHint(locked bool, token string) *string {
	if locked {
		s := "from config"
		return &s
	}
	if token == "" {
		return nil
	}
	s := "••••" + lastN(token, 4)
	return &s
}

func secretHint(locked bool, secret string) *string {
	if locked {
		s := "from config"
		return &s
	}
	if secret == "" {
		return nil
	}
	s := "••••" + lastN(secret, secretMaskVisible)
	return &s
}

func applyCloudCfg(c *store.CloudConnection, cfg config.Cloud) {
	if v := cfg.APIToken; v != nil {
		c.APIToken = *v
	}
	if v := cfg.SandboxID; v != nil {
		c.SandboxID = *v
	}
	if v := cfg.MirrorEnabled; v != nil {
		c.MirrorEnabled = *v
	}
}

func applyRelayCfg(c *store.RelayConnection, cfg config.Relay) {
	if v := cfg.Host; v != nil {
		c.Host = *v
	}
	if v := cfg.Port; v != nil {
		c.Port = *v
	}
	if v := cfg.Username; v != nil {
		c.Username = *v
	}
	if v := cfg.Password; v != nil {
		c.Password = *v
	}
	if v := cfg.Auth; v != nil {
		c.Auth = *v
	}
	if v := cfg.TLS; v != nil {
		c.TLS = *v
	}
	if v := cfg.AutoRelayEnabled; v != nil {
		c.AutoRelayEnabled = *v
	}
	if v := cfg.OverrideFrom; v != nil {
		c.OverrideFrom = *v
	}
	if v := cfg.ReturnPath; v != nil {
		c.ReturnPath = *v
	}
}

func applyWebhookCfg(c *store.WebhookConnection, cfg config.Webhook) {
	if v := cfg.URL; v != nil {
		c.URL = *v
	}
	if v := cfg.Secret; v != nil {
		c.Secret = *v
	}
	if v := cfg.Enabled; v != nil {
		c.Enabled = *v
	}
}
