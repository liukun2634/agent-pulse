const fs = require('node:fs')
const path = require('node:path')

function validateSources(value) {
  if (!value || typeof value !== 'object') throw new TypeError('Invalid source settings.')
  const sources = {}
  for (const key of ['vscodeStorage', 'claudeExecutable']) {
    const location = value[key]
    if (typeof location !== 'string' || location.length > 2048 || location.includes('\0'))
      throw new TypeError('Invalid source path.')
    sources[key] = location.trim()
    if (sources[key] && !path.isAbsolute(sources[key]))
      throw new TypeError('Choose an absolute source path.')
  }
  return sources
}

function createDesktopState(filename) {
  let state = {
    version: 1,
    revision: 0,
    sources: { vscodeStorage: '', claudeExecutable: '' },
    seenReplies: {},
    windowState: { mode: 'workspace' },
  }
  let warning = null
  try {
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (saved.version !== 1) throw new Error('Unsupported settings version.')
    state = {
      ...state,
      sources: validateSources(saved.sources),
      revision: Number.isSafeInteger(saved.revision) ? saved.revision : 0,
      seenReplies: Object.fromEntries(
        Object.entries(saved.seenReplies ?? {})
          .filter(
            ([id, marker]) =>
              /^(vscode|claude):/.test(id) &&
              id.length < 512 &&
              (typeof marker === 'string' || typeof marker === 'number'),
          )
          .slice(-5000),
      ),
      windowState:
        saved.windowState && ['workspace', 'mini'].includes(saved.windowState.mode)
          ? saved.windowState
          : state.windowState,
      readTrimmed: saved.readTrimmed === true,
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      warning = 'Desktop settings could not be restored. Defaults are active.'
      try {
        fs.renameSync(filename, `${filename}.invalid-${Date.now()}`)
      } catch {}
    }
  }
  function save(next) {
    next = { ...next, revision: state.revision + 1 }
    try {
      fs.mkdirSync(path.dirname(filename), { recursive: true })
      fs.writeFileSync(`${filename}.tmp`, JSON.stringify(next))
      fs.renameSync(`${filename}.tmp`, filename)
    } catch (error) {
      warning = 'Desktop settings could not be saved.'
      throw error
    }
    state = next
    warning = null
    return snapshot()
  }
  function snapshot() {
    return {
      ...structuredClone(state),
      warning:
        warning ??
        (state.readTrimmed
          ? 'Read history reached 5000 entries. Older markers were evicted.'
          : null),
    }
  }
  return {
    snapshot,
    setSources: (value) => save({ ...state, sources: validateSources(value) }),
    importReadMarkers(value) {
      const incoming = Object.fromEntries(
        Object.entries(value ?? {})
          .slice(-5000)
          .filter(
            ([id, marker]) =>
              /^(vscode|claude):/.test(id) &&
              id.length < 512 &&
              (typeof marker === 'number' || (typeof marker === 'string' && marker.length < 1024)),
          ),
      )
      const merged = { ...incoming, ...state.seenReplies }
      return Object.keys(merged).length === Object.keys(state.seenReplies).length
        ? snapshot()
        : save({ ...state, seenReplies: Object.fromEntries(Object.entries(merged).slice(-5000)) })
    },
    markRead(id, marker) {
      if (
        typeof id !== 'string' ||
        !/^(vscode|claude):/.test(id) ||
        id.length > 512 ||
        typeof marker !== 'string' ||
        marker.length > 1024
      )
        throw new TypeError('Invalid read marker.')
      const seenReplies = { ...state.seenReplies }
      delete seenReplies[id]
      seenReplies[id] = marker
      return save({
        ...state,
        readTrimmed: state.readTrimmed || Object.keys(seenReplies).length > 5000,
        seenReplies: Object.fromEntries(Object.entries(seenReplies).slice(-5000)),
      })
    },
    saveWindow(mode, value) {
      if (
        !['workspace', 'mini'].includes(mode) ||
        !value ||
        !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value.bounds?.[key])) ||
        value.bounds.width < 1 ||
        value.bounds.height < 1
      )
        throw new TypeError('Invalid window bounds.')
      return save({
        ...state,
        windowState: {
          ...state.windowState,
          mode,
          [mode]: {
            bounds: value.bounds,
            pinned: value.pinned === true,
            maximized: value.maximized === true,
            collapsed: value.collapsed === true,
            edge: value.edge === 'left' ? 'left' : 'right',
            expandedSize:
              Array.isArray(value.expandedSize) &&
              value.expandedSize.length === 2 &&
              value.expandedSize.every((size) => Number.isFinite(size) && size > 0)
                ? value.expandedSize
                : [360, 600],
          },
        },
      })
    },
  }
}

function constrainBounds(bounds, area) {
  const width = Math.min(
    area.width,
    Math.max(72, Number.isFinite(bounds?.width) ? bounds.width : 1000),
  )
  const height = Math.min(
    area.height,
    Math.max(260, Number.isFinite(bounds?.height) ? bounds.height : 700),
  )
  return {
    width,
    height,
    x: Math.max(
      area.x,
      Math.min(Number.isFinite(bounds?.x) ? bounds.x : area.x, area.x + area.width - width),
    ),
    y: Math.max(
      area.y,
      Math.min(Number.isFinite(bounds?.y) ? bounds.y : area.y, area.y + area.height - height),
    ),
  }
}
module.exports = { createDesktopState, validateSources, constrainBounds }
