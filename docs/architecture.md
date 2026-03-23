# Sky Quality Analyzer プロジェクトガイド

## 1. プロジェクト構成

```
sky-quality-analyzer/
├── javascript/
│   └── SkyQualityAnalyzer.js      # PJSR メインスクリプト
├── tests/
│   └── javascript/
│       ├── test_sqm_math.js       # Node.js 単体テスト（SQM 算出数学関数）
│       └── SkyQualityAnalyzerTest.js  # PJSR 統合テスト
├── docs/
│   ├── specs.md                   # 技術仕様書
│   ├── architecture.md            # プロジェクトガイド（本ドキュメント）
│   └── images/                    # スクリーンショット
├── repository/
│   ├── SkyQualityAnalyzer-x.x.x.zip  # PixInsight リポジトリ配布用 ZIP
│   └── updates.xri                   # PixInsight アップデート定義
├── build-release.sh               # リリースビルドスクリプト
├── CLAUDE.md                      # Claude Code 用ガイド
├── LICENSE                        # MIT ライセンス
├── README.md                      # 英語 README
├── README.ja.md                   # 日本語 README
└── .gitignore
```

## 2. テスト

### Node.js 単体テスト

```bash
node tests/javascript/test_sqm_math.js
```

### PJSR 統合テスト

PixInsight コンソールで実行:

**Script > Run Script File...** → `tests/javascript/SkyQualityAnalyzerTest.js`

## 3. 外部依存

- PixInsight 1.8.9+（PJSR スクリプト用）
- Node.js（テスト実行用、オプション）

## 4. コーディング規約

- **ES5 スタイル必須**: `var` 宣言、`function` 式。PJSR は `let`/`const`/アロー関数を未サポート
- **コード言語**: 変数名・関数名・コメント・コンソール出力は英語
- **PJSR + Node.js 両対応**: 数学ライブラリは `#include` と `require` の両方で動作
- **Node.js エクスポート**: ファイル末尾で `if (typeof module !== "undefined") { module.exports = {...}; }`
