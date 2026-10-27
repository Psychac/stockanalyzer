// Generates simple PNG icons (no dependencies) for PWA installability.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

function crc32(buf) {
  let c, crc = ~0
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return ~crc >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const bars = [[0.23, 0.45, 0.65], [0.5, 0.35, 0.6], [0.72, 0.2, 0.5]] // x, top, bottom (fractions)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const i = y * (size * 4 + 1) + 1 + x * 4
      let r = 11, g = 15, b = 23
      for (const [bx, t, bt] of bars) {
        const hw = size * 0.055
        if (Math.abs(x - bx * size) < hw && y > t * size && y < bt * size + size * 0.2) {
          const k = (x + y) / (2 * size)
          r = 16 + k * 0; g = 185 - k * 20; b = 129 + k * 100
        }
      }
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
for (const s of [192, 512]) writeFileSync(new URL(`../public/icon-${s}.png`, import.meta.url), png(s))
