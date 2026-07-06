import { useEffect, useState } from 'react'
import { getVersion, type VersionInfo } from '../../api/version'
import { isAbortError } from '../../api/client'
import { dialogLead, fieldHintLink } from './dialogStyles'
import {
  ConnectionDialogShell,
  DialogActions,
  DialogButton,
} from './dialogAtoms'

const GITHUB_REPO = 'https://github.com/mailtrap/mailtrap-local'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatVersionLabel(info: VersionInfo): string {
  const shortCommit =
    info.commit.length > 7 ? info.commit.slice(0, 7) : info.commit
  return `${info.version} (${shortCommit})`
}

export default function AboutDialog({ open, onOpenChange }: Props) {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null)

  useEffect(() => {
    if (!open) return
    const ac = new AbortController()
    void getVersion(ac.signal)
      .then(setVersionInfo)
      .catch((e: unknown) => {
        if (!isAbortError(e)) setVersionInfo(null)
      })
    return () => ac.abort()
  }, [open])

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
          className={fieldHintLink}
        >
          mailtrap.io
        </a>{' '}
        is purpose-built for that — and Mailtrap Local mirrors and forwards
        directly into it when you're ready.
      </p>

      <p className={`${dialogLead} mb-0 text-xs`}>
        {versionInfo ? (
          <>
            Version {formatVersionLabel(versionInfo)}
            {' · '}
          </>
        ) : null}
        <a
          href={GITHUB_REPO}
          target="_blank"
          rel="noreferrer"
          className={fieldHintLink}
        >
          GitHub
        </a>
        {' · '}
        <a
          href="https://opensource.org/licenses/MIT"
          target="_blank"
          rel="noreferrer"
          className={fieldHintLink}
        >
          MIT License
        </a>
      </p>

      <DialogActions>
        <DialogButton variant="primary" onClick={() => onOpenChange(false)}>
          Close
        </DialogButton>
      </DialogActions>
    </ConnectionDialogShell>
  )
}
