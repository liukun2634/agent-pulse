export type Provider = 'claude' | 'codex' | 'copilot'
export type SessionStatus =
  'running' | 'waiting' | 'completed' | 'failed' | 'disconnected' | 'unknown'
export type SessionFilter = 'all' | 'running' | 'attention' | 'completed'

export interface SessionEvent {
  id: string
  text: string
  at: number
  kind: 'info' | 'success' | 'warning' | 'error'
}

export interface Session {
  id: string
  project: string
  task: string
  branch: string
  provider: Provider
  source?: 'vscode'
  statusDetail?: string
  status: SessionStatus
  startedAt: number
  updatedAt: number
  finishedAt: number | null
  files: number
  events: SessionEvent[]
}

export const providers: Record<Provider, { name: string; surface: string }> = {
  claude: { name: 'Claude Code', surface: 'Terminal' },
  codex: { name: 'Codex', surface: 'Terminal' },
  copilot: { name: 'GitHub Copilot', surface: 'VS Code' },
}

export const statusLabels: Record<SessionStatus, string> = {
  running: 'In progress',
  waiting: 'Needs input',
  completed: 'Completed',
  failed: 'Failed',
  disconnected: 'Disconnected',
  unknown: 'Status unknown',
}

export function createDemoSessions(now = Date.now()): Session[] {
  const definitions: Array<
    [string, string, string, Provider, SessionStatus, number, number, number, string[]]
  > = [
    [
      '014',
      'pulse-desktop',
      'Refining the session timeline',
      'claude',
      'running',
      173,
      9,
      4,
      [
        'Session started',
        'Read existing components',
        'Updated the timeline layout',
        'Writing component tests',
      ],
    ],
    [
      '013',
      'atlas-api',
      'Add authentication middleware',
      'codex',
      'running',
      342,
      18,
      6,
      [
        'Session started',
        'Inspected API routes',
        'Added authentication guards',
        'Running integration tests',
      ],
    ],
    [
      '012',
      'design-system',
      'Update the color primitives',
      'copilot',
      'waiting',
      228,
      41,
      3,
      [
        'Session started',
        'Reviewed existing tokens',
        'Prepared the color updates',
        'Permission requested to update 3 files',
      ],
    ],
    [
      '011',
      'pulse-desktop',
      'Improve the empty states',
      'claude',
      'completed',
      1440,
      900,
      2,
      ['Session started', 'Updated empty states', 'Checks passed', 'Session completed'],
    ],
    [
      '010',
      'docs',
      'Document the event protocol',
      'copilot',
      'completed',
      2280,
      1500,
      1,
      ['Session started', 'Reviewed event types', 'Updated documentation', 'Session completed'],
    ],
    [
      '009',
      'atlas-api',
      'Run the database migrations',
      'codex',
      'failed',
      840,
      660,
      0,
      [
        'Session started',
        'Loaded migration configuration',
        'Attempted database connection',
        'Database connection timed out',
      ],
    ],
  ]

  return definitions.map(
    ([id, project, task, provider, status, age, lastUpdate, files, messages]) => {
      const startedAt = now - age * 1000
      const updatedAt = now - lastUpdate * 1000
      return {
        id,
        project,
        task,
        provider,
        status,
        startedAt,
        updatedAt,
        files,
        branch:
          project === 'pulse-desktop'
            ? 'feat/session-monitor'
            : project === 'atlas-api'
              ? 'feat/auth'
              : 'main',
        finishedAt: status === 'completed' || status === 'failed' ? updatedAt : null,
        events: messages.map((text, index) => ({
          id: `${id}-${index}`,
          text,
          at: Math.round(startedAt + ((updatedAt - startedAt) * index) / (messages.length - 1)),
          kind:
            index !== messages.length - 1
              ? 'success'
              : status === 'failed'
                ? 'error'
                : status === 'waiting'
                  ? 'warning'
                  : status === 'completed'
                    ? 'success'
                    : 'info',
        })),
      }
    },
  )
}

