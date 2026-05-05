import { Routes, Route } from 'react-router-dom'
import { css } from '@linaria/core'
import Sidebar from './components/Sidebar'
import Sandbox from './pages/Sandbox'
import MessageView from './pages/MessageView'
import { CloudConnectionProvider } from './hooks/useCloudConnection'
import { RelayConnectionProvider } from './hooks/useRelayConnection'
import { WebhookConnectionProvider } from './hooks/useWebhookConnection'
import { useUnreadFaviconBadge } from './hooks/useUnreadFaviconBadge'
import { useResizableSidebar } from './hooks/useResizableSidebar'

// Dark theme palette (authoritative — Sidebar, MessageView, etc. consume these):
// bg #131e2b · raised #172230 · hover #212d3c
// text #fbfcfc · text-muted #687a91 · text-secondary #6b7a8c
// border-light #212d3c · border-subtle #2a394b · accent #4c83ee
// Layout: persistent split-pane — sidebar (message list) + main (detail).
const shell = css`
  display: grid;
  height: 100vh;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  background: #131e2b;
  color: #fbfcfc;
`

const resizer = css`
  position: relative;
  width: 4px;
  cursor: col-resize;
  background: transparent;
  flex: 0 0 auto;
  transition: background 80ms ease;
  user-select: none;

  /* Wider hit-area than visible bar */
  &::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: -3px;
    right: -3px;
  }

  &:hover,
  &[data-dragging='true'] {
    background: #4c83ee;
  }
`

const main = css`
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 32px;
`

export default function App() {
  useUnreadFaviconBadge()
  const { width, dragging, onPointerDown } = useResizableSidebar()

  return (
    <CloudConnectionProvider>
      <RelayConnectionProvider>
        <WebhookConnectionProvider>
          <div
            className={shell}
            style={{ gridTemplateColumns: `${width}px 4px 1fr` }}
          >
            <Sidebar />
            <div
              className={resizer}
              data-dragging={dragging}
              onPointerDown={onPointerDown}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
            />
            <main className={main}>
              <Routes>
                <Route path="/" element={<Sandbox />} />
                <Route path="/message/:id" element={<MessageView />} />
              </Routes>
            </main>
          </div>
        </WebhookConnectionProvider>
      </RelayConnectionProvider>
    </CloudConnectionProvider>
  )
}
