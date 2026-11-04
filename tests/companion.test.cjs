const assert = require('node:assert/strict')
const { test } = require('node:test')
const { createChatNavigator } = require('../vscode-companion/navigation.cjs')
const { endpointPath, openSession } = require('../vscode-companion/bridge.cjs')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { randomUUID } = require('node:crypto')

function fixture({
  available = true,
  unrelated = false,
  stays = false,
  focus = false,
  delayed = false,
} = {}) {
  class TabInputChat {}
  const group = { activeTab: null, tabs: [] }
  const calls = []
  let listener
  const vscode = {
    TabInputChat,
    window: {
      tabGroups: {
        all: [group],
        activeTabGroup: group,
        onDidChangeTabs(callback) {
          listener = callback
          return {
            dispose() {
              listener = undefined
            },
          }
        },
      },
    },
    commands: {
      async getCommands() {
        return [
          ...(available ? ['workbench.action.chat.openInSidebar'] : []),
          ...(focus ? ['workbench.action.focusWindow'] : []),
        ]
      },
      async executeCommand(command, ...args) {
        calls.push({ command, args })
        if (command === 'vscode.open') {
          const tab = { input: new TabInputChat() }
          group.tabs.push(tab)
          group.activeTab = tab
          listener({ opened: [tab] })
          if (unrelated) group.activeTab = { input: new TabInputChat() }
        } else if (command === 'workbench.action.chat.openInSidebar' && !stays) {
          const tab = group.activeTab
          const close = () => {
            group.tabs = group.tabs.filter((item) => item !== tab)
            group.activeTab = null
            listener?.({ opened: [], closed: [tab] })
          }
          if (delayed) setImmediate(close)
          else close()
        }
      },
    },
  }
  return { navigator: createChatNavigator(vscode), calls, group }
}

test('opens the requested chat then moves that tab to Chat view without sending input', async () => {
  const { navigator, calls, group } = fixture()
  const result = await navigator.open('vscode-chat-session://local/one')
  assert.deepEqual(result, { mode: 'chat-view', verified: true })
  assert.deepEqual(
    calls.map((call) => call.command),
    ['vscode.open', 'workbench.action.chat.openInSidebar'],
  )
  assert.equal(calls[0].args[0], 'vscode-chat-session://local/one')
  assert.equal(group.tabs.length, 0)
})

test('missing sidebar command preserves the verified editor fallback', async () => {
  const { navigator, calls } = fixture({ available: false })
  const result = await navigator.open('one')
  assert.equal(result.mode, 'chat-editor')
  assert.equal(result.verified, true)
  assert.equal(calls.length, 1)
})

test('waits for the asynchronous Chat tab close confirmation', async () => {
  const { navigator } = fixture({ delayed: true })
  assert.deepEqual(await navigator.open('one'), { mode: 'chat-view', verified: true })
})

test('bridge distinguishes registration, stale connection and missing-session failures', async () => {
  const workspace = path.join(os.tmpdir(), `pulse-bridge-${randomUUID()}`)
  const filename = endpointPath(workspace)
  const pipe =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\pulse-test-${randomUUID()}`
      : path.join(os.tmpdir(), `pulse-${randomUUID()}.sock`)
  const server = net.createServer((socket) =>
    socket.once('data', () =>
      socket.end(
        JSON.stringify({
          ok: false,
          code: 'session-not-found',
          error: 'The requested session is not stored in this VS Code workspace.',
        }) + '\n',
      ),
    ),
  )
  try {
    await assert.rejects(openSession(workspace, 'vscode', 'one'), { code: 'not-registered' })
    await fs.mkdir(path.dirname(filename), { recursive: true })
    await fs.writeFile(filename, JSON.stringify({ pipe, token: 'test-token' }))
    await assert.rejects(openSession(workspace, 'vscode', 'one'), { code: 'stale-connection' })
    await new Promise((resolve) => server.listen(pipe, resolve))
    await assert.rejects(openSession(workspace, 'vscode', 'one'), { code: 'session-not-found' })
  } finally {
    server.close()
    await fs.rm(filename, { force: true })
  }
})

test('focuses its existing VS Code window without opening a folder or another window', async () => {
  const { navigator, calls } = fixture({ focus: true })
  assert.equal((await navigator.open('one')).mode, 'chat-view')
  assert.deepEqual(
    calls.map((call) => call.command),
    ['workbench.action.focusWindow', 'vscode.open', 'workbench.action.chat.openInSidebar'],
  )
})

test('never moves an unrelated active chat and does not claim verification', async () => {
  const { navigator, calls } = fixture({ unrelated: true })
  const result = await navigator.open('one')
  assert.equal(result.verified, false)
  assert.equal(calls.length, 1)
})

test('does not claim Chat view when the target editor remains, and serializes repeated requests', async () => {
  const retained = fixture({ stays: true })
  assert.equal((await retained.navigator.open('one')).mode, 'chat-editor')
  const { navigator, calls, group } = fixture()
  await Promise.all([navigator.open('one'), navigator.open('two')])
  assert.deepEqual(
    calls.map((call) => call.command),
    [
      'vscode.open',
      'workbench.action.chat.openInSidebar',
      'vscode.open',
      'workbench.action.chat.openInSidebar',
    ],
  )
  assert.equal(group.tabs.length, 0)
})
