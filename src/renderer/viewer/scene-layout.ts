import { crossedApart, sceneIndex, type Note, type Range } from '../notes/notes'
import { projectTime, timeIn } from './project-time'

// A broken Scene keeps its last good length, so later Scenes do not move. shortcut: one that never opened holds 1 s so its
// error shows in place; revisit if the Timeline needs to mark that length as unknown.
export const BROKEN_LENGTH = 1

/** A Scene as the viewer knows it: its length once it opened (`total`), or why it failed. */
export type SceneState = { file: string; total?: number; error?: string }

/** Where each Scene sits in Project time, given the lengths the Scenes report (project.json order). */
export function sceneLayout(reported: SceneState[], fps: number) {
  const scenes = reported.map(({ file, total, error }) => ({ file, total, error })) // a copy: the layout never changes under its reader
  const lens = scenes.map((s) => s.total ?? (s.error ? BROKEN_LENGTH : 0))
  const pt = projectTime(lens, fps)
  const order = scenes.map((s) => s.file)
  const settled = scenes.every((s) => s.total !== undefined || !!s.error)
  return {
    duration: pt.duration,
    frames: pt.frames,
    frameAt: pt.frameAt,
    sceneStart: pt.sceneStart,
    sceneEnd: pt.sceneEnd,
    /** Every Scene opened or failed. */
    settled,
    /** The Scene showing at Project time t (clamped to the video), and the Scene time in it. */
    locate(t: number) {
      const { scene, sceneTime } = pt.locate(t)
      return { scene, file: order[scene], sceneTime }
    },
    /** One row per Scene, in order: where it sits and the length it holds. */
    rows: () => scenes.map(({ file, error }, i) => ({ file, start: pt.sceneStart(i), end: pt.sceneEnd(i), len: lens[i], error })),
    /**
     * The Scenes Project time span r covers, in order. Only Scenes with Frames: one with none (loading, TOTAL 0) was
     * never on screen, so its leaving splits nothing.
     */
    scenesIn: (r: Range) =>
      order
        .map((file, i) => [file, i] as const)
        .slice(pt.locate(r.start).scene, pt.locate(r.end - 1 / fps).scene + 1)
        .filter(([, i]) => pt.sceneEnd(i) > pt.sceneStart(i))
        .map(([file]) => file),
    /** A Note's Project time in today's Scene order (a span's start); NaN when its Scene is no longer in the Project. */
    noteTime: (note: Pick<Note, 'scene' | 'scenes' | 'sceneTime'>) => timeIn(sceneIndex(note, order), note.sceneTime, pt),
    /**
     * Why the Note cannot be fixed where it points ('' when it can): its Scene is gone, it is now past its Scene's end, or
     * (a span, `span` being where it is today) the Scenes it crossed are no longer neighbours or it runs past the Project end.
     */
    flag(note: Pick<Note, 'scene' | 'scenes' | 'sceneTime'>, span?: Range) {
      const i = sceneIndex(note, order)
      if (i < 0) return 'Scene not in the Project'
      if (crossedApart(note, order)) return 'Scenes around this span changed'
      // Only a Scene that opened has a length to be past; a broken or still loading one flags nothing.
      const opened = !scenes[i].error && scenes[i].total !== undefined
      if (opened && pt.frameAt(pt.sceneStart(i) + note.sceneTime) >= pt.frameAt(pt.sceneEnd(i))) return 'past its Scene end'
      if (!span) return ''
      // A span is past the end once it runs beyond the last Frame. Only judged once settled, so a Project still loading
      // never flags one.
      return settled && pt.frameAt(span.end) > pt.frames ? 'past the Project end' : ''
    },
  }
}

export type SceneLayout = ReturnType<typeof sceneLayout>
