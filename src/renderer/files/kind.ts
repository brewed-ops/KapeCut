/** Files lists at most this many; a bigger Project folder says so. */
export const MAX_LISTED = 2000

export type Kind = 'audio' | 'image' | 'video' | 'font' | 'other'

const KINDS: [Kind, RegExp][] = [
  ['audio', /\.(wav|mp3|ogg|oga|m4a|flac|aac|opus)$/i],
  ['image', /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico)$/i],
  ['video', /\.(mp4|webm|mov|m4v|mkv|avi)$/i],
  ['font', /\.(woff2?|ttf|otf)$/i],
]

/** What a file in the Project is, by its extension: the label the Files panel shows. Only audio goes on the Timeline. */
export const fileKind = (file: string): Kind => KINDS.find(([, ext]) => ext.test(file))?.[0] ?? 'other'
