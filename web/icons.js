/**
 * icons.js —— 成就与状态条用的线性图标（24×24，全部 stroke 绘制）
 *
 * 为什么不用 emoji：emoji 在不同系统颜色不一、放大后糊，而且没法统一粗细。
 * 这里每个图标只用 path/line，颜色交给 CSS 的 currentColor，尺寸交给 size 参数。
 */

const P = (d, extra = '') => `<path d="${d}"${extra}/>`

export const ICONS = {
  // 初芽
  sprout: `<path d="M12 20v-7"/><path d="M12 13c0-3.3-2.4-6-5.5-6C6.5 10.3 8.9 13 12 13z"/><path d="M12 13c0-3.3 2.4-6 5.5-6C17.5 10.3 15.1 13 12 13z"/>`,
  // 靶心
  target: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>`,
  // 火焰
  flame: `<path d="M12 21c3.3 0 6-2.5 6-5.7 0-4.4-4.6-6.1-4.6-9.6C10 7.3 6 8.9 6 15.3 6 18.5 8.7 21 12 21z"/><path d="M12 21c1.5 0 2.7-1.2 2.7-2.7 0-2-2.7-2.6-2.7-4.6-1.2 1.2-2.7 2-2.7 4.6 0 1.5 1.2 2.7 2.7 2.7z"/>`,
  // 爆发
  burst: `<path d="M12 2.5l2.1 4.6 4.9-1.4-1.4 4.9 4.6 2.1-4.6 2.1 1.4 4.9-4.9-1.4L12 21.5l-2.1-4.6-4.9 1.4 1.4-4.9L1.8 12l4.6-2.1-1.4-4.9 4.9 1.4z"/>`,
  // 日历
  calendar: `<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/>`,
  // 山峰
  peaks: `<path d="M2.5 19l5-8 3.2 4.4L14 10l7.5 9z"/><path d="M7.5 11l1.6 1.3 1.6-1.3"/>`,
  // 书
  book: `<path d="M4 5.5A2 2 0 016 3.5h5v17H6a2 2 0 00-2 2z"/><path d="M20 5.5a2 2 0 00-2-2h-5v17h5a2 2 0 012 2z"/>`,
  // 文件堆
  stack: `<rect x="4" y="8" width="14" height="11" rx="2"/><path d="M7 8V6a2 2 0 012-2h8a2 2 0 012 2v9"/>`,
  // 星
  star: `<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 17.1 6.6 20l1.1-6.1L3.2 9.6l6.1-.8z"/>`,
  // 三星（十级）
  stars: `<path d="M9 4.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L9 13.2 5.6 15l.7-3.8L3.5 8.5l3.8-.5z"/><path d="M17.5 12l1.2 2.4 2.6.4-1.9 1.8.5 2.6-2.4-1.3-2.4 1.3.5-2.6-1.9-1.8 2.6-.4z"/>`,
  // 月
  moon: `<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z"/>`,
  // 日出
  sunrise: `<path d="M12 4v3M5.6 7.6l1.8 1.8M18.4 7.6l-1.8 1.8M3 15h3M18 15h3"/><path d="M7 18a5 5 0 0110 0z"/><path d="M3.5 21h17"/>`,
  // 锁（未解锁）
  lock: `<rect x="4.5" y="10" width="15" height="10" rx="2.5"/><path d="M8 10V7.5a4 4 0 018 0V10"/>`,
  // 对勾
  check: `<path d="M4.5 12.5l4.5 4.5L19.5 6.5"/>`,
}

/** 取一个图标（找不到时回退到星星） */
export function iconSVG(name, size = 24, cls = '') {
  const body = ICONS[name] || ICONS.star
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`
}

/** 成就表里 id → 图标名 */
export const BADGE_ICONS = {
  first: 'sprout',
  perfect: 'target',
  streak10: 'flame',
  day100: 'burst',
  streak7: 'calendar',
  streak30: 'peaks',
  q100: 'book',
  q500: 'stack',
  level5: 'star',
  level10: 'stars',
  night: 'moon',
  early: 'sunrise',
}
