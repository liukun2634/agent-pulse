import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import {
  Activity,
  Archive,
  ArchiveRestore,
  ArrowUpRight,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  Copy,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheck,
  CircleDot,
  CirclePause,
  Clock3,
  Code2,
  Command,
  FileCode2,
  FlaskConical,
  Folder,
  GitBranch,
  Inbox,
  LayoutGrid,
  List,
  LoaderCircle,
  Maximize2,
  Minus,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PanelTop,
  Pin,
  PinOff,
  Play,
  Radio,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  SquareTerminal,
  TriangleAlert,
  Volume2,
  WifiOff,
  X,
} from 'lucide-react'
import { SiClaude, SiGithubcopilot } from '@icons-pack/react-simple-icons'
import {
  changeStatus,
  createDemoSessions,
  elapsed,
  filterSessions,
  idleTime,
  parseSessions,
  providers,
  replyMarker,
  referenceForSession,
  relativeTime,
  serializeSessions,
  sessionDuration,
  sessionHostLabel,
  statusLabels,
} from './sessions'
import type { Provider, Session, SessionFilter, SessionStatus } from './sessions'
import './workspace.css'

const STORAGE_KEY = 'pulse.demo.sessions.v1'
const SETTINGS_KEY = 'pulse.preferences.v1'
const SEEN_KEY = 'pulse.seen-replies.v1'
const desktop = window.pulse
const miniMode = new URLSearchParams(window.location.search).get('view') === 'mini'

