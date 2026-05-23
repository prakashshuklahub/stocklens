import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { brandIconSvg } from '../src/lib/brand-icon'

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = join(__dirname, '..', 'public')

const ICONS: Array<{ name: string; size: number; maskable: boolean }> = [
  { name: 'icon-192.png', size: 192, maskable: false },
  { name: 'icon-512.png', size: 512, maskable: false },
  { name: 'icon-512-maskable.png', size: 512, maskable: true },
]

async function main() {
  mkdirSync(publicDir, { recursive: true })

  for (const { name, size, maskable } of ICONS) {
    const svg = brandIconSvg(size, maskable)
    const png = await sharp(Buffer.from(svg)).png().toBuffer()
    writeFileSync(join(publicDir, name), png)
    console.log(`wrote public/${name}`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
