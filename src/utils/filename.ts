// 文字起こし結果などからWindows/一般OSで安全なファイル名を作る

const MAX_LENGTH = 40

export function sanitizeFilename(raw: string, fallback: string): string {
  let s = raw.normalize('NFKC')
  // OSで使えない文字を除去し、制御文字 (Unicodeカテゴリ Cc) も落とす
  s = s.replace(/[<>:"/\\|?*]/g, '')
  s = s.replace(/\p{Cc}/gu, '')
  // 文字起こしに混ざりがちな句読点・記号を除去
  s = s.replace(/[。、.,!?!?・…‥「」『』()()[\]【】]/g, '')
  s = s.trim().replace(/\s+/g, '_')
  // 先頭・末尾のドットは不可 (Windows)
  s = s.replace(/^\.+|\.+$/g, '')
  if (s.length > MAX_LENGTH) s = s.slice(0, MAX_LENGTH)
  return s || fallback
}

/**
 * 書き出しファイル名の一覧を作る。
 * numbered=true なら総数に応じたゼロ埋め連番 (最低2桁) を先頭に付ける。
 * 連番なしで同名が重複する場合は _2, _3... を付けて衝突を避ける。
 */
export function buildExportNames(
  rawNames: string[],
  numbered: boolean,
): string[] {
  const width = Math.max(2, String(rawNames.length).length)
  const used = new Map<string, number>()
  return rawNames.map((raw, i) => {
    const base = sanitizeFilename(raw, 'sample')
    let name = numbered
      ? `${String(i + 1).padStart(width, '0')}_${base}`
      : base
    const count = used.get(name) ?? 0
    used.set(name, count + 1)
    if (count > 0) name = `${name}_${count + 1}`
    return `${name}.wav`
  })
}
