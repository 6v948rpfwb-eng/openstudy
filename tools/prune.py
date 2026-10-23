#!/usr/bin/env python3
"""清理题库里较老、与浙江考试风格不符的题。

默认只做演练（dry-run），加 --apply 才真删；删除前会写 .bak 备份。

规则
  物理/化学/技术：只保留「浙江真题、浙江联考/模拟」与 2025 年及以后的卷；
                  其他（GAOKAO-Bench 全国卷 2010–2022、外省卷）默认删。
  数学/英语/语文：浙江用新课标 I 卷（全国卷），只按年份删：删 ≤2019 的老卷。
用法
  python3 tools/prune.py            # 演练
  python3 tools/prune.py --apply    # 真删
"""
import json, os, re, shutil, sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZJ_WORDS = ('浙江', '新阵地', '联盟', '联考', '选考', '联谊', '协作体', '稽阳',
            '北斗星', '学军', '名校', '七彩阳光', '精诚', '湖丽衢', '金丽衢', '嘉兴', '宁波', '杭州', '温州')


def year_of(src):
    m = re.search(r'(20\d\d)', src or '')
    return int(m.group(1)) if m else 0


def keep(subject, q):
    src = q.get('source') or ''
    yr = year_of(src)
    if subject in ('physics', 'chemistry', 'technology'):
        if any(w in src for w in ZJ_WORDS) and yr >= 2024:
            return True
        if yr >= 2025 and 'GAOKAO-Bench' not in src:
            return True
        return False
    return yr >= 2020


def main():
    apply = '--apply' in sys.argv
    for subject in ('physics', 'chemistry', 'technology', 'math', 'english', 'chinese'):
        path = os.path.join(BASE, 'openstudy-data', f'{subject}.bank.json')
        if not os.path.exists(path):
            continue
        bank = json.load(open(path, encoding='utf8'))
        qs = bank['questions']
        kept = [q for q in qs if keep(subject, q)]
        dropped = len(qs) - len(kept)
        print(f'{subject:10s} {len(qs):4d} → {len(kept):4d}（删 {dropped}）')
        if apply and dropped:
            shutil.copy(path, path + '.bak')
            bank['questions'] = kept
            json.dump(bank, open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    if not apply:
        print('\n这是演练。加 --apply 才会真删（会先写 .bak 备份）。')


if __name__ == '__main__':
    main()
