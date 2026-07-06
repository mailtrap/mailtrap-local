import { Button } from '../ui/Button'

export function DeleteAllPrompt({
  count,
  busy,
  onConfirm,
  onCancel,
}: {
  count: number
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-2 border-b border-surface-hover bg-surface-raised px-3 py-2.5 text-[13px] text-fg">
      <span className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
        Delete all {count} messages?
      </span>
      <Button variant="danger-text" size="sm" onClick={onConfirm} disabled={busy}>
        Confirm
      </Button>
      <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
    </div>
  )
}
