# 图片 / 视频 / 音频链接预览 + 本地转文字 + MD5 + 文本去重（Chrome 扩展）

[English](README.en.md)

粘贴图片、视频或音频链接即可在浏览器里直接预览，不需要下载到本地；支持音频本地 Whisper 转文字（自动繁转简、批量并行、结果自动展开）、点击复制单个文件的 MD5、一键批量导出，以及多行文本快速去重。

## 安装

1. Chrome 地址栏打开 `chrome://extensions`
2. 打开右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录 `image-link-preview`
4. 如需音频转文字：在本目录运行 `./native/install.sh`（会提示是否通过 Homebrew 安装 whisper.cpp/OpenCC、下载约 180MB 模型并注册本地转写宿主；无人值守可加 `--yes`），完成后重新加载扩展
5. 点击工具栏里的扩展图标（或按 `⌘⇧Y` / `Ctrl+Shift+Y`）打开预览页

> 如果扩展没有出现在工具栏，点浏览器右上角的拼图图标，把「图片视频音频链接预览」固定到工具栏。

> 已经装过旧版本：用新文件覆盖后，打开 `chrome://extensions` 点一下该扩展的刷新按钮即可生效。

## 使用

- 打开预览页后直接 `⌘V` / `Ctrl+V` 粘贴链接，自动识别并显示图片、视频或音频
- 支持一次粘贴多行链接，或一整段包含多个链接的文字
- 音频卡片自带播放器，直接点播放即可在线收听；点卡片空白处可在弹层里打开大播放器
- 音频卡片和音频弹层里都有「转文字」按钮，用本机 Whisper 识别出文字
- 顶部「批量转文字」可一次转写当前列表里的所有音频；「导出文字」把结果导出为 CSV
- 图片点卡片看大图，视频点卡片在弹层中播放；`←` / `→` 切换，`Esc` 关闭
- 每张卡片下方默认显示「点击获取 MD5」，点一下即计算并复制该文件的 MD5
- 大图预览里也有「复制 MD5」按钮
- 也可以右键网页上的图片或链接，选择「用「图片/视频链接预览」打开」
- 点击「文本处理」对多行文本去重，可复制结果或替换回链接列表
- 点击「导出 MD5」批量计算当前列表里所有链接的 MD5，并下载 CSV

## 音频转文字（本地 Whisper）

- 点击音频卡片或音频弹层里的「转文字」，会用本机 `whisper.cpp` 离线识别
- 识别过程：下载音频 → ffmpeg 转 16kHz 单声道 → whisper.cpp 识别（默认中文）
- 识别结果会自动用 OpenCC 做繁转简，界面状态显示「已转简体」
- 结果会显示在卡片下方或弹层里，可一键复制；识别结果会缓存在本地扩展存储里
- 默认同时最多跑 2 个识别任务（可在工具栏「并行」调整为 1–4），其余任务自动排队，避免占满 CPU
- 默认模型：`ggml-small-q5_1`（约 180MB，中文效果和速度比较均衡）；语言、线程数和繁简配置可在 `~/Library/Application Support/ImageLinkPreviewTranscriber/config.json` 修改
- 繁简转换默认用 OpenCC `t2s.json`（标准繁体 → 简体）；如需台湾用语风格转换，可把 `opencc_config` 改成 `tw2sp.json`
- 本地桥接文件：`~/Library/Application Support/ImageLinkPreviewTranscriber/`
- 安装/修复命令：`./native/install.sh`；如果移动过插件目录，扩展 ID 会变化，需要重新运行
- 识别不需要联网，也不会把音频上传到任何服务器（仅从原始链接下载音频到临时文件，识别后删除）

## 批量转文字

- 粘贴多个音频链接后，点击顶部的「批量转文字」
- 只处理当前列表里的音频（图片/视频自动跳过），已经转写过的音频会直接跳过
- 支持并行：工具栏的「并行」可选 1–4，默认按 CPU 核心数自动取（每 4 核 1 路，最高 4 路）；每个任务使用 4 个线程
- 并行数会记住，下次打开继续使用；批量运行期间下拉框会禁用，避免中途改变
- 运行中状态栏显示进度、当前运行数、成功/失败/已缓存数量
- 运行中按钮会变成「停止批量转写」，点击后会在当前音频完成后停止
- 每条音频转完后，结果面板会**自动展开**，不需要再手动点「查看文字」；也可以点「收起文字」收起
- 批量完成后可点「导出文字」一次性导出 CSV
- CSV 列：序号、文件名、链接、文字、模型、耗时(秒)、已转简体、状态（未转写的音频也会列出，状态为未转写）

## 文本处理（去重）

- 点击输入框上方的「文本处理」打开工具；首次打开会自动带入当前链接列表，之后可随时点「载入当前链接列表」同步
- 粘贴任意多行文本，每行一条；点击「去重」（或按 `⌘` / `Ctrl` + `Enter`）
- 默认保留第一次出现的顺序，并忽略行首尾空格、去除空行
- 可切换：忽略大小写、保留原顺序 / 升序 / 降序
- 结果区会显示「原始 N 行 · 保留 M 行 · 重复 X 行 · 空行 Y 行」
- 「复制结果」复制去重后的文本；「替换到链接列表」把结果写回主输入框并重新预览
- 文本工具也适用于非链接文本，例如名单、编号、关键词等

