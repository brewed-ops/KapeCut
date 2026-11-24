// The UGC demo Project: a 9:16 talking-head edit for the Lumen desk lamp around a speaker clip, drawn through
// /kc-video.js (ADR 0007). Word-by-word captions with an amber highlight, punch-in zooms with kinetic type, a lower
// third. The clip is silent, so the captions are lines about the lamp. scripts/demo-footage.mjs runs it.
// Usage: node scripts/ugc-demo.mjs <outDir> <clip.mp4>   (a vertical 1080x1920 clip, at least 16 s long)
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [dir, clip] = process.argv.slice(2)
if (!dir || !clip) throw new Error('Usage: node scripts/ugc-demo.mjs <outDir> <clip.mp4>')
mkdirSync(dir, { recursive: true })
copyFileSync(clip, join(dir, 'speaker.mp4'))

// What every Scene shares: the speaker drawn full frame with a punch-in, the caption line, the kinetic word, the
// lower third. One global, Ugc.
const UGC = String.raw`(function () {
const clamp = (x) => Math.min(1, Math.max(0, x))
const lerp = (a, b, x) => a + (b - a) * x
const out = (x) => 1 - (1 - x) ** 4
const back = (x) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2
const tw = (t, s, d, e = out) => e(clamp((t - s) / d))
const INK = '#141110', CREAM = '#f6f2ea', AMBER = '#f0a726'
function start(c, file) {
  if (!c) throw new Error('no <canvas id="c">')
  const W = c.width, H = c.height
  const asked = Number(new URLSearchParams(location.search).get('scale')), scale = asked > 0 ? asked : 1
  c.width = 2 * Math.round((W * scale) / 2)
  c.height = 2 * Math.round((H * scale) / 2)
  const g = c.getContext('2d')
  g.scale(scale, scale)
  const speaker = kcVideo(file)
  const font = (px, w = 900) => (g.font = w + ' ' + px + 'px "Segoe UI", "Helvetica Neue", Arial, sans-serif')
  // The speaker covers the frame; zoom > 1 punches in around (fx, fy).
  async function draw(at, zoom, fx, fy) {
    const pic = await speaker.frameAt(at)
    const k = Math.max(W / speaker.width, H / speaker.height), w = speaker.width * k, h = speaker.height * k
    g.drawImage(pic, fx - (fx - (W - w) / 2) * zoom, fy - (fy - (H - h) / 2) * zoom, w * zoom, h * zoom)
    const v = g.createRadialGradient(W / 2, H * 0.45, H * 0.3, W / 2, H * 0.45, H * 0.8)
    v.addColorStop(0, 'rgba(20,17,16,0)'); v.addColorStop(1, 'rgba(20,17,16,0.6)')
    g.fillStyle = v; g.fillRect(0, 0, W, H)
  }
  // A punch: in over 0.22 s from s, hold, back out over 0.3 s at e.
  const punch = (t, s, e, to) => lerp(1, to, tw(t, s, 0.22) * (1 - tw(t, e, 0.3)))
  // Captions: lines of [word, time]. A line shows from its first word until the next line starts (or end), each word
  // popping in on its time, the word being said on an amber pill, the ones before it white.
  function captions(t, lines, y, end) {
    const i = lines.findLastIndex((l) => t >= l[0][1])
    if (i < 0 || t >= (lines[i + 1]?.[0][1] ?? end)) return
    font(84); g.textBaseline = 'middle'; g.textAlign = 'left'; g.lineJoin = 'round'
    const line = lines[i].map(([w, at]) => [w.toUpperCase(), at, g.measureText(w.toUpperCase()).width])
    const gap = 26, total = line.reduce((s, [, , w]) => s + w, 0) + gap * (line.length - 1)
    let x = (W - total) / 2
    line.forEach(([w, at, width], j) => {
      if (t >= at) {
        const k = lerp(1.25, 1, tw(t, at, 0.18, back)), now = t < (line[j + 1]?.[1] ?? Infinity)
        g.save(); g.translate(x + width / 2, y); g.scale(k, k)
        if (now) { g.fillStyle = AMBER; g.beginPath(); g.roundRect(-width / 2 - 16, -56, width + 32, 112, 22); g.fill() }
        else { g.strokeStyle = 'rgba(10,8,7,0.9)'; g.lineWidth = 14; g.strokeText(w, -width / 2, 4) }
        g.fillStyle = now ? INK : CREAM; g.fillText(w, -width / 2, 4)
        g.restore()
      }
      x += width + gap
    })
  }
  // A kinetic word: slams in huge from s with an overshoot, sits, and drops out at e.
  function kinetic(t, word, s, e, y, color = AMBER) {
    if (t < s || t > e + 0.2) return
    const k = lerp(2.4, 1, back(tw(t, s, 0.3, (x) => x))) * (1 - 0.15 * tw(t, e, 0.2)), a = 1 - tw(t, e, 0.2)
    font(230); g.textAlign = 'center'; g.textBaseline = 'middle'
    const fit = Math.min(1, (W - 140) / g.measureText(word).width)
    g.save(); g.globalAlpha = a; g.translate(W / 2, y); g.rotate(-0.04); g.scale(k * fit, k * fit)
    g.strokeStyle = INK; g.lineWidth = 22; g.lineJoin = 'round'; g.strokeText(word, 0, 0)
    g.fillStyle = color; g.fillText(word, 0, 0)
    g.restore()
  }
  // Lower third: an amber bar wipes in from the left, the name a beat later, out again at e.
  function lowerThird(t, title, sub, s, e, y) {
    const inn = tw(t, s, 0.45), gone = tw(t, e, 0.35)
    if (inn <= 0 || gone >= 1) return
    const w = 640 * inn * (1 - gone)
    g.fillStyle = 'rgba(20,17,16,0.88)'; g.fillRect(0, y, w + 60, 150)
    g.fillStyle = AMBER; g.fillRect(w + 60, y, 14, 150)
    g.save(); g.beginPath(); g.rect(0, y, w + 60, 150); g.clip()
    font(64); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = CREAM
    g.fillText(title, 60 - 80 * (1 - tw(t, s + 0.15, 0.4)), y + 78)
    font(36, 700); g.fillStyle = AMBER; g.fillText(sub, 60 - 80 * (1 - tw(t, s + 0.25, 0.4)), y + 124)
    g.restore()
  }
  function grain(t) {
    g.globalAlpha = 0.04
    for (let i = 0; i < 700; i++) {
      const k = Math.sin(i * 12.9898 + Math.floor(t * 24) * 78.233) * 43758.5453
      g.fillStyle = i % 2 ? '#fff' : '#000'
      g.fillRect((k - Math.floor(k)) * W, (k * 7 - Math.floor(k * 7)) * H, 3, 3)
    }
    g.globalAlpha = 1
  }
  return { g, speaker, draw, punch, captions, kinetic, lowerThird, grain, font }
}
window.Ugc = { start, tw, clamp, lerp, back, AMBER, CREAM, INK }
})()
`
writeFileSync(join(dir, 'ugc.js'), UGC)

