import { forwardRef, type ButtonHTMLAttributes } from 'react'

/**
 * Pill button with variant + size. Variant drives colour; size drives
 * padding + radius + text-size. Used for inline confirms and form
 * submissions outside dialogs (dialogs still use dialogStyles.btn, which
 * is structurally identical and could migrate later).
 */

type ButtonVariant = 'primary' | 'outline' | 'danger-text'
type ButtonSize = 'sm' | 'md'

const sizes: Record<ButtonSize, string> = {
  sm: 'rounded-md px-3 py-1 text-xs',
  md: 'rounded-[7px] px-4 py-1.5 text-[13px]',
}

const base = [
  'inline-flex cursor-pointer items-center justify-center border border-transparent font-semibold',
  'disabled:cursor-not-allowed disabled:opacity-50',
  'data-[variant=primary]:bg-accent data-[variant=primary]:text-fg',
  'data-[variant=primary]:hover:bg-accent-hover',
  'data-[variant=outline]:border-accent data-[variant=outline]:text-accent',
  'data-[variant=outline]:hover:bg-accent-soft',
  'data-[variant=danger-text]:border-danger data-[variant=danger-text]:text-danger',
  'data-[variant=danger-text]:hover:bg-danger-soft',
].join(' ')

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant: ButtonVariant
  size?: ButtonSize
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant, size = 'md', className, type = 'button', ...rest },
  ref,
) {
  const cls = [base, sizes[size], className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} className={cls} data-variant={variant} {...rest} />
  )
})
