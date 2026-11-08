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
  const otherSessionId = randomUUID()
  const otherTitle = `Other smoke ${otherSessionId.slice(0, 8)}`
  const directory = path.join(api.workspaceStoragePath, 'chatSessions')
  await fs.mkdir(directory, { recursive: true })
  for (const [savedId, savedTitle] of [
    [sessionId, title],
    [otherSessionId, otherTitle],
  ])
    await fs.writeFile(
      path.join(directory, `${savedId}.jsonl`),
      JSON.stringify({
        kind: 0,
        v: {
          version: 3,
          sessionId: savedId,
          creationDate: Date.now(),
          lastMessageDate: Date.now(),
          responderUsername: 'Assistant',
          initialLocation: 'panel',
          customTitle: savedTitle,
          requests: [],
        },
      }) + '\n',
    )
  const windows = await listWindows(process.env.PULSE_SESSION_BRIDGE_TEST_REGISTRY)
  assert.equal(windows.length, 1)
  assert.equal(windows[0].bridgeVersion, extension.packageJSON.version)
  assert.equal(windows[0].chatViewNavigation, true)
  const tabCount = () =>
    vscode.window.tabGroups.all.reduce((count, group) => count + group.tabs.length, 0)
  const before = tabCount()
  async function navigate(savedId) {
    const result = await send(windows[0], {
      version: 1,
      requestId: randomUUID(),
      instanceId: api.instanceId,
      workspaceStoragePath: api.workspaceStoragePath,
      sessionId: savedId,
    })
    assert.equal(result.ok, true, result.message)
    assert.equal(tabCount(), before, 'Navigation must not leave a new Chat editor tab.')
    await vscode.commands.executeCommand('workbench.action.chat.inspectChatModel')
    const inspection = vscode.window.activeTextEditor?.document.getText()
    assert.ok(inspection?.includes('## Full Chat Model'))
    const model = JSON.parse(
      inspection.split('## Full Chat Model')[1].split('```json\n')[1].split('\n```')[0],
    )
    assert.equal(model.sessionId, savedId, 'The Chat sidebar must contain the requested session.')
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
    assert.equal(tabCount(), before)
    return result
  }
  const result = await navigate(sessionId)
  await navigate(otherSessionId)
  await navigate(sessionId)
  await fs.writeFile(
    process.env.PULSE_SESSION_BRIDGE_TEST_OUTPUT,
    JSON.stringify(
      {
        vscodeVersion: vscode.version,
        result,
        sidebarSessionVerified: true,
        switchedFromOtherChat: true,
        editorTabsBefore: before,
        editorTabsAfter: tabCount(),
      },
      null,
      2,
    ),
  )
}

module.exports = { run }
