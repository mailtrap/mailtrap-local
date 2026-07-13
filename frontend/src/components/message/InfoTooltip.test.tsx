import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { InfoTooltip } from './InfoTooltip'

describe('InfoTooltip', () => {
  it('gives the icon trigger an accessible label and description', () => {
    render(
      <InfoTooltip label="About email headers" content="Header details">
        <span aria-hidden="true">?</span>
      </InfoTooltip>,
    )

    expect(
      screen.getByRole('button', { name: 'About email headers' }),
    ).toHaveAccessibleDescription('Header details')
  })

  it('closes on Escape without bubbling or moving focus', async () => {
    const user = userEvent.setup()
    let escapeCount = 0
    render(
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape') escapeCount += 1
        }}
      >
        <InfoTooltip label="About email headers" content="Header details">
          <span aria-hidden="true">?</span>
        </InfoTooltip>
      </div>,
    )

    const trigger = screen.getByRole('button', { name: 'About email headers' })
    const tooltip = screen.getByRole('tooltip')
    await user.tab()
    expect(tooltip).toHaveAttribute('data-open', 'true')

    await user.keyboard('{Escape}')

    expect(escapeCount).toBe(0)
    expect(trigger).toHaveFocus()
    expect(tooltip).toHaveAttribute('data-open', 'false')
  })

  it('stays open while the pointer moves from its trigger onto its content', async () => {
    const user = userEvent.setup()
    render(
      <InfoTooltip label="About email headers" content="Header details">
        <span aria-hidden="true">?</span>
      </InfoTooltip>,
    )

    const trigger = screen.getByRole('button', { name: 'About email headers' })
    const tooltip = screen.getByRole('tooltip')

    await user.hover(trigger)
    expect(tooltip).toHaveAttribute('data-open', 'true')

    await user.hover(tooltip)
    expect(tooltip).toHaveAttribute('data-open', 'true')

    await user.unhover(tooltip)
    expect(tooltip).toHaveAttribute('data-open', 'false')
  })
})
