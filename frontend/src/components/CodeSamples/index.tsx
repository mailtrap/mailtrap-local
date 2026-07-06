import { useMemo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDownIcon, CheckIcon } from '@radix-ui/react-icons'
import { CodeBlock } from './CodeBlock'
import {
  SNIPPET_GROUPS,
  SNIPPETS_FLAT,
  findGroupForSnippet,
  type SnippetParams,
} from './snippets'

const STORAGE_KEY = 'mt-local:smtp-snippet'

const container = 'mx-auto w-full max-w-[850px] text-left'

const wrapper =
  'overflow-hidden rounded-lg border border-border-subtle bg-surface-raised text-[13px]'

const header =
  'flex items-center justify-between gap-2 border-b border-border-base bg-surface-base p-1 pl-1 pr-2'

const tabsRow = 'flex flex-1 min-w-0 flex-wrap gap-0.5'

const tabBtn = [
  'inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-md',
  'border-0 bg-transparent px-2.5 py-[5px] text-[12.5px] font-medium text-fg-muted',
  'transition-[background-color,color] duration-[80ms]',
  'hover:bg-surface-hover hover:text-fg',
  'data-[active=true]:bg-surface-hover data-[active=true]:text-fg',
  'data-[state=open]:bg-surface-hover data-[state=open]:text-fg',
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
].join(' ')

const tabBtnChevronCss = 'text-[#6b7a8c]'

const copyBtn = [
  'shrink-0 cursor-pointer rounded-md border-0 bg-transparent',
  'px-2.5 py-[5px] text-[12.5px] font-semibold text-accent',
  'transition-[background-color] duration-[80ms]',
  'hover:bg-accent-soft',
  'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
].join(' ')

const menuContent = [
  'z-50 min-w-[180px] rounded-lg border border-border-subtle bg-surface-raised p-1',
  'shadow-[0_8px_24px_rgba(0,0,0,0.4)]',
].join(' ')

const menuItem = [
  'group flex cursor-pointer items-center justify-between gap-3 rounded px-2.5 py-1.5',
  'text-[12.5px] text-[#c2cbd6] outline-none',
  'data-[highlighted]:bg-surface-hover data-[highlighted]:text-fg',
  'data-[active=true]:text-fg',
].join(' ')

const menuItemCheckCss =
  'h-3.5 w-3.5 opacity-0 group-data-[active=true]:text-accent group-data-[active=true]:opacity-100'

const footer =
  'border-t border-border-base bg-surface-base px-3.5 py-1.5 text-left text-xs text-fg-muted'

interface Props {
  host?: string
  port?: number
  fromEmail?: string
  toEmail?: string
}

export function CodeSamples({
  host = '127.0.0.1',
  port = 3535,
  fromEmail = 'sender@example.test',
  toEmail = 'rcpt@example.test',
}: Props) {
  // Memoize the SnippetParams object so it doesn't change identity on
  // every render — otherwise the `rendered` useMemo below re-runs each
  // time even when none of host/port/fromEmail/toEmail actually moved.
  const params: SnippetParams = useMemo(
    () => ({ host, port, fromEmail, toEmail }),
    [host, port, fromEmail, toEmail],
  )

  const [active, setActive] = useState<string>(() => {
    const saved =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(STORAGE_KEY)
        : null
    return saved && SNIPPETS_FLAT.some((s) => s.id === saved)
      ? saved
      : SNIPPETS_FLAT[0].id
  })
  const [copied, setCopied] = useState(false)

  const activeSnippet = useMemo(
    () => SNIPPETS_FLAT.find((s) => s.id === active) ?? SNIPPETS_FLAT[0],
    [active],
  )
  const activeGroupId = useMemo(() => findGroupForSnippet(active)?.id, [active])
  const rendered = useMemo(
    () => activeSnippet.code(params),
    [activeSnippet, params],
  )

  const selectSnippet = (id: string) => {
    setActive(id)
    setCopied(false)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      /* private mode */
    }
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(rendered)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className={container}>
      <div className={wrapper}>
        <div className={header}>
          <div className={tabsRow}>
            {SNIPPET_GROUPS.map((group) => {
              const isActiveGroup = group.id === activeGroupId
              if (group.items.length === 1) {
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={tabBtn}
                    data-active={isActiveGroup}
                    onClick={() => selectSnippet(group.items[0].id)}
                  >
                    {group.label}
                  </button>
                )
              }
              return (
                <DropdownMenu.Root key={group.id}>
                  <DropdownMenu.Trigger asChild>
                    <button
                      type="button"
                      className={tabBtn}
                      data-active={isActiveGroup}
                    >
                      {group.label}
                      <ChevronDownIcon
                        width={12}
                        height={12}
                        className={tabBtnChevronCss}
                      />
                    </button>
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content
                      className={menuContent}
                      sideOffset={4}
                      align="start"
                    >
                      {group.items.map((item) => (
                        <DropdownMenu.Item
                          key={item.id}
                          className={menuItem}
                          data-active={item.id === active}
                          onSelect={() => selectSnippet(item.id)}
                        >
                          <span>{item.label}</span>
                          <CheckIcon className={menuItemCheckCss} />
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              )
            })}
          </div>
          <button type="button" className={copyBtn} onClick={onCopy}>
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
        <CodeBlock
          code={rendered}
          language={activeSnippet.lang}
          showLineNumbers
        />
        {activeSnippet.paragraph && (
          <div className={footer}>{activeSnippet.paragraph}</div>
        )}
      </div>
    </div>
  )
}
