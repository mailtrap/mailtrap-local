const btnBase =
  'cursor-pointer rounded-md border border-transparent px-3 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50'

export default function DeleteAllPrompt({
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
      <button
        type="button"
        className={`${btnBase} border-danger text-danger hover:bg-danger-soft`}
        onClick={onConfirm}
        disabled={busy}
      >
        Confirm
      </button>
      <button
        type="button"
        className={`${btnBase} border-accent text-accent hover:bg-accent-soft`}
        onClick={onCancel}
        disabled={busy}
      >
        Cancel
      </button>
    </div>
  )
}
