// The demo Project behind the README screenshot: 3 motion-design Scenes, a sound effect, 3 Notes (one done) and the
// Claude handshake. scripts/readme-shot.mjs runs it. Usage: node scripts/readme-demo.mjs <outDir>
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
mkdirSync(dir, { recursive: true })

const page = (total, draw) => `<!doctype html>
<html><head><meta charset="UTF-8" /><title>Scene</title>
<style>html, body { margin: 0; background: #000; } canvas { display: block; }</style></head>
<body><canvas id="c" width="1080" height="1920"></canvas>
<script>
const c = document.getElementById('c')
const W = c.width, H = c.height
const query = new URLSearchParams(location.search)
const scale = Number(query.get('scale')) > 0 ? Number(query.get('scale')) : 1
c.width = 2 * Math.round((W * scale) / 2)
c.height = 2 * Math.round((H * scale) / 2)
const g = c.getContext('2d')
g.scale(scale, scale)
window.TOTAL = ${total}
window.ready = document.fonts.ready
const clamp = (x) => Math.min(1, Math.max(0, x))
const ease = (x) => 1 - (1 - x) ** 4
const tw = (t, s, d) => ease(clamp((t - s) / d))
const INK = '#141110', CREAM = '#f6f2ea', AMBER = '#f0a726', DEEP = '#c4421b'
const font = (w, px) => (g.font = w + ' ' + px + 'px "Segoe UI", "Helvetica Neue", Arial, sans-serif')
const grain = (t) => {
  g.globalAlpha = 0.05
  for (let i = 0; i < 900; i++) {
    const k = Math.sin(i * 12.9898 + Math.floor(t * 24) * 78.233) * 43758.5453
    g.fillStyle = i % 2 ? '#fff' : '#000'
    g.fillRect((k - Math.floor(k)) * W, ((k * 7) - Math.floor(k * 7)) * H, 3, 3)
  }
  g.globalAlpha = 1
}
window.renderAt = (t) => {
  g.globalAlpha = 1
  g.fillStyle = INK
  g.fillRect(0, 0, W, H)
${draw}
  grain(t)
}
if (query.has('t')) window.ready.then(() => window.renderAt(Number(query.get('t'))))
</script></body></html>
`

// 1. Hook: three words slam in, an amber disc sweeps behind them.
const hook = page(2.5, `
  const r = 620 * tw(t, 0, 0.9)
  g.fillStyle = AMBER
  g.beginPath(); g.arc(W * 0.72, H * 0.34, r, 0, Math.PI * 2); g.fill()
  g.fillStyle = DEEP
  g.beginPath(); g.arc(W * 0.72, H * 0.34, r * 0.42, 0, Math.PI * 2); g.fill()
  font(900, 230)
  g.textAlign = 'left'; g.textBaseline = 'alphabetic'
  ;['FRESH', 'ROAST', 'DAILY.'].forEach((w, i) => {
    const p = tw(t, 0.25 + i * 0.22, 0.5)
    g.globalAlpha = p
    g.fillStyle = i === 2 ? AMBER : CREAM
    g.fillText(w, 90 - (1 - p) * 160, 1080 + i * 230)
  })
  g.globalAlpha = 1
  g.fillStyle = CREAM
  g.fillRect(90, 1640, 900 * tw(t, 1.1, 0.8), 10)
  font(700, 44)
  g.globalAlpha = tw(t, 1.3, 0.5)
  g.fillText('KOPI SENJA  ·  SMALL BATCH', 90, 1730)
`)

