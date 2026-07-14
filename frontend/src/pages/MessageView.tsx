import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
import { noSupportIssueCount } from '../lib/htmlCheckStats'
import { sendMessageToCloud } from '../api/cloud'
import { releaseMessage } from '../api/relay'
import { useCloudConnection } from '../hooks/useCloudConnection'
import { useRelayConnection } from '../hooks/useRelayConnection'
import { useMessagesChannel } from '../hooks/useMessagesChannel'
import { TechInfo } from '../components/message/TechInfo'
import { HtmlCheck } from '../components/message/HtmlCheck'
import { HtmlSource } from '../components/message/HtmlSource'
import { MessageHeader } from '../components/message/MessageHeader'
import { MessagePreview } from '../components/message/MessagePreview'
import { Strip } from '../components/ui/Strip'
import { Button } from '../components/ui/Button'
import { EmptyCard } from '../components/ui/EmptyCard'
import { CodePane } from '../components/message/CodePane'
import { TabRoot, TabList, Tab, TabPanel } from '../components/message/MessageTabs'
import { openInNewTab } from '../lib/openInNewTab'
import { extractApiError, isAbortError, isNotFoundError } from '../api/client'

export function MessageView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [msg, setMsg] = useState<Message | null>(null)
  const [raw, setRaw] = useState<string>('')
  const [headers, setHeaders] = useState<HeadersMap>({})
  const [htmlCheck, setHtmlCheck] = useState<HtmlCheckReport | null>(null)
  const [htmlCheckErr, setHtmlCheckErr] = useState<string | null>(null)
  // HTML Check filter state lives here so the tab badge can read the
  // filter-aware `no`-support count alongside the panel itself.
  const [enabledCategories, setEnabledCategories] = useState<
    Record<ClientCategory, boolean>
  >({ desktop: true, mobile: true, web: true })
  const [enabledFamilies, setEnabledFamilies] = useState<
    Record<string, boolean>
  >({})
  // Initialize family filters from the report once it lands. Tracked via a
  // seed so we only reset on a new report — user toggles after that stick.
  // Done during render (not in an effect) per React docs' "adjusting state
  // during render" pattern.
  const [familiesSeed, setFamiliesSeed] = useState<HtmlCheckReport | null>(
    null,
  )
  if (
    htmlCheck?.status === 'success' &&
    htmlCheck !== familiesSeed
  ) {
    setFamiliesSeed(htmlCheck)
    const init: Record<string, boolean> = {}
    htmlCheck.families.forEach((f) => {
      init[f.family] = true
    })
    setEnabledFamilies(init)
  }
  const [error, setError] = useState<string | null>(null)
  // The open message no longer exists — a 404 on load, or a live
  // `destroyed` broadcast (deleted by another client, the API, or
  // retention eviction). Rendered as a friendly empty state, not an error.
  const [deleted, setDeleted] = useState(false)
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [cloudSent, setCloudSent] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const { state: cloudState } = useCloudConnection()
  const { state: relayState } = useRelayConnection()

  // Reset per-message state during render when `id` changes (React docs'
  // "adjusting state when a prop changes" pattern — avoids the effect
  // cascade we'd get from setState-inside-useEffect).
  const [lastId, setLastId] = useState(id)
  if (id !== lastId) {
    setLastId(id)
    setMsg(null)
    setError(null)
    setDeleted(false)
    setActiveTab(undefined)
    setCloudSent(false)
    setActionError(null)
    setActionSuccess(null)
    setHtmlCheck(null)
    setHtmlCheckErr(null)
  }

  useEffect(() => {
    if (!id) return
    // Cancellable fetch: if the user clicks a different message before
    // these resolve, the cleanup aborts the in-flight requests so a stale
    // response can't overwrite the new message's state.
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
        // the result drives the tab's issue-count badge.
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
        if (isAbortError(e)) return
        if (isNotFoundError(e)) setDeleted(true)
        else setError(extractApiError(e))
      })

    return () => controller.abort()
  }, [id])

  // Live deletion: if the open message is destroyed elsewhere (another
  // client, the API, retention), swap to the deleted empty state instead
  // of leaving a stale view that 404s on the next action.
  useMessagesChannel({
    onDestroyed: (destroyedId) => {
      if (destroyedId === id) setDeleted(true)
    },
  })

  // Auto-dismiss the success strip after a few seconds.
  useEffect(() => {
    if (!actionSuccess) return
    const timer = window.setTimeout(() => setActionSuccess(null), 5000)
    return () => window.clearTimeout(timer)
  }, [actionSuccess])

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

  const onSendForward = async (to: string[]) => {
    if (!id || to.length === 0) return
    setBusy(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      await releaseMessage(id, to)
      const list = to.join(', ')
      setActionSuccess(
        relayState?.host
          ? `Forwarded to ${list} via ${relayState.host}`
          : `Forwarded to ${list}`,
      )
    } catch (e) {
      setActionError(`Forward failed: ${extractApiError(e)}`)
      throw e
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

  if (deleted)
    return (
      <EmptyCard>
        <p>This message was deleted or is no longer available.</p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => navigate('/', { replace: true })}
        >
          Back to inbox
        </Button>
      </EmptyCard>
    )
  if (error)
    return <p className="text-danger">Failed to load this message: {error}</p>
  if (!msg) return <p className="text-fg-muted">Loading…</p>

  const noCount =
    htmlCheck?.status === 'success'
      ? noSupportIssueCount(
          htmlCheck.issues,
          (Object.keys(enabledCategories) as ClientCategory[]).filter(
            (c) => enabledCategories[c],
          ),
          enabledFamilies,
        )
      : 0

  return (
    <section>
      <MessageHeader
        key={msg.id}
        msg={msg}
        cloudState={cloudState}
        relayState={relayState}
        busy={busy}
        cloudSent={cloudSent}
        onConfirmDelete={onConfirmDelete}
        onSendForward={onSendForward}
        onCloudForward={onCloudForward}
        onDownload={onDownload}
        onShowHeaders={() => setActiveTab('tech')}
        onEscapeIdle={() => navigate('/')}
      />

      {actionError && (
        <Strip
          variant="error"
          role="alert"
          onDismiss={() => setActionError(null)}
        >
          {actionError}
        </Strip>
      )}

      {actionSuccess && (
        <Strip
          variant="success"
          role="status"
          onDismiss={() => setActionSuccess(null)}
        >
          {actionSuccess}
        </Strip>
      )}

      <TabRoot
        value={activeTab ?? (msg.html ? 'html' : 'text')}
        onValueChange={setActiveTab}
      >
        <TabList>
          {msg.html && <Tab value="html">HTML</Tab>}
          {msg.html && <Tab value="source">HTML Source</Tab>}
          <Tab value="text">Text</Tab>
          <Tab value="raw">Raw</Tab>
          {msg.html && (
            <Tab value="html-check" count={noCount}>
              HTML Check
            </Tab>
          )}
          <Tab value="tech">Tech Info</Tab>
        </TabList>

        {msg.html && (
          <TabPanel value="html">
            <MessagePreview html={msg.html} />
          </TabPanel>
        )}

        {msg.html && (
          <TabPanel value="source">
            <HtmlSource code={msg.html} />
          </TabPanel>
        )}

        <TabPanel value="text">
          <CodePane
            content={msg.text}
            popoutTitle="Open text in new tab"
            onPopout={() => openInNewTab(msg.text, 'text/plain')}
            fallback="(no plain-text body)"
          />
        </TabPanel>

        <TabPanel value="raw">
          <CodePane
            content={raw}
            popoutTitle="Open raw in new tab"
            onPopout={
              id
                ? () =>
                    window.open(
                      rawMessageUrl(id),
                      '_blank',
                      'noopener,noreferrer',
                    )
                : undefined
            }
            fallback="(empty)"
          />
        </TabPanel>

        {msg.html && id && (
          <TabPanel value="html-check">
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
          </TabPanel>
        )}

        <TabPanel value="tech">
          <TechInfo msg={msg} headers={headers} />
        </TabPanel>
      </TabRoot>
    </section>
  )
}