function SessionNavigation({ session, compact = false }: { session: Session; compact?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [instanceId, setInstanceId] = useState('')
  const [choices, setChoices] = useState<{
    reference: PulseSessionReference
    windows: { instanceId: string; label: string }[]
  } | null>(null)
  useEffect(() => {
    if (dialogOpen && !dialog.current?.open) dialog.current?.showModal()
    else if (!dialogOpen) dialog.current?.close()
  }, [dialogOpen])
  async function reveal(reference: PulseSessionReference, chosen?: string) {
    if (!desktop || busy) return
    setBusy(true)
    setMessage('')
    try {
      const result = await desktop.revealSession(session.id, reference, chosen)
      setMessage(compact && result.mode === 'requested' ? '' : result.message)
      setInstanceId('')
      setChoices(result.mode === 'ambiguous' ? { reference, windows: result.windows ?? [] } : null)
      if (compact) setDialogOpen(result.mode !== 'requested')
    } catch {
      setChoices(null)
      setMessage(
        'The application connection is unavailable. Pulse details and reminders are unchanged.',
      )
      if (compact) setDialogOpen(true)
    } finally {
      setBusy(false)
    }
  }
  const feedback = (
    <>
      {choices && (
        <div className="navigation-choices">
          <label>
            Original VS Code window
            <select
              aria-label="Original VS Code window"
              value={instanceId}
              onChange={(event) => setInstanceId(event.target.value)}
            >
              <option value="">Choose a window</option>
              {choices.windows.map((window) => (
                <option key={window.instanceId} value={window.instanceId}>
                  {window.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-secondary"
            disabled={busy || !instanceId}
            onClick={() => void reveal(choices.reference, instanceId)}
          >
            <ArrowUpRight size={14} />
            Open selected window
          </button>
        </div>
      )}
      {message && (
        <p className="navigation-feedback" role="status">
          {message}
        </p>
      )}
    </>
  )
  return (
    <div className={`session-navigation ${compact ? 'session-navigation-compact' : ''}`}>
      <button
        className={`${compact ? 'icon-button' : 'button button-secondary'} open-session-button`}
        aria-label={compact ? 'Open session in VS Code' : undefined}
        title={compact ? 'Open session in VS Code' : undefined}
        disabled={busy}
        onClick={() => void reveal(referenceForSession(session))}
      >
        {busy ? <LoaderCircle size={15} className="spin" /> : <ArrowUpRight size={15} />}
        {!compact && 'Open saved Chat in VS Code'}
      </button>
      {compact ? (
        <dialog
          ref={dialog}
          className="navigation-dialog"
          aria-label="VS Code session navigation"
          onClose={() => {
            setDialogOpen(false)
            setMessage('')
            setChoices(null)
          }}
        >
          <div className="navigation-dialog-header">
            <h2>Open in VS Code</h2>
            <IconButton label="Close session navigation" onClick={() => setDialogOpen(false)}>
              <X size={17} />
            </IconButton>
          </div>
          <p className="navigation-session-name">{session.task}</p>
          {feedback}
          {!choices && (
            <button
              className="button button-secondary"
              disabled={busy}
              onClick={() => void reveal(referenceForSession(session))}
            >
              <RotateCcw size={14} /> Retry navigation
            </button>
          )}
        </dialog>
      ) : (
        feedback
      )}
    </div>
  )
}

function SourceSettings({ hooks }: { hooks?: PulseDesktopSettings['hooks'] | null }) {
  const [settings, setSettings] = useState<PulseDesktopSettings | null>(null)
  const [paths, setPaths] = useState<PulseSourcePaths>({ vscodeStorage: '', claudeExecutable: '' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    void desktop
      ?.getDesktopSettings()
      .then((value) => {
        if (active) {
          setSettings(value)
          setPaths(value.sources)
          setMessage(value.warning ?? '')
        }
      })
      .catch(() => {
        if (active) setMessage('Could not load source settings.')
      })
    return () => {
      active = false
    }
  }, [])
  async function act(action: 'save' | 'check' | keyof PulseSourcePaths) {
    if (!desktop) return
    setBusy(true)
    try {
      if (action === 'save') {
        setSettings(await desktop.saveSources(paths))
        setMessage('Saved. Restart Pulse to apply source paths.')
      } else if (action === 'check') {
        const results = await desktop.checkSources(paths)
        setMessage(
          results
            .map((result) => `${result.id}: ${result.state} (${result.count}). ${result.message}`)
            .join('\n'),
        )
      } else {
        const selected = await desktop.browseSource(action)
        if (selected) setPaths((current) => ({ ...current, [action]: selected }))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Source operation failed.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <fieldset className="source-settings" disabled={busy || !settings}>
      <legend>Source paths</legend>
      {(['vscodeStorage', 'claudeExecutable'] as const).map((key) => (
        <label key={key}>
          <span>{key === 'vscodeStorage' ? 'VS Code workspace storage' : 'Claude executable'}</span>
          <div className="source-path-input">
            <input
              aria-label={
                key === 'vscodeStorage' ? 'VS Code workspace storage' : 'Claude executable'
              }
              value={paths[key]}
              placeholder={settings?.activeSources[key]}
              onChange={(event) =>
                setPaths((current) => ({ ...current, [key]: event.target.value }))
              }
            />
            <IconButton
              label={`Browse ${key === 'vscodeStorage' ? 'VS Code storage' : 'Claude executable'}`}
              onClick={() => void act(key)}
            >
              <Folder size={16} />
            </IconButton>
          </div>
          <small>Active: {settings?.activeSources[key] ?? '-'}</small>
        </label>
      ))}
      <div className="source-settings-actions">
        <button className="button button-secondary" onClick={() => void act('check')}>
          <RotateCcw size={14} />
          Test connections
        </button>
        <button className="button button-primary" onClick={() => void act('save')}>
          <Check size={14} />
          Save paths
        </button>
      </div>
      <div className="setting-row">
        <strong>Claude local hooks</strong>
        <Toggle
          label="Claude local hooks"
          checked={settings?.hooks.enabled ?? false}
          onChange={(enabled) => {
            setBusy(true)
            void desktop
              ?.setHooks(enabled)
              .then(setSettings)
              .catch(() => setMessage('Could not change hook listener.'))
              .finally(() => setBusy(false))
          }}
        />
        <IconButton
          label="Copy Claude hook configuration"
          disabled={!settings?.hooks.listening}
          onClick={() => {
            void desktop
              ?.copyHooks()
              .then(() =>
                setMessage('Hook configuration copied. Existing Claude settings were not changed.'),
              )
              .catch(() => setMessage('Could not copy hook configuration.'))
          }}
        >
          <Copy size={15} />
        </IconButton>
      </div>
      {settings?.hooks && (
        <small>
          {(hooks ?? settings.hooks).warning ??
            ((hooks ?? settings.hooks).listening
              ? `Listening on localhost. Last event: ${(hooks ?? settings.hooks).lastEventAt ? new Date((hooks ?? settings.hooks).lastEventAt!).toLocaleString() : 'None'}`
              : 'Disabled')}
        </small>
      )}
      {message && <p role="status">{message}</p>}
    </fieldset>
  )
}

let storageFailed = false
const storageListeners = new Set<() => void>()

function subscribeStorageHealth(listener: () => void) {
  storageListeners.add(listener)
  return () => {
    storageListeners.delete(listener)
  }
}

function getStorageFailure() {
  return storageFailed
}

function reportStorageFailure() {
  if (storageFailed) return
  storageFailed = true
  storageListeners.forEach((listener) => listener())
}

interface Preferences {
  notifications: boolean
  sound: boolean
  showCompleted: boolean
}
interface Toast {
  title: string
  detail: string
  sessionId?: string
  tone?: 'success' | 'info'
}
type Modal = 'settings' | 'notifications' | null

function initialSessions() {
  try {
    return parseSessions(localStorage.getItem(STORAGE_KEY)) ?? createDemoSessions()
  } catch {
    return createDemoSessions()
  }
}

function initialPreferences(): Preferences {
  try {
    const saved = JSON.parse(
      localStorage.getItem(SETTINGS_KEY) ?? 'null',
    ) as Partial<Preferences> | null
    return {
      notifications: saved?.notifications ?? !!desktop,
      sound: saved?.sound === true,
      showCompleted: saved?.showCompleted !== false,
    }
  } catch {
    return { notifications: false, sound: false, showCompleted: true }
  }
}

function initialSeen(): Record<string, number | string> {
  try {
    const value = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}')
    return value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value)
            .filter(
              (entry): entry is [string, number | string] =>
                typeof entry[1] === 'number' || typeof entry[1] === 'string',
            )
            .slice(-200),
        )
      : {}
  } catch {
    return {}
  }
}

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? 'brand-compact' : ''}`}>
      <span className="brand-mark">
        <Activity size={21} strokeWidth={2.2} />
      </span>
      <span>
        pulse<span className="brand-period">.</span>
      </span>
      {!compact && <span className="version">BETA</span>}
    </div>
  )
}

function ProviderIcon({ provider, size = 17 }: { provider: Provider; size?: number }) {
  return (
    <span className={`provider-icon ${provider}`}>
      {provider === 'claude' ? (
        <SiClaude size={size} aria-hidden />
      ) : provider === 'copilot' ? (
        <SiGithubcopilot size={size} aria-hidden />
      ) : (
        <SquareTerminal size={size} aria-hidden />
      )}
    </span>
  )
}

function StatusBadge({ status }: { status: SessionStatus }) {
  const Icon =
    status === 'running'
      ? LoaderCircle
      : status === 'waiting'
        ? CirclePause
        : status === 'completed'
          ? CircleCheck
          : status === 'idle' || status === 'cancelled'
            ? CirclePause
            : status === 'disconnected'
              ? WifiOff
              : TriangleAlert
  return (
    <span className={`status-badge ${status}`}>
      <Icon size={12} className={status === 'running' ? 'spin' : ''} />
      {statusLabels[status]}
    </span>
  )
}

function IconButton({
  label,
  children,
  className = '',
  ...props
}: {
  label: string
  children: ReactNode
  className?: string
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      aria-label={label}
      title={label}
      {...props}
    >
      {children}
    </button>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

function SessionCard({
  session,
  selected,
  now,
  onSelect,
  index,
}: {
  session: Session
  selected: boolean
  now: number
  onSelect: () => void
  index: number
}) {
  const canNavigate = !!desktop && session.source === 'vscode'
  return (
    <div className="session-card-shell">
      <button
        className={`session-card ${selected ? 'selected' : ''} session-${session.status}`}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={`${session.project}: ${session.task}`}
        style={{ animationDelay: `${index * 45}ms` }}
      >
        <div className="session-card-top">
          <span className="project-name">
            <span className={`project-glyph project-${session.project}`}>
              <Folder size={14} />
            </span>
            {session.project}
          </span>
          <ArrowUpRight
            size={15}
            className={`card-arrow ${canNavigate ? 'navigation-placeholder' : ''}`}
          />
        </div>
        <h3>{session.task}</h3>
        <div className="session-provider">
          <ProviderIcon provider={session.provider} size={14} />
          <span>{providers[session.provider].name}</span>
          <span className="separator">/</span>
          <span className="session-number" title={session.id}>
            #{session.id.split(':').at(-1)?.slice(0, 8)}
          </span>
        </div>
        <div className="session-card-bottom">
          <StatusBadge status={session.status} />
          {session.archivedAt && (
            <span className="archive-badge">
              <Archive size={11} />
              Archived
            </span>
          )}
          <span
            className="duration"
            title={
              session.status === 'running'
                ? 'Current request elapsed time'
                : 'Time since last activity'
            }
          >
            <Clock3 size={12} />
            {sessionDuration(session, now)}
          </span>
        </div>
        <span className="session-entry">Entry: {sessionHostLabel(session)}</span>
        {session.source && (
          <p className="session-progress" title={session.events.at(-1)?.text}>
            {session.events.at(-1)?.text}
          </p>
        )}
      </button>
      {canNavigate && <SessionNavigation session={session} compact />}
    </div>
  )
}

function SessionTimeline({ session }: { session: Session }) {
  const [expanded, setExpanded] = useState(false)
  const previewLimit = 5
  const events = expanded ? session.events : session.events.slice(-previewLimit)
  const hasMore = session.events.length > previewLimit

  return (
    <>
      <div className="timeline-heading">
        <h3>Timeline</h3>
        <span>
          {hasMore && !expanded
            ? `${events.length} of ${session.events.length}`
            : session.events.length}{' '}
          events
        </span>
      </div>
      <ol className="timeline" id="session-timeline" aria-label="Session events">
        {events.map((event, index) => (
          <li key={event.id} className={`event-${event.kind}`}>
            <span className="timeline-marker">
              {index === events.length - 1 && session.status === 'running' ? (
                <span className="timeline-live" />
              ) : event.kind === 'error' ? (
                <X size={9} />
              ) : event.kind === 'warning' ? (
                <Minus size={9} />
              ) : (
                <Check size={9} />
              )}
            </span>
            <div>
              <p>{event.text}</p>
              <time>
                {new Date(event.at).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </time>
            </div>
          </li>
        ))}
      </ol>
      {hasMore && (
        <button
          type="button"
          className="text-button timeline-toggle"
          aria-expanded={expanded}
          aria-controls="session-timeline"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? 'Show less' : 'Read more'}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      )}
    </>
  )
}

function Workspace() {
  const [sessions, setSessions] = useState<Session[]>(() => (desktop ? [] : initialSessions()))
  const [feed, setFeed] = useState<PulseSessionFeed>({
    source: desktop ? 'live' : 'demo',
    state: desktop ? 'connecting' : 'demo',
    message: desktop ? 'Reading local agent sessions...' : 'Sample sessions',
    sessions: [],
    scannedAt: null,
    revision: -1,
  })
  const live = feed.source !== 'demo'
  const [preferences, setPreferences] = useState(initialPreferences)
  const [selectedId, setSelectedId] = useState<string | null>('014')
  const [filter, setFilter] = useState<SessionFilter>('all')
  const [provider, setProvider] = useState<Provider | 'all'>('all')
  const [query, setQuery] = useState('')
  const [pageState, setPageState] = useState({ key: '', page: 0 })
  const [miniPage, setMiniPage] = useState(0)
  const [collection, setCollection] = useState<'active' | 'archived' | 'all'>('active')
  const [view, setView] = useState<'sessions' | 'activity'>('sessions')
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [modal, setModal] = useState<Modal>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [openingAlertId, setOpeningAlertId] = useState<string | null>(null)
  const [alertError, setAlertError] = useState<{ id: string; text: string } | null>(null)
  const [popupSettingError, setPopupSettingError] = useState<string | null>(null)
  const [pinned, setPinned] = useState(false)
  const [miniState, setMiniState] = useState<PulseMiniState>({ collapsed: false, edge: 'right' })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [simulatingId, setSimulatingId] = useState<string | null>(null)
  const [seenReplies, setSeenReplies] = useState(initialSeen)
  useEffect(() => {
    if (!desktop) return
    let revision = -1
    let active = true
    const receive = (value: { revision: number; seenReplies: Record<string, string | number> }) => {
      if (!active || value.revision < revision) return
      revision = value.revision
      setSeenReplies((current) => ({
        ...Object.fromEntries(
          Object.entries(current).filter(([id]) => !/^(vscode|claude):/.test(id)),
        ),
        ...value.seenReplies,
      }))
    }
    const stop = desktop.onReadState(receive)
    void desktop.syncReadState(initialSeen()).then(receive).catch(reportStorageFailure)
    return () => {
      active = false
      stop()
    }
  }, [])
  const [alerts, setAlerts] = useState<PulseAlertState>({
    items: [],
    revision: -1,
    systemNotifications: true,
  })
  const storageUnavailable = useSyncExternalStore(subscribeStorageHealth, getStorageFailure)
  const [now, setNow] = useState(Date.now)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const audioRef = useRef<AudioContext | null>(null)
  const miniRef = useRef<Window | null>(null)

  const receiveFeed = useEffectEvent((incoming: PulseSessionFeed) => {
    if (incoming.revision <= feed.revision) return
    const sourceChanged = incoming.source !== feed.source
    if (sourceChanged) {
      setSimulatingId(null)
      setFilter('all')
      setProvider('all')
      setQuery('')
      setCollection('active')
      setToast(null)
    }
    if (incoming.source !== 'demo') {
      setSessions(incoming.sessions)
      if (
        sourceChanged ||
        feed.scannedAt === null ||
        (selectedId !== null && !incoming.sessions.some((item) => item.id === selectedId))
      )
        setSelectedId(incoming.sessions[0]?.id ?? null)
    } else if (sourceChanged || feed.revision === -1) {
      setSessions(initialSessions())
      setSelectedId('014')
    }
    setFeed(incoming)
  })

  const receiveAlerts = useEffectEvent((incoming: PulseAlertState) => {
    if (incoming.revision <= alerts.revision) return
    if (
      !miniMode &&
      preferences.sound &&
      alerts.revision >= 0 &&
      incoming.items.some(
        (item) => !item.initial && !alerts.items.some((previous) => previous.id === item.id),
      )
    )
      playSound()
    setAlerts(incoming)
    setPreferences((previous) =>
      previous.notifications === incoming.systemNotifications
        ? previous
        : { ...previous, notifications: incoming.systemNotifications },
    )
  })

  useEffect(() => {
    if (!desktop?.getAlerts) return
    let active = true
    const accept = (incoming: PulseAlertState) => {
      if (active) receiveAlerts(incoming)
    }
    const unsubscribe = desktop.onAlerts(accept)
    void desktop.getAlerts().then(accept)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  useEffect(() => desktop?.onOpenAlertInbox?.(() => setModal('notifications')), [])

  useEffect(() => {
    try {
      localStorage.setItem(
        SEEN_KEY,
        JSON.stringify(Object.fromEntries(Object.entries(seenReplies).slice(-200))),
      )
    } catch {
      reportStorageFailure()
    }
  }, [seenReplies])

  useEffect(() => {
    if (!desktop) return
    let active = true
    const accept = (incoming: PulseSessionFeed) => {
      if (active) receiveFeed(incoming)
    }
    const unsubscribe = desktop.onSessionFeed(accept)
    void desktop
      .getSessionFeed()
      .then(accept)
      .catch(() => {
        if (active)
          setFeed((current) => ({
            ...current,
            state: 'error',
            message: 'Desktop session bridge is unavailable.',
          }))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  function playSound() {
    if (!audioRef.current || audioRef.current.state !== 'running') return
    const audio = audioRef.current
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.connect(gain)
    gain.connect(audio.destination)
    oscillator.frequency.setValueAtTime(660, audio.currentTime)
    oscillator.frequency.setValueAtTime(880, audio.currentTime + 0.13)
    gain.gain.setValueAtTime(0.06, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.45)
    oscillator.start()
    oscillator.stop(audio.currentTime + 0.45)
  }

  async function chooseSource(source: 'live' | 'demo') {
    try {
      await desktop?.setSessionSource(source)
    } catch {
      setToast({ title: 'Source could not be changed', detail: 'Please try again.', tone: 'info' })
    }
  }

  async function refreshSessions() {
    try {
      await desktop?.refreshSessions()
    } catch {
      setToast({
        title: 'Refresh failed',
        detail: 'The local session bridge is unavailable.',
        tone: 'info',
      })
    }
  }

  async function openPendingAlert(alert: PulseAlert) {
    if (!desktop || openingAlertId) return
    setOpeningAlertId(alert.id)
    setAlertError(null)
    try {
      const result = await desktop.openSession(
        alert.sessionId,
        alert.recovered
          ? undefined
          : {
              ...alert.reference,
              alertId: alert.id,
            },
      )
      if (result.mode === 'stale')
        setAlertError({
          id: alert.id,
          text: result.message ?? 'The session could not be verified.',
        })
      else setModal(null)
    } catch {
      setAlertError({
        id: alert.id,
        text: 'This session is unavailable. Return to its original application or ignore this reminder.',
      })
    } finally {
      setOpeningAlertId(null)
    }
  }

  async function ignoreAlert(id: string) {
    try {
      await desktop?.dismissAlert(id)
    } catch {
      setAlertError({ id, text: 'The reminder could not be dismissed. Please try again.' })
    }
  }

  async function changePopupDuration(duration: number) {
    if (!desktop?.setPopupDuration) return
    setPopupSettingError(null)
    try {
      await desktop.setPopupDuration(duration)
    } catch {
      setPopupSettingError('Could not save popup duration. Please try again.')
    }
  }

  async function archiveSession(session: Session) {
    try {
      await desktop?.setSessionArchived(session.id, !session.archivedAt)
      if (!session.archivedAt && collection === 'active') setSelectedId(null)
    } catch {
      setToast({
        title: 'Archive could not be updated',
        detail: 'The session or local storage is unavailable.',
        tone: 'info',
      })
    }
  }

  const receiveSessions = useEffectEvent((incoming: Session[]) => {
    if (live) return
    if (miniMode) {
      const finished = incoming.find(
        (item) =>
          item.status === 'completed' &&
          sessions.some((previous) => previous.id === item.id && previous.status !== 'completed'),
      )
      if (finished)
        setToast({
          title: 'Session complete',
          detail: finished.project,
          sessionId: finished.id,
          tone: 'success',
        })
    }
    setSessions(incoming)
  })

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (live) return
    try {
      localStorage.setItem(STORAGE_KEY, serializeSessions(sessions))
    } catch {
      reportStorageFailure()
    }
  }, [sessions, live])

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences))
    } catch {
      reportStorageFailure()
    }
  }, [preferences])

  useEffect(() => {
    const receive = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        const incoming = parseSessions(event.newValue)
        if (incoming) receiveSessions(incoming)
      }
      if (event.key === SETTINGS_KEY) setPreferences(initialPreferences())
      if (event.key === SEEN_KEY)
        setSeenReplies((current) => ({
          ...initialSeen(),
          ...(desktop
            ? Object.fromEntries(
                Object.entries(current).filter(([id]) => /^(vscode|claude):/.test(id)),
              )
            : {}),
        }))
    }
    window.addEventListener('storage', receive)
    return () => window.removeEventListener('storage', receive)
  }, [])

  useEffect(() => {
    if (!desktop) return
    void desktop.getPinned().then(setPinned)
    return desktop.onPinnedChange(setPinned)
  }, [])

  useEffect(() => {
    if (!desktop || !miniMode) return
    void desktop.getMiniState().then(setMiniState)
    return desktop.onMiniStateChange(setMiniState)
  }, [])

  useEffect(() => {
    if (modal) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [modal])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 6500)
    return () => window.clearTimeout(timer)
  }, [toast])

  const finishDemo = useEffectEvent((id: string) => {
    const session = sessions.find((item) => item.id === id)
    if (session?.status === 'running') {
      setSessions((current) => changeStatus(current, id, 'completed'))
      setToast({
        title: 'Session complete',
        detail: `${session.project} finished its demo task`,
        sessionId: id,
        tone: 'success',
      })
      if (preferences.sound) playSound()
      if (preferences.notifications) {
        if (desktop)
          void desktop.notify({ title: `${session.project} completed`, body: session.task })
        else if ('Notification' in window && Notification.permission === 'granted') {
          const notification = new Notification(`${session.project} completed`, {
            body: session.task,
          })
          notification.onclick = () => {
            window.focus()
            setSelectedId(id)
            notification.close()
          }
        }
      }
    }
    setSimulatingId(null)
  })

  useEffect(() => {
    if (!simulatingId) return
    const timer = window.setTimeout(() => finishDemo(simulatingId), 4500)
    return () => window.clearTimeout(timer)
  }, [simulatingId])

  const selected = sessions.find((session) => session.id === selectedId)
  const running = sessions.filter((session) => session.status === 'running')
  const attention = sessions.filter((session) =>
    ['waiting', 'failed', 'disconnected', 'unknown'].includes(session.status),
  )
  const completed = sessions.filter((session) => session.status === 'completed')
  const unreadReplies = completed.filter(
    (session) =>
      seenReplies[session.id] !== replyMarker(session) &&
      seenReplies[session.id] !== (session.finishedAt ?? session.updatedAt),
  )
  const unreadReplyIds = new Set(unreadReplies.map((session) => session.id))
  const ready = live ? unreadReplies : []
  const visible = filterSessions(sessions, query, filter, provider).filter(
    (session) =>
      (!live ||
        collection === 'all' ||
        (collection === 'archived' ? !!session.archivedAt : !session.archivedAt)) &&
      (collection === 'archived' || preferences.showCompleted || session.status !== 'completed'),
  )
  const miniSessions = sessions.filter(
    (session) =>
      (!session.archivedAt ||
        ['running', 'waiting', 'failed', 'unknown'].includes(session.status) ||
        unreadReplyIds.has(session.id)) &&
      (session.status !== 'completed' || unreadReplyIds.has(session.id)),
  )
  const allEvents = sessions
    .flatMap((session) => session.events.map((event) => ({ ...event, session })))
    .sort((first, second) => second.at - first.at)

  const pageKey = JSON.stringify([query, filter, provider, collection, preferences.showCompleted])
  const pages = Math.max(1, Math.ceil(visible.length / 50))
  const pageIndex = pageState.key === pageKey ? Math.min(pageState.page, pages - 1) : 0
  const pageSessions = visible.slice(pageIndex * 50, (pageIndex + 1) * 50)
  const miniPages = Math.max(1, Math.ceil(miniSessions.length / 50))
  const miniIndex = Math.min(miniPage, miniPages - 1)
  const miniPageSessions = miniSessions.slice(miniIndex * 50, (miniIndex + 1) * 50)
  const miniPagination = miniPages > 1 && (
    <nav className="mini-pagination" aria-label="Mini pages">
      <IconButton
        label="Previous mini page"
        disabled={miniIndex === 0}
        onClick={() => setMiniPage(miniIndex - 1)}
      >
        <ChevronLeft size={14} />
      </IconButton>
      <span>
        {miniIndex + 1}/{miniPages}
      </span>
      <IconButton
        label="Next mini page"
        disabled={miniIndex === miniPages - 1}
        onClick={() => setMiniPage(miniIndex + 1)}
      >
        <ChevronRight size={14} />
      </IconButton>
    </nav>
  )

  async function togglePin() {
    if (!desktop) return
    try {
      setPinned(await desktop.setPinned(!pinned))
    } catch {
      setToast({ title: 'Window could not be pinned', detail: 'Please try again.', tone: 'info' })
    }
  }

  function openMini() {
    if (desktop) void desktop.openMini()
    else {
      const popup = window.open(
        `${window.location.pathname}?view=mini`,
        'pulse-mini',
        'popup,width=410,height=580',
      )
      miniRef.current = popup
      if (!popup)
        setToast({
          title: 'Popup blocked',
          detail: 'Allow popups for this local preview.',
          tone: 'info',
        })
    }
  }

  function openWorkspace(id?: string) {
    if (id) setSelectedId(id)
    if (desktop) void desktop.openWorkspace(id)
    else if (window.opener && !window.opener.closed) {
      if (id)
        window.opener.postMessage({ type: 'pulse:select-session', id }, window.location.origin)
      window.opener.focus()
      window.close()
    } else window.location.assign(window.location.pathname)
  }

  function expandWorkspace() {
    if (desktop) void desktop.expandWorkspace()
    else openWorkspace()
  }

  async function toggleCollapsed() {
    if (desktop) {
      try {
        setMiniState(await desktop.setMiniCollapsed(!miniState.collapsed))
      } catch {
        setToast({
          title: 'Window could not be resized',
          detail: 'Please try again.',
          tone: 'info',
        })
      }
    } else setMiniState((current) => ({ ...current, collapsed: !current.collapsed }))
  }

  async function toggleDock() {
    const edge = miniState.edge === 'right' ? 'left' : 'right'
    if (desktop) {
      try {
        setMiniState(await desktop.dockMini(edge))
      } catch {
        setToast({ title: 'Window could not be docked', detail: 'Please try again.', tone: 'info' })
      }
    } else setMiniState((current) => ({ ...current, edge }))
  }

  useEffect(
    () =>
      desktop?.onSelectSession((id) => {
        setSelectedId(id)
        setView('sessions')
        setModal(null)
      }),
    [],
  )

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== miniRef.current) return
      if (event.data?.type === 'pulse:select-session' && typeof event.data.id === 'string') {
        setSelectedId(event.data.id)
        setView('sessions')
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [])

  function startDemo(id?: string) {
    if (live || simulatingId) return
    if (preferences.sound) {
      audioRef.current ??= new AudioContext()
      void audioRef.current.resume()
    }
    const target = id ? sessions.find((session) => session.id === id) : running[0]
    if (target && target.status !== 'completed') {
      if (target.status !== 'running')
        setSessions((current) => changeStatus(current, target.id, 'running'))
      setSimulatingId(target.id)
      setSelectedId(target.id)
    } else {
      setSessions(createDemoSessions())
      setSelectedId('014')
      setSimulatingId('014')
    }
  }

  function resetDemo() {
    if (live) return
    setSimulatingId(null)
    setSessions(createDemoSessions())
    setSelectedId('014')
    setFilter('all')
    setProvider('all')
    setQuery('')
    setToast({ title: 'Demo workspace reset', detail: 'Six fresh sample sessions.', tone: 'info' })
  }

  async function enableNotifications(enabled: boolean) {
    if (desktop) {
      try {
        await desktop.setSystemNotifications(enabled)
      } catch {
        setToast({
          title: 'Notification setting could not be changed',
          detail: 'Restart Pulse and try again.',
          tone: 'info',
        })
      }
      return
    }
    if (enabled && !desktop) {
      if (!('Notification' in window)) {
        setToast({
          title: 'System notifications unavailable',
          detail: 'In-app completion alerts remain enabled.',
          tone: 'info',
        })
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setToast({
          title: 'Notification permission not granted',
          detail: 'In-app completion alerts remain enabled.',
          tone: 'info',
        })
        return
      }
    }
    setPreferences((current) => ({ ...current, notifications: enabled }))
  }

  function selectNavigation(
    nextView: 'sessions' | 'activity',
    nextProvider: Provider | 'all' = 'all',
  ) {
    setView(nextView)
    setProvider(nextProvider)
    setSidebarOpen(false)
  }

  const notificationToast = toast && (
    <div className={`toast ${toast.tone ?? 'info'}`} role="status">
      <span className="toast-symbol">
        {toast.tone === 'success' ? <CheckCheck size={19} /> : <Bell size={18} />}
      </span>
      <div>
        <strong>{toast.title}</strong>
        <p>{toast.detail}</p>
      </div>
      {toast.sessionId && (
        <IconButton
          label={live ? 'View session details' : 'View completed session'}
          onClick={() => {
            if (live) {
              openWorkspace(toast.sessionId!)
              setToast(null)
              return
            }
            if (miniMode) openWorkspace(toast.sessionId)
            setSelectedId(toast.sessionId!)
            setView('sessions')
            setToast(null)
          }}
        >
          <ArrowUpRight size={17} />
        </IconButton>
      )}
      <IconButton label="Dismiss notification" onClick={() => setToast(null)}>
        <X size={15} />
      </IconButton>
    </div>
  )

  if (miniMode && miniState.collapsed)
    return (
      <div className={`mini-app mini-rail rail-${miniState.edge}`}>
        <header className="rail-header app-drag">
          <span className="brand-mark">
            <Activity size={19} />
          </span>
        </header>
        <div className="rail-counts">
          <span title={`${running.length} in progress`}>
            <span className="live-dot" />
            {running.length}
          </span>
          <span title={`${attention.length} need attention`}>
            <span className="attention-dot" />
            {attention.length}
          </span>
        </div>
        <nav className="rail-sessions" aria-label="Session shortcuts">
          {miniPageSessions.map((item) => (
            <button
              key={item.id}
              className={`rail-session mini-${item.status}`}
              title={`${item.project}\n${item.task}\n${sessionHostLabel(item)}\n${statusLabels[item.status]}`}
              aria-label={`Open ${item.project}: ${item.task}`}
              onClick={() => openWorkspace(item.id)}
            >
              <ProviderIcon provider={item.provider} size={18} />
              <span className={`rail-status rail-status-${item.status}`} />
              <span className="rail-session-name">{item.project}</span>
            </button>
          ))}
        </nav>
        {miniPagination}
        <footer className="rail-footer">
          {toast?.sessionId && (
            <IconButton
              label={`Completed: ${toast.detail}`}
              className="rail-completion"
              onClick={() => openWorkspace(toast.sessionId)}
            >
              <CheckCheck size={17} />
            </IconButton>
          )}
          <IconButton label="Expand sidebar" onClick={() => void toggleCollapsed()}>
            <PanelRightOpen size={17} />
          </IconButton>
          <IconButton
            label={miniState.edge === 'right' ? 'Dock left' : 'Dock right'}
            onClick={() => void toggleDock()}
          >
            {miniState.edge === 'right' ? (
              <PanelLeftOpen size={16} />
            ) : (
              <PanelRightOpen size={16} />
            )}
          </IconButton>
          <IconButton
            label={
              desktop
                ? pinned
                  ? 'Unpin window'
                  : 'Pin window'
                : 'Pinning requires the desktop app'
            }
            disabled={!desktop}
            className={pinned ? 'is-pinned' : ''}
            onClick={() => void togglePin()}
          >
            {pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </IconButton>
          <IconButton label="Expand workspace" onClick={expandWorkspace}>
            <Maximize2 size={16} />
          </IconButton>
          <span className="rail-demo">{live ? 'LIVE' : 'DEMO'}</span>
        </footer>
      </div>
    )

  if (miniMode)
    return (
      <div className="mini-app">
        <header className="mini-header app-drag">
          <Brand compact />
          <span className="mini-demo">{live ? 'LIVE' : 'DEMO'}</span>
          <div className="app-no-drag mini-window-actions">
            <IconButton label="Collapse sidebar" onClick={() => void toggleCollapsed()}>
              <PanelRightClose size={16} />
            </IconButton>
            <IconButton
              label={
                desktop
                  ? pinned
                    ? 'Unpin window'
                    : 'Pin window'
                  : 'Pinning requires the desktop app'
              }
              disabled={!desktop}
              className={pinned ? 'is-pinned' : ''}
              onClick={() => void togglePin()}
            >
              {pinned ? <PinOff size={15} /> : <Pin size={15} />}
            </IconButton>
            <IconButton label="Expand workspace" onClick={expandWorkspace}>
              <Maximize2 size={15} />
            </IconButton>
            {desktop && (
              <IconButton label="Minimize mini monitor" onClick={() => void desktop.minimizeMini()}>
                <Minus size={16} />
              </IconButton>
            )}
          </div>
        </header>
        <div className="mini-overview">
          <span className="live-dot" />
          <strong>
            {running.length} {running.length === 1 ? 'session' : 'sessions'} in progress
          </strong>
          {live && ready.length > 0 && (
            <span className="mini-ready-count">{ready.length} ready</span>
          )}
          <span className="mini-clock">
            {new Date(now).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <div className="mini-sessions">
          {live && miniSessions.length === 0 && (
            <p className="source-message">
              {feed.state === 'connecting' ? 'Loading sessions...' : 'No live sessions'}
            </p>
          )}
          {miniPageSessions.map((session) => {
            const canNavigate = !!desktop && session.source === 'vscode'
            return (
              <div className="mini-session-shell" key={session.id}>
                <button
                  className={`mini-session mini-${session.status}`}
                  title={`${session.project}\n${session.task}\n${sessionHostLabel(session)}\nView session in Pulse`}
                  onClick={() => openWorkspace(session.id)}
                >
                  <span className="mini-provider">
                    <ProviderIcon provider={session.provider} size={20} />
                  </span>
                  <span className="mini-session-content">
                    <strong className="mini-session-title">{session.project}</strong>
                    <span className="mini-session-subtitle" title={session.task}>
                      {session.task}
                    </span>
                    <StatusBadge status={session.status} />
                    {live && <span className="mini-progress">{session.events.at(-1)?.text}</span>}
                  </span>
                  <span className="mini-session-end">
                    <span
                      title={
                        session.status === 'running'
                          ? 'Current request elapsed time'
                          : 'Time since last activity'
                      }
                    >
                      {sessionDuration(session, now)}
                    </span>
                    <ArrowUpRight
                      size={13}
                      className={canNavigate ? 'navigation-placeholder' : undefined}
                    />
                  </span>
                </button>
                {canNavigate && <SessionNavigation session={session} compact />}
              </div>
            )
          })}
        </div>
        {miniPagination}
        <footer className="mini-footer">
          <button
            onClick={() => void toggleDock()}
            title={miniState.edge === 'right' ? 'Dock left' : 'Dock right'}
          >
            {miniState.edge === 'right' ? (
              <PanelLeftOpen size={14} />
            ) : (
              <PanelRightOpen size={14} />
            )}
            {miniState.edge === 'right' ? 'Dock left' : 'Dock right'}
          </button>
          <button onClick={() => openWorkspace()}>
            Open workspace <ArrowUpRight size={14} />
          </button>
        </footer>
        {notificationToast}
      </div>
    )

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <button
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand">
          <Brand />
          <IconButton
            className="mobile-close"
            label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose size={18} />
          </IconButton>
        </div>
        <div className="workspace-switch">
          <span className="workspace-avatar">
            <Command size={17} />
          </span>
          <div>
            <strong>Personal workspace</strong>
            <span>Local environment</span>
          </div>
          <span className="workspace-online" />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Workspace navigation">
          <button
            className={view === 'sessions' && provider === 'all' ? 'nav-active' : ''}
            onClick={() => selectNavigation('sessions')}
          >
            <LayoutGrid size={17} />
            <span>All sessions</span>
            <span className="nav-count">{sessions.length}</span>
          </button>
          <button
            className={view === 'activity' ? 'nav-active' : ''}
            onClick={() => selectNavigation('activity')}
          >
            <Activity size={17} />
            <span>Activity</span>
          </button>
        </nav>
        <div className="nav-caption agents-caption">
          AGENTS <span>{live ? 'LOCAL' : 'DEMO'}</span>
        </div>
        <nav className="agent-nav" aria-label="Filter by agent">
          {(Object.keys(providers) as Provider[]).map((agent) => (
            <button
              key={agent}
              className={provider === agent && view === 'sessions' ? 'agent-active' : ''}
              onClick={() => selectNavigation('sessions', agent)}
            >
              <ProviderIcon provider={agent} />
              <span>{providers[agent].name}</span>
              <span className="agent-count">
                {sessions.filter((session) => session.provider === agent).length}
              </span>
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="connection-status">
          <span className="connection-symbol">
            <Radio size={18} />
          </span>
          <div>
            <strong>{live ? 'Live sessions' : 'Local preview'}</strong>
            <span>{live ? 'Local agent sources' : 'No agents connected'}</span>
          </div>
          <span className="neutral-dot" />
        </div>
        <nav className="bottom-nav" aria-label="Application settings">
          <button onClick={() => setModal('settings')}>
            <Settings2 size={17} />
            <span>Settings</span>
          </button>
          <button onClick={resetDemo} disabled={live}>
            <RotateCcw size={16} />
            <span>Reset demo</span>
          </button>
        </nav>
        <div className="sidebar-footer">
          <span className="user-avatar">P</span>
          <span>Personal</span>
          <span className="local-label">ON DEVICE</span>
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <IconButton
              className="mobile-menu"
              label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <PanelLeftOpen size={19} />
            </IconButton>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{view === 'activity' ? 'Activity' : 'Overview'}</strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-badge">
              {live ? <Radio size={12} /> : <FlaskConical size={12} />}
              {live ? 'Local sessions' : 'Demo data'}
            </span>
            <span className="topbar-divider" />
            <IconButton
              label="Notifications"
              className="notification-button"
              onClick={() => setModal('notifications')}
            >
              <Bell size={18} />
              {(live ? alerts.items.length : attention.length) > 0 && (
                <span className="notification-dot" />
              )}
            </IconButton>
            <IconButton
              label={
                desktop
                  ? pinned
                    ? 'Unpin window'
                    : 'Pin window'
                  : 'Pinning requires the desktop app'
              }
              disabled={!desktop}
              className={pinned ? 'is-pinned' : ''}
              onClick={() => void togglePin()}
            >
              {pinned ? <PinOff size={17} /> : <Pin size={17} />}
            </IconButton>
            <button className="button button-secondary mini-button" onClick={openMini}>
              <PanelTop size={15} />
              <span>Mini monitor</span>
              <ArrowUpRight size={13} />
            </button>
          </div>
        </header>

        <main className="main-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="live-dot" />
                YOUR WORKSPACE
              </div>
              <h1>
                {view === 'activity' ? 'Activity' : 'Sessions'}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {view === 'activity'
                  ? `${allEvents.length} events across your ${live ? 'live' : 'sample'} sessions`
                  : `${running.length} in progress. ${attention.length} need your attention.`}
              </p>
            </div>
            <div className="heading-actions">
              {desktop && (
                <div className="source-switch" role="group" aria-label="Session source">
                  <button aria-pressed={live} onClick={() => void chooseSource('live')}>
                    <Monitor size={14} />
                    Live
                  </button>
                  <button aria-pressed={!live} onClick={() => void chooseSource('demo')}>
                    <FlaskConical size={14} />
                    Demo
                  </button>
                </div>
              )}
              <button
                className="button button-secondary filter-settings"
                aria-label="Display settings"
                onClick={() => setModal('settings')}
              >
                <SlidersHorizontal size={15} />
              </button>
              <button
                className="button button-primary"
                onClick={() => (live ? void refreshSessions() : startDemo())}
                disabled={live ? feed.state === 'connecting' : !!simulatingId}
              >
                {live ? (
                  <RotateCcw size={15} />
                ) : simulatingId ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                <span>{live ? 'Refresh' : simulatingId ? 'Demo running' : 'Run demo'}</span>
              </button>
            </div>
          </div>

          <div className="stats-strip">
            {[
              {
                label: 'Total sessions',
                value: sessions.length,
                Icon: Code2,
                tone: 'neutral',
                filter: 'all' as const,
              },
              {
                label: 'In progress',
                value: running.length,
                Icon: CircleDot,
                tone: 'green',
                filter: 'running' as const,
              },
              {
                label: 'Needs attention',
                value: attention.length,
                Icon: CirclePause,
                tone: 'amber',
                filter: 'attention' as const,
              },
              {
                label: 'Rely Ready',
                value: completed.length,
                Icon: CircleCheck,
                tone: 'blue',
                filter: 'completed' as const,
              },
            ].map((stat) => (
              <button
                key={stat.label}
                className={`stat stat-${stat.tone}`}
                onClick={() => {
                  setView('sessions')
                  setFilter(stat.filter)
                }}
              >
                <div className="stat-label">
                  <stat.Icon size={15} />
                  <span>{stat.label}</span>
                </div>
                <div className="stat-value">
                  {String(stat.value).padStart(2, '0')}
                  <span className="stat-detail">
                    {stat.filter === 'running' ? (
                      <>
                        <span className="tiny-pulse" />
                        working
                      </>
                    ) : stat.filter === 'attention' ? (
                      'to review'
                    ) : stat.filter === 'completed' ? (
                      'this workspace'
                    ) : live ? (
                      'across connected agents'
                    ) : (
                      'across 3 agents'
                    )}
                  </span>
                </div>
              </button>
            ))}
          </div>

          {view === 'sessions' ? (
            <div className={`workspace-body ${selected ? '' : 'no-inspector'}`}>
              <section className="sessions-section" aria-label="Sessions">
                <div className="session-tabs" role="tablist" aria-label="Session status">
                  {(
                    [
                      { id: 'all', label: 'All sessions', count: sessions.length },
                      { id: 'running', label: 'In progress', count: running.length },
                      { id: 'attention', label: 'Attention', count: attention.length },
                      { id: 'completed', label: 'Rely Ready', count: completed.length },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      role="tab"
                      aria-selected={filter === tab.id}
                      className={filter === tab.id ? 'tab-active' : ''}
                      onClick={() => setFilter(tab.id)}
                    >
                      {tab.label}
                      <span>{tab.count}</span>
                    </button>
                  ))}
                </div>
                <div className="session-toolbar">
                  <label className="search-box">
                    <Search size={15} />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search sessions..."
                      aria-label="Search sessions"
                    />
                    {query && (
                      <IconButton label="Clear search" onClick={() => setQuery('')}>
                        <X size={13} />
                      </IconButton>
                    )}
                  </label>
                  <div className="toolbar-right">
                    {live && (
                      <label className="provider-select collection-select">
                        <select
                          value={collection}
                          onChange={(event) => {
                            setCollection(event.target.value as typeof collection)
                            setFilter('all')
                          }}
                          aria-label="Session collection"
                        >
                          <option value="active">Not archived</option>
                          <option value="archived">
                            Archived ({sessions.filter((session) => session.archivedAt).length})
                          </option>
                          <option value="all">All sessions</option>
                        </select>
                        <ChevronDown size={12} />
                      </label>
                    )}
                    <label className="provider-select">
                      <select
                        value={provider}
                        onChange={(event) => setProvider(event.target.value as Provider | 'all')}
                        aria-label="Agent filter"
                      >
                        <option value="all">All agents</option>
                        {(Object.keys(providers) as Provider[]).map((agent) => (
                          <option key={agent} value={agent}>
                            {providers[agent].name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={12} />
                    </label>
                    <div className="view-toggle" aria-label="Session layout">
                      <IconButton
                        label="Grid view"
                        aria-pressed={layout === 'grid'}
                        className={layout === 'grid' ? 'view-active' : ''}
                        onClick={() => setLayout('grid')}
                      >
                        <LayoutGrid size={14} />
                      </IconButton>
                      <IconButton
                        label="List view"
                        aria-pressed={layout === 'list'}
                        className={layout === 'list' ? 'view-active' : ''}
                        onClick={() => setLayout('list')}
                      >
                        <List size={16} />
                      </IconButton>
                    </div>
                  </div>
                </div>
                <div className={`session-grid ${layout === 'list' ? 'list-layout' : ''}`}>
                  {pageSessions.map((session, index) => (
                    <SessionCard
                      key={session.id}
                      session={session}
                      selected={selectedId === session.id}
                      now={now}
                      index={index}
                      onSelect={() => setSelectedId(session.id)}
                    />
                  ))}
                </div>
                {visible.length === 0 && (
                  <div className="empty-state">
                    <Inbox size={29} strokeWidth={1.4} />
                    <h3>
                      {live && sessions.length === 0 ? 'No live sessions' : 'No matching sessions'}
                    </h3>
                    <button
                      className="button button-secondary"
                      onClick={() => {
                        setQuery('')
                        setFilter('all')
                        setProvider('all')
                        setCollection('all')
                        setPreferences((current) => ({ ...current, showCompleted: true }))
                      }}
                    >
                      Clear filters
                    </button>
                  </div>
                )}
                <div className="list-footer">
                  <span>
                    {visible.length} matching / {sessions.length} monitored
                  </span>
                  {pages > 1 && (
                    <nav className="mini-pagination" aria-label="Session pages">
                      <IconButton
                        label="Previous session page"
                        disabled={pageIndex === 0}
                        onClick={() => setPageState({ key: pageKey, page: pageIndex - 1 })}
                      >
                        <ChevronLeft size={14} />
                      </IconButton>
                      <span>
                        Page {pageIndex + 1} of {pages}
                      </span>
                      <IconButton
                        label="Next session page"
                        disabled={pageIndex === pages - 1}
                        onClick={() => setPageState({ key: pageKey, page: pageIndex + 1 })}
                      >
                        <ChevronRight size={14} />
                      </IconButton>
                    </nav>
                  )}
                  <span>
                    <ShieldCheck size={12} />
                    {live
                      ? 'Read locally / not cached'
                      : storageUnavailable
                        ? 'Storage unavailable'
                        : 'Stored on this device'}
                  </span>
                </div>
              </section>

              {selected && (
                <aside className="inspector" aria-label="Session details">
                  <div className="inspector-heading">
                    <span>SESSION DETAILS</span>
                    <IconButton label="Close session details" onClick={() => setSelectedId(null)}>
                      <X size={15} />
                    </IconButton>
                  </div>
                  <div className="inspector-identity">
                    <span className={`large-provider ${selected.provider}`}>
                      <ProviderIcon provider={selected.provider} size={24} />
                    </span>
                    <div>
                      <strong>{providers[selected.provider].name}</strong>
                      <span title={selected.id}>
                        {sessionHostLabel(selected)}
                        <span className="separator">/</span>#
                        {selected.id.split(':').at(-1)?.slice(0, 8)}
                      </span>
                    </div>
                    <span className="inspector-demo">{live ? 'LOCAL' : 'DEMO'}</span>
                  </div>
                  <h2>{selected.task}</h2>
                  <StatusBadge status={selected.status} />
                  {selected.archivedAt && (
                    <span
                      className="archive-badge"
                      title={new Date(selected.archivedAt).toLocaleString()}
                    >
                      <Archive size={12} />
                      Archived
                    </span>
                  )}
                  {live && <p className="source-message">{selected.statusDetail}</p>}
                  <dl className="session-facts">
                    <div>
                      <dt>
                        <Folder size={13} />
                        Project
                      </dt>
                      <dd>{selected.project}</dd>
                    </div>
                    <div>
                      <dt>
                        <GitBranch size={13} />
                        Branch
                      </dt>
                      <dd title={selected.branch}>{selected.branch}</dd>
                    </div>
                    <div>
                      <dt>
                        <Clock3 size={13} />
                        {selected.source === 'claude' ? 'Observed runtime' : 'Elapsed'}
                      </dt>
                      <dd className="mono">
                        {selected.status === 'idle' ? 'Idle' : elapsed(selected, now)}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <FileCode2 size={13} />
                        Files touched
                      </dt>
                      <dd>{live ? 'Not reported' : `${selected.files} files`}</dd>
                    </div>
                    {live && selected.status !== 'running' && (
                      <div>
                        <dt>
                          <Activity size={13} />
                          Last activity
                        </dt>
                        <dd className="mono" title={new Date(selected.updatedAt).toLocaleString()}>
                          {idleTime(selected, now)}
                        </dd>
                      </div>
                    )}
                  </dl>
                  {!live && selected.status === 'waiting' && (
                    <div className="approval-banner">
                      <div>
                        <CirclePause size={15} />
                        <strong>Approval requested</strong>
                      </div>
                      <p>Update {selected.files} color token files</p>
                      <button
                        className="button button-approve"
                        onClick={() => startDemo(selected.id)}
                        disabled={!!simulatingId}
                      >
                        <Check size={14} />
                        Approve in demo
                      </button>
                    </div>
                  )}
                  {!live && selected.status === 'failed' && (
                    <div className="failure-banner">
                      <TriangleAlert size={15} />
                      <div>
                        <strong>Connection timed out</strong>
                        <p>Database was unavailable.</p>
                        <button onClick={() => startDemo(selected.id)} disabled={!!simulatingId}>
                          Retry in demo <RotateCcw size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                  <SessionTimeline key={selected.id} session={selected} />
                  <div className="inspector-footer">
                    {desktop && selected.source === 'vscode' && (
                      <SessionNavigation key={selected.id} session={selected} />
                    )}
                    {selected.status === 'completed' && (
                      <button
                        className="button button-secondary open-session-button"
                        disabled={!unreadReplyIds.has(selected.id)}
                        onClick={() => {
                          if (desktop && selected.source) {
                            void desktop.markRead(referenceForSession(selected)).catch(() =>
                              setToast({
                                title: 'Reply could not be marked read',
                                detail: 'The request changed or the state could not be saved.',
                                tone: 'info',
                              }),
                            )
                          } else
                            setSeenReplies((current) => ({
                              ...current,
                              [selected.id]: replyMarker(selected),
                            }))
                        }}
                      >
                        <CheckCheck size={15} />
                        {unreadReplyIds.has(selected.id)
                          ? 'Mark reply as read'
                          : 'Reply marked as read'}
                      </button>
                    )}
                    {live && (
                      <button
                        className="button button-secondary open-session-button"
                        title="Only changes the Pulse collection; monitoring continues"
                        onClick={() => void archiveSession(selected)}
                      >
                        {selected.archivedAt ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                        {selected.archivedAt ? 'Restore session' : 'Archive session'}
                      </button>
                    )}
                    {!live && selected.status === 'running' && (
                      <button
                        className="text-button"
                        disabled={!!simulatingId}
                        onClick={() => startDemo(selected.id)}
                      >
                        {simulatingId === selected.id ? (
                          <LoaderCircle size={12} className="spin" />
                        ) : (
                          <FlaskConical size={12} />
                        )}
                        {simulatingId === selected.id
                          ? 'Completion demo running'
                          : 'Simulate completion'}
                      </button>
                    )}
                  </div>
                </aside>
              )}
            </div>
          ) : (
            <section className="activity-section" aria-label="Activity timeline">
              <div className="activity-heading">
                <h2>Recent events</h2>
                <span className="demo-badge">
                  <FlaskConical size={12} />
                  {live ? 'Local events' : 'Demo events'}
                </span>
              </div>
              <div className="activity-list">
                {allEvents.map((event) => (
                  <button
                    key={`${event.session.id}-${event.id}`}
                    className="activity-row"
                    onClick={() => {
                      setSelectedId(event.session.id)
                      setView('sessions')
                    }}
                  >
                    <span className={`activity-event-icon event-${event.kind}`}>
                      {event.kind === 'error' ? (
                        <TriangleAlert size={16} />
                      ) : event.kind === 'warning' ? (
                        <CirclePause size={16} />
                      ) : event.kind === 'success' ? (
                        <CircleCheck size={16} />
                      ) : (
                        <Activity size={16} />
                      )}
                    </span>
                    <span className="activity-description">
                      <strong>{event.text}</strong>
                      <span>
                        {event.session.project}
                        <span className="separator">/</span>
                        {providers[event.session.provider].name}
                      </span>
                    </span>
                    <time>{relativeTime(event.at, now)}</time>
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
            </section>
          )}
          <footer className="page-footer">
            <span>
              <span className="neutral-dot" />
              {live ? 'Live workspace' : 'Demo workspace'}
            </span>
            <span>
              pulse <span className="footer-slash">/</span> v0.1.0
            </span>
          </footer>
        </main>
      </div>

      <dialog
        ref={dialogRef}
        className="app-dialog"
        onCancel={() => setModal(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setModal(null)
        }}
      >
        <div className="dialog-content">
          <div className="dialog-heading">
            <div>
              <span className="eyebrow">WORKSPACE</span>
              <h2>{modal === 'settings' ? 'Preferences' : 'Notifications'}</h2>
            </div>
            <IconButton label="Close dialog" onClick={() => setModal(null)}>
              <X size={19} />
            </IconButton>
          </div>
          {modal === 'settings' ? (
            <>
              <div className="settings-group">
                <div className="settings-group-label">NOTIFICATIONS</div>
                <div className="setting-row popup-setting">
                  <span className="setting-icon">
                    <Clock3 size={18} />
                  </span>
                  <div>
                    <strong>Popup duration</strong>
                    <span>Desktop reminders</span>
                  </div>
                  <select
                    className="setting-select"
                    aria-label="Popup duration"
                    value={alerts.popupDurationMs ?? 5000}
                    disabled={!desktop?.setPopupDuration}
                    onChange={(event) => void changePopupDuration(Number(event.target.value))}
                  >
                    <option value={5000}>5 seconds</option>
                    <option value={10000}>10 seconds</option>
                    <option value={30000}>30 seconds</option>
                    <option value={0}>Until closed</option>
                  </select>
                </div>
                {popupSettingError && (
                  <p className="pending-alert-error" role="alert">
                    {popupSettingError}
                  </p>
                )}
                <div className="setting-row">
                  <span className="setting-icon">
                    <BellRing size={18} />
                  </span>
                  <div>
                    <strong>System notifications</strong>
                    <span>
                      {live ? 'On input requests, replies and errors' : 'On session completion'}
                    </span>
                  </div>
                  <Toggle
                    label="System notifications"
                    checked={preferences.notifications}
                    onChange={(enabled) => void enableNotifications(enabled)}
                  />
                </div>
                <div className="setting-row">
                  <span className="setting-icon">
                    <Volume2 size={18} />
                  </span>
                  <div>
                    <strong>Completion sound</strong>
                    <span>A quiet two-note chime</span>
                  </div>
                  <Toggle
                    label="Completion sound"
                    checked={preferences.sound}
                    onChange={(sound) => {
                      if (sound) {
                        audioRef.current ??= new AudioContext()
                        void audioRef.current.resume()
                      }
                      setPreferences((current) => ({ ...current, sound }))
                    }}
                  />
                </div>
              </div>
              <div className="settings-group">
                <div className="settings-group-label">DISPLAY</div>
                <div className="setting-row">
                  <span className="setting-icon">
                    <CircleCheck size={18} />
                  </span>
                  <div>
                    <strong>Rely Ready sessions</strong>
                    <span>Visible in the workspace</span>
                  </div>
                  <Toggle
                    label="Show Rely Ready sessions"
                    checked={preferences.showCompleted}
                    onChange={(showCompleted) =>
                      setPreferences((current) => ({ ...current, showCompleted }))
                    }
                  />
                </div>
                <div className="setting-row">
                  <span className="setting-icon">
                    <Pin size={18} />
                  </span>
                  <div>
                    <strong>Always on top</strong>
                    <span>{desktop ? 'Current desktop window' : 'Desktop app only'}</span>
                  </div>
                  <Toggle
                    label="Always on top"
                    checked={pinned}
                    onChange={() => void togglePin()}
                    disabled={!desktop}
                  />
                </div>
              </div>
              {desktop && feed.sources && (
                <section className="source-connections" aria-label="Source connections">
                  <div className="source-connections-heading">
                    <h3>Connections</h3>
                    <IconButton label="Refresh sources" onClick={() => void refreshSessions()}>
                      <RotateCcw size={14} />
                    </IconButton>
                  </div>
                  <SourceSettings
                    hooks={feed.sources.find((source) => source.id === 'claude')?.hooks}
                  />
                  {feed.sources.map((source) => (
                    <div className="source-connection" key={source.id}>
                      <strong>{source.name}</strong>
                      <dl>
                        <div>
                          <dt>Collector</dt>
                          <dd>{source.state}</dd>
                        </div>
                        <div>
                          <dt>Method</dt>
                          <dd>{source.acquisition}</dd>
                        </div>
                        <div>
                          <dt>Last check</dt>
                          <dd>
                            {source.scannedAt === null ? '-' : relativeTime(source.scannedAt, now)}
                          </dd>
                        </div>
                        <div>
                          <dt>Last success</dt>
                          <dd>
                            {source.lastSuccessAt == null
                              ? '-'
                              : relativeTime(source.lastSuccessAt, now)}
                          </dd>
                        </div>
                        <div>
                          <dt>Scan time</dt>
                          <dd>{source.durationMs === null ? '-' : `${source.durationMs} ms`}</dd>
                        </div>
                        {source.metrics && (
                          <div>
                            <dt>Checked / discovered</dt>
                            <dd>
                              {source.metrics.checked} / {source.metrics.discovered}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {['error', 'unavailable'].includes(source.state) && (
                        <p role="status">{source.message}</p>
                      )}
                    </div>
                  ))}
                </section>
              )}
              <p className="retention-limits" title="Oldest entries are evicted first">
                Retention: 200 reminders / 1000 baselines / 5000 read markers / 1000 hook sessions
              </p>
              <div className="integration-status">
                <Monitor size={18} />
                <div>
                  <strong>
                    {live ? 'Live sessions' : desktop ? 'Desktop preview' : 'Browser preview'}
                  </strong>
                  <span>
                    {live
                      ? feed.message
                      : desktop
                        ? 'Sample data; live collectors remain active.'
                        : 'Demo data only. No agent adapter connected.'}
                  </span>
                </div>
                <span className="demo-badge">LOCAL</span>
              </div>
              <div className="dialog-footer">
                <button className="text-button" onClick={resetDemo} disabled={live}>
                  <RotateCcw size={13} />
                  Reset demo
                </button>
                <button className="button button-primary" onClick={() => setModal(null)}>
                  Done
                  <Check size={14} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="notification-list">
                {live && alerts.storageWarning && (
                  <p className="pending-alert-error" role="alert">
                    {alerts.storageWarning}
                  </p>
                )}
                {live ? (
                  alerts.items.length ? (
                    [...alerts.items]
                      .sort(
                        (first, second) =>
                          Number(second.status === 'waiting') -
                            Number(first.status === 'waiting') || second.at - first.at,
                      )
                      .map((alert) => (
                        <div className="pending-alert-row" key={alert.id}>
                          <button
                            className="notification-item"
                            aria-label={`${alert.recovered ? 'View current session:' : 'Open'} ${alert.project}: ${alert.task}`}
                            disabled={!!openingAlertId}
                            onClick={() => void openPendingAlert(alert)}
                          >
                            <span className={`notification-status-icon ${alert.status}`}>
                              {openingAlertId === alert.id ? (
                                <LoaderCircle size={19} className="spin" />
                              ) : alert.status === 'waiting' ? (
                                <CirclePause size={19} />
                              ) : alert.status === 'completed' ? (
                                <CheckCheck size={19} />
                              ) : (
                                <TriangleAlert size={19} />
                              )}
                            </span>
                            <span>
                              <strong>{alert.task}</strong>
                              <span>
                                {alert.project}
                                <span className="separator">/</span>
                                {statusLabels[alert.status]}
                              </span>
                              <span>{relativeTime(alert.at, now)}</span>
                              {alert.recovered && (
                                <span>
                                  Previous reminder. Original request not verified. View current
                                  session.
                                </span>
                              )}
                            </span>
                            <ArrowUpRight size={14} />
                          </button>
                          <IconButton
                            label={`Ignore reminder: ${alert.task}`}
                            disabled={openingAlertId === alert.id}
                            onClick={() => void ignoreAlert(alert.id)}
                          >
                            <X size={15} />
                          </IconButton>
                          {alertError?.id === alert.id && (
                            <p className="pending-alert-error" role="alert">
                              {alertError.text}
                            </p>
                          )}
                        </div>
                      ))
                  ) : (
                    <p className="source-message">No pending reminders</p>
                  )
                ) : (
                  sessions
                    .filter((session) => session.status !== 'running')
                    .sort((first, second) => second.updatedAt - first.updatedAt)
                    .map((session) => (
                      <button
                        key={session.id}
                        className="notification-item"
                        onClick={() => {
                          setSelectedId(session.id)
                          setView('sessions')
                          setModal(null)
                        }}
                      >
                        <span className={`notification-status-icon ${session.status}`}>
                          {session.status === 'completed' ? (
                            <CircleCheck size={19} />
                          ) : session.status === 'waiting' ? (
                            <CirclePause size={19} />
                          ) : (
                            <TriangleAlert size={19} />
                          )}
                        </span>
                        <span>
                          <strong>{session.project}</strong>
                          <span>
                            {statusLabels[session.status]}
                            <span className="separator">/</span>
                            {relativeTime(session.updatedAt, now)}
                          </span>
                        </span>
                        <ArrowUpRight size={14} />
                      </button>
                    ))
                )}
              </div>
              <div className="dialog-footer">
                <span className="muted">
                  {live ? `${alerts.items.length} pending reminders` : 'Demo workspace'}
                </span>
                <button className="button button-secondary" onClick={() => setModal(null)}>
                  Close
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
      {notificationToast}
    </div>
  )
}

export default Workspace
