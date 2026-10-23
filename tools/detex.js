/**
 * detex.js —— 把 LaTeX 公式转成人能直接读的纯文本。
 * 目标：绝不留下反斜杠、花括号、$ 这类标记；上下标用 ² ₁ 这种字符；
 * 集合花括号（\{ \}）保原样，分段函数按行拆开。
 */

const GREEK = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'θ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ',
  tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
}

const SYM = {
  rightleftharpoons: '⇌', leftrightarrows: '⇌', rightleftarrows: '⇌', rightarrow: '→', to: '→',
  longrightarrow: '→', leftarrow: '←', longleftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐',
  leftrightarrow: '↔', times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓',
  leq: '≤', le: '≤', leqslant: '≤', geq: '≥', ge: '≥', geqslant: '≥', neq: '≠', ne: '≠', nleq: '≰', ngeq: '≱',
  ll: '≪', gg: '≫', approx: '≈', sim: '∽', simeq: '≃', cong: '≌', equiv: '≡', propto: '∝',
  infty: '∞', angle: '∠', perp: '⊥', parallel: '∥', nparallel: '∦', triangle: '△', square: '□',
  circ: '°', degree: '°', percent: '%', because: '∵', therefore: '∴', uparrow: '↑', downarrow: '↓',
  sum: 'Σ', prod: 'Π', int: '∫', oint: '∮', partial: '∂', nabla: '∇', sqrt: '√',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', wedge: '∧', vee: '∨', lnot: '¬', land: '∧', lor: '∨', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃', neg: '¬', land: '∧', lor: '∨',
  mid: '|', vert: '|', Vert: '‖', lvert: '|', rvert: '|', lVert: '‖', rVert: '‖', '|': '‖',
  cdots: '…', ldots: '…', dots: '…', vdots: '⋮', ddots: '⋱', colon: ':', prime: '′',
  ast: '∗', star: '⋆', bullet: '•', oplus: '⊕', otimes: '⊗', setminus: '\\',
  arc: '⌒', overline: '', underline: '', vec: '', overrightarrow: '', overleftarrow: '', widehat: '', widetilde: '',
  bar: '', hat: '', tilde: '', dot: '', ddot: '',
  displaystyle: '', textstyle: '', scriptstyle: '', limits: '', nolimits: '', nonumber: '', notag: '',
  quad: ' ', qquad: ' ', enspace: ' ', thinspace: '', hspace: '', vspace: '', kern: '', mkern: '',
  mathrm: '', mathbf: '', mathit: '', mathsf: '', mathtt: '', mathcal: '', mathbb: '', mathfrak: '',
  text: '', textbf: '', textit: '', textrm: '', ce: '', pu: '', rm: '', bf: '', it: '', sf: '', tt: '', cal: '',
  left: '', right: '', big: '', Big: '', bigg: '', Bigg: '', bigl: '', bigr: '', Bigl: '', Bigr: '',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉',
  cdots: '…', therefore: '∴',
}

const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', n: 'ⁿ', i: 'ⁱ', k: 'ᵏ', m: 'ᵐ' }
const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', n: 'ₙ', i: 'ᵢ', k: 'ₖ', m: 'ₘ', j: 'ⱼ' }

// 集合花括号先换占位符，最后再换回来，避免被「去掉所有花括号」吃掉
const LBRACE = '\uE000'
const RBRACE = '\uE001'

function renderSup(body) {
  const t = String(body).trim()
  if (t === '°' || t === '∘' || t === 'circ' || t === '\\circ') return '°'
  return renderSupRaw(t)
}

function renderSupRaw(body) {
  const t = body.trim()
  if (/^[0-9+\-nikm]+$/.test(t)) return [...t].map((c) => SUP[c] || c).join('')
  return t.length === 1 ? '^' + t : '^(' + t + ')'
}

function renderSub(body) {
  const t = body.trim()
  if (/^[0-9+\-nikmj]+$/.test(t)) return [...t].map((c) => SUB[c] || c).join('')
  return t.length === 1 ? '_' + t : '_(' + t + ')'
}

// 简单分式 a/b 不加括号；复杂才加
function renderFrac(a, b) {
  const num = (s) => /^[0-9.]+$/.test(s.trim())
  const x = a.trim(), y = b.trim()
  return num(x) && num(y) ? `${x}/${y}` : `(${x})/(${y})`
}


