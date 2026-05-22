import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import * as Tabs from '@radix-ui/react-tabs'
import { Highlight, themes } from 'prism-react-renderer'
import {
  DeleteIcon,
  ForwardIcon,
  SuccessFilledIcon,
  DownloadIcon,
  ExternalLinkIcon,
  CloudUploadIcon,
  CloseIcon,
} from '../components/icons'
import {
  getMessage,
  getRawMessage,
  getHeaders,
  getHtmlCheck,
  deleteMessage,
  rawMessageUrl,
  type ClientCategory,
  type HeadersMap,
  type HtmlCheckReport,
  type Message,
} from '../api/messages'
import { formatAddr, formatDate, formatSize } from '../lib/messageFormatters'
import { noSupportIssueCount } from '../lib/htmlCheckStats'
import { sendMessageToCloud } from '../api/cloud'
import { releaseMessage } from '../api/relay'
import { useCloudConnection } from '../hooks/useCloudConnection'
import { useRelayConnection } from '../hooks/useRelayConnection'
import { IconButton } from '../components/IconButton'
import TechInfo from '../components/TechInfo'
import HtmlCheck from '../components/HtmlCheck'
import MessagePreview from '../components/MessagePreview'
import { openInNewTab } from '../lib/openInNewTab'
import { extractApiError, isAbortError } from '../api/client'

const wrap = 'm-0'

// Header is a 2-col / 3-row grid:
//   row 1: subject (col 1)            | actions (col 2)
//   row 2: meta (col 1)               | time + size + category (col 2)
//   row 3: "Show Headers" link (col 1)
const headerCss =
  'grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 items-start pb-4 border-b border-border-base'

const headerSubjectCss =
  'col-start-1 row-start-1 m-0 text-[22px] font-semibold leading-[1.21]'

const headerActionsCss = [
  'col-start-2 row-start-1 justify-self-end',
  'flex items-center justify-end gap-1',
].join(' ')

const headerMetaCss =
  'col-start-1 row-start-2 text-[13px] leading-[1.7] text-fg-muted'

const headerMetaLabelCss = 'mr-1.5 text-fg-muted'
const headerMetaValCss = 'text-fg'

const headerTimesizeCss = [
  'col-start-2 row-start-2 self-start',
  'flex flex-col items-end gap-1.5',
  'whitespace-nowrap text-right text-[13px] text-fg-muted',
].join(' ')

const headerCategoryCss = [
  'inline-block max-w-[200px] overflow-hidden text-ellipsis',
  'rounded-full bg-accent-medium px-2.5 py-0.5',
  'text-[11px] font-semibold leading-[1.6] text-accent',
].join(' ')

const headerHeadersLinkCss = [
  'col-start-1 row-start-3 justify-self-start',
  'cursor-pointer pt-0.5 text-[13px] text-accent hover:underline',
].join(' ')

function MetaRow({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div>
      <span className={headerMetaLabelCss}>{label}:</span>
      <span className={headerMetaValCss}>{children}</span>
    </div>
  )
}

// Positioning override for the pop-out icon overlaying each tab content.
const popoutPosition = 'absolute top-0 right-0'

// Inline success strip (action feedback below the header).
const successStripCss = [
  'mt-2.5 flex items-center gap-2 rounded-md border border-success/30 bg-success/[0.08]',
  'px-3 py-2 text-xs leading-[1.4] text-success',
].join(' ')

const successStripTextCss = 'flex-1 min-w-0'

const successStripDismissCss = [
  'inline-flex h-[18px] w-[18px] cursor-pointer items-center justify-center',
  'rounded text-success hover:bg-success/20',
].join(' ')

const errorStripCss = [
  'mt-2.5 flex items-center gap-2 rounded-md border border-danger-border bg-danger-soft',
  'px-3 py-2 text-xs leading-[1.4] text-danger',
].join(' ')

const errorStripTextCss = 'flex-1 min-w-0'

const errorStripDismissCss = [
  'inline-flex h-[18px] w-[18px] cursor-pointer items-center justify-center',
  'rounded text-danger hover:bg-danger-border',
].join(' ')

// Inline action bars (delete-confirm + forward-form) live inside the
// header's `.actions` slot. Layout only; the forward-form's input
// carries its own shape via inlineBarInputCss.
const inlineBarCss = 'flex items-center gap-2.5 text-[13px] text-fg'

