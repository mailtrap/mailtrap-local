import { Routes, Route } from 'react-router-dom'
import { Sidebar } from './components/sidebar/Sidebar'
import { Sandbox } from './pages/Sandbox'
import { MessageView } from './pages/MessageView'
import { ConnectionProviders } from './hooks/ConnectionProviders'
import { useUnreadFaviconBadge } from './hooks/useUnreadFaviconBadge'
import { useResizableSidebar } from './hooks/useResizableSidebar'

// Layout: persistent split-pane — sidebar (message list) + main (detail).
// Palette tokens live in src/index.css under @theme; classes here use the
// named utilities (bg-surface-base / text-fg / etc.).

const shell = 'grid h-screen bg-surface-base text-fg font-sans text-sm'

// Drag handle between the sidebar and the main pane. Wider invisible
// hit-area extends 3px past each side of the visible 4px bar.
const resizer = [
  'relative w-1 flex-none cursor-col-resize select-none bg-transparent',
  'transition-[background-color] duration-[80ms]',
  'hover:bg-accent data-[dragging=true]:bg-accent',
  "before:absolute before:-left-[3px] before:-right-[3px] before:top-0 before:bottom-0 before:content-['']",
].join(' ')

const main = 'min-h-0 min-w-0 overflow-y-auto px-8 py-6'

export function App() {
  useUnreadFaviconBadge()
  const { width, dragging, onPointerDown } = useResizableSidebar()

  return (
    <ConnectionProviders>
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
    </ConnectionProviders>
  )
}
