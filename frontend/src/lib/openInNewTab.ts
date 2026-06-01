/**
 * Open caught-message content in a new browser tab.
 *
 * Security: a `blob:` document inherits the **opener's origin**, so
 * opening untrusted email HTML directly as a top-level page would let a
 * `<script>` in a caught message run in the app's same-origin context
 * and call the local API (read the inbox, repoint the webhook, …).
 *
 * So for HTML we never open the email markup as the top-level document.
 * Instead we open a tiny wrapper page (which carries no script of its
 * own) that embeds the email inside a `sandbox`ed iframe — exactly the
 * isolation the in-app preview uses. `sandbox` with no allow-tokens
 * disables script execution and same-origin access for the frame, so
 * the email can render (and load remote images) but cannot touch the
 * app origin. Plain text is rendered as-is — it isn't executable.
 */
export function openInNewTab(
  content: string,
  mime: 'text/html' | 'text/plain',
) {
  let body = content
  let type = `${mime};charset=utf-8`

  if (mime === 'text/html') {
    body = htmlSandboxShell(content)
    type = 'text/html;charset=utf-8'
  }

  const blob = new Blob([body], { type })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  // Revoke after the new tab has had a chance to navigate.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Wrap untrusted HTML in a full-viewport, script-free page whose only
 * content is a sandboxed iframe rendering the email via `srcdoc`. The
 * email HTML is escaped for a double-quoted attribute value (`&` and `"`
 * only — `<`/`>` are literal inside an attribute), so it can't break out
 * of `srcdoc`.
 */
function htmlSandboxShell(html: string): string {
  const srcdoc = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>Message HTML</title>' +
    '<style>html,body{margin:0;height:100vh}iframe{border:0;width:100%;height:100%}</style>' +
    '</head><body>' +
    `<iframe sandbox srcdoc="${srcdoc}"></iframe>` +
    '</body></html>'
  )
}
