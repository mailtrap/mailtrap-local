import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InfoTooltip } from './InfoTooltip'

describe('InfoTooltip', () => {
  it('gives the icon trigger an accessible label and description', () => {
    render(
      <InfoTooltip
        label="About email headers"
        description="Header details"
        content="Header details"
      >
        <span aria-hidden="true">?</span>
      </InfoTooltip>,
    )

    expect(
      screen.getByRole('button', { name: 'About email headers' }),
    ).toHaveAccessibleDescription('Header details')
  })

  it('uses the shared visible keyboard focus indicator', () => {
    render(
      <InfoTooltip
        label="About email headers"
        description="Header details"
        content="Header details"
      >
        <span aria-hidden="true">?</span>
      </InfoTooltip>,
    )

    expect(
      screen.getByRole('button', { name: 'About email headers' }),
    ).toHaveClass(
      'focus-visible:outline-2',
      'focus-visible:outline-offset-1',
      'focus-visible:outline-accent-ring',
    )
  })

  it('portals its content and closes on Escape without bubbling or moving focus', async () => {
    const user = userEvent.setup()
    let escapeCount = 0
    const { container } = render(
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape') escapeCount += 1
        }}
      >
        <InfoTooltip
          label="About email headers"
          description="Header details"
          content="Header details"
        >
          <span aria-hidden="true">?</span>
        </InfoTooltip>
      </div>,
    )

    const trigger = screen.getByRole('button', { name: 'About email headers' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    await user.tab()

    const tooltip = screen.getByRole('tooltip')
    expect(container).not.toContainElement(tooltip)

    await user.keyboard('{Escape}')

    expect(escapeCount).toBe(0)
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('stays open while the pointer moves from its trigger onto its content', async () => {
    const user = userEvent.setup()
    render(
      <InfoTooltip
        label="About email headers"
        description="Header details"
        content={<span data-testid="tooltip-content">Header details</span>}
      >
        <span aria-hidden="true">?</span>
      </InfoTooltip>,
    )

    const trigger = screen.getByRole('button', { name: 'About email headers' })

    await user.hover(trigger)
    const content = screen.getByTestId('tooltip-content')

    await user.hover(content)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    await user.unhover(content)
    fireEvent.pointerMove(document.body, { clientX: 100, clientY: 100 })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })
})
