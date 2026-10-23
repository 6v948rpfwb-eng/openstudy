import grab, time
qid = '32484065'
grab.run_js(f'location.href="https://zujuan.xkw.com/14q{qid}.html"')
time.sleep(9)
print('请求数:', grab.run_js('JSON.stringify(performance.getEntriesByType("resource").map(e=>e.name).filter(u=>/Answer|Parse/.test(u)).length)'))
print('含答案:', grab.run_js('document.body.innerText.includes("【答案】")'))
print('题型:', grab.run_js('JSON.stringify((document.body.innerText.match(/题型：[^\\s]{0,24}/)||[""])[0])'))
