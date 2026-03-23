#!/bin/bash
#
# build-release.sh - PixInsight リポジトリ配布パッケージのビルドスクリプト
#
# 使い方: bash build-release.sh
#
# 生成物:
#   repository/SkyQualityAnalyzer-{VERSION}.zip  - 配布パッケージ
#   repository/updates.xri                        - リポジトリ情報 XML
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MAIN_SCRIPT="${SCRIPT_DIR}/javascript/SkyQualityAnalyzer.js"
VERSION=$(grep '#define VERSION' "$MAIN_SCRIPT" | sed 's/.*"\(.*\)".*/\1/')
PACKAGE_NAME="SkyQualityAnalyzer"
ZIP_NAME="${PACKAGE_NAME}-${VERSION}.zip"
REPO_DIR="${SCRIPT_DIR}/repository"
TMPDIR_BASE="${SCRIPT_DIR}/.build-tmp"

echo "=== ${PACKAGE_NAME} v${VERSION} リリースビルド ==="

# 1. repository/ ディレクトリ作成
mkdir -p "${REPO_DIR}"

# 2. 一時ディレクトリに PixInsight インストール構造を作成
rm -rf "${TMPDIR_BASE}"
mkdir -p "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}"

# 3. JavaScript ファイルをコピー
cp "${SCRIPT_DIR}/javascript/SkyQualityAnalyzer.js" "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"

echo "ファイルをコピーしました:"
ls -la "${TMPDIR_BASE}/src/scripts/${PACKAGE_NAME}/"

# 4. 古い zip を削除して新規作成
rm -f "${REPO_DIR}/${PACKAGE_NAME}"-*.zip
cd "${TMPDIR_BASE}"
zip -r "${REPO_DIR}/${ZIP_NAME}" src/
cd "${SCRIPT_DIR}"

echo "zip を作成しました: repository/${ZIP_NAME}"

# 5. SHA1 計算
SHA1=$(shasum "${REPO_DIR}/${ZIP_NAME}" | awk '{print $1}')
echo "SHA1: ${SHA1}"

# 6. 現在日付
RELEASE_DATE=$(date +%Y%m%d)

# 7. updates.xri を生成
cat > "${REPO_DIR}/updates.xri" << XMLEOF
<?xml version="1.0" encoding="UTF-8"?>
<xri version="1.0">
   <description>
      <title>Sky Quality Analyzer</title>
      <brief_description>Sky quality measurement tool for PixInsight</brief_description>
   </description>
   <platform os="all" arch="noarch" version="1.8.9:9.9.9">
      <package fileName="${ZIP_NAME}"
               sha1="${SHA1}"
               type="script"
               releaseDate="${RELEASE_DATE}">
         <title>Sky Quality Analyzer</title>
         <description>
            <p>Sky quality measurement tool: calculates SQM (Sky Quality Meter) values from astronomical images to quantify sky brightness and light pollution.</p>
         </description>
      </package>
   </platform>
</xri>
XMLEOF

echo "updates.xri を生成しました"

# 8. 一時ディレクトリ削除
rm -rf "${TMPDIR_BASE}"

echo ""
echo "=== ビルド完了 ==="
echo "  ${REPO_DIR}/${ZIP_NAME}"
echo "  ${REPO_DIR}/updates.xri"
echo "  SHA1: ${SHA1}"
