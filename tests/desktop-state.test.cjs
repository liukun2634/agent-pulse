const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { createDesktopState, constrainBounds } = require('../electron/desktop-state.cjs')

test('source paths persist atomically and invalid paths do not overwrite saved settings', () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'pulse-settings-'))
  const filename = path.join(root, 'desktop-settings.json')
  try {
    const store = createDesktopState(filename)
    const sources = {
      vscodeStorage: path.join(root, 'storage'),
      claudeExecutable: path.join(root, 'claude.exe'),
    }
    store.setSources(sources)
    assert.deepEqual(createDesktopState(filename).snapshot().sources, sources)
    assert.throws(() => store.setSources({ ...sources, vscodeStorage: '../storage' }), /absolute/)
    assert.deepEqual(createDesktopState(filename).snapshot().sources, sources)
    fs.mkdirSync(`${filename}.tmp`)
    assert.throws(() => store.setSources({ vscodeStorage: '', claudeExecutable: '' }))
    assert.deepEqual(store.snapshot().sources, sources)
    fs.rmSync(`${filename}.tmp`, { recursive: true })
    fs.writeFileSync(filename, 'invalid')
    const recovered = createDesktopState(filename).snapshot()
    assert.ok(recovered.warning)
    assert.deepEqual(recovered.sources, { vscodeStorage: '', claudeExecutable: '' })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('individual read updates merge and window state restores within a changed display', () => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'pulse-read-window-'))
  const filename = path.join(root, 'state.json')
  try {
    const store = createDesktopState(filename)
    store.markRead('vscode:first', 'first-reply')
    store.markRead('claude:second', 'second-reply')
    store.saveWindow('mini', {
      bounds: { x: 3000, y: 1900, width: 360, height: 600 },
      pinned: true,
      collapsed: true,
      edge: 'left',
      expandedSize: [420, 650],
    })
    const restored = createDesktopState(filename).snapshot()
    assert.deepEqual(restored.seenReplies, {
      'vscode:first': 'first-reply',
      'claude:second': 'second-reply',
    })
    assert.equal(restored.windowState.mini.collapsed, true)
    assert.deepEqual(restored.windowState.mini.expandedSize, [420, 650])
    assert.equal(restored.windowState.mode, 'mini')
    assert.deepEqual(
      constrainBounds(restored.windowState.mini.bounds, { x: 0, y: 0, width: 1280, height: 720 }),
      { x: 920, y: 120, width: 360, height: 600 },
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('reminder retention is explicit and its warning survives restart', () => {
  const { createAlertTracker } = require('../electron/session-alerts.cjs')
  const { createAlertHistory } = require('../electron/alert-history.cjs')
  const root = fs.mkdtempSync(path.join(tmpdir(), 'pulse-retention-'))
  try {
    const tracker = createAlertTracker()
    const alerts = tracker.update(
      Array.from({ length: 205 }, (_, index) => ({
        id: `vscode:${index}`,
        task: `Task ${index}`,
        project: 'fixture',
        status: 'waiting',
        requestId: `request-${index}`,
        updatedAt: 1000,
      })),
      2000,
    )
    const filename = path.join(root, 'history.json')
    const history = createAlertHistory(filename, tracker)
    history.save(alerts)
    assert.match(history.warning, /200 reminders/)
    const restored = createAlertHistory(filename, createAlertTracker())
    const items = restored.load()
    assert.equal(items.length, 200)
    assert.equal(items[0].task, 'Task 5')
    assert.match(restored.warning, /retention limits/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
