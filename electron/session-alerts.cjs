function sessionReference(session) {
  return {
    sessionId: session.id,
    requestId: session.requestId ?? null,
    ...(session.observationId ? { observationId: session.observationId } : {}),
    status: session.status,
    finishedAt: session.finishedAt ?? null,
    updatedAt: session.updatedAt ?? 0,
  }
}

function matchesReference(session, reference) {
  if (
    !session ||
    !reference ||
    session.id !== reference.sessionId ||
    (session.requestId ?? null) !== reference.requestId ||
    session.observationId !== reference.observationId ||
    session.status !== reference.status
  )
    return false
  if (['completed', 'failed', 'cancelled'].includes(session.status))
    return (
      (session.finishedAt ?? null) === reference.finishedAt &&
      (reference.finishedAt !== null || session.updatedAt === reference.updatedAt)
    )
  return reference.requestId !== null || session.updatedAt === reference.updatedAt
}

function createAlertTracker() {
  const observed = new Map()
  let initialized = false
  let sequence = 0

  function update(sessions, now = Date.now()) {
    const alerts = []
    for (const session of sessions) {
      if (['unknown', 'disconnected'].includes(session.status)) continue
      const previous = observed.get(session.id)
      const recovered = Boolean(
        session.source === 'claude' &&
        !session.hookFresh &&
        previous &&
        session.observationId &&
        previous.observationId !== session.observationId,
      )
      const newRequest =
        !recovered &&
        !!previous?.requestId &&
        !!session.requestId &&
        previous.requestId !== session.requestId
      const terminal = ['completed', 'failed', 'cancelled'].includes(session.status)
      const resumed =
        previous &&
        ['completed', 'failed', 'cancelled'].includes(previous.status) &&
        !terminal &&
        (newRequest || !previous.requestId)
      const active = ['running', 'waiting', 'idle'].includes(session.status)
      const wasActive =
        !recovered &&
        (newRequest ||
          resumed ||
          previous?.active === true ||
          (session.hookFresh && Number.isFinite(session.requestStartedAt)))
      const terminalSent =
        newRequest || resumed || recovered ? false : previous?.terminalSent === true
      const needsInput =
        session.status === 'waiting' &&
        (previous ? previous.status !== 'waiting' || newRequest : true)
      const finished =
        ['completed', 'failed'].includes(session.status) && wasActive && !terminalSent
      if (needsInput || finished)
        alerts.push({
          id: `alert-${++sequence}`,
          sessionId: session.id,
          requestId: session.requestId,
          reference: sessionReference(session),
          initial: !initialized || recovered,
          ...(recovered ? { recovered: true } : {}),
          status: session.status,
          title:
            session.status === 'waiting'
              ? session.source === 'claude'
                ? 'Input needed in Claude Code'
                : 'Input needed in VS Code'
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
        observationId: session.observationId,
        active: active || wasActive,
        terminalSent: terminal || terminalSent,
      })
    }
    initialized = true
    if (observed.size > 1000) {
      const currentIds = new Set(sessions.map((session) => session.id))
      for (const id of observed.keys()) {
        if (!currentIds.has(id)) observed.delete(id)
        if (observed.size <= 1000) break
      }
    }
    return alerts
  }

  function reset() {
    observed.clear()
    initialized = false
  }

  function snapshot() {
    return {
      version: 1,
      sequence,
      observed: [...observed].slice(-1000),
      omitted: Math.max(0, observed.size - 1000),
    }
  }

  function restore(saved) {
    if (
      saved?.version !== 1 ||
      !Number.isSafeInteger(saved.sequence) ||
      saved.sequence < 0 ||
      !Array.isArray(saved.observed) ||
      saved.observed.length > 1000
    )
      throw new Error('Invalid alert baseline.')
    const valid = saved.observed.every(
      (entry) =>
        Array.isArray(entry) &&
        entry.length === 2 &&
        typeof entry[0] === 'string' &&
        entry[0].length <= 512 &&
        entry[1] &&
        ['running', 'waiting', 'completed', 'failed', 'cancelled', 'idle'].includes(
          entry[1].status,
        ) &&
        (entry[1].requestId === undefined || typeof entry[1].requestId === 'string') &&
        (entry[1].observationId === undefined || typeof entry[1].observationId === 'string') &&
        typeof entry[1].active === 'boolean' &&
        typeof entry[1].terminalSent === 'boolean',
    )
    if (!valid) throw new Error('Invalid alert baseline.')
    observed.clear()
    for (const [id, state] of saved.observed) observed.set(id, { ...state })
    sequence = saved.sequence
    initialized = false
  }

  return {
    update,
    reset,
    snapshot,
    restore,
    beginRecovery: () => {
      initialized = false
    },
  }
}

module.exports = { createAlertTracker, sessionReference, matchesReference }
