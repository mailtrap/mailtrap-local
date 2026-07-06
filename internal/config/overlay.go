package config

import "github.com/mailtrap/mailtrap-local/internal/store"

// OverlayCloud applies YAML cloud settings onto a DB row (config wins).
func OverlayCloud(c *store.CloudConnection, cfg Cloud) {
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

// OverlayRelay applies YAML relay settings onto a DB row (config wins).
func OverlayRelay(c *store.RelayConnection, cfg Relay) {
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

// OverlayWebhook applies YAML webhook settings onto a DB row (config wins).
func OverlayWebhook(c *store.WebhookConnection, cfg Webhook) {
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
