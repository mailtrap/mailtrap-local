// SMTP host shown in hints and code samples: the hostname the UI was
// opened with. location.hostname keeps IPv6 literals bracketed ("[::1]"),
// but SMTP client APIs expect the bare address.
export function smtpHost(hostname = window.location.hostname): string {
  return hostname.replace(/^\[(.*)\]$/, '$1') || '127.0.0.1'
}

// host:port form for URLs and dial strings, re-bracketing IPv6 literals.
export function smtpAddress(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}
