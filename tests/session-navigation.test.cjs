const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { createSessionNavigator } = require('../electron/session-navigation.cjs')
const { sessionReference } = require('../electron/session-alerts.cjs')
const { isTrustedRequest } = require('../vscode-session-bridge/protocol.cjs')
const { createTerminalNavigator } = require('../electron/terminal-navigation.cjs')

test('Claude navigation requires an explicit terminal choice and reuses only the same process binding', async () => {
  const current = {
    id: 'claude:one',
    source: 'claude',
    requestId: 'round',
    status: 'waiting',
    updatedAt: 1,
  }
  let target = { sessionId: 'one', pid: 12345, startedAt: 1000 }
  const reference = sessionReference(current)
  const calls = []
  const result = {
    processStart: '1000',
    hostStart: '500',
    choices: [
      { windowHandle: '100', tabId: '42.1', label: 'First tab' },
      { windowHandle: '100', tabId: '42.2', label: 'Second tab' },
    ],
  }
  const navigator = createTerminalNavigator({
    platform: 'win32',
    getSession: () => current,
    resolveTarget: () => target,
    run: async (action, _target, selection) => {
      calls.push({ action, selection })
      return action === 'inspect'
        ? result
        : {
            ...result,
            choices: undefined,
            focused: true,
            windowFocused: true,
            selection: { ...selection, paneId: '42.3' },
          }
    },
  })
  const offered = await navigator.reveal(current.id, reference)
  assert.equal(offered.mode, 'ambiguous')
  assert.equal(offered.windows.length, 2)
  assert.deepEqual(
    calls.map((call) => call.action),
    ['inspect'],
  )
  assert.equal((await navigator.reveal(current.id, reference, 'unknown')).mode, 'stale')
  assert.equal(calls.length, 1)
  assert.equal(
    (await navigator.reveal(current.id, reference, offered.windows[1].instanceId)).mode,
    'requested',
  )
  assert.equal(calls[1].selection.tabId, '42.2')
  assert.equal((await navigator.reveal(current.id, reference)).mode, 'requested')
  assert.equal(calls[2].action, 'focus')
  assert.equal(calls[2].selection.paneId, '42.3')
  target = { ...target, startedAt: 2000 }
  assert.equal((await navigator.reveal(current.id, reference)).mode, 'ambiguous')
  assert.equal(calls.at(-1).action, 'inspect')
})

test('Claude navigation rejects changed requests, missing processes and failed native focus', async () => {
  let current = {
    id: 'claude:one',
    source: 'claude',
    requestId: 'round',
    status: 'waiting',
    updatedAt: 1,
  }
  let target = { sessionId: 'one', pid: 12345, startedAt: 1000 }
  const reference = sessionReference(current)
  let focusCalls = 0
  const navigator = createTerminalNavigator({
    platform: 'win32',
    getSession: () => current,
    resolveTarget: () => target,
    run: async (action) => {
      if (action === 'focus') {
        focusCalls++
        throw new Error('Closed')
      }
      return {
        processStart: '1000',
        hostStart: '500',
        choices: [{ windowHandle: '100', tabId: '42.1', label: 'Tab' }],
      }
    },
  })
  const offered = await navigator.reveal(current.id, reference)
  current = { ...current, requestId: 'new-round' }
  assert.equal(
    (await navigator.reveal(current.id, reference, offered.windows[0].instanceId)).mode,
    'stale',
  )
  assert.equal(focusCalls, 0)
  current = { ...current, requestId: 'round' }
  assert.equal(
    (await navigator.reveal(current.id, reference, offered.windows[0].instanceId)).mode,
    'unavailable',
  )
  assert.equal(focusCalls, 1)
  target = null
  assert.equal((await navigator.reveal(current.id, reference)).mode, 'unavailable')
})

test('Claude split panes require a second choice and a changed process during refresh is rejected', async () => {
  const current = {
    id: 'claude:split',
    source: 'claude',
    requestId: 'round',
    status: 'waiting',
    updatedAt: 1,
  }
  let target = { sessionId: 'split', pid: 12345, startedAt: 1000 }
  let changeProcess = false
  let calls = 0
  const base = { processStart: '1000', hostStart: '500' }
  const tab = { windowHandle: '100', tabId: '42.1', label: 'Selected tab' }
  const navigator = createTerminalNavigator({
    platform: 'win32',
    getSession: () => current,
    resolveTarget: () => target,
    refresh: async () => {
      if (changeProcess) target = { ...target, pid: 54321 }
    },
    run: async (action, _target, selection) => {
      calls++
      if (action === 'inspect') return { ...base, choices: [tab] }
      if (!selection.paneId)
        return {
          ...base,
          choices: [
            { ...tab, paneId: '42.2', label: 'Left pane' },
            { ...tab, paneId: '42.3', label: 'Right pane' },
          ],
        }
      return { ...base, focused: true, windowFocused: true, selection }
    },
  })
  const reference = sessionReference(current)
  const tabs = await navigator.reveal(current.id, reference)
  const panes = await navigator.reveal(current.id, reference, tabs.windows[0].instanceId)
  assert.equal(panes.mode, 'ambiguous')
  assert.equal(panes.windows.length, 2)
  assert.equal(
    (await navigator.reveal(current.id, reference, panes.windows[1].instanceId)).mode,
    'requested',
  )
  changeProcess = true
  assert.equal((await navigator.reveal(current.id, reference)).mode, 'stale')
  assert.equal(calls, 3)
})

