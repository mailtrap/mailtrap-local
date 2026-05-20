import * as Dialog from '@radix-ui/react-dialog'
import {
  actions,
  btn,
  content,
  dialogLead,
  dialogTitle,
  overlay,
} from './dialogStyles'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AboutDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={content} aria-describedby={undefined}>
          <Dialog.Title asChild>
            <h2 className={dialogTitle}>About Mailtrap Local</h2>
          </Dialog.Title>
          <p className={dialogLead}>
            Mailtrap Local is a fast, offline-first email sandbox + catcher
            for your machine. Point any SMTP client at it and every message
            your app sends lands in the local sandbox — instantly visible,
            fully inspectable, and never delivered to real recipients.
          </p>

          <p className={dialogLead}>
            Built for the inner-loop: live HTML client-compatibility checks,
            instant search, raw / headers / parts views, per-message manual
            forward, generic SMTP relay with verified-sender overrides, and
            outbound webhooks signed with HMAC-SHA256. No accounts, no
            network round-trips, no quota.
          </p>

          <p className={dialogLead}>
            Need a shared cloud sandbox, transactional SMTP relay with
            verified-domain sending, deliverability checks, or team
            management?{' '}
            <a
              href="https://mailtrap.io"
              target="_blank"
              rel="noreferrer"
              style={{ color: '#4c83ee', textDecoration: 'none' }}
            >
              mailtrap.io
            </a>{' '}
            is purpose-built for that — and Mailtrap Local mirrors and
            forwards directly into it when you're ready.
          </p>

          <div className={actions}>
            <button
              type="button"
              className={btn}
              data-variant="primary"
              onClick={() => onOpenChange(false)}
            >
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