const inlineBarInputCss = [
  'min-w-[220px] rounded-[7px] border border-border-base bg-surface-base',
  'px-3 py-[7px] text-[13px] text-fg outline-none',
  'placeholder:text-fg-muted focus:border-accent',
].join(' ')

// Variant-driven pill button — same shape as dialogStyles.btn but slightly
// chunkier (used inline beside the message header).
const pillBtn = [
  'inline-flex cursor-pointer items-center justify-center rounded-[7px] border border-transparent',
  'px-4 py-1.5 text-[13px] font-semibold',
  'data-[variant=primary]:bg-accent data-[variant=primary]:text-fg',
  'data-[variant=primary]:hover:bg-accent-hover',
  'data-[variant=danger-text]:border-danger data-[variant=danger-text]:text-danger',
  'data-[variant=danger-text]:hover:bg-danger-soft',
  'data-[variant=outline]:border-accent data-[variant=outline]:text-accent',
  'data-[variant=outline]:hover:bg-accent-soft',
  'disabled:cursor-not-allowed disabled:opacity-50',
].join(' ')

const previewWrap = 'relative'

const tabList = 'mt-4 flex gap-[18px] border-b border-border-base p-0'

const tabBadge = [
  'ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full',
  'bg-danger px-1.5 align-middle text-[11px] font-bold leading-none text-fg',
].join(' ')

// Each tab trigger gets its own underline indicator via ::after when
// data-state="active" (Radix sets it).
const tabTrigger = [
  'relative cursor-pointer py-2.5 leading-none text-sm font-medium font-sans text-fg-icon',
  'hover:text-fg',
  'data-[state=active]:text-fg',
  "data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent",
].join(' ')

const tabContent = 'pt-4'

// Plain-text + raw bodies. Match the desktop iframe min-height so short
// payloads still fill the viewport.
const preCss = [
  'rounded-[7px] border border-border-base bg-black/20 p-3 text-fg',
  'font-mono text-xs leading-[1.5]',
  'whitespace-pre-wrap break-words',
  'min-h-[max(500px,calc(100vh-260px))] [box-sizing:border-box]',
].join(' ')

const codeViewerCss = [
  'm-0 rounded-[7px] border border-border-base bg-black/25 p-0',
  'font-mono text-xs leading-[1.55]',
  'min-h-[max(500px,calc(100vh-260px))] [box-sizing:border-box]',
].join(' ')

const codeViewerRowCss = 'grid grid-cols-[48px_1fr]'

const codeViewerLineNumCss = [
  'select-none px-2.5 pr-3 text-right text-[#4d5a6a]',
  'border-r border-border-base',
].join(' ')

const codeViewerCodeCss = 'px-3.5 whitespace-pre-wrap break-words'

function HtmlSource({ code }: { code: string }) {
  return (
    <Highlight theme={themes.vsDark} code={code} language="markup">
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`${codeViewerCss} ${className}`}
          style={{ ...style, background: 'transparent' }}
        >
          {tokens.map((line, i) => {
            const {
              key: _lk,
              className: _lc,
              ...lineProps
            } = getLineProps({
              line,
            })
            return (
              <div key={i} className={codeViewerRowCss} {...lineProps}>
                <span className={codeViewerLineNumCss}>{i + 1}</span>
                <span className={codeViewerCodeCss}>
                  {line.map((token, ti) => {
                    const { key: _tk, ...tokenProps } = getTokenProps({
                      token,
                    })
                    return <span key={ti} {...tokenProps} />
                  })}
                </span>
              </div>
            )
          })}
        </pre>
      )}
    </Highlight>
  )
}


type ActionMode = 'default' | 'delete' | 'forward'

