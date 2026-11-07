const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { createSessionNavigator } = require('../electron/session-navigation.cjs')
const { sessionReference } = require('../electron/session-alerts.cjs')
const { isTrustedRequest } = require('../vscode-session-bridge/protocol.cjs')

test('bridge rejects malformed or expired packets before accessing navigation fields', () => {
  const registration = {
    instanceId: 'original',
    token: 'a'.repeat(64),
    workspaceStoragePath: path.resolve('test-storage'),
  }
  const valid = {
    ...registration,
    version: 1,
    requestId: 'request-one',
    sessionId: 'session-one',
    expiresAt: 2000,
  }
  assert.equal(isTrustedRequest(valid, registration, 1000), true)
  for (const invalid of [
    null,
    [],
    'text',
    1,
    {},
    { ...valid, token: null },
    { ...valid, token: 'b'.repeat(64) },
    { ...valid, expiresAt: 999 },
    { ...valid, expiresAt: 100000 },
    { ...valid, instanceId: 'other' },
    { ...valid, sessionId: '../other' },
    { ...valid, workspaceStoragePath: '.' },
  ])
    assert.equal(isTrustedRequest(invalid, registration, 1000), false)
})

test('navigation requires exact storage identity and explicit selection for duplicate windows', async () => {
  const current = {
    id: 'vscode:one:session',
    source: 'vscode',
    status: 'waiting',
    requestId: 'round',
    updatedAt: 1,
  }
  const target = { workspaceStoragePath: path.resolve('test-storage', 'one'), sessionId: 'session' }
  let calls = 0
  const navigator = createSessionNavigator({
    getSession: () => current,
    resolveTarget: () => target,
    listWindows: async () => [
      { ...target, instanceId: 'first', label: 'Window one' },
      { ...target, instanceId: 'second', label: 'Window two' },
      {
        workspaceStoragePath: path.resolve('other-storage', 'one'),
        instanceId: 'unrelated',
        label: 'Window one',
      },
    ],
    send: async (window, request) => {
      calls++
      return {
        ...request,
        ok: true,
        windowFocused: true,
        inputFocused: true,
        instanceId: window.instanceId,
      }
    },
  })
  const reference = sessionReference(current)
  const choices = await navigator.reveal(current.id, reference)
  assert.equal(choices.mode, 'ambiguous')
  assert.equal(choices.windows.length, 2)
  assert.equal(calls, 0)
  assert.equal((await navigator.reveal(current.id, reference, 'unrelated')).mode, 'unavailable')
  assert.equal((await navigator.reveal(current.id, reference, 'second')).mode, 'requested')
  assert.equal(calls, 1)
  current.requestId = 'new-round'
  assert.equal((await navigator.reveal(current.id, reference, 'second')).mode, 'stale')
  assert.equal(calls, 1)
})

test('a late response cannot acknowledge a new request or claim verified input focus', async () => {
  let current = {
    id: 'vscode:one:session',
    source: 'vscode',
    status: 'completed',
    requestId: 'old',
    finishedAt: 10,
    updatedAt: 10,
  }
  const reference = sessionReference(current)
  const target = { workspaceStoragePath: path.resolve('test-storage', 'one'), sessionId: 'session' }
  const navigator = createSessionNavigator({
    getSession: () => current,
    resolveTarget: () => target,
    listWindows: async () => [{ ...target, instanceId: 'one', label: 'Original window' }],
    send: async (_window, request) => {
      current = { ...current, requestId: 'new', finishedAt: 20 }
      return request
    },
  })
  assert.equal((await navigator.reveal(current.id, reference)).mode, 'stale')
})

test('bridge opens only an existing saved resource and does not issue chat input or move commands', async () => {
  const fs = require('node:fs/promises')
  const { tmpdir } = require('node:os')
  const { createChatNavigator } = require('../vscode-session-bridge/navigation.cjs')
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pulse-navigation-'))
  const calls = []
  const api = {
    version: '1.143.1',
    Uri: { from: (value) => value },
    window: { state: { focused: true } },
    commands: {
      getCommands: async () => ['vscode.open', 'workbench.action.focusWindow'],
      executeCommand: async (...args) => {
        calls.push(args)
      },
    },
  }
  try {
    const navigator = createChatNavigator(api, root)
    await assert.rejects(navigator.open('missing', Date.now() + 1000), /no saved chat/)
    assert.equal(calls.length, 0)
    await fs.mkdir(path.join(root, 'chatSessions'))
    const saved = path.join(root, 'chatSessions', 'existing.jsonl')
    await fs.writeFile(saved, '{"kind":0,"v":{"requests":[]}}\n')
    await assert.rejects(navigator.open('existing', Date.now() + 1000), /could not be verified/)
    assert.equal(calls.length, 0)
    await fs.writeFile(
      saved,
      JSON.stringify({
        kind: 0,
        v: {
          sessionId: 'existing',
          creationDate: Date.now(),
          responderUsername: 'Assistant',
          requests: [],
        },
      }) + '\n',
    )
    const result = await navigator.open('existing', Date.now() + 1000)
    assert.equal(result.ok, true)
    assert.equal(result.inputFocused, undefined)
    assert.deepEqual(
      calls.map((call) => call[0]),
      ['workbench.action.focusWindow', 'vscode.open'],
    )
    assert.equal(calls[1][1].path, `/${Buffer.from('existing').toString('base64url')}`)
    assert.equal(calls[1][2].preserveFocus, false)
    api.version = '1.144.0'
    await assert.rejects(navigator.open('existing', Date.now() + 1000), /1.143/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
