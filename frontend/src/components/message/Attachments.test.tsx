import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeAttachment } from '../../test/fixtures'
import { Attachments } from './Attachments'

describe('Attachments', () => {
  it('lets Escape bubble while the menu is closed', async () => {
    const user = userEvent.setup()
    let escapeCount = 0
    render(
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape') escapeCount += 1
        }}
      >
        <Attachments
          messageId="message-1"
          attachments={[makeAttachment({ file_name: 'report.pdf' })]}
        />
      </div>,
    )

    screen.getByRole('button', { name: 'Attachments (1)' }).focus()
    await user.keyboard('{Escape}')

    expect(escapeCount).toBe(1)
  })

  it('closes on Escape and returns focus to its trigger', async () => {
    const user = userEvent.setup()
    render(
      <Attachments
        messageId="message-1"
        attachments={[makeAttachment({ file_name: 'report.pdf' })]}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Attachments (1)' })
    await user.click(trigger)

    const attachment = screen.getByRole('link', { name: /report\.pdf/i })
    attachment.focus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('closes without stealing focus when focus leaves the disclosure', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Attachments
          messageId="message-1"
          attachments={[makeAttachment({ file_name: 'report.pdf' })]}
        />
        <button type="button">After attachments</button>
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Attachments (1)' }))
    screen.getByRole('link', { name: /report\.pdf/i }).focus()
    await user.tab()

    expect(screen.getByRole('button', { name: 'After attachments' })).toHaveFocus()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})
