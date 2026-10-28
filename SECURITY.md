# Security

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting / Security Advisories for this repository. Do not open a public issue for a sensitive report.

## Design and threat model

- The extension requests access to all `http(s)` URLs so it can load previews, read MD5/ETag headers, and fetch audio. It only contacts URLs the user pastes.
- The optional native host in `native/` is installed by the user. Its native messaging manifest only allows this extension's origin.
- The host downloads the pasted audio into a temporary directory, converts it with ffmpeg, runs local whisper.cpp, and deletes the temporary files.
- Transcripts are stored locally in `chrome.storage.local`; there is no telemetry and no cloud upload.
- whisper.cpp, OpenCC and ffmpeg are external dependencies installed via Homebrew. They are not bundled in this repository.

## Supported versions

Security fixes are applied to the latest release.
