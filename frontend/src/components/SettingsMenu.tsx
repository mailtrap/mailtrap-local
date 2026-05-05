import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { css } from '@linaria/core'
import { SettingsIcon, WebhookIcon, HelpIcon, InfoIcon, ExternalLinkIcon } from './icons'
import { IconButton } from './IconButton'
import WebhookConnectDialog from './WebhookConnectDialog'
import AboutDialog from './AboutDialog'
import {
  accent,
  border,
  hover,
  raised,
  success,
  text,
  textMuted,
} from '../styles/tokens'

const menu = css`
  background: ${raised};
  border: 1px solid ${border};
  border-radius: 8px;
  padding: 4px;
  min-width: 200px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  /* Sit above Radix Dialog overlays only when nothing else is open. The
     dialogs themselves portal to the same layer (z-index 50/51), so the
     menu closes on item click before the dialog mounts — no stacking
     conflict in practice. */
  z-index: 60;
`

const item = css`
  all: unset;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: ${text};
  cursor: pointer;
  user-select: none;

  .icon {
    color: ${textMuted};
    flex-shrink: 0;
  }
  .grow {
    flex: 1;
  }
  .badge {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }
  .badge[data-on='true'] {
    background: ${success};
  }
  .ext {
    color: ${textMuted};
    flex-shrink: 0;
  }

  &[data-highlighted] {
    background: ${hover};
    .icon {
      color: ${accent};
    }
  }
`

interface Props {
  /**
   * True when a webhook is configured + enabled. Drives the green dot next
   * to the "Webhooks" menu item — same visual language as the cloud/relay
   * status badges in the toolbar.
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
            className={menu}
            side="top"
            align="end"
            sideOffset={6}
            collisionPadding={8}
          >
            <DropdownMenu.Item
              className={item}
              onSelect={() => setWebhookOpen(true)}
            >
              <WebhookIcon size={14} className="icon" />
              <span className="grow">Webhooks</span>
              <span className="badge" data-on={webhookActive} />
            </DropdownMenu.Item>
            <DropdownMenu.Item className={item} asChild>
              <a
                href="https://docs.mailtrap.io/"
                target="_blank"
                rel="noreferrer"
              >
                <HelpIcon size={14} className="icon" />
                <span className="grow">Documentation</span>
                <ExternalLinkIcon size={11} className="ext" />
              </a>
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={item}
              onSelect={() => setAboutOpen(true)}
            >
              <InfoIcon size={14} className="icon" />
              <span className="grow">About</span>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <WebhookConnectDialog open={webhookOpen} onOpenChange={setWebhookOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  )
}
