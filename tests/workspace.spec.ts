import { mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { createDemoSessions } from '../src/sessions'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.session-card')).toHaveCount(6)
})

test('workspace renders real assets and explicitly identifies demo data', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.reload()
  await expect(page.getByText('No agents connected')).toBeVisible()
  await expect(page.getByText('Demo data', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Pinning requires the desktop app' }),
  ).toBeDisabled()
  await page.evaluate(() => document.fonts.ready)
  const loaded = await page.evaluate(() => ({
    bodyFont: document.fonts.check('12px "DM Sans"'),
    headingFont: document.fonts.check('600 16px Manrope'),
    providerMarks: document.querySelectorAll('.session-provider svg').length,
  }))
  expect(loaded).toEqual({ bodyFont: true, headingFont: true, providerMarks: 6 })
  expect(errors).toEqual([])
})

test('search, agent and status filters compose; layout and empty state work', async ({ page }) => {
  await page.getByRole('tab', { name: /In progress/ }).click()
  await expect(page.locator('.session-card')).toHaveCount(2)
  await page.getByRole('textbox', { name: 'Search sessions' }).fill('atlas')
  await expect(page.locator('.session-card')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Agent filter' }).selectOption('claude')
  await expect(page.getByText('No matching sessions')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.locator('.session-card')).toHaveCount(6)
  await page.getByRole('button', { name: 'List view', exact: true }).click()
  await expect(page.locator('.session-grid')).toHaveClass(/list-layout/)
  await page.getByRole('button', { name: 'Grid view', exact: true }).click()
  await expect(page.locator('.session-grid')).not.toHaveClass(/list-layout/)
})

test('approval resumes a sample session, then completes and notifies', async ({ page }) => {
  await page.clock.install()
  await page.getByRole('button', { name: 'design-system: Update the color primitives' }).click()
  await expect(page.getByText('Approval requested', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Approve in demo' }).click()
  await expect(page.locator('.inspector > .status-badge')).toHaveText('In progress')
  await page.clock.fastForward(4600)
  await expect(page.locator('.inspector > .status-badge')).toHaveText('Rely Ready')
  await expect(page.getByRole('status')).toContainText('Session complete')
  await expect(page.locator('.session-completed')).toHaveCount(3)
  await page.reload()
  await expect(page.locator('.session-completed')).toHaveCount(3)
})

test('storage failure keeps the workspace interactive and reports persistence loss', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Storage unavailable', 'QuotaExceededError')
    }
  })
  await page.reload()
  await expect(page.getByText('Storage unavailable', { exact: true })).toBeVisible()
  await expect(page.locator('.session-card')).toHaveCount(6)
  await page.clock.install()
  await page.getByRole('button', { name: 'Run demo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Demo running', exact: true })).toBeVisible()
  await page.clock.fastForward(4600)
  await expect(page.getByRole('status')).toContainText('Session complete')
})

