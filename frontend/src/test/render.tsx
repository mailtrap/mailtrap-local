/**
 * Test render helper. Wraps components with the providers they need to
 * mount in isolation:
 *
 *   - MemoryRouter for components that pull route state
 *     (Sidebar's useMatch, MessageView's useParams, Link / useNavigate).
 *   - The three connection providers (Cloud / Relay / Webhook) — every
 *     component reaches for at least one of them via the
 *     useXxxConnection hooks. We don't try to fake the providers; we
 *     just mount the real ones, and individual tests mock the network
 *     calls behind them via vi.mock on the api/* modules.
 */
import { render, type RenderOptions, type RenderResult } from '@testing-library/react'
import { MemoryRouter, Routes, Route, type MemoryRouterProps } from 'react-router-dom'
import { type ReactElement } from 'react'
import { CloudConnectionProvider } from '../hooks/useCloudConnection'
import { RelayConnectionProvider } from '../hooks/useRelayConnection'
import { WebhookConnectionProvider } from '../hooks/useWebhookConnection'

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  /** Initial URL list for MemoryRouter; defaults to ['/']. */
  initialEntries?: MemoryRouterProps['initialEntries']
  /**
   * If set, the rendered UI is mounted under a `<Route path={routePath}>`
   * instead of at the router root. Required when the component-under-
   * test uses `useParams()` — without a matching Route, useParams
   * returns an empty object.
   */
  routePath?: string
}

export function renderWithProviders(
  ui: ReactElement,
  {
    initialEntries = ['/'],
    routePath,
    ...rest
  }: RenderWithProvidersOptions = {},
): RenderResult {
  const tree = (
    <MemoryRouter initialEntries={initialEntries}>
      <CloudConnectionProvider>
        <RelayConnectionProvider>
          <WebhookConnectionProvider>
            {routePath ? (
              <Routes>
                <Route path={routePath} element={ui} />
              </Routes>
            ) : (
              ui
            )}
          </WebhookConnectionProvider>
        </RelayConnectionProvider>
      </CloudConnectionProvider>
    </MemoryRouter>
  )
  return render(tree, rest)
}
