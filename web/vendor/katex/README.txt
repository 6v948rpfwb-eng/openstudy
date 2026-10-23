KaTeX 0.16.11（MIT）—— 数学公式渲染，本目录只放页面要用到的三层：
  katex.min.js      浏览器版，构建时整段内联进成品页
  katex.min.css     原版样式（未改）
  fonts/*.woff2     20 个字体文件
  katex-inline.css  由 tools/make-katex-inline.js 生成：字体改成 data URI，构建时内联

换版本怎么做：
  1. curl -sL -o /tmp/katex.tgz https://cdn.npmmirror.com/packages/katex/<版本>/katex-<版本>.tgz
  2. tar xzf /tmp/katex.tgz -C /tmp && cp /tmp/package/dist/{katex.min.js,katex.min.css} . && cp /tmp/package/dist/fonts/*.woff2 fonts/
  3. node tools/make-katex-inline.js
  4. node build.js ...（重新构建成品页）
