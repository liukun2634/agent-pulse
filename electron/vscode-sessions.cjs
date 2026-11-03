const fs = require('node:fs/promises')
const { watch } = require('node:fs')
const path = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')

const STALE_AFTER = 2 * 60 * 1000
const INPUT_TOOLS = new Set(['vscode_askQuestions', 'ask_user', 'ask_questions'])

function createTranscript(id, project) {
  return {
    id,
    project,
    task: 'Copilot session',
    status: 'unknown',
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    events: [],
    pendingTools: new Map(),
    finalResponse: false,
  }
}

function applyEvent(state, event) {
  const at = Date.parse(event?.timestamp)
  if (!Number.isFinite(at) || typeof event?.type !== 'string') return
  const data = event.data ?? {}
  let text
  let kind = 'info'
  state.startedAt = Math.min(state.startedAt ?? at, at)
  state.updatedAt = Math.max(state.updatedAt ?? at, at)

  switch (event.type) {
    case 'session.start':
      text = 'Copilot transcript connected'
      break
    case 'user.message':
      if (typeof data.content === 'string')
        state.task = data.content.replace(/\s+/g, ' ').trim().slice(0, 180) || state.task
      state.pendingTools.clear()
      state.finalResponse = false
      state.status = 'running'
      state.finishedAt = null
      text = 'User message received'
      break
    case 'assistant.turn_start':
      state.finalResponse = false
      state.finishedAt = null
      state.status = 'running'
      break
    case 'assistant.message': {
      const requests = Array.isArray(data.toolRequests) ? data.toolRequests : []
      for (const request of requests) {
        if (typeof request.toolCallId === 'string')
          state.pendingTools.set(request.toolCallId, request.name ?? 'tool')
      }
      state.finalResponse =
        requests.length === 0 && typeof data.content === 'string' && !!data.content.trim()
      state.status = 'running'
      state.finishedAt = null
      text = requests.length ? 'Assistant requested tools' : 'Assistant response received'
      break
    }
    case 'tool.execution_start':
      if (typeof data.toolCallId === 'string')
        state.pendingTools.set(data.toolCallId, data.toolName ?? 'tool')
      state.status = 'running'
      state.finalResponse = false
      state.finishedAt = null
      text = `Tool started: ${typeof data.toolName === 'string' ? data.toolName.slice(0, 100) : 'tool'}`
      break
    case 'tool.execution_complete':
      state.pendingTools.delete(data.toolCallId)
      state.status = 'running'
      state.finishedAt = null
      text = data.success === false ? 'Tool failed; agent may recover' : 'Tool finished'
      kind = data.success === false ? 'warning' : 'info'
      break
    case 'assistant.turn_end':
      if (state.finalResponse && state.pendingTools.size === 0) {
        state.status = 'completed'
        state.finishedAt = at
        text = 'Assistant reply finished'
        kind = 'success'
      }
      break
    case 'session.error':
      state.pendingTools.clear()
      state.status = 'failed'
      state.finishedAt = at
      text = 'Copilot reported a session error'
      kind = 'error'
      break
    default:
      return
  }

  if ([...state.pendingTools.values()].some((name) => INPUT_TOOLS.has(name))) {
    state.status = 'waiting'
  }
  if (text) {
    state.events.push({ id: event.id ?? `${at}-${state.events.length}`, text, at, kind })
    state.events = state.events.slice(-40)
  }
}

function toSession(state, now = Date.now()) {
  if (state.updatedAt === null) return null
  const stale = ['running', 'waiting'].includes(state.status) && now - state.updatedAt > STALE_AFTER
  const status = stale ? 'unknown' : state.status
  return {
    id: state.id,
    project: state.project,
    task: state.task,
    branch: 'Not reported',
    provider: 'copilot',
    source: 'vscode',
    status,
    statusDetail: stale
      ? 'No transcript activity for 2 minutes; execution or input may still be pending.'
      : status === 'completed'
        ? 'Assistant reply ended. This does not confirm the task succeeded.'
        : status === 'waiting'
          ? 'A question tool is pending in VS Code.'
          : 'Inferred from local Copilot transcript events; permission prompts may not be reported.',
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    finishedAt: state.finishedAt,
    files: 0,
    events: state.events,
  }
}

