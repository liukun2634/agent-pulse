import type { Session, SessionReference } from './sessions'

export {}

declare global {
  type PulseSessionReference = SessionReference
  interface PulseAlert {
    id: string
    sessionId: string
    requestId?: string
    reference: SessionReference
    initial: boolean
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
    storageWarning?: string | null
    popup?: { sequence: number; ids: string[] }
  }

  interface PulseSessionFeed {
    source: 'demo' | 'vscode'
    state: 'demo' | 'connecting' | 'connected' | 'empty' | 'unavailable' | 'error'
    message: string
    sessions: Session[]
    scannedAt: number | null
    revision: number
  }

  interface PulseMiniState {
    collapsed: boolean
    edge: 'left' | 'right'
  }

  interface Window {
    pulse?: {
      getAlerts: () => Promise<PulseAlertState>
      dismissAlert: (id: string) => Promise<void>
      showAlerts: () => Promise<void>
      openAlertInbox: () => Promise<void>
      onOpenAlertInbox: (listener: () => void) => () => void
      hideAlertPopup: (sequence: number) => Promise<void>
      setSystemNotifications: (enabled: boolean) => Promise<PulseAlertState>
      onAlerts: (listener: (state: PulseAlertState) => void) => () => void
      getSessionFeed: () => Promise<PulseSessionFeed>
      setSessionArchived: (id: string, archived: boolean) => Promise<void>
      setSessionSource: (source: 'demo' | 'vscode') => Promise<PulseSessionFeed>
      refreshSessions: () => Promise<PulseSessionFeed>
      openVSCode: (
        id: string,
        reference?: SessionReference,
      ) => Promise<{
        mode: 'chat-view' | 'chat-editor' | 'unavailable' | 'stale'
        verified: boolean
        code?: string
        message?: string
      }>
      onSessionOpened: (listener: (reference: SessionReference) => void) => () => void
      onSessionFeed: (listener: (feed: PulseSessionFeed) => void) => () => void
      getPinned: () => Promise<boolean>
      setPinned: (pinned: boolean) => Promise<boolean>
      openMini: () => Promise<void>
      hideMini: () => Promise<void>
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
