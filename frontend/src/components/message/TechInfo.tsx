import { useState } from 'react'
import { HelpIcon, SuccessFilledIcon } from '../ui/icons'
import type { HeadersMap, Message } from '../../api/messages'
import { Panel } from '../ui/Panel'
import { InfoTooltip } from './InfoTooltip'

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

const techHeadingRowCss = 'mb-1.5 flex items-center gap-1.5'

const techHeadingCss = 'm-0 text-[15px] font-semibold text-fg'

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

const smtpTooltipMail =
  'Each SMTP transaction includes three commands: MAIL, RCPT, and DATA. ' +
  'MAIL FROM is the originating email address, also used as a bounce address.'

const smtpTooltipRcpt =
  'RCPT TO shows all the recipients, including Cc and Bcc. The Bcc value is ' +
  'calculated as the difference between the recipients found in RCPT TO and the ' +
  'recipients found in email headers.'

const emailHeadersTooltip =
  'Mailtrap tracks all headers found in the DATA part of your SMTP transaction. ' +
  'Besides the common To, From, Date, and Subject, email delivery services may ' +
  'allow using custom headers, e.g. X-Category or X-Tracking.'

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

export function TechInfo({
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
      <Panel className="mb-4 px-6 py-5">
        <div className={techHeadingRowCss}>
          <h3 className={techHeadingCss}>SMTP Transaction Info</h3>
          <InfoTooltip
            label="About SMTP transaction info"
            description={`${smtpTooltipMail} ${smtpTooltipRcpt}`}
            content={
              <>
                <p className="m-0">{smtpTooltipMail}</p>
                <p className="mt-2 mb-0">{smtpTooltipRcpt}</p>
              </>
            }
          >
            <HelpIcon size={14} />
          </InfoTooltip>
        </div>
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
      </Panel>

      <Panel className="mb-4 px-6 py-5">
        <div className={techHeadingRowCss}>
          <h3 className={techHeadingCss}>Email Headers</h3>
          <InfoTooltip
            label="About email headers"
            description={emailHeadersTooltip}
            content={emailHeadersTooltip}
          >
            <HelpIcon size={14} />
          </InfoTooltip>
        </div>
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
      </Panel>
    </>
  )
}
