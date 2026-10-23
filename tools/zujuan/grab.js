(()=>{const qs=[...document.querySelectorAll('.tk-quest-item.quesroot')];
 const out=qs.map((q,i)=>{const c=q.cloneNode(true);
  c.querySelectorAll('.exam-item__info,[class*=operate],[class*=tool],.item-btns,script,.ad').forEach(e=>e.remove());
  const imgs=[...c.querySelectorAll('img')].map(x=>x.src);
  return {no:i+1, html:c.innerHTML, text:c.innerText.replace(/\s+\n/g,'\n').trim(), imgs};
 });
 return JSON.stringify({title:document.title.split('-')[0], url:location.href, count:out.length, questions:out});})()
