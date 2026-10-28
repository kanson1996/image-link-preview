#!/bin/bash
# Install the local Whisper transcription helper for the Chrome extension.
# Usage: ./install.sh [--yes]
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(cd "$HERE/.." && pwd)"
SUPPORT="$HOME/Library/Application Support/ImageLinkPreviewTranscriber"
MODEL_DIR="$SUPPORT/models"
MODEL="$MODEL_DIR/ggml-small-q5_1.bin"
HOST_NAME="com.kanson.media_transcriber"
PYTHON="/usr/bin/python3"
AUTO_YES=0

if [ "${1:-}" = "--yes" ]; then
  AUTO_YES=1
fi

confirm() {
  local prompt="$1"
  if [ "$AUTO_YES" = 1 ]; then
    return 0
  fi
  read -r -p "$prompt [y/N] " answer
  case "$answer" in
    [yY]*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "== 安装本地 Whisper 转写助手 =="

if ! "$PYTHON" --version >/dev/null 2>&1; then
  echo "找不到 $PYTHON，请先安装 Xcode Command Line Tools。"
  exit 1
fi

mkdir -p "$SUPPORT" "$MODEL_DIR"

FFMPEG="$(command -v ffmpeg || true)"
if [ -z "$FFMPEG" ]; then
  echo "缺少 ffmpeg，请先运行：brew install ffmpeg"
  exit 1
fi

OPENCC="$(command -v opencc || true)"
for candidate in /opt/homebrew/bin/opencc /usr/local/bin/opencc; do
  if [ -z "$OPENCC" ] && [ -x "$candidate" ]; then
    OPENCC="$candidate"
  fi
done
if [ -z "$OPENCC" ]; then
  if command -v brew >/dev/null 2>&1 && confirm "缺少 opencc，是否用 Homebrew 安装？"; then
    echo "正在安装 OpenCC（繁转简）…"
    brew install opencc
    OPENCC="$(command -v opencc || true)"
    if [ -z "$OPENCC" ] && [ -x /opt/homebrew/bin/opencc ]; then
      OPENCC="/opt/homebrew/bin/opencc"
    fi
  fi
fi
if [ -z "$OPENCC" ]; then
  echo "警告：找不到 opencc，转写结果将不会自动繁转简。可运行：brew install opencc"
fi

WHISPER="$(command -v whisper-cli || true)"
for candidate in /opt/homebrew/bin/whisper-cli /usr/local/bin/whisper-cli; do
  if [ -z "$WHISPER" ] && [ -x "$candidate" ]; then
    WHISPER="$candidate"
  fi
done
if [ -z "$WHISPER" ]; then
  if command -v brew >/dev/null 2>&1 && confirm "缺少 whisper-cli，是否用 Homebrew 安装 whisper.cpp？"; then
    echo "正在安装 whisper.cpp（首次可能需要几分钟）…"
    brew install whisper.cpp
    WHISPER="$(command -v whisper-cli || true)"
    if [ -z "$WHISPER" ] && [ -x /opt/homebrew/bin/whisper-cli ]; then
      WHISPER="/opt/homebrew/bin/whisper-cli"
    fi
  fi
fi
if [ -z "$WHISPER" ]; then
  echo "找不到 whisper-cli，请先运行：brew install whisper.cpp"
  exit 1
fi

if [ ! -s "$MODEL" ]; then
  if confirm "需要下载 Whisper small 模型（约 180MB）到 $MODEL_DIR，继续？"; then
    echo "正在下载 Whisper small 模型（约 180MB）…"
    curl -fL --retry 3 --retry-delay 2 --max-time 600 \
      -o "$MODEL" \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin"
  else
    echo "已取消模型下载。"
    exit 1
  fi
fi

cp "$HERE/transcriber.py" "$SUPPORT/transcriber.py"
chmod +x "$SUPPORT/transcriber.py"

{
  echo '#!/bin/bash'
  printf 'exec "%s" "%s"\n' "$PYTHON" "$SUPPORT/transcriber.py"
} > "$SUPPORT/transcriber-launcher.sh"
chmod +x "$SUPPORT/transcriber-launcher.sh"

"$PYTHON" - "$SUPPORT/config.json" "$WHISPER" "$MODEL" "$FFMPEG" "$OPENCC" <<'PY'
import json
import sys

out, whisper, model, ffmpeg, opencc = sys.argv[1:6]
config = {
    "whisper_cli": whisper,
    "model": model,
    "ffmpeg": ffmpeg,
    "curl": "/usr/bin/curl",
    "opencc": opencc,
    "opencc_config": "t2s.json",
    "language": "zh",
    "threads": 4,
    "max_download_bytes": 314572800,
}
with open(out, "w", encoding="utf-8") as handle:
    json.dump(config, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY

EXT_ID="$("$PYTHON" - "$EXT_DIR" <<'PY'
import hashlib
import os
import sys

path = os.path.realpath(sys.argv[1])
digest = hashlib.sha256(path.encode("utf-8")).hexdigest()[:32]
print("".join(chr(ord("a") + int(char, 16)) for char in digest))
PY
)"

"$PYTHON" - "$HOST_NAME" "$SUPPORT/transcriber-launcher.sh" "$EXT_ID" <<'PY' > "$SUPPORT/host-manifest.json"
import json
import sys

name, path, extension_id = sys.argv[1:4]
manifest = {
    "name": name,
    "description": "Local Whisper transcription for 图片视频音频链接预览",
    "path": path,
    "type": "stdio",
    "allowed_origins": ["chrome-extension://%s/" % extension_id],
}
print(json.dumps(manifest, ensure_ascii=False, indent=2))
PY

for host_dir in \
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
do
  mkdir -p "$host_dir"
  cp "$SUPPORT/host-manifest.json" "$host_dir/$HOST_NAME.json"
done

echo ""
echo "安装完成："
echo "  扩展 ID : $EXT_ID"
echo "  Whisper  : $WHISPER"
echo "  OpenCC    : ${OPENCC:-未安装（不会自动繁转简）}"
echo "  模型      : $MODEL"
echo "  配置      : $SUPPORT/config.json"
echo "  原生宿主  : $SUPPORT/transcriber-launcher.sh"
echo ""
echo "请打开 chrome://extensions 重新加载扩展，然后在音频卡片上点「转文字」。"
echo "如果移动了插件目录，需要重新运行本脚本（扩展 ID 会变化）。"
