const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const net = require('node:net')
const { timingSafeEqual } = require('node:crypto')

const registryDirectory = () => path.join(os.homedir(), '.agent-pulse', 'session-bridge')

function isTrustedRequest(request, registration, now = Date.now()) {
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    request.version !== 1 ||
    typeof request.token !== 'string' ||
    request.token.length !== 64 ||
    request.instanceId !== registration.instanceId ||
    typeof request.workspaceStoragePath !== 'string' ||
    !path.isAbsolute(request.workspaceStoragePath) ||
    typeof request.requestId !== 'string' ||
    !request.requestId.length ||
    request.requestId.length > 100 ||
    typeof request.sessionId !== 'string' ||
    !/^[a-zA-Z0-9-]{1,100}$/.test(request.sessionId) ||
    !Number.isFinite(request.expiresAt) ||
    request.expiresAt <= now ||
    request.expiresAt > now + 15000
  )
    return false
  const normalize = (value) =>
    process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
  if (normalize(request.workspaceStoragePath) !== normalize(registration.workspaceStoragePath))
    return false
  const supplied = Buffer.from(request.token)
  const expected = Buffer.from(registration.token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

async function listWindows(directory = registryDirectory(), now = Date.now()) {
  let names
  try {
    names = await fs.readdir(directory)
  } catch {
    return []
  }
  const windows = await Promise.all(
    names
      .filter((name) => /^[a-f0-9-]{36}\.json$/.test(name))
      .map(async (name) => {
        try {
          const filename = path.join(directory, name)
          if ((await fs.stat(filename)).size > 16384) return null
          const value = JSON.parse(await fs.readFile(filename, 'utf8'))
          if (
            value.version !== 1 ||
            `${value.instanceId}.json` !== name ||
            !/^[a-f0-9]{64}$/.test(value.token) ||
            typeof value.pipe !== 'string' ||
            typeof value.workspaceStoragePath !== 'string' ||
            !path.isAbsolute(value.workspaceStoragePath) ||
            typeof value.label !== 'string' ||
            value.label.length > 512 ||
            !Number.isFinite(value.seenAt) ||
            value.seenAt < now - 60000 ||
            value.seenAt > now + 5000
          )
            return null
          const expected =
            process.platform === 'win32'
              ? `\\\\.\\pipe\\pulse-session-${value.instanceId}`
              : path.join(os.tmpdir(), `pulse-session-${value.instanceId}.sock`)
          return value.pipe === expected ? value : null
        } catch {
          return null
        }
      }),
  )
  return windows.filter(Boolean)
}

function send(window, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(window.pipe)
    let input = ''
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    socket.setTimeout(10000, () => finish(new Error('Bridge timed out.')))
    socket.on('error', (error) => finish(error))
    socket.on('connect', () =>
      socket.write(
        JSON.stringify({ ...request, token: window.token, expiresAt: Date.now() + 10000 }) + '\n',
      ),
    )
    socket.on('data', (chunk) => {
      input += chunk.toString('utf8')
      if (input.length > 16384) {
        finish(new Error('Invalid bridge response.'))
        return
      }
      if (!input.includes('\n')) return
      try {
        finish(null, JSON.parse(input.slice(0, input.indexOf('\n'))))
      } catch {
        finish(new Error('Invalid bridge response.'))
      }
    })
    socket.on('close', () => finish(new Error('Bridge disconnected.')))
  })
}

module.exports = { registryDirectory, listWindows, send, isTrustedRequest }
