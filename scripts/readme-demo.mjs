// The demo Project behind the README screenshot: a 3-Scene three.js product ad for the Lumen desk lamp, a sound effect,
// 3 Notes (one done) and the Claude handshake. scripts/readme-shot.mjs and scripts/demo-footage.mjs run it.
// Usage: node scripts/readme-demo.mjs <outDir>
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
const BRIEF = '# Lumen launch\n\n8 s vertical ad for a desk lamp launch. A real product reveal in 3D: dark room, warm light, bold type.\n'
mkdirSync(dir, { recursive: true })

// three.js as a classic script (skills/kapecut/SKILL.md), so TOTAL and renderAt exist at page load.
const three = readFileSync('node_modules/three/build/three.cjs', 'utf8')
writeFileSync(join(dir, 'three.js'), `(function(){var exports={};\n${three}\n;window.THREE=exports})()\n`)

// The stage every Scene shares: the lamp, the room, the light, and the type helpers. One global, Lumen.
const LUMEN = String.raw`(function () {
const T = window.THREE
const clamp = (x) => Math.min(1, Math.max(0, x))
const lerp = (a, b, x) => a + (b - a) * x
const out = (x) => 1 - (1 - x) ** 4
const inOut = (x) => (x < 0.5 ? 8 * x ** 4 : 1 - (-2 * x + 2) ** 4 / 2)
const back = (x) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2
const tw = (t, s, d, e = out) => e(clamp((t - s) / d))
const seeded = (s) => () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646
const INK = '#0d0b0a', CREAM = '#f6f2ea', AMBER = '#f0a726'
// Three warmths: 2700K, 4000K, 5000K.
const WARMTHS = ['#ffb46b', '#ffdcb5', '#f4f1ff'].map((c) => new T.Color(c))
const warmth = (w) => {
  const i = Math.min(1, Math.floor(w))
  return WARMTHS[i].clone().lerp(WARMTHS[i + 1], clamp(w - i))
}

function texture(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  draw(c.getContext('2d'), w, h)
  const tex = new T.CanvasTexture(c)
  tex.colorSpace = T.SRGBColorSpace
  return tex
}
// Walnut: long grain lines from a seeded random, so every load draws the same desk.
const walnut = () => texture(1024, 1024, (x, w, h) => {
  const r = seeded(7)
  x.fillStyle = '#4a2f1e'; x.fillRect(0, 0, w, h)
  for (let i = 0; i < 320; i++) {
    const y = r() * h, a = 0.08 + r() * 0.22
    x.strokeStyle = r() > 0.5 ? 'rgba(20,10,5,' + a + ')' : 'rgba(120,80,50,' + a * 0.6 + ')'
    x.lineWidth = 1 + r() * 4
    x.beginPath(); x.moveTo(0, y)
    for (let s = 0; s <= w; s += 32) x.lineTo(s, y + Math.sin(s / 140 + i) * 6 * r())
    x.stroke()
  }
})
const blob = () => texture(256, 256, (x, w) => {
  const gr = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
  gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.55, 'rgba(0,0,0,0.45)'); gr.addColorStop(1, 'rgba(0,0,0,0)')
  x.fillStyle = gr; x.fillRect(0, 0, w, w)
})
const mote = () => texture(64, 64, (x, w) => {
  const gr = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = gr; x.fillRect(0, 0, w, w)
})

// A soft room to reflect in the lamp's lacquer and brass: dark walls, a warm softbox overhead, strips behind and in
// front. The desk's envMapIntensity is low, so it stays dark outside the pool of light.
function environment(renderer) {
  const room = new T.Scene()
  room.add(new T.Mesh(new T.BoxGeometry(20, 20, 20), new T.MeshBasicMaterial({ color: 0x0a0908, side: T.BackSide })))
  const panel = (w, h, color, x, y, z, rx, ry) => {
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color, side: T.DoubleSide }))
    m.position.set(x, y, z); m.rotation.set(rx, ry, 0); room.add(m)
  }
  panel(8, 4, 0xffd9b0, 0, 9, 0, Math.PI / 2, 0)
  panel(2, 10, 0x9fb4c8, -9, 2, -4, 0, Math.PI / 2)
  panel(10, 1.2, 0xfff1e0, 4, 1, 9, 0, 0)
  return new T.PMREMGenerator(renderer).fromScene(room, 0.03).texture
}

const rod = (r, len, mat) => {
  const m = new T.Mesh(new T.CylinderGeometry(r, r, len, 24), mat)
  m.position.y = len / 2; m.castShadow = true
  return m
}
const hinge = (mat) => {
  const m = new T.Mesh(new T.CylinderGeometry(0.13, 0.13, 0.34, 32), mat)
  m.rotation.x = Math.PI / 2; m.castShadow = true
  return m
}

function start(c) {
  const W = c.width, H = c.height
  const query = new URLSearchParams(location.search)
  const scale = Number(query.get('scale')) > 0 ? Number(query.get('scale')) : 1
  c.width = 2 * Math.round((W * scale) / 2)
  c.height = 2 * Math.round((H * scale) / 2)
  const g = c.getContext('2d')
  g.scale(scale, scale)

  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(c.width, c.height, false)
  renderer.toneMapping = T.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = T.PCFSoftShadowMap
  const scene = new T.Scene()
  scene.background = new T.Color(INK)
  scene.fog = new T.Fog(INK, 22, 42)
  scene.environment = environment(renderer)
  scene.environmentIntensity = 1
  const camera = new T.PerspectiveCamera(24, W / H, 0.1, 100)

  // The desk, a notebook and a pencil in the pool of light, the lamp's soft contact shadow.
  const wood = walnut()
  wood.wrapS = wood.wrapT = T.RepeatWrapping; wood.repeat.set(3, 3); wood.anisotropy = 8
  const desk = new T.Mesh(new T.PlaneGeometry(60, 60), new T.MeshStandardMaterial({ map: wood, roughness: 0.7, metalness: 0, envMapIntensity: 0.04 }))
  desk.rotation.x = -Math.PI / 2; desk.receiveShadow = true
  scene.add(desk)
  const book = new T.Group()
  const cover = new T.Mesh(new T.BoxGeometry(1.45, 0.06, 2.0), new T.MeshStandardMaterial({ color: 0x1c2a33, roughness: 0.75, envMapIntensity: 0.2 }))
  const pages = new T.Mesh(new T.BoxGeometry(1.38, 0.04, 1.94), new T.MeshStandardMaterial({ color: 0xefe6d4, roughness: 0.9, envMapIntensity: 0.2 }))
  cover.position.y = 0.03; pages.position.set(0.03, 0.08, 0)
  for (const m of [cover, pages]) { m.castShadow = m.receiveShadow = true; book.add(m) }
  book.position.set(-1.75, 0, 0.55); book.rotation.y = -0.3
  scene.add(book)
  const pencil = new T.Mesh(new T.CylinderGeometry(0.028, 0.028, 1.3, 6), new T.MeshStandardMaterial({ color: 0xd9a53c, roughness: 0.5 }))
  pencil.rotation.set(Math.PI / 2, 0, 0.0); pencil.rotation.z = Math.PI / 2; pencil.position.set(-1.55, 0.13, 0.7)
  pencil.rotation.y = 0.45; pencil.castShadow = true
  scene.add(pencil)
  const contact = new T.Mesh(new T.PlaneGeometry(3.2, 3.2), new T.MeshBasicMaterial({ map: blob(), transparent: true, depthWrite: false }))
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.003
  scene.add(contact)

  // The lamp: weighted base, twin-rod arms on brass hinges, a conical head.
  // A rim only the lamp gets: its edges glow where they turn away from the camera. A real rim light floods the desk.
  const rimmed = (m) => ((m.onBeforeCompile = (s) => (s.fragmentShader = s.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight += vec3(1.0, 0.8, 0.6) * 0.4 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 4.0);\n#include <opaque_fragment>'))), m)
  const body = rimmed(new T.MeshPhysicalMaterial({ color: 0x1a1817, roughness: 0.32, metalness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.25, envMapIntensity: 3 }))
  const brass = rimmed(new T.MeshStandardMaterial({ color: 0xc8954a, roughness: 0.22, metalness: 1, envMapIntensity: 3 }))
  const lamp = new T.Group()
  scene.add(lamp)
  const base = new T.Mesh(new T.CylinderGeometry(0.92, 1.0, 0.16, 64), body)
  base.position.y = 0.08; base.castShadow = base.receiveShadow = true
  const ring = new T.Mesh(new T.TorusGeometry(0.92, 0.02, 12, 96), brass)
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.16
  const post = rod(0.09, 0.34, body); post.position.y += 0.16
  lamp.add(base, ring, post)
  const twin = (len) => {
    const arm = new T.Group()
    for (const z of [-0.075, 0.075]) { const r = rod(0.035, len, body); r.position.z = z; arm.add(r) }
    return arm
  }
  const shoulder = new T.Group(); shoulder.position.y = 0.5; shoulder.add(hinge(brass))
  const lower = twin(2.6); shoulder.add(lower)
  const elbow = new T.Group(); elbow.position.y = 2.6; elbow.add(hinge(brass))
  const upper = twin(2.3); elbow.add(upper)
  const wrist = new T.Group(); wrist.position.y = 2.3; wrist.add(hinge(brass))
  lower.add(elbow); upper.add(wrist); lamp.add(shoulder)
  shoulder.rotation.z = -0.28
  elbow.rotation.z = 2.03

  const head = new T.Group(); head.rotation.order = 'YZX'
  scene.add(head)
  const shade = new T.Mesh(new T.CylinderGeometry(0.26, 0.68, 1.0, 72, 1, true), body)
  shade.position.y = -0.62; shade.castShadow = true
  const inner = new T.Mesh(new T.CylinderGeometry(0.255, 0.675, 1.0, 72, 1, true), new T.MeshStandardMaterial({ color: 0x111111, emissive: 0xffffff, emissiveIntensity: 0, side: T.BackSide }))
  inner.position.y = -0.62
  const cap = new T.Mesh(new T.CylinderGeometry(0.16, 0.26, 0.16, 48), body); cap.position.y = -0.06
  const lip = new T.Mesh(new T.TorusGeometry(0.675, 0.022, 12, 96), brass); lip.rotation.x = Math.PI / 2; lip.position.y = -1.12
  const bulb = new T.Mesh(new T.SphereGeometry(0.2, 32, 16), new T.MeshBasicMaterial({ color: 0xffffff }))
  bulb.position.y = -0.5
  head.add(shade, inner, cap, lip, bulb)

  const spot = new T.SpotLight(0xffffff, 0, 0, 0.46, 0.5, 2)
  spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.0004; spot.shadow.radius = 6
  spot.position.y = -0.45; head.add(spot); head.add(spot.target); spot.target.position.y = -5
  // The light's spill on the wall behind, which separates the lamp from the dark.
  const wall = new T.Mesh(new T.PlaneGeometry(26, 14), new T.MeshBasicMaterial({ map: mote(), transparent: true, depthWrite: false, blending: T.AdditiveBlending, fog: false }))
  wall.position.set(-1, 3, -9); scene.add(wall)
  const fill = new T.HemisphereLight(0x2a3340, 0x120c08, 0.35); scene.add(fill)

  // The beam: an additive cone, bright at the bulb, soft at its edges.
  const BEAM = 3.4
  const beamMat = new T.ShaderMaterial({
    uniforms: { color: { value: new T.Color() }, power: { value: 0 } },
    vertexShader: 'varying float h; varying vec3 n; varying vec3 v; void main() { h = (position.y + ' + (BEAM / 2).toFixed(2) + ') / ' + BEAM.toFixed(2) + '; vec4 p = modelViewMatrix * vec4(position, 1.0); n = normalize(normalMatrix * normal); v = normalize(-p.xyz); gl_Position = projectionMatrix * p; }',
    fragmentShader: 'uniform vec3 color; uniform float power; varying float h; varying vec3 n; varying vec3 v; void main() { float edge = pow(abs(dot(n, v)), 1.3); float fall = pow(h, 1.6); gl_FragColor = vec4(color * power * edge * fall * 0.9, 1.0); }',
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
  })
  const beam = new T.Mesh(new T.ConeGeometry(BEAM * Math.tan(0.46), BEAM, 72, 1, true), beamMat)
  beam.position.y = -0.5 - BEAM / 2
  head.add(beam)

  // Dust: seeded motes that drift with t and glow only inside the beam.
  const N = 900, r = seeded(42)
  const seeds = Array.from({ length: N }, () => [lerp(-3.6, 0.6, r()), lerp(0.1, 2.8, r()), lerp(-2, 2, r()), r() * 6.28, lerp(0.4, 1.4, r())])
  const dustGeo = new T.BufferGeometry()
  dustGeo.setAttribute('position', new T.BufferAttribute(new Float32Array(N * 3), 3))
  dustGeo.setAttribute('color', new T.BufferAttribute(new Float32Array(N * 3), 3))
  const dust = new T.Points(dustGeo, new T.PointsMaterial({ size: 0.07, map: mote(), vertexColors: true, transparent: true, depthWrite: false, blending: T.AdditiveBlending }))
  scene.add(dust)

  const apex = new T.Vector3(), axis = new T.Vector3(), p = new T.Vector3(), bulbAt = new T.Vector3()
  // Draws the 3D stage for one Frame. s: { t, az, el, dist, target: [x, y, z], tilt, pan, power, warmth }.
  function stage(s) {
    const col = warmth(s.warmth)
    head.rotation.set(0, s.pan, s.tilt)
    wrist.getWorldPosition(head.position)
    spot.color.copy(col); spot.intensity = 70 * s.power
    inner.material.emissive.copy(col); inner.material.emissiveIntensity = 0.9 * s.power
    bulb.material.color.copy(col).multiplyScalar(0.25 + 3 * s.power)
    wall.material.color.copy(col).multiplyScalar(0.05 * s.power)
    beamMat.uniforms.color.value.copy(col); beamMat.uniforms.power.value = s.power
    contact.position.x = lamp.position.x
    const tg = new T.Vector3(...s.target)
    camera.fov = 24
    camera.position.set(tg.x + s.dist * Math.cos(s.el) * Math.sin(s.az), tg.y + s.dist * Math.sin(s.el), tg.z + s.dist * Math.cos(s.el) * Math.cos(s.az))
    camera.lookAt(tg); camera.updateProjectionMatrix()
    scene.updateMatrixWorld()
    bulb.getWorldPosition(apex)
    spot.target.getWorldPosition(axis); axis.sub(apex).normalize()
    const pos = dustGeo.attributes.position.array, cols = dustGeo.attributes.color.array
    for (let i = 0; i < N; i++) {
      const [x, y, z, ph, sp] = seeds[i]
      p.set(x + Math.sin(s.t * 0.35 * sp + ph) * 0.25, y + Math.sin(s.t * 0.22 * sp + ph * 2) * 0.18 - ((s.t * 0.05 * sp) % 0.6), z + Math.cos(s.t * 0.3 * sp + ph) * 0.25)
      pos.set([p.x, p.y, p.z], i * 3)
      const along = p.clone().sub(apex).dot(axis)
      const radial = p.clone().sub(apex).addScaledVector(axis, -along).length()
      const inside = along > 0 ? clamp((along * Math.tan(0.46) - radial) / (along * 0.25 + 0.05)) : 0
      const k = inside * s.power * (0.5 + 0.5 * Math.sin(s.t * 3 * sp + ph * 5)) * 1.4
      cols.set([col.r * k, col.g * k, col.b * k], i * 3)
    }
    dustGeo.attributes.position.needsUpdate = dustGeo.attributes.color.needsUpdate = true
    renderer.render(scene, camera)
    g.fillStyle = INK; g.fillRect(0, 0, W, H)
    g.drawImage(renderer.domElement, 0, 0, W, H)
    // Bloom around the bulb, where the camera can see into the shade.
    bulb.getWorldPosition(bulbAt).project(camera)
    const bx = (bulbAt.x + 1) / 2 * W, by = (1 - bulbAt.y) / 2 * H
    g.save(); g.globalCompositeOperation = 'lighter'
    const gl = g.createRadialGradient(bx, by, 0, bx, by, 260)
    gl.addColorStop(0, 'rgba(' + [col.r, col.g, col.b].map((x) => Math.round(255 * Math.min(1, x))).join(',') + ',' + 0.35 * s.power + ')'); gl.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gl; g.fillRect(bx - 260, by - 260, 520, 520)
    g.restore()
  }

  const font = (px, w = 900) => (g.font = w + ' ' + px + 'px "Segoe UI", "Helvetica Neue", Arial, sans-serif')
  // Type rises out of a mask under its own line: p 0 hidden, 1 set.
  function rise(text, x, y, px, p, color = CREAM, align = 'left') {
    if (p <= 0) return
    font(px); g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillStyle = color
    const w = g.measureText(text).width, left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
    g.save(); g.beginPath(); g.rect(left - 20, y - px * 1.05, w + 40, px * 1.3); g.clip()
    g.fillText(text, x, y + (1 - p) * px * 1.25)
    g.restore()
  }
  // Type slams down from big to set, with a short overshoot: p 0 hidden, 1 set.
  function slam(text, x, y, px, p, color = CREAM, align = 'left') {
    if (p <= 0) return
    const k = lerp(2.2, 1, back(clamp(p)))
    font(px); g.textAlign = align; g.textBaseline = 'alphabetic'; g.fillStyle = color
    g.save(); g.globalAlpha = clamp(p * 5); g.translate(x, y - px * 0.35); g.scale(k, k); g.fillText(text, 0, px * 0.35); g.restore()
  }
  function finish(t) {
    const v = g.createRadialGradient(W / 2, H * 0.55, H * 0.25, W / 2, H * 0.55, H * 0.75)
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)')
    g.fillStyle = v; g.fillRect(0, 0, W, H)
    g.globalAlpha = 0.045
    for (let i = 0; i < 900; i++) {
      const k = Math.sin(i * 12.9898 + Math.floor(t * 24) * 78.233) * 43758.5453
      g.fillStyle = i % 2 ? '#fff' : '#000'
      g.fillRect((k - Math.floor(k)) * W, (k * 7 - Math.floor(k * 7)) * H, 3, 3)
    }
    g.globalAlpha = 1
  }
  return { g, W, H, stage, rise, slam, finish, font }
}
window.Lumen = { start, tw, clamp, lerp, out, inOut, back, CREAM, AMBER, INK, warmth }
})()
`
writeFileSync(join(dir, 'lumen.js'), LUMEN)

