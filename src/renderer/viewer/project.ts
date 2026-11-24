export type Size = { w: number; h: number }
/** An Audio file: `file` inside the Project folder, played from `start` (Project time) at `volume` 0..1. */
export type Audio = { file: string; start: number; volume: number }
export type Project = { name?: string; size: Size; fps: 30 | 60; scenes: string[]; audio: Audio[] }

/** The Design size at ?scale=k: each side rounded to an even number, as H.264 needs (ADR 0001). */
export const scaleSize = (size: Size, k: number): Size => ({ w: 2 * Math.round((size.w * k) / 2), h: 2 * Math.round((size.h * k) / 2) })

const even = (n: unknown) => Number.isInteger(n) && (n as number) > 0 && (n as number) % 2 === 0
// A path that could leave the Project folder; every file project.json names is served from inside it.
const outside = (f: string) => f.startsWith('/') || f.includes('\\') || f.split('/').includes('..')
const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** Validates a parsed project.json. Throws with a message fit to show the user. */
export function parseProject(json: any): Project {
  const { name, size, fps = 30, scenes, audio = [] } = json ?? {}
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) throw new Error('project.json: "name" must be non-empty text')
  if (!even(size?.w) || !even(size?.h)) throw new Error('project.json: size {w, h} must be positive even numbers')
  if (fps !== 30 && fps !== 60) throw new Error(`project.json: fps must be 30 or 60, got ${fps}`)
  if (!Array.isArray(scenes) || !scenes.length || !scenes.every((s) => typeof s === 'string' && s)) throw new Error('project.json: "scenes" must list at least one Scene file name')
  const bad = scenes.find(outside)
  if (bad) throw new Error(`project.json: Scene "${bad}" must be a file inside the Project folder`)
  if (!Array.isArray(audio)) throw new Error('project.json: "audio" must be a list of {file, start, volume}')
  return { name, size: { w: size.w, h: size.h }, fps, scenes, audio: audio.map(parseAudio) }
}

function parseAudio(a: any, i: number): Audio {
  const key = `project.json: audio[${i}]`
  if (typeof a !== 'object' || !a) throw new Error(`${key} must be {file, start, volume}`)
  const { file, start, volume = 1 } = a
  if (typeof file !== 'string' || !file) throw new Error(`${key}.file must name an Audio file`)
  if (outside(file)) throw new Error(`${key}.file "${file}" must be a file inside the Project folder`)
  if (!isNumber(start) || start < 0) throw new Error(`${key}.start must be seconds of Project time, 0 or more`)
  if (!isNumber(volume) || volume < 0 || volume > 1) throw new Error(`${key}.volume must be 0 to 1`)
  return { file, start, volume }
}
