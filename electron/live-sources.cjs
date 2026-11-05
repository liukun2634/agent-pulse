function createLiveSources(adapters, onUpdate) {
  const snapshots = new Map(
    Object.keys(adapters).map((source) => [
      source,
      {
        source,
        state: 'connecting',
        message: `Connecting to ${source === 'claude' ? 'Claude Code' : 'VS Code'}...`,
        sessions: [],
        scannedAt: null,
      },
    ]),
  )
  const pending = new Map()
  const queued = new Set()
  const wakeTimers = new Map()
  let closed = false

  function wake(source) {
    if (closed) return
    if (pending.has(source)) {
      queued.add(source)
      return
    }
    if (wakeTimers.has(source)) return
    wakeTimers.set(
      source,
      setTimeout(() => {
        wakeTimers.delete(source)
        void refreshSource(source, false)
      }, 100),
    )
  }

  function refreshSource(source, force) {
    if (pending.has(source)) return pending.get(source)
    const operation = (async () => {
      const started = performance.now()
      let snapshot
      try {
        snapshot = await adapters[source].scan(Date.now(), { force })
      } catch {
        snapshot = {
          ...snapshots.get(source),
          state: 'error',
          message: `${source} scan failed. Retrying.`,
          scannedAt: Date.now(),
          sessions: snapshots
            .get(source)
            .sessions.map((item) => ({ ...item, status: 'disconnected' })),
        }
      }
      if (!closed) {
        snapshots.set(source, { ...snapshot, durationMs: Math.round(performance.now() - started) })
        if (snapshot.needsRefresh) queued.add(source)
        onUpdate(source)
      }
    })().finally(() => {
      pending.delete(source)
      if (queued.delete(source)) wake(source)
    })
    pending.set(source, operation)
    return operation
  }

  function combinedView() {
    const sources = [...snapshots.values()]
    const failed = sources.some((snapshot) => ['error', 'unavailable'].includes(snapshot.state))
    const connected = sources.some((snapshot) => snapshot.state === 'connected')
    const connecting = sources.some((snapshot) => snapshot.state === 'connecting')
    const checked = sources.map((snapshot) => snapshot.scannedAt).filter(Number.isFinite)
    return {
      source: 'live',
      state: failed ? 'error' : connected ? 'connected' : connecting ? 'connecting' : 'empty',
      message: sources
        .map((snapshot) => {
          const name = snapshot.source === 'claude' ? 'Claude Code' : 'VS Code'
          const detail = ['error', 'unavailable'].includes(snapshot.state)
            ? snapshot.message
            : snapshot.state === 'connected'
              ? 'Connected'
              : snapshot.state === 'empty'
                ? 'No sessions'
                : 'Connecting...'
          return `${name}: ${detail}`
        })
        .join(' / '),
      sessions: sources.flatMap((snapshot) => snapshot.sessions),
      sources: sources.map((snapshot) => ({
        id: snapshot.source,
        name: snapshot.source === 'claude' ? 'Claude Code' : 'VS Code / Copilot',
        state: snapshot.state,
        message: snapshot.message,
        scannedAt: snapshot.scannedAt,
        durationMs: snapshot.durationMs ?? null,
        acquisition:
          snapshot.source === 'vscode' ? 'File events + 2s fallback' : 'CLI snapshots every 2s',
      })),
      scannedAt: checked.length ? Math.max(...checked) : null,
    }
  }

  const unsubscribe = Object.entries(adapters).map(([source, adapter]) =>
    adapter.subscribe?.(() => wake(source)),
  )

  return {
    view: (source) => (source === 'live' ? combinedView() : snapshots.get(source)),
    sessions: () => [...snapshots.values()].flatMap((snapshot) => snapshot.sessions),
    refresh(force = false) {
      if (closed) return Promise.resolve()
      return Promise.all(Object.keys(adapters).map((source) => refreshSource(source, force)))
    },
    close() {
      closed = true
      for (const stop of unsubscribe) stop?.()
      for (const timer of wakeTimers.values()) clearTimeout(timer)
      wakeTimers.clear()
      queued.clear()
      for (const adapter of Object.values(adapters)) adapter.close()
    },
  }
}

module.exports = { createLiveSources }