const page = (total, body) => `<!doctype html>
<html><head><meta charset="UTF-8" /><title>Scene</title>
<style>html, body { margin: 0; background: #000; } canvas { display: block; }</style></head>
<body><canvas id="c" width="1080" height="1920"></canvas>
<script src="three.js"></script>
<script src="lumen.js?v=1"></script>
<script>
const L = Lumen.start(document.getElementById('c'))
const { tw, clamp, lerp, inOut, CREAM, AMBER } = Lumen
window.TOTAL = ${total}
window.ready = document.fonts.ready
${body}
if (new URLSearchParams(location.search).has('t')) window.ready.then(() => window.renderAt(Number(new URLSearchParams(location.search).get('t'))))
</script></body></html>
`

// 1. Hook: dark room, the head tilts down and the lamp switches on, the type slams in line by line.
const hook = page(2.6, `
window.renderAt = (t) => {
  const on = tw(t, 0.35, 0.12) * (t > 0.5 && t < 0.56 ? 0.35 : 1)
  const pull = inOut(clamp(t / 2.6))
  L.stage({ t, az: lerp(-0.35, -0.1, pull), el: lerp(0.05, 0.14, pull), dist: lerp(8, 18, pull), target: [lerp(-1.4, -0.6, pull), 2.4, 0], tilt: lerp(-1.25, -0.22, tw(t, 0, 0.9, inOut)), pan: 0, power: on, warmth: 0 })
  L.slam('WORK', 80, 380, 210, tw(t, 0.6, 0.32, (x) => x))
  L.slam('LATE,', 80, 590, 210, tw(t, 0.85, 0.32, (x) => x))
  L.slam('SEE.', 80, 800, 210, tw(t, 1.1, 0.32, (x) => x), AMBER)
  L.rise('LUMEN  ·  DESK LAMP', 86, 1720, 44, tw(t, 1.5, 0.5))
  L.g.fillStyle = CREAM; L.g.fillRect(86, 1760, 520 * tw(t, 1.6, 0.7), 5)
  L.finish(t)
}
`)

