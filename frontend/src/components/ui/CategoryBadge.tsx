const base =
  'inline-block overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-accent-medium text-accent font-semibold'

const sizes = {
  // header pill: bigger, wider clamp
  lg: 'max-w-[200px] px-2.5 py-0.5 text-[11px] leading-[1.6]',
  // list row pill: smaller, tighter clamp, plus active-row override
  sm: [
    'max-w-[140px] px-2 py-0.5 text-[11px] leading-[1.4]',
    'group-data-[active=true]:bg-white/20 group-data-[active=true]:text-fg',
  ].join(' '),
}

export function CategoryBadge({
  size = 'lg',
  className,
  label,
}: {
  size?: 'sm' | 'lg'
  /** Extra utilities for positioning inside a grid (e.g. col-start/row-start). */
  className?: string
  label: string
}) {
  const combined = [base, sizes[size], className].filter(Boolean).join(' ')
  return (
    <span className={combined} title={`Category: ${label}`}>
      {label}
    </span>
  )
}
