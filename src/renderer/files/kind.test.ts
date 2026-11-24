import { describe, expect, it } from 'vitest'
import { fileKind } from './kind'

describe('fileKind', () => {
  it('names each file by its extension, any case', () => {
    expect(['click.WAV', 'a/b.mp3', 'logo.svg', 'bg.JPG', 'clip.mp4', 'Geist.woff2', 'data.json', 'README', 'x.wav.txt'].map(fileKind)).toEqual([
      'audio',
      'audio',
      'image',
      'image',
      'video',
      'font',
      'other',
      'other',
      'other',
    ])
  })
})
