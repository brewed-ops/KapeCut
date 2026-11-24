import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseProject } from './project'

describe('parseProject', () => {
  it('reads Design size, fps and Scenes', () => {
    expect(parseProject({ size: { w: 1080, h: 1920 }, fps: 30, scenes: ['scene-1.html'] })).toEqual({
      size: { w: 1080, h: 1920 },
      fps: 30,
      scenes: ['scene-1.html'],
      audio: [],
    })
  })

  it('defaults fps to 30', () => {
    expect(parseProject({ size: { w: 1080, h: 1920 }, scenes: ['a.html'] }).fps).toBe(30)
  })

  it('rejects an odd Design size', () => {
    expect(() => parseProject({ size: { w: 1081, h: 1920 }, scenes: ['a.html'] })).toThrow(/even/)
  })

  it('rejects fps other than 30 or 60', () => {
    expect(() => parseProject({ size: { w: 1080, h: 1920 }, fps: 24, scenes: ['a.html'] })).toThrow(/fps/)
  })

  it('rejects Scenes that are not file names', () => {
    expect(() => parseProject({ size: { w: 1080, h: 1920 }, scenes: [{ file: 'a.html' }] })).toThrow(/Scene/)
    expect(() => parseProject({ size: { w: 1080, h: 1920 }, scenes: [''] })).toThrow(/Scene/)
  })

  it('rejects Scenes outside the Project folder', () => {
    for (const bad of ['../index.html', '/index.html', 'a/../../x.html', 'a\\b.html'])
      expect(() => parseProject({ size: { w: 1080, h: 1920 }, scenes: [bad] }), bad).toThrow(/inside the Project/)
    expect(parseProject({ size: { w: 1080, h: 1920 }, scenes: ['scenes/intro.html'] }).scenes).toEqual(['scenes/intro.html'])
  })

  it('reads an optional name', () => {
    expect(parseProject({ name: 'Launch reel', size: { w: 1080, h: 1920 }, scenes: ['a.html'] }).name).toBe('Launch reel')
    expect(parseProject({ size: { w: 1080, h: 1920 }, scenes: ['a.html'] }).name).toBeUndefined()
    expect(() => parseProject({ name: 7, size: { w: 1080, h: 1920 }, scenes: ['a.html'] })).toThrow(/name/)
  })

  it('rejects a Project with no Scenes', () => {
    expect(() => parseProject({ size: { w: 1080, h: 1920 }, scenes: [] })).toThrow(/Scene/)
  })

  it('reads an optional audio list, start in Project time, volume defaulting to 1', () => {
    const audio = [{ file: 'music.mp3', start: 0 }, { file: 'sfx/hit.wav', start: 2.5, volume: 0.4 }]
    expect(parseProject({ size: { w: 1080, h: 1920 }, scenes: ['a.html'], audio }).audio).toEqual([
      { file: 'music.mp3', start: 0, volume: 1 },
      { file: 'sfx/hit.wav', start: 2.5, volume: 0.4 },
    ])
    expect(parseProject({ size: { w: 1080, h: 1920 }, scenes: ['a.html'] }).audio).toEqual([])
  })

  it('rejects invalid audio, naming the key', () => {
    const bad: [unknown, RegExp][] = [
      [{ file: 'a.mp3' }, /audio\[0\]\.start/],
      [{ file: 'a.mp3', start: -1 }, /audio\[0\]\.start/],
      [{ file: 'a.mp3', start: '1' }, /audio\[0\]\.start/],
      [{ file: 'a.mp3', start: 0, volume: 1.5 }, /audio\[0\]\.volume/],
      [{ file: 'a.mp3', start: 0, volume: -0.1 }, /audio\[0\]\.volume/],
      [{ file: 'a.mp3', start: 0, volume: Number.NaN }, /audio\[0\]\.volume/],
      [{ start: 0 }, /audio\[0\]\.file/],
      [{ file: '../a.mp3', start: 0 }, /audio\[0\]\.file.*inside the Project/],
      [{ file: 'C:\\a.mp3', start: 0 }, /audio\[0\]\.file.*inside the Project/],
      ['a.mp3', /audio\[0\]/],
    ]
    for (const [item, msg] of bad)
      expect(() => parseProject({ size: { w: 1080, h: 1920 }, scenes: ['a.html'], audio: [item] }), JSON.stringify(item)).toThrow(msg)
    expect(() => parseProject({ size: { w: 1080, h: 1920 }, scenes: ['a.html'], audio: 'a.mp3' })).toThrow(/"audio"/)
  })

  it('still accepts examples/hello unchanged', () => {
    const json = JSON.parse(readFileSync(resolve(__dirname, '../../../examples/hello/project.json'), 'utf8'))
    expect(parseProject(json)).toEqual({ size: { w: 1080, h: 1920 }, fps: 30, scenes: ['hello.html'], audio: [] })
  })
})
