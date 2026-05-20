import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  disconnectRelay,
  getRelayConnection,
  updateRelayConnection,
  type RelayConnection,
} from '../api/relay'
import { extractApiError, isAbortError } from '../api/client'

interface RelayConnectionContextValue {
  state: RelayConnection | null
  loading: boolean
  error: string | null
  refresh: (signal?: AbortSignal) => Promise<void>
  update: (body: Parameters<typeof updateRelayConnection>[0]) => Promise<void>
  disconnect: () => Promise<void>
}

const RelayConnectionContext = createContext<RelayConnectionContextValue | null>(
  null,
)

export function RelayConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RelayConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const s = await getRelayConnection(signal)
      if (!signal?.aborted) {
        setState(s)
        setError(null)
      }
    } catch (e) {
      if (signal?.aborted || isAbortError(e)) return
      setError(extractApiError(e) || 'Failed to load relay connection')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  const update = useCallback<RelayConnectionContextValue['update']>(
    async (body) => {
      const s = await updateRelayConnection(body)
      setState(s)
    },
    [],
  )

  const disconnect = useCallback(async () => {
    const s = await disconnectRelay()
    setState(s)
  }, [])

  useEffect(() => {
    const c = new AbortController()
    refresh(c.signal)
    return () => c.abort()
  }, [refresh])

  return (
    <RelayConnectionContext.Provider
      value={{ state, loading, error, refresh, update, disconnect }}
    >
      {children}
    </RelayConnectionContext.Provider>
  )
}

export function useRelayConnection(): RelayConnectionContextValue {
  const ctx = useContext(RelayConnectionContext)
  if (!ctx)
    throw new Error(
      'useRelayConnection must be used inside <RelayConnectionProvider>',
    )
  return ctx
}
