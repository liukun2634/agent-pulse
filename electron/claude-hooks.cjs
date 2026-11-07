const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID, randomBytes, timingSafeEqual } = require('node:crypto')

const EVENTS = [
  'UserPromptSubmit',
  'PermissionRequest',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'StopFailure',
  'SessionEnd',
]
function createClaudeHooks(directory) {
  const filename = path.join(directory, 'claude-hooks.json')
  let state = { enabled: false, token: randomBytes(32).toString('hex'), port: 0, records: [] }
  let warning = null
  let server
  const listeners = new Set()
  try {
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (
      typeof saved.enabled !== 'boolean' ||
      !/^[a-f0-9]{64}$/.test(saved.token) ||
      !Number.isInteger(saved.port) ||
      saved.port < 0 ||
      saved.port > 65535 ||
      !Array.isArray(saved.records) ||
      saved.records.length > 1000
    )
      throw new Error('Invalid hook settings.')
    state = saved
  } catch (error) {
    if (error.code !== 'ENOENT') warning = 'Hook settings could not be restored.'
  }
  const records = new Map(
    state.records
      .filter(
        (record) =>
          record &&
          /^[\w-]{1,160}$/.test(record.sessionId) &&
          typeof record.cwd === 'string' &&
          typeof record.requestId === 'string' &&
          Number.isFinite(record.requestStartedAt) &&
          Number.isFinite(record.updatedAt) &&
          ['running', 'waiting', 'completed', 'failed', 'cancelled', 'disconnected'].includes(
            record.status,
          ),
      )
      .map((record) => [record.sessionId, record]),
  )
  function save() {
    fs.mkdirSync(directory, { recursive: true })
    const value = { ...state, records: [...records.values()].slice(-1000) }
    fs.writeFileSync(`${filename}.tmp`, JSON.stringify(value), { mode: 0o600 })
    fs.renameSync(`${filename}.tmp`, filename)
  }
  function accept(input, now = Date.now()) {
    if (
      !input ||
      input.agent_id ||
      !EVENTS.includes(input.hook_event_name) ||
      typeof input.session_id !== 'string' ||
      !/^[\w-]{1,160}$/.test(input.session_id) ||
      typeof input.cwd !== 'string' ||
      input.cwd.length > 2048
    )
      return false
    const event = input.hook_event_name
    const previous = records.get(input.session_id)
    const nativeId =
      typeof input.prompt_id === 'string' && /^[\w-]{1,160}$/.test(input.prompt_id)
        ? `prompt:${input.prompt_id}`
        : null
    if (event === 'UserPromptSubmit' && nativeId && nativeId === previous?.requestId) return false
    if (
      event !== 'UserPromptSubmit' &&
      (!previous || (nativeId && nativeId !== previous.requestId))
    )
      return false
    const requestId =
      event === 'UserPromptSubmit' ? (nativeId ?? `hook:${randomUUID()}`) : previous.requestId
    let status =
      event === 'UserPromptSubmit' || event === 'PostToolUse'
        ? 'running'
        : event === 'PermissionRequest'
          ? 'waiting'
          : event === 'PreToolUse'
            ? ['AskUserQuestion', 'ExitPlanMode'].includes(input.tool_name)
              ? 'waiting'
              : 'running'
            : event === 'Stop'
              ? 'completed'
              : event === 'StopFailure'
                ? 'failed'
                : event === 'PostToolUseFailure'
                  ? input.is_interrupt
                    ? 'cancelled'
                    : 'running'
                  : ['completed', 'failed', 'cancelled'].includes(previous?.status)
                    ? previous.status
                    : 'disconnected'
    if (
      previous?.requestId === requestId &&
      ['completed', 'failed', 'cancelled'].includes(previous.status) &&
      ['PostToolUse', 'PostToolUseFailure'].includes(event)
    )
      return false
    if (previous?.requestId === requestId && previous.status === status) return false
    const record = {
      sessionId: input.session_id,
      cwd: input.cwd,
      requestId,
      status,
      requestStartedAt: event === 'UserPromptSubmit' ? now : previous.requestStartedAt,
      updatedAt: now,
      finishedAt: ['completed', 'failed', 'cancelled'].includes(status) ? now : null,
      event,
    }
    records.delete(record.sessionId)
    records.set(record.sessionId, record)
    while (records.size > 1000) {
      records.delete(records.keys().next().value)
      state.trimmed = true
    }
    try {
      save()
      warning = null
    } catch {
      warning = 'Hook events could not be saved.'
    }
    for (const listener of listeners) listener()
    return true
  }
  function status() {
    return {
      enabled: state.enabled,
      listening: !!server?.listening,
      lastEventAt: Math.max(0, ...[...records.values()].map((record) => record.updatedAt)) || null,
      warning:
        warning ??
        (state.trimmed ? 'Hook history reached 1000 sessions. Older entries were evicted.' : null),
    }
  }
  async function enable(enabled) {
    if (typeof enabled !== 'boolean') throw new TypeError('Expected a boolean.')
    if (!enabled) {
      state.enabled = false
      if (server) {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
        server = undefined
      }
      save()
      return status()
    }
    if (server?.listening) return status()
    server = http.createServer((request, response) => {
      const expected = Buffer.from(`Bearer ${state.token}`)
      const authorization = Buffer.from(request.headers.authorization ?? '')
      if (
        request.method !== 'POST' ||
        request.url !== '/claude' ||
        request.headers.origin ||
        authorization.length !== expected.length ||
        !timingSafeEqual(authorization, expected)
      ) {
        response.writeHead(403).end()
        request.resume()
        return
      }
      let size = 0
      const chunks = []
      request.on('data', (chunk) => {
        size += chunk.length
        if (size > 2 * 1024 * 1024) {
          response.writeHead(413).end()
          request.destroy()
          return
        }
        chunks.push(chunk)
      })
      request.on('end', () => {
        try {
          accept(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          response.writeHead(204).end()
        } catch {
          response.writeHead(400).end()
        }
      })
      request.on('error', () => response.destroy())
    })
    server.requestTimeout = 3000
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(state.port, '127.0.0.1', resolve)
    }).catch((error) => {
      server = undefined
      warning = 'Local hook listener could not start. Its saved port may be in use.'
      throw error
    })
    state.port = server.address().port
    state.enabled = true
    try {
      save()
    } catch (error) {
      await enable(false).catch(() => {})
      throw error
    }
    return status()
  }
  function configuration() {
    if (!server?.listening) throw new Error('Enable local hooks first.')
    return {
      hooks: Object.fromEntries(
        EVENTS.map((event) => [
          event,
          [
            {
              hooks: [
                {
                  type: 'http',
                  url: `http://127.0.0.1:${state.port}/claude`,
                  headers: { Authorization: `Bearer ${state.token}` },
                  timeout: 1,
                  onFailure: 'continue',
                },
              ],
            },
          ],
        ]),
      ),
    }
  }
  return {
    status,
    enable,
    configuration,
    accept,
    records: () => (state.enabled ? [...records.values()] : []),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    start: () => (state.enabled ? enable(true) : Promise.resolve(status())),
    close: () => {
      server?.closeAllConnections()
      server?.close()
      server = undefined
    },
  }
}
module.exports = { createClaudeHooks }
