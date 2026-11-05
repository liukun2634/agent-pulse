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
  let closed = false

  function refreshSource(source, force) {
    if (pending.has(source)) return pending.get(source)
    const operation = (async () => {
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
        snapshots.set(source, snapshot)
        onUpdate(source)
      }
    })().finally(() => pending.delete(source))
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
      scannedAt: checked.length ? Math.max(...checked) : null,
    }
  }

  return {
    view: (source) => (source === 'live' ? combinedView() : snapshots.get(source)),
    sessions: () => [...snapshots.values()].flatMap((snapshot) => snapshot.sessions),
    refresh(force = false) {
      if (closed) return Promise.resolve()
      return Promise.all(Object.keys(adapters).map((source) => refreshSource(source, force)))
    },
    close() {
      closed = true
      for (const adapter of Object.values(adapters)) adapter.close()
    },
  }
}

module.exports = { createLiveSources }
