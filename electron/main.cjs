const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  powerMonitor,
  screen,
  session,
  Tray,
} = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createVSCodeSource } = require('./vscode-sessions.cjs')
const { createClaudeSource } = require('./claude-sessions.cjs')
const { createLiveSources } = require('./live-sources.cjs')
const { createAlertTracker, matchesReference } = require('./session-alerts.cjs')
const { createAlertHistory } = require('./alert-history.cjs')
const fs = require('node:fs')

const root = path.join(__dirname, '..')
const entry = path.join(root, 'dist', 'index.html')
const packagedApp = app.isPackaged && !process.defaultApp
const iconRoot = packagedApp ? path.join(process.resourcesPath, 'icons') : path.join(root, 'public')
const iconPath = path.join(iconRoot, process.platform === 'win32' ? 'pulse.ico' : 'pulse.png')
const testMode = process.env.PULSE_TEST_MODE === '1'
const applicationId = testMode
  ? 'dev.pulse.agent-monitor.test'
  : packagedApp
    ? 'dev.pulse.agent-monitor'
    : 'dev.pulse.agent-monitor.development'
const devUrl = process.env.PULSE_DEV_SERVER_URL
const windows = new Set()
let mainWindow
let miniWindow
let miniReady = false
let alertWindow
let pendingAlerts = []
let alertRevision = 0
let popupSequence = 0
let popupIds = []
let popupRevealPending = false
let systemNotifications = false
let popupDurationMs = 5000
const popupDurations = new Set([0, 5000, 10000, 30000])
const alertTracker = createAlertTracker()
let alertHistory
const nativeNotifications = new Set()
let archivedSessions = new Map()
let tray
let quitting = false
let windowMode = 'workspace'
let miniState = { collapsed: false, edge: 'right' }
let expandedMiniSize = [360, 600]
const vscodeSource = createVSCodeSource(
  process.env.PULSE_VSCODE_STORAGE ||
    (testMode
      ? path.join(process.env.PULSE_TEST_DATA || app.getPath('temp'), 'no-vscode-storage')
      : path.join(app.getPath('appData'), 'Code', 'User', 'workspaceStorage')),
)
const claudeSource = createClaudeSource(
  testMode
    ? {
        query: async () =>
          process.env.PULSE_TEST_CLAUDE
            ? fs.promises.readFile(process.env.PULSE_TEST_CLAUDE, 'utf8')
            : '[]',
      }
    : {},
)
const initializedSources = new Set()
const liveSources = createLiveSources({ vscode: vscodeSource, claude: claudeSource }, (source) => {
  if (!quitting) publishFeed(feed.source === 'demo' ? feed : liveSources.view(feed.source), source)
})
let feed = {
  source: testMode && !process.env.PULSE_VSCODE_STORAGE ? 'demo' : 'live',
  state: 'connecting',
  message: 'Reading local agent sessions...',
  sessions: [],
  scannedAt: null,
  revision: 0,
}
let feedTimer
function publishFeed(next, updatedSource) {
  const monitored = liveSources.sessions()
  const freshAlerts = alertTracker.update(monitored).map((alert) => ({
    ...alert,
    initial:
      alert.initial ||
      !initializedSources.has(monitored.find((item) => item.id === alert.sessionId)?.source),
  }))
  if (updatedSource) initializedSources.add(updatedSource)
  feed = {
    ...next,
    sources: liveSources.view('live').sources,
    sessions: next.sessions.map((item) => ({ ...item, archivedAt: archivedSessions.get(item.id) })),
    revision: feed.revision + 1,
  }
  for (const window of windows) window.webContents.send('pulse:session-feed', feed)
  const previousCount = pendingAlerts.length
  pendingAlerts = pendingAlerts.filter((alert) => {
    const current = monitored.find((item) => item.id === alert.sessionId)
    if (!current || ['unknown', 'disconnected'].includes(current.status)) return true
    if (alert.requestId && current.requestId && alert.requestId !== current.requestId) return false
    if (alert.status !== 'waiting' && alert.requestId) return true
    return current.status === alert.status
  })
  for (const alert of freshAlerts) {
    pendingAlerts = pendingAlerts.filter((item) => item.sessionId !== alert.sessionId)
    pendingAlerts.push(alert)
    if (systemNotifications && !alert.initial)
      showSystemNotification({
        title: alert.title,
        body: `${alert.project}: ${alert.task}`,
        sessionId: alert.sessionId,
        reference: { ...alert.reference, alertId: alert.id },
      })
  }
  const storageChanged = persistAlertHistory()
  if (freshAlerts.length || previousCount !== pendingAlerts.length || storageChanged)
    publishAlerts()
  const popups = freshAlerts.filter((alert) => !alert.initial)
  if (popups.length) showAlertWindow(popups.map((alert) => alert.id))
}

