// 無音区間の検出: RMSベースで「音のある区間」を切り出す

export interface SilenceParams {
  /** これより小さい音量を無音とみなす (dBFS, 例: -40) */
  thresholdDb: number
  /** この長さ以上続く無音を「素材の区切り」とみなす (ms) */
  minSilenceMs: number
  /** これより短い区間はノイズとして無視する (ms) */
  minSegmentMs: number
  /** 検出区間の前に付ける余白 (ms) */
  padStartMs: number
  /** 検出区間の後に付ける余白 (ms) */
  padEndMs: number
}

export interface DetectedSegment {
  /** 開始位置 (秒) */
  start: number
  /** 終了位置 (秒) */
  end: number
}

/** RMS計算の窓幅 (ms) */
const WINDOW_MS = 10

export function detectSegments(
  buffer: AudioBuffer,
  params: SilenceParams,
): DetectedSegment[] {
  const { sampleRate, length, numberOfChannels } = buffer
  const win = Math.max(1, Math.round((WINDOW_MS / 1000) * sampleRate))
  const numWindows = Math.ceil(length / win)
  const threshold = Math.pow(10, params.thresholdDb / 20)

  // 窓ごとのRMSを全チャンネルの最大値で評価し、しきい値超えを記録
  const loud = new Array<boolean>(numWindows).fill(false)
  for (let ch = 0; ch < numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let w = 0; w < numWindows; w++) {
      if (loud[w]) continue
      const startIdx = w * win
      const endIdx = Math.min(startIdx + win, length)
      let sum = 0
      for (let i = startIdx; i < endIdx; i++) sum += data[i] * data[i]
      if (Math.sqrt(sum / (endIdx - startIdx)) >= threshold) loud[w] = true
    }
  }

  // 音のある窓の連続を区間としてまとめる
  const raw: Array<{ startW: number; endW: number }> = []
  let runStart = -1
  for (let w = 0; w < numWindows; w++) {
    if (loud[w]) {
      if (runStart < 0) runStart = w
    } else if (runStart >= 0) {
      raw.push({ startW: runStart, endW: w })
      runStart = -1
    }
  }
  if (runStart >= 0) raw.push({ startW: runStart, endW: numWindows })

  // minSilenceMs より短い無音で隔てられた区間は同一素材として結合
  const gapWindows = Math.round(params.minSilenceMs / WINDOW_MS)
  const merged: Array<{ startW: number; endW: number }> = []
  for (const seg of raw) {
    const last = merged[merged.length - 1]
    if (last && seg.startW - last.endW < gapWindows) {
      last.endW = seg.endW
    } else {
      merged.push({ ...seg })
    }
  }

  // minSegmentMs 未満の区間を除去し、秒に変換してパディングを付ける
  const minSegWindows = Math.round(params.minSegmentMs / WINDOW_MS)
  const winSec = win / sampleRate
  const padStartSec = params.padStartMs / 1000
  const padEndSec = params.padEndMs / 1000
  const durationSec = length / sampleRate

  const result: DetectedSegment[] = []
  const kept = merged.filter((s) => s.endW - s.startW >= minSegWindows)
  for (let i = 0; i < kept.length; i++) {
    const seg = kept[i]
    let start = seg.startW * winSec - padStartSec
    let end = seg.endW * winSec + padEndSec
    // パディングが隣の区間に食い込まないよう、間の中点まででクランプ
    if (i > 0) {
      const prevEnd = kept[i - 1].endW * winSec
      start = Math.max(start, (prevEnd + seg.startW * winSec) / 2)
    }
    if (i < kept.length - 1) {
      const nextStart = kept[i + 1].startW * winSec
      end = Math.min(end, (seg.endW * winSec + nextStart) / 2)
    }
    result.push({
      start: Math.max(0, start),
      end: Math.min(durationSec, end),
    })
  }
  return result
}
