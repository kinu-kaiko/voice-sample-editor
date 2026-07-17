# プロジェクト概要

DAWで1テイクにまとめて録音した複数の音素材（ボイスサンプルパック用）を、
GUIで加工して素材ごとに個別ファイルへ書き出すツール。

## やりたいこと（ユーザーからのヒアリング内容）

- 入力: DAWで1テイクにまとめて録音された、複数の音素材を含む1つの音声ファイル
- 処理:
  - 無音区間の除去（素材の区切りを検出する用途）
  - 必要に応じて各素材の最初と最後にフェードイン/アウトをかける
  - 素材ごとに別ファイルへ分割して書き出す
  - 書き出す際、内容に合わせてファイル名を自動でつける
- 保存先: 実行のたびに任意のフォルダを選んで保存したい（固定のダウンロードフォルダでは不可）

## ヒアリング結果（2026-07-12 確定）

1. **ファイル名**: 音声認識で自動生成し、必要なものだけGUIで手修正する（案A+B）
   - 実装: transformers.js の Whisper (`onnx-community/whisper-base`) をブラウザ内で実行。
     初回のみモデルをダウンロードし、以降はブラウザキャッシュで動作
   - 書き出しファイル名は `01_こんにちは.wav` のように連番プレフィックス付き
2. **無音検出**: しきい値・最小無音長・最小素材長・前後余白をGUIスライダーで調整可能
3. **入力**: ブラウザが対応する形式すべて（WAV/MP3/FLAC/OGG/M4A等）
4. **出力**: WAV固定（ビット深度 16/24bit を選択可、デフォルト24bit）

## 技術選定（決定済み）

**Web版（ブラウザで動くGUI）** を採用。

- Vite + React + TypeScript
- 音声処理: Web Audio API
- 波形表示・編集UI: wavesurfer.js（波形表示・リージョン選択の定番ライブラリ）
- 保存: File System Access API（`showDirectoryPicker` などでフォルダを選び、
  複数ファイルをダウンロードダイアログなしで書き出す）
  - **注意: Chrome / Edge 系ブラウザのみ対応**（Firefox/Safariは非対応）。
    個人用ツールなので許容する前提。

選定理由:
- Windowsネイティブアプリ（WPF/WinUI）やVSTプラグイン（JUCE/C++）は
  ビルド環境構築のハードルが高く、AIとの反復開発（作る→ブラウザで実際に動かして確認→直す）
  のサイクルを回しにくい
- Web版ならNode.jsのみで開発着手でき、Claude Codeがブラウザを直接操作して
  動作確認できるツールを使えるため、品質確認のループが速い
- 将来Windowsアプリ化したくなった場合もコアロジック（波形処理・書き出し）は流用可能（Tauri等でラップ）

## 環境セットアップ状況

- OS: Windows 11、作業フォルダ: `C:\Users\kinuk\claude\20260712_VoiceSampleEditor`（このフォルダ）
- Node.js: v24.18.0 / npm 11.16.0（`C:\Program Files\nodejs` にインストール済み）。
  **シェルセッションによってはPATH未反映のことがある**ので、コマンドが見つからない場合は
  `$env:Path += ";C:\Program Files\nodejs"` を先に実行する
- devサーバー: `.claude/launch.json` の `dev` 構成で起動（内部で上記PATH補正済み）

## 公開先（GitHub Pages）

- **公開URL: https://kinu-kaiko.github.io/voice-sample-editor/**
- リポジトリ: https://github.com/kinu-kaiko/voice-sample-editor （公開）
- `master` へpushすると GitHub Actions（`.github/workflows/deploy.yml`）が自動でビルド&デプロイする。
  手動デプロイ作業は不要
- Pages機能の有効化（`build_type: workflow`）はAPIで実施済み。
  ワークフロー内の`configure-pages`に`enablement: true`を付けるとGITHUB_TOKENの権限不足で失敗するので付けないこと
- 認証はGit Credential Manager保存済みの資格情報でpush可能（gh CLIは未インストール）

## 実装状況（2026-07-12 MVP完成・動作確認済み）

- 読み込み→無音検出→リージョン編集→文字起こし命名→フォルダ選択WAV書き出し まで一通り動作
- 主要ファイル:
  - `src/App.tsx` — GUI全体（wavesurfer.js + Regionsプラグイン）
  - `src/audio/silence.ts` — RMSベースの無音区間検出
  - `src/audio/wav.ts` — フェード適用 + WAV(16/24bit)エンコード
  - `src/audio/transcribe.ts` — Whisper文字起こし（動的import・WebGPU→WASMフォールバック）
  - `src/utils/filename.ts` — ファイル名サニタイズ
  - `src/utils/project.ts` — 編集状況(.vse.json)の保存・読み込み。
    音声ファイル本体は含まず、名前+サイズで対応チェックする

### 実装上の注意（ハマりどころ）

- **wavesurfer.jsの`getDecodedData()`は表示用に8kHzへ間引かれる**（`sampleRate`オプションのデフォルト）。
  加工・書き出しには使わず、`AudioContext.decodeAudioData`で自前デコードしたバッファを使うこと
- Regionsプラグインの`region-out`イベントは境界の浮動小数点誤差で再生開始直後に誤発火する。
  区間再生の終端停止は`timeupdate`で自前判定している
- **`normalize: true`は描画チャンク単位で個別に正規化される**(高ズームで波形が複数canvasに
  分割されると、無音チャンクのノイズフロアが最大増幅されて偽の波形が表示される)。
  読み込み時に全体ピークを計算して`maxPeak`オプションで固定することで回避している
- `ws.zoom()`をスライダードラッグ中に連続実行すると古い倍率のチャンクが残留する。
  150msデバウンスで1回にまとめている
- テスト音声はWindows TTSで生成できる（System.Speech + SSMLの`<break>`で無音区間入り）。
  Haruka（ja-JP）がインストール済み

## 今後の候補（未着手）

- 検出パラメータ変更時に手入力済みの名前を保持する（現在はリセット）
- 書き出し前のファイル名一括プレビュー
- Whisperモデルの選択（base→smallで精度向上、ダウンロード増）

## サブエージェント（他モデル連携）の運用方針

Claude Codeのサブエージェント機能（Agentツールの`model`指定で
sonnet / opus / haiku / fable を使い分けられる仕組み）は、今すぐ使う必要はない。

- ユーザーからは提案していない。**必要になったタイミングで、担当モデル側から
  「ここはHaikuに任せてコストを抑えられます」等、能動的に提案すること**
  （例: 大量ファイルへの定型処理、単純な一括リネーム案の生成など、
  コストを抑えたい反復作業が発生したタイミング）
- ユーザーから聞かれるまで待つのではなく、該当する場面が来たら都度提案する
