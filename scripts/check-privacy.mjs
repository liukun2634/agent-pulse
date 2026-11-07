import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const rules = [
  ['personal-profile-path', /[a-z]:[\\/]+Users[\\/]+[^\\/\s"'<>]+|\/(?:Users|home)\/[^/\s"'<>]+/i],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    'credential-token',
    /gh[pousr]_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|sk-(?:proj-|ant-)?[a-z0-9_-]{20,}/i,
  ],
  [
    'credential-literal',
    /(?:token|secret|password|api[_-]?key)\s*["']?\s*[:=]\s*["'][a-z0-9_+/=-]{32,}["']/i,
  ],
]
const privateFiles =
  /(^|\/)(?:\.env(?:\..+)?|\.(?:agent-pulse|claude|codex)(?:\/|$)|\.vscode-test(?:\/|$)|\.artifacts(?:\/|$)|test-results(?:\/|$)|playwright-report(?:\/|$)|node_modules(?:\/|$)|claude-hooks\.json|desktop-settings\.json|reminder-history\.json|session-management\.json|notification-settings\.json)|\.(?:pfx|p12|key|pem|dmp)$/i

export function scanText(text, home = os.homedir()) {
  const findings = []
  const normalizedHome = home.replaceAll('\\', '/').toLowerCase()
  text.split(/\r?\n/).forEach((line, index) => {
    for (const [kind, pattern] of rules)
      if (pattern.test(line)) findings.push({ line: index + 1, kind })
    for (const match of line.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
      const domain = match[0].split('@')[1].toLowerCase()
      if (!/^(?:example\.(?:com|org|net|test)|users\.noreply\.github\.com)$/.test(domain))
        findings.push({ line: index + 1, kind: 'email-address' })
    }
    if (
      normalizedHome &&
      line.replaceAll('\\\\', '\\').replaceAll('\\', '/').toLowerCase().includes(normalizedHome)
    )
      findings.push({ line: index + 1, kind: 'current-home-path' })
  })
  return findings
}

function main() {
  const staged = process.argv.includes('--staged')
  const git = (args, encoding = 'utf8') =>
    execFileSync('git', args, {
      encoding,
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    })
  const files = [
    ...new Set(
      git(
        staged
          ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']
          : ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      )
        .split('\0')
        .filter(Boolean),
    ),
  ]
  const findings = []
  const binaryFiles = []
  const notices = []
  const metadata = git(['log', '--all', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce'])
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\0'))
  const personalEmails = new Set(metadata.flatMap((entry) => [entry[2], entry[4]]).filter(Boolean))
  let scanned = 0
  for (const filename of files) {
    if (!staged && !fs.existsSync(filename)) continue
    if (privateFiles.test(filename))
      findings.push({ file: filename, kind: 'private-runtime-or-key-file' })
    const data = staged ? git(['show', `:${filename}`], null) : fs.readFileSync(filename)
    scanned++
    if (data.includes(0)) {
      binaryFiles.push(filename)
      continue
    }
    const text = data.toString('utf8')
    const lines = text.split(/\r?\n/)
    for (const finding of scanText(text)) {
      let dependencyNotice = false
      if (filename === 'package-lock.json' && finding.kind === 'email-address') {
        try {
          const field = JSON.parse(`{${lines[finding.line - 1].trim().replace(/,$/, '')}}`)
          const known = JSON.parse(text).packages?.['node_modules/glob']?.deprecated
          const emails =
            typeof field.deprecated === 'string'
              ? (field.deprecated.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])
              : []
          dependencyNotice =
            field.deprecated === known &&
            emails.length > 0 &&
            !emails.some((email) => personalEmails.has(email))
        } catch {}
      }
      if (dependencyNotice)
        notices.push({
          file: filename,
          line: finding.line,
          kind: 'reviewed-third-party-glob-deprecation-contact',
        })
      else findings.push({ file: filename, ...finding })
    }
  }
  const report = {
    scope: staged ? 'staged blobs' : 'tracked and non-ignored working files',
    scannedFiles: scanned,
    findings,
    notices,
    binaryFilesNeedingManualReview: binaryFiles,
    limitations:
      'Pattern scan only. Review images, archives, workflow logs, commit identities and release assets separately. Matched values are never printed.',
  }
  console.log(JSON.stringify(report, null, 2))
  if (findings.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch {
    console.error('Privacy check could not complete. Raw diagnostic values were suppressed.')
    process.exitCode = 2
  }
}
