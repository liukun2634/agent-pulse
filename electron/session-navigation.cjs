const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { matchesReference } = require('./session-alerts.cjs')

function storageKey(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) return null
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function createSessionNavigator({ getSession, resolveTarget, listWindows, send, revealTerminal }) {
  return {
    async reveal(id, reference, instanceId) {
      const current = getSession(id)
      if (!current || !matchesReference(current, reference))
        return {
          mode: 'stale',
          message: 'This request changed. Select the current session and retry.',
        }
      if (current.source === 'claude' && revealTerminal)
        return revealTerminal(id, reference, instanceId)
      if (current.source !== 'vscode')
        return {
          mode: 'unavailable',
          message: 'Navigation for this application is not connected yet.',
        }
      const target = resolveTarget(id)
      const key = storageKey(target?.workspaceStoragePath)
      if (!key || !/^[a-zA-Z0-9-]{1,100}$/.test(target.sessionId))
        return {
          mode: 'unavailable',
          message: 'The original workspace or saved session is unavailable.',
        }
      const windows = (await listWindows()).filter(
        (window) => storageKey(window.workspaceStoragePath) === key,
      )
      if (!windows.length)
        return {
          mode: 'unavailable',
          message:
            'No matching VS Code bridge is connected. Open the original workspace and enable Pulse Session Bridge there.',
        }
      const chosen = instanceId
        ? windows.find((window) => window.instanceId === instanceId)
        : windows.length === 1
          ? windows[0]
          : null
      if (instanceId && !chosen)
        return { mode: 'unavailable', message: 'The selected window is no longer connected.' }
      if (!chosen)
        return {
          mode: 'ambiguous',
          message: 'Choose the original VS Code window.',
          windows: windows.map((window) => ({
            instanceId: window.instanceId,
            label: window.label,
          })),
        }
      if (chosen.chatViewNavigation !== true)
        return {
          mode: 'unavailable',
          message:
            'Reload the target VS Code window to activate the updated Pulse Session Bridge. No Chat editor was opened.',
        }
      if (!matchesReference(getSession(id), reference))
        return { mode: 'stale', message: 'The request changed before navigation.' }
      const requestId = randomUUID()
      try {
        const result = await send(chosen, {
          version: 1,
          requestId,
          instanceId: chosen.instanceId,
          ...target,
        })
        if (!matchesReference(getSession(id), reference))
          return {
            mode: 'stale',
            message:
              'The request changed while opening VS Code. No reminder or read state was changed.',
          }
        if (
          result?.requestId !== requestId ||
          result.instanceId !== chosen.instanceId ||
          result.sessionId !== target.sessionId
        )
          return {
            mode: 'unavailable',
            message: 'The bridge response did not match the requested session.',
          }
        if (result.ok !== true)
          return {
            mode: 'unavailable',
            message: result.message || 'VS Code did not open the saved session.',
          }
        return {
          mode: 'requested',
          windowFocused: result.windowFocused === true,
          message:
            result.message ||
            'The saved session was requested in VS Code. Input focus is not independently verified.',
        }
      } catch {
        return {
          mode: 'unavailable',
          message: 'The VS Code bridge did not respond. No new window was opened.',
        }
      }
    },
  }
}

module.exports = { createSessionNavigator, storageKey }
