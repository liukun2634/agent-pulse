import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test } from '@playwright/test'

test.use({ locale: 'zh-CN' })

const api = 'https://api.github.com/repos/liukun2634/agent-pulse/releases?per_page=10'
const asset = (name: string) => ({
  name,
  size: 120000000,
  browser_download_url: `https://github.com/liukun2634/agent-pulse/releases/download/v0.1.0/${name}`,
})

test('static HTML opens and navigates without a server', async ({ page }) => {
  await page.route(api, (route) => route.fulfill({ json: [] }))
  await page.goto(pathToFileURL(resolve('.artifacts/site/index.html')).href)
  await page.getByRole('link', { name: 'Download', exact: true }).click()
  await expect(page.locator('[data-release-status]')).toContainText(
    'No Windows installer has been published yet',
  )
  await page.getByRole('link', { name: 'Project', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Agent Pulse', exact: true })).toBeVisible()
})

test('project site loads its real previews and fits desktop and mobile', async ({ page }) => {
  mkdirSync('.artifacts', { recursive: true })
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/.artifacts/site/index.html')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    expect(await page.content()).not.toMatch(/\p{Script=Han}/u)
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map((image) => image.decode()))
    })
    await expect(page.getByRole('heading', { name: 'Agent Pulse', exact: true })).toBeVisible()
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      imagesLoaded: [...document.images].every((image) => image.naturalWidth > 0),
      clippedButtons: [...document.querySelectorAll<HTMLElement>('.button')].some(
        (button) => button.scrollWidth > button.clientWidth + 1,
      ),
    }))
    expect(layout).toEqual({ overflow: false, imagesLoaded: true, clippedButtons: false })
    await page.screenshot({
      path: `.artifacts/site-home-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  }
})

test('download page enables only published release assets', async ({ page }) => {
  await page.route(api, (route) =>
    route.fulfill({
      json: [
        {
          tag_name: 'v0.1.0',
          prerelease: true,
          draft: false,
          published_at: '2026-11-04T00:00:00Z',
          assets: [
            asset('Agent-Pulse-Setup-0.1.0-x64.exe'),
            asset('pulse-companion.vsix'),
            asset('SHA256SUMS.txt'),
          ],
        },
      ],
    }),
  )
  await page.goto('/.artifacts/site/download.html')
  await expect(page.locator('[data-release-name]')).toHaveText('v0.1.0')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(await page.content()).not.toMatch(/\p{Script=Han}/u)
  await expect(page.locator('[data-release-date]')).toHaveText('Nov 4, 2026')
  await expect(page.locator('[data-asset="installer"]')).toHaveAttribute(
    'href',
    /Agent-Pulse-Setup-0\.1\.0-x64\.exe$/,
  )
  await expect(page.locator('[data-asset="companion"]')).not.toHaveAttribute('aria-disabled')
  await expect(page.locator('[data-release-status]')).toContainText('prerelease')
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({
      path: `.artifacts/site-download-${width}.png`,
      fullPage: true,
      animations: 'disabled',
    })
  }
})

test('no release or API failure never exposes a broken installer link', async ({ page }) => {
  await page.route(api, (route) => route.fulfill({ json: [] }))
  await page.goto('/.artifacts/site/download.html')
  await expect(page.locator('[data-release-status]')).toContainText(
    'No Windows installer has been published yet',
  )
  await expect(page.locator('[data-asset="installer"]')).not.toHaveAttribute('href')
  await page.unroute(api)
  await page.route(api, (route) => route.fulfill({ status: 503, body: 'Unavailable' }))
  await page.reload()
  await expect(page.locator('[data-release-status]')).toContainText(
    'Unable to check releases right now',
  )
  await expect(page.locator('[data-asset="installer"]')).toHaveAttribute('aria-disabled', 'true')
})

test('draft releases and off-repository assets never enable downloads', async ({ page }) => {
  const installer = asset('Agent-Pulse-Setup-0.1.0-x64.exe')
  await page.route(api, (route) =>
    route.fulfill({
      json: [
        { draft: true, assets: [installer] },
        {
          draft: false,
          assets: [{ ...installer, browser_download_url: 'https://example.com/installer.exe' }],
        },
        {
          draft: false,
          assets: [
            {
              ...installer,
              browser_download_url:
                'https://github.com/other/project/releases/download/v1/installer.exe',
            },
          ],
        },
      ],
    }),
  )
  await page.goto('/.artifacts/site/download.html')
  await expect(page.locator('[data-release-status]')).toContainText(
    'No Windows installer has been published yet',
  )
  await expect(page.locator('[data-asset="installer"]')).not.toHaveAttribute('href')
})
