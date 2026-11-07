import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  Activity,
  Archive,
  ArrowUpRight,
  BellRing,
  Code2,
  Download,
  FileDown,
  GitBranch,
  Monitor,
  ShieldCheck,
} from 'lucide-react'

const root = fileURLToPath(new URL('../', import.meta.url))
const output = path.join(root, '.artifacts', 'site')
const icons = {
  activity: Activity,
  archive: Archive,
  arrow: ArrowUpRight,
  bell: BellRing,
  code: Code2,
  download: Download,
  file: FileDown,
  github: GitBranch,
  monitor: Monitor,
  shield: ShieldCheck,
}
await rm(output, { recursive: true, force: true })
await mkdir(path.join(output, 'assets'), { recursive: true })
for (const filename of [
  'index.html',
  'download.html',
  'styles.css',
  'releases.js',
  'assets/workspace.png',
  'assets/mini.png',
])
  await cp(path.join(root, 'site', filename), path.join(output, filename))
for (const filename of ['workspace.png', 'mini.png'])
  await access(path.join(output, 'assets', filename))
for (const filename of ['index.html', 'download.html']) {
  const html = await readFile(path.join(output, filename), 'utf8')
  const rendered = html.replace(/\{\{icon:(\w+)\}\}/g, (_token, name) => {
    if (!icons[name]) throw new Error(`Unknown icon: ${name}`)
    return renderToStaticMarkup(createElement(icons[name], { size: 18, 'aria-hidden': true }))
  })
  await writeFile(path.join(output, filename), rendered)
}
await cp(path.join(root, 'public', 'pulse.png'), path.join(output, 'assets', 'pulse.png'))
for (const [source, target] of [
  ['@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2', 'dm-sans-400.woff2'],
  ['@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff2', 'dm-sans-600.woff2'],
  ['@fontsource/manrope/files/manrope-latin-700-normal.woff2', 'manrope-700.woff2'],
  ['@fontsource/dm-sans/LICENSE', 'dm-sans-LICENSE.txt'],
  ['@fontsource/manrope/LICENSE', 'manrope-LICENSE.txt'],
])
  await cp(path.join(root, 'node_modules', source), path.join(output, 'assets', target))
console.log('Built project site: .artifacts/site')
