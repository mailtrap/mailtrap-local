import * as Tooltip from '@radix-ui/react-tooltip'
import { useId, type ReactNode } from 'react'

const triggerCss = [
  'inline-flex items-center border-0 bg-transparent p-0 cursor-help text-fg-muted outline-none',
  'transition-colors hover:text-fg focus-visible:text-fg',
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-ring',
].join(' ')

const contentCss = [
  'z-50 w-max max-w-[320px] rounded-lg border border-border-subtle',
  'bg-surface-hover px-3 py-2.5',
  'text-left text-[13px] font-normal leading-[1.6] text-fg',
  'shadow-[0_12px_32px_rgba(0,0,0,0.45)]',
  'opacity-0 transition-opacity duration-150',
  'data-[state=delayed-open]:opacity-100 data-[state=instant-open]:opacity-100',
].join(' ')

export function InfoTooltip({
  content,
  description,
  label,
  children,
}: {
  content: ReactNode
  description: string
  label: string
  children: ReactNode
}) {
  const descriptionId = useId()

  return (
    <Tooltip.Provider delayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-describedby={descriptionId}
            className={triggerCss}
          >
            {children}
          </button>
        </Tooltip.Trigger>
        <span id={descriptionId} className="sr-only">
          {description}
        </span>
        <Tooltip.Portal>
          <Tooltip.Content
            aria-label={description}
            side="bottom"
            align="start"
            sideOffset={8}
            className={contentCss}
            onEscapeKeyDown={(event) => event.stopPropagation()}
          >
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
