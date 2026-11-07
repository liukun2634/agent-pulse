const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createHash, randomUUID } = require('node:crypto')
const path = require('node:path')
const os = require('node:os')

const execute = promisify(execFile)

function claudeStatus(entry) {
  if (entry.status === 'waiting' || entry.state === 'blocked') return 'waiting'
  if (entry.status === 'busy') return 'running'
  if (entry.state === 'failed') return 'failed'
  if (entry.state === 'stopped') return 'cancelled'
  if (entry.state === 'done') return 'completed'
  if (entry.status === 'idle') return 'idle'
  if (entry.state === 'working') return 'running'
  return 'unknown'
}

function createClaudeSource({
  hooks,
  executable = process.env.PULSE_CLAUDE_CLI ||
    (process.platform === 'win32' ? 'claude.exe' : 'claude'),
  query = async (signal) => {
    const result = await execute(executable, ['agents', '--json', '--all'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      signal,
    })
    return result.stdout
  },
  configRoot = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'),
} = {}) {
  const scope = createHash('sha256').update(path.resolve(configRoot)).digest('hex').slice(0, 16)
  let cache = new Map()
  let pending
  let controller
  let closed = false
  let sequence = 0
  const started = Date.now()

  function withHooks(snapshot, now) {
    if (!hooks?.status().listening) return { ...snapshot, hookStatus: hooks?.status() ?? null }
    const sessions = new Map(snapshot.sessions.map((session) => [session.id, session]))
    for (const record of hooks.records()) {
      const id = `claude:${scope}:${record.sessionId}`
      const existing = sessions.get(id)
      if (existing?.status === 'running' && existing.requestStartedAt > record.updatedAt) continue
      let status = record.status
      if (status === 'running' && existing?.status === 'idle' && now - record.updatedAt > 2000)
        status = 'idle'
      if (
        ['running', 'waiting'].includes(status) &&
        ['error', 'unavailable'].includes(snapshot.state) &&
        now - record.updatedAt > 120000
      )
        status = 'unknown'
      sessions.set(id, {
        ...existing,
        id,
        source: 'claude',
        provider: 'claude',
        host: existing?.host ?? 'unknown',
        project: existing?.project ?? path.basename(record.cwd),
        task: existing?.task ?? 'Claude Code session',
        branch: existing?.branch ?? 'Not reported',
        files: existing?.files ?? 0,
        startedAt: existing?.startedAt ?? record.requestStartedAt,
        requestId: record.requestId,
        observationId: 'claude-hooks',
        requestStartedAt: record.requestStartedAt,
        updatedAt: record.updatedAt,
        finishedAt: record.finishedAt,
        status,
        hookFresh: record.updatedAt >= started,
        inputEventFresh: status === 'waiting' && hooks.isLiveInput?.(record) === true,
        statusDetail:
          status === 'idle'
            ? 'Snapshot reports idle; no completion event was received.'
            : `Claude hook: ${record.event}. No conversation content is stored.`,
        events: [
          ...(existing?.events ?? []),
          {
            id: `hook-${record.requestId}-${record.updatedAt}`,
            at: record.updatedAt,
            text: `Claude ${record.event}`,
            kind: status === 'completed' ? 'success' : status === 'failed' ? 'error' : 'info',
          },
        ].slice(-40),
      })
    }
    return {
      ...snapshot,
      sessions: [...sessions.values()],
      hookStatus: hooks.status(),
      acquisition: 'Local hooks + CLI snapshots',
      state: ['error', 'unavailable', 'empty'].includes(snapshot.state)
        ? sessions.size
          ? 'connected'
          : 'empty'
        : snapshot.state,
      message: ['error', 'unavailable'].includes(snapshot.state)
        ? 'Local hooks active; CLI snapshots unavailable.'
        : snapshot.message,
    }
  }

  function beginRecovery() {
    if (closed) return
    cache = new Map(
      [...cache].map(([id, item]) => [
        id,
        {
          ...item,
          status: 'disconnected',
          statusDetail: 'Claude Code status is temporarily unavailable.',
        },
      ]),
    )
  }

  async function collect(now) {
    controller = new AbortController()
    try {
      const entries = JSON.parse(await query(controller.signal))
      if (!Array.isArray(entries) || entries.length > 10000)
        throw new Error('Invalid Claude session list.')
      const next = new Map()
      let invalid = 0
      for (const entry of entries) {
        if (
          !entry ||
          !['interactive', 'background'].includes(entry.kind) ||
          typeof entry.cwd !== 'string' ||
          !Number.isFinite(entry.startedAt)
        ) {
          invalid++
          continue
        }
        const identity =
          entry.sessionId ||
          entry.id ||
          (Number.isSafeInteger(entry.pid) ? `process-${entry.pid}-${entry.startedAt}` : '')
        if (typeof identity !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(identity)) {
          invalid++
          continue
        }
        const id = `claude:${scope}:${identity}`
        const previous = cache.get(id)
        const status = claudeStatus(entry)
        const changed = !previous || previous.status !== status
        const observationId =
          previous && previous.status !== 'disconnected' ? previous.observationId : randomUUID()
        const continuous = previous?.observationId === observationId
        const newRun = status === 'running' && !['running', 'waiting'].includes(previous?.status)
        const requestStartedAt =
          newRun || (status === 'running' && !Number.isFinite(previous?.requestStartedAt))
            ? now
            : continuous
              ? previous?.requestStartedAt
              : undefined
        const requestId =
          newRun || !continuous ? `observed-${observationId}-${++sequence}` : previous.requestId
        const terminal = ['completed', 'failed', 'cancelled'].includes(status)
        const finishedAt = terminal ? (changed ? now : previous.finishedAt) : null
        const text = {
          running: 'Claude Code is running',
          waiting: 'Claude Code needs input',
          idle: 'Claude Code is idle; no active execution reported',
          completed: 'Claude Code reports this background turn is done',
          failed: 'Claude Code reports an error',
          cancelled: 'Claude Code reports this session stopped',
          unknown: 'Claude Code did not report a recognized state',
        }[status]
        const detail =
          status === 'idle'
            ? 'Claude Code reports idle. Idle is not a completion signal.'
            : status === 'running'
              ? 'Execution time is measured from when Pulse first observes this run, not the exact prompt start.'
              : status === 'waiting'
                ? `Waiting: ${typeof entry.waitingFor === 'string' ? entry.waitingFor.slice(0, 180) : 'input in Claude Code'}.`
                : status === 'unknown'
                  ? 'This Claude Code version returned an unrecognized state.'
                  : 'State reported by the Claude Code CLI. Exact request boundaries require lifecycle hooks.'
        next.set(id, {
          id,
          project: path.win32.basename(entry.cwd) || 'Claude Code',
          task:
            typeof entry.name === 'string' && entry.name.trim()
              ? entry.name.replace(/\s+/g, ' ').trim().slice(0, 180)
              : 'Claude Code session',
          branch: 'Not reported',
          provider: 'claude',
          source: 'claude',
          host: 'unknown',
          status,
          statusDetail: detail,
          startedAt: entry.startedAt,
          requestStartedAt,
          requestId,
          observationId,
          updatedAt: changed ? now : previous.updatedAt,
          finishedAt,
          files: 0,
          events: changed
            ? [
                ...(previous?.events ?? []),
                {
                  id: `${id}:${now}:${++sequence}`,
                  text,
                  at: now,
                  kind: status === 'failed' ? 'error' : status === 'completed' ? 'success' : 'info',
                },
              ].slice(-40)
            : previous.events,
        })
      }
      for (const [id, previous] of cache) {
        if (next.has(id)) continue
        next.set(id, {
          ...previous,
          status: 'disconnected',
          statusDetail: 'No longer listed by Claude Code. Completion was not confirmed.',
        })
      }
      for (const [id, item] of next) {
        if (next.size <= Math.max(entries.length, 1000)) break
        if (item.status === 'disconnected') next.delete(id)
      }
      if (!closed) cache = next
      return {
        source: 'claude',
        state: invalid ? 'error' : entries.length ? 'connected' : 'empty',
        message: invalid
          ? 'Some Claude Code records could not be read.'
          : entries.length
            ? 'Local Claude Code session snapshots'
            : 'No active Claude Code sessions found. Open Claude Code in a terminal to begin.',
        scannedAt: now,
        sessions: [...next.values()],
      }
    } catch (error) {
      beginRecovery()
      return {
        source: 'claude',
        state: error.code === 'ENOENT' ? 'unavailable' : 'error',
        message:
          error.code === 'ENOENT'
            ? 'Claude Code CLI not found. Install it or set PULSE_CLAUDE_CLI to its executable path.'
            : error.killed
              ? 'Claude Code query timed out. Pulse will retry.'
              : 'Could not query Claude Code sessions. Check the CLI version and retry.',
        scannedAt: now,
        sessions: [...cache.values()],
      }
    }
  }

  return {
    beginRecovery,
    subscribe: (listener) => hooks?.subscribe(listener),
    scan(now = Date.now()) {
      if (closed) return Promise.reject(new Error('Claude source is closed.'))
      pending ??= collect(now)
        .then((snapshot) => withHooks(snapshot, now))
        .finally(() => {
          pending = null
        })
      return pending
    },
    close() {
      closed = true
      controller?.abort()
    },
  }
}

module.exports = { createClaudeSource, claudeStatus }
