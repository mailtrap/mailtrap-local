import '../../lib/prism-langs'
import { Highlight, themes } from 'prism-react-renderer'

const wrapper = [
  'm-0 px-3.5 py-2.5 text-left tab-size-2',
  '!bg-transparent',
  "font-['Fira_Code','JetBrains_Mono',ui-monospace,SFMono-Regular,Menlo,monospace] text-[12.5px] leading-[1.55]",
  'whitespace-pre-wrap [overflow-wrap:anywhere]',
  // Per-line decorations applied via descendant selectors.
  '[&_.row]:flex',
  '[&_.ln]:w-9 [&_.ln]:flex-none [&_.ln]:pr-3 [&_.ln]:text-right [&_.ln]:text-[#4a5a6f] [&_.ln]:select-none',
  '[&_.code]:min-w-0 [&_.code]:flex-1',
].join(' ')

interface CodeBlockProps {
  code: string
  language: string
  showLineNumbers?: boolean
}

export function CodeBlock({
  code,
  language,
  showLineNumbers = false,
}: CodeBlockProps) {
  return (
    <Highlight theme={themes.vsDark} code={code} language={language}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`${wrapper} ${className}`}
          style={{ ...style, background: 'transparent' }}
        >
          {tokens.map((line, i) => {
            const {
              key: _lk,
              className: lineClass,
              ...lineProps
            } = getLineProps({ line })
            return (
              <div
                key={i}
                className={`row ${lineClass ?? ''}`}
                {...lineProps}
              >
                {showLineNumbers && <span className="ln">{i + 1}</span>}
                <span className="code">
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
