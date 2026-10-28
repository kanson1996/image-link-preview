# Media Link Preview

A local-first Chrome extension for previewing image/video/audio URLs, copying and exporting MD5 hashes, deduplicating multiline text, and transcribing audio locally with whisper.cpp on macOS.

[中文说明](README.md)

## Features

- Paste one or many image/video/audio URLs and preview them in a gallery.
- Image lightbox, video playback, and inline audio playback.
- Per-link MD5 calculation and click-to-copy; batch MD5 export to CSV.
- Local Whisper audio transcription with Traditional → Simplified Chinese conversion, batch processing, parallel workers, and CSV export of transcripts.
- Multiline text deduplication with trimming, empty-line removal, case-insensitive matching, and sorting.
- Everything runs locally; there is no analytics or cloud upload.

## Requirements

- Chrome or Chromium.
- macOS 13+ for the optional audio transcription helper.
- Audio transcription also needs `ffmpeg`; the installer can install `whisper.cpp` and `opencc` via Homebrew and downloads a ~180MB Whisper model.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click “Load unpacked” and select this folder.
4. Optional audio transcription: run `./native/install.sh` in this folder, then reload the extension.

See [README.md](README.md) for detailed usage and troubleshooting.

## Permissions and privacy

- `http://*/*`, `https://*/*`: load previews, read MD5/ETag headers, and fetch audio URLs that the user pastes.
- `nativeMessaging`: run the local Whisper helper. The native host manifest only allows this extension.
- `storage`: remember the link list, transcripts, and the parallelism setting.
- `clipboardRead` / `clipboardWrite`: paste links and copy MD5/transcripts.
- No telemetry. Audio is downloaded to a temporary directory, transcribed locally, and deleted.

## Development

```bash
bash tools/check.sh
```

There is no build step. Node.js and Python 3 are needed for syntax checks only.

## License

MIT. See [LICENSE](LICENSE).
