import { Highlight, themes } from 'prism-react-renderer'
import { codeBlockBase } from '../../lib/styles'

const wrapper = `${codeBlockBase} m-0 bg-black/25 p-0 leading-[1.55]`

const lineNumber = [
  'select-none px-2.5 pr-3 text-right text-[#4d5a6a]',
  'border-r border-border-base',
].join(' ')

export default function HtmlSource({ code }: { code: string }) {
  return (
    <Highlight theme={themes.vsDark} code={code} language="markup">
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`${wrapper} ${className}`}
          style={{ ...style, background: 'transparent' }}
        >
          {tokens.map((line, i) => {
            const {
              key: _lk,
              className: _lc,
              ...lineProps
            } = getLineProps({ line })
            return (
              <div
                key={i}
                className="grid grid-cols-[48px_1fr]"
                {...lineProps}
              >
                <span className={lineNumber}>{i + 1}</span>
                <span className="px-3.5 whitespace-pre-wrap break-words">
                  {line.map((token, ti) => {
                    const { key: _tk, ...tokenProps } = getTokenProps({ token })
                    return <span key={ti} {...tokenProps} />
                  })}
                </span>
              </div>
            )
          })}
        </pre>
      )}
    </Highlight>
  )
}
