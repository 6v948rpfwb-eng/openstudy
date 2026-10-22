/** util.js —— 几个到处要用的小函数，单独放一处避免重复定义 */

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x))

/** 保留 3 位小数，只为了显示好看 */
export const round = (x) => Math.round(x * 1000) / 1000

/** 把一个数组切成 k 段，尽量均分 */
export function splitEvenly(arr, k) {
  const out = []
  const size = arr.length / k
  for (let i = 0; i < k; i++) {
    const from = Math.floor(i * size)
    const to = Math.max(from + 1, Math.floor((i + 1) * size))
    const seg = arr.slice(from, to)
    if (seg.length) out.push(seg)
  }
  return out
}

export const DAY = 86400000
