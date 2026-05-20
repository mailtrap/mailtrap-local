import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  disconnectWebhook,
  getWebhookConnection,
  updateWebhookConnection,
  type WebhookConnection,
} from '../api/webhook'

interface WebhookConnectionContextValue {
  state: WebhookConnection | null
  loading: boolean
  refresh: (signal?: AbortSignal) => Promise<void>
  update: (body: Parameters<typeof updateWebhookConnection>[0]) => Promise<void>
  disconnect: () => Promise<void>
}

const WebhookConnectionContext =
  createContext<WebhookConnectionContextValue | null>(null)

export function WebhookConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WebhookConnection | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const s = await getWebhookConnection(signal)
      if (!signal?.aborted) setState(s)
    } catch {
      // Keep prior state on network blip.
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  const update = useCallback<WebhookConnectionContextValue['update']>(
    async (body) => {
      const s = await updateWebhookConnection(body)
      setState(s)
    },
    [],
  )

  const disconnect = useCallback(async () => {
    const s = await disconnectWebhook()
    setState(s)
  }, [])

  useEffect(() => {
    const c = new AbortController()
    refresh(c.signal)
    return () => c.abort()
  }, [refresh])

  return (
    <WebhookConnectionContext.Provider
      value={{ state, loading, refresh, update, disconnect }}
    >
      {children}
    </WebhookConnectionContext.Provider>
  )
}

export function useWebhookConnection(): WebhookConnectionContextValue {
  const ctx = useContext(WebhookConnectionContext)
  if (!ctx)
    throw new Error(
      'useWebhookConnection must be used inside <WebhookConnectionProvider>',
    )
  return ctx
}