function pollInterval(updatedAt, now = Date.now()) {
  const idle = Math.max(0, now - updatedAt)
  return idle < 30000 ? 2000 : idle < 120000 ? 5000 : idle < 600000 ? 15000 : 60000
}

function createVSCodeSource(storagePath, scheme = 'vscode', { watchChanges = watch } = {}) {
  const cache = new Map()
  const watchers = new Map()
  const dirtyFiles = new Set()
  let targets = new Map()

  function close() {
    for (const watcher of watchers.values()) watcher.close()
    watchers.clear()
    dirtyFiles.clear()
  }

  function watchTranscripts(transcriptRoot) {
    if (watchers.has(transcriptRoot)) return
    try {
      const watcher = watchChanges(transcriptRoot, { persistent: false }, (_event, filename) => {
        if (filename) dirtyFiles.add(path.join(transcriptRoot, String(filename)))
        else
          for (const filename of cache.keys())
            if (path.dirname(filename) === transcriptRoot) dirtyFiles.add(filename)
      })
      watcher.on('error', () => {
        watcher.close()
        watchers.delete(transcriptRoot)
      })
      watchers.set(transcriptRoot, watcher)
    } catch {}
  }

  async function scan(now = Date.now(), { force = false } = {}) {
    const candidates = []
    let failures = 0
    let directories
    try {
      directories = await fs.readdir(storagePath, { withFileTypes: true })
    } catch (error) {
      targets.clear()
      cache.clear()
      close()
      return {
        source: 'vscode',
        state: error.code === 'ENOENT' ? 'unavailable' : 'error',
        message: 'VS Code workspace storage is unavailable.',
        scannedAt: now,
        sessions: [],
      }
    }

    const activeRoots = new Set()
    for (const directory of directories) {
      if (!directory.isDirectory()) continue
      const workspaceRoot = path.join(storagePath, directory.name)
      const transcriptRoot = path.join(workspaceRoot, 'GitHub.copilot-chat', 'transcripts')
      try {
        const files = await fs.readdir(transcriptRoot, { withFileTypes: true })
        activeRoots.add(transcriptRoot)
        watchTranscripts(transcriptRoot)
        const metadata = JSON.parse(
          await fs.readFile(path.join(workspaceRoot, 'workspace.json'), 'utf8'),
        )
        const workspacePath = fileURLToPath(metadata.folder ?? metadata.workspace)
        const project = path.basename(workspacePath, '.code-workspace')
        for (const file of files) {
          if (!file.isFile() || !/^[a-zA-Z0-9-]{1,100}\.jsonl$/.test(file.name)) continue
          const filename = path.join(transcriptRoot, file.name)
          const cached = cache.get(filename)
          const dirty = dirtyFiles.delete(filename)
          const check = force || dirty || !cached || now >= cached.nextCheckAt
          const stat = check ? await fs.stat(filename) : cached.stat
          candidates.push({
            filename,
            stat,
            check,
            project,
            workspacePath,
            titleFile: path.join(workspaceRoot, 'chatSessions', file.name),
            id: `vscode:${directory.name}:${path.basename(file.name, '.jsonl')}`,
          })
        }
      } catch (error) {
        if (error.code !== 'ENOENT') failures++
      }
    }

    for (const [root, watcher] of watchers) {
      if (!activeRoots.has(root)) {
        watcher.close()
        watchers.delete(root)
      }
    }
    const present = new Set(candidates.map((candidate) => candidate.filename))
    for (const filename of dirtyFiles) if (!present.has(filename)) dirtyFiles.delete(filename)

    candidates.sort((first, second) => second.stat.mtimeMs - first.stat.mtimeMs)
    const selected = candidates.slice(0, 100)
    const keep = new Set(selected.map((candidate) => candidate.filename))
    for (const key of cache.keys()) if (!keep.has(key)) cache.delete(key)
    const sessions = []
    targets = new Map()

    for (const candidate of selected) {
      try {
        let cached = cache.get(candidate.filename)
        if (
          !cached ||
          candidate.stat.size < cached.offset ||
          candidate.stat.ino !== cached.ino ||
          (candidate.stat.size === cached.offset && candidate.stat.mtimeMs !== cached.mtimeMs)
        ) {
          cached = {
            offset: 0,
            remainder: Buffer.alloc(0),
            ino: candidate.stat.ino,
            mtimeMs: candidate.stat.mtimeMs,
            state: createTranscript(candidate.id, candidate.project),
          }
          cache.set(candidate.filename, cached)
        }
        if (candidate.check && !cached.title) {
          try {
            const handle = await fs.open(candidate.titleFile, 'r')
            try {
              const buffer = Buffer.alloc(1024 * 1024)
              const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
              for (const line of buffer.subarray(0, bytesRead).toString('utf8').split('\n')) {
                try {
                  const entry = JSON.parse(line)
                  const title =
                    entry.kind === 0
                      ? entry.v?.customTitle
                      : entry.kind === 1 && entry.k?.length === 1 && entry.k[0] === 'customTitle'
                        ? entry.v
                        : null
                  if (typeof title === 'string' && title.trim())
                    cached.title = title.replace(/\s+/g, ' ').trim().slice(0, 180)
                } catch {}
              }
            } finally {
              await handle.close()
            }
          } catch {}
        }
        const length = candidate.check
          ? Math.min(candidate.stat.size - cached.offset, 8 * 1024 * 1024)
          : 0
        if (length > 0) {
          if (cached.offset > 0) cached.observedChangeAt = now
          const handle = await fs.open(candidate.filename, 'r')
          let chunk
          try {
            const buffer = Buffer.alloc(length)
            const { bytesRead } = await handle.read(buffer, 0, length, cached.offset)
            cached.offset += bytesRead
            chunk = Buffer.concat([cached.remainder, buffer.subarray(0, bytesRead)])
          } finally {
            await handle.close()
          }
          const boundary = chunk.lastIndexOf(10)
          if (boundary >= 0) {
            for (const line of chunk.subarray(0, boundary).toString('utf8').split('\n')) {
              if (!line.trim()) continue
              try {
                applyEvent(cached.state, JSON.parse(line))
              } catch {
                cached.state.status = 'unknown'
                cached.state.finalResponse = false
                failures++
              }
            }
          }
          cached.remainder = Buffer.from(chunk.subarray(boundary + 1))
          if (cached.remainder.length > 8 * 1024 * 1024) {
            cache.delete(candidate.filename)
            throw new Error('Transcript line exceeds the read limit.')
          }
          cached.mtimeMs = candidate.stat.mtimeMs
        }
        if (candidate.check) {
          cached.stat = candidate.stat
          cached.nextCheckAt =
            now +
            (cached.offset < candidate.stat.size || cached.remainder.length
              ? 2000
              : pollInterval(
                  Math.max(cached.state.updatedAt ?? now, cached.observedChangeAt ?? 0),
                  now,
                ))
        }
        const session = toSession(cached.state, now)
        if (!session) continue
        if (cached.title) session.task = cached.title
        if (cached.offset < candidate.stat.size || cached.remainder.length) {
          session.status = 'unknown'
          session.finishedAt = null
          session.statusDetail = 'Transcript update is incomplete; waiting for the next read.'
        }
        sessions.push(session)
        targets.set(
          session.id,
          `${scheme === 'vscode-insiders' ? scheme : 'vscode'}://file${pathToFileURL(candidate.workspacePath).pathname}`,
        )
      } catch {
        failures++
        cache.delete(candidate.filename)
      }
    }

    return {
      source: 'vscode',
      state: failures ? 'error' : sessions.length ? 'connected' : 'empty',
      message: failures
        ? 'Some transcripts could not be read; available sessions are shown.'
        : sessions.length
          ? 'Local Copilot transcripts'
          : 'No Copilot transcripts found.',
      scannedAt: now,
      sessions,
    }
  }

  return { scan, close, workspaceUri: (id) => targets.get(id) }
}

module.exports = { createTranscript, applyEvent, toSession, createVSCodeSource, pollInterval }
