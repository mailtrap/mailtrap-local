import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { extractApiError, isAbortError } from '../api/client'

/**
 * The minimal API shape the three connection providers (Cloud, Relay,
 * Webhook) share: a getter, an updater, and a disconnect. All three
 * accept an optional AbortSignal so the provider can cancel its mount
 * fetch on unmount.
 */
export interface ConnectionApi<TState, TUpdateBody> {
  get: (signal?: AbortSignal) => Promise<TState>
  update: (body: TUpdateBody) => Promise<TState>
  disconnect: () => Promise<TState>
}

/** Shared context value across all three providers. */
export interface ConnectionContextValue<TState, TUpdateBody> {
  state: TState | null
  loading: boolean
  /** Last refresh error; cleared on success. */
  error: string | null
  refresh: (signal?: AbortSignal) => Promise<void>
  update: (body: TUpdateBody) => Promise<void>
  disconnect: () => Promise<void>
}

/**
 * Factory that builds a `<XConnectionProvider>` + `useXConnection`
 * pair from a name and an API shape. The three connection types had
 * identical 76-line provider components differing only by which API
 * functions they called and which type they tracked — this collapses
 * them to one source of truth.
 *
 * The provider's mount effect uses an AbortController so an unmount
 * mid-fetch can't land setState on an unmounted consumer. Refresh
 * accepts a caller-supplied signal too (used by ConnectionErrorBanner
 * to cancel a pending retry if the user closes the app).
 *
 * @param name Used in the error message thrown when the hook is
 *             called outside its Provider, and in the failure message
 *             the error banner shows. Should be a human noun
 *             ("cloud sandbox", "SMTP relay", "webhook").
 */
export function createConnectionProvider<TState, TUpdateBody>(
  name: string,
  api: ConnectionApi<TState, TUpdateBody>,
) {
  const Context = createContext<ConnectionContextValue<
    TState,
    TUpdateBody
  > | null>(null)

  function Provider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<TState | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const refresh = useCallback(async (signal?: AbortSignal) => {
      try {
        const s = await api.get(signal)
        if (!signal?.aborted) {
          setState(s)
          setError(null)
        }
      } catch (e) {
        if (signal?.aborted || isAbortError(e)) return
        setError(extractApiError(e) || `Failed to load ${name}`)
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    }, [])

    const update = useCallback(async (body: TUpdateBody) => {
      const s = await api.update(body)
      setState(s)
    }, [])

    const disconnect = useCallback(async () => {
      const s = await api.disconnect()
      setState(s)
    }, [])

    useEffect(() => {
      const c = new AbortController()
      refresh(c.signal)
      return () => c.abort()
    }, [refresh])

    return (
      <Context.Provider
        value={{ state, loading, error, refresh, update, disconnect }}
      >
        {children}
      </Context.Provider>
    )
  }

  function useConnection(): ConnectionContextValue<TState, TUpdateBody> {
    const ctx = useContext(Context)
    if (!ctx) {
      throw new Error(`useConnection (${name}) must be used inside its Provider`)
    }
    return ctx
  }

  return { Provider, useConnection, Context }
}
