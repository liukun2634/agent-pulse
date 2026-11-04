import { useEffect, useState } from 'react'
import { ArrowUpRight, CheckCheck, CirclePause, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import './alerts.css'

export default function AlertWindow() {
  const [state, setState] = useState<PulseAlertState>({
    items: [],
    revision: -1,
    systemNotifications: false,
  })
  const [busy, setBusy] = useState(false)
  const [paused, setPaused] = useState(false)
  const [fading, setFading] = useState(false)
  const [error, setError] = useState<{ id: string; text: string } | null>(null)
  const items = state.items.filter((item) => state.popup?.ids.includes(item.id))
  const alert = items[0]
  const sequence = state.popup?.sequence ?? 0

  useEffect(() => {
    setFading(false)
    if (!alert || paused || busy) return
    const fade = window.setTimeout(() => setFading(true), 5000)
    const hide = window.setTimeout(() => void window.pulse?.hideAlertPopup(sequence), 5320)
    return () => {
      window.clearTimeout(fade)
      window.clearTimeout(hide)
    }
  }, [sequence, alert?.id, paused, busy])

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

  async function openAlert() {
    if (!alert || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.pulse?.openVSCode(alert.sessionId)
      if (result?.mode === 'workspace')
        setError({ id: alert.id, text: result.message ?? 'Pulse Companion is not connected.' })
    } catch {
      setError({ id: alert.id, text: 'Could not open this session. Try again or open Pulse.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      className={`alert-window alert-${alert?.status ?? 'empty'} ${fading ? 'alert-fading' : ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false)
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
            onClick={() => void window.pulse?.openWorkspace(alert?.sessionId)}
            title="View sessions in Pulse"
          >
            +{items.length - 1} more
          </button>
        )}
        <button
          className="alert-icon-button"
          title="Hide notification"
          aria-label="Hide notification"
          onClick={() => void window.pulse?.hideAlertPopup(sequence)}
        >
          <X size={17} />
        </button>
      </header>
      <button
        className="alert-open-session"
        disabled={!alert || busy}
        onClick={() => void openAlert()}
        title="Open in VS Code"
        aria-label="Open in VS Code"
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
