import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeMessage } from '../../test/fixtures'
import { TechInfo } from './TechInfo'

describe('TechInfo', () => {
  it('keeps tooltip controls and content outside semantic headings', () => {
    render(
      <TechInfo
        msg={makeMessage()}
        headers={{ Subject: ['Example subject'] }}
      />,
    )

    const cases = [
      ['SMTP Transaction Info', 'About SMTP transaction info', /MAIL FROM/],
      ['Email Headers', 'About email headers', /custom headers/],
    ] as const

    for (const [headingName, buttonName, description] of cases) {
      const heading = screen.getByRole('heading', { name: headingName })
      const button = screen.getByRole('button', { name: buttonName })
      const tooltipId = button.getAttribute('aria-describedby')
      const tooltip = tooltipId ? document.getElementById(tooltipId) : null

      expect(heading).not.toContainElement(button)
      expect(heading).not.toContainElement(tooltip)
      expect(button).toHaveAccessibleDescription(description)
    }
  })
})
