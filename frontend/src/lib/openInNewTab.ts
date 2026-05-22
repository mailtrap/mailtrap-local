export function openInNewTab(
  content: string,
  mime: 'text/html' | 'text/plain',
) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  // Revoke after the new tab has had a chance to navigate.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
