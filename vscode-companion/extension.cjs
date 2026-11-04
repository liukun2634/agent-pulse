const vscode = require('vscode')
const net = require('node:net')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { endpointPath } = require('./bridge.cjs')

async function activate(context) {
  const workspace = vscode.workspace.workspaceFile ?? vscode.workspace.workspaceFolders?.[0]?.uri
  let connection = 'No local workspace is open.'
  context.subscriptions.push(
    vscode.commands.registerCommand('pulseCompanion.status', () =>
      vscode.window.showInformationMessage(connection),
    ),
  )
  if (workspace?.scheme !== 'file' || !context.storageUri) return
  const descriptor = endpointPath(workspace.fsPath, vscode.env.uriScheme)
  const token = randomBytes(32).toString('hex')
  const pipe =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\pulse-${randomBytes(16).toString('hex')}`
      : path.join(path.dirname(descriptor), `${randomBytes(12).toString('hex')}.sock`)
  const sockets = new Set()
  const output = vscode.window.createOutputChannel('Pulse Companion')
  context.subscriptions.push(output)
  await fs.mkdir(path.dirname(descriptor), { recursive: true, mode: 0o700 })
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    socket.setTimeout(8000, () => socket.destroy())
    let input = ''
    let handled = false
    socket.on('data', async (chunk) => {
      if (handled) return
      input += chunk.toString('utf8')
      if (input.length > 4096) return socket.destroy()
      if (!input.includes('\n')) return
      handled = true
      try {
        const request = JSON.parse(input.slice(0, input.indexOf('\n')))
        if (
          request.token !== token ||
          typeof request.sessionId !== 'string' ||
          !/^[a-zA-Z0-9-]{1,100}$/.test(request.sessionId)
        )
          throw new Error('Invalid request.')
        const filename = path.join(
          path.dirname(context.storageUri.fsPath),
          'chatSessions',
          `${request.sessionId}.jsonl`,
        )
        await fs.access(filename)
        const resource = vscode.Uri.parse(
          `vscode-chat-session://local/${Buffer.from(request.sessionId).toString('base64url')}`,
        )
        await vscode.commands.executeCommand('vscode.open', resource, {
          preview: false,
          preserveFocus: false,
        })
        await vscode.commands.executeCommand('workbench.action.chat.focusInput').catch(() => {})
        output.appendLine(`Opened session ${request.sessionId}`)
        socket.end(JSON.stringify({ ok: true }) + '\n')
      } catch (error) {
        output.appendLine(`Open failed: ${error.message}`)
        socket.end(
          JSON.stringify({
            ok: false,
            error: 'This session could not be opened in this VS Code window.',
          }) + '\n',
        )
      }
    })
  })
  server.on('error', (error) => output.appendLine(error.message))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipe, resolve)
  })
  await fs.writeFile(descriptor, JSON.stringify({ pipe, token }), { mode: 0o600 })
  connection = `Pulse is connected to ${path.basename(workspace.fsPath)}.`
  output.appendLine(connection)
  context.subscriptions.push({
    dispose() {
      for (const socket of sockets) socket.destroy()
      server.close()
      void fs
        .readFile(descriptor, 'utf8')
        .then((value) => {
          if (JSON.parse(value).token === token) return fs.unlink(descriptor)
        })
        .catch(() => {})
      if (process.platform !== 'win32') void fs.unlink(pipe).catch(() => {})
    },
  })
}

module.exports = { activate }
