const fs = require('node:fs/promises')
const path = require('node:path')
const { parser } = require('stream-json/parser.js')

async function validateSavedChat(filename, sessionId, expiresAt) {
  const stream = parser.asStream({ packValues: false })
  const header = {}
  const stack = []
  let scalar
  let handle
  let complete = false
  const required = ['kind', 'sessionId', 'creationDate', 'responderUsername', 'requests']
  stream.on('error', () => {})
  const field = () => {
    if (stack.length === 1 && stack[0].key === 'kind') return 'kind'
    if (stack.length === 2 && stack[0].key === 'v') return stack[1].key
    return undefined
  }
  stream.on('data', (token) => {
    if (token.name === 'startObject' || token.name === 'startArray') {
      if (stack.length >= 256) {
        stream.destroy(new Error('Saved chat nesting exceeds the validation limit.'))
        return
      }
      const name = field()
      if (required.includes(name)) header[name] = undefined
      if (name === 'requests') header.requests = token.name === 'startArray'
      stack.push({ key: undefined })
    } else if (token.name === 'endObject' || token.name === 'endArray') {
      stack.pop()
    } else if (['startKey', 'startString', 'startNumber'].includes(token.name)) {
      scalar = { type: token.name, field: field(), text: '' }
      if (token.name !== 'startKey' && required.includes(scalar.field))
        header[scalar.field] = undefined
    } else if (token.name === 'stringChunk' || token.name === 'numberChunk') {
      if (
        scalar.type === 'startKey'
          ? stack.length <= 2
          : ['kind', 'creationDate', 'sessionId'].includes(scalar.field)
      )
        scalar.text += token.value.slice(0, Math.max(0, 128 - scalar.text.length))
    } else if (token.name === 'endKey') {
      stack.at(-1).key = scalar.text
      scalar = undefined
    } else if (token.name === 'endString' || token.name === 'endNumber') {
      if (scalar.field === 'responderUsername')
        header.responderUsername = token.name === 'endString'
      else if (['kind', 'creationDate', 'sessionId'].includes(scalar.field))
        header[scalar.field] = token.name === 'endNumber' ? Number(scalar.text) : scalar.text
      scalar = undefined
    } else if (['nullValue', 'trueValue', 'falseValue'].includes(token.name)) {
      const name = field()
      if (required.includes(name)) header[name] = undefined
    }
  })
  try {
    handle = await fs.open(filename, 'r')
    while (true) {
      if (Date.now() > expiresAt) throw new Error('The navigation request expired.')
      const buffer = Buffer.alloc(65536)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (!bytesRead) break
      const chunk = buffer.subarray(0, bytesRead)
      const boundary = chunk.indexOf(10)
      const part = boundary < 0 ? chunk : chunk.subarray(0, boundary)
      await new Promise((resolve, reject) =>
        stream.write(part, (error) => (error ? reject(error) : resolve())),
      )
      if (boundary >= 0) {
        complete = true
        break
      }
    }
    await new Promise((resolve, reject) =>
      stream.end((error) => (error ? reject(error) : resolve())),
    )
  } catch (error) {
    if (error.message === 'The navigation request expired.') throw error
    throw new Error('The saved chat is incomplete or unreadable.')
  } finally {
    stream.destroy()
    await handle?.close()
  }
  if (!complete) throw new Error('The saved chat is incomplete or unreadable.')
  if (
    header.kind !== 0 ||
    header.sessionId !== sessionId ||
    !Number.isFinite(header.creationDate) ||
    header.requests !== true ||
    header.responderUsername !== true
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
    await validateSavedChat(filename, sessionId, expiresAt)
    const commands = await vscode.commands.getCommands(true)
    if (
      !['vscode.open', 'workbench.action.focusWindow', 'workbench.action.chat.openInSidebar'].every(
        (command) => commands.includes(command),
      )
    )
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
    await vscode.commands.executeCommand('workbench.action.chat.openInSidebar')
    return {
      ok: true,
      windowFocused: vscode.window.state.focused === true,
      message:
        'Requested this saved session in the VS Code Chat sidebar. Input focus is not independently verified.',
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
