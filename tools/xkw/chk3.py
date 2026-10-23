import grab, time, json
qid='32484095'
grab.run_js(f'location.href="https://zujuan.xkw.com/14q{qid}.html"')
time.sleep(10)
print('请求数', grab.run_js('JSON.stringify(performance.getEntriesByType("resource").map(e=>e.name).filter(u=>/Answer|Parse/.test(u)).length)'))
print('答案区块', grab.run_js('document.body.innerText.includes("【答案】")'))
