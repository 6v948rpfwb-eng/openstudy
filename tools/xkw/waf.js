// 在 Node 里跑组卷网（阿里云 WAF）的挑战脚本，输出可用 Cookie。不启动浏览器、不抢屏幕。
// 用法: node waf.js <url>
const vm = require('vm')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'

async function cookiesFor(url) {
  const html = await (await fetch(url, { headers: { 'User-Agent': UA } })).text()
  if (!/parm_0/.test(html)) return ''
  const script = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1])[0]
  if (!script) return ''
  const p = {}
  for (const m of html.matchAll(/name="(parm_\d)"\s+value=\s*(\d+)/g)) p[m[1]] = m[2]
  const jars = []
  const loc = { href: url, protocol: 'https:', host: new URL(url).host, hostname: new URL(url).host, pathname: new URL(url).pathname, search: '', hash: '', port: '', reload() {}, replace() {}, assign() {} }
  const el = { value: '', clientWidth: 1280, clientHeight: 900, offsetWidth: 1280, offsetHeight: 900, style: {}, getAttribute: () => null, appendChild() {}, setAttribute() {} }
  const sb = {
    document: {
      location: loc, documentElement: el, body: el,
      get cookie() { return jars.join('; ') },
      set cookie(v) { jars.push(String(v).split(';')[0]) },
      getElementById: (id) => Object.assign({}, el, { value: p[id] || p.parm_0 }),
      createElement: () => el, addEventListener() {}, attachEvent() {}
    },
    location: loc,
    navigator: { userAgent: UA, platform: 'MacIntel', language: 'zh-CN' },
    screen: { width: 1512, height: 982, availWidth: 1512, availHeight: 950 },
    innerWidth: 1280, innerHeight: 900, outerWidth: 1512, outerHeight: 982,
    setTimeout: (f) => { try { f() } catch (e) {} }, setInterval() {},
    console: { log() {} }, eval, escape, unescape, encodeURIComponent, decodeURIComponent
  }
  sb.window = sb; sb.self = sb; sb.parent = sb; sb.top = sb
  try { vm.runInNewContext(script, sb, { timeout: 8000 }); if (sb.check) sb.check() } catch (e) {}
  return jars.join('; ')
}

cookiesFor(process.argv[2]).then(c => console.log(c)).catch(() => console.log(''))