// 2. Product: a cup built from shapes, steam drawn as sine strokes.
const product = page(3, `
  const up = tw(t, 0, 0.8)
  const cx = W / 2, cy = 1020 + (1 - up) * 300
  g.globalAlpha = up
  g.fillStyle = '#231d19'
  g.beginPath(); g.ellipse(cx, cy + 330, 380, 60, 0, 0, Math.PI * 2); g.fill()
  g.fillStyle = CREAM
  g.beginPath(); g.moveTo(cx - 300, cy - 200); g.lineTo(cx + 300, cy - 200); g.lineTo(cx + 240, cy + 300); g.lineTo(cx - 240, cy + 300); g.closePath(); g.fill()
  g.lineWidth = 46; g.strokeStyle = CREAM
  g.beginPath(); g.arc(cx + 320, cy + 20, 110, -Math.PI / 2, Math.PI / 2); g.stroke()
  g.fillStyle = AMBER
  g.fillRect(cx - 300, cy - 60, 600, 90)
  g.lineWidth = 16; g.lineCap = 'round'; g.strokeStyle = CREAM
  for (let k = -1; k <= 1; k++) {
    g.globalAlpha = 0.8 * tw(t, 0.6 + (k + 1) * 0.15, 0.6)
    g.beginPath()
    for (let y = 0; y < 200; y += 6) g.lineTo(cx + k * 130 + Math.sin(y / 40 - t * 4 + k) * 26, cy - 250 - y)
    g.stroke()
  }
  g.globalAlpha = tw(t, 0.9, 0.6)
  font(900, 150); g.textAlign = 'center'; g.fillStyle = CREAM
  g.fillText('Kopi Senja', cx, 380)
  font(600, 52); g.fillStyle = AMBER
  g.fillText('Palm sugar · oat milk · single origin', cx, 470)
`)

// 3. CTA: price tag pops, button fills.
const cta = page(2.5, `
  const p = tw(t, 0, 0.6)
  g.textAlign = 'center'
  font(800, 70); g.fillStyle = CREAM; g.globalAlpha = p
  g.fillText('This weekend only', W / 2, 760)
  g.save(); g.translate(W / 2, 1000); g.rotate(-0.06); g.scale(0.6 + 0.4 * tw(t, 0.3, 0.5), 0.6 + 0.4 * tw(t, 0.3, 0.5))
  g.globalAlpha = tw(t, 0.3, 0.3)
  g.fillStyle = AMBER; g.fillRect(-330, -150, 660, 300)
  font(900, 210); g.fillStyle = INK; g.textBaseline = 'middle'
  g.fillText('₱99', 0, 10)
  g.restore()
  g.globalAlpha = tw(t, 0.8, 0.4)
  g.strokeStyle = CREAM; g.lineWidth = 6
  g.beginPath(); g.roundRect(190, 1300, 700, 150, 75); g.stroke()
  g.save(); g.beginPath(); g.roundRect(190, 1300, 700 * tw(t, 1.0, 0.9), 150, 75); g.clip()
  g.fillStyle = CREAM; g.fillRect(190, 1300, 700, 150); g.restore()
  font(800, 60); g.textBaseline = 'middle'; g.fillStyle = tw(t, 1.0, 0.9) > 0.5 ? INK : CREAM
  g.fillText('ORDER NOW', W / 2, 1377)
`)

writeFileSync(join(dir, 'hook.html'), hook)
writeFileSync(join(dir, 'product.html'), product)
writeFileSync(join(dir, 'cta.html'), cta)
copyFileSync('examples/three-scenes/click.wav', join(dir, 'click.wav'))
writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Kopi Senja Promo', size: { w: 1080, h: 1920 }, fps: 30, scenes: ['hook.html', 'product.html', 'cta.html'], audio: [{ file: 'click.wav', start: 0, volume: 1 }] }, null, 2))
writeFileSync(join(dir, 'brief.md'), '# Kopi Senja promo\n\n8 s vertical ad for a weekend coffee deal. Warm, bold type.\n')
const T = '2026-11-24T10:00:00.000Z'
const note = (n, text, scene, sceneTime, time, done, point) => ({ n, text, done, scene, sceneTime, time, frame: Math.round(time * 30), point, created: T, updated: T })
writeFileSync(join(dir, 'notes.json'), JSON.stringify({ version: 1, next: 4, notes: [
  note(1, 'Make DAILY amber, it is the punchline', 'hook.html', 1.5, 1.5, true, { x: 300, y: 1500 }),
  note(2, 'Steam rises too fast, slow it down', 'product.html', 1.6, 4.1, false, { x: 540, y: 620 }),
  note(3, 'Hold the price tag half a second longer', 'cta.html', 1.2, 6.7, false, { x: 540, y: 1000 }),
] }, null, 2))
mkdirSync(join(dir, '.kapecut'), { recursive: true })
writeFileSync(join(dir, '.kapecut', 'claude.json'), JSON.stringify({ version: 1, connected: new Date().toISOString() }))
console.log(dir)
