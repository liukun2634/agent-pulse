const vscode = require('vscode')
const net = require('node:net')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { endpointPath } = require('./bridge.cjs')
const { createChatNavigator } = require('./navigation.cjs')

async function activate(context) {
  const navigator = createChatNavigator(vscode)
  const workspace = vscode.workspace.workspaceFile ?? vscode.workspace.workspaceFolders?.[0]?.uri
  let connection = 'No local workspace is open.'
  let refreshRegistration = async () => {}
  context.subscriptions.push(
    vscode.commands.registerCommand('pulseCompanion.status', async () => {
      try {
        await refreshRegistration()
        await vscode.window.showInformationMessage(connection)
      } catch {
        await vscode.window.showErrorMessage(
          'Pulse could not refresh its local connection. Reload this VS Code window and retry.',
        )
      }
    }),
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
          throw Object.assign(new Error('Invalid Companion request.'), { code: 'invalid-request' })
        const filename = path.join(
          path.dirname(context.storageUri.fsPath),
          'chatSessions',
          `${request.sessionId}.jsonl`,
        )
        try {
          await fs.access(filename)
        } catch (error) {
          throw Object.assign(
            new Error(
              error.code === 'ENOENT'
                ? 'The requested session is not stored in this VS Code workspace or profile. Open its original workspace and retry.'
                : 'VS Code cannot read the requested session storage.',
            ),
            { code: error.code === 'ENOENT' ? 'session-not-found' : 'session-unreadable' },
          )
        }
        const resource = vscode.Uri.parse(
          `vscode-chat-session://local/${Buffer.from(request.sessionId).toString('base64url')}`,
        )
        const result = await navigator.open(resource)
        output.appendLine(
          `Opened session ${request.sessionId}: ${result.mode}, verified=${result.verified}`,
        )
        socket.end(JSON.stringify({ ok: true, sessionId: request.sessionId, ...result }) + '\n')
      } catch (error) {
        output.appendLine(`Open failed: ${error.message}`)
        socket.end(
          JSON.stringify({
            ok: false,
            code: ['invalid-request', 'session-not-found', 'session-unreadable'].includes(
              error.code,
            )
              ? error.code
              : 'navigation-failed',
            error: ['invalid-request', 'session-not-found', 'session-unreadable'].includes(
              error.code,
            )
              ? error.message
              : 'VS Code received the request, but its Chat navigation command failed. Reload the window or retry from the session editor.',
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
  let registration = Promise.resolve()
  const temporary = `${descriptor}.${randomBytes(8).toString('hex')}.tmp`
  refreshRegistration = () => {
    const pending = registration.then(async () => {
      if (!server.listening) return
      await fs.writeFile(
        temporary,
        JSON.stringify({
          pipe,
          token,
          version: context.extension.packageJSON.version,
          updatedAt: Date.now(),
        }),
        { mode: 0o600 },
      )
      if (!server.listening) {
        await fs.unlink(temporary).catch(() => {})
        return
      }
      await fs.rename(temporary, descriptor)
    })
    registration = pending.catch(() => {})
    return pending
  }
  await refreshRegistration()
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused)
        void refreshRegistration().catch((error) =>
          output.appendLine(`Registration refresh failed: ${error.code ?? 'unknown'}`),
        )
    }),
  )
  connection = `Pulse is connected to ${path.basename(workspace.fsPath)}.`
  output.appendLine(connection)
  context.subscriptions.push({
    dispose() {
      for (const socket of sockets) socket.destroy()
      server.close()
      void registration.then(() => fs.unlink(temporary)).catch(() => {})
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
