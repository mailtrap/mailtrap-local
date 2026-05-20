import {
  disconnectRelay,
  getRelayConnection,
  updateRelayConnection,
  type RelayConnection,
} from '../api/relay'
import { createConnectionProvider } from './createConnectionProvider'

type UpdateBody = Parameters<typeof updateRelayConnection>[0]

const { Provider, useConnection } = createConnectionProvider<
  RelayConnection,
  UpdateBody
>('SMTP relay', {
  get: (signal) => getRelayConnection(signal),
  update: (body) => updateRelayConnection(body),
  disconnect: () => disconnectRelay(),
})

export const RelayConnectionProvider = Provider
export const useRelayConnection = useConnection
