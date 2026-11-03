import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { _electron as electron } from 'playwright'

test('desktop pinning, mini monitor and session synchronization', { timeout: 90000 }, async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'pulse-test-'))
  const environment = { ...process.env, PULSE_TEST_MODE: '1', PULSE_TEST_DATA: userData }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.PULSE_DEV_SERVER_URL
  let application

  try {
    application = await electron.launch({ args: [process.cwd()], env: environment, timeout: 30000 })
    const main = await application.firstWindow()
    const errors = []
    main.on('pageerror', (error) => errors.push(error.message))
    await main.locator('.session-card').first().waitFor()
    assert.equal(await main.locator('.session-card').count(), 6)
    await main.getByRole('button', { name: 'Pin window', exact: true }).click()
    await main.getByRole('button', { name: 'Unpin window', exact: true }).waitFor()
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isAlwaysOnTop(),
      ),
      true,
    )
    await main.getByRole('button', { name: 'Unpin window', exact: true }).click()

    const miniPromise = application.waitForEvent('window')
    await main.getByRole('button', { name: 'Mini monitor', exact: true }).click()
    const mini = await miniPromise
    await mini.locator('.mini-session').first().waitFor()
    assert.equal(await mini.locator('.mini-session').count(), 6)
    await mini.getByRole('button', { name: 'Unpin window', exact: true }).waitFor()
    const docked = await application.evaluate(({ BrowserWindow, screen }) => {
      const main = BrowserWindow.getAllWindows().find(
        (window) => !window.webContents.getURL().includes('view=mini'),
      )
      const compact = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('view=mini'),
      )
      const bounds = compact.getBounds()
      const area = screen.getDisplayMatching(bounds).workArea
      return {
        mainVisible: main.isVisible(),
        width: bounds.width,
        rightGap: area.x + area.width - bounds.x - bounds.width,
      }
    })
    assert.equal(docked.mainVisible, false)
    assert.ok(Math.abs(docked.width - 360) <= 5, `Unexpected sidebar width: ${docked.width}`)
    assert.ok(Math.abs(docked.rightGap - 12) <= 2, `Unexpected edge gap: ${docked.rightGap}`)
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('view=mini'))
          .isAlwaysOnTop(),
      ),
      true,
    )
    await mini.getByRole('button', { name: 'Unpin window', exact: true }).click()
    await mini.getByRole('button', { name: 'Pin window', exact: true }).waitFor()

    await mini.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    await mini.locator('.mini-rail').waitFor()
    assert.equal(await mini.locator('.rail-session').count(), 6)
    const collapsedWidth = await application.evaluate(
      ({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('view=mini'))
          .getBounds().width,
    )
    assert.ok(collapsedWidth < 90, `Rail is too wide: ${collapsedWidth}`)
    mkdirSync('.artifacts', { recursive: true })
    await mini.screenshot({
      path: '.artifacts/rail-native.png',
      animations: 'disabled',
      scale: 'css',
    })
    await mini
      .getByRole('button', { name: 'Open design-system: Update the color primitives', exact: true })
      .click()
    await main.locator('.inspector h2').filter({ hasText: 'Update the color primitives' }).waitFor()
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => !window.webContents.getURL().includes('view=mini'))
          .isVisible(),
      ),
      true,
    )
    await main.getByRole('button', { name: 'Mini monitor', exact: true }).click()
    await mini.locator('.mini-rail').waitFor()
    await mini.getByRole('button', { name: 'Dock left', exact: true }).click()
    await mini.getByRole('button', { name: 'Dock right', exact: true }).waitFor()
    const leftGap = await application.evaluate(({ BrowserWindow, screen }) => {
      const bounds = BrowserWindow.getAllWindows()
        .find((window) => window.webContents.getURL().includes('view=mini'))
        .getBounds()
      return bounds.x - screen.getDisplayMatching(bounds).workArea.x
    })
    assert.ok(Math.abs(leftGap - 12) <= 2)
    await mini.getByRole('button', { name: 'Expand sidebar', exact: true }).click()
    await mini.locator('.mini-session').first().waitFor()
    await mini.getByRole('button', { name: 'Dock right', exact: true }).click()

    await mini.getByRole('button', { name: 'Expand workspace', exact: true }).click()
    await main.waitForFunction(() => document.visibilityState === 'visible')
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => !window.webContents.getURL().includes('view=mini'))
          .isMaximized(),
      ),
      true,
    )
    await application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((window) => !window.webContents.getURL().includes('view=mini'))
        .minimize(),
    )
    await mini.waitForFunction(() => document.visibilityState === 'visible')

    await mini.getByRole('button', { name: 'Open workspace', exact: true }).first().click()
    assert.equal(
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => !window.webContents.getURL().includes('view=mini'))
          .isVisible(),
      ),
      true,
    )
    await main.getByRole('button', { name: 'Run demo', exact: true }).click()
    await main.getByRole('button', { name: 'Mini monitor', exact: true }).click()
    await mini.waitForFunction(
      () => document.querySelectorAll('.mini-completed').length === 3,
      undefined,
      { timeout: 15000 },
    )
    await mini.getByRole('status').filter({ hasText: 'Session complete' }).waitFor()
    assert.equal(await mini.locator('.mini-completed').count(), 3)
    mkdirSync('.artifacts', { recursive: true })
    await mini.screenshot({
      path: '.artifacts/mini-native.png',
      animations: 'disabled',
      scale: 'css',
    })
    await mini.locator('.mini-session').filter({ hasText: 'Add authentication middleware' }).click()
    await main
      .locator('.inspector h2')
      .filter({ hasText: 'Add authentication middleware' })
      .waitFor()
    assert.deepEqual(
      await application.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows().find(
          (window) => !window.webContents.getURL().includes('view=mini'),
        )
        const compact = BrowserWindow.getAllWindows().find((window) =>
          window.webContents.getURL().includes('view=mini'),
        )
        return { mainVisible: main.isVisible(), miniVisible: compact.isVisible() }
      }),
      { mainVisible: true, miniVisible: false },
    )

    await main.screenshot({
      path: '.artifacts/desktop-native.png',
      animations: 'disabled',
      scale: 'css',
    })
    assert.deepEqual(errors, [])
  } finally {
    if (application) await application.close()
    rmSync(userData, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