## 导出 MD5

- 先粘贴链接并预览，确认列表无误后点「导出 MD5」
- 优先用 HEAD 请求读取服务端返回的 `Content-MD5` / `ETag`（阿里云 OSS 普通上传对象的 ETag 就是文件 MD5），这种情况不下载文件
- 服务端没有提供 MD5 时，才会在后台流式读取文件并计算（不落盘）
- 导出的 CSV 列：序号、文件名、链接、MD5、文件大小(字节)、MD5来源、状态
- 对列表里的所有 http(s) 链接生效，包括格式不支持、无法直接预览的文件
- 每张卡片下方的 MD5 在导出后会一起填入，之后点击即可复制

> 点击获取 MD5 和「导出 MD5」都需要在扩展模式下使用；直接双击 `viewer.html` 的本地网页模式受浏览器跨域限制，无法读取文件，只能预览图片/视频/音频。

## 不安装扩展也能用

直接用 Chrome 打开 `viewer.html`（双击即可）就能预览图片/视频/音频；MD5、本地转文字、导出和文本处理需要在扩展中使用。

## 为什么浏览器直接打开链接会下载？

阿里云 OSS 返回了 `Content-Disposition: attachment` / `x-oss-force-download: true`，浏览器直接访问就会强制下载。本工具用 `<img>` / `<video>` / `<audio>` 标签加载，浏览器会忽略这个头，直接显示或播放。

文件由浏览器直接从链接加载（只走浏览器缓存），不会保存到下载目录。需要登录或鉴权的私有链接无法预览，因为这种请求不会带上你的登录态。

## 环境要求

- Chrome / Chromium（建议较新版本）
- 音频转文字需要 macOS 13+；预览、MD5、文本处理跨平台可用
- `native/install.sh` 需要 Homebrew、Python 3、ffmpeg；whisper.cpp 和 OpenCC 可由脚本提示安装
- Whisper small 模型约 180MB，默认存放在 `~/Library/Application Support/ImageLinkPreviewTranscriber/models/`

## 权限与隐私

- `http://*/*`、`https://*/*`：加载用户粘贴的图片/视频/音频，读取 MD5/ETag，下载音频给本地识别
- `nativeMessaging`：调用本地 Whisper 助手；native messaging 清单只允许本扩展的 origin
- `storage`：记住链接列表、转写缓存和并行数设置
- `clipboardRead` / `clipboardWrite`：读取剪贴板链接、复制 MD5/转写文字
- 没有遥测；音频只下载到临时目录，识别后删除；转写结果保存在本机扩展存储中
- whisper.cpp、OpenCC、ffmpeg 是外部依赖，通过 Homebrew 安装，不包含在本仓库中

## 项目结构

```
.
├── manifest.json          # Chrome 扩展清单
├── background.js          # MD5 请求、原生消息转发、右键菜单
├── viewer.html/css/js     # 预览页、MD5、文本处理、批量转写界面
├── md5.js                 # 增量 MD5 实现
├── native/
│   ├── install.sh         # 安装本地 Whisper 助手
│   ├── uninstall.sh       # 移除 native messaging 清单
│   └── transcriber.py     # native messaging 宿主：下载/ffmpeg/whisper/OpenCC
├── tools/
│   ├── make_icons.py      # 生成扩展图标
│   └── check.sh           # 语法校验
├── .github/workflows/     # CI 语法校验
├── README.en.md           # English README
├── LICENSE                # MIT
├── CONTRIBUTING.md
└── SECURITY.md
```

## 开发与校验

无需构建，直接「加载已解压的扩展程序」。提交前运行：

```bash
bash tools/check.sh
```

需要 Node.js 和 Python 3（仅用于语法检查）。native/ 下脚本和 manifest 改动后，重新运行 `./native/install.sh` 并在真实音频上验证。

## 已知限制

- 本地转文字目前只适配 macOS；Windows/Linux 需要自行适配 native 安装脚本
- 默认 Whisper 模型为 `small-q5_1`，中文效果/速度均衡；更高精度可替换更大的 ggml 模型
- 识别语言默认中文，可在配置文件中改为其他语言或 `auto`
- 移动插件目录后扩展 ID 会变化，需要重新运行 `./native/install.sh`
- 需要登录/鉴权的私有链接可能无法预览或转写
- 本仓库暂未发布到 Chrome Web Store；建议以 GitHub 源码 + 本地助手的方式使用

## 贡献与安全

- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全问题：[SECURITY.md](SECURITY.md)（请使用 GitHub 私密漏洞报告，不要公开敏感细节）

## 许可证

[MIT](LICENSE)，Copyright (c) 2026 kanson。

## 致谢

- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)（MIT）
- [OpenCC](https://github.com/BYVoid/OpenCC)（Apache-2.0）
- [FFmpeg](https://ffmpeg.org/)（LGPL/GPL，具体取决于构建版本）
- Chrome Extensions API
