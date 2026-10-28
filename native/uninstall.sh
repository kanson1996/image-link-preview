#!/bin/bash
# Remove the native messaging manifests for this extension.
# Optionally delete the downloaded model and config as well.
set -euo pipefail

HOST_NAME="com.kanson.media_transcriber"
SUPPORT="$HOME/Library/Application Support/ImageLinkPreviewTranscriber"

echo "== 移除本地 Whisper 转写助手 =="

for host_dir in \
  "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts" \
  "$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
do
  rm -f "$host_dir/$HOST_NAME.json"
done

if [ -d "$SUPPORT" ]; then
  read -r -p "同时删除本地模型和配置（$SUPPORT，约 180MB）？[y/N] " answer
  case "$answer" in
    [yY]*)
      rm -rf "$SUPPORT"
      echo "已删除：$SUPPORT"
      ;;
    *)
      echo "已保留：$SUPPORT"
      ;;
  esac
fi

echo "native messaging 清单已移除。"
echo "扩展本身可在 chrome://extensions 中移除；转写缓存保存在扩展的本地存储里。"
