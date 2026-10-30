import mailtrapLogo from '../assets/mailtrap-logo.svg'
import { CodeSamples } from '../components/CodeSamples'

const emptyCss =
  'flex min-h-[60vh] flex-col items-stretch py-8 text-fg-muted'

const emptyBrandCss = 'mx-auto mb-6'
const emptyBrandImgCss = 'block h-9 w-auto'

const emptyCodeCss = [
  'rounded bg-accent/10 text-accent px-2 py-1 text-[13px]',
  'font-mono',
].join(' ')

const emptyHintCss = 'mx-auto mb-7 max-w-[520px] text-center leading-[1.7]'

export function Sandbox() {
  const host =
    typeof window !== 'undefined' && window.location.hostname
      ? window.location.hostname
      : '127.0.0.1'

  return (
    <div className={emptyCss}>
      <div className={emptyBrandCss}>
        <img src={mailtrapLogo} alt="Mailtrap" className={emptyBrandImgCss} />
      </div>
      <div className={emptyHintCss}>
        <p>
          Point your app's SMTP client at{' '}
          <code className={emptyCodeCss}>smtp://{host}:3535</code> — every
          message lands in your local sandbox in the bar on the left.
        </p>
      </div>
      <CodeSamples host={host} />
    </div>
  )
}
