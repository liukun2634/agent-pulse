import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { runTests } from '@vscode/test-electron'

const root = process.cwd()
const executable =
  process.env.PULSE_VSCODE_EXECUTABLE ||
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'Code.exe')
if (!fs.existsSync(executable))
  throw new Error(
    'Set PULSE_VSCODE_EXECUTABLE to an installed VS Code 1.141.x or 1.143.x executable.',
  )
const temporary = fs.mkdtempSync(path.join(tmpdir(), 'pulse-vscode-smoke-'))
const workspace = path.join(temporary, 'workspace')
fs.mkdirSync(workspace)
fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true })
try {
  await runTests({
    vscodeExecutablePath: executable,
    extensionDevelopmentPath:
      process.env.PULSE_SESSION_BRIDGE_EXTENSION_PATH || path.join(root, 'vscode-session-bridge'),
    extensionTestsPath: path.join(root, 'tests', 'vscode-bridge.smoke.cjs'),
    extensionTestsEnv: {
      PULSE_SESSION_BRIDGE_TEST_REGISTRY: path.join(temporary, 'registry'),
      PULSE_SESSION_BRIDGE_TEST_OUTPUT: path.join(root, '.artifacts', 'vscode-bridge-smoke.json'),
    },
    launchArgs: [
      workspace,
      '--user-data-dir',
      path.join(temporary, 'profile'),
      '--extensions-dir',
      path.join(temporary, 'extensions'),
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
    ],
  })
} finally {
  fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