// 2. Product: the camera orbits as the beam sweeps the desk and the light moves through its three warmths.
const product = page(3, `
const SWEEP = 0.8 // seconds the beam takes to cross the desk
const WARM = ['2700K', '4000K', '5000K']
window.renderAt = (t) => {
  const w = tw(t, 0.9, 0.3, inOut) + tw(t, 1.9, 0.3, inOut)
  const s = inOut(clamp((t - 0.2) / SWEEP))
  L.stage({ t: t + 2.6, az: lerp(-0.7, 0.45, inOut(clamp(t / 3))), el: lerp(0.26, 0.16, inOut(clamp(t / 3))), dist: lerp(18, 16.5, inOut(clamp(t / 3))), target: [-0.6, 1.95, 0], tilt: lerp(-0.62, -0.22, s), pan: lerp(1.1, 0, s), power: 1, warmth: w })
  L.rise('Three', 80, 330, 170, tw(t, 0.15, 0.45))
  L.rise('warmths.', 80, 500, 170, tw(t, 0.3, 0.45), AMBER)
  L.rise('One touch. USB-C.', 86, 590, 50, tw(t, 0.55, 0.45))
  WARM.forEach((k, i) => {
    const x = 86 + i * 300, on = clamp(1 - Math.abs(w - i))
    L.rise(k, x, 1760, 56, tw(t, 0.4 + i * 0.1, 0.4), on > 0.5 ? CREAM : 'rgba(246,242,234,0.4)')
    L.g.fillStyle = AMBER; L.g.globalAlpha = on; L.g.fillRect(x, 1790, 190 * on, 6); L.g.globalAlpha = 1
  })
  L.finish(t)
}
`)

