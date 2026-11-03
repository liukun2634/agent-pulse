const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  createTranscript,
  applyEvent,
  toSession,
  createVSCodeSource,
  pollInterval,
} = require('../electron/vscode-sessions.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { tmpdir } = require('node:os')
const { pathToFileURL } = require('node:url')

const now = Date.parse('2026-11-03T10:00:00Z')
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
  assert.equal(toSession(state, now + 121000).status, 'unknown')
  applyEvent(state, { type: 'session.error', timestamp: 'invalid' })
  assert.equal(toSession(state, now).status, 'running')
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
    assert.match(source.workspaceUri(snapshot.sessions[0].id), /^vscode:\/\/file\//)
    assert.equal(source.workspaceUri('untrusted'), undefined)

    const message = Buffer.from(event('user.message', { content: '\u4f60\u597d' }))
    const split = message.indexOf(Buffer.from('\u4f60')) + 1
    await fs.appendFile(filename, message.subarray(0, split))
    assert.equal((await scan()).sessions[0].status, 'unknown')
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
    assert.equal(source.workspaceUri(snapshot.sessions[0].id), undefined)
  } finally {
    source.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('missing storage is explicit and never falls back to demo data', async () => {
  const source = createVSCodeSource(path.join(tmpdir(), `pulse-missing-${Date.now()}`))
  const snapshot = await source.scan(now)
  assert.equal(snapshot.state, 'unavailable')
  assert.deepEqual(snapshot.sessions, [])
})

test('polling backs off with inactivity and clamps future timestamps', () => {
  assert.equal(pollInterval(now, now), 2000)
  assert.equal(pollInterval(now, now + 30000), 5000)
  assert.equal(pollInterval(now, now + 120000), 15000)
  assert.equal(pollInterval(now, now + 600000), 60000)
  assert.equal(pollInterval(now + 1000, now), 2000)
})

test('idle reads back off, file changes wake them, and refresh bypasses the delay', async () => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pulse-idle-'))
  let wake
  let closed = false
  const source = createVSCodeSource(root, 'vscode', {
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
    await fs.writeFile(filename, event('assistant.turn_start', now - 900000))
    assert.equal((await source.scan(now)).sessions[0].status, 'unknown')
    await fs.appendFile(filename, event('assistant.turn_start', now + 1000))
    assert.equal((await source.scan(now + 1000)).sessions[0].status, 'unknown')
    wake('change', 'session-one.jsonl')
    assert.equal((await source.scan(now + 1000)).sessions[0].status, 'running')
    await fs.appendFile(filename, event('session.error', now + 2000))
    assert.equal((await source.scan(now + 2000)).sessions[0].status, 'running')
    assert.equal((await source.scan(now + 3000)).sessions[0].status, 'failed')
    await fs.appendFile(filename, event('assistant.turn_start', now + 3100))
    assert.equal((await source.scan(now + 3100, { force: true })).sessions[0].status, 'running')
    await source.scan(now + 900000)
    await fs.appendFile(filename, event('session.error', now + 900001))
    assert.equal((await source.scan(now + 959999)).sessions[0].status, 'unknown')
    assert.equal((await source.scan(now + 960000)).sessions[0].status, 'failed')
  } finally {
    source.close()
    assert.equal(closed, true)
    await fs.rm(root, { recursive: true, force: true })
  }
})
