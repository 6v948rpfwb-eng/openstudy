# 组卷网抓取流程

1. 浏览器（Safari）打开组卷网试卷页，例如 `https://zujuan.xkw.com/28p3508737.html`
2. `./tools/zujuan/grab.sh /tmp/paper.json` → 导出题干 HTML + 图片直链
3. 把题目交给模型逐题解出答案与解析，写成 `answers.json`：
   ```json
   [{"no":1,"answer":["B"],"solution":"……","confidence":"high","topic":"T-23"}]
   ```
4. `node tools/zujuan/import.js /tmp/paper.json answers.json openstudy-data/technology.bank.json technology`
5. 重建页面：`node build.js --bank ... --out openstudy-data/openstudy.html --inline-figures`

注意：`figures` 里存的是组卷网图直链（`img.xkw.com`，无需登录即可下载），
build 时用 `--inline-figures` 会抓下来内联进 HTML。
答案由模型解出，`confidence` 低的需要人工核对。
