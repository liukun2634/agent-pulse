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

test(
  'source paths can be selected, checked and restored on restart',
  { timeout: 45000 },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'pulse-source-settings-'))
    const storage = path.join(root, 'storage')
    mkdirSync(storage)
    const environment = {
      ...process.env,
      PULSE_TEST_MODE: '1',
      PULSE_TEST_DATA: path.join(root, 'app'),
    }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.PULSE_DEV_SERVER_URL
    delete environment.PULSE_VSCODE_STORAGE
    let application
    try {
      application = await electron.launch({ args: [process.cwd()], env: environment })
      let main = await application.firstWindow()
      await main.getByRole('button', { name: 'Display settings', exact: true }).click()
      await application.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
      }, storage)
      await main.getByRole('button', { name: 'Browse VS Code storage', exact: true }).click()
      await expect(
        main.getByRole('textbox', { name: 'VS Code workspace storage', exact: true }),
      ).toHaveValue(storage)
      await main.getByRole('button', { name: 'Test connections', exact: true }).click()
      await expect(main.locator('.source-settings')).toContainText('vscode: empty')
      await main.getByRole('button', { name: 'Save paths', exact: true }).click()
      await expect(main.locator('.source-settings')).toContainText('Restart Pulse')
      const saved = await main.evaluate(() => window.pulse.getDesktopSettings())
      assert.equal(saved.sources.vscodeStorage, storage)
      assert.notEqual(saved.activeSources.vscodeStorage, storage)
      await application.evaluate(({ clipboard }) => {
        clipboard.writeText = (value) => {
          globalThis.testHookConfiguration = value
        }
      })
      await main.getByRole('switch', { name: 'Claude local hooks', exact: true }).click()
      await main
        .getByRole('button', { name: 'Copy Claude hook configuration', exact: true })
        .click()
      const configuration = await application.evaluate(() =>
        JSON.parse(globalThis.testHookConfiguration),
      )
      const handler = configuration.hooks.UserPromptSubmit[0].hooks[0]
      for (const hook_event_name of ['UserPromptSubmit', 'Stop']) {
        const response = await fetch(handler.url, {
          method: 'POST',
          headers: handler.headers,
          body: JSON.stringify({
            session_id: 'native-hook',
            prompt_id: 'native-round',
            cwd: root,
            hook_event_name,
          }),
        })
        assert.equal(response.status, 204)
      }
      await main.evaluate(() => window.pulse.refreshSessions())
      await expect
        .poll(() =>
          main.evaluate(async () =>
            (await window.pulse.getAlerts()).items.some(
              (alert) => alert.requestId === 'prompt:native-round',
            ),
          ),
        )
        .toBe(true)
      for (const hook_event_name of ['UserPromptSubmit', 'Stop']) {
        await fetch(handler.url, {
          method: 'POST',
          headers: handler.headers,
          body: JSON.stringify({
            session_id: 'native-second',
            prompt_id: 'second-round',
            cwd: root,
            hook_event_name,
          }),
        })
      }
      await main.evaluate(() => window.pulse.refreshSessions())
      const replies = (await main.evaluate(() => window.pulse.getAlerts())).items
      const checked = await main.evaluate((paths) => window.pulse.checkSources(paths), saved.sources)
      assert.equal(checked.find((source) => source.id === 'claude').count, 0)
      await main.getByRole('button', { name: 'Done', exact: true }).click()
      const opened = application.waitForEvent('window')
      await main.getByRole('button', { name: 'Mini monitor', exact: true }).click()
      const mini = await opened
      await expect(mini.locator('.mini-session')).toHaveCount(6)
      await Promise.all([
        main.evaluate((reference) => window.pulse.markRead(reference), replies[0].reference),
        mini.evaluate((reference) => window.pulse.markRead(reference), replies[1].reference),
      ])
      assert.equal(
        Object.keys((await main.evaluate(() => window.pulse.getDesktopSettings())).seenReplies)
          .length,
        2,
      )
      await mini.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
      await mini.getByRole('button', { name: 'Unpin window', exact: true }).click()
      await application.close()
      application = await electron.launch({ args: [process.cwd()], env: environment })
      main = await application.firstWindow()
      await expect(main.locator('.session-card')).toHaveCount(6)
      assert.equal(
        (await main.evaluate(() => window.pulse.getDesktopSettings())).activeSources.vscodeStorage,
        storage,
      )
      assert.equal(
        (await main.evaluate(() => window.pulse.getDesktopSettings())).hooks.listening,
        true,
      )
      await expect
        .poll(() =>
          application.evaluate(({ BrowserWindow }) => {
            const compact = BrowserWindow.getAllWindows().find((window) =>
              window.webContents.getURL().includes('view=mini'),
            )
            return compact
              ? {
                  visible: compact.isVisible(),
                  pinned: compact.isAlwaysOnTop(),
                  collapsed: compact.getBounds().width < 100,
                }
              : null
          }),
        )
        .toEqual({ visible: true, pinned: false, collapsed: true })
      assert.equal(
        Object.keys((await main.evaluate(() => window.pulse.getDesktopSettings())).seenReplies)
          .length,
        2,
      )
    } finally {
      if (application) await application.close()
      rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  },
)

