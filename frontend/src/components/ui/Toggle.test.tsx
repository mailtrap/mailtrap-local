import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toggle } from './Toggle'

/**
 * Toggle is a controlled checkbox dressed up as a switch. Every dialog
 * consumes it to drive the cloud-mirror / auto-relay / webhook-enabled
 * flags, so the contract worth pinning is:
 *
 *   - clicking the visible track flips the underlying checkbox
 *   - the disabled prop blocks interaction (no click side-effects)
 *   - the label prop renders alongside (or is omitted)
 *   - keyboard activation works (Space)
 */
describe('Toggle', () => {
  it('renders the label when provided', () => {
    render(<Toggle id="t1" label="Cloud mirror" />)
    expect(screen.getByText('Cloud mirror')).toBeInTheDocument()
  })

  it('renders without a label', () => {
    const { container } = render(<Toggle id="t2" />)
    expect(container.querySelectorAll('span')).toHaveLength(1) // just the track
  })

  it('flips state when the visible track is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Toggle id="t3" label="Off" defaultChecked={false} onChange={onChange} />)

    await user.click(screen.getByLabelText('Off'))
    expect(onChange).toHaveBeenCalledTimes(1)
    // Uncontrolled, so the input has actually flipped to checked.
    expect(screen.getByLabelText('Off')).toBeChecked()
  })

  it('responds to Space on keyboard focus', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Toggle id="t4" label="Kbd" checked={false} onChange={onChange} />)

    const input = screen.getByLabelText('Kbd')
    input.focus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenCalled()
  })

  it('blocks interaction when disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <Toggle
        id="t5"
        label="Locked"
        checked={false}
        disabled
        onChange={onChange}
      />,
    )
    await user.click(screen.getByLabelText('Locked'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('passes the id through so external <label htmlFor=...> works', () => {
    render(<Toggle id="my-toggle" label="X" />)
    const input = screen.getByLabelText('X')
    expect(input).toHaveAttribute('id', 'my-toggle')
  })

  it('forwards arbitrary input props (name, value, etc.)', () => {
    render(<Toggle id="tn" label="N" name="prefs" value="cloud-mirror" />)
    const input = screen.getByLabelText('N')
    expect(input).toHaveAttribute('name', 'prefs')
    expect(input).toHaveAttribute('value', 'cloud-mirror')
  })
})
