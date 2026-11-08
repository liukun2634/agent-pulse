const vscode = require('vscode')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { randomUUID, randomBytes } = require('node:crypto')
const { registryDirectory, isTrustedRequest } = require('./protocol.cjs')
const { createChatNavigator } = require('./navigation.cjs')

async function activate(context) {
  if (!vscode.workspace.isTrusted || vscode.env.remoteName || context.storageUri?.scheme !== 'file')
    return
  const workspaceStoragePath = path.dirname(context.storageUri.fsPath)
  const instanceId = randomUUID()
  const token = randomBytes(32).toString('hex')
  const directory =
    context.extensionMode !== vscode.ExtensionMode.Production &&
    process.env.PULSE_SESSION_BRIDGE_TEST_REGISTRY
      ? process.env.PULSE_SESSION_BRIDGE_TEST_REGISTRY
      : registryDirectory()
  const filename = path.join(directory, `${instanceId}.json`)
  const pipe =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\pulse-session-${instanceId}`
      : path.join(os.tmpdir(), `pulse-session-${instanceId}.sock`)
  const navigator = createChatNavigator(vscode, workspaceStoragePath)
  const sockets = new Set()
  let registrationError = null
  const register = () => {
    try {
      const configured = vscode.workspace
        .getConfiguration('pulseSessionBridge')
        .get('windowLabel', '')
      const profile = context.globalStorageUri.fsPath.includes(`${path.sep}profiles${path.sep}`)
        ? path.basename(path.dirname(path.dirname(context.globalStorageUri.fsPath)))
        : 'default profile'
      const label =
        `${configured || vscode.workspace.name || 'VS Code workspace'} / ${profile} / ${instanceId.slice(0, 8)}`.slice(
          0,
          512,
        )
      fs.mkdirSync(directory, { recursive: true })
      fs.writeFileSync(
        `${filename}.tmp`,
        JSON.stringify({
          version: 1,
          instanceId,
          token,
          pipe,
          workspaceStoragePath,
          label,
          seenAt: Date.now(),
          vscodeVersion: vscode.version,
          bridgeVersion: context.extension.packageJSON.version,
          chatViewNavigation: true,
        }),
        { mode: 0o600 },
      )
      fs.renameSync(`${filename}.tmp`, filename)
      registrationError = null
    } catch {
      registrationError = 'Could not register this window with Pulse.'
    }
  }
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.setTimeout(12000, () => socket.destroy())
    let input = ''
    let received = false
    socket.on('data', async (chunk) => {
      if (received) return
      input += chunk.toString('utf8')
      if (input.length > 8192) {
        socket.destroy()
        return
      }
      if (!input.includes('\n')) return
      received = true
      let request
      try {
        request = JSON.parse(input.slice(0, input.indexOf('\n')))
      } catch {
        socket.destroy()
        return
      }
      if (!isTrustedRequest(request, { token, instanceId, workspaceStoragePath })) {
        socket.destroy()
        return
      }
      let result
      try {
        result = await navigator.open(request.sessionId, request.expiresAt)
      } catch (error) {
        result = { ok: false, message: error.message }
      }
      if (!socket.destroyed)
        socket.end(
          JSON.stringify({
            ...result,
            version: 1,
            requestId: request.requestId,
            instanceId,
            sessionId: request.sessionId,
          }) + '\n',
        )
    })
  })
  server.on('error', () => {
    registrationError = 'The local bridge could not listen.'
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(pipe, () => {
      register()
      resolve()
    })
  })
  const heartbeat = setInterval(register, 20000)
  heartbeat.unref()
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState(register),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('pulseSessionBridge')) register()
    }),
    vscode.commands.registerCommand('pulseSessionBridge.status', () => {
      register()
      return vscode.window.showInformationMessage(
        registrationError ??
          `Pulse Session Bridge: ${vscode.workspace.name || 'workspace'} registered (${instanceId.slice(0, 8)}). Input focus is not independently verified.`,
      )
    }),
    {
      dispose() {
        clearInterval(heartbeat)
        for (const socket of sockets) socket.destroy()
        server.close()
        try {
          fs.unlinkSync(filename)
        } catch {}
        if (process.platform !== 'win32') {
          try {
            fs.unlinkSync(pipe)
          } catch {}
        }
      },
    },
  )
  return { instanceId, workspaceStoragePath }
}

module.exports = { activate }
