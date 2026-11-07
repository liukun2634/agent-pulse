const fs = require('node:fs/promises')
const path = require('node:path')

async function validateSavedChat(filename, sessionId) {
  const handle = await fs.open(filename, 'r')
  const chunks = []
  let length = 0
  try {
    while (true) {
      const buffer = Buffer.alloc(65536)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      const chunk = buffer.subarray(0, bytesRead)
      const boundary = chunk.indexOf(10)
      const part = boundary < 0 ? chunk : chunk.subarray(0, boundary)
      length += part.length
      if (length > 32 * 1024 * 1024)
        throw new Error('The saved chat header exceeds the validation limit.')
      chunks.push(part)
      if (boundary >= 0) break
    }
  } finally {
    await handle.close()
  }
  let header
  try {
    header = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('The saved chat is incomplete or unreadable.')
  }
  if (
    header.kind !== 0 ||
    header.v?.sessionId !== sessionId ||
    !Number.isFinite(header.v.creationDate) ||
    !Array.isArray(header.v.requests) ||
    typeof header.v.responderUsername !== 'string'
  )
    throw new Error('The saved chat format could not be verified. No new chat was created.')
}

function createChatNavigator(vscode, workspaceStoragePath) {
  let queue = Promise.resolve()
  async function open(sessionId, expiresAt) {
    if (
      !/^[a-zA-Z0-9-]{1,100}$/.test(sessionId) ||
      !Number.isFinite(expiresAt) ||
      Date.now() > expiresAt
    )
      throw new Error('The navigation request is invalid or expired.')
    if (!/^1\.(141|143)\./.test(vscode.version))
      throw new Error(
        'This experimental bridge currently targets VS Code 1.141.x and 1.143.x only.',
      )
    const filename = path.join(workspaceStoragePath, 'chatSessions', `${sessionId}.jsonl`)
    let stat
    try {
      stat = await fs.stat(filename)
    } catch {
      throw new Error('This session has no saved chat in this window. No new chat was created.')
    }
    if (!stat.isFile() || !stat.size) throw new Error('The saved chat is unavailable.')
    await validateSavedChat(filename, sessionId)
    const commands = await vscode.commands.getCommands(true)
    if (!commands.includes('vscode.open') || !commands.includes('workbench.action.focusWindow'))
      throw new Error('This VS Code window does not support the required opening commands.')
    if (Date.now() > expiresAt) throw new Error('The navigation request expired.')
    const resource = vscode.Uri.from({
      scheme: 'vscode-chat-session',
      authority: 'local',
      path: `/${Buffer.from(sessionId, 'utf8').toString('base64url')}`,
    })
    await vscode.commands.executeCommand('workbench.action.focusWindow')
    await vscode.commands.executeCommand('vscode.open', resource, {
      preview: false,
      preserveFocus: false,
    })
    return {
      ok: true,
      windowFocused: vscode.window.state.focused === true,
      message:
        'Requested this saved Chat in the registered VS Code window. VS Code controls its editor/input focus; that focus is not independently verified.',
    }
  }
  return {
    open(sessionId, expiresAt) {
      const next = queue.then(() => open(sessionId, expiresAt))
      queue = next.catch(() => {})
      return next
    },
  }
}

module.exports = { createChatNavigator }
