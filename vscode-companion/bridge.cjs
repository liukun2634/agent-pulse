const net = require('node:net')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { createHash } = require('node:crypto')

function endpointPath(workspacePath, scheme = 'vscode') {
  const normalized = path.resolve(workspacePath)
  const key = createHash('sha256')
    .update(`${scheme}:${process.platform === 'win32' ? normalized.toLowerCase() : normalized}`)
    .digest('hex')
  return path.join(os.homedir(), '.agent-pulse', 'bridges', `${key}.json`)
}

function connectionError(code, message) {
  return Object.assign(new Error(message), { code })
}

async function readEndpoint(workspacePath, scheme) {
  let endpoint
  try {
    endpoint = JSON.parse(await fs.readFile(endpointPath(workspacePath, scheme), 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT')
      throw connectionError(
        'not-registered',
        'Pulse Companion is not registered for this workspace. In its existing VS Code window, run Pulse: Show Connection Status.',
      )
    throw connectionError(
      'invalid-registration',
      'The Companion registration could not be read. Run Pulse: Show Connection Status in the matching VS Code window to refresh it.',
    )
  }
  if (typeof endpoint.pipe !== 'string' || typeof endpoint.token !== 'string')
    throw connectionError(
      'invalid-registration',
      'The Companion registration is incomplete. Run Pulse: Show Connection Status to refresh it.',
    )
  return endpoint
}

function requestOpen(endpoint, sessionId) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.pipe)
    let response = ''
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(result)
    }
    socket.setTimeout(6000, () =>
      finish(
        connectionError(
          'timeout',
          'VS Code did not respond in time. Check for an open dialog or a busy extension host, then retry.',
        ),
      ),
    )
    socket.on('connect', () =>
      socket.write(JSON.stringify({ token: endpoint.token, sessionId }) + '\n'),
    )
    socket.on('error', () =>
      finish(
        connectionError(
          'stale-connection',
          'The registered VS Code connection is no longer active. Focus its existing window and run Pulse: Show Connection Status, then retry.',
        ),
      ),
    )
    socket.on('close', () =>
      finish(
        connectionError(
          'disconnected',
          'The VS Code connection closed before replying. Retry after its extension host has restarted.',
        ),
      ),
    )
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (response.length > 4096) return finish(new Error('Invalid companion response.'))
      if (!response.includes('\n')) return
      try {
        const result = JSON.parse(response.slice(0, response.indexOf('\n')))
        if (result.ok !== true)
          return finish(
            connectionError(
              result.code || 'navigation-failed',
              result.error || 'VS Code received the request but could not open this session.',
            ),
          )
        if (result.sessionId !== sessionId || !['chat-view', 'chat-editor'].includes(result.mode))
          return finish(null, {
            mode: 'chat-editor',
            verified: false,
            message:
              'Pulse Companion needs to be reloaded or updated before Chat view navigation can be confirmed.',
          })
        finish(null, {
          mode: result.mode,
          verified: result.verified === true,
          message: typeof result.message === 'string' ? result.message : undefined,
        })
      } catch {
        finish(new Error('Invalid companion response.'))
      }
    })
  })
}

async function openSession(workspacePath, scheme, sessionId) {
  const endpoint = await readEndpoint(workspacePath, scheme)
  try {
    return await requestOpen(endpoint, sessionId)
  } catch (error) {
    if (error.code !== 'stale-connection') throw error
    const refreshed = await readEndpoint(workspacePath, scheme)
    if (refreshed.pipe === endpoint.pipe && refreshed.token === endpoint.token) throw error
    return requestOpen(refreshed, sessionId)
  }
}

module.exports = { endpointPath, openSession }
