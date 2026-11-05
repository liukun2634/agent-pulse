import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('../', import.meta.url))
const development = process.argv.includes('--dev')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
let server

async function desktopExecutable() {
  if (process.platform !== 'win32') return electron
  const require = createRequire(import.meta.url)
  const electronVersion = require('electron/package.json').version
  const metadata = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const iconPath = path.join(root, 'public', 'pulse.ico')
  const digest = createHash('sha256')
    .update(await readFile(iconPath))
    .update(`${electronVersion}:${metadata.version}:${metadata.build.productName}:1`)
    .digest('hex')
    .slice(0, 12)
  const runtime = path.join(root, '.artifacts', 'desktop-runtime', `${electronVersion}-${digest}`)
  const executable = path.join(runtime, 'Agent Pulse.exe')
  const ready = path.join(runtime, 'ready.json')
  if (existsSync(ready) && existsSync(executable)) return executable
  await rm(runtime, { recursive: true, force: true })
  await mkdir(runtime, { recursive: true })
  await cp(path.dirname(electron), runtime, { recursive: true })
  await rename(path.join(runtime, 'electron.exe'), executable)
  const { editWindowsResources } = await import('app-builder-lib/out/util/resEdit.js')
  await editWindowsResources({
    file: executable,
    iconPath,
    versionStrings: {
      ProductName: metadata.build.productName,
      FileDescription: metadata.build.productName,
      InternalName: 'Agent Pulse',
      OriginalFilename: 'Agent Pulse.exe',
    },
    fileVersion: metadata.version,
    productVersion: metadata.version,
  })
  await writeFile(ready, JSON.stringify({ electronVersion, digest }))
  return executable
}

const executable = await desktopExecutable()
if (process.argv.includes('--prepare-runtime')) {
  console.log(executable)
  process.exit(0)
}

if (development) {
  const { createServer } = await import('vite')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 5173 } })
  await server.listen()
  environment.PULSE_DEV_SERVER_URL = server.resolvedUrls.local[0]
  console.log(`Pulse desktop: ${environment.PULSE_DEV_SERVER_URL}`)
} else if (!existsSync(new URL('../dist/index.html', import.meta.url))) {
  console.error('Build the interface first: npm run build')
  process.exit(1)
} else delete environment.PULSE_DEV_SERVER_URL

const child = spawn(executable, [root], { cwd: root, env: environment, stdio: 'inherit' })
child.on('error', async (error) => {
  console.error(error.message)
  await server?.close()
  process.exitCode = 1
})
child.on('exit', async (code) => {
  await server?.close()
  process.exitCode = code ?? 0
})
process.on('SIGINT', () => child.kill())
process.on('SIGTERM', () => child.kill())
