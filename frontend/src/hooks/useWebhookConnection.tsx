import {
  disconnectWebhook,
  getWebhookConnection,
  updateWebhookConnection,
  type WebhookConnection,
} from '../api/webhook'
import { createConnectionProvider } from './createConnectionProvider'

type UpdateBody = Parameters<typeof updateWebhookConnection>[0]

const { Provider, useConnection } = createConnectionProvider<
  WebhookConnection,
  UpdateBody
>('webhook', {
  get: (signal) => getWebhookConnection(signal),
  update: (body) => updateWebhookConnection(body),
  disconnect: () => disconnectWebhook(),
})

export const WebhookConnectionProvider = Provider
export const useWebhookConnection = useConnection
