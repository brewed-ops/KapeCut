type Check = (config: VideoEncoderConfig) => Promise<{ supported?: boolean }>

/** ADR 0002 hinges on this: can WebCodecs encode H.264 at 1080x1920 here? */
export async function probeH264(check: Check = (c) => VideoEncoder.isConfigSupported(c)) {
  const base = { codec: 'avc1.640028', width: 1080, height: 1920, bitrate: 8_000_000, framerate: 30 }
  const ok = async (hardwareAcceleration: HardwareAcceleration) => {
    try {
      return !!(await check({ ...base, hardwareAcceleration })).supported
    } catch {
      return false
    }
  }
  return { hardware: await ok('prefer-hardware'), software: await ok('prefer-software') }
}
