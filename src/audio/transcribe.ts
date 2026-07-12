// transformers.js (Whisper) によるブラウザ内文字起こし
// モデルは初回のみHugging Faceからダウンロードされ、以降はブラウザにキャッシュされる

const MODEL_ID = 'onnx-community/whisper-base'
/** Whisperの入力サンプルレート */
const WHISPER_SR = 16000

export type ModelProgress = {
  status: 'downloading' | 'loading' | 'ready'
  /** 0-100 (downloading時のみ) */
  percent?: number
  file?: string
}

type AsrPipeline = (
  input: Float32Array,
  options: Record<string, unknown>,
) => Promise<{ text: string } | Array<{ text: string }>>

let asrPromise: Promise<AsrPipeline> | null = null

async function getAsr(onProgress?: (p: ModelProgress) => void): Promise<AsrPipeline> {
  if (!asrPromise) {
    asrPromise = (async () => {
      // 初期ロードを軽くするため動的import
      const { pipeline } = await import('@huggingface/transformers')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const progress_callback = (p: any) => {
        if (p.status === 'progress' && typeof p.progress === 'number') {
          onProgress?.({
            status: 'downloading',
            percent: Math.round(p.progress),
            file: String(p.file ?? ''),
          })
        }
      }
      onProgress?.({ status: 'loading' })
      let asr: unknown
      try {
        // WebGPUが使えれば高速に動く
        asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
          device: 'webgpu',
          progress_callback,
        })
      } catch {
        // WebGPU非対応環境はWASMにフォールバック
        asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
          progress_callback,
        })
      }
      onProgress?.({ status: 'ready' })
      return asr as AsrPipeline
    })()
    // 失敗したら次回リトライできるようにする
    asrPromise.catch(() => {
      asrPromise = null
    })
  }
  return asrPromise
}

/** 指定区間をモノラル16kHzのFloat32Arrayに変換する */
async function extractMono16k(
  buffer: AudioBuffer,
  start: number,
  end: number,
): Promise<Float32Array> {
  const { sampleRate, numberOfChannels } = buffer
  const startIdx = Math.max(0, Math.floor(start * sampleRate))
  const endIdx = Math.min(buffer.length, Math.ceil(end * sampleRate))
  const numFrames = Math.max(1, endIdx - startIdx)

  const slice = new AudioBuffer({
    length: numFrames,
    sampleRate,
    numberOfChannels,
  })
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = new Float32Array(numFrames)
    data.set(buffer.getChannelData(ch).subarray(startIdx, endIdx))
    slice.copyToChannel(data, ch)
  }

  const outLength = Math.ceil((numFrames / sampleRate) * WHISPER_SR)
  const offline = new OfflineAudioContext(1, outLength, WHISPER_SR)
  const source = offline.createBufferSource()
  source.buffer = slice
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

export async function transcribeSegment(
  buffer: AudioBuffer,
  start: number,
  end: number,
  language: string,
  onProgress?: (p: ModelProgress) => void,
): Promise<string> {
  const asr = await getAsr(onProgress)
  const samples = await extractMono16k(buffer, start, end)
  const output = await asr(samples, {
    language,
    task: 'transcribe',
    chunk_length_s: 30,
  })
  const text = Array.isArray(output) ? output[0]?.text : output.text
  return (text ?? '').trim()
}
