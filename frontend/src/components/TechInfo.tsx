import { useState } from 'react'
import { HelpIcon, SuccessFilledIcon } from './icons'
import type { HeadersMap, Message } from '../api/messages'

const techSection =
  'mb-4 rounded-lg border border-border-base bg-surface-raised px-6 py-5'

// Two-column key/value table with zebra striping. Same shell wherever
// it's used; per-cell classes live alongside the cell elements below.
const techTableCss = [
  'w-full text-[13px] [border-collapse:separate] [border-spacing:0]',
  'overflow-hidden rounded-lg border border-border-base',
].join(' ')

const techTableCellCss =
  'p-3 px-4 text-left align-middle border-b border-border-base'

const techTableHeadCss = [
  techTableCellCss,
  'bg-surface-base text-[13px] font-bold text-fg',
].join(' ')

// The one legitimate descendant rule: removing the bottom border on the
// last row's cells. `:last-child` is structural and can only be detected
// in CSS, so a narrow `[&>tr:last-child>td]:` on the <tbody> is right —
// it's not a selector-hook, it's a position-driven rule.
const techTableBodyCss = '[&>tr:last-child>td]:border-b-0'

// Zebra striping via Tailwind's native `even:` variant on each <tr>.
const techTableRowCss = 'bg-surface-raised even:bg-surface-base'

const techTableNameCellCss = [
  techTableCellCss,
  'w-[180px] whitespace-nowrap text-fg',
].join(' ')

const techTableValCellCss = [techTableCellCss, 'text-fg break-all'].join(' ')

const techTableCopyCellCss = [
  techTableCellCss,
  'w-[72px] text-right',
].join(' ')

const techHeadingCss =
  'mb-1.5 m-0 inline-flex items-center gap-1.5 text-[15px] font-semibold text-fg'

const techHelpIconCss = 'cursor-help text-fg-muted'

const techBlurb = 'mb-3.5 m-0 text-[13px] leading-[1.6] text-fg'

const copyBtn = [
  'inline-flex cursor-pointer items-center justify-center rounded-md border border-accent',
  'px-3 py-[3px] text-xs font-medium text-accent',
  'hover:bg-accent/10',
].join(' ')

const infoRowCss = [
  'flex items-center justify-center gap-1.5 border-b border-border-base',
  'px-3 py-2.5 text-[13px] text-fg',
].join(' ')

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard unavailable; swallow
    }
  }
  return (
    <button className={copyBtn} type="button" onClick={onClick}>
      {copied ? '✓' : 'Copy'}
    </button>
  )
}

export default function TechInfo({
  msg,
  headers,
}: {
  msg: Message
  headers: HeadersMap
}) {
  const smtpRows: [string, string][] = [
    ['MAIL FROM', msg.envelope_from || '(unknown)'],
    ...msg.envelope_to.map((to): [string, string] => ['RCPT TO', to]),
  ]

  const headerRows: [string, string][] = Object.entries(headers).flatMap(
    ([name, values]) => values.map((v): [string, string] => [name, v]),
  )

  const hasBcc = headerRows.some(([k]) => k.toLowerCase() === 'bcc')

  return (
    <>
      <section className={techSection}>
        <h3 className={techHeadingCss}>
          SMTP Transaction Info
          <HelpIcon
            className={techHelpIconCss}
            size={14}
            title="What is this?"
          />
        </h3>
        <p className={techBlurb}>
          This information is sent with the SMTP transaction itself and is not
          included in the email headers or body. It can be crucial for SMTP
          debugging but can't be found in common email tools.
        </p>
        <table className={techTableCss}>
          <thead>
            <tr>
              <th className={techTableHeadCss}>Name</th>
              <th className={techTableHeadCss}>Value</th>
              <th className={techTableHeadCss} />
            </tr>
          </thead>
          <tbody className={techTableBodyCss}>
            {smtpRows.map(([k, v], i) => (
              <tr key={`${k}-${i}`} className={techTableRowCss}>
                <td className={techTableNameCellCss}>{k}</td>
                <td className={techTableValCellCss}>{v}</td>
                <td className={techTableCopyCellCss}>
                  <CopyButton text={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={techSection}>
        <h3 className={techHeadingCss}>
          Email Headers
          <HelpIcon
            className={techHelpIconCss}
            size={14}
            title="What is this?"
          />
        </h3>
        <p className={techBlurb}>
          Original values of the headers. When sending a real email, headers
          can be altered by an email service provider or a mail transfer
          agent.
        </p>
        <table className={techTableCss}>
          <thead>
            <tr>
              <th className={techTableHeadCss}>Name</th>
              <th className={techTableHeadCss}>Value</th>
              <th className={techTableHeadCss} />
            </tr>
          </thead>
          <tbody className={techTableBodyCss}>
            {headerRows.length === 0 && (
              <tr>
                <td
                  colSpan={3}
                  className={`${techTableCellCss} text-fg-muted`}
                >
                  (no headers)
                </td>
              </tr>
            )}
            {headerRows.map(([k, v], i) => (
              <tr key={`${k}-${i}`} className={techTableRowCss}>
                <td className={techTableNameCellCss}>{k}</td>
                <td className={techTableValCellCss}>{v}</td>
                <td className={techTableCopyCellCss}>
                  <CopyButton text={v} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!hasBcc && headerRows.length > 0 && (
          <div className={infoRowCss}>
            <SuccessFilledIcon className="text-success" size={14} />
            There is no Bcc information in this email message
          </div>
        )}
      </section>
    </>
  )
}