function alertState() {
  return {
    items: pendingAlerts,
    revision: alertRevision,
    systemNotifications,
    popupDurationMs,
    storageWarning: alertHistory?.warning ?? null,
    popup: { sequence: popupSequence, ids: popupIds },
  }
}

function persistAlertHistory() {
  if (!alertHistory) return false
  const previous = alertHistory.warning
  alertHistory.save(pendingAlerts)
  return previous !== alertHistory.warning
}

function publishAlerts() {
  persistAlertHistory()
  alertRevision++
  for (const window of windows) window.webContents.send('pulse:alerts', alertState())
  if (
    !pendingAlerts.some((alert) => popupIds.includes(alert.id)) &&
    alertWindow &&
    !alertWindow.isDestroyed()
  ) {
    popupRevealPending = false
    alertWindow.hide()
  }
  if (tray)
    tray.setToolTip(
      pendingAlerts.length
        ? `Pulse - ${pendingAlerts.length} pending alerts`
        : 'Pulse - Agent sessions',
    )
}

function revealAlertWindow(sequence) {
  if (
    sequence !== popupSequence ||
    !popupRevealPending ||
    !popupIds.length ||
    !alertWindow ||
    alertWindow.isDestroyed()
  )
    return
  popupRevealPending = false
  const anchor = windowMode === 'mini' ? miniWindow : mainWindow
  const area =
    anchor && !anchor.isDestroyed()
      ? screen.getDisplayMatching(anchor.getBounds()).workArea
      : screen.getPrimaryDisplay().workArea
  const bounds = alertWindow.getBounds()
  alertWindow.setPosition(area.x + Math.round((area.width - bounds.width) / 2), area.y + 16)
  alertWindow.showInactive()
}

function showAlertWindow(ids = pendingAlerts.map((alert) => alert.id)) {
  popupIds = ids.filter((id) => pendingAlerts.some((alert) => alert.id === id))
  if (!popupIds.length) return
  popupSequence++
  popupRevealPending = true
  publishAlerts()
  if (alertWindow && !alertWindow.isDestroyed()) return
  alertWindow = new BrowserWindow({
    width: Math.min(520, screen.getPrimaryDisplay().workArea.width - 32),
    height: 112,
    resizable: false,
    maximizable: false,
    minimizable: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    title: 'Pulse - Session alert',
    icon: iconPath,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  secureWindow(alertWindow)
  alertWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      alertWindow.hide()
    }
  })
  void loadWindow(alertWindow, 'alerts')
}

async function refreshFeed(force = false) {
  await liveSources.refresh(force)
  return feed
}

app.setName('Pulse')
app.setAppUserModelId(applicationId)
if (testMode && process.env.PULSE_TEST_DATA) app.setPath('userData', process.env.PULSE_TEST_DATA)
if (devUrl) {
  const parsed = new URL(devUrl)
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('The development server must be local HTTP.')
  }
}

function isAppUrl(url) {
  try {
    if (devUrl) return new URL(url).origin === new URL(devUrl).origin
    return url.split('?')[0].split('#')[0] === pathToFileURL(entry).href
  } catch {
    return false
  }
}

