const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createClaudeSource, claudeStatus } = require('../electron/claude-sessions.cjs')
const { createLiveSources } = require('../electron/live-sources.cjs')
const { createAlertTracker } = require('../electron/session-alerts.cjs')

const entry = {
  kind: 'interactive',
  sessionId: 'session-one',
  cwd: 'C:\\work\\project',
  name: 'CLI session',
  startedAt: 1000,
  status: 'idle',
}

test('Claude idle is never running or inferred complete', () => {
  assert.equal(claudeStatus(entry), 'idle')
  assert.equal(claudeStatus({ ...entry, state: 'working' }), 'idle')
  assert.equal(claudeStatus({ status: 'busy' }), 'running')
  assert.equal(claudeStatus({ status: 'waiting' }), 'waiting')
  assert.equal(claudeStatus({ state: 'done' }), 'completed')
  assert.equal(claudeStatus({ state: 'failed' }), 'failed')
  assert.equal(claudeStatus({ state: 'stopped' }), 'cancelled')
  assert.equal(claudeStatus({ status: 'new-state' }), 'unknown')
})

test('Claude snapshots retain observed run time and reset it for a new run', async () => {
  let rows = [entry]
  const source = createClaudeSource({ query: async () => JSON.stringify(rows) })
  const initial = (await source.scan(2000)).sessions[0]
  assert.equal(initial.status, 'idle')
  assert.equal(initial.requestStartedAt, undefined)
  rows = [{ ...entry, status: 'busy' }]
  const running = (await source.scan(3000)).sessions[0]
  const repeated = (await source.scan(5000)).sessions[0]
  assert.equal(running.id, initial.id)
  assert.equal(repeated.requestStartedAt, 3000)
  assert.equal(repeated.updatedAt, 3000)
  assert.equal(repeated.requestId, running.requestId)
  rows = [entry]
  assert.equal((await source.scan(6000)).sessions[0].status, 'idle')
  rows = [{ ...entry, status: 'busy' }]
  const resumed = (await source.scan(7000)).sessions[0]
  assert.equal(resumed.requestStartedAt, 7000)
  assert.notEqual(resumed.requestId, running.requestId)
  source.close()
})

test('Claude query failure or disappearance never produces a completion', async () => {
  let payload = JSON.stringify([{ ...entry, status: 'busy' }])
  const source = createClaudeSource({ query: async () => payload })
  await source.scan(2000)
  payload = 'invalid'
  const failed = await source.scan(3000)
  assert.equal(failed.state, 'error')
  assert.equal(failed.sessions[0].status, 'disconnected')
  payload = '[]'
  const missing = await source.scan(4000)
  assert.equal(missing.state, 'empty')
  assert.equal(missing.sessions[0].status, 'disconnected')
  source.close()
})

test('Claude polling is single-flight and missing CLI is explicit', async () => {
  let finish
  let calls = 0
  const source = createClaudeSource({
    query: () => {
      calls++
      return new Promise((resolve) => {
        finish = resolve
      })
    },
  })
  const first = source.scan(1000)
  const second = source.scan(2000)
  assert.equal(calls, 1)
  finish('[]')
  await Promise.all([first, second])
  source.close()
  const missing = createClaudeSource({
    query: async () => {
      throw Object.assign(new Error('not installed'), { code: 'ENOENT' })
    },
  })
  assert.equal((await missing.scan()).state, 'unavailable')
  missing.close()
})

test('real sources publish independently and a slow Claude scan does not pause VS Code', async () => {
  let releaseClaude
  let vscodeScans = 0
  let claudeScans = 0
  const updates = []
  const sources = createLiveSources(
    {
      vscode: {
        scan: async () => {
          vscodeScans++
          return { source: 'vscode', sessions: [{ id: 'vscode:one' }] }
        },
        close() {},
      },
      claude: {
        scan: () => {
          claudeScans++
          return new Promise((resolve) => {
            releaseClaude = resolve
          })
        },
        close() {},
      },
    },
    (source) => updates.push(source),
  )
  const first = sources.refresh()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(updates, ['vscode'])
  const second = sources.refresh()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(vscodeScans, 2)
  assert.equal(claudeScans, 1)
  releaseClaude({ source: 'claude', sessions: [{ id: 'claude:one' }] })
  await Promise.all([first, second])
  assert.equal(sources.sessions().length, 2)
  assert.equal(sources.view('vscode').sessions.length, 1)
  sources.close()
})

test('Claude reminders use their own provider and idle does not announce a reply', () => {
  const tracker = createAlertTracker()
  const sample = {
    id: 'claude:test',
    source: 'claude',
    project: 'project',
    task: 'request',
    status: 'running',
    updatedAt: 1000,
  }
  tracker.update([sample])
  assert.equal(tracker.update([{ ...sample, status: 'idle' }]).length, 0)
  const alerts = tracker.update([{ ...sample, status: 'waiting' }])
  assert.equal(alerts[0].title, 'Input needed in Claude Code')
})

test('combined live view includes both providers and retains healthy sessions during a source failure', async () => {
  let claudeFails = false
  const sources = createLiveSources(
    {
      vscode: {
        scan: async () => ({
          source: 'vscode',
          state: 'connected',
          scannedAt: 1000,
          sessions: [{ id: 'vscode:one', source: 'vscode', status: 'running' }],
        }),
        close() {},
      },
      claude: {
        scan: async () => {
          if (claudeFails) throw new Error('Unavailable')
          return {
            source: 'claude',
            state: 'connected',
            scannedAt: 2000,
            sessions: [{ id: 'claude:one', source: 'claude', status: 'idle' }],
          }
        },
        close() {},
      },
    },
    () => {},
  )
  assert.equal(sources.view('live').state, 'connecting')
  await sources.refresh()
  const combined = sources.view('live')
  assert.equal(combined.source, 'live')
  assert.equal(combined.state, 'connected')
  assert.equal(combined.scannedAt, 2000)
  assert.deepEqual(
    combined.sessions.map((item) => item.source),
    ['vscode', 'claude'],
  )
  claudeFails = true
  await sources.refresh()
  const partial = sources.view('live')
  assert.equal(partial.state, 'error')
  assert.equal(partial.sessions.find((item) => item.id === 'vscode:one').status, 'running')
  assert.match(partial.message, /Claude Code:.*failed/)
  sources.close()
})
