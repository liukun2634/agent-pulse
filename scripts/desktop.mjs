import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('../', import.meta.url))
const development = process.argv.includes('--dev')
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
let server

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

const child = spawn(electron, [root], { cwd: root, env: environment, stdio: 'inherit' })
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
