[English](README.md)

# Sky Quality Analyzer

PixInsight 向け空の明るさ測定ツール。天体撮影画像から SQM（Sky Quality Meter）値 — 空の明るさ（mag/arcsec²）の指標 — を算出し、光害レベルや撮影コンディションを定量的に評価します。

## 概要

SkyQualityAnalyzer は、PixInsight 画像のバックグラウンド輝度と画像メタデータ（露出時間、ピクセルスケール、フィルター等）を使用した測光キャリブレーションモデルにより、SQM 値（空の明るさ: mag/arcsec²）を推定します。

## 主な機能

_（開発中 — 予定機能は Issues を参照）_

## インストール

### リポジトリからインストール（推奨）

1. PixInsight で **Resources > Updates > Manage Repositories** を開く
2. **Add** をクリックし、以下の URL を入力:
   ```
   https://ysmrastro.github.io/pixinsight-scripts/
   ```
3. **OK** をクリックし、**Resources > Updates > Check for Updates** を実行
4. PixInsight を再起動

### 手動インストール

1. このリポジトリをクローンまたはダウンロード
2. PixInsight で **Script > Feature Scripts...** を開く
3. **Add** をクリックし、`sky-quality-analyzer/javascript/` ディレクトリを選択
4. **Done** をクリック — **Script > Utility > SkyQualityAnalyzer** がメニューに追加される

Python や外部パッケージは不要です。

## 技術仕様

詳細は [docs/specs.md](docs/specs.md) を参照してください。

## ライセンス

このプロジェクトは [MIT ライセンス](LICENSE) の下で公開されています。
