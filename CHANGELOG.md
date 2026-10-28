# Changelog

## 1.8.0

- Batch transcription now expands each result panel automatically.
- Added a persisted parallelism selector (1–4) for local transcription.
- Parallel workers are reflected in the status bar.
- Added the open-source project files (LICENSE, CONTRIBUTING, SECURITY, CI).

## 1.7.0

- Added batch transcription for all audio links in the current list.
- Added a stop control for running batches.
- Added CSV export of transcripts, including untranscribed rows.

## 1.6.0

- Transcriptions are converted from Traditional to Simplified Chinese with OpenCC.
- The UI shows “已转简体” when conversion runs.

## 1.5.0

- Added local Whisper transcription through a Python native messaging host.
- Added per-card and lightbox transcript panels, copy support, and local caching.

## 1.4.0

- Added inline native audio playback in audio cards.
- Audio can also be played in the lightbox.
- Opening the lightbox pauses inline playback.

## 1.3.0

- Added the text tools module with multiline deduplication.
- Options: trim whitespace, drop empty lines, ignore case, sort order.
- Results can be copied or applied back to the link list.

## 1.2.0

- Added video and audio link previews.
- Added per-card MD5 calculation and click-to-copy.
- Audio cards show duration; videos show dimensions and duration.

## 1.1.0

- Added batch MD5 export using OSS Content-MD5/ETag when available.
- Added MD5 fallback via streaming downloads.
- Added per-card MD5 display.

## 1.0.0

- Initial image link preview with multi-link paste, lightbox, and copy support.
