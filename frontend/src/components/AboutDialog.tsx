import { dialogLead } from './dialogStyles'
import {
  ConnectionDialogShell,
  DialogActions,
  DialogButton,
} from './dialogAtoms'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function AboutDialog({ open, onOpenChange }: Props) {
  return (
    <ConnectionDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="About Mailtrap Local"
      lead={
        <>
          Mailtrap Local is a fast, offline-first email sandbox + catcher for
          your machine. Point any SMTP client at it and every message your app
          sends lands in the local sandbox — instantly visible, fully
          inspectable, and never delivered to real recipients.
        </>
      }
    >
      <p className={dialogLead}>
        Built for the inner-loop: live HTML client-compatibility checks,
        instant search, raw / headers / parts views, per-message manual
        forward, generic SMTP relay with verified-sender overrides, and
        outbound webhooks signed with HMAC-SHA256. No accounts, no network
        round-trips, no quota.
      </p>

      <p className={dialogLead}>
        Need a shared cloud sandbox, transactional SMTP relay with
        verified-domain sending, deliverability checks, or team management?{' '}
        <a
          href="https://mailtrap.io"
          target="_blank"
          rel="noreferrer"
          style={{ color: '#4c83ee', textDecoration: 'none' }}
        >
          mailtrap.io
        </a>{' '}
        is purpose-built for that — and Mailtrap Local mirrors and forwards
        directly into it when you're ready.
      </p>

      <DialogActions>
        <DialogButton variant="primary" onClick={() => onOpenChange(false)}>
          Close
        </DialogButton>
      </DialogActions>
    </ConnectionDialogShell>
  )
}
