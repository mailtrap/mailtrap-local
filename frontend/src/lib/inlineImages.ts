/**
 * Inline images in caught emails arrive as separate MIME parts referenced
 * from the HTML via `cid:<content-id>` URLs (RFC 2392). Browsers can't
 * resolve the cid: scheme, so the preview iframe shows broken images.
 * This helper rewrites each cid: reference to the backend part endpoint,
 * which serves the part's bytes with its original Content-Type.
 *
 * Rewritten URLs are origin-absolute so they resolve both in the in-app
 * preview iframe (srcDoc inherits the app's base URL anyway) and in the
 * "open in new tab" popout, whose blob: document cannot resolve
 * root-relative paths.
 */
import { partUrl, type AttachmentSummary } from '../api/messages'

export function resolveCidUrls(
  html: string,
  messageId: string,
  parts: AttachmentSummary[],
): string {
  const partIdByContentId = new Map<string, string>()
  for (const p of parts) {
    // The API sends content_id as parsed from the MIME header; trim the
    // RFC 2045 angle brackets defensively in case they survived parsing.
    const cid = p.content_id.replace(/^</, '').replace(/>$/, '')
    if (cid && !partIdByContentId.has(cid)) {
      partIdByContentId.set(cid, p.part_id)
    }
  }
  if (partIdByContentId.size === 0) return html

  const replaceCidUrl = (
    match: string,
    prefix: string,
    contentId: string,
  ): string => {
    const partId =
      partIdByContentId.get(contentId) ??
      partIdByContentId.get(tryDecodeURIComponent(contentId))
    if (partId === undefined) return match
    return prefix + window.location.origin + partUrl(messageId, partId)
  }

  return html
    .replace(
      /\b((?:src|href|background)\s*=\s*["']?)cid:([^"'\s<>)]+)/gi,
      replaceCidUrl,
    )
    .replace(/\b(url\(\s*["']?)cid:([^"'\s<>)]+)/gi, replaceCidUrl)
}

/** cid refs may be percent-encoded in HTML attributes while the API's
 *  content_id is not — decode for lookup, tolerating malformed escapes. */
function tryDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
