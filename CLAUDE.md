# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### コーディング規約

- **ES5 スタイル必須**: `var` 宣言、`function` 式。PJSR は `let`/`const`/アロー関数を未サポート
- **コード言語**: 変数名・関数名・コメント・コンソール出力は英語
- **PJSR + Node.js 両対応**: 数学ライブラリは `#include` と `require` の両方で動作するよう実装

## テスト方針

- **Node.js 単体テスト**: SQM 算出数学関数の精度検証
- **PJSR 統合テスト**: PixInsight コンソールで実行
- **E2E テスト（手動）**: 実画像での SQM 値確認

## 外部依存

- PixInsight 1.8.9+（PJSR スクリプト用）
- Node.js（テスト実行用、オプション）