test(
  'Claude recovery is silent, preserves historical reminders and does not revive ignored input',
  { timeout: 60000 },
  async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'pulse-claude-recovery-'))
    const storage = path.join(temporary, 'storage')
    const workspace = path.join(storage, 'workspace-one')
    const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
    const fixture = path.join(temporary, 'claude.json')
    mkdirSync(transcripts, { recursive: true })
    writeFileSync(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(temporary).href }),
    )
    writeFileSync(
      path.join(transcripts, 'healthy.jsonl'),
      JSON.stringify({
        type: 'user.message',
        timestamp: new Date().toISOString(),
        data: { content: 'Healthy Copilot' },
      }) + '\n',
    )
    writeFileSync(fixture, 'invalid')
    const environment = {
      ...process.env,
      PULSE_TEST_MODE: '1',
      PULSE_TEST_DATA: path.join(temporary, 'app'),
      PULSE_VSCODE_STORAGE: storage,
      PULSE_TEST_CLAUDE: fixture,
    }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.PULSE_DEV_SERVER_URL
    let application
    let main
    const setStatus = async (status) => {
      writeFileSync(
        fixture,
        JSON.stringify([
          {
            kind: 'interactive',
            sessionId: 'recovery-session',
            cwd: temporary,
            name: 'Recovery sample',
            startedAt: 1000,
            status,
          },
        ]),
      )
      await main.evaluate(() => window.pulse.refreshSessions())
      await expect
        .poll(() =>
          main.evaluate(
            async () =>
              (await window.pulse.getSessionFeed()).sessions.find(
                (session) => session.source === 'claude',
              )?.status,
          ),
        )
        .toBe(status === 'busy' ? 'running' : status)
    }
    try {
      application = await electron.launch({ args: [process.cwd()], env: environment })
      main = await application.firstWindow()
      await expect(main.locator('.source-summary')).toContainText('Could not query Claude')
      await expect(main.locator('.session-running')).toHaveCount(1)
      await setStatus('waiting')
      const initial = await main.evaluate(() => window.pulse.getAlerts())
      assert.equal(initial.items.length, 1)
      assert.equal(initial.items[0].initial, true)
      assert.deepEqual(initial.popup.ids, [])
      const old = initial.items[0]
      await application.close()
      application = await electron.launch({ args: [process.cwd()], env: environment })
      main = await application.firstWindow()
      await expect(main.locator('.session-waiting')).toHaveCount(1)
      const restored = await main.evaluate(() => window.pulse.getAlerts())
      assert.equal(restored.items.length, 1)
      assert.equal(restored.items[0].id, old.id)
      assert.equal(restored.items[0].recovered, true)
      assert.deepEqual(restored.popup.ids, [])
      const stale = await main.evaluate(
        (alert) =>
          window.pulse.openSession(alert.sessionId, { ...alert.reference, alertId: alert.id }),
        old,
      )
      assert.equal(stale.mode, 'stale')
      await main.getByRole('button', { name: 'Notifications', exact: true }).click()
      await expect(main.getByRole('dialog')).toContainText('Original request not verified')
      await main.getByRole('button', { name: /^View current session:/ }).click()
      await expect(main.locator('.inspector h2')).toHaveText('Recovery sample')
      await expect(main.getByRole('dialog')).not.toBeVisible()
      assert.equal((await main.evaluate(() => window.pulse.getAlerts())).items.length, 1)
      await main.getByRole('button', { name: 'Notifications', exact: true }).click()
      await main
        .getByRole('button', { name: 'Ignore reminder: Recovery sample', exact: true })
        .click()
      await expect(main.getByText('No pending reminders', { exact: true })).toBeVisible()
      await application.close()
      application = await electron.launch({ args: [process.cwd()], env: environment })
      main = await application.firstWindow()
      await expect(main.locator('.session-waiting')).toHaveCount(1)
      assert.equal((await main.evaluate(() => window.pulse.getAlerts())).items.length, 0)
      await setStatus('busy')
      await setStatus('waiting')
      const fresh = await main.evaluate(() => window.pulse.getAlerts())
      assert.equal(fresh.items.length, 1)
      assert.equal(fresh.items[0].initial, false)
      assert.equal(fresh.items[0].recovered, undefined)
      assert.deepEqual(fresh.popup.ids, [fresh.items[0].id])
      writeFileSync(fixture, 'invalid')
      await main.evaluate(() => window.pulse.refreshSessions())
      appendFileSync(
        path.join(transcripts, 'healthy.jsonl'),
        JSON.stringify({
          type: 'assistant.message',
          timestamp: new Date().toISOString(),
          data: {
            toolRequests: [{ toolCallId: 'independent-input', name: 'vscode_askQuestions' }],
          },
        }) + '\n',
      )
      await main.evaluate(() => window.pulse.refreshSessions())
      const independent = await main.evaluate(() => window.pulse.getAlerts())
      const copilotAlert = independent.items.find((alert) => alert.sessionId.startsWith('vscode:'))
      assert.equal(copilotAlert.initial, false)
      assert.ok(independent.popup.ids.includes(copilotAlert.id))
      await main.evaluate((id) => window.pulse.dismissAlert(id), copilotAlert.id)
      await setStatus('waiting')
      const reconnected = await main.evaluate(() => window.pulse.getAlerts())
      assert.equal(reconnected.items[0].recovered, true)
      assert.equal(reconnected.popup.sequence, independent.popup.sequence)
      await application.evaluate(({ powerMonitor }) => {
        powerMonitor.emit('suspend')
        powerMonitor.emit('resume')
      })
      await main.evaluate(() => window.pulse.refreshSessions())
      assert.equal(
        (await main.evaluate(() => window.pulse.getAlerts())).popup.sequence,
        independent.popup.sequence,
      )
    } finally {
      if (application) await application.close()
      rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  },
)

