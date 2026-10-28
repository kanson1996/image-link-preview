#!/usr/bin/python3
"""Native messaging host: transcribe an audio URL with local whisper.cpp.

Chrome launches this process and talks length-prefixed JSON over stdin/stdout.
Only JSON protocol messages may be written to stdout; logs go to stderr.
"""

import json
import os
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG_PATH = HERE / 'config.json'
MAX_MESSAGE_BYTES = 10 * 1024 * 1024


def log(message):
    print(message, file=sys.stderr, flush=True)


def read_message():
    header = sys.stdin.buffer.read(4)
    if len(header) != 4:
        return None
    length = struct.unpack('<I', header)[0]
    if length == 0 or length > MAX_MESSAGE_BYTES:
        return None
    chunks = []
    remaining = length
    while remaining > 0:
        chunk = sys.stdin.buffer.read(remaining)
        if not chunk:
            return None
        chunks.append(chunk)
        remaining -= len(chunk)
    try:
        return json.loads(b''.join(chunks).decode('utf-8'))
    except Exception as exc:
        log('bad native message: %s' % exc)
        return None


def send(payload):
    data = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    try:
        sys.stdout.buffer.write(struct.pack('<I', len(data)))
        sys.stdout.buffer.write(data)
        sys.stdout.buffer.flush()
    except BrokenPipeError:
        sys.exit(0)


def load_config():
    config = {
        'whisper_cli': '/opt/homebrew/bin/whisper-cli',
        'model': str(Path.home() / 'Library/Application Support/'
                     'ImageLinkPreviewTranscriber/models/ggml-small-q5_1.bin'),
        'ffmpeg': '/opt/homebrew/bin/ffmpeg',
        'curl': '/usr/bin/curl',
        'opencc': '/opt/homebrew/bin/opencc',
        'opencc_config': 't2s.json',
        'language': 'zh',
        'threads': 4,
        'max_download_bytes': 300 * 1024 * 1024,
    }
    if CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding='utf-8'))
            config.update({key: value for key, value in data.items() if value is not None})
        except Exception as exc:
            log('cannot read config: %s' % exc)
    return config


def require_file(path, label):
    if not os.path.isfile(path):
        raise RuntimeError('找不到%s：%s。请先运行 native/install.sh。' % (label, path))


def to_simplified(text, config):
    """Convert Traditional Chinese to Simplified with OpenCC (best effort)."""
    opencc = config.get('opencc')
    if not text or not opencc or not os.path.isfile(opencc):
        return text, False
    try:
        result = subprocess.run(
            [opencc, '-c', str(config.get('opencc_config') or 't2s.json')],
            input=text, capture_output=True, text=True, timeout=30,
        )
        converted = (result.stdout or '').strip()
        if result.returncode == 0 and converted:
            return converted, True
        detail = (result.stderr or '').strip()[:200]
        log('opencc failed: %s' % detail)
    except Exception as exc:
        log('opencc error: %s' % exc)
    return text, False


def transcribe(url, config, progress):
    if not isinstance(url, str) or not (url.startswith('http://') or url.startswith('https://')):
        raise RuntimeError('仅支持 http/https 音频链接')

    require_file(config['whisper_cli'], ' whisper-cli')
    require_file(config['model'], ' Whisper 模型')
    if not os.path.isfile(config['ffmpeg']):
        raise RuntimeError('找不到 ffmpeg：%s。请先安装 ffmpeg。' % config['ffmpeg'])

    with tempfile.TemporaryDirectory(prefix='ilp-transcribe-') as temp_dir:
        source = os.path.join(temp_dir, 'source.audio')
        wav = os.path.join(temp_dir, 'audio.wav')
        output_prefix = os.path.join(temp_dir, 'result')

        progress('download', '下载音频…')
        download = subprocess.run(
            [config['curl'], '-fsSL', '--max-time', '300', '--retry', '2',
             '--max-filesize', str(config.get('max_download_bytes', 300 * 1024 * 1024)),
             '-o', source, url],
            capture_output=True, text=True,
        )
        if download.returncode != 0:
            detail = (download.stderr or '').strip()[:300] or 'curl 下载失败'
            raise RuntimeError('音频下载失败：%s' % detail)
        if not os.path.isfile(source) or os.path.getsize(source) == 0:
            raise RuntimeError('音频下载失败：文件为空')

        progress('convert', '转换音频格式…')
        convert = subprocess.run(
            [config['ffmpeg'], '-hide_banner', '-loglevel', 'error', '-y',
             '-i', source, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav],
            capture_output=True, text=True,
        )
        if convert.returncode != 0 or not os.path.isfile(wav):
            detail = (convert.stderr or '').strip()[:300] or 'ffmpeg 转换失败'
            raise RuntimeError('音频转换失败：%s' % detail)

        progress('transcribe', '本地识别中…')
        started = time.time()
        command = [
            config['whisper_cli'], '-m', config['model'], '-f', wav,
            '-l', str(config.get('language') or 'zh'),
            '-t', str(config.get('threads') or 4),
            '-oj', '-of', output_prefix, '-np',
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            raise RuntimeError('本地识别超时（超过 10 分钟）')
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or '').strip()[:500]
            raise RuntimeError('本地识别失败：%s' % (detail or 'whisper-cli 退出异常'))

        text = ''
        json_path = output_prefix + '.json'
        if os.path.isfile(json_path):
            try:
                data = json.loads(Path(json_path).read_text(encoding='utf-8'))
                segments = data.get('transcription') or []
                text = ''.join(str(segment.get('text', '')) for segment in segments).strip()
            except Exception as exc:
                log('cannot parse whisper json: %s' % exc)
        if not text:
            text_path = output_prefix + '.txt'
            if os.path.isfile(text_path):
                text = Path(text_path).read_text(encoding='utf-8').strip()
        if not text:
            raise RuntimeError('识别完成但没有返回文字（音频可能是静音或无语音）')

        text, simplified = to_simplified(text, config)

        return {
            'text': text,
            'simplified': simplified,
            'engine': 'whisper.cpp',
            'model': os.path.basename(config['model']),
            'language': config.get('language') or 'zh',
            'elapsed_seconds': round(time.time() - started, 2),
        }


def main():
    config = load_config()

    while True:
        message = read_message()
        if message is None:
            break
        if not isinstance(message, dict):
            send({'type': 'error', 'error': '消息格式错误'})
            continue

        message_type = message.get('type')
        if message_type == 'ping':
            send({'type': 'result', 'text': 'pong'})
            continue
        if message_type != 'transcribe':
            send({'type': 'error', 'error': '未知请求类型'})
            continue

        def progress(stage, text):
            send({'type': 'progress', 'stage': stage, 'message': text})

        try:
            result = transcribe(message.get('url', ''), config, progress)
        except Exception as exc:
            send({'type': 'error', 'error': str(exc)})
        else:
            send({
                'type': 'result',
                'text': result['text'],
                'simplified': result['simplified'],
                'engine': result['engine'],
                'model': result['model'],
                'language': result['language'],
                'elapsed_seconds': result['elapsed_seconds'],
            })

    return 0


if __name__ == '__main__':
    sys.exit(main())
