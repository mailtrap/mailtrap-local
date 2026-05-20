import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  SettingsIcon,
  WebhookIcon,
  HelpIcon,
  InfoIcon,
  ExternalLinkIcon,
} from './icons'
import { IconButton } from './IconButton'
import WebhookConnectDialog from './WebhookConnectDialog'
import AboutDialog from './AboutDialog'

const menuCss = [
  // Sit above Radix Dialog overlays only when nothing else is open. The
  // dialogs themselves portal to the same layer (z-50/51), so the menu
  // closes on item click before the dialog mounts — no stacking
  // conflict in practice.
  'z-[60] min-w-[200px] rounded-lg border border-border-base bg-surface-raised p-1',
  'shadow-[0_12px_32px_rgba(0,0,0,0.45)]',
].join(' ')

// Each menu item is a `group` carrying Radix's `data-highlighted`
// attribute when focused; children pick up highlighted-state styling
// via `group-data-[highlighted]:` variants.
const itemCss = [
  'group flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2',
  'text-[13px] text-fg select-none outline-none',
  'data-[highlighted]:bg-surface-hover',
].join(' ')

const itemIconCss =
  'shrink-0 text-fg-muted group-data-[highlighted]:text-accent'

const itemGrowCss = 'flex-1'

const itemBadgeCss = [
  'inline-block h-1.5 w-1.5 rounded-full',
  'data-[on=true]:bg-success',
].join(' ')

const itemExtCss = 'shrink-0 text-fg-muted'

interface Props {
  /**
   * True when a webhook is configured + enabled. Drives the green dot
   * next to the "Webhooks" menu item — same visual language as the
   * cloud/relay status badges in the toolbar.
   */
  webhookActive: boolean
}

/**
 * Footer "gear" menu rendered as a dropup. Currently houses the webhook
 * settings entry plus About/Documentation. Cloud + relay still live in
 * the toolbar because they're high-frequency actions; this menu is a
 * home for less-frequent / informational entries.
 */
export default function SettingsMenu({ webhookActive }: Props) {
  const [webhookOpen, setWebhookOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton variant="toolbar" title="Settings" aria-label="Settings">
            <SettingsIcon size={16} />
          </IconButton>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={menuCss}
            side="top"
            align="end"
            sideOffset={6}
            collisionPadding={8}
          >
            <DropdownMenu.Item
              className={itemCss}
              onSelect={() => setWebhookOpen(true)}
            >
              <WebhookIcon size={14} className={itemIconCss} />
              <span className={itemGrowCss}>Webhooks</span>
              <span className={itemBadgeCss} data-on={webhookActive} />
            </DropdownMenu.Item>
            <DropdownMenu.Item className={itemCss} asChild>
              <a
                href="https://docs.mailtrap.io/"
                target="_blank"
                rel="noreferrer"
              >
                <HelpIcon size={14} className={itemIconCss} />
                <span className={itemGrowCss}>Documentation</span>
                <ExternalLinkIcon size={11} className={itemExtCss} />
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={itemCss}
              onSelect={() => setAboutOpen(true)}
            >
              <InfoIcon size={14} className={itemIconCss} />
              <span className={itemGrowCss}>About</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <WebhookConnectDialog open={webhookOpen} onOpenChange={setWebhookOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  )
}
