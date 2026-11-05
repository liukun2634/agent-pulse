import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CheckCheck, CirclePause, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import './alerts.css'

export default function AlertWindow() {
  const [state, setState] = useState<PulseAlertState>({
    items: [],
    revision: -1,
    systemNotifications: false,
  })
  useEffect(() => {
    if (!window.pulse) return
    let active = true
    const accept = (incoming: PulseAlertState) => {
      if (active)
        setState((previous) => (incoming.revision > previous.revision ? incoming : previous))
    }
    const unsubscribe = window.pulse.onAlerts(accept)
    void window.pulse.getAlerts().then(accept)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const first = state.items.find((item) => state.popup?.ids.includes(item.id))
  return <AlertPopup key={`${state.popup?.sequence ?? 0}:${first?.id ?? 'empty'}`} state={state} />
}

function AlertPopup({ state }: { state: PulseAlertState }) {
  const [busy, setBusy] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [fading, setFading] = useState(false)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState<{ id: string; text: string } | null>(null)
  const remaining = useRef(5000)
  const items = state.items.filter((item) => state.popup?.ids.includes(item.id))
  const alert = items[0]
  const sequence = state.popup?.sequence ?? 0
  const hasAlert = !!alert
  const paused = hovered || focused
  const activeFade = fading && (closing || (!paused && !busy))

  useEffect(() => {
    if (!hasAlert || paused || busy || fading) return
    const started = Date.now()
    const timer = window.setTimeout(() => {
      remaining.current = 0
      setFading(true)
    }, remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [hasAlert, paused, busy, fading])

  useEffect(() => {
    if (hasAlert) void window.pulse?.readyAlertPopup?.(sequence)
  }, [hasAlert, sequence])

  useEffect(() => {
    if (!activeFade) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const fallback = window.setTimeout(
      () => void window.pulse?.hideAlertPopup(sequence),
      reduced ? 0 : 1000,
    )
    return () => window.clearTimeout(fallback)
  }, [activeFade, sequence])

  async function openAlert() {
    if (!alert || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await (window.pulse?.openSession ?? window.pulse?.openVSCode)?.(
        alert.sessionId,
        {
          ...alert.reference,
          alertId: alert.id,
        },
      )
      if (result?.message)
        setError({ id: alert.id, text: result.message ?? 'The session is not connected.' })
    } catch {
      setError({ id: alert.id, text: 'Could not open this session. Try again or open Pulse.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      className={`alert-window alert-${alert?.status ?? 'empty'} ${activeFade ? 'alert-fading' : ''}`}
      data-popup-sequence={sequence}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'opacity' && activeFade)
          void window.pulse?.hideAlertPopup(sequence)
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
    >
      <header className="alert-header">
        <h1>
          {alert?.status === 'waiting' ? (
            <CirclePause size={16} />
          ) : alert?.status === 'failed' ? (
            <TriangleAlert size={16} />
          ) : (
            <CheckCheck size={16} />
          )}
          {alert?.status === 'completed' ? 'Rely Ready' : (alert?.title ?? 'Pulse')}
        </h1>
        {items.length > 1 && (
          <button
            className="alert-more"
            onClick={() => void window.pulse?.openAlertInbox()}
            title="View pending reminders"
          >
            +{items.length - 1} more
          </button>
        )}
        <button
          className="alert-icon-button"
          title="Hide notification"
          aria-label="Hide notification"
          onClick={() => {
            setClosing(true)
            setFading(true)
          }}
        >
          <X size={17} />
        </button>
      </header>
      <button
        className="alert-open-session"
        disabled={!alert || busy}
        onClick={() => void openAlert()}
        title={
          alert?.sessionId.startsWith('claude:') ? 'Continue in Claude Code' : 'Open in VS Code'
        }
        aria-label={
          alert?.sessionId.startsWith('claude:') ? 'Continue in Claude Code' : 'Open in VS Code'
        }
      >
        <span className="alert-content" role="status">
          <strong className="alert-project">{alert?.project}</strong>
          <span className="alert-task">{error?.id === alert?.id ? error?.text : alert?.task}</span>
        </span>
        {busy ? <LoaderCircle size={18} className="spin" /> : <ArrowUpRight size={18} />}
      </button>
    </main>
  )
}
