const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('pulse', {
  getSessionFeed: () => ipcRenderer.invoke('pulse:get-session-feed'),
  setSessionSource: (source) => ipcRenderer.invoke('pulse:set-session-source', source),
  refreshSessions: () => ipcRenderer.invoke('pulse:refresh-sessions'),
  openVSCode: (id) => ipcRenderer.invoke('pulse:open-vscode', id),
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
