const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pulse', {
  getAlerts: () => ipcRenderer.invoke('pulse:get-alerts'),
  dismissAlert: (id) => ipcRenderer.invoke('pulse:dismiss-alert', id),
  showAlerts: () => ipcRenderer.invoke('pulse:show-alerts'),
  openAlertInbox: () => ipcRenderer.invoke('pulse:open-alert-inbox'),
  onOpenAlertInbox: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('pulse:open-alert-inbox', handler)
    return () => ipcRenderer.removeListener('pulse:open-alert-inbox', handler)
  },
  hideAlertPopup: (sequence) => ipcRenderer.invoke('pulse:hide-alert-popup', sequence),
  readyAlertPopup: (sequence) => ipcRenderer.invoke('pulse:ready-alert-popup', sequence),
  setSystemNotifications: (enabled) =>
    ipcRenderer.invoke('pulse:set-system-notifications', enabled),
  onAlerts: (listener) => {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('pulse:alerts', handler)
    return () => ipcRenderer.removeListener('pulse:alerts', handler)
  },
  getSessionFeed: () => ipcRenderer.invoke('pulse:get-session-feed'),
  setSessionArchived: (id, archived) =>
    ipcRenderer.invoke('pulse:set-session-archived', id, archived),
  setSessionSource: (source) => ipcRenderer.invoke('pulse:set-session-source', source),
  refreshSessions: () => ipcRenderer.invoke('pulse:refresh-sessions'),
  openVSCode: (id, reference) => ipcRenderer.invoke('pulse:open-vscode', id, reference),
  openSession: (id, reference) => ipcRenderer.invoke('pulse:open-session', id, reference),
  onSessionOpened: (listener) => {
    const handler = (_event, reference) => listener(reference)
    ipcRenderer.on('pulse:session-opened', handler)
    return () => ipcRenderer.removeListener('pulse:session-opened', handler)
  },
  onSessionFeed: (listener) => {
    const handler = (_event, feed) => listener(feed)
    ipcRenderer.on('pulse:session-feed', handler)
    return () => ipcRenderer.removeListener('pulse:session-feed', handler)
  },
  getPinned: () => ipcRenderer.invoke('pulse:get-pinned'),
  setPinned: (pinned) => ipcRenderer.invoke('pulse:set-pinned', pinned),
  openMini: () => ipcRenderer.invoke('pulse:open-mini'),
  hideMini: () => ipcRenderer.invoke('pulse:hide-mini'),
  getMiniState: () => ipcRenderer.invoke('pulse:get-mini-state'),
  setMiniCollapsed: (collapsed) => ipcRenderer.invoke('pulse:set-mini-collapsed', collapsed),
  dockMini: (edge) => ipcRenderer.invoke('pulse:dock-mini', edge),
  expandWorkspace: () => ipcRenderer.invoke('pulse:expand-workspace'),
  openWorkspace: (sessionId) => ipcRenderer.invoke('pulse:open-workspace', sessionId),
  notify: (notification) => ipcRenderer.invoke('pulse:notify', notification),
  onPinnedChange: (listener) => {
    const handler = (_event, pinned) => listener(pinned)
    ipcRenderer.on('pulse:pinned', handler)
    return () => ipcRenderer.removeListener('pulse:pinned', handler)
  },
  onSelectSession: (listener) => {
    const handler = (_event, sessionId) => listener(sessionId)
    ipcRenderer.on('pulse:select-session', handler)
    return () => ipcRenderer.removeListener('pulse:select-session', handler)
  },
  onMiniStateChange: (listener) => {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('pulse:mini-state', handler)
    return () => ipcRenderer.removeListener('pulse:mini-state', handler)
  },
})
