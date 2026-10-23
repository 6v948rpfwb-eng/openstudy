import grab, time, json
for suffix in ['', '?r=2', '?from=search']:
    grab.run_js(f'location.href="https://zujuan.xkw.com/14q32484065.html{suffix}"')
    time.sleep(9)
    n = grab.run_js('JSON.stringify(performance.getEntriesByType("resource").map(e=>e.name).filter(u=>/Answer|Parse/.test(u)).length)')
    print(f'suffix={suffix!r} 请求数={n}')
