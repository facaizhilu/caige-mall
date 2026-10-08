(function(){
  var meta=document.querySelector('meta[name=csrf]');window.CSRF=meta?meta.content:'';
  window.toast=function(m){var t=document.createElement('div');t.className='toast';t.textContent=m;document.body.appendChild(t);setTimeout(function(){t.remove()},2200)};
  window.postJSON=function(url,data){var b=new URLSearchParams();Object.keys(data||{}).forEach(function(k){if(Array.isArray(data[k]))data[k].forEach(function(v){b.append(k,v)});else b.append(k,data[k])});
    return fetch(url,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','X-CSRF-Token':window.CSRF,'X-Requested-With':'XMLHttpRequest'},body:b}).then(function(r){return r.json()})};
  // 轮播
  document.querySelectorAll('[data-carousel]').forEach(function(el){
    var s=el.querySelectorAll('.slide'),d=el.querySelectorAll('.dots i'),i=0,t;if(!s.length)return;
    function go(n){i=(n+s.length)%s.length;s.forEach(function(x,k){x.classList.toggle('on',k===i)});d.forEach(function(x,k){x.classList.toggle('on',k===i)})}
    function auto(){clearInterval(t);t=setInterval(function(){go(i+1)},4500)}
    d.forEach(function(x,k){x.onclick=function(){go(k);auto()}});
    var l=el.querySelector('.carr.l'),r=el.querySelector('.carr.r');if(l)l.onclick=function(){go(i-1);auto()};if(r)r.onclick=function(){go(i+1);auto()};
    // 触摸滑动
    var sx=0,sy=0,tm=false;
    el.addEventListener('touchstart',function(e){var q=e.touches[0];sx=q.clientX;sy=q.clientY;tm=true;clearInterval(t)},{passive:true});
    el.addEventListener('touchend',function(e){if(!tm)return;tm=false;var q=e.changedTouches[0],dx=q.clientX-sx,dy=q.clientY-sy;
      if(Math.abs(dx)>40&&Math.abs(dx)>Math.abs(dy)*1.3){go(i+(dx<0?1:-1));el.dataset.swiped=1;setTimeout(function(){delete el.dataset.swiped},350)}auto()},{passive:true});
    el.addEventListener('click',function(e){if(el.dataset.swiped){e.preventDefault();e.stopPropagation()}},true);
    document.addEventListener('visibilitychange',function(){document.hidden?clearInterval(t):auto()});
    if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches){return go(0)}
    go(0);auto();
  });
  // 倒计时
  function tick(){document.querySelectorAll('[data-countdown]').forEach(function(el){
    var end=new Date(el.dataset.countdown.replace(' ','T')).getTime(),d=Math.max(0,Math.floor((end-Date.now())/1000));
    var h=Math.floor(d/3600),m=Math.floor(d%3600/60),s=d%60,p=function(n){return String(n).padStart(2,'0')};
    el.innerHTML='<b>'+p(h)+'</b>:<b>'+p(m)+'</b>:<b>'+p(s)+'</b>';if(d===0&&el.dataset.reload&&!el.dataset.done){el.dataset.done=1;setTimeout(function(){location.reload()},1200)}})}
  tick();setInterval(tick,1000);
  // 省市区联动
  window.initRegion=function(root,init){
    if(!window.REGIONS)return;var p=root.querySelector('[data-r=province]'),c=root.querySelector('[data-r=city]'),d=root.querySelector('[data-r=district]');
    function fill(sel,list,val,ph){sel.innerHTML='<option value="">'+ph+'</option>'+list.map(function(x){return '<option'+(x===val?' selected':'')+'>'+x+'</option>'}).join('')}
    fill(p,Object.keys(REGIONS),init&&init[0],'省/直辖市');
    function onP(v){fill(c,v?Object.keys(REGIONS[v]):[],init&&init[1],'市');onC(c.value)}
    function onC(v){fill(d,v&&p.value?REGIONS[p.value][v]:[],init&&init[2],'区/县')}
    p.onchange=function(){init=null;onP(p.value);p.dispatchEvent(new CustomEvent('regionchange',{bubbles:true}))};c.onchange=function(){init=null;onC(c.value)};
    onP(p.value);
  };
  document.querySelectorAll('[data-region]').forEach(function(r){var v=r.dataset.region?r.dataset.region.split('|'):null;initRegion(r,v)});
  // 通用确认
  document.addEventListener('submit',function(e){var m=e.target.dataset.confirm;if(m&&!confirm(m))e.preventDefault()});
  // 单选卡片样式
  document.querySelectorAll('.addr input,.pm input').forEach(function(inp){inp.addEventListener('change',function(){document.querySelectorAll('input[name="'+inp.name+'"]').forEach(function(o){o.closest('.addr,.pm').classList.toggle('on',o.checked)})})});
  // 窄屏表格:按表头为单元格补 data-label,配合 CSS 在手机上以卡片形式展示
  document.querySelectorAll('table.tbl').forEach(function(t){
    var rows=t.querySelectorAll('tr');if(!rows.length)return;
    var hs=[].map.call(rows[0].querySelectorAll('th'),function(th){return th.textContent.trim()});if(!hs.length)return;
    t.classList.add('stack');rows[0].classList.add('th-row');
    [].slice.call(rows,1).forEach(function(r){[].forEach.call(r.children,function(c,k){if(c.colSpan>1||!hs[k]||c.hasAttribute('data-label'))return;c.setAttribute('data-label',hs[k])})});
  });
})();