test('preferences persist and dialog supports keyboard dismissal', async ({ page }) => {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('switch', { name: 'Show Rely Ready sessions' }).click()
  await page.getByRole('switch', { name: 'Completion sound' }).click()
  await expect(page.getByRole('switch', { name: 'Always on top' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.locator('.session-card')).toHaveCount(4)
  await page.reload()
  await expect(page.locator('.session-card')).toHaveCount(4)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Completion sound' })).toBeChecked()
  await expect(page.getByRole('switch', { name: 'Show Rely Ready sessions' })).not.toBeChecked()
})

test('mini monitor synchronizes and returns to a selected session', async ({ page }) => {
  await page.clock.install()
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Mini monitor', exact: true }).click()
  const mini = await popupPromise
  await mini.setViewportSize({ width: 410, height: 580 })
  await expect(mini.locator('.mini-session')).toHaveCount(6)
  await mini.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await expect(mini.locator('.rail-session')).toHaveCount(6)
  await mini.setViewportSize({ width: 76, height: 540 })
  expect(await mini.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await mini.getByRole('button', { name: 'Dock left', exact: true }).click()
  await expect(mini.locator('.mini-rail')).toHaveClass(/rail-left/)
  mkdirSync('.artifacts', { recursive: true })
  await mini.screenshot({
    path: '.artifacts/rail-browser.png',
    animations: 'disabled',
    scale: 'css',
  })
  await mini.setViewportSize({ width: 360, height: 600 })
  await mini.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
  await expect(mini.locator('.mini-demo')).toBeVisible()
  await expect(mini.locator('.mini-session')).toHaveCount(6)
  await page.getByRole('button', { name: 'Run demo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Demo running', exact: true })).toBeVisible()
  await page.clock.fastForward(4600)
  await expect(mini.locator('.mini-completed')).toHaveCount(3)
  await expect(mini.getByRole('status')).toContainText('Session complete')
  const geometry = await mini.evaluate(() => {
    const footer = document.querySelector('.mini-footer')!.getBoundingClientRect()
    const toast = document.querySelector('.toast')!.getBoundingClientRect()
    return {
      footerVisible: footer.bottom <= innerHeight + 1,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      toastAboveFooter: toast.bottom <= footer.top,
    }
  })
  expect(geometry).toEqual({
    footerVisible: true,
    horizontalOverflow: false,
    toastAboveFooter: true,
  })
  mkdirSync('.artifacts', { recursive: true })
  await mini.screenshot({
    path: '.artifacts/mini-browser.png',
    animations: 'disabled',
    scale: 'css',
  })
  await mini.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
  await mini
    .getByRole('button', { name: 'Open atlas-api: Add authentication middleware', exact: true })
    .click()
  await expect(page.locator('.inspector h2')).toHaveText('Add authentication middleware')
})

test('detail timeline previews recent events and expands without affecting other sessions', async ({
  page,
}) => {
  const sessions = createDemoSessions()
  sessions[0].events = Array.from({ length: 12 }, (_, index) => ({
    id: `timeline-${index}`,
    text: `Timeline event ${index + 1}`,
    at: Date.now() - (12 - index) * 1000,
    kind: 'info' as const,
  }))
  await page.addInitScript((data) => {
    localStorage.setItem('pulse.demo.sessions.v1', JSON.stringify({ version: 1, sessions: data }))
  }, sessions)
  await page.reload()
  await expect(page.locator('.timeline li')).toHaveCount(5)
  await expect(page.locator('.timeline li').first()).toContainText('Timeline event 8')
  await expect(page.locator('.timeline li').last()).toContainText('Timeline event 12')
  await expect(page.locator('.timeline-live')).toHaveCount(1)
  await expect(page.locator('.timeline-heading')).toContainText('5 of 12 events')
  await page.getByRole('button', { name: 'Read more', exact: true }).click()
  await expect(page.locator('.timeline li')).toHaveCount(12)
  await expect(page.getByRole('button', { name: 'Show less', exact: true })).toHaveAttribute(
    'aria-expanded',
    'true',
  )
  await page.evaluate((data) => {
    data[0].events.push({
      id: 'timeline-new',
      text: 'New timeline event',
      at: Date.now(),
      kind: 'info',
    })
    const value = JSON.stringify({ version: 1, sessions: data })
    localStorage.setItem('pulse.demo.sessions.v1', value)
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'pulse.demo.sessions.v1', newValue: value }),
    )
  }, sessions)
  await expect(page.locator('.timeline li')).toHaveCount(13)
  await expect(page.locator('.timeline li').last()).toContainText('New timeline event')
  await page.getByRole('button', { name: 'Show less', exact: true }).click()
  await expect(page.locator('.timeline li')).toHaveCount(5)
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('pulse.demo.sessions.v1')!)
    saved.sessions[0].events.push({
      id: 'timeline-collapsed-update',
      text: 'Latest collapsed event',
      at: Date.now(),
      kind: 'info',
    })
    const value = JSON.stringify(saved)
    localStorage.setItem('pulse.demo.sessions.v1', value)
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'pulse.demo.sessions.v1', newValue: value }),
    )
  })
  await expect(page.locator('.timeline li')).toHaveCount(5)
  await expect(page.locator('.timeline li').last()).toContainText('Latest collapsed event')
  await page.getByRole('button', { name: 'Read more', exact: true }).click()
  await page
    .getByRole('button', { name: 'atlas-api: Add authentication middleware', exact: true })
    .click()
  await expect(page.locator('.timeline li')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Read more', exact: true })).toHaveCount(0)
  await page
    .getByRole('button', { name: 'pulse-desktop: Refining the session timeline', exact: true })
    .click()
  await expect(page.locator('.timeline li')).toHaveCount(5)
  await expect(page.getByRole('button', { name: 'Read more', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  )
  mkdirSync('.artifacts', { recursive: true })
  await page.screenshot({ path: '.artifacts/timeline-collapsed.png', animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Read more', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Read more', exact: true }).click()
  await expect(page.locator('.timeline li')).toHaveCount(14)
  await page.getByRole('button', { name: 'Show less', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: '.artifacts/timeline-mobile.png', animations: 'disabled' })
})

test('activity and notifications navigate to the correct details', async ({ page }) => {
  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  await expect(page.locator('.activity-row')).toHaveCount(24)
  await page.locator('.activity-row').filter({ hasText: 'Database connection timed out' }).click()
  await expect(page.locator('.inspector h2')).toHaveText('Run the database migrations')
  await expect(page.getByRole('button', { name: 'Retry in demo' })).toBeVisible()
  await page.getByRole('button', { name: 'Notifications', exact: true }).click()
  await page.locator('.notification-item').filter({ hasText: 'design-system' }).click()
  await expect(page.locator('.inspector h2')).toHaveText('Update the color primitives')
})

test('desktop, tablet and mobile layouts fit without clipping controls', async ({ page }) => {
  mkdirSync('.artifacts', { recursive: true })
  for (const [width, height] of [
    [1440, 1000],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [320, 740],
  ]) {
    await page.setViewportSize({ width, height })
    await page.evaluate(() => document.fonts.ready)
    const layout = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      clippedLabels: Array.from(
        document.querySelectorAll<HTMLElement>('.session-card h3, .button, .session-provider'),
      )
        .filter(
          (element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1,
        )
        .map((element) => element.textContent),
    }))
    expect(layout, `Viewport ${width}`).toEqual({ horizontalOverflow: false, clippedLabels: [] })
    await page.screenshot({
      path: `.artifacts/workspace-${width}.png`,
      animations: 'disabled',
      scale: 'css',
    })
  }
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.locator('.sidebar')).toHaveClass(/sidebar-open/)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
