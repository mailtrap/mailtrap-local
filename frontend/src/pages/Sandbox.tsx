import mailtrapLogo from '../assets/mailtrap-logo.svg'
import CodeSamples from '../components/CodeSamples'

const empty = [
  'flex min-h-[60vh] flex-col items-stretch py-8 text-fg-muted',
  '[&_.brand]:mx-auto [&_.brand]:mb-6',
  '[&_.brand_img]:block [&_.brand_img]:h-9 [&_.brand_img]:w-auto',
  "[&_code]:rounded [&_code]:bg-accent/10 [&_code]:text-accent [&_code]:px-2 [&_code]:py-1 [&_code]:text-[13px] [&_code]:font-['SF_Mono',Menlo,Consolas,monospace]",
  '[&_.hint]:mx-auto [&_.hint]:mb-7 [&_.hint]:max-w-[520px] [&_.hint]:text-center [&_.hint]:leading-[1.7]',
].join(' ')

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
