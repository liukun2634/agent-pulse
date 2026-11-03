import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { expect } from '@playwright/test'
import { _electron as electron } from 'playwright'

test('desktop pinning, mini monitor and session synchronization', { timeout: 90000 }, async () => {
  const userData = mkdtempSync(path.join(tmpdir(), 'pulse-test-'))
  const environment = { ...process.env, PULSE_TEST_MODE: '1', PULSE_TEST_DATA: userData }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.PULSE_DEV_SERVER_URL
  delete environment.PULSE_VSCODE_STORAGE
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

test(
  'live VS Code sessions update both windows without demo mutations',
  { timeout: 90000 },
  async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'pulse-live-test-'))
    const storage = path.join(temporary, 'storage')
    const workspace = path.join(storage, 'workspace-one')
    const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
    mkdirSync(transcripts, { recursive: true })
    const projectPath = path.join(temporary, 'Live project')
    writeFileSync(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(projectPath).href }),
    )
    const filename = path.join(transcripts, 'session-one.jsonl')
    let eventNumber = 0
    const append = (type, data = {}) =>
      appendFileSync(
        filename,
        JSON.stringify({
          id: `event-${++eventNumber}`,
          type,
          data,
          timestamp: new Date().toISOString(),
        }) + '\n',
      )
    append('user.message', { content: 'Monitor current workspace' })
    append('assistant.turn_start')
    const environment = {
      ...process.env,
      PULSE_TEST_MODE: '1',
      PULSE_TEST_DATA: path.join(temporary, 'app'),
      PULSE_VSCODE_STORAGE: storage,
    }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.PULSE_DEV_SERVER_URL
    delete environment.PULSE_VSCODE_SCHEME
    let application

    try {
      application = await electron.launch({
        args: [process.cwd()],
        env: environment,
        timeout: 30000,
      })
      const main = await application.firstWindow()
      const errors = []
      main.on('pageerror', (error) => errors.push(error.message))
      await expect(main.locator('.session-card')).toHaveCount(1)
      await expect(main.locator('.inspector h2')).toHaveText('Monitor current workspace')
      await expect(main.locator('.inspector > .status-badge')).toHaveText('In progress')
      await expect(main.getByRole('button', { name: 'Run demo', exact: true })).toHaveCount(0)
      await expect(main.getByRole('button', { name: 'Reset demo', exact: true })).toBeDisabled()
      assert.equal(await main.evaluate(() => localStorage.getItem('pulse.demo.sessions.v1')), null)
      assert.equal(
        await main.evaluate(async () => {
          try {
            await window.pulse.openVSCode('untrusted-id')
            return false
          } catch {
            return true
          }
        }),
        true,
      )

      await application.evaluate(({ shell }) => {
        shell.openExternal = async (uri) => {
          globalThis.pulseTestOpenedUri = uri
        }
      })
      await main.getByRole('button', { name: 'Open VS Code workspace', exact: true }).click()
      assert.equal(
        await application.evaluate(() => globalThis.pulseTestOpenedUri),
        `vscode://file${pathToFileURL(projectPath).pathname}`,
      )

      const miniPromise = application.waitForEvent('window')
      await main.getByRole('button', { name: 'Mini monitor', exact: true }).click()
      const mini = await miniPromise
      mini.on('pageerror', (error) => errors.push(error.message))
      await expect(mini.locator('.mini-session')).toHaveCount(1)
      append('assistant.message', {
        toolRequests: [{ toolCallId: 'question-one', name: 'vscode_askQuestions' }],
      })
      append('assistant.turn_end')
      append('assistant.turn_start')
      await expect(main.locator('.inspector > .status-badge')).toHaveText('Needs input', {
        timeout: 10000,
      })
      await expect(mini.locator('.mini-session .status-badge')).toHaveText('Needs input')
      await expect(mini.locator('.toast')).toContainText('Input needed in VS Code')
      await expect(main.getByRole('button', { name: 'Approve in demo' })).toHaveCount(0)

      append('tool.execution_complete', { toolCallId: 'question-one', success: true })
      append('assistant.message', { content: 'Reply finished' })
      append('assistant.turn_end')
      await expect(mini.locator('.mini-session .status-badge')).toHaveText('Completed', {
        timeout: 10000,
      })
      await expect(main.locator('.inspector > .status-badge')).toHaveText('Completed')
      await expect(mini.locator('.toast')).toContainText('Assistant reply finished')
      const updatedAt = await main.evaluate(
        async () => (await window.pulse.getSessionFeed()).sessions[0].updatedAt,
      )
      const elapsedBefore = await main
        .locator('.session-facts > div')
        .filter({ hasText: 'Elapsed' })
        .locator('dd')
        .textContent()
      await main.clock.install({ time: updatedAt })
      await main.clock.fastForward(65000)
      await expect(main.locator('.session-card .duration')).toHaveText('Idle 01:05')
      await expect(
        main.locator('.session-facts > div').filter({ hasText: 'Idle' }).locator('dd'),
      ).toHaveText('01:05')
      await expect(
        main.locator('.session-facts > div').filter({ hasText: 'Elapsed' }).locator('dd'),
      ).toHaveText(elapsedBefore)
      await mini.clock.install({ time: updatedAt })
      await mini.clock.fastForward(65000)
      await expect(mini.locator('.mini-session-end')).toContainText('Idle 01:05')
      mkdirSync('.artifacts', { recursive: true })
      await mini.screenshot({
        path: '.artifacts/mini-live.png',
        animations: 'disabled',
        scale: 'css',
      })
      await mini.getByRole('button', { name: 'Open workspace', exact: true }).click()
      await main.screenshot({
        path: '.artifacts/desktop-live.png',
        animations: 'disabled',
        scale: 'css',
      })
      const geometry = await main.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: [...document.querySelectorAll('.button, .session-provider')].some(
          (element) => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1,
        ),
      }))
      assert.deepEqual(geometry, { overflow: false, clipped: false })

      await main.getByRole('button', { name: 'Demo', exact: true }).click()
      await expect(main.locator('.session-card')).toHaveCount(6)
      await expect(mini.locator('.mini-session')).toHaveCount(6)
      await main.getByRole('button', { name: 'VS Code', exact: true }).click()
      await expect(main.locator('.session-card')).toHaveCount(1)
      await expect(mini.locator('.mini-session')).toHaveCount(1)
      assert.equal(
        await main.evaluate(() =>
          JSON.parse(localStorage.getItem('pulse.demo.sessions.v1')).sessions.some(
            (session) => session.source === 'vscode',
          ),
        ),
        false,
      )

      await main.getByRole('button', { name: 'Close session details', exact: true }).click()
      await main.getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(main.locator('.inspector')).toHaveCount(0)

      rmSync(filename)
      await main.getByRole('button', { name: 'Refresh', exact: true }).click()
      await expect(main.locator('.session-card')).toHaveCount(0)
      await expect(main.locator('.source-summary')).toContainText('No Copilot transcripts found.')
      assert.deepEqual(errors, [])
    } finally {
      if (application) await application.close()
      rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  },
)
