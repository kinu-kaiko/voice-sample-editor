import { useCallback, useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin, {
  type Region,
} from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { detectSegments, type SilenceParams } from './audio/silence'
import { encodeWavSegment } from './audio/wav'
import { transcribeSegment, type ModelProgress } from './audio/transcribe'
import { sanitizeFilename } from './utils/filename'
import './App.css'

interface SegmentItem {
  id: string
  start: number
  end: number
  /** ファイル名 (ユーザー編集 or 文字起こし結果) */
  name: string
  /** ユーザーが手入力した場合true (文字起こしで上書きしない) */
  nameEdited: boolean
  status: 'idle' | 'transcribing' | 'done' | 'error'
}

const REGION_COLOR = 'rgba(56, 189, 248, 0.18)'

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec - m * 60
  return `${m}:${s.toFixed(2).padStart(5, '0')}`
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<RegionsPlugin | null>(null)
  /** 加工・書き出し用のフル品質バッファ (wavesurferのデコードは表示用に8kHzへ間引かれるため使わない) */
  const audioBufferRef = useRef<AudioBuffer | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const objectUrlRef = useRef<string | null>(null)
  /** 検出処理でregionを一括再生成している間はregion-createdイベントを無視する */
  const isRebuildingRef = useRef(false)
  /** 区間再生中の停止位置 (秒)。nullなら通常再生 */
  const stopAtRef = useRef<number | null>(null)

  const [fileName, setFileName] = useState<string | null>(null)
  const [audioVersion, setAudioVersion] = useState(0)
  const [segments, setSegments] = useState<SegmentItem[]>([])
  const segmentsRef = useRef<SegmentItem[]>([])
  segmentsRef.current = segments

  // 検出パラメータ
  const [thresholdDb, setThresholdDb] = useState(-40)
  const [minSilenceMs, setMinSilenceMs] = useState(300)
  const [minSegmentMs, setMinSegmentMs] = useState(200)
  const [paddingMs, setPaddingMs] = useState(60)
  // 書き出し設定
  const [fadeInMs, setFadeInMs] = useState(10)
  const [fadeOutMs, setFadeOutMs] = useState(30)
  const [bitDepth, setBitDepth] = useState<16 | 24>(24)
  const [language, setLanguage] = useState('ja')

  const [zoom, setZoom] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [modelProgress, setModelProgress] = useState<ModelProgress | null>(null)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // wavesurfer 初期化
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const regions = RegionsPlugin.create()
    const ws = WaveSurfer.create({
      container,
      waveColor: '#67e8f9',
      progressColor: '#0e7490',
      cursorColor: '#f0abfc',
      height: 160,
      normalize: true,
    })
    ws.registerPlugin(regions)
    wsRef.current = ws
    regionsRef.current = regions
    if (import.meta.env.DEV) {
      // ブラウザのコンソールから動作確認するための開発用フック
      ;(window as unknown as { __ws?: WaveSurfer }).__ws = ws
    }

    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('finish', () => setIsPlaying(false))
    // 区間再生: 指定位置まで来たら停止する
    // (regionsプラグインのregion-outは境界の誤差で誤発火するため使わない)
    ws.on('timeupdate', (time: number) => {
      const stopAt = stopAtRef.current
      if (stopAt !== null && time >= stopAt) {
        stopAtRef.current = null
        ws.pause()
      }
    })

    // 手動でregionを動かしたら対応するセグメントの時間を更新して並べ直す
    regions.on('region-updated', (region: Region) => {
      setSegments((prev) =>
        prev
          .map((s) =>
            s.id === region.id
              ? { ...s, start: region.start, end: region.end }
              : s,
          )
          .sort((a, b) => a.start - b.start),
      )
    })
    // 波形上のドラッグで新しいregionを追加できるようにする
    regions.enableDragSelection({ color: REGION_COLOR })
    regions.on('region-created', (region: Region) => {
      if (isRebuildingRef.current) return
      setSegments((prev) =>
        [
          ...prev,
          {
            id: region.id,
            start: region.start,
            end: region.end,
            name: '',
            nameEdited: false,
            status: 'idle' as const,
          },
        ].sort((a, b) => a.start - b.start),
      )
    })
    return () => {
      ws.destroy()
      wsRef.current = null
      regionsRef.current = null
    }
  }, [])

  // 無音検出 (パラメータ変更時は少し待ってから再実行)
  useEffect(() => {
    const buffer = audioBufferRef.current
    const regions = regionsRef.current
    if (!buffer || !regions) return
    const params: SilenceParams = {
      thresholdDb,
      minSilenceMs,
      minSegmentMs,
      paddingMs,
    }
    const timer = setTimeout(() => {
      const detected = detectSegments(buffer, params)
      isRebuildingRef.current = true
      regions.clearRegions()
      const items: SegmentItem[] = detected.map((seg, i) => {
        const region = regions.addRegion({
          start: seg.start,
          end: seg.end,
          color: REGION_COLOR,
          content: String(i + 1),
          drag: true,
          resize: true,
        })
        return {
          id: region.id,
          start: seg.start,
          end: seg.end,
          name: '',
          nameEdited: false,
          status: 'idle',
        }
      })
      isRebuildingRef.current = false
      setSegments(items)
      setExportMessage(null)
    }, 200)
    return () => clearTimeout(timer)
  }, [audioVersion, thresholdDb, minSilenceMs, minSegmentMs, paddingMs])

  const loadFile = useCallback(async (file: File) => {
    const ws = wsRef.current
    if (!ws) return
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current)
    const url = URL.createObjectURL(file)
    objectUrlRef.current = url
    setFileName(file.name)
    setSegments([])
    setExportMessage(null)
    try {
      // 加工用にフル品質でデコード (レートはAudioContextの既定 = ハードウェアレート)
      const arrayBuffer = await file.arrayBuffer()
      audioCtxRef.current ??= new AudioContext()
      audioBufferRef.current =
        await audioCtxRef.current.decodeAudioData(arrayBuffer)
      // 波形表示・再生はwavesurferに任せる
      await ws.load(url)
      setAudioVersion((v) => v + 1)
    } catch (err) {
      console.error(err)
      alert('音声ファイルの読み込みに失敗しました')
    }
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) loadFile(file)
    },
    [loadFile],
  )

  const playSegment = useCallback((id: string) => {
    const ws = wsRef.current
    const regions = regionsRef.current
    if (!ws || !regions) return
    const region = regions.getRegions().find((r) => r.id === id)
    if (!region) return
    stopAtRef.current = region.end
    ws.setTime(region.start)
    ws.play()
  }, [])

  const removeSegment = useCallback((id: string) => {
    const regions = regionsRef.current
    regions
      ?.getRegions()
      .find((r) => r.id === id)
      ?.remove()
    setSegments((prev) => prev.filter((s) => s.id !== id))
  }, [])

  const updateName = useCallback((id: string, name: string) => {
    setSegments((prev) =>
      prev.map((s) => (s.id === id ? { ...s, name, nameEdited: true } : s)),
    )
  }, [])

  // 全セグメントを順に文字起こしして、未編集の名前を埋める
  const handleTranscribeAll = useCallback(async () => {
    const buffer = audioBufferRef.current
    if (!buffer || isTranscribing) return
    setIsTranscribing(true)
    try {
      for (const seg of [...segmentsRef.current]) {
        // 途中で削除されたセグメントはスキップ
        const current = segmentsRef.current.find((s) => s.id === seg.id)
        if (!current || (current.nameEdited && current.name)) continue
        setSegments((prev) =>
          prev.map((s) =>
            s.id === seg.id ? { ...s, status: 'transcribing' } : s,
          ),
        )
        try {
          const text = await transcribeSegment(
            buffer,
            current.start,
            current.end,
            language,
            setModelProgress,
          )
          setSegments((prev) =>
            prev.map((s) =>
              s.id === seg.id
                ? {
                    ...s,
                    status: 'done',
                    // 手入力済みなら上書きしない
                    name: s.nameEdited && s.name ? s.name : text,
                  }
                : s,
            ),
          )
        } catch (err) {
          console.error(err)
          setSegments((prev) =>
            prev.map((s) => (s.id === seg.id ? { ...s, status: 'error' } : s)),
          )
        }
      }
    } finally {
      setIsTranscribing(false)
      setModelProgress(null)
    }
  }, [isTranscribing, language])

  // フォルダを選んでWAV書き出し
  const handleExport = useCallback(async () => {
    const buffer = audioBufferRef.current
    if (!buffer || segmentsRef.current.length === 0 || isExporting) return
    if (!('showDirectoryPicker' in window)) {
      alert(
        'このブラウザはフォルダ書き出しに対応していません。Chrome / Edge を使ってください。',
      )
      return
    }
    let dir: FileSystemDirectoryHandle
    try {
      dir = await window.showDirectoryPicker({ mode: 'readwrite' })
    } catch {
      return // ユーザーがキャンセル
    }
    setIsExporting(true)
    setExportMessage(null)
    try {
      const items = [...segmentsRef.current].sort((a, b) => a.start - b.start)
      const names: string[] = []
      for (let i = 0; i < items.length; i++) {
        const seg = items[i]
        const num = String(i + 1).padStart(2, '0')
        const base = sanitizeFilename(seg.name, 'sample')
        const filename = `${num}_${base}.wav`
        const data = encodeWavSegment(buffer, {
          start: seg.start,
          end: seg.end,
          fadeInMs,
          fadeOutMs,
          bitDepth,
        })
        const fileHandle = await dir.getFileHandle(filename, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(data)
        await writable.close()
        names.push(filename)
      }
      setExportMessage(`${names.length}件のWAVを書き出しました`)
    } catch (err) {
      console.error(err)
      setExportMessage('書き出しに失敗しました。コンソールを確認してください。')
    } finally {
      setIsExporting(false)
    }
  }, [bitDepth, fadeInMs, fadeOutMs, isExporting])

  const hasAudio = audioVersion > 0 && fileName !== null

  return (
    <div className="app">
      <header>
        <h1>Voice Sample Editor</h1>
        <p className="subtitle">
          1テイク録音を無音区間で分割して、素材ごとにWAV書き出し
        </p>
      </header>

      <section
        className="drop-zone"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <label className="file-button">
          音声ファイルを開く
          <input
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) loadFile(file)
              e.target.value = ''
            }}
          />
        </label>
        <span className="drop-hint">
          {fileName ?? 'またはここにファイルをドロップ'}
        </span>
      </section>

      <section className="waveform-section">
        <div ref={containerRef} className="waveform" />
        {hasAudio && (
          <div className="transport">
            <button
              onClick={() => {
                stopAtRef.current = null
                wsRef.current?.playPause()
              }}
            >
              {isPlaying ? '⏸ 停止' : '▶ 再生'}
            </button>
            <label className="slider-label">
              ズーム
              <input
                type="range"
                min={0}
                max={500}
                value={zoom}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setZoom(v)
                  wsRef.current?.zoom(v)
                }}
              />
            </label>
            <span className="hint">
              波形上をドラッグで区間追加 / 区間の端をドラッグで微調整
            </span>
          </div>
        )}
      </section>

      {hasAudio && (
        <div className="panels">
          <section className="panel">
            <h2>無音検出</h2>
            <label className="slider-label">
              しきい値 {thresholdDb} dB
              <input
                type="range"
                min={-80}
                max={-20}
                value={thresholdDb}
                onChange={(e) => setThresholdDb(Number(e.target.value))}
              />
            </label>
            <label className="slider-label">
              最小無音長 {minSilenceMs} ms
              <input
                type="range"
                min={50}
                max={2000}
                step={50}
                value={minSilenceMs}
                onChange={(e) => setMinSilenceMs(Number(e.target.value))}
              />
            </label>
            <label className="slider-label">
              最小素材長 {minSegmentMs} ms
              <input
                type="range"
                min={50}
                max={2000}
                step={50}
                value={minSegmentMs}
                onChange={(e) => setMinSegmentMs(Number(e.target.value))}
              />
            </label>
            <label className="slider-label">
              前後余白 {paddingMs} ms
              <input
                type="range"
                min={0}
                max={500}
                step={10}
                value={paddingMs}
                onChange={(e) => setPaddingMs(Number(e.target.value))}
              />
            </label>
            <p className="hint">
              ※ パラメータを変えると分割をやり直します(名前・手動調整はリセット)
            </p>
          </section>

          <section className="panel">
            <h2>書き出し設定</h2>
            <label className="slider-label">
              フェードイン {fadeInMs} ms
              <input
                type="range"
                min={0}
                max={1000}
                step={5}
                value={fadeInMs}
                onChange={(e) => setFadeInMs(Number(e.target.value))}
              />
            </label>
            <label className="slider-label">
              フェードアウト {fadeOutMs} ms
              <input
                type="range"
                min={0}
                max={1000}
                step={5}
                value={fadeOutMs}
                onChange={(e) => setFadeOutMs(Number(e.target.value))}
              />
            </label>
            <div className="row">
              <label>
                ビット深度
                <select
                  value={bitDepth}
                  onChange={(e) => setBitDepth(Number(e.target.value) as 16 | 24)}
                >
                  <option value={16}>16bit</option>
                  <option value={24}>24bit</option>
                </select>
              </label>
              <label>
                文字起こし言語
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="ja">日本語</option>
                  <option value="en">英語</option>
                </select>
              </label>
            </div>
          </section>
        </div>
      )}

      {hasAudio && (
        <section className="panel">
          <div className="segments-header">
            <h2>素材一覧 ({segments.length}件)</h2>
            <div className="actions">
              <button
                onClick={handleTranscribeAll}
                disabled={isTranscribing || segments.length === 0}
              >
                {isTranscribing ? '文字起こし中...' : '🎙 文字起こしで命名'}
              </button>
              <button
                className="primary"
                onClick={handleExport}
                disabled={isExporting || segments.length === 0}
              >
                {isExporting ? '書き出し中...' : '📁 フォルダを選んでWAV書き出し'}
              </button>
            </div>
          </div>
          {modelProgress && (
            <p className="hint">
              {modelProgress.status === 'downloading'
                ? `音声認識モデルをダウンロード中... ${modelProgress.percent ?? 0}% (初回のみ)`
                : modelProgress.status === 'loading'
                  ? '音声認識モデルを準備中...'
                  : 'モデル準備完了'}
            </p>
          )}
          {exportMessage && <p className="export-message">{exportMessage}</p>}
          <table className="segment-table">
            <thead>
              <tr>
                <th>#</th>
                <th>区間</th>
                <th>長さ</th>
                <th>ファイル名 (拡張子なし)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {segments.map((seg, i) => (
                <tr key={seg.id}>
                  <td>{i + 1}</td>
                  <td className="mono">
                    {formatTime(seg.start)} - {formatTime(seg.end)}
                  </td>
                  <td className="mono">{(seg.end - seg.start).toFixed(2)}s</td>
                  <td>
                    <input
                      type="text"
                      className="name-input"
                      value={seg.name}
                      placeholder={
                        seg.status === 'transcribing'
                          ? '文字起こし中...'
                          : seg.status === 'error'
                            ? '文字起こし失敗 (手入力してください)'
                            : `sample (→ ${String(i + 1).padStart(2, '0')}_sample.wav)`
                      }
                      onChange={(e) => updateName(seg.id, e.target.value)}
                    />
                  </td>
                  <td className="row-actions">
                    <button title="再生" onClick={() => playSegment(seg.id)}>
                      ▶
                    </button>
                    <button title="削除" onClick={() => removeSegment(seg.id)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
