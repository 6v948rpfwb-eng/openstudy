// 后台无窗口浏览器：用 DSH 自带 Electron 渲染页面，取 DOM / 资源 URL，不抢屏幕
// 用法: "/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness" render.js <mode> <url> [out.json]
const { app, BrowserWindow } = require('electron')
const fs = require('fs')

const mode = process.argv[2]
const url = process.argv[3]
const out = process.argv[4] || ''

app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')

async function main() {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true } })
  try {
    await win.loadURL(url, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' })
  } catch (e) { /* WAF 页也可能算加载完成 */ }
  await new Promise(r => setTimeout(r, 4000))

  let result = null
  if (mode === 'qids') {
    result = await win.webContents.executeJavaScript(`(() => {
      const html = document.documentElement.innerHTML;
      const pre = ${JSON.stringify(new URL(url).pathname.match(/\/(\d+)p/)?.[1] || '13')};
      const re = new RegExp(pre + 'q(\\\\d{6,})', 'g');
      const ids = [...new Set([...html.matchAll(re)].map(m => m[1]))];
      return { title: document.title, qids: ids };
    })()`)
  } else if (mode === 'answer') {
    result = await win.webContents.executeJavaScript(`(() => {
      const urls = performance.getEntriesByType('resource').map(e => e.name).filter(u => /getAnswerAndParse/.test(u));
      return { title: document.title, url: urls.slice(-1)[0] || null, body: (document.body.innerText||'').slice(0, 200) };
    })()`)
  } else if (mode === 'text') {
    result = await win.webContents.executeJavaScript('({ title: document.title, text: (document.body.innerText||"").slice(0, 4000) })')
  }
  const s = JSON.stringify(result, null, 1)
  if (out) fs.writeFileSync(out, s)
  process.stdout.write(s + '\n')
  win.destroy()
  app.quit()
}

app.whenReady().then(main).catch(e => { console.error('ERR', e.message); app.quit() })
