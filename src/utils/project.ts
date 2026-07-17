// 編集状況 (プロジェクト) ファイルの保存・読み込み
// 音声ファイル本体は含まず、同じ音声ファイルとセットで使う

export interface ProjectSettings {
  thresholdDb: number
  minSilenceMs: number
  minSegmentMs: number
  padStartMs: number
  padEndMs: number
  fadeInMs: number
  fadeOutMs: number
  bitDepth: 16 | 24
  language: string
  numberPrefix: boolean
}

export interface ProjectSegment {
  start: number
  end: number
  name: string
  nameEdited: boolean
}

export interface ProjectFile {
  app: 'voice-sample-editor'
  version: 1
  savedAt: string
  audio: { name: string; size: number }
  settings: ProjectSettings
  segments: ProjectSegment[]
}

export function serializeProject(
  audio: { name: string; size: number },
  settings: ProjectSettings,
  segments: ProjectSegment[],
): string {
  const project: ProjectFile = {
    app: 'voice-sample-editor',
    version: 1,
    savedAt: new Date().toISOString(),
    audio,
    settings,
    segments,
  }
  return JSON.stringify(project, null, 2)
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** JSONを検証してProjectFileとして返す。不正な内容ならErrorを投げる */
export function parseProject(text: string): ProjectFile {
  const obj = JSON.parse(text) as Partial<ProjectFile>
  if (obj.app !== 'voice-sample-editor') {
    throw new Error('このアプリの編集状況ファイルではありません')
  }
  if (obj.version !== 1) {
    throw new Error(`未対応のファイルバージョンです: ${String(obj.version)}`)
  }
  const audio = obj.audio
  if (!audio || typeof audio.name !== 'string' || !isFiniteNumber(audio.size)) {
    throw new Error('音声ファイル情報が壊れています')
  }
  const s = obj.settings
  if (
    !s ||
    !isFiniteNumber(s.thresholdDb) ||
    !isFiniteNumber(s.minSilenceMs) ||
    !isFiniteNumber(s.minSegmentMs) ||
    !isFiniteNumber(s.padStartMs) ||
    !isFiniteNumber(s.padEndMs) ||
    !isFiniteNumber(s.fadeInMs) ||
    !isFiniteNumber(s.fadeOutMs) ||
    (s.bitDepth !== 16 && s.bitDepth !== 24) ||
    typeof s.language !== 'string' ||
    typeof s.numberPrefix !== 'boolean'
  ) {
    throw new Error('設定情報が壊れています')
  }
  if (!Array.isArray(obj.segments)) {
    throw new Error('区間情報が壊れています')
  }
  const segments: ProjectSegment[] = obj.segments.map((seg) => {
    if (
      !seg ||
      !isFiniteNumber(seg.start) ||
      !isFiniteNumber(seg.end) ||
      typeof seg.name !== 'string' ||
      typeof seg.nameEdited !== 'boolean'
    ) {
      throw new Error('区間情報が壊れています')
    }
    return {
      start: seg.start,
      end: seg.end,
      name: seg.name,
      nameEdited: seg.nameEdited,
    }
  })
  return {
    app: 'voice-sample-editor',
    version: 1,
    savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : '',
    audio: { name: audio.name, size: audio.size },
    settings: s as ProjectSettings,
    segments,
  }
}
