import assert from 'node:assert/strict'
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
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
      await main.getByRole('button', { name: 'Open in VS Code', exact: true }).click()
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
      assert.equal((await mini.evaluate(() => window.pulse.getAlerts())).items[0].status, 'waiting')
      await expect(main.getByRole('button', { name: 'Approve in demo' })).toHaveCount(0)

      append('tool.execution_complete', { toolCallId: 'question-one', success: true })
      append('assistant.message', { content: 'Reply finished' })
      append('assistant.turn_end')
      await expect(mini.locator('.mini-session .status-badge')).toHaveText('Rely Ready', {
        timeout: 10000,
      })
      await expect(main.locator('.inspector > .status-badge')).toHaveText('Rely Ready')
      assert.equal(
        (await mini.evaluate(() => window.pulse.getAlerts())).items[0].status,
        'completed',
      )
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

test(
  'top notifications fade without losing alerts and archiving stays separate',
  { timeout: 45000 },
  async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'pulse-alert-test-'))
    const storage = path.join(temporary, 'storage')
    const workspace = path.join(storage, 'workspace-one')
    const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
    const chats = path.join(workspace, 'chatSessions')
    mkdirSync(transcripts, { recursive: true })
    mkdirSync(chats, { recursive: true })
    writeFileSync(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(temporary).href }),
    )
    const timestamp = Date.now()
    writeFileSync(
      path.join(transcripts, 'one.jsonl'),
      JSON.stringify({
        type: 'assistant.turn_start',
        data: {},
        timestamp: new Date(timestamp).toISOString(),
      }) + '\n',
    )
    const chat = path.join(chats, 'one.jsonl')
    writeFileSync(
      chat,
      JSON.stringify({
        kind: 0,
        v: {
          customTitle: 'Finish the monitored task',
          requests: [{ requestId: 'request-one', timestamp, modelState: { value: 0 } }],
        },
      }) + '\n',
    )
    const setState = (state) =>
      appendFileSync(
        chat,
        JSON.stringify({ kind: 1, k: ['requests', 0, 'modelState'], v: state }) + '\n',
      )
    const environment = {
      ...process.env,
      PULSE_TEST_MODE: '1',
      PULSE_TEST_DATA: path.join(temporary, 'app'),
      PULSE_VSCODE_STORAGE: storage,
    }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.PULSE_DEV_SERVER_URL
    let application
    try {
      application = await electron.launch({ args: [process.cwd()], env: environment })
      const main = await application.firstWindow()
      await expect(main.locator('.session-running')).toHaveCount(1)
      await expect(main.locator('.ready-replies')).toHaveCount(0)
      const original = (await main.evaluate(() => window.pulse.getSessionFeed())).sessions[0]
      await main.getByRole('button', { name: 'Archive session', exact: true }).click()
      await expect(main.locator('.session-card')).toHaveCount(0)
      const archived = (await main.evaluate(() => window.pulse.getSessionFeed())).sessions[0]
      assert.equal(archived.status, original.status)
      assert.equal(archived.updatedAt, original.updatedAt)
      assert.ok(archived.archivedAt)
      assert.equal(
        JSON.parse(readFileSync(path.join(temporary, 'app', 'session-management.json'), 'utf8'))
          .archived[original.id],
        archived.archivedAt,
      )
      assert.equal((await main.evaluate(() => window.pulse.getAlerts())).items.length, 0)
      await main.getByRole('combobox', { name: 'Session collection' }).selectOption('archived')
      await main.locator('.session-card').first().click()
      assert.equal(await main.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      mkdirSync('.artifacts', { recursive: true })
      await main.screenshot({ path: '.artifacts/workspace-archived.png', animations: 'disabled', scale: 'css' })
      await main.getByRole('button', { name: 'Restore session', exact: true }).click()
      await expect(main.locator('.session-card')).toHaveCount(0)
      await main.getByRole('combobox', { name: 'Session collection' }).selectOption('active')
      await expect(main.locator('.session-running')).toHaveCount(1)
      await main.getByRole('button', { name: 'Archive session', exact: true }).click()
      await main.evaluate(() => window.pulse.setSystemNotifications(false))
      await application.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0]
        window.hide()
        await window.loadURL('about:blank')
      })

      const popup = application.waitForEvent('window')
      setState({ value: 4 })
      const reminder = await popup
      await expect(reminder.locator('h1')).toHaveText('Input needed in VS Code')
      await reminder.clock.install()
      const geometry = await application.evaluate(({ BrowserWindow, screen }) => {
        const window = BrowserWindow.getAllWindows().find((item) =>
          item.webContents.getURL().includes('view=alerts'),
        )
        const bounds = window.getBounds()
        const area = screen.getDisplayMatching(bounds).workArea
        return {
          top: bounds.y - area.y,
          center: bounds.x + bounds.width / 2 - (area.x + area.width / 2),
          height: bounds.height,
        }
      })
      assert.ok(Math.abs(geometry.top - 16) <= 3)
      assert.ok(Math.abs(geometry.center) <= 3)
      assert.ok(geometry.height <= 120)
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL().includes('view=alerts'))
            .isFocused(),
        ),
        false,
      )
      await reminder.evaluate(() => window.pulse.refreshSessions())
      assert.equal((await reminder.evaluate(() => window.pulse.getAlerts())).items.length, 1)

      setState({ value: 1, completedAt: Date.now() })
      await expect(reminder.locator('h1')).toHaveText('Rely Ready', { timeout: 10000 })
      assert.ok(
        (await reminder.evaluate(() => window.pulse.getSessionFeed())).sessions[0].archivedAt,
      )
      assert.equal((await reminder.evaluate(() => window.pulse.getAlerts())).items.length, 1)
      assert.equal(
        await reminder.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      mkdirSync('.artifacts', { recursive: true })
      await reminder.screenshot({
        path: '.artifacts/top-notification.png',
        animations: 'disabled',
        scale: 'css',
      })
      const previousSequence = (await reminder.evaluate(() => window.pulse.getAlerts())).popup
        .sequence
      await reminder.clock.fastForward(5000)
      await expect(reminder.locator('.alert-window')).toHaveClass(/alert-fading/)
      await reminder.clock.fastForward(400)
      await expect
        .poll(async () =>
          application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((window) => window.webContents.getURL().includes('view=alerts'))
              .isVisible(),
          ),
        )
        .toBe(false)
      assert.equal((await reminder.evaluate(() => window.pulse.getAlerts())).items.length, 1)

      writeFileSync(
        path.join(transcripts, 'two.jsonl'),
        JSON.stringify({
          type: 'assistant.message',
          data: { toolRequests: [{ toolCallId: 'question-two', name: 'vscode_askQuestions' }] },
          timestamp: new Date().toISOString(),
        }) + '\n',
      )
      await expect(reminder.locator('h1')).toHaveText('Input needed in VS Code', { timeout: 10000 })
      assert.equal((await reminder.evaluate(() => window.pulse.getAlerts())).items.length, 2)
      await reminder.evaluate((sequence) => window.pulse.hideAlertPopup(sequence), previousSequence)
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL().includes('view=alerts'))
            .isVisible(),
        ),
        true,
      )
      await reminder.getByRole('button', { name: 'Hide notification', exact: true }).click()
      await expect
        .poll(async () =>
          application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((window) => window.webContents.getURL().includes('view=alerts'))
              .isVisible(),
          ),
        )
        .toBe(false)
      assert.equal((await reminder.evaluate(() => window.pulse.getAlerts())).items.length, 2)
      await reminder.evaluate(() => window.pulse.showAlerts())
      await expect(reminder.locator('.alert-more')).toHaveText('+1 more')
      const currentAlerts = (await reminder.evaluate(() => window.pulse.getAlerts())).items
      await reminder.evaluate((id) => window.pulse.dismissAlert(id), currentAlerts[0].id)
      appendFileSync(path.join(transcripts, 'two.jsonl'), JSON.stringify({ type: 'tool.execution_complete', data: { toolCallId: 'question-two', success: true }, timestamp: new Date().toISOString() }) + '\n')
      await expect.poll(async () => (await reminder.evaluate(() => window.pulse.getAlerts())).items.length).toBe(0)
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().includes('view=alerts')).isVisible()), false)
    } finally {
      if (application) await application.close()
      rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  },
)
