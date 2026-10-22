#!/usr/bin/env node
/**
 * serve.js —— 开卷的本地小服务器
 *
 * 为什么需要它：静态网页没法写文件。想让「做题记录」真的落到硬盘上
 * （而不是只躺在浏览器 localStorage 里），就得有个能接收 POST 的东西。
 *
 * 它做四件事：
 *   1. 把 openstudy 目录当静态站点发出去
 *   2. GET  /api/state?subject=物理     取存档
 *   3. POST /api/sync                   存状态 + 追加一条作答记录
 *   4. POST /api/ask                    把「想问的话」记进提问队列
 *
 * 存档目录由环境变量 OPENSTUDY_STORE 指定；没指定就放在 openstudy-data/store。
 *
 * 用法：
 *   OPENSTUDY_STORE="/path/to/存档目录" node serve.js
 *   node serve.js --port 8770 --store "/path/to/存档目录"
 */

import { createServer } from 'node:http'
import { readFile, writeFile, mkdir, appendFile, rename, stat } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { join, extname, resolve, dirname, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

const PORT = Number(argOf('port', process.env.OPENSTUDY_PORT || 8770))
const STORE = resolve(argOf('store', process.env.OPENSTUDY_STORE || join(HERE, 'openstudy-data', 'store')))

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

/** 学科名只允许中英文数字和短横线，直接拿来当文件名 */
function safeSubject(s) {
  const v = String(s ?? '').trim()
  if (!/^[\w\u4e00-\u9fa5-]{1,32}$/.test(v)) return null
  return v
}

async function readJsonBody(req, limit = 4 * 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > limit) throw new Error('请求体太大')
    chunks.push(c)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  return JSON.parse(text)
}

function send(res, code, body, headers = {}) {
  const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers })
  res.end(payload)
}

async function writeAtomic(path, text) {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  await writeFile(tmp, text, 'utf8')
  await rename(tmp, path)
}

/** 静态文件：只允许落在 HERE 底下 */
async function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost')
  let p = decodeURIComponent(url.pathname)
  if (p === '/') p = '/index.html'
  const full = normalize(join(HERE, p))
  if (!full.startsWith(HERE + sep) || full.includes(`${sep}..${sep}`)) {
    return send(res, 403, { error: '越界' })
  }
  try {
    const st = await stat(full)
    if (st.isDirectory()) {
      const index = join(full, 'index.html')
      await stat(index)
      return sendFile(res, index)
    }
    return sendFile(res, full)
  } catch {
    // 目录没 index.html 就给个列表，方便手点
    try {
      const st = await stat(full)
      if (st.isDirectory()) return sendDir(res, full, p)
    } catch {}
    return send(res, 404, { error: '没这个文件' })
  }
}

function sendFile(res, path) {
  const type = MIME[extname(path).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' })
  createReadStream(path).pipe(res)
}

async function sendDir(res, dir, urlPath) {
  const { readdir } = await import('node:fs/promises')
  const names = await readdir(dir)
  const rows = names.map((n) => `<li><a href="${urlPath.replace(/\/$/, '')}/${encodeURIComponent(n)}">${n}</a></li>`).join('')
  send(res, 200, `<!doctype html><meta charset="utf-8"><title>${urlPath}</title>
<body style="font:15px/1.7 system-ui;padding:24px"><h3>${urlPath}</h3><ul>${rows}</ul>`,
    { 'content-type': 'text/html; charset=utf-8' })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')

  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, store: STORE })
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      const subject = safeSubject(url.searchParams.get('subject'))
      if (!subject) return send(res, 400, { error: '学科名不合法' })
      const path = join(STORE, `state-${subject}.json`)
      try {
        const text = await readFile(path, 'utf8')
        return send(res, 200, { ok: true, state: JSON.parse(text), path })
      } catch {
        return send(res, 200, { ok: true, state: null, path })
      }
    }

    if (url.pathname === '/api/sync' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const subject = safeSubject(body.subject)
      if (!subject) return send(res, 400, { error: '学科名不合法' })
      if (!body.state || typeof body.state !== 'object') return send(res, 400, { error: 'state 缺失' })

      const statePath = join(STORE, `state-${subject}.json`)
      await writeAtomic(statePath, JSON.stringify(body.state, null, 2))

      let logged = false
      if (body.attempt && typeof body.attempt === 'object') {
        const logPath = join(STORE, `答题记录-${subject}.jsonl`)
        await mkdir(STORE, { recursive: true })
        await appendFile(logPath, `${JSON.stringify({ at: new Date().toISOString(), ...body.attempt })}\n`, 'utf8')
        logged = true
      }

      return send(res, 200, { ok: true, savedAt: new Date().toISOString(), statePath, logged })
    }

    if (url.pathname === '/api/ask' && req.method === 'POST') {
      const body = await readJsonBody(req)
      const subject = safeSubject(body.subject)
      if (!subject) return send(res, 400, { error: '学科名不合法' })
      const message = String(body.message ?? '').trim()
      if (!message) return send(res, 400, { error: '没写内容' })

      const queuePath = join(STORE, '提问队列.jsonl')
      await mkdir(STORE, { recursive: true })
      await appendFile(queuePath, `${JSON.stringify({
        at: new Date().toISOString(),
        subject,
        answered: false,
        questionId: body.questionId ?? null,
        stem: body.stem ?? null,
        myAnswer: body.myAnswer ?? null,
        correct: body.correct ?? null,
        reference: body.reference ?? null,
        message,
      })}\n`, 'utf8')

      return send(res, 200, { ok: true, queuePath })
    }

    if (url.pathname.startsWith('/api/')) {
      return send(res, 404, { error: '没有这个接口' })
    }

    return await serveStatic(req, res)
  } catch (e) {
    return send(res, 500, { error: String(e?.message || e) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`开卷服务器已启动：http://127.0.0.1:${PORT}`)
  console.log(`存档目录：${STORE}`)
  console.log(`物理真题页：http://127.0.0.1:${PORT}/openstudy-data/openstudy-physics.html`)
})
