importScripts('md5.js');

const VIEWER_PAGE = chrome.runtime.getURL('viewer.html');

function openViewer(url) {
  const target = url
    ? `${VIEWER_PAGE}?url=${encodeURIComponent(url)}`
    : VIEWER_PAGE;
  chrome.tabs.create({ url: target });
}

chrome.action.onClicked.addListener(() => openViewer());

chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-viewer') openViewer();
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'preview-image-link',
      title: '用「图片/视频/音频链接预览」打开',
      contexts: ['image', 'link']
    });
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== 'preview-image-link') return;
  const url = info.srcUrl || info.linkUrl;
  if (url && /^https?:\/\//i.test(url)) openViewer(url);
});

function hexFromBase64(value) {
  try {
    const binary = atob(value.trim());
    if (binary.length !== 16) return null;
    let hex = '';
    for (let i = 0; i < binary.length; i += 1) {
      hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    return null;
  }
}

function md5FromHeaders(headers) {
  const contentMd5 = headers.get('content-md5');
  if (contentMd5) {
    const hex = hexFromBase64(contentMd5);
    if (hex) return { md5: hex.toLowerCase(), source: 'Content-MD5' };
  }

  const etag = (headers.get('etag') || '')
    .trim()
    .replace(/^W\//, '')
    .replace(/^"+|"+$/g, '');
  if (/^[0-9a-fA-F]{32}$/.test(etag)) {
    return { md5: etag.toLowerCase(), source: 'ETag' };
  }
  return null;
}

async function computeMd5(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('仅支持 http/https 链接');

  let size = null;
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    const headerSize = Number(head.headers.get('content-length'));
    if (Number.isFinite(headerSize)) size = headerSize;

    const headerMd5 = md5FromHeaders(head.headers);
    if (head.ok && headerMd5) {
      return {
        md5: headerMd5.md5,
        size,
        source: headerMd5.source,
        status: head.status
      };
    }
  } catch {
    // HEAD 失败时继续尝试 GET
  }

  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const hasher = new Md5();
  let downloaded = 0;

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hasher.update(value);
      downloaded += value.byteLength;
    }
  } else {
    const buffer = new Uint8Array(await response.arrayBuffer());
    hasher.update(buffer);
    downloaded = buffer.byteLength;
  }

  return {
    md5: hasher.hex(),
    size: size || downloaded,
    source: '下载计算',
    status: response.status
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'computeMd5') return;
  computeMd5(String(message.url || ''))
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({ error: error && error.message ? error.message : String(error) });
    });
  return true;
});
