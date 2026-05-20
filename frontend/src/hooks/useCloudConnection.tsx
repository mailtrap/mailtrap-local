import {
  disconnectCloud,
  getCloudConnection,
  updateCloudConnection,
  type CloudConnection,
} from '../api/cloud'
import { createConnectionProvider } from './createConnectionProvider'

type UpdateBody = Parameters<typeof updateCloudConnection>[0]

const { Provider, useConnection } = createConnectionProvider<
  CloudConnection,
  UpdateBody
>('cloud sandbox', {
  get: (signal) => getCloudConnection(signal),
  update: (body) => updateCloudConnection(body),
  disconnect: () => disconnectCloud(),
})

export const CloudConnectionProvider = Provider
export const useCloudConnection = useConnection
