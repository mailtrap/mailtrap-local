import '../../lib/prism-langs'
import { Highlight, themes } from 'prism-react-renderer'

const wrapperCss = [
  'm-0 px-3.5 py-2.5 text-left tab-size-2',
  '!bg-transparent',
  "font-['Fira_Code','JetBrains_Mono',ui-monospace,SFMono-Regular,Menlo,monospace] text-[12.5px] leading-[1.55]",
  'whitespace-pre-wrap [overflow-wrap:anywhere]',
].join(' ')

const rowCss = 'flex'

const lineNumCss =
  'w-9 flex-none pr-3 text-right text-[#4a5a6f] select-none'

const codeCss = 'min-w-0 flex-1'

interface Props {
  code: string
  language: string
  showLineNumbers?: boolean
}

export function CodeBlock({
  code,
  language,
  showLineNumbers = false,
}: Props) {
  return (
    <Highlight theme={themes.vsDark} code={code} language={language}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`${wrapperCss} ${className}`}
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
                className={`${rowCss} ${lineClass ?? ''}`}
                {...lineProps}
              >
                {showLineNumbers && <span className={lineNumCss}>{i + 1}</span>}
                <span className={codeCss}>
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
