import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import {
  actions,
  btn,
  configBanner,
  configBannerCode,
  content,
  dialogLead,
  dialogTitle,
  field,
  fieldHint,
  fieldInput,
  fieldLabel,
  fieldSelect,
  lockedInput,
  overlay,
} from './dialogStyles'
import { LockedFieldHint } from './LockedFieldHint'

/**
 * Outer Dialog shell shared by every settings dialog. Wraps Radix's
 * Root + Portal + Overlay + Content, plus the standard title + lead
 * paragraph. The actual form body is `children`. Callers mount the
 * body only when `open` so each open cycle gets fresh useState
 * initialisers without a reset-effect (the existing convention).
 */
export function ConnectionDialogShell({
  open,
  onOpenChange,
  title,
  lead,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  lead: ReactNode
  children: ReactNode
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlay} />
        <Dialog.Content className={content} aria-describedby={undefined}>
          {open && (
            <>
              <Dialog.Title asChild>
                <h2 className={dialogTitle}>{title}</h2>
              </Dialog.Title>
              <p className={dialogLead}>{lead}</p>
              {children}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * The "[All|Some] settings are pinned by <config-path>" banner that
 * fires when any field is locked by the YAML overlay. `extra` lets the
 * caller append per-dialog suffix text after the path.
 */
export function DialogConfigBanner({
  allLocked,
  configPath,
  extra,
}: {
  allLocked: boolean
  configPath: string
  extra?: ReactNode
}) {
  return (
    <div className={configBanner}>
      {allLocked ? 'All settings are pinned by ' : 'Some settings are pinned by '}
      <code className={configBannerCode}>{configPath}</code>
      {extra ?? '. Edit that file and restart to change them.'}
    </div>
  )
}

/** Stack a label + input + optional hint or locked indicator. */
export function DialogField({
  label,
  htmlFor,
  children,
  hint,
  locked,
  configPath,
}: {
  label: ReactNode
  htmlFor?: string
  children: ReactNode
  hint?: ReactNode
  locked?: boolean
  configPath?: string | null
}) {
  return (
    <div className={field}>
      <label className={fieldLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {locked ? (
        <LockedFieldHint path={configPath ?? null} />
      ) : hint ? (
        <span className={fieldHint}>{hint}</span>
      ) : null}
    </div>
  )
}

/**
 * Status row used by relay + webhook dialogs to surface live probe
 * results. Driven by `data-status` so the dot color + container text
 * color flow from a single attribute. `.pulse-dot` is defined in
 * index.css.
 */
const statusRowCss = [
  'group flex min-h-[18px] items-center gap-2 mt-1 mb-2 text-xs text-fg-muted',
  'data-[status=ok]:text-success',
  'data-[status=error]:text-danger',
].join(' ')

const statusRowDotCss = [
  'inline-block h-2 w-2 shrink-0 rounded-full',
  'group-data-[status=ok]:bg-success',
  'group-data-[status=error]:bg-danger',
  'group-data-[status=testing]:bg-fg-muted group-data-[status=testing]:pulse-dot',
].join(' ')

export type DialogStatus = 'idle' | 'testing' | 'ok' | 'error'

export function DialogStatusRow({
  status,
  message,
}: {
  status: DialogStatus
  message: string
}) {
  return (
    <div className={statusRowCss} data-status={status}>
      {status !== 'idle' && (
        <>
          <span className={statusRowDotCss} />
          <span>{message}</span>
        </>
      )}
    </div>
  )
}

/** Bottom button row of a settings dialog. */
export function DialogActions({ children }: { children: ReactNode }) {
  return <div className={actions}>{children}</div>
}

/**
 * Variant-driven button using the shared `btn` class. Avoids the
 * repetition of `<button type="button" className={btn}
 * data-variant="..." />` at every dialog action button.
 */
export function DialogButton({
  variant,
  type = 'button',
  disabled,
  onClick,
  children,
}: {
  variant: 'primary' | 'outline' | 'danger-text'
  type?: 'button' | 'submit' | 'reset'
  disabled?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type={type}
      className={btn}
      data-variant={variant}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

// Re-export the per-element classes the dialogs still need to apply
// directly (input, select, lockedInput composition).
export { fieldInput, fieldSelect, lockedInput }
