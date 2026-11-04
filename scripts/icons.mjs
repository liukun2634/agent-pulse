import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PNG } from 'pngjs'
import pngToIco from 'png-to-ico'

const root = fileURLToPath(new URL('../', import.meta.url))
const image = PNG.sync.read(await readFile(path.join(root, 'public', 'pulse.png')))
const size = Math.max(image.width, image.height)
const square = new PNG({ width: size, height: size, fill: true })
PNG.bitblt(
  image,
  square,
  0,
  0,
  image.width,
  image.height,
  Math.floor((size - image.width) / 2),
  Math.floor((size - image.height) / 2),
)
await mkdir(path.join(root, '.artifacts'), { recursive: true })
const source = path.join(root, '.artifacts', 'pulse-icon-source.png')
await writeFile(source, PNG.sync.write(square))
const icon = await pngToIco(source)
await writeFile(path.join(root, 'public', 'pulse.ico'), icon)
console.log(`Generated Pulse ICO with ${icon.readUInt16LE(4)} sizes.`)
