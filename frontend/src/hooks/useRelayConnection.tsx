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

interface RelayConnectionContextValue {
  state: RelayConnection | null
  loading: boolean
  refresh: () => Promise<void>
  update: (body: Parameters<typeof updateRelayConnection>[0]) => Promise<void>
  disconnect: () => Promise<void>
}

const RelayConnectionContext = createContext<RelayConnectionContextValue | null>(
  null,
)

export function RelayConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RelayConnection | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const s = await getRelayConnection()
      setState(s)
    } catch {
      // Keep prior state on network blip.
    } finally {
      setLoading(false)
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
    refresh()
  }, [refresh])

  return (
    <RelayConnectionContext.Provider
      value={{ state, loading, refresh, update, disconnect }}
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