test('Claude navigation does not report success when Windows refuses foreground focus', async () => {
  const current = {
    id: 'claude:focus',
    source: 'claude',
    requestId: 'round',
    status: 'waiting',
    updatedAt: 1,
  }
  const target = { sessionId: 'focus', pid: 12345, startedAt: 1000 }
  const navigator = createTerminalNavigator({
    platform: 'win32',
    getSession: () => current,
    resolveTarget: () => target,
    run: async (action, _target, selection) =>
      action === 'inspect'
        ? {
            processStart: '1000',
            hostStart: '500',
            choices: [{ windowHandle: '100', tabId: '42.1', label: 'Tab' }],
          }
        : {
            processStart: '1000',
            hostStart: '500',
            focused: true,
            windowFocused: false,
            selection: { ...selection, paneId: '42.2' },
          },
  })
  const reference = sessionReference(current)
  const offered = await navigator.reveal(current.id, reference)
  assert.equal(
    (await navigator.reveal(current.id, reference, offered.windows[0].instanceId)).mode,
    'unavailable',
  )
  assert.equal((await navigator.reveal(current.id, reference)).mode, 'ambiguous')
})

test('shared navigation routes Claude without using the VS Code bridge', async () => {
  const current = {
    id: 'claude:one',
    source: 'claude',
    requestId: 'round',
    status: 'waiting',
    updatedAt: 1,
  }
  let calls = 0
  const navigator = createSessionNavigator({
    getSession: () => current,
    resolveTarget: () => assert.fail('VS Code resolver must not run'),
    listWindows: () => assert.fail('VS Code window discovery must not run'),
    revealTerminal: async (id, reference, chosen) => {
      calls++
      assert.equal(id, current.id)
      assert.equal(reference.requestId, 'round')
      assert.equal(chosen, 'choice')
      return { mode: 'requested', windowFocused: true }
    },
  })
  assert.equal(
    (await navigator.reveal(current.id, sessionReference(current), 'choice')).mode,
    'requested',
  )
  assert.equal(
    (
      await navigator.reveal(
        current.id,
        { ...sessionReference(current), requestId: 'old' },
        'choice',
      )
    ).mode,
    'stale',
  )
  assert.equal(calls, 1)
})

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
  let chatViewNavigation = false
  const navigator = createSessionNavigator({
    getSession: () => current,
    resolveTarget: () => target,
    listWindows: async () => [
      { ...target, instanceId: 'first', label: 'Window one', chatViewNavigation },
      { ...target, instanceId: 'second', label: 'Window two', chatViewNavigation },
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
  const outdated = await navigator.reveal(current.id, reference, 'second')
  assert.equal(outdated.mode, 'unavailable')
  assert.match(outdated.message, /Reload/)
  assert.equal(calls, 0)
  chatViewNavigation = true
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
    listWindows: async () => [
      { ...target, instanceId: 'one', label: 'Original window', chatViewNavigation: true },
    ],
    send: async (_window, request) => {
      current = { ...current, requestId: 'new', finishedAt: 20 }
      return request
    },
  })
  assert.equal((await navigator.reveal(current.id, reference)).mode, 'stale')
})

test('bridge reveals only an existing saved resource in Chat without sending input or changing layout', async () => {
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
      getCommands: async () => [
        'vscode.open',
        'workbench.action.focusWindow',
        'workbench.action.chat.openInSidebar',
      ],
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
      ['workbench.action.focusWindow', 'vscode.open', 'workbench.action.chat.openInSidebar'],
    )
    assert.equal(calls[1][1].path, `/${Buffer.from('existing').toString('base64url')}`)
    assert.equal(calls[1][2].preserveFocus, false)
    const header =
      '{"kind":0,"v":{"sessionId":"existing","creationDate":1,"responderUsername":"Assistant","requests":[]'
    for (const invalid of [
      `${header},"sessionId":null}}\n`,
      `${header},"sessionId":"other"}}\n`,
      `${header},"requests":null}}\n`,
      `${header},"responderUsername":{}}}\n`,
      `${header}}}`,
      `${header},"unfinished":"`,
    ]) {
      await fs.writeFile(saved, invalid)
      await assert.rejects(
        navigator.open('existing', Date.now() + 5000),
        /incomplete|could not be verified/,
      )
      assert.equal(calls.length, 3)
    }
    await fs.writeFile(
      saved,
      '{"kind":0,"v":{"sessionId":"existing","creationDate":1,"responderUsername":"Assistant","requests":[{"response":"',
    )
    await fs.appendFile(saved, Buffer.alloc(36 * 1024 * 1024, 120))
    await fs.appendFile(saved, '"}]}}\n')
    assert.equal((await navigator.open('existing', Date.now() + 5000)).ok, true)
    assert.equal(calls.length, 6)
    api.version = '1.144.0'
    await assert.rejects(navigator.open('existing', Date.now() + 1000), /1.143/)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
})
