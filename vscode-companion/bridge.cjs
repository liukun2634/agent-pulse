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

async function openSession(workspacePath, scheme, sessionId) {
  const endpoint = JSON.parse(await fs.readFile(endpointPath(workspacePath, scheme), 'utf8'))
  if (typeof endpoint.pipe !== 'string' || typeof endpoint.token !== 'string')
    throw new Error('Invalid companion endpoint.')
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint.pipe)
    let response = ''
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      socket.destroy()
      error ? reject(error) : resolve()
    }
    socket.setTimeout(6000, () => finish(new Error('VS Code did not respond.')))
    socket.on('connect', () =>
      socket.write(JSON.stringify({ token: endpoint.token, sessionId }) + '\n'),
    )
    socket.on('error', finish)
    socket.on('close', () => finish(new Error('VS Code connection closed.')))
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (response.length > 4096) return finish(new Error('Invalid companion response.'))
      if (!response.includes('\n')) return
      try {
        const result = JSON.parse(response.slice(0, response.indexOf('\n')))
        finish(
          result.ok === true ? null : new Error(result.error || 'Session could not be opened.'),
        )
      } catch {
        finish(new Error('Invalid companion response.'))
      }
    })
  })
}

module.exports = { endpointPath, openSession }