function secureWindow(window) {
  windows.add(window)
  if (process.platform === 'win32')
    window.setAppDetails({
      appId: applicationId,
      appIconPath: iconPath,
      appIconIndex: 0,
      relaunchDisplayName: 'Agent Pulse',
      relaunchCommand: packagedApp ? `"${process.execPath}"` : `"${process.execPath}" "${root}"`,
    })
  window.on('closed', () => windows.delete(window))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.on('always-on-top-changed', (_event, pinned) => {
    if (!window.isDestroyed()) window.webContents.send('pulse:pinned', pinned)
  })
}

function loadWindow(window, view = '') {
  if (devUrl) {
    const target = new URL(devUrl)
    if (view) target.searchParams.set('view', view)
    return window.loadURL(target.href)
  }
  return window.loadFile(entry, view ? { query: { view } } : {})
}

function createMain() {
  const area = screen.getPrimaryDisplay().workArea
  mainWindow = new BrowserWindow({
    width: Math.min(1440, area.width - 60),
    height: Math.min(980, area.height - 60),
    minWidth: 850,
    minHeight: 620,
    backgroundColor: '#f9faf9',
    title: 'Pulse',
    icon: iconPath,
    show: false,
    skipTaskbar: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  secureWindow(mainWindow)
  mainWindow.once('ready-to-show', () => {
    if (windowMode === 'workspace') mainWindow.show()
  })
  mainWindow.on('minimize', () => {
    if (!quitting && windowMode !== 'mini') showMini()
  })
  mainWindow.on('close', (event) => {
    if (!quitting && tray) {
      event.preventDefault()
      mainWindow.hide()
    }
  })
  void loadWindow(mainWindow)
}

function showMain(sessionId, maximize = false) {
  const targetSession = liveSources.sessions().find((item) => item.id === sessionId)
  if (targetSession && feed.source === 'demo') publishFeed(liveSources.view('live'))
  windowMode = 'workspace'
  if (!mainWindow || mainWindow.isDestroyed()) createMain()
  if (miniWindow && !miniWindow.isDestroyed()) {
    miniWindow.setSkipTaskbar(true)
    miniWindow.hide()
  }
  mainWindow.setSkipTaskbar(false)
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (maximize) mainWindow.maximize()
  mainWindow.show()
  mainWindow.focus()
  if (typeof sessionId === 'string') {
    if (mainWindow.webContents.isLoading()) {
      mainWindow.webContents.once('did-finish-load', () =>
        mainWindow.webContents.send('pulse:select-session', sessionId),
      )
    } else mainWindow.webContents.send('pulse:select-session', sessionId)
  }
}

function restoreWindow() {
  if (windowMode === 'mini') showMini()
  else showMain()
}

function showAlertInbox() {
  showMain()
  const reveal = () => mainWindow.webContents.send('pulse:open-alert-inbox')
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', reveal)
  else reveal()
}

function alignMini(area, top = miniWindow.getBounds().y) {
  const bounds = miniWindow.getBounds()
  const horizontal =
    miniState.edge === 'left' ? area.x + 12 : area.x + area.width - bounds.width - 12
  const vertical = Math.max(area.y + 12, Math.min(top, area.y + area.height - bounds.height - 12))
  miniWindow.setPosition(horizontal, vertical)
}

function updateMiniState(nextState) {
  const area = screen.getDisplayMatching(miniWindow.getBounds()).workArea
  const top = miniWindow.getBounds().y
  if (nextState.collapsed !== miniState.collapsed) {
    if (nextState.collapsed) expandedMiniSize = miniWindow.getContentSize()
    miniWindow.setMinimumSize(nextState.collapsed ? 72 : 330, nextState.collapsed ? 260 : 350)
    miniWindow.setResizable(!nextState.collapsed)
    miniWindow.setContentSize(
      nextState.collapsed ? 76 : expandedMiniSize[0],
      Math.min(nextState.collapsed ? 540 : expandedMiniSize[1], area.height - 32),
    )
  }
  miniState = nextState
  alignMini(area, top)
  miniWindow.webContents.send('pulse:mini-state', miniState)
  return miniState
}

function showMini() {
  windowMode = 'mini'
  const existing = miniWindow && !miniWindow.isDestroyed()
  const area = existing
    ? screen.getDisplayMatching(
        miniWindow.isMinimized() ? miniWindow.getNormalBounds() : miniWindow.getBounds(),
      ).workArea
    : mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(
          mainWindow.isMinimized() ? mainWindow.getNormalBounds() : mainWindow.getBounds(),
        ).workArea
      : screen.getPrimaryDisplay().workArea
  const reveal = () => {
    if (windowMode !== 'mini') return
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setSkipTaskbar(true)
      mainWindow.hide()
    }
    miniWindow.setSkipTaskbar(false)
    if (miniWindow.isMinimized()) miniWindow.restore()
    if (!existing) alignMini(area, area.y + 16)
    else {
      const bounds = miniWindow.getBounds()
      const horizontal = Math.max(area.x, Math.min(bounds.x, area.x + area.width - bounds.width))
      const vertical = Math.max(area.y, Math.min(bounds.y, area.y + area.height - bounds.height))
      if (horizontal !== bounds.x || vertical !== bounds.y)
        miniWindow.setPosition(horizontal, vertical, false)
    }
    miniWindow.show()
    miniWindow.focus()
  }
  if (existing) {
    if (miniReady) reveal()
    return
  }
  miniReady = false
  miniWindow = new BrowserWindow({
    width: miniState.collapsed ? 76 : expandedMiniSize[0],
    height: Math.min(miniState.collapsed ? 540 : expandedMiniSize[1], area.height - 32),
    minWidth: miniState.collapsed ? 72 : 330,
    minHeight: miniState.collapsed ? 260 : 350,
    resizable: !miniState.collapsed,
    maximizable: false,
    fullscreenable: false,
    x: area.x + area.width - 372,
    y: area.y + 16,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#fbfcfb',
    title: 'Pulse - Mini Monitor',
    icon: iconPath,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  secureWindow(miniWindow)
  miniWindow.once('ready-to-show', () => {
    miniReady = true
    reveal()
  })
  void loadWindow(miniWindow, 'mini')
}

function trustedWindow(event) {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || !windows.has(window) || !isAppUrl(event.senderFrame?.url ?? '')) {
    throw new Error('Untrusted application window.')
  }
  return window
}

ipcMain.handle('pulse:get-pinned', (event) => trustedWindow(event).isAlwaysOnTop())
ipcMain.handle('pulse:get-alerts', (event) => {
  trustedWindow(event)
  return alertState()
})
ipcMain.handle('pulse:dismiss-alert', (event, id) => {
  trustedWindow(event)
  if (typeof id !== 'string') throw new TypeError('Invalid alert ID.')
  pendingAlerts = pendingAlerts.filter((alert) => alert.id !== id)
  publishAlerts()
})
ipcMain.handle('pulse:show-alerts', (event) => {
  trustedWindow(event)
  showAlertWindow()
})
ipcMain.handle('pulse:open-alert-inbox', (event) => {
  trustedWindow(event)
  showAlertInbox()
})
ipcMain.handle('pulse:hide-alert-popup', (event, sequence) => {
  if (trustedWindow(event) !== alertWindow) throw new Error('Invalid popup window.')
  if (sequence === popupSequence) {
    popupRevealPending = false
    alertWindow.hide()
  }
})
ipcMain.handle('pulse:ready-alert-popup', (event, sequence) => {
  if (trustedWindow(event) !== alertWindow) throw new Error('Invalid popup window.')
  revealAlertWindow(sequence)
})
function saveNotificationSettings(enabled, duration) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  const filename = path.join(app.getPath('userData'), 'notification-settings.json')
  fs.writeFileSync(
    `${filename}.tmp`,
    JSON.stringify({ version: 2, systemNotifications: enabled, popupDurationMs: duration }),
  )
  fs.renameSync(`${filename}.tmp`, filename)
  systemNotifications = enabled
  popupDurationMs = duration
  publishAlerts()
  return alertState()
}
ipcMain.handle('pulse:set-system-notifications', (event, enabled) => {
  trustedWindow(event)
  if (typeof enabled !== 'boolean') throw new TypeError('Invalid notification setting.')
  return saveNotificationSettings(enabled, popupDurationMs)
})
ipcMain.handle('pulse:set-popup-duration', (event, duration) => {
  trustedWindow(event)
  if (!popupDurations.has(duration)) throw new TypeError('Invalid popup duration.')
  return saveNotificationSettings(systemNotifications, duration)
})
ipcMain.handle('pulse:get-session-feed', (event) => {
  trustedWindow(event)
  return feed
})
ipcMain.handle('pulse:set-session-archived', (event, id, archived) => {
  trustedWindow(event)
  if (typeof archived !== 'boolean' || !liveSources.sessions().some((item) => item.id === id))
    throw new TypeError('Invalid archive request.')
  const next = new Map(archivedSessions)
  if (archived) next.set(id, Date.now())
  else next.delete(id)
  const filename = path.join(app.getPath('userData'), 'session-management.json')
  fs.mkdirSync(app.getPath('userData'), { recursive: true })
  fs.writeFileSync(
    `${filename}.tmp`,
    JSON.stringify({ version: 1, archived: Object.fromEntries(next) }),
  )
  fs.renameSync(`${filename}.tmp`, filename)
  archivedSessions = next
  publishFeed(feed)
})
ipcMain.handle('pulse:set-session-source', (event, source) => {
  trustedWindow(event)
  if (!['demo', 'live'].includes(source)) throw new TypeError('Invalid session source.')
  if (source !== feed.source) {
    publishFeed(
      source === 'demo'
        ? { source, state: 'demo', message: 'Sample sessions', sessions: [], scannedAt: null }
        : liveSources.view(source),
    )
  }
  void refreshFeed(true)
  return feed
})
ipcMain.handle('pulse:refresh-sessions', (event) => {
  trustedWindow(event)
  return refreshFeed(true)
})
async function openSessionDetails(id, expected) {
  if (typeof id !== 'string' || !liveSources.sessions().some((item) => item.id === id))
    throw new TypeError('Unknown session.')
  const openedSnapshot = liveSources.sessions().find((item) => item.id === id)
  if (
    expected &&
    (!matchesReference(openedSnapshot, expected) ||
      (expected.alertId &&
        !pendingAlerts.some((alert) => alert.id === expected.alertId && alert.sessionId === id)))
  )
    return {
      mode: 'stale',
      message: 'This request has changed. Select the current session or reminder and try again.',
    }
  showMain(id)
  return { mode: 'pulse-details' }
}
ipcMain.handle('pulse:open-session', async (event, id, reference) => {
  trustedWindow(event)
  return openSessionDetails(id, reference)
})
ipcMain.handle('pulse:set-pinned', (event, pinned) => {
  if (typeof pinned !== 'boolean') throw new TypeError('Expected a boolean.')
  const window = trustedWindow(event)
  window.setAlwaysOnTop(pinned)
  return window.isAlwaysOnTop()
})
ipcMain.handle('pulse:open-mini', (event) => {
  trustedWindow(event)
  showMini()
})
ipcMain.handle('pulse:minimize-mini', (event) => {
  const window = trustedWindow(event)
  if (window === miniWindow) window.minimize()
})
ipcMain.handle('pulse:get-mini-state', (event) => {
  trustedWindow(event)
  return miniState
})
ipcMain.handle('pulse:set-mini-collapsed', (event, collapsed) => {
  if (trustedWindow(event) !== miniWindow || typeof collapsed !== 'boolean')
    throw new TypeError('Invalid mini window request.')
  return updateMiniState({ ...miniState, collapsed })
})
ipcMain.handle('pulse:dock-mini', (event, edge) => {
  if (trustedWindow(event) !== miniWindow || !['left', 'right'].includes(edge))
    throw new TypeError('Invalid dock edge.')
  return updateMiniState({ ...miniState, edge })
})
ipcMain.handle('pulse:open-workspace', (event, sessionId) => {
  trustedWindow(event)
  if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length > 240))
    throw new TypeError('Invalid session ID.')
  showMain(sessionId)
})
ipcMain.handle('pulse:expand-workspace', (event) => {
  trustedWindow(event)
  showMain(undefined, true)
})
function showSystemNotification(payload) {
  if (!Notification.isSupported() || testMode) return
  const notification = new Notification({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 400),
    icon: iconPath,
    silent: true,
  })
  nativeNotifications.add(notification)
  notification.on('close', () => nativeNotifications.delete(notification))
  notification.on('failed', () => nativeNotifications.delete(notification))
  const sessionId =
    typeof payload.sessionId === 'string' &&
    liveSources.sessions().some((item) => item.id === payload.sessionId)
      ? payload.sessionId
      : undefined
  notification.on('click', () => {
    if (sessionId)
      void openSessionDetails(sessionId, payload.reference)
        .then((result) => {
          if (result.mode === 'stale') showAlertInbox()
        })
        .catch(() => showMain(sessionId))
    else showMain()
  })
  notification.show()
}
ipcMain.handle('pulse:notify', (event, payload) => {
  trustedWindow(event)
  if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string')
    throw new TypeError('Invalid notification.')
  if (feed.source === 'demo') showSystemNotification(payload)
})

