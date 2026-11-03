export {}

declare global {
  interface PulseMiniState {
    collapsed: boolean
    edge: 'left' | 'right'
  }

  interface Window {
    pulse?: {
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