// 核素符号：_{Z}^{A}X / ^{A}_{Z}X / 以及被压平的 z^A X、_1 ^2 H
// 统一写成「X（质量数 A，质子数 Z）」，避免上下标挤在一起读不出来
function fixNuclide(s) {
  const label = (elem, mass, charge) => {
    const z = /^[a-z]$/.test(charge) ? charge.toUpperCase() : charge
    return `${elem}（质量数${mass}，质子数${z}）`
  }
  // 1) 标准 LaTeX：上在前 ^{A}_{Z}X、下在前 _{Z}^{A}X（元素紧挨着写）
  s = s.replace(/\^\s*\{([^{}]*)\}\s*_\s*\{([^{}]*)\}\s*([A-Z][a-z]?)(?![a-z])/g,
    (_, a, z, el) => label(el, a.trim(), z.trim()))
  s = s.replace(/_\s*\{([^{}]*)\}\s*\^\s*\{([^{}]*)\}\s*([A-Z][a-z]?)(?![a-z])/g,
    (_, z, a, el) => label(el, a.trim(), z.trim()))
  // 2) 被压平的写法：前面是「质子数字母 + ^质量数」，如 z^A X
  // 只有「小写字母当质子数」这种数据集笔误（写成 z^A X）才认，避免把普通公式卷进来
  s = s.replace(/([a-z])\s*\^\s*\{?([A-Z]|[0-9]{1,3})\}?\s*([A-Z][a-z]?)(?![a-z])/g,
    (_, z, a, el) => label(el, a, z))
  // 3) 被压平的写法：以下划线起头，如 _1 ^2 H
  s = s.replace(/_\s*\{?([0-9]{1,3}|[A-Z])\}?\s*\^\s*\{?([0-9]{1,3}|[A-Z])\}?\s*([A-Z][a-z]?)(?![a-z])/g,
    (_, z, a, el) => label(el, a, z))
  return s
}

export function deTeX(src) {
  let s = fixNuclide(String(src ?? ''))
  s = s.replace(/\uFF3C/g, '\\')            // 全角反斜杠
  s = s.replace(/\\%/g, '%').replace(/\\#/g, '#').replace(/\\&/g, '&').replace(/\\_/g, '_')
  s = s.replace(/\\[{}]/g, (m) => (m === '\\{' ? LBRACE : RBRACE))

  // 分段函数 / 方程组
  s = s.replace(/\\begin\{(cases|array|aligned|gathered|tabular[*]?)(\}\{[^}]*\})?([\s\S]*?)\\end\{\1\}/g, (_, env, spec, body) => {
    const rows = String(body || '')
      .split(/\\\\/)
      .map((r) => {
        const cells = r.replace(/\\hline/g, '').split('&').map((x) => x.trim()).filter(Boolean)
        if (env.startsWith('tabular')) return cells.filter((c) => !/^[clr|]+$/.test(c)).join('｜')
        if (cells.length >= 2) return `${cells[0]}（${cells.slice(1).join('，')}）`
        return cells.join(' ')
      })
      .filter(Boolean)
    return rows.join('；')
  })
  s = s.replace(/\\\\/g, ' ')               // 行内换行

  // 根式：\sqrt[n]{x}
  s = s.replace(/\\sqrt\s*\[\s*([^\]]+)\s*\]\s*\{([^{}]*)\}/g, (_, n, x) => `${n.trim()}√(${x.trim()})`)
  for (let i = 0; i < 6; i++) {
    const next = s.replace(/\\sqrt\s*\{([^{}]*)\}/g, (_, x) => `√(${x.trim()})`)
    if (next === s) break
    s = next
  }

  // 分式（嵌套靠循环）
  for (let i = 0; i < 8; i++) {
    const next = s.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (_, a, b) => renderFrac(a, b))
    if (next === s) break
    s = next
  }

  // 上下标（先处理带花括号的，再处理单字符）
  s = s.replace(/\^\{([^{}]*)\}/g, (_, a) => renderSup(a))
  s = s.replace(/_\{([^{}]*)\}/g, (_, a) => renderSub(a))
  s = s.replace(/\^([0-9]{2,3})(?![0-9])/g, (_, a) => renderSup(a))
  s = s.replace(/_([0-9]{2,3})(?![0-9])/g, (_, a) => renderSub(a))
  s = s.replace(/\^([0-9a-zA-Z+\-])/g, (_, a) => renderSup(a))
  s = s.replace(/_([0-9a-zA-Z+\-])/g, (_, a) => renderSub(a))

  s = s.replace(/\^\s*\{?\\circ\}?/g, '°')
  s = s.replace(/\^\s*\{?\\degree\}?/g, '°')
  s = s.replace(/\^\s*\{?°\}?/g, '°')
  s = s.replace(/\^\(\s*°\s*\)/g, '°')
  s = s.replace(/\^\(\s*∘\s*\)/g, '°')
  // 命令名（先吃掉纯间距命令，再处理符号，最后兜底）
  s = s.replace(/\\[,;:! ]/g, '')
  s = s.replace(/\\([A-Za-z]+)\b/g, (m, name) => (name in SYM ? SYM[name] : GREEK[name] ?? ''))
  s = s.replace(/\\(.)/g, (m, c) => (c === '|' ? '‖' : (SYM[c] ?? c)))

  // 去掉剩余裸花括号（花括号内的内容保留）
  s = s.replace(/[{}]/g, '')
  s = s.replace(new RegExp(LBRACE, 'g'), '{').replace(new RegExp(RBRACE, 'g'), '}')
  s = s.replace(/\$\$?/g, '')
  s = s.replace(/~/g, ' ')
  // 关系符、运算符后面的空格去掉，避免出现「≤ 2」「∈ R」
  s = s.replace(/([≤≥≠≈≡∽≌∝∈∉⊂⊃⊆⊇∪∩→⇒⇐⇌↔×·÷±∓∠⊥∥∧∨¬⊕⊗])\s+/g, '$1')
  s = s.replace(/\s*([∧∨¬⊕⊗])\s*/g, '$1')
  s = s.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/\s*\n\s*/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

export default deTeX
