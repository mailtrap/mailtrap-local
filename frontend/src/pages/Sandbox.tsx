import { css } from '@linaria/core'
import mailtrapLogo from '../assets/mailtrap-logo.svg'
import CodeSamples from '../components/CodeSamples'

const empty = css`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-height: 60vh;
  color: #687a91;
  padding: 32px 0;

  .brand {
    margin: 0 auto 24px;
  }
  .brand img {
    height: 36px;
    width: auto;
    display: block;
  }
  code {
    background: rgba(76, 131, 238, 0.1);
    color: #4c83ee;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
    font-family: 'SF Mono', Menlo, Consolas, monospace;
  }
  .hint {
    max-width: 520px;
    line-height: 1.7;
    text-align: center;
    margin: 0 auto 28px;
  }
`

export default function Sandbox() {
  return (
    <div className={empty}>
      <div className="brand">
        <img src={mailtrapLogo} alt="Mailtrap" />
      </div>
      <div className="hint">
        <p>
          Point your app's SMTP client at{' '}
          <code>smtp://127.0.0.1:3535</code> — every message lands in your
          local sandbox in the bar on the left.
        </p>
      </div>
      <CodeSamples />
    </div>
  )
}
