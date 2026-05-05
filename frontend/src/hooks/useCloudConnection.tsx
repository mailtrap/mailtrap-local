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

interface CloudConnectionContextValue {
  state: CloudConnection | null
  loading: boolean
  refresh: () => Promise<void>
  update: (body: Parameters<typeof updateCloudConnection>[0]) => Promise<void>
  disconnect: () => Promise<void>
}

const CloudConnectionContext = createContext<CloudConnectionContextValue | null>(
  null,
)

export function CloudConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CloudConnection | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const s = await getCloudConnection()
      setState(s)
    } catch {
      // Keep prior state on network blip; next refresh will retry.
    } finally {
      setLoading(false)
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
    refresh()
  }, [refresh])

  return (
    <CloudConnectionContext.Provider
      value={{ state, loading, refresh, update, disconnect }}
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