const transitions: Record<SessionStatus, SessionStatus[]> = {
  running: ['waiting', 'completed', 'failed', 'disconnected'],
  waiting: ['running', 'failed', 'disconnected'],
  completed: [],
  failed: ['running'],
  disconnected: ['running', 'failed'],
  unknown: [],
}

export function changeStatus(
  sessions: Session[],
  id: string,
  status: SessionStatus,
  now = Date.now(),
): Session[] {
  const target = sessions.find((session) => session.id === id)
  if (!target || target.source === 'vscode' || !transitions[target.status].includes(status))
    return sessions

  const messages: Record<SessionStatus, string> = {
    running: 'Execution resumed',
    waiting: 'Waiting for your approval',
    completed: 'Session completed',
    failed: 'Execution stopped with an error',
    disconnected: 'Connection lost',
    unknown: 'Status is unknown',
  }
  return sessions.map((session) =>
    session.id !== id
      ? session
      : {
          ...session,
          status,
          startedAt: session.status === 'failed' && status === 'running' ? now : session.startedAt,
          updatedAt: now,
          finishedAt: status === 'completed' || status === 'failed' ? now : null,
          events: [
            ...session.events,
            {
              id: `${session.id}-${now}-${status}`,
              text: messages[status],
              at: now,
              kind:
                status === 'completed'
                  ? 'success'
                  : status === 'failed'
                    ? 'error'
                    : status === 'waiting' || status === 'disconnected'
                      ? 'warning'
                      : 'info',
            },
          ],
        },
  )
}

export function filterSessions(
  sessions: Session[],
  query: string,
  filter: SessionFilter,
  provider: Provider | 'all',
): Session[] {
  const needle = query.trim().toLowerCase()
  return sessions.filter((session) => {
    const matchesText =
      `${session.project} ${session.task} ${session.branch} ${providers[session.provider].name}`
        .toLowerCase()
        .includes(needle)
    const matchesStatus =
      filter === 'all' ||
      (filter === 'attention'
        ? ['waiting', 'failed', 'disconnected', 'unknown'].includes(session.status)
        : session.status === filter)
    return matchesText && matchesStatus && (provider === 'all' || provider === session.provider)
  })
}

export function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const minutes = Math.floor(seconds / 60)
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

export function elapsed(session: Session, now: number): string {
  return formatDuration((session.finishedAt ?? now) - session.startedAt)
}

export function idleTime(session: Session, now: number): string {
  return formatDuration(now - session.updatedAt)
}

export function relativeTime(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000))
  return minutes === 0
    ? 'Just now'
    : minutes < 60
      ? `${minutes}m ago`
      : `${Math.floor(minutes / 60)}h ago`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseSessions(value: string | null): Session[] | null {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null')
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.sessions) ||
      parsed.sessions.length > 100
    )
      return null
    const valid = parsed.sessions.every(
      (session: unknown) =>
        isRecord(session) &&
        ['id', 'project', 'task', 'branch'].every((key) => typeof session[key] === 'string') &&
        typeof session.provider === 'string' &&
        Object.hasOwn(providers, session.provider) &&
        typeof session.status === 'string' &&
        Object.hasOwn(statusLabels, session.status) &&
        ['startedAt', 'updatedAt', 'files'].every(
          (key) => typeof session[key] === 'number' && Number.isFinite(session[key]),
        ) &&
        (session.finishedAt === null ||
          (typeof session.finishedAt === 'number' && Number.isFinite(session.finishedAt))) &&
        Array.isArray(session.events) &&
        session.events.every(
          (event: unknown) =>
            isRecord(event) &&
            typeof event.id === 'string' &&
            typeof event.text === 'string' &&
            typeof event.at === 'number' &&
            Number.isFinite(event.at) &&
            typeof event.kind === 'string' &&
            ['info', 'success', 'warning', 'error'].includes(event.kind),
        ),
    )
    if (
      !valid ||
      new Set(parsed.sessions.map((session: Session) => session.id)).size !== parsed.sessions.length
    )
      return null
    return parsed.sessions as Session[]
  } catch {
    return null
  }
}

export function serializeSessions(sessions: Session[]): string {
  return JSON.stringify({ version: 1, sessions })
}
