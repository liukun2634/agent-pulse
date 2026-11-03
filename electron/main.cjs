const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  screen,
  session,
  Tray,
} = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const root = path.join(__dirname, '..')
const entry = path.join(root, 'dist', 'index.html')
const iconPath = path.join(root, 'public', 'pulse.png')
const testMode = process.env.PULSE_TEST_MODE === '1'
const devUrl = process.env.PULSE_DEV_SERVER_URL
const windows = new Set()
let mainWindow
let miniWindow
let tray
let quitting = false
let windowMode = 'workspace'
let miniState = { collapsed: false, edge: 'right' }
let expandedMiniSize = [360, 600]

app.setName('Pulse')
app.setAppUserModelId('dev.pulse.agent-monitor')
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

function loadWindow(window, mini = false) {
  if (devUrl) {
    const target = new URL(devUrl)
    if (mini) target.searchParams.set('view', 'mini')
    return window.loadURL(target.href)
  }
  return window.loadFile(entry, mini ? { query: { view: 'mini' } } : {})
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
    if (!quitting) showMini()
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
  windowMode = 'workspace'
  if (!mainWindow || mainWindow.isDestroyed()) createMain()
  if (mainWindow.isMinimized()) mainWindow.restore()
  if (maximize) mainWindow.maximize()
  if (miniWindow && !miniWindow.isDestroyed()) miniWindow.hide()
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
  const area =
    mainWindow && !mainWindow.isDestroyed()
      ? screen.getDisplayMatching(
          mainWindow.isMinimized() ? mainWindow.getNormalBounds() : mainWindow.getBounds(),
        ).workArea
      : screen.getPrimaryDisplay().workArea
  const reveal = () => {
    if (windowMode !== 'mini') return
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
    if (miniWindow.isMinimized()) miniWindow.restore()
    alignMini(area, area.y + 16)
    miniWindow.show()
    miniWindow.focus()
  }
  if (miniWindow && !miniWindow.isDestroyed()) {
    reveal()
    return
  }
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
  miniWindow.once('ready-to-show', reveal)
  void loadWindow(miniWindow, true)
}

function trustedWindow(event) {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || !windows.has(window) || !isAppUrl(event.senderFrame?.url ?? '')) {
    throw new Error('Untrusted application window.')
  }
  return window
}

ipcMain.handle('pulse:get-pinned', (event) => trustedWindow(event).isAlwaysOnTop())
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
ipcMain.handle('pulse:hide-mini', (event) => {
  const window = trustedWindow(event)
  if (window === miniWindow) window.hide()
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
  if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length > 100))
    throw new TypeError('Invalid session ID.')
  showMain(sessionId)
})
ipcMain.handle('pulse:expand-workspace', (event) => {
  trustedWindow(event)
  showMain(undefined, true)
})
ipcMain.handle('pulse:notify', (event, payload) => {
  trustedWindow(event)
  if (!payload || typeof payload.title !== 'string' || typeof payload.body !== 'string')
    throw new TypeError('Invalid notification.')
  if (!Notification.isSupported() || testMode) return
  const notification = new Notification({
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 400),
    icon: iconPath,
    silent: true,
  })
  notification.on('click', () => showMain())
  notification.show()
})

function createTray() {
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) return
  tray = new Tray(icon.resize({ width: 20, height: 20 }))
  tray.setToolTip('Pulse - Agent sessions')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open workspace', click: () => showMain() },
      { label: 'Mini monitor', click: () => showMini() },
      { type: 'separator' },
      { label: 'Quit Pulse', click: () => app.quit() },
    ]),
  )
  tray.on('double-click', () => showMain())
}

if (!testMode && !app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => showMain())
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    )
    Menu.setApplicationMenu(null)
    if (!testMode) createTray()
    createMain()
  })
  app.on('activate', () => showMain())
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('window-all-closed', () => {
    if (!tray) app.quit()
  })
}
