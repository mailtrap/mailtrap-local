import type { ReactNode } from 'react'
import { CloudConnectionProvider } from './useCloudConnection'
import { RelayConnectionProvider } from './useRelayConnection'
import { WebhookConnectionProvider } from './useWebhookConnection'

/**
 * Single entry point that wires the three connection providers — cloud,
 * SMTP relay, webhook. Each provider tracks its own backend config, but
 * they share a lifecycle (mount once at app root, available everywhere
 * via their respective hooks) so wrapping them up keeps the App tree
 * flat. New integrations get added here, not in App.tsx.
 */
export function ConnectionProviders({ children }: { children: ReactNode }) {
  return (
    <CloudConnectionProvider>
      <RelayConnectionProvider>
        <WebhookConnectionProvider>{children}</WebhookConnectionProvider>
      </RelayConnectionProvider>
    </CloudConnectionProvider>
  )
}
