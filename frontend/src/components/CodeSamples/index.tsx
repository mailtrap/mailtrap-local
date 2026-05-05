import { useMemo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDownIcon, CheckIcon } from '@radix-ui/react-icons'
import { css } from '@linaria/core'
import { CodeBlock } from './CodeBlock'
import {
  SNIPPET_GROUPS,
  SNIPPETS_FLAT,
  findGroupForSnippet,
  type SnippetParams,
} from './snippets'

const STORAGE_KEY = 'mt-local:smtp-snippet'

const container = css`
  width: 100%;
  max-width: 850px;
  margin: 0 auto;
  text-align: left;
`

const wrapper = css`
  border: 1px solid #2a394b;
  border-radius: 8px;
  background: #172230;
  overflow: hidden;
  font-size: 13px;
`

const header = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  border-bottom: 1px solid #212d3c;
  background: #131e2b;
`

const tabsRow = css`
  display: flex;
  gap: 2px;
  flex-wrap: wrap;
  min-width: 0;
  flex: 1 1 auto;
`

const tabBtn = css`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 10px;
  border: 0;
  background: transparent;
  color: #687a91;
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 80ms ease, color 80ms ease;

  &:hover { color: #fbfcfc; background: #212d3c; }
  &[data-active='true'] { color: #fbfcfc; background: #212d3c; }
  &[data-state='open'] { color: #fbfcfc; background: #212d3c; }
  &:focus-visible { outline: 2px solid #4c83ee; outline-offset: -2px; }

  svg { color: #6b7a8c; }
`

const copyBtn = css`
  flex: 0 0 auto;
  padding: 5px 10px;
  border: 0;
  background: transparent;
  color: #4c83ee;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  transition: background 80ms ease;

  &:hover { background: rgba(76, 131, 238, 0.08); }
  &:focus-visible { outline: 2px solid #4c83ee; outline-offset: -2px; }
`

const menuContent = css`
  min-width: 180px;
  background: #172230;
  border: 1px solid #2a394b;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 50;
`

const menuItem = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 10px;
  font-size: 12.5px;
  color: #c2cbd6;
  border-radius: 4px;
  cursor: pointer;
  outline: none;

  &[data-highlighted] { background: #212d3c; color: #fbfcfc; }
  &[data-active='true'] { color: #fbfcfc; }
  &[data-active='true'] svg { color: #4c83ee; }
  & .check { width: 14px; height: 14px; opacity: 0; }
  &[data-active='true'] .check { opacity: 1; }
`

const footer = css`
  padding: 6px 14px;
  border-top: 1px solid #212d3c;
  color: #687a91;
  font-size: 12px;
  text-align: left;
  background: #131e2b;
`

interface CodeSamplesProps {
  host?: string
  port?: number
  fromEmail?: string
  toEmail?: string
}

export default function CodeSamples({
  host = '127.0.0.1',
  port = 3535,
  fromEmail = 'sender@example.test',
  toEmail = 'rcpt@example.test',
}: CodeSamplesProps) {
  const params: SnippetParams = { host, port, fromEmail, toEmail }

  const [active, setActive] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    return saved && SNIPPETS_FLAT.some((s) => s.id === saved) ? saved : SNIPPETS_FLAT[0].id
  })
  const [copied, setCopied] = useState(false)

  const activeSnippet = useMemo(
    () => SNIPPETS_FLAT.find((s) => s.id === active) ?? SNIPPETS_FLAT[0],
    [active],
  )
  const activeGroupId = useMemo(() => findGroupForSnippet(active)?.id, [active])
  const rendered = useMemo(() => activeSnippet.code(params), [activeSnippet, params])

  const selectSnippet = (id: string) => {
    setActive(id)
    setCopied(false)
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* private mode */ }
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(rendered)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch { /* clipboard unavailable */ }
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
                      <ChevronDownIcon width={12} height={12} />
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
                          <CheckIcon className="check" />
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
        <CodeBlock code={rendered} language={activeSnippet.lang} showLineNumbers />
        {activeSnippet.paragraph && (
          <div className={footer}>{activeSnippet.paragraph}</div>
        )}
      </div>
    </div>
  )
}