test(
  'Live combines Claude and VS Code while Demo stays independent',
  { timeout: 60000 },
  async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'pulse-claude-test-'))
    const storage = path.join(temporary, 'storage')
    const workspace = path.join(storage, 'workspace-one')
    const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
    const fixture = path.join(temporary, 'claude.json')
    const transcript = path.join(transcripts, 'copilot-one.jsonl')
    mkdirSync(transcripts, { recursive: true })
    writeFileSync(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(path.join(temporary, 'project-vscode')).href }),
    )
    writeFileSync(
      transcript,
      JSON.stringify({
        type: 'user.message',
        timestamp: new Date().toISOString(),
        data: { content: 'Copilot sample' },
      }) + '\n',
    )
    const rows = [
      {
        kind: 'interactive',
        sessionId: 'claude-idle',
        cwd: path.join(temporary, 'project-claude'),
        name: 'Claude idle sample',
        startedAt: Date.now() - 600000,
        status: 'idle',
      },
      {
        kind: 'interactive',
        sessionId: 'claude-busy',
        cwd: path.join(temporary, 'project-claude'),
        name: 'Claude busy sample',
        startedAt: Date.now() - 600000,
        status: 'busy',
      },
    ]
    writeFileSync(fixture, JSON.stringify(rows))
    const environment = {
      ...process.env,
      PULSE_TEST_MODE: '1',
      PULSE_TEST_DATA: path.join(temporary, 'data'),
      PULSE_VSCODE_STORAGE: storage,
      PULSE_TEST_CLAUDE: fixture,
    }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.PULSE_DEV_SERVER_URL
    let application
    try {
      application = await electron.launch({ args: [process.cwd()], env: environment })
      const main = await application.firstWindow()
      const errors = []
      main.on('pageerror', (error) => errors.push(error.message))
      await expect(main.locator('.session-card')).toHaveCount(3)
      await expect(
        main
          .locator('.session-card')
          .filter({ hasText: 'Copilot sample' })
          .locator('.session-entry'),
      ).toHaveText('Entry: VS Code')
      await expect(
        main
          .locator('.session-card')
          .filter({ hasText: 'Claude busy sample' })
          .locator('.session-entry'),
      ).toHaveText('Entry: Not identified')
      await expect(main.getByRole('button', { name: 'Live', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(main.locator('.source-switch button')).toHaveCount(2)
      assert.equal(
        await main.evaluate(async () => (await window.pulse.getSessionFeed()).source),
        'live',
      )
      await main.getByRole('combobox', { name: 'Agent filter' }).selectOption('claude')
      await expect(main.locator('.session-card')).toHaveCount(2)
      await expect(main.locator('.session-idle .duration')).toHaveText('Idle')
      await expect(main.locator('.session-running .duration')).toHaveText(/^\d+:\d{2}$/)
      const duration = await main.locator('.session-running .duration').textContent()
      await expect
        .poll(() => main.locator('.session-running .duration').textContent())
        .not.toBe(duration)
      assert.equal(
        await main.evaluate(
          async () =>
            (await window.pulse.getSessionFeed()).sessions.filter(
              (item) => item.status === 'running',
            ).length,
        ),
        2,
      )
      await main.getByRole('combobox', { name: 'Agent filter' }).selectOption('copilot')
      await expect(main.locator('.session-card')).toHaveCount(1)
      await main.getByRole('combobox', { name: 'Agent filter' }).selectOption('all')
      await expect(main.locator('.session-card')).toHaveCount(3)
      await main.locator('.session-card').filter({ hasText: 'Claude busy sample' }).click()
      await expect(
        main.getByRole('button', { name: 'Open original window', exact: true }),
      ).toHaveCount(0)
      mkdirSync('.artifacts', { recursive: true })
      for (const width of [1440, 390]) {
        await main.setViewportSize({ width, height: 980 })
        assert.equal(
          await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          true,
        )
        assert.equal(
          await main.evaluate(() => {
            const heading = document.querySelector('.page-heading').getBoundingClientRect()
            const actions = document.querySelector('.heading-actions').getBoundingClientRect()
            return actions.left >= heading.left - 1 && actions.right <= heading.right + 1
          }),
          true,
        )
        await main.screenshot({
          path: `.artifacts/combined-workspace-${width}.png`,
          animations: 'disabled',
        })
      }
      await main.setViewportSize({ width: 1440, height: 980 })
      const opened = application.waitForEvent('window')
      await main.getByRole('button', { name: 'Mini monitor', exact: true }).click()
      const mini = await opened
      await expect(mini.locator('.mini-session')).toHaveCount(3)
      await expect(mini.locator('.mini-idle .mini-session-end')).toHaveText('Idle')
      const claudeMini = mini.locator('.mini-session').filter({ hasText: 'Claude busy sample' })
      await expect(claudeMini.locator('.mini-session-end')).not.toContainText('Idle')
      await mini.screenshot({
        path: '.artifacts/combined-mini.png',
        animations: 'disabled',
        scale: 'css',
      })
      await claudeMini.click()
      await expect(main.locator('.inspector h2')).toHaveText('Claude busy sample')
      await expect(
        main.getByRole('button', { name: 'Open original window', exact: true }),
      ).toHaveCount(0)
      await main.getByRole('button', { name: 'Demo', exact: true }).click()
      await expect(main.locator('.session-card')).toHaveCount(6)
      await main.getByRole('button', { name: 'Display settings', exact: true }).click()
      const connections = main.getByRole('region', { name: 'Source connections' })
      await expect(connections.locator('.source-connection')).toHaveCount(2)
      await expect(connections).toContainText('File events + 2s fallback')
      await expect(connections).toContainText('CLI snapshots every 2s')
      await expect(connections).not.toContainText('Companion')
      await expect(connections).not.toContainText('Navigation')
      await main.setViewportSize({ width: 390, height: 900 })
      assert.equal(
        await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      )
      await main.screenshot({
        path: '.artifacts/source-connections-mobile.png',
        animations: 'disabled',
      })
      await main.setViewportSize({ width: 1440, height: 980 })
      await main.screenshot({ path: '.artifacts/source-connections.png', animations: 'disabled' })
      await main.getByRole('button', { name: 'Done', exact: true }).click()
      rows[0].status = 'waiting'
      writeFileSync(fixture, JSON.stringify(rows))
      appendFileSync(
        transcript,
        JSON.stringify({
          type: 'assistant.message',
          timestamp: new Date().toISOString(),
          data: { toolRequests: [{ toolCallId: 'question', name: 'vscode_askQuestions' }] },
        }) + '\n',
      )
      await main.evaluate(() => window.pulse.refreshSessions())
      await expect
        .poll(() => main.evaluate(async () => (await window.pulse.getAlerts()).items.length))
        .toBe(2)
      assert.equal(
        await main.evaluate(async () => (await window.pulse.getSessionFeed()).source),
        'demo',
      )
      await expect(main.locator('.session-card')).toHaveCount(6)
      const alerts = await main.evaluate(() => window.pulse.getAlerts())
      assert.ok(alerts.items.some((item) => item.title === 'Input needed in Claude Code'))
      assert.ok(alerts.items.some((item) => item.title === 'Input needed in VS Code'))
      const claudeId = alerts.items.find((item) => item.sessionId.startsWith('claude:')).sessionId
      const windowsBefore = application.windows().length
      const result = await main.evaluate((id) => window.pulse.openSession(id), claudeId)
      assert.equal(result.mode, 'pulse-details')
      await expect(main.locator('.inspector h2')).toHaveText('Claude idle sample')
      await expect(main.getByRole('button', { name: 'Live', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      assert.equal(application.windows().length, windowsBefore)
      assert.equal((await main.evaluate(() => window.pulse.getAlerts())).items.length, 2)
      await main.getByRole('button', { name: 'Live', exact: true }).click()
      await expect(main.locator('.session-card')).toHaveCount(3)
      await expect(main.locator('.session-waiting')).toHaveCount(2)
      assert.equal(
        await main.evaluate(() =>
          JSON.parse(localStorage.getItem('pulse.demo.sessions.v1')).sessions.some(
            (item) => item.source,
          ),
        ),
        false,
      )
      await main.evaluate((id) => window.pulse.setSessionArchived(id, true), claudeId)
      await expect(main.locator('.session-card')).toHaveCount(2)
      await main.getByRole('combobox', { name: 'Agent filter' }).selectOption('copilot')
      await expect(main.locator('.session-card')).toHaveCount(1)
      assert.equal((await main.evaluate(() => window.pulse.getAlerts())).items.length, 2)
      writeFileSync(fixture, 'invalid')
      await main.evaluate(() => window.pulse.refreshSessions())
      await expect(main.locator('.source-summary')).toContainText('Claude Code: Could not query')
      await expect(main.locator('.session-card')).toHaveCount(1)
      await expect(main.locator('.session-card')).toContainText('Copilot sample')
      assert.deepEqual(errors, [])
    } finally {
      await application?.close()
      rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  },
)

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
        mainMinimized: main.isMinimized(),
        width: bounds.width,
        rightGap: area.x + area.width - bounds.x - bounds.width,
      }
    })
    assert.equal(docked.mainVisible, false)
    assert.equal(docked.mainMinimized, false)
    assert.ok(Math.abs(docked.width - 360) <= 5, `Unexpected sidebar width: ${docked.width}`)
    assert.ok(Math.abs(docked.rightGap - 12) <= 2, `Unexpected edge gap: ${docked.rightGap}`)
    await application.evaluate(({ BrowserWindow }) => {
      const workspace = BrowserWindow.getAllWindows().find(
        (window) => !window.webContents.getURL().includes('view=mini'),
      )
      globalThis.mainReveals = 0
      workspace.on('show', () => globalThis.mainReveals++)
    })
    await mini.getByRole('button', { name: 'Minimize mini monitor', exact: true }).click()
    await expect
      .poll(() =>
        application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL().includes('view=mini'))
            .isMinimized(),
        ),
      )
      .toBe(true)
    assert.equal(await application.evaluate(() => globalThis.mainReveals), 0)
    await application.evaluate(async ({ BrowserWindow }) => {
      const compact = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('view=mini'),
      )
      await new Promise((resolve) => {
        compact.once('restore', resolve)
        compact.restore()
      })
    })
    await mini.waitForFunction(() => document.visibilityState === 'visible')
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
    const savedPosition = await application.evaluate(({ BrowserWindow, screen }) => {
      const compact = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().includes('view=mini'),
      )
      const area = screen.getDisplayMatching(compact.getBounds()).workArea
      compact.setPosition(area.x + 120, area.y + 140, false)
      return compact.getPosition()
    })
    for (const event of ['activate', 'second-instance']) {
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('view=mini'))
          .hide(),
      )
      await expect
        .poll(() =>
          application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((window) => window.webContents.getURL().includes('view=mini'))
              .isVisible(),
          ),
        )
        .toBe(false)
      await application.evaluate(({ app }, name) => app.emit(name), event)
      await expect
        .poll(() =>
          application.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()
              .find((window) => window.webContents.getURL().includes('view=mini'))
              .isVisible(),
          ),
        )
        .toBe(true)
      await expect(mini.locator('.mini-rail')).toBeVisible()
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => !window.webContents.getURL().includes('view=mini'))
            .isVisible(),
        ),
        false,
      )
      const restored = await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => window.webContents.getURL().includes('view=mini'))
          .getPosition(),
      )
      assert.ok(Math.abs(restored[0] - savedPosition[0]) <= 2)
      assert.ok(Math.abs(restored[1] - savedPosition[1]) <= 2)
    }
    assert.equal(await application.evaluate(() => globalThis.mainReveals), 0)
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
    const minimizeWorkspace = async () => {
      await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((window) => !window.webContents.getURL().includes('view=mini'))
          .minimize(),
      )
      await expect
        .poll(() =>
          application.evaluate(({ BrowserWindow }) => {
            const workspace = BrowserWindow.getAllWindows().find(
              (window) => !window.webContents.getURL().includes('view=mini'),
            )
            const compact = BrowserWindow.getAllWindows().find((window) =>
              window.webContents.getURL().includes('view=mini'),
            )
            return { workspaceMinimized: workspace.isMinimized(), miniVisible: compact.isVisible() }
          }),
        )
        .toEqual({ workspaceMinimized: true, miniVisible: false })
    }
    await minimizeWorkspace()
    await application.evaluate(({ app }) => app.emit('activate'))
    await main.waitForFunction(() => document.visibilityState === 'visible')
    await main.getByRole('button', { name: 'Mini monitor', exact: true }).click()
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
    await minimizeWorkspace()
    await application.evaluate(({ app }) => app.emit('second-instance'))
    await main.waitForFunction(() => document.visibilityState === 'visible')
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

    await application.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => !window.webContents.getURL().includes('view=mini'))
        .hide()
      app.emit('activate')
    })
    await main.waitForFunction(() => document.visibilityState === 'visible')
    await expect(mini.locator('.mini-window')).not.toBeVisible()
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
  'P0 local details preserve reminders and reject stale request references',
  { timeout: 45000 },
  async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'pulse-p0-'))
    const storage = path.join(temporary, 'storage')
    const workspace = path.join(storage, 'workspace-one')
    const project = path.join(temporary, 'Project')
    const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
    const chats = path.join(workspace, 'chatSessions')
    mkdirSync(transcripts, { recursive: true })
    mkdirSync(chats, { recursive: true })
    mkdirSync(project)
    writeFileSync(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(project).href }),
    )
    const timestamp = Date.now()
    for (const id of ['one', 'two']) {
      writeFileSync(
        path.join(transcripts, `${id}.jsonl`),
        JSON.stringify({
          type: 'assistant.turn_start',
          data: {},
          timestamp: new Date(timestamp).toISOString(),
        }) + '\n',
      )
      writeFileSync(
        path.join(chats, `${id}.jsonl`),
        JSON.stringify({
          kind: 0,
          v: {
            customTitle: `Task ${id}`,
            requests: [{ requestId: `request-${id}`, timestamp, modelState: { value: 4 } }],
          },
        }) + '\n',
      )
    }
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
      let main = await application.firstWindow()
      await expect(main.locator('.session-waiting')).toHaveCount(2)
      const initial = await main.evaluate(() => window.pulse.getAlerts())
      assert.equal(initial.items.length, 2)
      assert.ok(initial.items.every((item) => item.initial))
      assert.equal(application.windows().length, 1)
      await application.evaluate(({ shell }) => {
        globalThis.pulseExternalCalls = []
        shell.openExternal = async (uri) => {
          globalThis.pulseExternalCalls.push(uri)
        }
      })
      await main.getByRole('button', { name: 'Notifications', exact: true }).click()
      await expect(main.locator('.pending-alert-row')).toHaveCount(2)
      mkdirSync('.artifacts', { recursive: true })
      await main.screenshot({
        path: '.artifacts/p0-inbox.png',
        animations: 'disabled',
        scale: 'css',
      })
      await main.getByRole('button', { name: 'Ignore reminder: Task two', exact: true }).click()
      await expect(main.locator('.pending-alert-row')).toHaveCount(1)
      assert.equal(
        (await main.evaluate(() => window.pulse.getSessionFeed())).sessions.find(
          (item) => item.task === 'Task two',
        ).status,
        'waiting',
      )
      await main.locator('.pending-alert-row .notification-item').click()
      await expect(main.locator('.pending-alert-error')).toHaveText([])
      await expect(main.getByRole('dialog')).not.toBeVisible()
      await expect(main.locator('.inspector h2')).toHaveText('Task one')
      assert.equal((await main.evaluate(() => window.pulse.getAlerts())).items.length, 1)
      assert.equal(
        JSON.parse(readFileSync(path.join(temporary, 'app', 'reminder-history.json'), 'utf8')).items
          .length,
        1,
      )
      assert.deepEqual(await application.evaluate(() => globalThis.pulseExternalCalls), [])

      await application.close()
      application = await electron.launch({ args: [process.cwd()], env: environment })
      main = await application.firstWindow()
      await expect(main.locator('.session-waiting')).toHaveCount(2)
      const restored = await main.evaluate(() => window.pulse.getAlerts())
      assert.equal(restored.items.length, 1)
      assert.equal(restored.items[0].task, 'Task one')
      assert.equal(restored.storageWarning, null)
      assert.equal(application.windows().length, 1)
      await application.evaluate(({ shell }) => {
        globalThis.pulseExternalCalls = []
        shell.openExternal = async (uri) => {
          globalThis.pulseExternalCalls.push(uri)
        }
      })
      await main.getByRole('button', { name: 'Notifications', exact: true }).click()
      await expect(main.locator('.pending-alert-row')).toHaveCount(1)

      const old = initial.items.find((item) => item.task === 'Task one')
      await main.locator('.pending-alert-row .notification-item').click()
      await expect(main.getByRole('dialog')).not.toBeVisible()
      const completedAt = Date.now()
      appendFileSync(
        path.join(chats, 'one.jsonl'),
        JSON.stringify({
          kind: 2,
          k: ['requests'],
          v: [
            {
              requestId: 'new-turn',
              timestamp: completedAt,
              modelState: { value: 1, completedAt },
            },
          ],
        }) + '\n',
      )
      await expect
        .poll(async () => (await main.evaluate(() => window.pulse.getAlerts())).items[0]?.requestId)
        .toBe('new-turn')
      assert.equal(
        (await main.evaluate(() => window.pulse.getAlerts())).items[0].requestId,
        'new-turn',
      )
      const stale = await main.evaluate(
        (alert) =>
          window.pulse.openSession(alert.sessionId, { ...alert.reference, alertId: alert.id }),
        old,
      )
      assert.equal(stale.mode, 'stale')
      await main.getByRole('button', { name: 'Notifications', exact: true }).click()
      await main.locator('.pending-alert-row .notification-item').click()
      await expect(main.getByRole('dialog')).not.toBeVisible()
      assert.equal(
        (await main.evaluate(() => window.pulse.getAlerts())).items[0].requestId,
        'new-turn',
      )
      const seen = await main.evaluate(() =>
        JSON.parse(localStorage.getItem('pulse.seen-replies.v1')),
      )
      assert.deepEqual(seen, {})
      await main.getByRole('button', { name: 'Mark reply as read', exact: true }).click()
      await expect(
        main.getByRole('button', { name: 'Reply marked as read', exact: true }),
      ).toBeDisabled()
      assert.equal(
        (await main.evaluate(() => window.pulse.getAlerts())).items[0].requestId,
        'new-turn',
      )
      assert.deepEqual(await application.evaluate(() => globalThis.pulseExternalCalls), [])
    } finally {
      if (application) await application.close()
      rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  },
)

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
            await window.pulse.openSession('untrusted-id')
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
      await expect(main.getByRole('button', { name: 'Open in VS Code', exact: true })).toHaveCount(
        0,
      )
      const details = await main.evaluate(async () => {
        const feed = await window.pulse.getSessionFeed()
        return window.pulse.openSession(feed.sessions[0].id)
      })
      assert.equal(details.mode, 'pulse-details')
      assert.equal(await application.evaluate(() => globalThis.pulseTestOpenedUri), undefined)

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
        main.locator('.session-facts > div').filter({ hasText: 'Last activity' }).locator('dd'),
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
      await main.getByRole('button', { name: 'Live', exact: true }).click()
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
      await expect(main.locator('.source-summary')).toContainText('VS Code: No sessions')
      await expect(main.locator('.source-summary')).toContainText('Claude Code: No sessions')
      assert.deepEqual(errors, [])
    } finally {
      if (application) await application.close()
      rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  },
)

