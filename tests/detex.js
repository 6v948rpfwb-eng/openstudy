/**
 * tests/detex.js —— 符号转换的回归测试。
 * 目标：转换结果里绝不出现 LaTeX 标记；上下标变成 ² ₁ 这种字符；表格和分段函数要能读。
 */
import { deTeX } from '../tools/detex.js'

let pass = 0
let fail = 0
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(' 对 ' + msg) }
  else { fail++; console.log(' 错 ' + msg) }
}

const out = (s) => deTeX(s)
const noTeX = (s) => !/\\[a-zA-Z]|\$|[\uFF3C]/.test(s) && !/[\uE000\uE001]/.test(s)

const c1 = out('$A=\\{x\\mid |x|\\leqslant 2\\}$')
ok(c1 === 'A={x| |x|≤2}', '集合 + 小于等于：' + c1)

const c2 = out('$x^{2}+y^{2}=r^{2}$')
ok(c2 === 'x²+y²=r²', '平方直接用上标字符：' + c2)

const c3 = out('$a_{n+1}=2a_n+1$')
ok(c3 === 'aₙ₊₁=2aₙ+1', '下标连写：' + c3)

const c4 = out('$\\frac{3}{4}$ 与 $\\frac{a}{b}$')
ok(c4 === '3/4 与 (a)/(b)', '分式：纯数字不加括号：' + c4)

const c5 = out('$f(x)=\\begin{cases} x^2 & x>0 \\\\ -x & x\\leqslant 0\\end{cases}$')
ok(c5 === 'f(x)=x²（x>0）；-x（x≤0）', '分段函数按行拆开：' + c5)

const c6 = out('$\\begin{array}{|c|c|} a & b \\\\ c & d \\end{array}$')
ok(c6 === 'a｜b；c｜d', '表格按行列拼接：' + c6)

const c7 = out('$1\\,\\mathrm{THz}=10^{12}\\,\\mathrm{Hz}$')
ok(c7 === '1THz=10¹²Hz', '单位与十的幂：' + c7)

const c8 = out('$p_1 \\wedge p_2,\\ \\neg p_3$')
ok(c8 === 'p₁∧p₂,¬p₃', '逻辑符号：' + c8)

const samples = [
  '$\\sqrt{3}+i(1-\\sqrt{3}i)^2$',
  '$\\int_0^1 \\frac{1}{1+x^2}\\mathrm{d}x$',
  '$\\overrightarrow{AB}=(4,3)$',
  '$x=\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}$',
]
for (const s of samples) ok(noTeX(out(s)), '不留任何 LaTeX 标记：' + s)

const extra = [
  ['CCl4^(→)→CH3CHBrCH2Br', 'CCl4→CH3CHBrCH2Br'],
  ['![x](https://cdn.mathpix.com/a.jpg) 苯', '苯'],
  ['30^{(°)}', '30°'],
  ['CH3CH2OH 棪H2SO4△', 'CH3CH2OH 浓H2SO4△'],
]
for (const [src, want] of extra) {
  const got = out(src)
  ok(got === want, `箭头/图片/汉字：${src} → ${got}`)
}

const extra2 = [
  ['A｜\\begin{array}{l} 乙烯通入 \\\\ 溶液无色 \\end{array} ｜ 生成物无色', 'A｜乙烯通入 溶液无色 ｜ 生成物无色'],
  ['Fe³⁺array；B', 'Fe³⁺；B'],
]
for (const [src, want] of extra2) {
  const got = out(src)
  const squash = (x) => x.replace(/\s+/g, '')
  ok(squash(got) === squash(want), `表格/残渣：${src} → ${got}`)
}

console.log(`\ndetex：${pass} 项通过，${fail} 项失败`)
if (fail) process.exit(1)
