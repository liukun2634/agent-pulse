const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const { matchesReference } = require('./session-alerts.cjs')

const execute = promisify(execFile)
const unavailable = (message) => ({ mode: 'unavailable', message })
const stale = () => ({
  mode: 'stale',
  message: 'The Claude process or request changed. Select the current session again.',
})

async function runTerminal(action, target, selection) {
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const helper = path
    .join(__dirname, 'terminal-navigation.ps1')
    .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-File',
    helper,
    '-ProcessId',
    String(target.pid),
    '-Action',
    action,
  ]
  if (selection) args.push('-Selection', Buffer.from(JSON.stringify(selection)).toString('base64'))
  try {
    const result = await execute(executable, args, {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 256 * 1024,
    })
    return JSON.parse(result.stdout.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error(
      'Could not access the existing Windows Terminal. Check that the session is still open and is not running elevated.',
    )
  }
}

function createTerminalNavigator({
  getSession,
  resolveTarget,
  refresh = async () => {},
  run = runTerminal,
  platform = process.platform,
}) {
  const choices = new Map()
  const bindings = new Map()
  let busy = false
  const targetKey = (target) => target && `${target.sessionId}:${target.pid}:${target.startedAt}`
  const validTarget = (target) =>
    target &&
    Number.isSafeInteger(target.pid) &&
    target.pid > 0 &&
    Number.isFinite(target.startedAt)
  const runtimeId = (value) => typeof value === 'string' && /^-?\d+(?:\.-?\d+){1,30}$/.test(value)
  const validSelection = (value) =>
    value &&
    /^-?\d{1,20}$/.test(value.windowHandle) &&
    runtimeId(value.tabId) &&
    (!value.paneId || runtimeId(value.paneId))
  const validStamp = (value) => typeof value === 'string' && /^\d{1,20}$/.test(value)
  function offer(id, target, result) {
    if (
      !validStamp(result.processStart) ||
      !validStamp(result.hostStart) ||
      !Array.isArray(result.choices)
    )
      return unavailable('Windows Terminal did not provide a valid terminal identity.')
    const windows = []
    for (const candidate of result.choices.slice(0, 64)) {
      if (!validSelection(candidate) || typeof candidate.label !== 'string') continue
      const instanceId = randomUUID()
      choices.set(instanceId, {
        id,
        target: targetKey(target),
        expiresAt: Date.now() + 120000,
        selection: { ...candidate, processStart: result.processStart, hostStart: result.hostStart },
      })
      windows.push({ instanceId, label: candidate.label.slice(0, 240) })
    }
    while (choices.size > 128) choices.delete(choices.keys().next().value)
    return windows.length
      ? {
          mode: 'ambiguous',
          windows,
          message:
            'Choose the terminal tab or pane running this Claude session. Its identity cannot be inferred from its title.',
        }
      : unavailable('No existing Windows Terminal tabs were found. Restore the terminal and retry.')
  }
  return {
    async reveal(id, reference, instanceId) {
      if (busy)
        return unavailable('Another terminal navigation is in progress. Retry when it finishes.')
      if (platform !== 'win32')
        return unavailable(
          'Claude terminal navigation currently supports Windows Terminal on Windows.',
        )
      const current = getSession(id)
      if (current?.source !== 'claude' || !matchesReference(current, reference)) return stale()
      const original = resolveTarget(id)
      if (!validTarget(original))
        return unavailable(
          'No live interactive Claude terminal was reported. Background and hook-only sessions cannot be located.',
        )
      busy = true
      try {
        await refresh()
        const target = resolveTarget(id)
        const unchanged = () =>
          matchesReference(getSession(id), reference) &&
          targetKey(resolveTarget(id)) === targetKey(original)
        if (!unchanged() || !validTarget(target)) {
          bindings.delete(id)
          return stale()
        }
        let selection
        if (instanceId) {
          const chosen = choices.get(instanceId)
          if (
            !chosen ||
            chosen.id !== id ||
            chosen.target !== targetKey(target) ||
            chosen.expiresAt < Date.now()
          )
            return stale()
          selection = chosen.selection
          choices.delete(instanceId)
        } else {
          const saved = bindings.get(id)
          if (saved?.target === targetKey(target)) selection = saved.selection
          else bindings.delete(id)
        }
        if (!selection) {
          const result = await run('inspect', target)
          if (!unchanged()) return stale()
          return offer(id, target, result)
        }
        if (!unchanged()) return stale()
        const result = await run('focus', target, selection)
        if (!unchanged()) {
          bindings.delete(id)
          return stale()
        }
        if (Array.isArray(result.choices)) return offer(id, target, result)
        if (
          result.focused !== true ||
          result.windowFocused !== true ||
          !validSelection(result.selection) ||
          result.processStart !== selection.processStart ||
          result.hostStart !== selection.hostStart
        )
          throw new Error('The selected terminal pane could not be verified. Select it again.')
        bindings.set(id, {
          target: targetKey(target),
          selection: {
            ...result.selection,
            processStart: result.processStart,
            hostStart: result.hostStart,
          },
        })
        while (bindings.size > 200) bindings.delete(bindings.keys().next().value)
        return {
          mode: 'requested',
          windowFocused: result.windowFocused === true,
          message:
            'Focused the terminal pane you selected. No input was sent; the pane-to-Claude association is user-selected.',
        }
      } catch {
        bindings.delete(id)
        return unavailable(
          'Could not focus the existing Windows Terminal pane. It may have closed, changed, or require accessibility access. Retry to select it again.',
        )
      } finally {
        busy = false
      }
    },
  }
}

module.exports = { createTerminalNavigator }
