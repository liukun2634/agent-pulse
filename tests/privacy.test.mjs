import assert from 'node:assert/strict'
import { test } from 'node:test'
import { scanText } from '../scripts/check-privacy.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

test('privacy scan detects personal paths and credentials without returning their values', () => {
  const home = ['C:', 'Users', 'fixture-person'].join('\\')
  const email = ['fixture-person', 'private.test'].join('@')
  const token = 'ghp_' + 'a'.repeat(36)
  const source = [home + '\\project', email, token].join('\n')
  const findings = scanText(source, home)
  assert.ok(findings.some((finding) => finding.kind === 'personal-profile-path'))
  assert.ok(findings.some((finding) => finding.kind === 'email-address'))
  assert.ok(findings.some((finding) => finding.kind === 'credential-token'))
  assert.equal(JSON.stringify(findings).includes(email), false)
  assert.equal(JSON.stringify(findings).includes(token), false)
  assert.deepEqual(scanText('contact@example.com\n123+example@users.noreply.github.com', home), [])
})

test('site publication excludes unlisted private files and desktop packaging excludes state JSON', () => {
  const canary = path.resolve('site', '.env.pulse-privacy-test')
  fs.writeFileSync(canary, 'SYNTHETIC_PRIVACY_CANARY=true\n', { flag: 'wx' })
  try {
    execFileSync(process.execPath, ['scripts/build-site.mjs'], { stdio: 'pipe' })
    assert.equal(
      fs.existsSync(path.resolve('.artifacts', 'site', '.env.pulse-privacy-test')),
      false,
    )
    assert.ok(fs.existsSync(path.resolve('.artifacts', 'site', 'download.html')))
    const config = JSON.parse(fs.readFileSync('package.json', 'utf8'))
    assert.ok(config.build.files.includes('electron/**/*.cjs'))
    assert.equal(config.build.files.includes('electron/**/*'), false)
  } finally {
    fs.rmSync(canary)
  }
})

test('Apache license metadata and license copies are included in desktop and bridge distributions', () => {
  const license = fs.readFileSync('LICENSE', 'utf8')
  assert.match(license, /Apache License\s+Version 2\.0, January 2004/)
  assert.match(license, /Grant of Patent License/)
  assert.match(license, /END OF TERMS AND CONDITIONS/)
  assert.equal(fs.readFileSync('vscode-session-bridge/LICENSE', 'utf8'), license)
  const desktop = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const bridge = JSON.parse(fs.readFileSync('vscode-session-bridge/package.json', 'utf8'))
  for (const directory of ['.', 'vscode-session-bridge']) {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
    const lock = JSON.parse(fs.readFileSync(path.join(directory, 'package-lock.json'), 'utf8'))
    assert.equal(manifest.license, 'Apache-2.0')
    assert.equal(lock.packages[''].license, manifest.license)
  }
  assert.ok(
    desktop.build.extraResources.some((item) => item.from === 'LICENSE' && item.to === 'LICENSE'),
  )
  assert.ok(bridge.files.includes('LICENSE'))
  assert.equal(bridge.scripts.package.includes('--skip-license'), false)
})

test('private runtime files and credentials are ignored before staging', () => {
  const files = [
    '.env',
    '.env.local',
    '.claude/settings.json',
    '.codex/auth.json',
    '.agent-pulse/session-bridge/window.json',
    'claude-hooks.json',
    'desktop-settings.json',
    'reminder-history.json',
    'signing.pfx',
    '.vscode-test/profile/state.json',
  ]
  const ignored = execFileSync('git', ['check-ignore', '--stdin'], {
    input: files.join('\n') + '\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
    .trim()
    .split(/\r?\n/)
  assert.deepEqual(ignored, files)
})
