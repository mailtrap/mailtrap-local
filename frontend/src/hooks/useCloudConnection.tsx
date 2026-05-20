import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  disconnectCloud,
  getCloudConnection,
  updateCloudConnection,
  type CloudConnection,
} from '../api/cloud'
import { extractApiError, isAbortError } from '../api/client'

interface CloudConnectionContextValue {
  state: CloudConnection | null
  loading: boolean
  /**
   * The last error from refresh(), or null if the most recent call
   * succeeded (or hasn't yet completed). Consumers render an error
   * banner when state is still null and error is set — i.e. the
   * initial load never landed.
   */
  error: string | null
  refresh: (signal?: AbortSignal) => Promise<void>
  update: (body: Parameters<typeof updateCloudConnection>[0]) => Promise<void>
  disconnect: () => Promise<void>
}

const CloudConnectionContext = createContext<CloudConnectionContextValue | null>(
  null,
)

export function CloudConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CloudConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const s = await getCloudConnection(signal)
      if (!signal?.aborted) {
        setState(s)
        setError(null)
      }
    } catch (e) {
      if (signal?.aborted || isAbortError(e)) return
      setError(extractApiError(e) || 'Failed to load cloud connection')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [])

  const update = useCallback<CloudConnectionContextValue['update']>(
    async (body) => {
      const s = await updateCloudConnection(body)
      setState(s)
    },
    [],
  )

  const disconnect = useCallback(async () => {
    const s = await disconnectCloud()
    setState(s)
  }, [])

  useEffect(() => {
    const c = new AbortController()
    refresh(c.signal)
    return () => c.abort()
  }, [refresh])

  return (
    <CloudConnectionContext.Provider
      value={{ state, loading, error, refresh, update, disconnect }}
    >
      {children}
    </CloudConnectionContext.Provider>
  )
}

export function useCloudConnection(): CloudConnectionContextValue {
  const ctx = useContext(CloudConnectionContext)
  if (!ctx)
    throw new Error(
      'useCloudConnection must be used inside <CloudConnectionProvider>',
    )
  return ctx
}