function createTray() {
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) return
  tray = new Tray(icon)
  tray.setToolTip('Pulse - Agent sessions')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Show Pulse', click: () => restoreWindow() },
      { type: 'separator' },
      { label: 'Open workspace', click: () => showMain() },
      { label: 'Pending reminders', click: () => showAlertInbox() },
      { label: 'Mini monitor', click: () => showMini() },
      { type: 'separator' },
      { label: 'Quit Pulse', click: () => app.quit() },
    ]),
  )
  tray.on('click', () => restoreWindow())
  tray.on('double-click', () => restoreWindow())
}

if (!testMode && !app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => restoreWindow())
  app.whenReady().then(() => {
    alertHistory = createAlertHistory(
      path.join(app.getPath('userData'), 'reminder-history.json'),
      alertTracker,
    )
    pendingAlerts = alertHistory.load()
    powerMonitor.on('suspend', () => {
      initializedSources.clear()
      alertTracker.beginRecovery()
    })
    powerMonitor.on('resume', () => {
      initializedSources.clear()
      alertTracker.beginRecovery()
      void refreshFeed(true)
    })
    try {
      const saved = JSON.parse(
        fs.readFileSync(path.join(app.getPath('userData'), 'session-management.json'), 'utf8'),
      )
      if (saved.version === 1 && saved.archived && typeof saved.archived === 'object')
        archivedSessions = new Map(
          Object.entries(saved.archived).filter(
            ([id, at]) =>
              /^(vscode|claude):/.test(id) &&
              typeof at === 'number' &&
              Number.isFinite(at) &&
              at > 0,
          ),
        )
    } catch {}
    try {
      const saved = JSON.parse(
        fs.readFileSync(path.join(app.getPath('userData'), 'notification-settings.json'), 'utf8'),
      )
      systemNotifications = saved.version === 2 && saved.systemNotifications === true
      if (saved.version === 2 && popupDurations.has(saved.popupDurationMs))
        popupDurationMs = saved.popupDurationMs
    } catch {}
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    )
    Menu.setApplicationMenu(null)
    if (!testMode) createTray()
    createMain()
    void refreshFeed()
    feedTimer = setInterval(() => void refreshFeed(), 2000)
  })
  app.on('activate', () => restoreWindow())
  app.on('before-quit', () => {
    persistAlertHistory()
    quitting = true
    clearInterval(feedTimer)
    liveSources.close()
  })
  app.on('window-all-closed', () => {
    if (!tray) app.quit()
  })
}
