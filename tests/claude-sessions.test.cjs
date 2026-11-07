const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createClaudeSource, claudeStatus } = require('../electron/claude-sessions.cjs')
const { createLiveSources } = require('../electron/live-sources.cjs')
const { createAlertTracker, matchesReference } = require('../electron/session-alerts.cjs')

const entry = {
  kind: 'interactive',
  sessionId: 'session-one',
  cwd: 'C:\\work\\project',
  name: 'CLI session',
  startedAt: 1000,
  status: 'idle',
}

test('local hooks authenticate, redact content and reject stale prompt completions', async () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { tmpdir } = require('node:os')
  const { createClaudeHooks } = require('../electron/claude-hooks.cjs')
  const root = fs.mkdtempSync(path.join(tmpdir(), 'pulse-hooks-'))
  const hooks = createClaudeHooks(root)
  try {
    await hooks.enable(true)
    const handler = hooks.configuration().hooks.UserPromptSubmit[0].hooks[0]
    const input = {
      session_id: 'session-one',
      prompt_id: 'round-one',
      cwd: root,
      hook_event_name: 'UserPromptSubmit',
      prompt: 'private prompt',
    }
    const denied = await fetch(handler.url, { method: 'POST', body: JSON.stringify(input) })
    assert.equal(denied.status, 403)
    const post = (body) =>
      fetch(handler.url, { method: 'POST', headers: handler.headers, body: JSON.stringify(body) })
    assert.equal((await post(input)).status, 204)
    assert.equal(hooks.records()[0].status, 'running')
    await post({ ...input, hook_event_name: 'PermissionRequest' })
    assert.equal(hooks.records()[0].status, 'waiting')
    await post({ ...input, hook_event_name: 'Stop', last_assistant_message: 'private reply' })
    assert.equal(hooks.records()[0].status, 'completed')
    const finishedAt = hooks.records()[0].finishedAt
    await post({ ...input, hook_event_name: 'Stop' })
    assert.equal(hooks.records()[0].finishedAt, finishedAt)
    await post(input)
    assert.equal(hooks.records()[0].status, 'completed')
    await post({ ...input, hook_event_name: 'PreToolUse', tool_name: 'Read' })
    assert.equal(hooks.records()[0].status, 'running')
    await post({ ...input, prompt_id: 'round-two' })
    await post({ ...input, hook_event_name: 'Stop' })
    assert.equal(hooks.records()[0].status, 'running')
    await post({
      ...input,
      prompt_id: 'round-two',
      hook_event_name: 'SubagentStop',
      agent_id: 'child',
    })
    assert.equal(hooks.records()[0].status, 'running')
    await post({ ...input, prompt_id: 'round-two', hook_event_name: 'StopFailure' })
    assert.equal(hooks.records()[0].status, 'failed')
    const saved = fs.readFileSync(path.join(root, 'claude-hooks.json'), 'utf8')
    assert.equal(saved.includes('private prompt'), false)
    assert.equal(saved.includes('private reply'), false)
    await hooks.enable(false)
    assert.deepEqual(hooks.records(), [])
  } finally {
    hooks.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('fresh input hooks alert without a preceding prompt while restored waiting stays silent', async () => {
  const fs = require('node:fs')
  const path = require('node:path')
  const { tmpdir } = require('node:os')
  const { createClaudeHooks } = require('../electron/claude-hooks.cjs')
  const root = fs.mkdtempSync(path.join(tmpdir(), 'pulse-input-hooks-'))
  const hooks = createClaudeHooks(root)
  const source = createClaudeSource({
    query: async () => {
      throw new Error('CLI unavailable')
    },
    hooks,
  })
  try {
    await hooks.enable(true)
    const events = [
      { hook_event_name: 'PermissionRequest' },
      { hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' },
      { hook_event_name: 'PreToolUse', tool_name: 'ExitPlanMode' },
      { hook_event_name: 'Elicitation' },
      { hook_event_name: 'Notification', notification_type: 'permission_prompt' },
    ]
    for (const [index, event] of events.entries()) {
      assert.equal(
        hooks.accept({
          ...event,
          session_id: `input-${index}`,
          prompt_id: `prompt-${index}`,
          cwd: root,
          tool_input: { private: 'synthetic input body' },
        }),
        true,
      )
    }
    assert.equal(
      hooks.accept({
        hook_event_name: 'Notification',
        notification_type: 'idle_prompt',
        session_id: 'idle-only',
        cwd: root,
      }),
      false,
    )
    const sessions = (await source.scan()).sessions
    const tracker = createAlertTracker()
    const alerts = tracker.update(sessions)
    assert.equal(alerts.length, events.length)
    assert.ok(alerts.every((alert) => alert.status === 'waiting' && !alert.initial))
    assert.deepEqual(tracker.update(sessions), [])
    const idleSource = createClaudeSource({
      hooks,
      query: async () =>
        JSON.stringify(
          events.map((_event, index) => ({
            ...entry,
            sessionId: `input-${index}`,
            cwd: root,
            status: 'idle',
          })),
        ),
    })
    try {
      const idleSnapshot = await idleSource.scan(Date.now() + 3000)
      assert.ok(idleSnapshot.sessions.every((session) => session.status === 'waiting'))
    } finally {
      idleSource.close()
    }
    const restoredHooks = createClaudeHooks(root)
    const restored = createClaudeSource({
      query: async () => '[]',
      hooks: { ...restoredHooks, status: () => ({ listening: true }) },
    })
    try {
      const historical = createAlertTracker().update((await restored.scan()).sessions)
      assert.ok(historical.every((alert) => alert.initial))
      assert.equal(
        fs
          .readFileSync(path.join(root, 'claude-hooks.json'), 'utf8')
          .includes('synthetic input body'),
        false,
      )
    } finally {
      restored.close()
      restoredHooks.close()
    }
  } finally {
    source.close()
    hooks.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

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

test('a short hook-only request produces a reply alert and retains its prompt identity', async () => {
  const records = []
  const hooks = { status: () => ({ listening: true }), records: () => records }
  const source = createClaudeSource({ query: async () => '[]', hooks })
  const tracker = createAlertTracker()
  tracker.update((await source.scan()).sessions)
  const now = Date.now()
  records.push({
    sessionId: 'short',
    cwd: 'C:\\work',
    requestId: 'prompt:one',
    requestStartedAt: now,
    updatedAt: now + 1,
    finishedAt: now + 1,
    status: 'completed',
    event: 'Stop',
  })
  const completed = (await source.scan(now + 2)).sessions
  assert.equal(completed[0].requestId, 'prompt:one')
  assert.equal(tracker.update(completed).length, 1)
  assert.equal(tracker.update(completed).length, 0)
  source.close()
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

test('Claude first waiting starts an observed clock on execution without resetting an existing run', async () => {
  let rows = [{ ...entry, status: 'waiting' }]
  const query = async () => JSON.stringify(rows)
  const source = createClaudeSource({ query })
  try {
    const waiting = (await source.scan(20000)).sessions[0]
    assert.equal(waiting.requestStartedAt, undefined)
    rows = [{ ...entry, status: 'busy' }]
    const running = (await source.scan(21000)).sessions[0]
    assert.equal(running.requestStartedAt, 21000)
    assert.equal(running.requestId, waiting.requestId)
    assert.equal((await source.scan(22000)).sessions[0].requestStartedAt, 21000)
    rows = [{ ...entry, status: 'waiting' }]
    assert.equal((await source.scan(23000)).sessions[0].requestStartedAt, 21000)
    rows = [{ ...entry, status: 'busy' }]
    assert.equal((await source.scan(24000)).sessions[0].requestStartedAt, 21000)
    rows = [entry]
    await source.scan(25000)
    rows = [{ ...entry, status: 'busy' }]
    const next = (await source.scan(26000)).sessions[0]
    assert.equal(next.requestStartedAt, 26000)
    assert.notEqual(next.requestId, running.requestId)
  } finally {
    source.close()
  }
  rows = [{ ...entry, status: 'waiting' }]
  const restarted = createClaudeSource({ query })
  try {
    await restarted.scan(30000)
    rows = [{ ...entry, status: 'busy' }]
    assert.equal((await restarted.scan(31000)).sessions[0].requestStartedAt, 31000)
  } finally {
    restarted.close()
  }
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

test('Claude recovery separates observations without reviving ignored waiting or inventing completion', async () => {
  let payload = JSON.stringify([{ ...entry, status: 'busy' }])
  const query = async () => payload
  const original = createClaudeSource({ query })
  const tracker = createAlertTracker()
  tracker.update((await original.scan(2000)).sessions, 2000)
  payload = JSON.stringify([{ ...entry, status: 'waiting' }])
  const waiting = (await original.scan(3000)).sessions[0]
  const [alert] = tracker.update([waiting], 3000)
  const baseline = tracker.snapshot()
  original.close()

  const restarted = createClaudeSource({ query })
  try {
    const restoredTracker = createAlertTracker()
    restoredTracker.restore(baseline)
    const recovered = (await restarted.scan(3000)).sessions[0]
    assert.ok(recovered.observationId)
    assert.notEqual(recovered.observationId, waiting.observationId)
    assert.notEqual(recovered.requestId, waiting.requestId)
    assert.equal(matchesReference(recovered, alert.reference), false)
    assert.deepEqual(restoredTracker.update([recovered], 4000), [])
    payload = JSON.stringify([{ ...entry, status: 'busy' }])
    restoredTracker.update((await restarted.scan(5000)).sessions, 5000)
    payload = JSON.stringify([{ ...entry, status: 'waiting' }])
    const [fresh] = restoredTracker.update((await restarted.scan(6000)).sessions, 6000)
    assert.equal(fresh.initial, false)
    assert.equal(fresh.recovered, undefined)
    payload = 'invalid'
    await restarted.scan(7000)
    payload = JSON.stringify([{ ...entry, status: 'waiting' }])
    const reconnected = (await restarted.scan(8000)).sessions[0]
    assert.notEqual(reconnected.observationId, recovered.observationId)
    assert.equal(matchesReference(reconnected, fresh.reference), false)
    assert.deepEqual(restoredTracker.update([reconnected], 8000), [])
    restarted.beginRecovery()
    const awakened = (await restarted.scan(9000)).sessions[0]
    assert.notEqual(awakened.observationId, reconnected.observationId)
  } finally {
    restarted.close()
  }

  payload = JSON.stringify([{ ...entry, kind: 'background', state: 'done' }])
  const completed = createClaudeSource({ query })
  try {
    const restoredTracker = createAlertTracker()
    restoredTracker.restore(baseline)
    assert.deepEqual(restoredTracker.update((await completed.scan(10000)).sessions, 10000), [])
  } finally {
    completed.close()
  }
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

test('source changes wake collection without waiting for the polling interval and coalesce during a scan', async () => {
  let changed
  let finishFirst
  let scans = 0
  let stopped = false
  const published = []
  let finishSecond
  const secondPublished = new Promise((resolve) => {
    finishSecond = resolve
  })
  const sources = createLiveSources(
    {
      vscode: {
        subscribe(listener) {
          changed = listener
          return () => {
            stopped = true
          }
        },
        scan() {
          scans++
          if (scans === 1)
            return new Promise((resolve) => {
              finishFirst = resolve
            })
          return Promise.resolve({
            source: 'vscode',
            state: 'connected',
            scannedAt: 2000,
            sessions: [{ id: 'one', status: 'completed' }],
          })
        },
        close() {},
      },
    },
    () => {
      published.push(sources.view('live').sessions[0].status)
      if (published.length === 2) finishSecond()
    },
  )
  try {
    const first = sources.refresh()
    for (let count = 0; count < 10; count++) changed()
    assert.equal(scans, 1)
    finishFirst({
      source: 'vscode',
      state: 'connected',
      scannedAt: 1000,
      sessions: [{ id: 'one', status: 'running' }],
    })
    await first
    await secondPublished
    assert.equal(scans, 2)
    assert.deepEqual(published, ['running', 'completed'])
  } finally {
    sources.close()
  }
  changed()
  assert.equal(stopped, true)
  assert.equal(scans, 2)
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
