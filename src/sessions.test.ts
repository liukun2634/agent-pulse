import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  changeStatus,
  createDemoSessions,
  elapsed,
  filterSessions,
  formatDuration,
  idleTime,
  parseSessions,
  serializeSessions,
  sessionDuration,
} from './sessions.ts'

const now = 1800000000000

test('demo data has six explicitly distinct session states', () => {
  const sessions = createDemoSessions(now)
  assert.equal(sessions.length, 6)
  assert.equal(filterSessions(sessions, '', 'running', 'all').length, 2)
  assert.equal(filterSessions(sessions, '', 'attention', 'all').length, 2)
  assert.equal(filterSessions(sessions, '', 'completed', 'all').length, 2)
})

test('completion freezes elapsed time and adds exactly one event', () => {
  const sessions = createDemoSessions(now)
  const completed = changeStatus(sessions, '014', 'completed', now)
  assert.equal(completed[0].status, 'completed')
  assert.equal(completed[0].events.length, sessions[0].events.length + 1)
  assert.equal(elapsed(completed[0], now + 90000), elapsed(completed[0], now))
  assert.equal(changeStatus(completed, '014', 'completed', now + 1), completed)
  assert.equal(sessions[0].status, 'running')
})

test('waiting is not completed until execution resumes', () => {
  const sessions = createDemoSessions(now)
  assert.equal(changeStatus(sessions, '012', 'completed', now), sessions)
  const resumed = changeStatus(sessions, '012', 'running', now)
  assert.equal(resumed[2].status, 'running')
  assert.equal(resumed[2].finishedAt, null)
})

test('live sessions cannot be mutated by demo controls and unknown needs attention', () => {
  const sessions = createDemoSessions(now)
  sessions[0].source = 'vscode'
  assert.equal(changeStatus(sessions, '014', 'completed', now), sessions)
  sessions[0].source = 'claude'
  assert.equal(changeStatus(sessions, '014', 'completed', now), sessions)
  sessions[0].status = 'unknown'
  assert.ok(
    filterSessions(sessions, '', 'attention', 'all').some((session) => session.id === '014'),
  )
})

test('retry resets the failed round timer', () => {
  const retried = changeStatus(createDemoSessions(now), '009', 'running', now)
  assert.equal(retried[5].startedAt, now)
  assert.equal(elapsed(retried[5], now), '00:00')
})

test('filters compose across provider, task and attention state', () => {
  const sessions = createDemoSessions(now)
  assert.equal(filterSessions(sessions, '  ATLAS ', 'all', 'codex').length, 2)
  assert.equal(filterSessions(sessions, 'migrations', 'attention', 'codex').length, 1)
  assert.equal(filterSessions(sessions, 'unknown', 'all', 'all').length, 0)
})

test('storage validates malformed, unknown and duplicate entries', () => {
  const sessions = createDemoSessions(now)
  assert.deepEqual(parseSessions(serializeSessions(sessions)), sessions)
  assert.equal(parseSessions('{'), null)
  assert.equal(parseSessions(null), null)
  assert.equal(
    parseSessions(serializeSessions([{ ...sessions[0], status: 'invalid' } as never])),
    null,
  )
  assert.equal(parseSessions(serializeSessions([sessions[0], sessions[0]])), null)
  assert.deepEqual(parseSessions(serializeSessions([])), [])
})

test('duration formatting is stable at minute and hour boundaries', () => {
  assert.equal(formatDuration(-1000), '00:00')
  assert.equal(formatDuration(61000), '01:01')
  assert.equal(formatDuration(3600000), '1:00:00')
})

test('idle duration grows even after completion and resets on new activity', () => {
  const session = { ...createDemoSessions(now)[3], updatedAt: now }
  assert.equal(idleTime(session, now), '00:00')
  assert.equal(idleTime(session, now + 65000), '01:05')
  assert.equal(idleTime(session, now + 3665000), '1:01:05')
  assert.equal(elapsed(session, now + 65000), elapsed(session, now))
  assert.equal(idleTime({ ...session, updatedAt: now + 65000 }, now + 66000), '00:01')
  assert.equal(idleTime(session, now - 1000), '00:00')
})

test('running sessions show current request duration while idle is not running', () => {
  const session = {
    ...createDemoSessions(now)[0],
    source: 'claude' as const,
    requestStartedAt: now - 65000,
  }
  assert.equal(sessionDuration(session, now), '01:05')
  assert.equal(sessionDuration({ ...session, status: 'idle' }, now), 'Idle')
  assert.equal(filterSessions([{ ...session, status: 'idle' }], '', 'running', 'all').length, 0)
  assert.equal(sessionDuration({ ...session, source: 'vscode' }, now), '01:05')
})
