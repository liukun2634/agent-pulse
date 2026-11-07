const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  createTranscript,
  applyEvent,
  applyChatEvent,
  toSession,
  createVSCodeSource,
  pollInterval,
} = require('../electron/vscode-sessions.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')
const {
  createAlertTracker,
  sessionReference,
  matchesReference,
} = require('../electron/session-alerts.cjs')
const { createLiveSources } = require('../electron/live-sources.cjs')

const now = Date.parse('2026-11-03T10:00:00Z')
test('reminder history restores pending items without re-alerting dismissed input', async () => {
  const { createAlertHistory } = require('../electron/alert-history.cjs')
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pulse-history-'))
  try {
    const filename = path.join(root, 'history.json')
    const tracker = createAlertTracker()
    const sessions = ['one', 'two'].map((id) => ({
      id,
      requestId: id,
      project: 'project',
      task: id,
      status: 'waiting',
      updatedAt: now,
    }))
    const alerts = tracker.update(sessions, now)
    createAlertHistory(filename, tracker).save([alerts[0]])
    const restoredTracker = createAlertTracker()
    const history = createAlertHistory(filename, restoredTracker)
    const restored = history.load()
    assert.equal(restored.length, 1)
    assert.equal(restored[0].id, alerts[0].id)
    assert.equal(restored[0].initial, true)
    assert.deepEqual(restoredTracker.update(sessions), [])
    restoredTracker.beginRecovery()
    const caughtUp = restoredTracker.update([
      { ...sessions[0], status: 'completed', finishedAt: now + 10 },
    ])
    assert.equal(caughtUp[0].initial, true)
    assert.notEqual(caughtUp[0].id, alerts[0].id)
    await fs.writeFile(filename, '{broken')
    const damaged = createAlertHistory(filename, createAlertTracker())
    assert.deepEqual(damaged.load(), [])
    assert.ok(damaged.warning)
    assert.ok((await fs.readdir(root)).some((name) => name.startsWith('history.json.invalid-')))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('initial input requests enter the inbox silently while historical completions stay quiet', () => {
  const tracker = createAlertTracker()
  const session = { id: 'one', requestId: 'request-1', status: 'waiting', updatedAt: now }
  const alerts = tracker.update([
    session,
    { ...session, id: 'old', status: 'completed', finishedAt: now },
  ])
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].initial, true)
  assert.equal(alerts[0].reference.requestId, 'request-1')
  assert.deepEqual(tracker.update([session]), [])
  tracker.update([{ ...session, status: 'running' }])
  assert.equal(tracker.update([session])[0].initial, false)
})

test('request references reject later replies, state changes and ambiguous legacy updates', () => {
  const session = {
    id: 'one',
    requestId: 'first',
    status: 'completed',
    finishedAt: now,
    updatedAt: now,
  }
  const reference = sessionReference(session)
  assert.equal(matchesReference(session, reference), true)
  assert.equal(matchesReference({ ...session, requestId: 'second' }, reference), false)
  assert.equal(matchesReference({ ...session, finishedAt: now + 1 }, reference), false)
  assert.equal(matchesReference({ ...session, status: 'running' }, reference), false)
  const legacy = { ...session, requestId: undefined, finishedAt: null, status: 'waiting' }
  assert.equal(matchesReference({ ...legacy, updatedAt: now + 1 }, sessionReference(legacy)), false)
})

test('background alerts fire once for input and completion, not initial history or repeated polls', () => {
  const tracker = createAlertTracker()
  const session = {
    id: 'one',
    project: 'project',
    task: 'task',
    requestId: 'request-1',
    status: 'running',
  }
  assert.deepEqual(
    tracker.update([{ ...session, id: 'history', status: 'completed' }, session]),
    [],
  )
  assert.equal(tracker.update([{ ...session, status: 'waiting' }])[0].status, 'waiting')
  assert.deepEqual(tracker.update([{ ...session, status: 'waiting', updatedAt: now + 1000 }]), [])
  assert.deepEqual(tracker.update([{ ...session, status: 'unknown' }]), [])
  assert.deepEqual(tracker.update([{ ...session, status: 'waiting' }]), [])
  tracker.update([session])
  assert.equal(tracker.update([{ ...session, status: 'waiting' }]).length, 1)
  assert.equal(
    tracker.update([{ ...session, status: 'completed', finishedAt: now }])[0].status,
    'completed',
  )
  assert.deepEqual(tracker.update([{ ...session, status: 'completed', finishedAt: now + 100 }]), [])
  assert.deepEqual(tracker.update([{ ...session, status: 'idle', requestId: undefined }]), [])
  assert.deepEqual(tracker.update([{ ...session, status: 'completed', finishedAt: now + 100 }]), [])
  assert.equal(
    tracker.update([{ ...session, requestId: 'request-2', status: 'completed' }]).length,
    1,
  )
})

test('multiple sessions produce separate alerts and temporary missing data does not lose transitions', () => {
  const tracker = createAlertTracker()
  const sessions = ['one', 'two'].map((id) => ({
    id,
    project: id,
    task: 'task',
    status: 'running',
  }))
  tracker.update(sessions)
  tracker.update([])
  const alerts = tracker.update([
    { ...sessions[0], status: 'completed' },
    { ...sessions[1], status: 'waiting' },
  ])
  assert.deepEqual(
    alerts.map((alert) => alert.status),
    ['completed', 'waiting'],
  )
  tracker.reset()
  assert.deepEqual(tracker.update([{ ...sessions[0], status: 'completed' }]), [])
})

function feed(state, type, data = {}, offset = 0) {
  applyEvent(state, { type, data, timestamp: new Date(now + offset).toISOString() })
}

test('tool-loop turn_end is not session completion', () => {
  const state = createTranscript('one', 'project')
  feed(state, 'assistant.message', {
    content: 'Checking',
    toolRequests: [{ toolCallId: 'tool-1', name: 'read_file' }],
  })
  feed(state, 'assistant.turn_end')
  assert.equal(toSession(state, now).status, 'running')
  feed(state, 'assistant.turn_start')
  feed(state, 'tool.execution_complete', { toolCallId: 'tool-1', success: false })
  assert.equal(toSession(state, now).status, 'running')
  feed(state, 'assistant.message', { content: 'Done' })
  feed(state, 'assistant.turn_end')
  assert.equal(toSession(state, now).status, 'completed')
  feed(state, 'user.message', { content: 'Continue' }, 1000)
  assert.equal(toSession(state, now + 1000).status, 'running')
  assert.equal(toSession(state, now + 1000).finishedAt, null)
})

test('questions stay waiting across tool turns until answered', () => {
  const state = createTranscript('two', 'project')
  feed(state, 'assistant.message', {
    toolRequests: [{ toolCallId: 'question', name: 'vscode_askQuestions' }],
  })
  feed(state, 'assistant.turn_end')
  feed(state, 'assistant.turn_start')
  assert.equal(toSession(state, now).status, 'waiting')
  feed(state, 'tool.execution_complete', { toolCallId: 'question', success: true })
  assert.equal(toSession(state, now).status, 'running')
})

test('silence and incomplete lifecycle evidence never imply success', () => {
  const state = createTranscript('three', 'project')
  feed(state, 'assistant.turn_end')
  assert.equal(toSession(state, now).status, 'unknown')
  feed(state, 'assistant.turn_start')
  assert.equal(toSession(state, now + 121000).status, 'idle')
  applyEvent(state, { type: 'session.error', timestamp: 'invalid' })
  assert.equal(toSession(state, now).status, 'running')
})

test('saved request completion overrides an unfinished transcript and a new request resumes it', () => {
  const state = createTranscript('saved', 'project')
  feed(state, 'assistant.turn_start')
  const chat = {}
  applyChatEvent(chat, {
    kind: 2,
    k: ['requests'],
    v: [{ requestId: 'first', timestamp: now, modelState: { value: 0 } }],
  })
  applyChatEvent(chat, {
    kind: 1,
    k: ['requests', 0, 'modelState'],
    v: { value: 1, completedAt: now + 1000 },
  })
  assert.equal(toSession(state, now + 200000, chat).status, 'completed')
  assert.equal(toSession(state, now + 200000, chat).finishedAt, now + 1000)
  applyChatEvent(chat, {
    kind: 2,
    k: ['requests'],
    v: [{ requestId: 'second', timestamp: now + 300000, modelState: { value: 0 } }],
  })
  assert.equal(toSession(state, now + 300000, chat).status, 'running')
  assert.equal(toSession(state, now + 300000, chat).finishedAt, null)
})

test('source discovers workspaces, tails partial UTF-8 lines and handles truncation', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pulse-source-'))
  const source = createVSCodeSource(root)
  const scan = () => source.scan(now, { force: true })
  try {
    const workspace = path.join(root, 'workspace-one')
    const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
    await fs.mkdir(transcripts, { recursive: true })
    await fs.writeFile(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(path.join(root, 'Project name')).href }),
    )
    const filename = path.join(transcripts, 'session-one.jsonl')
    const event = (type, data = {}) =>
      JSON.stringify({ type, data, timestamp: new Date(now).toISOString() }) + '\n'
    await fs.writeFile(filename, event('assistant.turn_start'))
    let snapshot = await scan()
    assert.equal(snapshot.state, 'connected')
    assert.equal(snapshot.sessions[0].project, 'Project name')
    assert.equal(snapshot.sessions[0].status, 'running')

    const message = Buffer.from(event('user.message', { content: '\u4f60\u597d' }))
    const split = message.indexOf(Buffer.from('\u4f60')) + 1
    await fs.appendFile(filename, message.subarray(0, split))
    const partial = await scan()
    assert.equal(partial.sessions[0].status, 'unknown')
    assert.equal(partial.needsRefresh, false)
    await fs.appendFile(filename, message.subarray(split))
    snapshot = await scan()
    assert.equal(snapshot.sessions[0].task, '\u4f60\u597d')
    assert.equal(snapshot.sessions[0].status, 'running')
    assert.equal((await scan()).sessions[0].events.length, snapshot.sessions[0].events.length)

    const titles = path.join(workspace, 'chatSessions')
    await fs.mkdir(titles)
    await fs.writeFile(
      path.join(titles, 'session-one.jsonl'),
      JSON.stringify({ kind: 1, k: ['customTitle'], v: 'Session monitor integration' }) + '\n',
    )
    assert.equal((await scan()).sessions[0].task, 'Session monitor integration')

    await fs.writeFile(filename, event('session.error'))
    assert.equal((await scan()).sessions[0].status, 'failed')
    await fs.unlink(filename)
    assert.equal((await scan()).state, 'empty')
  } finally {
    source.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('current monitored sessions retain alert baselines beyond the history retention limit', () => {
  const tracker = createAlertTracker()
  const sessions = Array.from({ length: 1001 }, (_, index) => ({
    id: `vscode:large:${index}`,
    source: 'vscode',
    project: 'project',
    task: `Input ${index}`,
    status: 'waiting',
    requestId: `request-${index}`,
    updatedAt: now,
  }))
  assert.equal(tracker.update(sessions, now).length, 1001)
  assert.deepEqual(tracker.update(sessions, now + 2000), [])
  assert.equal(tracker.snapshot().observed.length, 1000)
  const restored = createAlertTracker()
  restored.restore(tracker.snapshot())
  assert.ok(restored.update(sessions, now + 4000).every((alert) => alert.initial))
  assert.deepEqual(restored.update(sessions, now + 6000), [])
})

test('large directory scan measures cold and warm cost without cutting monitoring', async (context) => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pulse-scale-'))
  const workspace = path.join(root, 'workspace')
  const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
  const source = createVSCodeSource(root, {
    watchChanges: () => {
      throw new Error('No watcher')
    },
  })
  try {
    await fs.mkdir(transcripts, { recursive: true })
    await fs.writeFile(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(root).href }),
    )
    await Promise.all(
      Array.from({ length: 500 }, (_, index) =>
        fs.writeFile(
          path.join(transcripts, `session-${index}.jsonl`),
          JSON.stringify({
            type: 'user.message',
            timestamp: new Date(now).toISOString(),
            data: { content: `Synthetic ${index}` },
          }) + '\n',
        ),
      ),
    )
    const memory = process.memoryUsage().heapUsed
    const start = performance.now()
    const cold = await source.scan(now)
    const coldMs = performance.now() - start
    const warmStart = performance.now()
    const warm = await source.scan(now + 1)
    assert.equal(cold.sessions.length, 500)
    assert.equal(cold.metrics.checked, 500)
    assert.equal(warm.metrics.checked, 0)
    assert.equal(warm.sessions.length, 500)
    context.diagnostic(
      `500 records: cold ${coldMs.toFixed(1)} ms, warm ${(performance.now() - warmStart).toFixed(1)} ms, heap delta ${((process.memoryUsage().heapUsed - memory) / 1048576).toFixed(2)} MiB`,
    )
  } finally {
    source.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('active sessions beyond 100 records remain monitored including saved-only updates', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pulse-many-sessions-'))
  const source = createVSCodeSource(root, {
    watchChanges: () => {
      throw new Error('No watcher')
    },
  })
  try {
    const workspace = path.join(root, 'workspace-one')
    const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
    const chats = path.join(workspace, 'chatSessions')
    await fs.mkdir(transcripts, { recursive: true })
    await fs.mkdir(chats, { recursive: true })
    await fs.writeFile(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(root).href }),
    )
    const encode = (type, timestamp, data = {}) =>
      JSON.stringify({ type, timestamp: new Date(timestamp).toISOString(), data }) + '\n'
    const runningFile = path.join(transcripts, 'old-running.jsonl')
    await fs.writeFile(runningFile, encode('user.message', now - 10000, { content: 'Old run' }))
    await fs.utimes(runningFile, new Date(now - 600000), new Date(now - 600000))
    await fs.writeFile(
      path.join(chats, 'old-running.jsonl'),
      JSON.stringify({
        kind: 0,
        v: {
          requests: [
            { requestId: 'old-request', timestamp: now - 10000, modelState: { value: 0 } },
          ],
        },
      }) + '\n',
    )
    assert.equal((await source.scan(now)).sessions[0].status, 'running')

    const waitingFile = path.join(transcripts, 'old-waiting.jsonl')
    await fs.writeFile(
      waitingFile,
      encode('user.message', now - 500000, { content: 'Old input request' }) +
        encode('assistant.message', now - 499999, {
          toolRequests: [{ toolCallId: 'question', name: 'vscode_askQuestions' }],
        }),
    )
    await fs.utimes(waitingFile, new Date(now - 500000), new Date(now - 500000))
    for (let index = 0; index < 101; index++) {
      const filename = path.join(transcripts, `history-${index}.jsonl`)
      await fs.writeFile(
        filename,
        encode('user.message', now - 10000, { content: `History ${index}` }) +
          encode('assistant.message', now - 9000, { content: 'Finished' }) +
          encode('assistant.turn_end', now - 8000),
      )
      await fs.utimes(filename, new Date(now), new Date(now))
    }
    const runningId = 'vscode:workspace-one:old-running'
    const waitingId = 'vscode:workspace-one:old-waiting'
    const before = await source.scan(now + 2000)
    assert.equal(before.sessions.find((session) => session.id === runningId)?.status, 'running')
    assert.equal(before.sessions.find((session) => session.id === waitingId)?.status, 'waiting')
    const tracker = createAlertTracker()
    tracker.update(before.sessions, now + 2000)
    const quiet = await source.scan(now + 600000)
    assert.equal(quiet.sessions.find((session) => session.id === runningId)?.status, 'idle')
    tracker.update(quiet.sessions, now + 600000)
    await fs.appendFile(
      path.join(chats, 'old-running.jsonl'),
      JSON.stringify({
        kind: 0,
        v: {
          requests: [
            {
              requestId: 'old-request',
              timestamp: now - 10000,
              modelState: { value: 1, completedAt: now + 603000 },
            },
          ],
        },
      }) + '\n',
    )
    const after = await source.scan(now + 604000)
    assert.equal(after.sessions.find((session) => session.id === runningId)?.status, 'completed')
    assert.equal(after.sessions.find((session) => session.id === waitingId)?.status, 'waiting')
    assert.ok(
      tracker.update(after.sessions, now + 604000).some((alert) => alert.sessionId === runningId),
    )
    const restarted = createVSCodeSource(root)
    try {
      const restored = await restarted.scan(now + 605000)
      assert.equal(restored.sessions.find((session) => session.id === waitingId)?.status, 'waiting')
      assert.equal(
        restored.sessions.find((session) => session.id === runningId)?.status,
        'completed',
      )
    } finally {
      restarted.close()
    }
  } finally {
    source.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('written completion is published through file events without a polling tick', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pulse-event-wake-'))
  const workspace = path.join(root, 'workspace-one')
  const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
  const watchers = new Map()
  const source = createVSCodeSource(root, {
    watchChanges: (directory, _options, listener) => {
      watchers.set(directory, listener)
      return { on() {}, close() {} }
    },
  })
  let completed
  const observed = new Promise((resolve) => {
    completed = resolve
  })
  const sources = createLiveSources({ vscode: source }, () => {
    const snapshot = sources.view('live').sessions[0]
    if (snapshot?.status === 'completed') completed(snapshot)
  })
  try {
    await fs.mkdir(transcripts, { recursive: true })
    await fs.writeFile(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(root).href }),
    )
    const filename = path.join(transcripts, 'session-one.jsonl')
    const encode = (type, data = {}) =>
      JSON.stringify({ type, data, timestamp: new Date().toISOString() }) + '\n'
    await fs.writeFile(filename, encode('user.message', { content: 'Synthetic latency check' }))
    await sources.refresh()
    assert.equal(sources.view('live').sessions[0].status, 'running')
    await fs.appendFile(
      filename,
      encode('assistant.message', { content: 'Finished' }) + encode('assistant.turn_end'),
    )
    watchers.get(transcripts)('change', 'session-one.jsonl')
    const session = await observed
    assert.equal(session.status, 'completed')
    assert.equal(session.host, 'vscode')
  } finally {
    sources.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('large saved chat history drains in bounded passes without waiting for polling', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pulse-backlog-'))
  const workspace = path.join(root, 'workspace-one')
  const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
  const chats = path.join(workspace, 'chatSessions')
  const source = createVSCodeSource(root, {
    watchChanges: () => {
      throw new Error('No watcher')
    },
  })
  const states = []
  let finished
  const drained = new Promise((resolve) => {
    finished = resolve
  })
  const sources = createLiveSources({ vscode: source }, () => {
    const snapshot = sources.view('live').sessions[0]
    states.push(snapshot.status)
    if (snapshot.status === 'completed') finished()
  })
  try {
    await fs.mkdir(transcripts, { recursive: true })
    await fs.mkdir(chats, { recursive: true })
    await fs.writeFile(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(root).href }),
    )
    const timestamp = Date.now()
    await fs.writeFile(
      path.join(transcripts, 'session-one.jsonl'),
      JSON.stringify({
        type: 'user.message',
        timestamp: new Date(timestamp).toISOString(),
        data: { content: 'Synthetic large history' },
      }) + '\n',
    )
    await fs.writeFile(
      path.join(chats, 'session-one.jsonl'),
      JSON.stringify({
        kind: 0,
        v: {
          requests: [
            {
              requestId: 'request-one',
              timestamp,
              modelState: { value: 1, completedAt: timestamp + 1 },
            },
          ],
          padding: 'x'.repeat(9 * 1024 * 1024),
        },
      }) + '\n',
    )
    await sources.refresh()
    assert.equal(sources.view('vscode').needsRefresh, true)
    await drained
    assert.deepEqual(states, ['unknown', 'completed'])
    assert.equal(sources.view('vscode').needsRefresh, false)
  } finally {
    sources.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('missing storage is explicit and never falls back to demo data', async () => {
  const source = createVSCodeSource(path.join(tmpdir(), `pulse-missing-${Date.now()}`))
  const snapshot = await source.scan(now)
  assert.equal(snapshot.state, 'unavailable')
  assert.deepEqual(snapshot.sessions, [])
})

test('execution timing follows the current request rather than the session age', () => {
  const state = createTranscript('timing', 'project')
  const start = Date.now() - 600000
  applyEvent(state, {
    type: 'user.message',
    timestamp: new Date(start).toISOString(),
    data: { content: 'First request' },
  })
  applyEvent(state, {
    type: 'user.message',
    timestamp: new Date(start + 500000).toISOString(),
    data: { content: 'Second request' },
  })
  assert.equal(toSession(state).startedAt, start)
  assert.equal(toSession(state).requestStartedAt, start + 500000)
})

test('polling backs off with inactivity and clamps future timestamps', () => {
  assert.equal(pollInterval(now, now), 2000)
  assert.equal(pollInterval(now, now + 30000), 5000)
  assert.equal(pollInterval(now, now + 120000), 15000)
  assert.equal(pollInterval(now, now + 600000), 60000)
  assert.equal(pollInterval(now + 1000, now), 2000)
  for (const status of ['running', 'waiting', 'idle'])
    assert.equal(pollInterval(now, now + 3600000, status), 2000)
  assert.equal(pollInterval(now, now + 600000, 'completed'), 60000)
})

test('finished sessions back off while unfinished requests stay on two-second polling', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pulse-idle-'))
  let wake
  let closed = false
  const source = createVSCodeSource(root, {
    watchChanges: (_root, _options, listener) => {
      wake = listener
      return {
        on() {},
        close() {
          closed = true
        },
      }
    },
  })
  try {
    const workspace = path.join(root, 'workspace-one')
    const transcripts = path.join(workspace, 'GitHub.copilot-chat', 'transcripts')
    await fs.mkdir(transcripts, { recursive: true })
    await fs.writeFile(
      path.join(workspace, 'workspace.json'),
      JSON.stringify({ folder: pathToFileURL(root).href }),
    )
    const filename = path.join(transcripts, 'session-one.jsonl')
    const event = (type, at) =>
      JSON.stringify({ type, data: {}, timestamp: new Date(at).toISOString() }) + '\n'
    await fs.writeFile(filename, event('session.error', now - 900000))
    assert.equal((await source.scan(now)).sessions[0].status, 'failed')
    await fs.appendFile(filename, event('assistant.turn_start', now + 1000))
    assert.equal((await source.scan(now + 1000)).sessions[0].status, 'failed')
    wake('change', 'session-one.jsonl')
    assert.equal((await source.scan(now + 1000)).sessions[0].status, 'running')
    await fs.appendFile(filename, event('session.error', now + 2000))
    assert.equal((await source.scan(now + 2000)).sessions[0].status, 'running')
    assert.equal((await source.scan(now + 3000)).sessions[0].status, 'failed')
    await fs.appendFile(filename, event('assistant.turn_start', now + 3100))
    assert.equal((await source.scan(now + 3100, { force: true })).sessions[0].status, 'running')
    await source.scan(now + 900000)
    await fs.appendFile(filename, event('session.error', now + 900001))
    assert.equal((await source.scan(now + 901999)).sessions[0].status, 'idle')
    assert.equal((await source.scan(now + 902000)).sessions[0].status, 'failed')
    await source.scan(now + 1800000)
    await fs.appendFile(filename, event('assistant.turn_start', now + 1800001))
    assert.equal((await source.scan(now + 1859999)).sessions[0].status, 'failed')
    assert.equal((await source.scan(now + 1860000)).sessions[0].status, 'running')
  } finally {
    source.close()
    assert.equal(closed, true)
    await fs.rm(root, { recursive: true, force: true })
  }
})
