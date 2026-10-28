(() => {
  'use strict';

  const STORAGE_KEY = 'image-link-preview.text';
  const TRANSCRIPTS_KEY = 'image-link-preview.transcripts';
  const TRANSCRIBE_PARALLEL_KEY = 'image-link-preview.transcribe-parallel';
  const NATIVE_HOST = 'com.kanson.media_transcriber';
  const $ = (selector) => document.querySelector(selector);

  const input = $('#input');
  const gallery = $('#gallery');
  const emptyState = $('#empty');
  const status = $('#status');
  const previewBtn = $('#preview');
  const pasteBtn = $('#paste');
  const clearBtn = $('#clear');
  const exportBtn = $('#export-md5');
  const batchTranscribeBtn = $('#batch-transcribe');
  const exportTranscriptsBtn = $('#export-transcripts');
  const transcribeParallelSelect = $('#transcribe-parallel');

  const textToolsBtn = $('#text-tools-btn');
  const textTools = $('#text-tools');
  const ttClose = $('#tt-close');
  const ttInput = $('#tt-input');
  const ttOutput = $('#tt-output');
  const ttRun = $('#tt-run');
  const ttCopy = $('#tt-copy');
  const ttApply = $('#tt-apply');
  const ttLoad = $('#tt-load');
  const ttTrim = $('#tt-trim');
  const ttDropEmpty = $('#tt-drop-empty');
  const ttIgnoreCase = $('#tt-ignore-case');
  const ttSort = $('#tt-sort');
  const ttStats = $('#tt-stats');

  const lightbox = $('#lightbox');
  const lbImg = $('#lb-img');
  const lbVideo = $('#lb-video');
  const lbAudioWrap = $('#lb-audio-wrap');
  const lbAudio = $('#lb-audio');
  const lbAudioName = $('#lb-audio-name');
  const lbTranscribe = $('#lb-transcribe');
  const lbCopyTranscript = $('#lb-copy-transcript');
  const lbTranscript = $('#lb-transcript');
  const lbTranscriptStatus = $('#lb-transcript-status');
  const lbCounter = $('#lb-counter');
  const lbUrl = $('#lb-url');
  const lbCopy = $('#lb-copy');
  const lbCopyMd5 = $('#lb-copy-md5');
  const lbPrev = $('#lb-prev');
  const lbNext = $('#lb-next');
  const lbClose = $('#lb-close');

  let urls = [];
  let failures = 0;
  let current = -1;
  let renderToken = 0;

  const md5Cache = new Map();
  const md5Pending = new Map();
  const cardByUrl = new Map();
  const transcriptCache = new Map();
  const pendingTranscriptions = new Map();
  const transcribeJobs = [];
  let transcribeActive = 0;
  let transcribeConcurrency = 2;
  let batchRunning = false;
  let batchCancelled = false;
  let exporting = false;

  const hasExtensionStorage = () =>
    typeof chrome !== 'undefined' && !!chrome.storage && !!chrome.storage.local;

  function readStoredText() {
    return new Promise((resolve) => {
      if (hasExtensionStorage()) {
        chrome.storage.local.get(STORAGE_KEY, (data) => {
          resolve((data && data[STORAGE_KEY]) || '');
        });
        return;
      }
      try {
        resolve(localStorage.getItem(STORAGE_KEY) || '');
      } catch {
        resolve('');
      }
    });
  }

  let saveTimer = 0;
  function saveText(text, immediate = false) {
    clearTimeout(saveTimer);
    const commit = () => {
      if (hasExtensionStorage()) {
        chrome.storage.local.set({ [STORAGE_KEY]: text });
      } else {
        try {
          localStorage.setItem(STORAGE_KEY, text);
        } catch {
          /* 无法写入本地存储时忽略 */
        }
      }
    };
    if (immediate) commit();
    else saveTimer = setTimeout(commit, 400);
  }

  function readStoredTranscripts() {
    return new Promise((resolve) => {
      if (!hasExtensionStorage()) {
        resolve([]);
        return;
      }
      chrome.storage.local.get(TRANSCRIPTS_KEY, (data) => {
        const list = data && Array.isArray(data[TRANSCRIPTS_KEY]) ? data[TRANSCRIPTS_KEY] : [];
        resolve(list);
      });
    });
  }

  function updateExportTranscriptButton() {
    const hasAudio = urls.some((url) => mediaKind(url) === 'audio');
    exportTranscriptsBtn.hidden = transcriptCache.size === 0 || !hasAudio;
  }

  function saveTranscripts() {
    updateExportTranscriptButton();
    if (!hasExtensionStorage()) return;
    const list = Array.from(transcriptCache.entries());
    chrome.storage.local.set({ [TRANSCRIPTS_KEY]: list });
  }

  function defaultTranscribeConcurrency() {
    const cores = navigator.hardwareConcurrency || 8;
    return Math.max(1, Math.min(4, Math.floor(cores / 4)));
  }

  function readStoredConcurrency() {
    return new Promise((resolve) => {
      if (!hasExtensionStorage()) {
        resolve(defaultTranscribeConcurrency());
        return;
      }
      chrome.storage.local.get(TRANSCRIBE_PARALLEL_KEY, (data) => {
        const value = Number(data && data[TRANSCRIBE_PARALLEL_KEY]);
        resolve(value >= 1 && value <= 4 ? Math.round(value) : defaultTranscribeConcurrency());
      });
    });
  }

  function saveConcurrency(value) {
    if (!hasExtensionStorage()) return;
    chrome.storage.local.set({ [TRANSCRIBE_PARALLEL_KEY]: value });
  }

  function setConcurrency(value, announce) {
    const parsed = Number(value);
    transcribeConcurrency = Number.isFinite(parsed)
      ? Math.max(1, Math.min(4, Math.round(parsed)))
      : defaultTranscribeConcurrency();
    transcribeParallelSelect.value = String(transcribeConcurrency);
    saveConcurrency(transcribeConcurrency);
    pumpTranscriptionQueue();
    if (announce) setStatus(`识别并行数：${transcribeConcurrency}`);
  }

  const TRAILING_PUNCTUATION = /[)\]}>）】》」，。；：、！？"'’”“…·]+$/;

  function extractUrls(text) {
    const matches = text.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
    const result = [];
    const seen = new Set();
    for (const match of matches) {
      const candidate = match.replace(TRAILING_PUNCTUATION, '');
      if (!candidate) continue;
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      } catch {
        continue;
      }
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      result.push(candidate);
    }
    return result;
  }

  function filenameOf(url) {
    try {
      const name = new URL(url).pathname.split('/').filter(Boolean).pop();
      return name ? decodeURIComponent(name) : url;
    } catch {
      return url;
    }
  }

  const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v', 'mkv', 'avi']);
  const AUDIO_EXTENSIONS = new Set([
    'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba', 'aif', 'aiff', 'caf',
  ]);

  function mediaKind(url) {
    try {
      const pathname = new URL(url).pathname.toLowerCase();
      const name = pathname.split('/').filter(Boolean).pop() || '';
      const dot = name.lastIndexOf('.');
      const ext = dot >= 0 ? name.slice(dot + 1) : '';
      if (VIDEO_EXTENSIONS.has(ext)) return 'video';
      if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
    } catch {
      /* 解析失败按图片处理 */
    }
    return 'image';
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    const total = Math.round(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (value) => String(value).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
  }

  function showPreviewError(thumb, dims, token) {
    if (token !== renderToken) return;
    if (thumb.classList.contains('failed')) return;
    failures += 1;
    updateStatus();
    thumb.classList.add('failed');
    dims.textContent = '无法预览';
    const note = document.createElement('div');
    note.className = 'fail-note';
    const title = document.createElement('strong');
    title.textContent = '无法预览';
    note.append(title, document.createTextNode('格式不支持、链接失效，或需要登录 / 鉴权'));
    thumb.append(note);
  }

  function setStatus(text) {
    status.textContent = text;
  }

  function updateStatus() {
    if (batchRunning) return;
    if (!urls.length) {
      setStatus('');
      return;
    }
    setStatus(`共 ${urls.length} 个链接${failures ? ` · ${failures} 个无法预览` : ''}`);
  }

  function makeCard(url, index, token) {
    const kind = mediaKind(url);
    const card = document.createElement('figure');
    card.className = 'card';
    card.dataset.kind = kind;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `预览第 ${index + 1} 个链接`);

    const thumb = document.createElement('div');
    thumb.className = 'thumb';

    const dims = document.createElement('span');
    dims.className = 'dims';
    dims.textContent = '加载中…';

    if (kind === 'video') {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = url;
      video.addEventListener('loadedmetadata', () => {
        if (token !== renderToken) return;
        const size = video.videoWidth ? `${video.videoWidth} × ${video.videoHeight}` : '';
        const duration = formatDuration(video.duration);
        dims.textContent = [size, duration].filter(Boolean).join(' · ') || '视频';
        if (Number.isFinite(video.duration) && video.duration > 0.1) {
          video.currentTime = 0.1; // 取一帧做封面
        }
      });
      video.addEventListener('error', () => showPreviewError(thumb, dims, token));

      const play = document.createElement('div');
      play.className = 'play-badge';
      play.textContent = '▶';
      thumb.append(video, dims, play);
    } else if (kind === 'audio') {
      const wrap = document.createElement('div');
      wrap.className = 'audio-wrap';
      const icon = document.createElement('div');
      icon.className = 'audio-icon';
      icon.textContent = '♫';

      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      audio.src = url;
      audio.addEventListener('loadedmetadata', () => {
        if (token !== renderToken) return;
        dims.textContent = formatDuration(audio.duration) || '音频';
      });
      audio.addEventListener('error', () => showPreviewError(thumb, dims, token));

      wrap.append(icon, audio);
      thumb.append(wrap, dims);
    } else {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = `图片 ${index + 1}`;
      img.addEventListener('load', () => {
        if (token !== renderToken) return;
        dims.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
      });
      img.addEventListener('error', () => showPreviewError(thumb, dims, token));
      img.src = url;
      thumb.append(img, dims);
    }

    const caption = document.createElement('figcaption');
    const info = document.createElement('div');
    info.className = 'info';

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `#${index + 1} · ${filenameOf(url)}`;
    meta.title = url;

    const md5Line = document.createElement('span');
    md5Line.className = 'md5-line pending';
    md5Line.textContent = '点击获取 MD5';
    md5Line.title = '点击计算并复制该文件的 MD5';
    md5Line.tabIndex = 0;
    md5Line.setAttribute('role', 'button');
    const activateMd5 = (event) => {
      event.stopPropagation();
      handleMd5Click(url, md5Line);
    };
    md5Line.addEventListener('click', activateMd5);
    md5Line.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activateMd5(event);
      }
    });

    info.append(meta);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy';
    copyBtn.textContent = '复制';
    copyBtn.title = '复制链接';
    copyBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      copyText(url, copyBtn);
    });

    let transcribeBtn = null;
    let transcriptPanel = null;

    if (kind === 'audio') {
      transcribeBtn = document.createElement('button');
      transcribeBtn.type = 'button';
      transcribeBtn.className = 'copy transcribe';
      transcribeBtn.textContent = '转文字';
      transcribeBtn.title = '用本机 Whisper 把音频转成文字';
      transcribeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleCardTranscript(url, card, transcribeBtn);
      });

      transcriptPanel = document.createElement('div');
      transcriptPanel.className = 'card-transcript';
      transcriptPanel.hidden = true;

      const transcriptStatus = document.createElement('div');
      transcriptStatus.className = 'transcript-status';
      const transcriptText = document.createElement('div');
      transcriptText.className = 'transcript-text';
      const transcriptActions = document.createElement('div');
      transcriptActions.className = 'transcript-actions';
      const transcriptCopy = document.createElement('button');
      transcriptCopy.type = 'button';
      transcriptCopy.className = 'copy';
      transcriptCopy.textContent = '复制文字';
      transcriptCopy.hidden = true;
      transcriptCopy.addEventListener('click', (event) => {
        event.stopPropagation();
        if (transcriptText.textContent) copyText(transcriptText.textContent, transcriptCopy);
      });
      transcriptActions.append(transcriptCopy);
      transcriptActions.hidden = true;
      transcriptPanel.append(transcriptStatus, transcriptText, transcriptActions);
    }

    const captionItems = [info, copyBtn];
    if (transcribeBtn) captionItems.push(transcribeBtn);
    captionItems.push(md5Line);
    caption.append(...captionItems);

    if (transcriptPanel) {
      card.append(thumb, caption, transcriptPanel);
      const cachedTranscript = transcriptCache.get(url);
      if (cachedTranscript) {
        fillTranscriptPanel(transcriptPanel, cachedTranscript, false);
        transcribeBtn.textContent = '查看文字';
      }
    } else {
      card.append(thumb, caption);
    }

    cardByUrl.set(url, card);
    if (md5Cache.has(url)) {
      renderMd5Line(md5Line, md5Cache.get(url));
    }

    const open = () => openLightbox(index);
    card.addEventListener('click', (event) => {
      if (event.target.closest('video, audio, .md5-line, .card-transcript, .transcribe')) return;
      open();
    });
    card.addEventListener('keydown', (event) => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });

    return card;
  }

  function render() {
    renderToken += 1;
    const token = renderToken;
    gallery.replaceChildren();
    cardByUrl.clear();
    failures = 0;
    current = -1;
    emptyState.hidden = urls.length > 0;
    gallery.hidden = urls.length === 0;
    updateExportTranscriptButton();

    if (!urls.length) {
      updateStatus();
      return;
    }

    const fragment = document.createDocumentFragment();
    urls.forEach((url, index) => {
      fragment.append(makeCard(url, index, token));
    });
    gallery.append(fragment);
    updateStatus();
  }

  function parseAndRender() {
    urls = extractUrls(input.value);
    render();
    if (!urls.length && input.value.trim()) {
      setStatus('没有识别到链接（需要以 http:// 或 https:// 开头）');
    }
    saveText(input.value, true);
  }

  function dedupeLines(text, options) {
    const normalized = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    const lines = normalized.split('\n');
    const seen = new Set();
    const output = [];
    let duplicates = 0;
    let empty = 0;

    for (let line of lines) {
      if (options.trim) line = line.trim();
      if (options.dropEmpty && line === '') {
        empty += 1;
        continue;
      }
      const key = options.ignoreCase ? line.toLowerCase() : line;
      if (seen.has(key)) {
        duplicates += 1;
        continue;
      }
      seen.add(key);
      output.push(line);
    }

    if (options.sort === 'asc') output.sort((a, b) => a.localeCompare(b));
    if (options.sort === 'desc') output.sort((a, b) => b.localeCompare(a));

    return {
      lines: output,
      total: lines.length,
      duplicates,
      empty,
    };
  }

  function setTextToolsStats(text) {
    ttStats.textContent = text;
  }

  function openTextTools() {
    textTools.hidden = false;
    document.body.classList.add('text-tools-open');

    let prefilled = false;
    if (!ttInput.value.trim() && input.value.trim()) {
      ttInput.value = input.value;
      prefilled = true;
    }
    if (prefilled) {
      ttOutput.value = '';
      setTextToolsStats('');
    }

    ttInput.focus();
    if (prefilled) ttInput.select();
  }

  function closeTextTools() {
    textTools.hidden = true;
    document.body.classList.remove('text-tools-open');
    textToolsBtn.focus();
  }

  function runDedupe() {
    const source = ttInput.value;
    if (!source.trim()) {
      ttOutput.value = '';
      setTextToolsStats('没有可处理的文本');
      return;
    }

    const result = dedupeLines(source, {
      trim: ttTrim.checked,
      dropEmpty: ttDropEmpty.checked,
      ignoreCase: ttIgnoreCase.checked,
      sort: ttSort.value,
    });
    ttOutput.value = result.lines.join('\n');

    const parts = [`原始 ${result.total} 行`, `保留 ${result.lines.length} 行`];
    if (result.duplicates) parts.push(`重复 ${result.duplicates} 行`);
    if (result.empty) parts.push(`空行 ${result.empty} 行`);
    if (ttSort.value !== 'none') parts.push(ttSort.value === 'asc' ? '已升序' : '已降序');
    setTextToolsStats(parts.join(' · '));
  }

  function loadCurrentLinks() {
    if (!input.value.trim()) {
      setTextToolsStats('当前链接列表为空');
      return;
    }
    ttInput.value = input.value;
    ttOutput.value = '';
    setTextToolsStats('');
    ttInput.focus();
    ttInput.select();
  }

  function applyTextResult() {
    let value = ttOutput.value;
    if (!value && ttInput.value.trim()) {
      runDedupe();
      value = ttOutput.value;
    }
    if (!value) {
      setTextToolsStats('没有可应用的结果，先点「去重」');
      return;
    }

    input.value = value;
    closeTextTools();
    parseAndRender();
    setStatus(`已应用去重结果 · ${value.split('\n').length} 行`);
  }

  function openLightbox(index) {
    if (!urls.length) return;
    document.querySelectorAll('.thumb audio, .thumb video').forEach((media) => media.pause());
    current = index;
    updateLightbox();
    lightbox.hidden = false;
    document.body.classList.add('lightbox-open');
    lbClose.focus();
  }

  function stopLightboxMedia() {
    for (const media of [lbVideo, lbAudio]) {
      media.pause();
      media.removeAttribute('src');
      media.load();
    }
    lbImg.removeAttribute('src');
  }

  function updateLightbox() {
    const url = urls[current];
    if (!url) return;

    stopLightboxMedia();
    const kind = mediaKind(url);
    lbImg.hidden = kind !== 'image';
    lbVideo.hidden = kind !== 'video';
    lbAudioWrap.hidden = kind !== 'audio';

    resetLightboxTranscript();
    if (kind === 'audio' && transcriptCache.has(url)) {
      lbTranscribe.textContent = '查看文字';
    }

    if (kind === 'image') {
      lbImg.src = url;
      lbImg.alt = `图片 ${current + 1}`;
    } else if (kind === 'video') {
      lbVideo.src = url;
      lbVideo.setAttribute('aria-label', `视频 ${current + 1}`);
    } else {
      lbAudio.src = url;
      lbAudioName.textContent = filenameOf(url);
    }

    lbCounter.textContent = `${current + 1} / ${urls.length}`;
    lbUrl.textContent = url;
    lbUrl.title = url;
    lbPrev.disabled = urls.length < 2;
    lbNext.disabled = urls.length < 2;
  }

  function closeLightbox() {
    lightbox.hidden = true;
    stopLightboxMedia();
    document.body.classList.remove('lightbox-open');
    input.focus();
  }

  function step(delta) {
    if (lightbox.hidden || urls.length === 0) return;
    current = (current + delta + urls.length) % urls.length;
    updateLightbox();
  }

  async function copyText(text, button) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const helper = document.createElement('textarea');
      helper.value = text;
      helper.setAttribute('readonly', '');
      helper.style.position = 'fixed';
      helper.style.opacity = '0';
      document.body.append(helper);
      helper.select();
      try {
        document.execCommand('copy');
      } catch {
        /* 复制失败时忽略 */
      }
      helper.remove();
    }

    if (button) {
      const original = button.textContent;
      button.textContent = '已复制';
      button.classList.add('done');
      setTimeout(() => {
        button.textContent = original;
        button.classList.remove('done');
      }, 1200);
    }
  }

  function renderMd5Line(line, result) {
    line.hidden = false;
    line.classList.remove('pending', 'bad');
    if (result && result.md5) {
      line.textContent = `MD5 ${result.md5}`;
      line.title = '点击复制 MD5';
      line.dataset.md5 = result.md5;
    } else {
      const reason = result && result.error ? result.error : '获取失败';
      line.textContent = `MD5 失败：${reason}（点击重试）`;
      line.title = '点击重试';
      delete line.dataset.md5;
      line.classList.add('bad');
    }
  }

  async function handleMd5Click(url, line) {
    if (line.dataset.busy === '1') return;

    if (line.dataset.md5) {
      await copyText(line.dataset.md5, null);
      setStatus('MD5 已复制');
      return;
    }

    line.dataset.busy = '1';
    line.classList.remove('pending', 'bad');
    line.textContent = '计算 MD5 中…';
    line.title = '';

    try {
      const result = await requestMd5(url);
      renderMd5Line(line, result);
      if (result && result.md5) {
        await copyText(result.md5, null);
        setStatus('MD5 已复制');
      } else {
        setStatus(`MD5 获取失败：${result && result.error ? result.error : '未知错误'}`);
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      renderMd5Line(line, { error: message });
      setStatus(`MD5 获取失败：${message}`);
    } finally {
      delete line.dataset.busy;
    }
  }

  function applyMd5ToCard(url, result) {
    const card = cardByUrl.get(url);
    if (!card) return;
    const line = card.querySelector('.md5-line');
    if (line) renderMd5Line(line, result);
  }

  async function requestMd5(url) {
    if (md5Cache.has(url)) return md5Cache.get(url);
    if (md5Pending.has(url)) return md5Pending.get(url);
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      throw new Error('请在 Chrome 扩展模式下使用');
    }

    const promise = (async () => {
      const result = await chrome.runtime.sendMessage({ type: 'computeMd5', url });
      if (!result) throw new Error('后台没有返回结果');
      if (result.md5) md5Cache.set(url, result);
      return result;
    })();

    md5Pending.set(url, promise);
    try {
      return await promise;
    } finally {
      md5Pending.delete(url);
    }
  }

  function nativeErrorMessage(error) {
    const message = error && error.message ? error.message : String(error);
    if (/Specified native messaging host not found|native messaging host not found/i.test(message)) {
      return '未安装本地转写助手：请先在插件目录运行 native/install.sh，然后重新加载扩展';
    }
    if (/Access to the specified native messaging host is forbidden/i.test(message)) {
      return '本地转写助手未授权给当前扩展：插件目录变化后请重新运行 native/install.sh';
    }
    return message;
  }

  function transcribeAudio(url, onProgress) {
    return new Promise((resolve, reject) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connectNative) {
        reject(new Error('转文字需要在 Chrome 扩展模式下使用'));
        return;
      }

      let port;
      try {
        port = chrome.runtime.connectNative(NATIVE_HOST);
      } catch (error) {
        reject(new Error(nativeErrorMessage(error)));
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { port.disconnect(); } catch { /* ignore */ }
        reject(new Error('本地识别超时（超过 10 分钟）'));
      }, 10 * 60 * 1000);

      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try { port.disconnect(); } catch { /* ignore */ }
        callback(value);
      };

      port.onMessage.addListener((message) => {
        if (settled || !message) return;
        if (message.type === 'progress') {
          if (onProgress) onProgress(message);
        } else if (message.type === 'result') {
          finish(resolve, message);
        } else if (message.type === 'error') {
          finish(reject, new Error(message.error || '本地识别失败'));
        }
      });

      port.onDisconnect.addListener(() => {
        if (settled) return;
        const lastError = chrome.runtime.lastError;
        const message = lastError && lastError.message ? lastError.message : '本地转写助手已断开';
        finish(reject, new Error(nativeErrorMessage(message)));
      });

      try {
        port.postMessage({ type: 'transcribe', url });
      } catch (error) {
        finish(reject, new Error(nativeErrorMessage(error)));
      }
    });
  }

  function queueTranscription(url, onProgress) {
    if (pendingTranscriptions.has(url)) return pendingTranscriptions.get(url);

    const promise = new Promise((resolve, reject) => {
      transcribeJobs.push({ url, onProgress, resolve, reject });
      pumpTranscriptionQueue();
    });
    pendingTranscriptions.set(url, promise);
    promise.then(
      () => pendingTranscriptions.delete(url),
      () => pendingTranscriptions.delete(url),
    );
    return promise;
  }

  function pumpTranscriptionQueue() {
    while (transcribeActive < Math.max(1, transcribeConcurrency) && transcribeJobs.length > 0) {
      const job = transcribeJobs.shift();
      transcribeActive += 1;
      (async () => {
        try {
          job.resolve(await transcribeAudio(job.url, job.onProgress));
        } catch (error) {
          job.reject(error);
        } finally {
          transcribeActive -= 1;
          pumpTranscriptionQueue();
        }
      })();
    }
  }

  function fillTranscriptPanel(panel, result, show) {
    const status = panel.querySelector('.transcript-status');
    const text = panel.querySelector('.transcript-text');
    const actions = panel.querySelector('.transcript-actions');
    const copy = panel.querySelector('.transcript-actions .copy');
    status.classList.remove('error');
    const model = result.model ? ` · ${result.model}` : '';
    const elapsed = result.elapsed_seconds != null ? ` · ${result.elapsed_seconds}s` : '';
    const simplified = result.simplified ? ' · 已转简体' : '';
    status.textContent = `本地识别${model}${elapsed}${simplified}`;
    text.textContent = result.text || '';
    copy.hidden = !result.text;
    actions.hidden = !result.text;
    if (show) panel.hidden = false;
  }

  function fillTranscriptPanelError(panel, message) {
    const status = panel.querySelector('.transcript-status');
    const text = panel.querySelector('.transcript-text');
    const actions = panel.querySelector('.transcript-actions');
    const copy = panel.querySelector('.transcript-actions .copy');
    status.classList.add('error');
    status.textContent = message;
    text.textContent = '';
    copy.hidden = true;
    actions.hidden = true;
    panel.hidden = false;
  }

  function syncLightboxTranscript(url, result) {
    if (lightbox.hidden || urls[current] !== url) return;
    lbTranscript.textContent = result.text || '';
    lbTranscript.hidden = false;
    lbCopyTranscript.hidden = !result.text;
    lbTranscriptStatus.classList.remove('error');
    lbTranscriptStatus.textContent = result.simplified ? '本地识别完成 · 已转简体' : '本地识别完成';
    lbTranscribe.textContent = '收起文字';
    lbTranscribe.disabled = false;
    delete lbTranscribe.dataset.busy;
  }

  async function toggleCardTranscript(url, card, button) {
    const panel = card.querySelector('.card-transcript');
    if (!panel) return;

    const cached = transcriptCache.get(url);
    if (cached) {
      const show = panel.hidden;
      if (show) fillTranscriptPanel(panel, cached, true);
      else panel.hidden = true;
      button.textContent = show ? '收起文字' : '查看文字';
      return;
    }

    if (batchRunning) {
      setStatus('批量转写正在运行，请稍候');
      return;
    }
    if (button.dataset.busy === '1') return;
    button.dataset.busy = '1';
    button.disabled = true;
    button.textContent = '识别中…';
    panel.hidden = false;

    const status = panel.querySelector('.transcript-status');
    const text = panel.querySelector('.transcript-text');
    const copy = panel.querySelector('.transcript-actions .copy');
    status.classList.remove('error');
    const queued = transcribeActive >= transcribeConcurrency || transcribeJobs.length > 0;
    status.textContent = queued ? '排队中…' : '准备本地识别…';
    text.textContent = '';
    copy.hidden = true;

    try {
      const result = await queueTranscription(url, (progress) => {
        status.textContent = progress.message || '本地识别中…';
      });
      transcriptCache.set(url, result);
      saveTranscripts();
      fillTranscriptPanel(panel, result, true);
      button.textContent = '收起文字';
      syncLightboxTranscript(url, result);
    } catch (error) {
      fillTranscriptPanelError(panel, `识别失败：${nativeErrorMessage(error)}`);
      button.textContent = '重试';
      button.disabled = false;
      delete button.dataset.busy;
      return;
    }

    button.disabled = false;
    delete button.dataset.busy;
  }

  function resetLightboxTranscript() {
    lbTranscript.hidden = true;
    lbTranscript.textContent = '';
    lbCopyTranscript.hidden = true;
    lbTranscriptStatus.textContent = '';
    lbTranscriptStatus.classList.remove('error');
    lbTranscribe.disabled = false;
    delete lbTranscribe.dataset.busy;
    lbTranscribe.textContent = '转文字';
  }

  async function transcribeCurrentAudio() {
    const url = urls[current];
    if (!url || mediaKind(url) !== 'audio') return;

    const cached = transcriptCache.get(url);
    if (cached) {
      const show = lbTranscript.hidden;
      if (show) {
        lbTranscript.textContent = cached.text || '';
        lbTranscript.hidden = false;
        lbCopyTranscript.hidden = !cached.text;
        lbTranscriptStatus.classList.remove('error');
        lbTranscriptStatus.textContent = cached.simplified ? '本地识别 · 已转简体' : '本地识别';
        lbTranscribe.textContent = '收起文字';
      } else {
        lbTranscript.hidden = true;
        lbTranscribe.textContent = '查看文字';
      }
      return;
    }

    if (batchRunning) {
      setStatus('批量转写正在运行，请稍候');
      return;
    }
    if (lbTranscribe.dataset.busy === '1') return;
    lbTranscribe.dataset.busy = '1';
    lbTranscribe.disabled = true;
    lbTranscribe.textContent = '识别中…';
    lbTranscript.hidden = false;
    lbTranscript.textContent = '';
    lbCopyTranscript.hidden = true;
    lbTranscriptStatus.classList.remove('error');
    const queued = transcribeActive >= transcribeConcurrency || transcribeJobs.length > 0;
    lbTranscriptStatus.textContent = queued ? '排队中…' : '准备本地识别…';

    try {
      const result = await queueTranscription(url, (progress) => {
        lbTranscriptStatus.textContent = progress.message || '本地识别中…';
      });
      transcriptCache.set(url, result);
      saveTranscripts();

      const card = cardByUrl.get(url);
      if (card) {
        const panel = card.querySelector('.card-transcript');
        const button = card.querySelector('.transcribe');
        if (panel) fillTranscriptPanel(panel, result, false);
        if (button) {
          button.textContent = '查看文字';
          button.disabled = false;
          delete button.dataset.busy;
        }
      }

      if (urls[current] !== url || lightbox.hidden) return;
      lbTranscript.textContent = result.text || '';
      lbTranscript.hidden = false;
      lbCopyTranscript.hidden = !result.text;
      lbTranscriptStatus.classList.remove('error');
      lbTranscriptStatus.textContent = result.simplified ? '本地识别完成 · 已转简体' : '本地识别完成';
      lbTranscribe.textContent = '收起文字';
    } catch (error) {
      if (urls[current] === url && !lightbox.hidden) {
        lbTranscriptStatus.classList.add('error');
        lbTranscriptStatus.textContent = `识别失败：${nativeErrorMessage(error)}`;
        lbTranscribe.textContent = '重试';
      }
      const card = cardByUrl.get(url);
      if (card) {
        const button = card.querySelector('.transcribe');
        if (button) {
          button.textContent = '重试';
          button.disabled = false;
          delete button.dataset.busy;
        }
      }
    } finally {
      lbTranscribe.disabled = false;
      delete lbTranscribe.dataset.busy;
    }
  }

  function exportTranscripts() {
    const audioUrls = urls.filter((url) => mediaKind(url) === 'audio');
    if (!audioUrls.length) {
      setStatus('当前列表没有音频链接');
      return;
    }

    const rows = [['序号', '文件名', '链接', '文字', '模型', '耗时(秒)', '已转简体', '状态']];
    let transcribed = 0;
    audioUrls.forEach((url, index) => {
      const result = transcriptCache.get(url);
      if (result) transcribed += 1;
      rows.push([
        index + 1,
        filenameOf(url),
        url,
        result ? result.text : '',
        result ? result.model || '' : '',
        result && result.elapsed_seconds != null ? result.elapsed_seconds : '',
        result ? (result.simplified ? '是' : '否') : '',
        result ? '已转写' : '未转写',
      ]);
    });

    downloadCsv(rows, `Transcriptions-${fileTimestamp()}.csv`);
    setStatus(`已导出 ${transcribed}/${audioUrls.length} 条转写结果`);
  }

  async function batchTranscribe() {
    if (batchRunning) {
      batchCancelled = true;
      batchTranscribeBtn.textContent = '停止中…';
      return;
    }

    const audioUrls = urls.filter((url) => mediaKind(url) === 'audio');
    if (!audioUrls.length) {
      setStatus('当前列表没有音频链接');
      return;
    }

    const pending = audioUrls.filter((url) => !transcriptCache.has(url));
    const cached = audioUrls.length - pending.length;
    if (!pending.length) {
      setStatus(`所有音频都已经转写过了${cached ? `（${cached} 条）` : ''}`);
      updateExportTranscriptButton();
      return;
    }

    batchRunning = true;
    batchCancelled = false;
    batchTranscribeBtn.classList.add('stop');
    batchTranscribeBtn.textContent = '停止批量转写';
    transcribeParallelSelect.disabled = true;

    const total = pending.length;
    const workerCount = Math.min(Math.max(1, transcribeConcurrency), total);
    let nextIndex = 0;
    let done = 0;
    let success = 0;
    let failed = 0;

    const updateBatchStatus = () => {
      setStatus(`批量转文字 ${done}/${total} · 运行中 ${transcribeActive} · 成功 ${success} · 失败 ${failed}`
        + `${cached ? ` · 已缓存 ${cached}` : ''}`);
    };
    setStatus(`批量转文字 0/${total} · 运行中 0${cached ? ` · 已缓存 ${cached}` : ''}`);

    async function worker() {
      for (;;) {
        if (batchCancelled) return;
        const index = nextIndex;
        nextIndex += 1;
        if (index >= pending.length) return;

        const url = pending[index];
        const card = cardByUrl.get(url);
        const button = card ? card.querySelector('.transcribe') : null;
        const panel = card ? card.querySelector('.card-transcript') : null;

        if (button) {
          button.dataset.busy = '1';
          button.disabled = true;
          button.textContent = '识别中…';
        }
        if (panel) {
          const statusLine = panel.querySelector('.transcript-status');
          statusLine.classList.remove('error');
          statusLine.textContent = '准备本地识别…';
          panel.querySelector('.transcript-text').textContent = '';
          panel.querySelector('.transcript-actions').hidden = true;
        }

        try {
          const result = await queueTranscription(url, (progress) => {
            if (panel) {
              const statusLine = panel.querySelector('.transcript-status');
              statusLine.classList.remove('error');
              statusLine.textContent = progress.message || '本地识别中…';
            }
            updateBatchStatus();
          });
          transcriptCache.set(url, result);
          saveTranscripts();
          success += 1;
          if (panel) fillTranscriptPanel(panel, result, true);
          if (button) {
            button.textContent = '收起文字';
            button.disabled = false;
            delete button.dataset.busy;
          }
        } catch (error) {
          failed += 1;
          if (panel) fillTranscriptPanelError(panel, `识别失败：${nativeErrorMessage(error)}`);
          if (button) {
            button.textContent = '重试';
            button.disabled = false;
            delete button.dataset.busy;
          }
        }

        done += 1;
        updateBatchStatus();
      }
    }

    try {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } finally {
      const stopped = batchCancelled;
      batchRunning = false;
      batchCancelled = false;
      batchTranscribeBtn.classList.remove('stop');
      batchTranscribeBtn.textContent = '批量转文字';
      transcribeParallelSelect.disabled = false;
      updateExportTranscriptButton();
      setStatus(`批量转文字${stopped ? '已停止' : '完成'} · 成功 ${success} · 失败 ${failed}`
        + `${cached ? ` · 已缓存 ${cached}` : ''}`);
    }
  }

  function csvCell(value) {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function fileTimestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
      + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  function downloadCsv(rows, filename) {
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    const objectUrl = URL.createObjectURL(blob);
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);
  }

  async function exportMd5() {
    if (exporting) return;
    if (!urls.length) {
      setStatus('先粘贴链接，再导出 MD5');
      return;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      setStatus('导出 MD5 需要在 Chrome 扩展中打开（本地网页模式不支持）');
      return;
    }

    exporting = true;
    exportBtn.disabled = true;
    exportBtn.textContent = '计算中…';

    const list = urls.slice();
    const results = new Array(list.length);
    let cursor = 0;
    let done = 0;
    let success = 0;
    let failed = 0;

    setStatus(`正在计算 MD5 0/${list.length}…`);

    async function worker() {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= list.length) return;

        const url = list[index];
        let result;
        try {
          result = await requestMd5(url);
        } catch (error) {
          result = { error: error && error.message ? error.message : String(error) };
        }

        results[index] = result;
        if (result && result.md5) success += 1;
        else failed += 1;
        done += 1;

        setStatus(`正在计算 MD5 ${done}/${list.length} · 成功 ${success} · 失败 ${failed}`);
        applyMd5ToCard(url, result);
      }
    }

    try {
      const workerCount = Math.min(4, list.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      const rows = [['序号', '文件名', '链接', 'MD5', '文件大小(字节)', 'MD5来源', '状态']];
      list.forEach((url, index) => {
        const result = results[index] || { error: '未计算' };
        rows.push([
          index + 1,
          filenameOf(url),
          url,
          result.md5 || '',
          result.size != null ? result.size : '',
          result.source || '',
          result.md5 ? '成功' : (result.error || '失败'),
        ]);
      });

      downloadCsv(rows, `MD5-${fileTimestamp()}.csv`);
      setStatus(`已导出 ${list.length} 条 · 成功 ${success} · 失败 ${failed}`);
    } catch (error) {
      setStatus(`导出失败：${error && error.message ? error.message : error}`);
    } finally {
      exporting = false;
      exportBtn.disabled = false;
      exportBtn.textContent = '导出 MD5';
    }
  }

  async function copyCurrentMd5() {
    if (lbCopyMd5.disabled) return;
    const url = urls[current];
    if (!url) return;

    const original = lbCopyMd5.textContent;
    lbCopyMd5.disabled = true;
    lbCopyMd5.textContent = '计算中…';

    try {
      const result = await requestMd5(url);
      if (result && result.md5) {
        await copyText(result.md5, null);
        setStatus('MD5 已复制');
        const card = cardByUrl.get(url);
        if (card) {
          const line = card.querySelector('.md5-line');
          if (line) renderMd5Line(line, result);
        }
        lbCopyMd5.textContent = '已复制';
        setTimeout(() => {
          lbCopyMd5.textContent = original;
        }, 1200);
      } else {
        setStatus(`MD5 获取失败：${result && result.error ? result.error : '未知错误'}`);
        lbCopyMd5.textContent = original;
      }
    } catch (error) {
      setStatus(`MD5 获取失败：${error && error.message ? error.message : error}`);
      lbCopyMd5.textContent = original;
    } finally {
      lbCopyMd5.disabled = false;
    }
  }

  previewBtn.addEventListener('click', parseAndRender);
  exportBtn.addEventListener('click', exportMd5);
  batchTranscribeBtn.addEventListener('click', batchTranscribe);
  exportTranscriptsBtn.addEventListener('click', exportTranscripts);
  transcribeParallelSelect.addEventListener('change', () => {
    setConcurrency(transcribeParallelSelect.value, true);
  });

  input.addEventListener('paste', () => setTimeout(parseAndRender, 0));

  input.addEventListener('input', () => {
    saveText(input.value);
    if (!input.value.trim() && urls.length) {
      urls = [];
      render();
    }
  });

  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setStatus('剪贴板是空的');
        return;
      }
      input.value = text;
      parseAndRender();
    } catch {
      setStatus('无法读取剪贴板，请点一下输入框后按 ⌘V / Ctrl+V');
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    urls = [];
    render();
    saveText('', true);
    input.focus();
  });

  textToolsBtn.addEventListener('click', openTextTools);
  ttClose.addEventListener('click', closeTextTools);
  textTools.addEventListener('click', (event) => {
    if (event.target === textTools) closeTextTools();
  });
  ttRun.addEventListener('click', runDedupe);
  ttApply.addEventListener('click', applyTextResult);
  ttLoad.addEventListener('click', loadCurrentLinks);
  ttCopy.addEventListener('click', () => {
    if (!ttOutput.value) {
      setTextToolsStats('还没有去重结果，先点「去重」');
      return;
    }
    copyText(ttOutput.value, ttCopy);
    setTextToolsStats(`已复制 ${ttOutput.value.split('\n').length} 行`);
  });
  ttInput.addEventListener('input', () => {
    ttOutput.value = '';
    setTextToolsStats('');
  });
  for (const control of [ttTrim, ttDropEmpty, ttIgnoreCase, ttSort]) {
    control.addEventListener('change', () => {
      if (ttOutput.value) runDedupe();
    });
  }

  // 页面任意位置粘贴都能直接预览
  document.addEventListener('paste', (event) => {
    if (!lightbox.hidden || !textTools.hidden || event.target === input) return;
    const text = event.clipboardData && event.clipboardData.getData('text');
    if (!text) return;
    event.preventDefault();
    input.value = text;
    parseAndRender();
  });

  // 同一时间只播放一个音频 / 视频
  document.addEventListener('play', (event) => {
    const media = event.target;
    if (!(media instanceof HTMLMediaElement)) return;
    document.querySelectorAll('audio, video').forEach((other) => {
      if (other !== media && !other.paused) other.pause();
    });
  }, true);

  lbClose.addEventListener('click', closeLightbox);
  lbPrev.addEventListener('click', () => step(-1));
  lbNext.addEventListener('click', () => step(1));
  lbCopy.addEventListener('click', () => {
    if (current >= 0 && urls[current]) copyText(urls[current], lbCopy);
  });
  lbCopyMd5.addEventListener('click', copyCurrentMd5);
  lbTranscribe.addEventListener('click', transcribeCurrentAudio);
  lbCopyTranscript.addEventListener('click', () => {
    const text = lbTranscript.textContent || '';
    if (text) copyText(text, lbCopyTranscript);
  });

  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox || event.target.classList.contains('lb-stage')) {
      closeLightbox();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (!textTools.hidden) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTextTools();
      } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        runDedupe();
      }
      return;
    }
    if (!lightbox.hidden) {
      const onMedia = event.target instanceof Element
        && !!event.target.closest('video, audio');
      if (event.key === 'Escape') {
        event.preventDefault();
        closeLightbox();
      } else if (!onMedia && event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (!onMedia && event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      parseAndRender();
    }
  });

  async function init() {
    const params = new URLSearchParams(location.search);
    const initialUrls = params.getAll('url').filter((url) => /^https?:\/\//i.test(url));
    const stored = await readStoredText();
    const storedTranscripts = await readStoredTranscripts();
    for (const entry of storedTranscripts) {
      if (Array.isArray(entry) && entry.length === 2
          && typeof entry[0] === 'string'
          && entry[1] && typeof entry[1].text === 'string') {
        transcriptCache.set(entry[0], entry[1]);
      }
    }
    transcribeConcurrency = await readStoredConcurrency();
    transcribeParallelSelect.value = String(transcribeConcurrency);
    let text = stored;

    if (initialUrls.length) {
      text = initialUrls.join('\n') + (stored ? '\n' + stored : '');
    }

    if (text.trim()) {
      input.value = text;
      urls = extractUrls(text);
      render();
      saveText(text, true);
    } else {
      emptyState.hidden = false;
      gallery.hidden = true;
    }
    input.focus();
  }

  init();
})();