// 3. CTA: a slow push on the hero angle, the name, the price slams in, the button fills.
const cta = page(2.5, `
window.renderAt = (t) => {
  L.stage({ t: t + 5.6, az: lerp(0.25, 0.12, inOut(clamp(t / 2.5))), el: 0.22, dist: lerp(19, 17.5, inOut(clamp(t / 2.5))), target: [-0.6, 1.6, 0], tilt: -0.22, pan: 0, power: 1, warmth: 0 })
  L.rise('Lumen', 540, 330, 200, tw(t, 0.05, 0.5), CREAM, 'center')
  L.rise('Launch week only', 540, 420, 50, tw(t, 0.3, 0.5), 'rgba(246,242,234,0.75)', 'center')
  const p = tw(t, 0.55, 0.3, (x) => x)
  if (p > 0) {
    const k = lerp(2.2, 1, Lumen.back(p))
    L.g.save(); L.g.translate(540, 1530); L.g.rotate(-0.05); L.g.scale(k, k); L.g.globalAlpha = clamp(p * 5)
    L.g.fillStyle = AMBER; L.g.beginPath(); L.g.roundRect(-230, -110, 460, 220, 26); L.g.fill()
    L.font(170); L.g.textAlign = 'center'; L.g.textBaseline = 'middle'; L.g.fillStyle = Lumen.INK; L.g.fillText('$49', 0, 8)
    L.g.restore()
  }
  const f = tw(t, 1.1, 0.6)
  L.g.globalAlpha = tw(t, 0.95, 0.3)
  L.g.strokeStyle = CREAM; L.g.lineWidth = 5
  L.g.beginPath(); L.g.roundRect(240, 1700, 600, 120, 60); L.g.stroke()
  // The label is cream on the dark and ink on the fill as the fill passes under it.
  L.font(50, 800); L.g.textAlign = 'center'; L.g.textBaseline = 'middle'; L.g.fillStyle = CREAM
  L.g.fillText('PRE-ORDER', 540, 1762)
  if (f > 0) {
    L.g.save(); L.g.beginPath(); L.g.roundRect(240, 1700, lerp(120, 600, f), 120, 60); L.g.fillStyle = CREAM; L.g.fill(); L.g.clip()
    L.g.fillStyle = Lumen.INK; L.g.fillText('PRE-ORDER', 540, 1762); L.g.restore()
  }
  L.g.globalAlpha = 1
  L.finish(t)
}
`)

