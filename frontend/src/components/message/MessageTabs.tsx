import * as Tabs from '@radix-ui/react-tabs'
import { type ComponentProps, type ReactNode } from 'react'

const list = 'mt-4 flex gap-[18px] border-b border-border-base p-0'

// Each trigger draws its own active underline via ::after when Radix sets
// data-state="active".
const trigger = [
  'relative cursor-pointer py-2.5 leading-none text-sm font-medium font-sans text-fg-icon',
  'hover:text-fg',
  'data-[state=active]:text-fg',
  "data-[state=active]:after:content-[''] data-[state=active]:after:absolute data-[state=active]:after:left-0 data-[state=active]:after:right-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:bg-accent",
].join(' ')

const badge = [
  'ml-2 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full',
  'bg-danger px-1.5 align-middle text-[11px] font-bold leading-none text-fg',
].join(' ')

export function TabRoot(props: ComponentProps<typeof Tabs.Root>) {
  return <Tabs.Root {...props} />
}

export function TabList({ children }: { children: ReactNode }) {
  return <Tabs.List className={list}>{children}</Tabs.List>
}

export function Tab({
  value,
  children,
  count,
}: {
  value: string
  children: ReactNode
  /** Renders a red count badge after the label when > 0. */
  count?: number
}) {
  return (
    <Tabs.Trigger className={trigger} value={value}>
      {children}
      {count !== undefined && count > 0 && (
        <span className={badge}>{count}</span>
      )}
    </Tabs.Trigger>
  )
}

export function TabPanel({
  value,
  children,
}: {
  value: string
  children: ReactNode
}) {
  return (
    <Tabs.Content className="pt-4" value={value}>
      {children}
    </Tabs.Content>
  )
}
