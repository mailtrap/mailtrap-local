package config

// CloudLocked reports which cloud fields are pinned by the loaded YAML.
func CloudLocked(c Cloud) map[string]bool {
	return map[string]bool{
		"api_token":      c.APIToken != nil,
		"sandbox_id":     c.SandboxID != nil,
		"mirror_enabled": c.MirrorEnabled != nil,
	}
}

// RelayLocked reports which relay fields are pinned by the loaded YAML.
func RelayLocked(r Relay) map[string]bool {
	return map[string]bool{
		"host":               r.Host != nil,
		"port":               r.Port != nil,
		"username":           r.Username != nil,
		"password":           r.Password != nil,
		"auth":               r.Auth != nil,
		"tls":                r.TLS != nil,
		"auto_relay_enabled": r.AutoRelayEnabled != nil,
		"override_from":      r.OverrideFrom != nil,
		"return_path":        r.ReturnPath != nil,
	}
}

// WebhookLocked reports which webhook fields are pinned by the loaded YAML.
func WebhookLocked(w Webhook) map[string]bool {
	return map[string]bool{
		"url":     w.URL != nil,
		"secret":  w.Secret != nil,
		"enabled": w.Enabled != nil,
	}
}

// SourcePathRef returns a pointer to the config path for JSON, or nil.
func SourcePathRef(l *Loaded) *string {
	if l == nil || l.SourcePath == "" {
		return nil
	}
	p := l.SourcePath
	return &p
}
