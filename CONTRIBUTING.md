# Contributing

Thanks for your interest in improving this extension.

## Development

- There is no build step: load this folder as an unpacked extension from `chrome://extensions`.
- Run the syntax checks before opening a pull request:

```bash
bash tools/check.sh
```

Node.js and Python 3 are required for the checks only.

- Audio transcription requires the macOS native helper. After changing `native/`, reinstall it with `./native/install.sh` and test with a real audio URL.

## Pull requests

- Keep the extension dependency-free (vanilla JavaScript, no bundler) unless there is a strong reason.
- Test the flows you touch: preview, MD5, text dedupe, batch transcription, stop/parallel behavior.
- Update `README.md` and `CHANGELOG.md` when behavior changes.
- Do not commit user data, internal URLs, API keys, transcripts, or downloaded Whisper models.
- Explain any new extension permission in the pull request.

## License

By contributing, you agree that your contributions are licensed under the MIT License.
