import { useState } from 'react'
import {
  DesktopIcon,
  ExternalLinkIcon,
  MobileIcon,
  TabletIcon,
} from '../ui/icons'
import { IconButton } from '../ui/IconButton'
import { openInNewTab } from '../../lib/openInNewTab'

type Device = 'mobile' | 'tablet' | 'desktop'

/* Match Mailtrap's preview viewports: iPhone (375×667) and iPad (768×1024)
   in portrait. Desktop fills the remaining viewport height below tabs/toolbar
   so the rendered email gets as much vertical space as the screen offers. */
const DEVICE_SIZE: Record<Device, { width: string; height: string }> = {
  mobile: { width: '375px', height: '667px' },
  tablet: { width: '768px', height: '1024px' },
  desktop: { width: '100%', height: 'max(500px, calc(100vh - 260px))' },
}

const deviceBar = 'relative flex justify-center gap-1 pt-2 pb-3'

const popoutPosition = 'absolute top-0 right-0'

// Device-frame chrome around the HTML preview iframe. The frame
// reads its own `data-device` so device-driven styling lives on the
// element it actually styles.
const iframeFrameWrapCss = 'flex justify-center'

const iframeFrameCss = [
  'inline-block [box-sizing:content-box]',
  'rounded-none border-2 border-transparent bg-transparent p-0',
  'transition-[width,height,padding,border-radius,border-color,background-color] duration-[250ms] ease-out',
  // Mobile + tablet share the accent border + base background.
  'data-[device=mobile]:rounded-[32px] data-[device=mobile]:border-accent data-[device=mobile]:bg-surface-base data-[device=mobile]:px-2.5 data-[device=mobile]:py-3.5',
  'data-[device=tablet]:rounded-[18px] data-[device=tablet]:border-accent data-[device=tablet]:bg-surface-base data-[device=tablet]:p-3.5',
].join(' ')

const iframeCss =
  'block h-full w-full rounded-[7px] border border-border-base bg-white'

interface Props {
  html: string
}

export default function MessagePreview({ html }: Props) {
  const [device, setDevice] = useState<Device>('desktop')
  return (
    <>
      <div className={deviceBar}>
        <IconButton
          variant="device"
          active={device === 'mobile'}
          title="Mobile preview"
          onClick={() => setDevice('mobile')}
        >
          <MobileIcon size={18} />
        </IconButton>
        <IconButton
          variant="device"
          active={device === 'tablet'}
          title="Tablet preview"
          onClick={() => setDevice('tablet')}
        >
          <TabletIcon size={18} />
        </IconButton>
        <IconButton
          variant="device"
          active={device === 'desktop'}
          title="Desktop preview"
          onClick={() => setDevice('desktop')}
        >
          <DesktopIcon size={18} />
        </IconButton>
        <IconButton
          variant="toolbar"
          className={popoutPosition}
          title="Open HTML in new tab"
          onClick={() => openInNewTab(html, 'text/html')}
        >
          <ExternalLinkIcon size={14} />
        </IconButton>
      </div>
      <div className={iframeFrameWrapCss}>
        <div
          className={iframeFrameCss}
          data-device={device}
          style={{
            width: DEVICE_SIZE[device].width,
            height: DEVICE_SIZE[device].height,
            maxWidth: '100%',
          }}
        >
          <iframe
            className={iframeCss}
            sandbox=""
            srcDoc={html}
            title="Message HTML"
          />
        </div>
      </div>
    </>
  )
}
