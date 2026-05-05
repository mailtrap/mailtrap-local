import '../../lib/prism-langs'
import { Highlight, themes } from 'prism-react-renderer'
import { css } from '@linaria/core'

const wrapper = css`
  margin: 0;
  padding: 10px 14px;
  background: transparent !important;
  font-family: 'Fira Code', 'JetBrains Mono', ui-monospace, SFMono-Regular,
    Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  tab-size: 2;
  text-align: left;

  .row { display: flex; }
  .ln {
    flex: 0 0 auto;
    width: 36px;
    padding-right: 12px;
    text-align: right;
    color: #4a5a6f;
    user-select: none;
  }
  .code { flex: 1 1 auto; min-width: 0; }
`

interface CodeBlockProps {
  code: string
  language: string
  showLineNumbers?: boolean
}

export function CodeBlock({ code, language, showLineNumbers = false }: CodeBlockProps) {
  return (
    <Highlight theme={themes.vsDark} code={code} language={language}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={`${wrapper} ${className}`}
          style={{ ...style, background: 'transparent' }}
        >
          {tokens.map((line, i) => {
            const { key: _lk, className: lineClass, ...lineProps } = getLineProps({ line })
            return (
              <div key={i} className={`row ${lineClass ?? ''}`} {...lineProps}>
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
