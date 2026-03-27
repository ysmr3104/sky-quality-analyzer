# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

Sky Quality Analyzer は天体撮影画像から空の明るさ（SQM: Sky Quality Meter値、単位 mag/arcsec²）を算出する PixInsight PJSR スクリプト:

1. **SkyQualityAnalyzer.js** (PJSR): メインスクリプト。画像のバックグラウンド輝度を解析し、露出時間・ピクセルスケール・フィルター等のメタデータと組み合わせて SQM 値を算出する PJSR Dialog

```
PixInsight（PJSR ネイティブ、外部プロセス不要）
┌─────────────────────────────────────────────┐
│ 1. 画像を開く                                │
│ 2. Script > Utility > SkyQualityAnalyzer     │
│ 3. Dialog で各種パラメータを設定              │
│ 4. Analyze（バックグラウンド解析 + SQM 算出） │
│ 5. 結果表示・エクスポート                    │
└─────────────────────────────────────────────┘
```

## コマンド

```bash
# Node.js 単体テスト実行
node tests/javascript/test_sqm_math.js

# リリースビルド
bash build-release.sh

# PJSR 統合テストは PixInsight コンソールで実行
# Script > Run Script File... > tests/javascript/SkyQualityAnalyzerTest.js
```

## アーキテクチャ

### PJSR ネイティブ構成（JavaScript のみ）

- **`javascript/SkyQualityAnalyzer.js`**: メインスクリプト。全 UI を PJSR Dialog で構築。
- **`javascript/sqm_math.js`**: SQM 算出数学ライブラリ。PJSR と Node.js の両方で動作。
- **`javascript/equipment.json`**: 対応カメラ・望遠鏡データベース。

## コーディング規約

- **ES5 スタイル必須**: PJSR は `let`/`const`/アロー関数/テンプレートリテラルを未サポート。`var` 宣言のみ使用。
- **コード言語**: 変数名・関数名・コメント・コンソール出力（`console.writeln`）は全て英語。
- **UI テキスト**: ラベル・メッセージボックス・ツールチップも全て英語。
- **PJSR + Node.js 両対応**: 数学ライブラリは `#include` と `require` の両方で動作するよう実装。

## テスト方針

- **Node.js 単体テスト**: SQM 算出数学関数の精度検証
- **PJSR 統合テスト**: PixInsight コンソールで実行
- **E2E テスト（手動）**: 実画像での SQM 値確認

### テスト実施ルール

- **テスト実施前に必ずコミットする**: テストを実行する前に、変更を全てコミットしておくこと。テスト結果がどのコミットに対するものかを明確にするため。
- **テスト完了後に Issue へ報告する**: テスト完了時は、関連 Issue のコメントに以下を投稿すること:
  - 実施したテストの種別（UT / PJSR / E2E など）
  - テスト対象のコミットハッシュ（`git rev-parse --short HEAD`）
  - テスト結果サマリ（成功数/失敗数）

## PixInsight でのテスト

PixInsight でテスト実行する際は、**必ずコンソールログの保存を案内する**こと。スクリプト実行前に以下のコマンドを PixInsight コンソールで実行してもらう。ファイル名には実行時の日付時刻（YYYYMMDD_HHMMSS）を埋め込むこと:

```
log -f="/Users/ysmr/Downloads/pixinsight_sqa_20260327_120000.log" -a
```

（上記は例。日付時刻部分はその時点の値に置き換える）

ログファイルはバグ分析・結果確認に使用する。

## 実装上の重要な注意点

- **HTTP 通信**: ExternalProcess + curl で一時ファイル経由。PJSR での stdout キャプチャは不安定なため、レスポンスは一時ファイルに保存して読み込む（SIMBAD 検索も同様）。
- **FITSKeyword 値アクセス**: PJSR は `kw.value` を使用。文字列値はクォート除去が必要: `kw.value.trim().replace(/^'|'$/g, "").trim()`。
- **UI 初期化順序**: ウィジェットのプロパティ参照（`enabled` など）は、そのウィジェットが定義された後に行うこと。コンストラクタ内で定義前のウィジェットを参照すると undefined エラーになる。
- **Dialog の予約済みプロパティ**: `Dialog.result` は終了コード用の整数プロパティ。独自の結果格納に使用してはならない（`null` 代入でエラー）。別名（例: `sqmResult`）を使うこと。
- **FITS 座標 convention**: PixInsight FITS は y-flip（FITS y=1 が画像上端）。WCS のピクセル→RA/Dec 変換では `fitsY = imageHeight - py` で y を反転してから CD 行列を適用すること。

## 外部依存

- **PixInsight 1.8.9+** — PJSR スクリプト実行環境
- **curl** — SIMBAD カタログ検索用 HTTP 通信（OS 標準搭載）
- **Node.js** — テスト実行用（オプション）
