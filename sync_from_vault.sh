#!/bin/bash
# 把 vault 里改过的面板文件同步进这个仓库（只拷面板代码和约定，不碰 vault 里的笔记）。
# 用法：./sync_from_vault.sh <你的 vault>
set -euo pipefail
VAULT="${1:?用法：./sync_from_vault.sh <你的 vault 路径>}"
SRC="$VAULT/论文工作台"
DST="$(cd "$(dirname "$0")" && pwd)/论文工作台"
mkdir -p "$DST/面板组件"
cp "$SRC/论文面板.md" "$SRC/我的研究领域.md" "$DST/"
cp "$SRC/面板组件/view.js" "$SRC/面板组件/view.css" "$DST/面板组件/"
# 约定：schemas、examples、校验脚本和说明；--delete 让删掉的 schema 也同步删掉
rsync -a --delete --exclude '.DS_Store' "$SRC/后端约定/" "$DST/后端约定/"
echo "已同步：$SRC → $DST"
