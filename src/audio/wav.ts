// AudioBufferの一部区間をフェード付きでWAV (PCM 16/24bit) にエンコードする

export interface WavSegmentOptions {
  /** 開始位置 (秒) */
  start: number
  /** 終了位置 (秒) */
  end: number
  fadeInMs: number
  fadeOutMs: number
  bitDepth: 16 | 24
}

export function encodeWavSegment(
  buffer: AudioBuffer,
  opts: WavSegmentOptions,
): ArrayBuffer {
  const { sampleRate, numberOfChannels } = buffer
  const startIdx = Math.max(0, Math.floor(opts.start * sampleRate))
  const endIdx = Math.min(buffer.length, Math.ceil(opts.end * sampleRate))
  const numFrames = Math.max(0, endIdx - startIdx)

  // 各チャンネルを切り出してフェードを適用
  const channels: Float32Array[] = []
  const fadeIn = Math.min(
    Math.round((opts.fadeInMs / 1000) * sampleRate),
    Math.floor(numFrames / 2),
  )
  const fadeOut = Math.min(
    Math.round((opts.fadeOutMs / 1000) * sampleRate),
    Math.floor(numFrames / 2),
  )
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch)
    const data = new Float32Array(numFrames)
    data.set(src.subarray(startIdx, endIdx))
    for (let i = 0; i < fadeIn; i++) data[i] *= i / fadeIn
    for (let i = 0; i < fadeOut; i++) {
      data[numFrames - 1 - i] *= i / fadeOut
    }
    channels.push(data)
  }

  const bytesPerSample = opts.bitDepth / 8
  const blockAlign = numberOfChannels * bytesPerSample
  const dataSize = numFrames * blockAlign
  const arrayBuffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(arrayBuffer)

  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numberOfChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, opts.bitDepth, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  if (opts.bitDepth === 16) {
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const v = Math.max(-1, Math.min(1, channels[ch][i]))
        view.setInt16(offset, Math.round(v * 32767), true)
        offset += 2
      }
    }
  } else {
    for (let i = 0; i < numFrames; i++) {
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const v = Math.max(-1, Math.min(1, channels[ch][i]))
        const intVal = Math.round(v * 8388607)
        view.setUint8(offset, intVal & 0xff)
        view.setUint8(offset + 1, (intVal >> 8) & 0xff)
        view.setUint8(offset + 2, (intVal >> 16) & 0xff)
        offset += 3
      }
    }
  }
  return arrayBuffer
}
