import type { Session, SessionReference } from './sessions'

export {}

declare global {
  interface PulseSourcePaths {
    vscodeStorage: string
    claudeExecutable: string
  }
  interface PulseDesktopSettings {
    seenReplies: Record<string, string | number>
    windowState: { mode: 'workspace' | 'mini' }
    hooks: {
      enabled: boolean
      listening: boolean
      lastEventAt: number | null
      warning: string | null
    }
    sources: PulseSourcePaths
    activeSources: PulseSourcePaths
    warning: string | null
  }
  type PulseSessionReference = SessionReference
  interface PulseAlert {
    id: string
    sessionId: string
    requestId?: string
    reference: SessionReference
    initial: boolean
    recovered?: boolean
    status: 'waiting' | 'completed' | 'failed'
    title: string
    project: string
    task: string
    at: number
  }

  interface PulseAlertState {
    items: PulseAlert[]
    revision: number
    systemNotifications: boolean
    popupDurationMs?: number
    storageWarning?: string | null
    popup?: { sequence: number; ids: string[] }
  }

  interface PulseSessionFeed {
    source: 'demo' | 'live'
    state: 'demo' | 'connecting' | 'connected' | 'empty' | 'unavailable' | 'error'
    message: string
    sessions: Session[]
    scannedAt: number | null
    revision: number
    sources?: {
      id: string
      name: string
      state: string
      message: string
      scannedAt: number | null
      lastSuccessAt: number | null
      metrics?: { discovered: number; checked: number; events: number } | null
      hooks?: PulseDesktopSettings['hooks'] | null
      durationMs: number | null
      acquisition: string
    }[]
  }

  interface PulseMiniState {
    collapsed: boolean
    edge: 'left' | 'right'
  }

  interface Window {
    pulse?: {
      syncReadState: (
        legacy: Record<string, string | number>,
      ) => Promise<{ revision: number; seenReplies: Record<string, string | number> }>
      markRead: (
        reference: SessionReference,
      ) => Promise<{ revision: number; seenReplies: Record<string, string | number> }>
      onReadState: (
        listener: (value: {
          revision: number
          seenReplies: Record<string, string | number>
        }) => void,
      ) => () => void
      getDesktopSettings: () => Promise<PulseDesktopSettings>
      setHooks: (enabled: boolean) => Promise<PulseDesktopSettings>
      copyHooks: () => Promise<void>
      saveSources: (value: PulseSourcePaths) => Promise<PulseDesktopSettings>
      browseSource: (key: keyof PulseSourcePaths) => Promise<string | null>
      checkSources: (
        value: PulseSourcePaths,
      ) => Promise<{ id: string; state: string; message: string; count: number }[]>
      getAlerts: () => Promise<PulseAlertState>
      dismissAlert: (id: string) => Promise<void>
      showAlerts: () => Promise<void>
      openAlertInbox: () => Promise<void>
      onOpenAlertInbox: (listener: () => void) => () => void
      hideAlertPopup: (sequence: number) => Promise<void>
      readyAlertPopup: (sequence: number) => Promise<void>
      setSystemNotifications: (enabled: boolean) => Promise<PulseAlertState>
      setPopupDuration: (duration: number) => Promise<PulseAlertState>
      onAlerts: (listener: (state: PulseAlertState) => void) => () => void
      getSessionFeed: () => Promise<PulseSessionFeed>
      setSessionArchived: (id: string, archived: boolean) => Promise<void>
      setSessionSource: (source: 'demo' | 'live') => Promise<PulseSessionFeed>
      refreshSessions: () => Promise<PulseSessionFeed>
      openSession: (
        id: string,
        reference?: SessionReference,
      ) => Promise<{
        mode: 'pulse-details' | 'stale'
        message?: string
      }>
      onSessionFeed: (listener: (feed: PulseSessionFeed) => void) => () => void
      getPinned: () => Promise<boolean>
      setPinned: (pinned: boolean) => Promise<boolean>
      openMini: () => Promise<void>
      minimizeMini: () => Promise<void>
      getMiniState: () => Promise<PulseMiniState>
      setMiniCollapsed: (collapsed: boolean) => Promise<PulseMiniState>
      dockMini: (edge: 'left' | 'right') => Promise<PulseMiniState>
      expandWorkspace: () => Promise<void>
      openWorkspace: (sessionId?: string) => Promise<void>
      notify: (notification: { title: string; body: string; sessionId?: string }) => Promise<void>
      onPinnedChange: (listener: (pinned: boolean) => void) => () => void
      onSelectSession: (listener: (sessionId: string) => void) => () => void
      onMiniStateChange: (listener: (state: PulseMiniState) => void) => () => void
    }
  }
}
