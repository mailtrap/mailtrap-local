package api

import "github.com/mailtrap/mailtrap-local/internal/config"

const tokenHintVisible = 4

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
	s := "••••" + lastN(token, tokenHintVisible)
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