writeFileSync(join(dir, 'hook.html'), hook)
writeFileSync(join(dir, 'product.html'), product)
writeFileSync(join(dir, 'cta.html'), cta)
copyFileSync('examples/three-scenes/click.wav', join(dir, 'click.wav'))
writeFileSync(join(dir, 'project.json'), JSON.stringify({ name: 'Lumen Launch', size: { w: 1080, h: 1920 }, fps: 30, scenes: ['hook.html', 'product.html', 'cta.html'], audio: [{ file: 'click.wav', start: 0.35, volume: 1 }] }, null, 2))
writeFileSync(join(dir, 'brief.md'), BRIEF)
const T = '2026-11-24T10:00:00.000Z'
const note = (n, text, scene, sceneTime, time, done, point) => ({ n, text, done, scene, sceneTime, time, frame: Math.round(time * 30), point, created: T, updated: T })
writeFileSync(join(dir, 'notes.json'), JSON.stringify({ version: 1, next: 4, notes: [
  note(1, 'Make SEE amber, it is the punchline', 'hook.html', 1.5, 1.5, true, { x: 300, y: 720 }),
  note(2, 'The beam sweeps too fast, slow it down', 'product.html', 0.5, 3.1, false, { x: 330, y: 1250 }),
  note(3, 'Hold the price tag half a second longer', 'cta.html', 1.2, 6.8, false, { x: 540, y: 1530 }),
] }, null, 2))
mkdirSync(join(dir, '.kapecut'), { recursive: true })
writeFileSync(join(dir, '.kapecut', 'claude.json'), JSON.stringify({ version: 1, connected: new Date().toISOString() }))
console.log(dir)