const page = (total, body) => `<!doctype html>
<html><head><meta charset="UTF-8" /><title>Scene</title>
<style>html, body { margin: 0; background: #000; } canvas { display: block; }</style></head>
<body><canvas id="c" width="1080" height="1920"></canvas>
<script src="/kc-video.js"></script>
<script src="ugc.js?v=1"></script>
<script>
const U = Ugc.start(document.getElementById('c'), 'speaker.mp4')
const { g } = U
const query = new URLSearchParams(location.search)
window.TOTAL = ${total}
window.ready = Promise.all([document.fonts.ready, U.speaker.ready])
${body}
if (query.has('t')) window.ready.then(() => window.renderAt(Number(query.get('t'))))
</script></body></html>
`

// 1. Hook (clip 0 s on): the problem, a punch-in on HATED.
const hook = page(3.2, `
const CAP_Y = 1380
window.renderAt = async (t) => {
  await U.draw(t, U.punch(t, 1.7, 2.75, 1.3), 540, 470)
  U.kinetic(t, 'HATED', 1.75, 2.7, 1020)
  U.captions(t, [[['I', 0.15], ['work', 0.35], ['late.', 0.65]], [['My', 1.3], ['eyes', 1.5], ['hated', 1.75], ['it.', 2.1]]], CAP_Y, 3.2)
  U.grain(t)
}
`)

// 2. Pitch (clip 3.2 s on): the product, its lower third, a punch-in on the three warmths.
const pitch = page(3.4, `
const CAP_Y = 1380
window.renderAt = async (t) => {
  await U.draw(t + 3.2, U.punch(t, 1.7, 3.0, 1.25), 540, 430)
  U.kinetic(t, '3 WARMTHS', 1.75, 2.95, 1000)
  U.lowerThird(t, 'LUMEN', 'DESK LAMP  ·  3 WARMTHS', 0.3, 2.9, 1560)
  U.captions(t, [[['Then', 0.1], ['I', 0.3], ['found', 0.45], ['Lumen.', 0.75]], [['Three', 1.7], ['warmths,', 1.95]], [['one', 2.4], ['touch.', 2.6]]], CAP_Y, 3.4)
  U.grain(t)
}
`)

// 3. CTA (clip 12.2 s on, the close-up): the price and the ask.
const cta = page(3, `
const CAP_Y = 1000
window.renderAt = async (t) => {
  await U.draw(t + 12.2, U.punch(t, 0.2, 2.6, 1.12), 540, 860)
  const p = Ugc.tw(t, 0.25, 0.3, (x) => x)
  if (p > 0) {
    const k = Ugc.lerp(2.2, 1, Ugc.back(Ugc.clamp(p)))
    g.save(); g.translate(800, 330); g.rotate(0.08); g.scale(k, k)
    g.fillStyle = Ugc.AMBER; g.beginPath(); g.roundRect(-170, -90, 340, 180, 28); g.fill()
    U.font(130); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = Ugc.INK; g.fillText('$49', 0, 6)
    g.restore()
  }
  U.captions(t, [[['$49', 0.2], ['pre-order', 0.5]], [['Link', 1.4], ['in', 1.6], ['bio.', 1.8]]], CAP_Y, 3)
  U.grain(t)
}
`)

writeFileSync(join(dir, 'hook.html'), hook)
writeFileSync(join(dir, 'pitch.html'), pitch)
writeFileSync(join(dir, 'cta.html'), cta)
writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Lumen UGC', size: { w: 1080, h: 1920 }, fps: 30, scenes: ['hook.html', 'pitch.html', 'cta.html'] }, null, 2))
writeFileSync(join(dir, 'brief.md'), '# Lumen UGC\n\n10 s vertical talking-head ad for the Lumen desk lamp around speaker.mp4. Word-by-word captions, punch-ins, a lower third. $49 pre-order.\n')
console.log(dir)