test(
  'popup duration preferences persist and manual popups remain until closed',
  { timeout: 45000 },
  async () => {
    const temporary = mkdtempSync(path.join(tmpdir(), 'pulse-popup-settings-'))
    const data = path.join(temporary, 'data')
    const fixture = path.join(temporary, 'claude.json')
    mkdirSync(data)
    writeFileSync(
      path.join(data, 'notification-settings.json'),
      JSON.stringify({ version: 2, systemNotifications: false }),
    )
    const sample = {
      kind: 'interactive',
      sessionId: 'popup-setting-session',
      cwd: temporary,
      name: 'Popup settings sample',
      startedAt: Date.now(),
      status: 'busy',
    }
    writeFileSync(fixture, JSON.stringify([sample]))
    const environment = {
      ...process.env,
      PULSE_TEST_MODE: '1',
      PULSE_TEST_DATA: data,
      PULSE_TEST_CLAUDE: fixture,
    }
    delete environment.ELECTRON_RUN_AS_NODE
    delete environment.PULSE_DEV_SERVER_URL
    delete environment.PULSE_VSCODE_STORAGE
    let application
    const popupVisible = () =>
      application.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL().includes('view=alerts'))
            ?.isVisible() ?? false,
      )
    try {
      application = await electron.launch({ args: [process.cwd()], env: environment })
      let main = await application.firstWindow()
      await expect(main.locator('.session-card')).toHaveCount(6)
      await main.getByRole('button', { name: 'Display settings', exact: true }).click()
      const setting = main.getByRole('combobox', { name: 'Popup duration' })
      await expect(setting).toHaveValue('5000')
      await setting.selectOption('0')
      await expect
        .poll(() => main.evaluate(async () => (await window.pulse.getAlerts()).popupDurationMs))
        .toBe(0)
      await main.evaluate(() => window.pulse.setSystemNotifications(true))
      assert.equal((await main.evaluate(() => window.pulse.getAlerts())).popupDurationMs, 0)
      await main.getByRole('button', { name: 'Done', exact: true }).click()
      await main.evaluate(() => window.pulse.refreshSessions())
      const opened = application.waitForEvent('window')
      writeFileSync(fixture, JSON.stringify([{ ...sample, status: 'waiting' }]))
      await main.evaluate(() => window.pulse.refreshSessions())
      let popup = await opened
      await expect(popup.locator('h1')).toHaveText('Input needed in Claude Code')
      await popup.clock.install()
      await popup.clock.pauseAt(new Date((await popup.evaluate(() => Date.now())) + 1))
      await popup.clock.fastForward(60000)
      await expect(popup.locator('.alert-window')).not.toHaveClass(/alert-fading/)
      assert.equal(await popupVisible(), true)
      await popup.getByRole('button', { name: 'Hide notification', exact: true }).click()
      await popup.clock.runFor(1100)
      await expect.poll(popupVisible).toBe(false)
      assert.equal((await main.evaluate(() => window.pulse.getAlerts())).items.length, 1)
      await main.getByRole('button', { name: 'Display settings', exact: true }).click()
      await setting.selectOption('10000')
      await expect
        .poll(() => main.evaluate(async () => (await window.pulse.getAlerts()).popupDurationMs))
        .toBe(10000)
      assert.equal(await popupVisible(), false)
      const saved = JSON.parse(readFileSync(path.join(data, 'notification-settings.json'), 'utf8'))
      assert.equal(saved.popupDurationMs, 10000)
      assert.equal(saved.systemNotifications, true)
      assert.equal(
        await main.evaluate(async () => {
          try {
            await window.pulse.setPopupDuration(1234)
            return false
          } catch {
            return true
          }
        }),
        true,
      )
      mkdirSync('.artifacts', { recursive: true })
      for (const width of [1440, 390]) {
        await main.setViewportSize({ width, height: 900 })
        const bounds = await setting.boundingBox()
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
        await main.screenshot({
          path: `.artifacts/popup-settings-${width}.png`,
          animations: 'disabled',
        })
      }
      await application.close()
      application = await electron.launch({ args: [process.cwd()], env: environment })
      main = await application.firstWindow()
      await main.waitForFunction(() => !!window.pulse)
      const restored = await main.evaluate(() => window.pulse.getAlerts())
      assert.equal(restored.popupDurationMs, 10000)
      assert.equal(restored.systemNotifications, true)
      const reopened = application.waitForEvent('window')
      await main.evaluate(() => window.pulse.showAlerts())
      popup = await reopened
      await expect(popup.locator('h1')).toHaveText('Input needed in Claude Code')
      await popup.clock.install()
      await popup.clock.pauseAt(new Date((await popup.evaluate(() => Date.now())) + 1))
      await popup.evaluate(() => window.pulse.showAlerts())
      const sequence = (await popup.evaluate(() => window.pulse.getAlerts())).popup.sequence
      await expect(popup.locator('.alert-window')).toHaveAttribute(
        'data-popup-sequence',
        String(sequence),
      )
      await popup.mouse.move(-20, -20)
      await popup.clock.fastForward(9000)
      await expect(popup.locator('.alert-window')).not.toHaveClass(/alert-fading/)
      await popup.clock.fastForward(1100)
      await expect(popup.locator('.alert-window')).toHaveClass(/alert-fading/)
      await popup.clock.runFor(1100)
      await expect.poll(popupVisible).toBe(false)
    } finally {
      await application?.close()
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
      assert.equal(
        await main.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      mkdirSync('.artifacts', { recursive: true })
      await main.screenshot({
        path: '.artifacts/workspace-archived.png',
        animations: 'disabled',
        scale: 'css',
      })
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
      assert.deepEqual(
        await reminder.evaluate(() =>
          [document.documentElement, document.body, document.getElementById('root')].map(
            (element) => getComputedStyle(element).backgroundColor,
          ),
        ),
        ['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)'],
      )
      assert.equal(
        await reminder
          .locator('.alert-window')
          .evaluate((element) => getComputedStyle(element).transform),
        'none',
      )
      mkdirSync('.artifacts', { recursive: true })
      await reminder.screenshot({
        path: '.artifacts/top-notification.png',
        animations: 'disabled',
        scale: 'css',
      })
      await reminder.clock.pauseAt(new Date((await reminder.evaluate(() => Date.now())) + 1))
      await reminder.evaluate(() => window.pulse.showAlerts())
      const previousSequence = (await reminder.evaluate(() => window.pulse.getAlerts())).popup
        .sequence
      await expect(reminder.locator('.alert-window')).toHaveAttribute(
        'data-popup-sequence',
        String(previousSequence),
      )
      await reminder.clock.fastForward(2000)
      await reminder.locator('.alert-window').hover()
      await reminder.clock.fastForward(10000)
      await expect(reminder.locator('.alert-window')).not.toHaveClass(/alert-fading/)
      await reminder.getByRole('button', { name: 'Hide notification', exact: true }).focus()
      await reminder.mouse.move(-20, -20)
      await reminder.clock.fastForward(10000)
      await expect(reminder.locator('.alert-window')).not.toHaveClass(/alert-fading/)
      await reminder
        .getByRole('button', { name: 'Hide notification', exact: true })
        .evaluate((element) => element.blur())
      await reminder.clock.fastForward(2900)
      await expect(reminder.locator('.alert-window')).not.toHaveClass(/alert-fading/)
      await reminder.clock.fastForward(150)
      await expect(reminder.locator('.alert-window')).toHaveClass(/alert-fading/)
      await reminder.clock.runFor(400)
      await expect(reminder.locator('.alert-window')).toHaveCSS('opacity', '0')
      await reminder.clock.runFor(700)
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
      await reminder.clock.runFor(1100)
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
      await reminder.getByRole('button', { name: 'Hide notification', exact: true }).click()
      await reminder.clock.runFor(1100)
      await reminder.evaluate((id) => window.pulse.dismissAlert(id), currentAlerts[0].id)
      await expect(reminder.locator('h1')).toHaveText('Input needed in VS Code')
      await reminder.clock.runFor(100)
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL().includes('view=alerts'))
            .isVisible(),
        ),
        false,
      )
      appendFileSync(
        path.join(transcripts, 'two.jsonl'),
        JSON.stringify({
          type: 'tool.execution_complete',
          data: { toolCallId: 'question-two', success: true },
          timestamp: new Date().toISOString(),
        }) + '\n',
      )
      await expect
        .poll(async () => (await reminder.evaluate(() => window.pulse.getAlerts())).items.length)
        .toBe(0)
      assert.equal(
        await application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((window) => window.webContents.getURL().includes('view=alerts'))
            .isVisible(),
        ),
        false,
      )
    } finally {
      if (application) await application.close()
      rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    }
  },
)
