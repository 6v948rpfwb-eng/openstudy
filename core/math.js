/**
 * math.js —— 把题库里的 LaTeX 记号渲染成网页能显示的 HTML
 *
 * 为什么自己写：单文件版不能带外部库（KaTeX 光压缩后就要两百多 KB），
 * 而题库里实际用到的命令只有三十来个，写个够用的子集比塞库划算。
 *
 * 支持的写法（够物理/数学高考题用）：
 *   $...$ 行内、$$...$$ 独立成段
 *   \frac \dfrac \sqrt[n]{} ^ _ {} \left \right
 *   \mathrm \text（正体）、希腊字母、常用符号、\sin \cos \tan 等函数名
 * 不认识的命令原样显示（宁可露出源码，也不静默吞掉）。
 */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ESC[m])
}

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
  Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

const SYMBOL = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓',
  approx: '≈', le: '≤', leq: '≤', ge: '≥', geq: '≥', neq: '≠', ne: '≠',
  circ: '°', sim: '∼', ll: '≪', gg: '≫', equiv: '≡', propto: '∝',
  rightarrow: '→', to: '→', leftarrow: '←', leftrightarrow: '↔',
  dots: '…', cdots: '⋯', ldots: '…', vdots: '⋮',
  angle: '∠', infty: '∞', perp: '⊥', parallel: '∥', therefore: '∴', because: '∵',
  degree: '°', prime: '′', partial: '∂', nabla: '∇', sum: 'Σ', int: '∫',
}

const FUNC = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc',
  'arcsin', 'arccos', 'arctan',
  'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'det',
])

const UPRIGHT = new Set(['mathrm', 'text', 'textrm', 'textup', 'operatorname', 'mathbf', 'mathit', 'mathsf'])

const SPACE = { ',': '\u2009', ';': '\u2005', ':': '\u2005', '!': '', ' ': ' ', quad: '\u2003', qquad: '\u2003\u2003' }

/** 读取一个花括号分组；src[i] 必须是 '{'。返回 [内容, 下一个位置] */
function readGroup(src, i) {
  if (src[i] !== '{') return ['', i]
  let depth = 0
  let j = i
  for (; j < src.length; j += 1) {
    if (src[j] === '\\') { j += 1; continue }
    if (src[j] === '{') depth += 1
    else if (src[j] === '}') {
      depth -= 1
      if (depth === 0) return [src.slice(i + 1, j), j + 1]
    }
  }
  return [src.slice(i + 1), src.length]
}

/** 读一个「参数」：可能是 {...}，也可能是单个字符（如 x^2 里的 2） */
function readArg(src, i) {
  let k = i
  while (k < src.length && src[k] === ' ') k += 1
  if (src[k] === '{') {
    const [inner, next] = readGroup(src, k)
    return [renderSeq(inner), next]
  }
  if (src[k] === '\\') {
    let j = k + 1
    let name = ''
    while (j < src.length && /[a-zA-Z]/.test(src[j])) name += src[j++]
    if (!name) { name = src[j] || ''; j += 1 }
    return [renderSeq('\\' + name), j]
  }
  if (k >= src.length) return ['', k]
  return [escHtml(src[k]), k + 1]
}

/** 把一段 TeX 渲染成 HTML */
export function renderMath(tex) {
  const src = String(tex ?? '')
  const atoms = []
  let i = 0

  while (i < src.length) {
    const ch = src[i]

    if (ch === '\\') {
      let j = i + 1
      let name = ''
      if (/[a-zA-Z]/.test(src[j] || '')) {
        while (j < src.length && /[a-zA-Z]/.test(src[j])) name += src[j++]
      } else {
        name = src[j] || ''
        j += 1
      }
      i = j

      if (name in SPACE) { atoms.push(SPACE[name]); continue }
      if (GREEK[name]) { atoms.push(GREEK[name]); continue }
      if (SYMBOL[name]) { atoms.push(SYMBOL[name]); continue }
      if (FUNC.has(name)) { atoms.push(`<span class="mfn">${name}</span>`); continue }

      if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
        const [num, i1] = readArg(src, i)
        const [den, i2] = readArg(src, i1)
        i = i2
        atoms.push(
          `<span class="frac"><span class="fnum">${num}</span><span class="fden">${den}</span></span>`,
        )
        continue
      }

      if (name === 'sqrt') {
        let k = i
        while (k < src.length && src[k] === ' ') k += 1
        let index = null
        if (src[k] === '[') {
          const close = src.indexOf(']', k)
          if (close > 0) { index = src.slice(k + 1, close); k = close + 1 }
        }
        const [body, i1] = readArg(src, k)
        i = i1
        atoms.push(
          `<span class="sqrt">${index ? `<sup class="sidx">${renderSeq(index)}</sup>` : ''}`
          + `<span class="srad">√</span><span class="sbody">${body}</span></span>`,
        )
        continue
      }

      if (name === 'left' || name === 'right') {
        let k = i
        while (k < src.length && src[k] === ' ') k += 1
        let delim = src[k] || ''
        if (delim === '\\') {
          const m = /^\\([{}|])/.exec(src.slice(k))
          if (m) { delim = m[1]; k += 2 } else { k += 1; delim = '' }
        } else {
          k += 1
        }
        i = k
        if (delim && delim !== '.') atoms.push(escHtml(delim))
        continue
      }

      if (UPRIGHT.has(name)) {
        const [inner, i1] = readArg(src, i)
        i = i1
        atoms.push(`<span class="mrm">${inner}</span>`)
        continue
      }

      if (name === '{' || name === '}' || name === '%' || name === '&' || name === '#' || name === '_') {
        atoms.push(escHtml(name))
        continue
      }

      // 不认识的命令：原样露出来，方便发现题库里写了没支持的东西
      atoms.push(escHtml('\\' + name))
      continue
    }

    if (ch === '^' || ch === '_') {
      const [arg, i1] = readArg(src, i + 1)
      i = i1
      const tag = ch === '^' ? 'sup' : 'sub'
      const last = atoms.length ? atoms.pop() : ''
      atoms.push(`${last}<${tag}>${arg}</${tag}>`)
      continue
    }

    if (ch === '{') {
      const [inner, i1] = readGroup(src, i)
      i = i1
      atoms.push(renderSeq(inner))
      continue
    }

    if (ch === '}') { i += 1; continue }   // 多余的右括号，忽略

    atoms.push(escHtml(ch))
    i += 1
  }

  return atoms.join('')
}

/** 内部用：把一段已确定是「TeX 片段」的内容渲染（供 readArg 复用） */
function renderSeq(tex) {
  // renderMath 本身就能处理片段，这里只是给它一个更好读的名字
  return renderMath(tex)
}

/**
 * 把含 $...$ / $$...$$ 的普通文本渲染成 HTML。
 * 数学记号出去渲染，其余部分照常转义。
 */
export function renderMathText(text) {
  const s = String(text ?? '')
  const out = []
  let i = 0

  while (i < s.length) {
    const ch = s[i]
    if (ch === '$') {
      const display = s[i + 1] === '$'
      const open = display ? i + 2 : i + 1
      const close = s.indexOf(display ? '$$' : '$', open)
      // 找不到配对：把这个 $ 当普通字符吐出去
      if (close < 0) {
        out.push(escHtml(ch))
        i += 1
        continue
      }
      const tex = s.slice(open, close)
      const html = renderMath(tex)
      out.push(display ? `<span class="mathblock">${html}</span>` : html)
      i = close + (display ? 2 : 1)
      continue
    }
    out.push(escHtml(ch))
    i += 1
  }

  return out.join('')
}
