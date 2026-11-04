function createAlertTracker() {
  const observed = new Map()
  let initialized = false
  let sequence = 0

  function update(sessions, now = Date.now()) {
    const alerts = []
    for (const session of sessions) {
      if (['unknown', 'disconnected'].includes(session.status)) continue
      const previous = observed.get(session.id)
      const newRequest =
        !!previous?.requestId && !!session.requestId && previous.requestId !== session.requestId
      const terminal = ['completed', 'failed', 'cancelled'].includes(session.status)
      const resumed =
        previous &&
        ['completed', 'failed', 'cancelled'].includes(previous.status) &&
        !terminal &&
        (newRequest || !previous.requestId)
      const active = ['running', 'waiting', 'idle'].includes(session.status)
      const wasActive = newRequest || resumed || previous?.active === true
      const terminalSent = newRequest || resumed ? false : previous?.terminalSent === true
      const needsInput =
        session.status === 'waiting' &&
        (previous ? previous.status !== 'waiting' || newRequest : initialized)
      const finished =
        ['completed', 'failed'].includes(session.status) && wasActive && !terminalSent
      if (needsInput || finished)
        alerts.push({
          id: `alert-${++sequence}`,
          sessionId: session.id,
          requestId: session.requestId,
          status: session.status,
          title:
            session.status === 'waiting'
              ? 'Input needed in VS Code'
              : session.status === 'completed'
                ? 'Rely Ready'
                : 'Session reported an error',
          project: session.project,
          task: session.task,
          at: now,
        })
      observed.set(session.id, {
        status: session.status,
        requestId: session.requestId ?? previous?.requestId,
        active: active || wasActive,
        terminalSent: terminal || terminalSent,
      })
    }
    initialized = true
    while (observed.size > 1000) observed.delete(observed.keys().next().value)
    return alerts
  }

  function reset() {
    observed.clear()
    initialized = false
  }

  return { update, reset }
}

module.exports = { createAlertTracker }
