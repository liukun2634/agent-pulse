const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const vscode = require('vscode')
const { listWindows, send } = require('../vscode-session-bridge/protocol.cjs')

async function run() {
  const extension = vscode.extensions.getExtension('agent-pulse-local.pulse-session-bridge')
  assert.ok(extension)
  const api = await extension.activate()
  assert.ok(api?.workspaceStoragePath)
  const sessionId = randomUUID()
  const title = `Pulse smoke ${sessionId.slice(0, 8)}`
  const directory = path.join(api.workspaceStoragePath, 'chatSessions')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    path.join(directory, `${sessionId}.jsonl`),
    JSON.stringify({
      kind: 0,
      v: {
        version: 3,
        sessionId,
        creationDate: Date.now(),
        lastMessageDate: Date.now(),
        responderUsername: 'Assistant',
        initialLocation: 'panel',
        customTitle: title,
        requests: [],
      },
    }) + '\n',
  )
  const windows = await listWindows(process.env.PULSE_SESSION_BRIDGE_TEST_REGISTRY)
  assert.equal(windows.length, 1)
  const result = await send(windows[0], {
    version: 1,
    requestId: randomUUID(),
    instanceId: api.instanceId,
    workspaceStoragePath: api.workspaceStoragePath,
    sessionId,
  })
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab
  const report = {
    vscodeVersion: vscode.version,
    result,
    activeTabLabel: tab?.label,
    activeInputType: tab?.input?.constructor?.name,
    inputKeys: tab?.input ? Object.keys(tab.input) : [],
    activeEditorScheme: vscode.window.activeTextEditor?.document.uri.scheme,
  }
  await fs.writeFile(process.env.PULSE_SESSION_BRIDGE_TEST_OUTPUT, JSON.stringify(report, null, 2))
  assert.equal(result.ok, true, result.message)
  assert.equal(tab?.label, title, 'The controlled saved session was not the active Chat editor.')
  const firstCount = vscode.window.tabGroups.all.reduce(
    (count, group) => count + group.tabs.length,
    0,
  )
  const repeated = await send(windows[0], {
    version: 1,
    requestId: randomUUID(),
    instanceId: api.instanceId,
    workspaceStoragePath: api.workspaceStoragePath,
    sessionId,
  })
  assert.equal(repeated.ok, true)
  assert.equal(
    vscode.window.tabGroups.all.reduce((count, group) => count + group.tabs.length, 0),
    firstCount,
  )
}

module.exports = { run }
