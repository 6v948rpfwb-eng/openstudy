# 组卷网抓取探测结论（2026-10-23）

## 已验证可行
1. Safari 里开「开发 → 允许来自 Apple 事件的 JavaScript」后，`osascript -e 'tell application "Safari" to do JavaScript "<code>" in current tab of front window'` 可直接操作页面（`defaults write com.apple.Safari AllowJavaScriptFromAppleEvents -bool true` 即时生效，无需重启）。
2. 试卷页 `https://zujuan.xkw.com/13p<paperId>.html` 是服务端渲染：`section.exam-list > div.sec-item > div.sec-list > div.tk-quest-item.quesroot`，每题 `innerText` 含题干+选项+来源。
3. 题图在 `https://img.xkw.com/dksih/QBM/editorImg/...png`，**无需登录即可 curl 下载**（实测 200，1259×1566）。公式是 `staticzujuan.xkw.com/quesimg/Upload/formula/*.svg`。
4. 每题「详情」链接为 `https://zujuan.xkw.com/13q<quesId>.html`。

## 答案拿不到的原因
- 单题页的答案/解析是图片：`https://imzujuan.xkw.com/getAnswerAndParse/<quesId>/13/<hash>?enVqdWFu=<base64 token>&width=884`。
- curl 直接下（带 UA/Referer）返回 200 但内容是 414×30 的图：「(403) 您没有权限查看组卷网答案解析，请直接访问站点查看！」——服务端校验会话 Cookie。
- 页内 `fetch(src)` 被 CORS 拦（`TypeError: Load failed`），canvas 取 `toDataURL` 也会被污染。

## 结论路径
- 题干+插图：直接抓页面（免费、稳）。
- 答案：只能「已渲染的浏览器画面」里拿 —— 要么整页截图 OCR，要么让用户从浏览器导出 PDF（⌘P → 存储为 PDF，图会保留），我再 `tools/ocr/pdfraster` 光栅化 + `tools/ocr/ocr` 识别。
- 若「试卷下载」能拿到 docx/zip（需积分或会员），那是最优：`unzip` 后 `word/media/*.png` 就是原图，答案也是文本，无需 OCR。

## 本机已备好的工具
- `tools/ocr/ocr.swift` → `ocr`：Swift + Vision，离线 OCR，`recognitionLanguages=["zh-Hans","en-US"]`，`usesLanguageCorrection=false`。实测能读出「【答案】B」「【详解】…mgcosθ」这种混排版。
- `tools/ocr/pdfraster.swift` → `pdfraster <in.pdf> <outdir> [scale]`：PDFKit 逐页光栅化（默认 2 倍），实测 12 页技术卷正常出图。
