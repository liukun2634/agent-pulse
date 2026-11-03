import type { Session } from './sessions'

export {}

declare global {
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
      getSessionFeed: () => Promise<PulseSessionFeed>
      setSessionSource: (source: 'demo' | 'vscode') => Promise<PulseSessionFeed>
      refreshSessions: () => Promise<PulseSessionFeed>
      openVSCode: (id: string) => Promise<void>
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
      notify: (notification: { title: string; body: string }) => Promise<void>
      onPinnedChange: (listener: (pinned: boolean) => void) => () => void
      onSelectSession: (listener: (sessionId: string) => void) => () => void
      onMiniStateChange: (listener: (state: PulseMiniState) => void) => () => void
    }
  }
}
