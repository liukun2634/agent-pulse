const fs = require('node:fs/promises')
const { watch } = require('node:fs')
const path = require('node:path')
const { fileURLToPath } = require('node:url')

const STALE_AFTER = 2 * 60 * 1000
const INPUT_TOOLS = new Set(['vscode_askQuestions', 'ask_user', 'ask_questions'])

function createTranscript(id, project) {
  return {
    id,
    project,
    task: 'Copilot session',
    status: 'unknown',
    startedAt: null,
    requestStartedAt: null,
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
      state.requestStartedAt = at
      if (typeof data.content === 'string')
        state.task = data.content.replace(/\s+/g, ' ').trim().slice(0, 180) || state.task
      state.pendingTools.clear()
      state.finalResponse = false
      state.status = 'running'
      state.finishedAt = null
      text = 'User message received'
      break
    case 'assistant.turn_start':
      state.requestStartedAt ??= at
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

function applyChatEvent(chat, entry) {
  const pickRequest = (request) => ({
    requestId: request.requestId,
    timestamp: request.timestamp,
    modelState: request.modelState,
    error: !!request.result?.errorDetails,
  })
  const setRequests = (requests) => {
    chat.requestCount = requests.length
    chat.request = requests.at(-1) ? pickRequest(requests.at(-1)) : null
  }
  if (entry.kind === 0 && entry.v) {
    chat.title = entry.v.customTitle
    setRequests(Array.isArray(entry.v.requests) ? entry.v.requests : [])
    return
  }
  if (!Array.isArray(entry.k)) return
  const [field, index, property] = entry.k
  if (field === 'customTitle' && entry.kind === 1 && typeof entry.v === 'string') {
    chat.title = entry.v
  } else if (field === 'requests' && entry.k.length === 1 && Array.isArray(entry.v)) {
    if (entry.kind === 1) setRequests(entry.v)
    else if (entry.kind === 2 && entry.v.length) {
      chat.requestCount = (chat.requestCount ?? 0) + entry.v.length
      chat.request = pickRequest(entry.v.at(-1))
    }
  } else if (
    field === 'requests' &&
    index === chat.requestCount - 1 &&
    chat.request &&
    entry.kind === 1
  ) {
    if (property === 'modelState') {
      if (entry.k.length === 3) chat.request.modelState = entry.v
      else if (['value', 'completedAt'].includes(entry.k[3]))
        chat.request.modelState = { ...chat.request.modelState, [entry.k[3]]: entry.v }
    } else if (property === 'result') chat.request.error = !!entry.v?.errorDetails
  }
}

function toSession(state, now = Date.now(), chat = {}) {
  if (state.updatedAt === null) return null
  const request = chat.request
  const completedAt = request?.modelState?.completedAt
  const savedComplete =
    [1, 2, 3].includes(request?.modelState?.value) &&
    Number.isFinite(completedAt) &&
    completedAt >= state.updatedAt
  const newRequest = Number.isFinite(request?.timestamp) && request.timestamp > state.updatedAt
  const updatedAt = savedComplete ? completedAt : newRequest ? request.timestamp : state.updatedAt
  const status = savedComplete
    ? request.modelState.value === 2
      ? 'cancelled'
      : request.error || request.modelState.value === 3
        ? 'failed'
        : 'completed'
    : request?.modelState?.value === 4 && (newRequest || state.status !== 'completed')
      ? 'waiting'
      : newRequest
        ? now - updatedAt > STALE_AFTER
          ? 'idle'
          : 'running'
        : state.status === 'running' && now - updatedAt > STALE_AFTER
          ? 'idle'
          : state.status
  return {
    id: state.id,
    project: state.project,
    task:
      typeof chat.title === 'string' && chat.title.trim()
        ? chat.title.replace(/\s+/g, ' ').trim().slice(0, 180)
        : state.task,
    branch: 'Not reported',
    provider: 'copilot',
    source: 'vscode',
    host: 'vscode',
    requestId: request?.requestId,
    status,
    statusDetail: savedComplete
      ? status === 'cancelled'
        ? 'This request was stopped in VS Code.'
        : status === 'failed'
          ? 'VS Code saved this request with an error.'
          : 'VS Code saved this request as finished. You can open the conversation and continue.'
      : status === 'idle'
        ? 'No recent activity. No completion signal was recorded; the agent may still be working.'
        : status === 'completed'
          ? 'Assistant reply ended. This does not confirm the task succeeded.'
          : status === 'waiting'
            ? 'VS Code is waiting for confirmation or input.'
            : status === 'unknown'
              ? 'No readable lifecycle state yet. Session history may still be loading.'
              : 'Inferred from local Copilot transcript events; permission prompts may not be reported.',
    startedAt: state.startedAt,
    requestStartedAt: Number.isFinite(request?.timestamp)
      ? request.timestamp
      : (state.requestStartedAt ?? state.startedAt),
    updatedAt,
    finishedAt: savedComplete ? completedAt : newRequest ? null : state.finishedAt,
    files: 0,
    events: savedComplete
      ? [
          ...state.events,
          {
            id: `saved-${request.requestId ?? state.id}-${completedAt}`,
            text:
              status === 'completed'
                ? 'Reply ready in VS Code'
                : status === 'cancelled'
                  ? 'Request stopped in VS Code'
                  : 'Request failed in VS Code',
            at: completedAt,
            kind: status === 'completed' ? 'success' : status === 'cancelled' ? 'warning' : 'error',
          },
        ].slice(-40)
      : state.events,
  }
}

function pollInterval(updatedAt, now = Date.now(), status) {
  if (['running', 'waiting', 'idle'].includes(status)) return 2000
  const idle = Math.max(0, now - updatedAt)
  return idle < 30000 ? 2000 : idle < 120000 ? 5000 : idle < 600000 ? 15000 : 60000
}

async function readChatState(filename, cursor) {
  const stat = await fs.stat(filename)
  if (
    !cursor ||
    stat.size < cursor.offset ||
    stat.ino !== cursor.ino ||
    (stat.size === cursor.offset && stat.mtimeMs !== cursor.mtimeMs)
  )
    cursor = { offset: 0, remainder: Buffer.alloc(0), ino: stat.ino, state: {} }
  const length = Math.min(stat.size - cursor.offset, 8 * 1024 * 1024)
  if (length > 0) {
    const handle = await fs.open(filename, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, cursor.offset)
      cursor.offset += bytesRead
      const chunk = Buffer.concat([cursor.remainder, buffer.subarray(0, bytesRead)])
      const boundary = chunk.lastIndexOf(10)
      if (boundary >= 0)
        for (const line of chunk.subarray(0, boundary).toString('utf8').split('\n')) {
          if (line.trim()) applyChatEvent(cursor.state, JSON.parse(line))
        }
      cursor.remainder = Buffer.from(chunk.subarray(boundary + 1))
      if (cursor.remainder.length > 32 * 1024 * 1024)
        throw new Error('Chat record exceeds read limit.')
    } finally {
      await handle.close()
    }
  }
  cursor.mtimeMs = stat.mtimeMs
  cursor.hasBacklog = cursor.offset < stat.size
  cursor.complete = cursor.offset === stat.size && cursor.remainder.length === 0
  return cursor
}

function createVSCodeSource(storagePath, { watchChanges = watch } = {}) {
  const cache = new Map()
  const watchers = new Map()
  const dirtyFiles = new Set()
  const changeListeners = new Set()

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
          for (const [filename, cached] of cache) {
            if (path.dirname(filename) === transcriptRoot) dirtyFiles.add(filename)
            if (cached.titleFile && path.dirname(cached.titleFile) === transcriptRoot)
              dirtyFiles.add(cached.titleFile)
          }
        for (const listener of changeListeners) listener()
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
        const chatRoot = path.join(workspaceRoot, 'chatSessions')
        activeRoots.add(chatRoot)
        watchTranscripts(chatRoot)
        const metadata = JSON.parse(
          await fs.readFile(path.join(workspaceRoot, 'workspace.json'), 'utf8'),
        )
        const workspacePath = fileURLToPath(metadata.folder ?? metadata.workspace)
        const project = path.basename(workspacePath, '.code-workspace')
        for (const file of files) {
          if (!file.isFile() || !/^[a-zA-Z0-9-]{1,100}\.jsonl$/.test(file.name)) continue
          const filename = path.join(transcriptRoot, file.name)
          const titleFile = path.join(chatRoot, file.name)
          const cached = cache.get(filename)
          const dirty = dirtyFiles.delete(filename)
          const chatDirty = dirtyFiles.delete(titleFile)
          const check =
            force ||
            dirty ||
            chatDirty ||
            !cached ||
            now >= cached.nextCheckAt ||
            cached.offset < cached.stat?.size ||
            cached.chat?.hasBacklog === true
          const stat = check ? await fs.stat(filename) : cached.stat
          candidates.push({
            filename,
            stat,
            check,
            project,
            workspacePath,
            titleFile,
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
    const present = new Set(
      candidates.flatMap((candidate) => [candidate.filename, candidate.titleFile]),
    )
    for (const filename of dirtyFiles) if (!present.has(filename)) dirtyFiles.delete(filename)

    candidates.sort((first, second) => second.stat.mtimeMs - first.stat.mtimeMs)
    const keep = new Set(candidates.map((candidate) => candidate.filename))
    for (const key of cache.keys()) if (!keep.has(key)) cache.delete(key)
    const sessions = []
    let needsRefresh = false

    for (const candidate of candidates) {
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
            titleFile: candidate.titleFile,
          }
          cache.set(candidate.filename, cached)
        }
        if (candidate.check) {
          try {
            cached.chat = await readChatState(candidate.titleFile, cached.chat)
          } catch (error) {
            cached.chat = undefined
            if (error.code !== 'ENOENT') failures++
          }
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
        const session = toSession(cached.state, now, cached.chat?.complete ? cached.chat.state : {})
        if (candidate.check) {
          cached.stat = candidate.stat
          cached.nextCheckAt =
            now +
            (cached.offset < candidate.stat.size ||
            cached.remainder.length ||
            cached.chat?.complete === false
              ? 2000
              : pollInterval(
                  Math.max(
                    cached.state.updatedAt ?? now,
                    cached.observedChangeAt ?? 0,
                    cached.chat?.state.request?.timestamp ?? 0,
                  ),
                  now,
                  session?.status,
                ))
        }
        if (cached.offset < candidate.stat.size || cached.chat?.hasBacklog) needsRefresh = true
        if (!session) continue
        if (
          cached.offset < candidate.stat.size ||
          cached.remainder.length ||
          cached.chat?.complete === false
        ) {
          session.status = 'unknown'
          session.finishedAt = null
          session.statusDetail =
            'Session history is still being read; the next update will continue.'
        }
        sessions.push(session)
      } catch {
        failures++
        cache.delete(candidate.filename)
      }
    }

    return {
      source: 'vscode',
      state: failures ? 'error' : sessions.length ? 'connected' : 'empty',
      metrics: {
        discovered: candidates.length,
        checked: candidates.filter((candidate) => candidate.check).length,
        events: sessions.reduce((count, item) => count + item.events.length, 0),
      },
      needsRefresh,
      message: failures
        ? 'Some transcripts could not be read; available sessions are shown.'
        : sessions.length
          ? 'Local Copilot transcripts'
          : 'No Copilot transcripts found.',
      scannedAt: now,
      sessions,
    }
  }

  return {
    scan,
    close,
    subscribe(listener) {
      changeListeners.add(listener)
      return () => changeListeners.delete(listener)
    },
  }
}

module.exports = {
  createTranscript,
  applyEvent,
  applyChatEvent,
  toSession,
  createVSCodeSource,
  pollInterval,
}
