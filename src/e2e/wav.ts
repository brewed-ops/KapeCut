// A mono 16-bit WAV of `seconds` of a 440 Hz sine at 8 kHz.
export function wav(seconds: number) {
  const rate = 8000
  const n = rate * seconds
  const b = Buffer.alloc(44 + n * 2)
  b.write('RIFF', 0), b.writeUInt32LE(36 + n * 2, 4), b.write('WAVEfmt ', 8), b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20), b.writeUInt16LE(1, 22), b.writeUInt32LE(rate, 24), b.writeUInt32LE(rate * 2, 28)
  b.writeUInt16LE(2, 32), b.writeUInt16LE(16, 34), b.write('data', 36), b.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 20000), 44 + i * 2)
  return b
}
