# 0002 Encode H.264 inside the Electron renderer

Export draws each Frame with `renderAt(t)`, encodes it with WebCodecs `VideoEncoder` (H.264) in the renderer, and muxes to MP4 with mediabunny. ffmpeg only remuxes (faststart, BT.709 tags) and mixes the Audio files into one AAC track. Frames never leave the renderer as images.

Considered: screenshot every Frame (slow), pipe raw frames to ffmpeg libx264 over stdin (always works, slower). In-renderer encoding keeps Frames inside Chromium instead of copying each one out as an image, and Electron ships Chromium's H.264 support. The first ticket probes `VideoEncoder.isConfigSupported` for avc1 in Electron on Windows; if it fails, the ffmpeg pipe becomes the path and this ADR is superseded.

ffmpeg is not bundled: the user installs it and the app checks for it at start.
