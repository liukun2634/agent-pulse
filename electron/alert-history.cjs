const fs = require('node:fs')
const path = require('node:path')

function validAlert(alert) {
  return (
    alert &&
    ['id', 'sessionId', 'title', 'project', 'task'].every(
      (key) => typeof alert[key] === 'string' && alert[key].length <= 1024,
    ) &&
    ['waiting', 'completed', 'failed'].includes(alert.status) &&
    Number.isFinite(alert.at) &&
    alert.reference?.sessionId === alert.sessionId &&
    alert.reference.status === alert.status &&
    (alert.reference.requestId === null || typeof alert.reference.requestId === 'string') &&
    Number.isFinite(alert.reference.updatedAt) &&
    (alert.reference.finishedAt === null || Number.isFinite(alert.reference.finishedAt))
  )
}

function createAlertHistory(filename, tracker) {
  let serialized = ''
  let warning = null
  let writeError = null
  let blocked = false

  function load() {
    try {
      const saved = JSON.parse(fs.readFileSync(filename, 'utf8'))
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.items) ||
        saved.items.length > 200 ||
        !saved.items.every(validAlert)
      )
        throw new Error('Invalid reminder history.')
      tracker.restore(saved.tracker)
      return saved.items.map((item) => ({ ...item, initial: true }))
    } catch (error) {
      tracker.reset()
      if (error.code !== 'ENOENT') {
        warning = 'Previous reminders could not be restored. Live monitoring is still active.'
        try {
          fs.renameSync(filename, `${filename}.invalid-${Date.now()}`)
        } catch {
          blocked = true
        }
      }
      return []
    }
  }

  function save(items) {
    if (blocked) return
    const value = JSON.stringify({
      version: 1,
      tracker: tracker.snapshot(),
      items: items.slice(-200),
    })
    if (value === serialized) return
    try {
      fs.mkdirSync(path.dirname(filename), { recursive: true })
      fs.writeFileSync(`${filename}.tmp`, value)
      fs.renameSync(`${filename}.tmp`, filename)
      serialized = value
      writeError = null
    } catch {
      writeError =
        'Reminder history could not be saved. Pending reminders may be lost after restart.'
    }
  }

  return {
    load,
    save,
    get warning() {
      return warning ?? writeError
    },
  }
}

module.exports = { createAlertHistory }