export default function MessageView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [msg, setMsg] = useState<Message | null>(null)
  const [raw, setRaw] = useState<string>('')
  const [headers, setHeaders] = useState<HeadersMap>({})
  const [htmlCheck, setHtmlCheck] = useState<HtmlCheckReport | null>(null)
  const [htmlCheckErr, setHtmlCheckErr] = useState<string | null>(null)
  // HTML Check filter state lives at this level so the tab badge can read
  // the filter-aware `no`-support count alongside the panel itself.
  const [enabledCategories, setEnabledCategories] = useState<
    Record<ClientCategory, boolean>
  >({ desktop: true, mobile: true, web: true })
  const [enabledFamilies, setEnabledFamilies] = useState<
    Record<string, boolean>
  >({})
  // Initialize family filters from the report once it lands.
  useEffect(() => {
    if (htmlCheck?.status === 'success') {
      const init: Record<string, boolean> = {}
      htmlCheck.families.forEach((f) => {
        init[f.family] = true
      })
      setEnabledFamilies(init)
    }
  }, [htmlCheck])
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined)
  const [mode, setMode] = useState<ActionMode>('default')
  const [busy, setBusy] = useState(false)
  const [cloudSent, setCloudSent] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [forwardEmail, setForwardEmail] = useState('')
  const { state: cloudState } = useCloudConnection()
  const { state: relayState } = useRelayConnection()

  // Both per-message forward icons (cloud + SMTP relay) are always rendered
  // so the action's existence is discoverable. When unactionable they get
  // disabled + a tooltip explaining why — clicking does nothing but hover
  // tells the user what to fix.
  const cloudDisabledReason: string | null = !cloudState
    ? 'Loading…'
    : !cloudState.connected
      ? 'Connect to a Mailtrap sandbox first (cloud icon in the sidebar)'
      : cloudState.mirror_enabled
        ? 'Cloud mirror is on — every email is already sent automatically'
        : null

  const relayDisabledReason: string | null = !relayState
    ? 'Loading…'
    : !relayState.connected
      ? 'Configure an SMTP relay first (relay icon in the sidebar)'
      : relayState.auto_relay_enabled
        ? 'Auto-relay is on — every email is already forwarded automatically'
        : null

  useEffect(() => {
    if (!id) return
    setMsg(null)
    setError(null)
    setActiveTab(undefined)
    setMode('default')
    setCloudSent(false)
    setActionError(null)
    setActionSuccess(null)
    setForwardEmail('')
    setHtmlCheck(null)
    setHtmlCheckErr(null)

    // Cancellable fetch: if the user clicks a different message before
    // these resolve, the cleanup aborts the in-flight requests so a
    // stale response can't overwrite the new message's state.
    const controller = new AbortController()
    const { signal } = controller

    Promise.all([
      getMessage(id, signal),
      getRawMessage(id, signal),
      getHeaders(id, signal),
    ])
      .then(([m, r, h]) => {
        if (signal.aborted) return
        setMsg(m)
        setRaw(r)
        setHeaders(h)
        // Kick off HTML Check in the background once we know there's HTML —
        // the result drives the tab's issue-count badge, so it has to load
        // before the user opens the tab.
        if (m.html) {
          getHtmlCheck(id, signal)
            .then((rep) => {
              if (!signal.aborted) setHtmlCheck(rep)
            })
            .catch((e) => {
              if (!isAbortError(e)) setHtmlCheckErr(extractApiError(e))
            })
        }
      })
      .catch((e) => {
        if (!isAbortError(e)) setError(String(e))
      })

    return () => controller.abort()
  }, [id])

  // Auto-dismiss the success strip after a few seconds — the user has
  // confirmation of the action and doesn't need it lingering.
  useEffect(() => {
    if (!actionSuccess) return
    const timer = window.setTimeout(() => setActionSuccess(null), 5000)
    return () => window.clearTimeout(timer)
  }, [actionSuccess])

  // Esc → back to the empty-state sandbox. Skipped while an inline mode
  // (delete-confirm or forward-form) is open — Esc cancels the mode first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Don't hijack Esc inside form inputs / textareas — let them clear.
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      if (mode !== 'default') {
        setMode('default')
        setForwardEmail('')
        return
      }
      navigate('/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, navigate])

  const onConfirmDelete = async () => {
    if (!id) return
    setBusy(true)
    setActionError(null)
    try {
      await deleteMessage(id)
      navigate('/', { replace: true })
    } catch (e) {
      setActionError(`Delete failed: ${extractApiError(e)}`)
      setBusy(false)
    }
  }

  const onSendForward = async () => {
    if (!id) return
    const to = forwardEmail.trim()
    if (!to) return
    setBusy(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      await releaseMessage(id, [to])
      setMode('default')
      setForwardEmail('')
      setActionSuccess(
        relayState?.host
          ? `Forwarded to ${to} via ${relayState.host}`
          : `Forwarded to ${to}`,
      )
    } catch (e) {
      setActionError(`Forward failed: ${extractApiError(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const onCloudForward = async () => {
    if (!id) return
    setBusy(true)
    setActionError(null)
    try {
      await sendMessageToCloud(id)
      setCloudSent(true)
    } catch (e) {
      setActionError(`Send to cloud failed: ${extractApiError(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const onDownload = () => {
    if (!id) return
    // Browser honors Content-Disposition: attachment from ?dl=1.
    window.location.assign(rawMessageUrl(id, true))
  }

  if (error)
    return (
      <section className={wrap}>
        <p className="text-danger">Error: {error}</p>
      </section>
    )
  if (!msg)
    return (
      <section className={wrap}>
        <p className="text-fg-muted">Loading…</p>
      </section>
    )

  return (
    <section className={wrap}>
      <header className={headerCss}>
        <h2 className={headerSubjectCss}>{msg.subject || '(no subject)'}</h2>
        <div className={headerActionsCss}>
          {mode === 'default' && (
            <>
              <IconButton
                title={
                  relayDisabledReason ??
                  `Forward via SMTP relay (${relayState?.host})`
                }
                disabled={!!relayDisabledReason}
                onClick={() => setMode('forward')}
              >
                <ForwardIcon size={18} />
              </IconButton>
              <IconButton
                title={
                  cloudDisabledReason ??
                  (cloudSent
                    ? `Sent to Mailtrap sandbox ${cloudState?.sandbox_id}`
                    : `Send to Mailtrap sandbox ${cloudState?.sandbox_id}`)
                }
                onClick={onCloudForward}
                disabled={!!cloudDisabledReason || busy || cloudSent}
                className={cloudSent ? 'text-success' : undefined}
              >
                {cloudSent ? (
                  <SuccessFilledIcon size={18} />
                ) : (
                  <CloudUploadIcon size={18} />
                )}
              </IconButton>
              <IconButton title="Download .eml" onClick={onDownload}>
                <DownloadIcon size={18} />
              </IconButton>
              <IconButton
                title="Delete email"
                onClick={() => setMode('delete')}
              >
                <DeleteIcon size={18} />
              </IconButton>
            </>
          )}
          {mode === 'delete' && (
            <div className={inlineBarCss}>
              <span>Delete this email?</span>
              <button
                className={pillBtn}
                data-variant="danger-text"
                type="button"
                onClick={onConfirmDelete}
                disabled={busy}
              >
                Confirm
              </button>
              <button
                className={pillBtn}
                data-variant="outline"
                type="button"
                onClick={() => setMode('default')}
                disabled={busy}
              >
                Cancel
              </button>
            </div>
          )}
          {mode === 'forward' && (
            <form
              className={inlineBarCss}
              onSubmit={(e) => {
                e.preventDefault()
                onSendForward()
              }}
            >
              <input
                type="email"
                required
                autoFocus
                placeholder="Forward to email"
                className={inlineBarInputCss}
                value={forwardEmail}
                onChange={(e) => setForwardEmail(e.target.value)}
                disabled={busy}
              />
              <button
                className={pillBtn}
                data-variant="primary"
                type="submit"
                disabled={busy || !forwardEmail.trim()}
              >
                Send
              </button>
              <button
                className={pillBtn}
                data-variant="outline"
                type="button"
                onClick={() => {
                  setMode('default')
                  setForwardEmail('')
                }}
                disabled={busy}
              >
                Cancel
              </button>
            </form>
          )}
        </div>
        <div className={headerMetaCss}>
          <MetaRow label="From">{formatAddr(msg.from)}</MetaRow>
          <MetaRow label="To">
            {msg.to.map((a) => formatAddr(a)).join(', ')}
          </MetaRow>
          {msg.cc.length > 0 && (
            <MetaRow label="Cc">
              {msg.cc.map((a) => formatAddr(a)).join(', ')}
            </MetaRow>
          )}
        </div>
        <div className={headerTimesizeCss}>
          <div>
            {formatDate(msg.date)}, {formatSize(msg.size)}
          </div>
          {msg.tags[0] && (
            <div
              className={headerCategoryCss}
              title={`Category: ${msg.tags[0]}`}
            >
              {msg.tags[0]}
            </div>
          )}
        </div>
        <button
          className={headerHeadersLinkCss}
          type="button"
          onClick={() => setActiveTab('tech')}
        >
          Show Headers
        </button>
      </header>

      {actionError && (
        <div className={errorStripCss} role="alert">
          <span className={errorStripTextCss}>{actionError}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className={errorStripDismissCss}
            onClick={() => setActionError(null)}
          >
            <CloseIcon size={10} />
          </button>
        </div>
      )}

      {actionSuccess && (
        <div className={successStripCss} role="status">
          <SuccessFilledIcon size={14} />
          <span className={successStripTextCss}>{actionSuccess}</span>
          <button
            type="button"
            aria-label="Dismiss"
            className={successStripDismissCss}
            onClick={() => setActionSuccess(null)}
          >
            <CloseIcon size={10} />
          </button>
        </div>
      )}

      <Tabs.Root
        value={activeTab ?? (msg.html ? 'html' : 'text')}
        onValueChange={setActiveTab}
      >
        <Tabs.List className={tabList}>
          {msg.html && (
            <Tabs.Trigger className={tabTrigger} value="html">
              HTML
            </Tabs.Trigger>
          )}
          {msg.html && (
            <Tabs.Trigger className={tabTrigger} value="source">
              HTML Source
            </Tabs.Trigger>
          )}
          <Tabs.Trigger className={tabTrigger} value="text">
            Text
          </Tabs.Trigger>
          <Tabs.Trigger className={tabTrigger} value="raw">
            Raw
          </Tabs.Trigger>
          {msg.html &&
            (() => {
              // Tab badge: count only issues that contain at least one
              // `no`-support client after filtering. Issues whose affected
              // clients are all "partial" (works but with caveats) don't
              // bump the counter.
              const noCount =
                htmlCheck?.status === 'success'
                  ? noSupportIssueCount(
                      htmlCheck.issues,
                      (
                        Object.keys(enabledCategories) as ClientCategory[]
                      ).filter((c) => enabledCategories[c]),
                      enabledFamilies,
                    )
                  : 0
              return (
                <Tabs.Trigger className={tabTrigger} value="html-check">
                  HTML Check
                  {noCount > 0 && <span className={tabBadge}>{noCount}</span>}
                </Tabs.Trigger>
              )
            })()}
          <Tabs.Trigger className={tabTrigger} value="tech">
            Tech Info
          </Tabs.Trigger>
        </Tabs.List>

        {msg.html && (
          <Tabs.Content className={tabContent} value="html">
            <MessagePreview html={msg.html} />
          </Tabs.Content>
        )}

        {msg.html && (
          <Tabs.Content className={tabContent} value="source">
            <HtmlSource code={msg.html} />
          </Tabs.Content>
        )}

        <Tabs.Content className={tabContent} value="text">
          <div className={previewWrap}>
            {msg.text && (
              <IconButton
                variant="toolbar"
                className={popoutPosition}
                title="Open text in new tab"
                onClick={() => openInNewTab(msg.text, 'text/plain')}
              >
                <ExternalLinkIcon size={14} />
              </IconButton>
            )}
            <pre className={preCss}>{msg.text || '(no plain-text body)'}</pre>
          </div>
        </Tabs.Content>

        <Tabs.Content className={tabContent} value="raw">
          <div className={previewWrap}>
            {raw && id && (
              <IconButton
                variant="toolbar"
                className={popoutPosition}
                title="Open raw in new tab"
                onClick={() =>
                  window.open(
                    rawMessageUrl(id),
                    '_blank',
                    'noopener,noreferrer',
                  )
                }
              >
                <ExternalLinkIcon size={14} />
              </IconButton>
            )}
            <pre className={preCss}>{raw || '(empty)'}</pre>
          </div>
        </Tabs.Content>

        {msg.html && id && (
          <Tabs.Content className={tabContent} value="html-check">
            <HtmlCheck
              hasHtml={!!msg.html}
              report={htmlCheck}
              err={htmlCheckErr}
              filters={{
                enabledCategories,
                setEnabledCategories,
                enabledFamilies,
                setEnabledFamilies,
              }}
            />
          </Tabs.Content>
        )}

        <Tabs.Content className={tabContent} value="tech">
          <TechInfo msg={msg} headers={headers} />
        </Tabs.Content>
      </Tabs.Root>
    </section>
  )
}
