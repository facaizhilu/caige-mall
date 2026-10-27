// 在线客服会话:自动滚动、输入框自适应、visualViewport 键盘适配、图片压缩上传、订单卡片、快捷问题、预览
(function () {
  var pg = document.getElementById('chatpg'); if (!pg) return;
  var list = document.getElementById('chatList'), bar = document.getElementById('chatBar'), ta = document.getElementById('chatInput');
  var csrf = (document.querySelector('meta[name=csrf]') || {}).content || '';
  function toBottom() { list.scrollTop = list.scrollHeight; }
  // 页面高度 = 可视视口高度(键盘弹出时 visualViewport 变小,输入栏随之上移,不被键盘遮挡)
  function fit() {
    var vv = window.visualViewport, h = vv ? vv.height : window.innerHeight, zt = document.querySelector('.ztop');
    var t = zt ? Math.max(0, zt.getBoundingClientRect().height) : 0, off = vv ? vv.offsetTop : 0;
    var near = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
    pg.style.top = (t + off) + 'px'; pg.style.height = Math.max(160, h - t) + 'px';
    if (near) toBottom();
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', fit); visualViewport.addEventListener('scroll', fit); }
  window.addEventListener('resize', fit); fit(); toBottom(); setTimeout(toBottom, 300);
  window.addEventListener('load', toBottom);
  // 输入框自适应高度(1~4 行)
  function grow() { ta.style.height = '40px'; ta.style.height = Math.min(ta.scrollHeight, 100) + 'px'; }
  ta && ta.addEventListener('input', grow);
  // 已读回执:页面可见且消息已渲染时上报(仅人工客服消息);后台显示已读/未读
  var reported = {};
  function reportRead() {
    if (document.visibilityState !== 'visible') return;
    var ids = [].slice.call(list.querySelectorAll('.cmsg[data-st]')).map(function (e) { return e.getAttribute('data-id'); }).filter(function (id) { return id && !reported[id]; });
    if (!ids.length || !csrf) return;
    ids.forEach(function (id) { reported[id] = 1; });
    fetch('/service/read', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' }, body: 'ids=' + ids.join(',') })
      .then(function (r) { if (!r.ok) throw r; }).catch(function () { ids.forEach(function (id) { delete reported[id]; }); setTimeout(reportRead, 3000); });
  }
  // 刷新会话:拉取完整消息列表(按消息 id 渲染,天然去重;同时带上撤回/编辑/新消息)。并发请求合并为一次
  var lastHtml = null, busy = null, again = false;
  function refresh(keep) {
    if (busy) { again = true; return busy; }
    busy = fetch('/service?partial=1', { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin', cache: 'no-store' }).then(function (r) { return r.text(); }).then(function (h) {
      if (h === lastHtml) return reportRead(); lastHtml = h;
      var near = list.scrollHeight - list.scrollTop - list.clientHeight < 120, top = list.scrollTop;
      list.innerHTML = h; if (!keep || near) { toBottom(); list.querySelectorAll('img').forEach(function (i) { i.addEventListener('load', toBottom, { once: true }); }); } else list.scrollTop = top; reportRead();
    }).catch(function () {}).then(function () { busy = null; if (again) { again = false; refresh(true); } });
    return busy;
  }
  // 客服回复提示音:仅在页面处于后台(document.hidden)时轻响一声,正在看聊天时不响;可静音(localStorage)
  var SK = 'svcSound', actx = null, lastDing = 0, sb = document.getElementById('sndToggle'), tFlash = null;
  function muted() { try { return localStorage.getItem(SK) === '0'; } catch (e) { return false; } }
  function actxGet() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state !== 'running') actx.resume(); } catch (e) {} return actx; }
  ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) { document.addEventListener(ev, function () { if (!muted()) actxGet(); }, { passive: true }); }); // 首次点击解锁音频
  function sbRender() { if (sb) { sb.textContent = muted() ? '🔕' : '🔔'; sb.setAttribute('aria-label', muted() ? '提示音已关闭,点击开启' : '提示音已开启,点击关闭'); sb.title = sb.getAttribute('aria-label'); } }
  sb && sb.addEventListener('click', function () { try { localStorage.setItem(SK, muted() ? '1' : '0'); } catch (e) {} sbRender(); toast(muted() ? '已关闭客服回复提示音' : '已开启客服回复提示音(页面在后台时提醒)'); });
  sbRender();
  function replyAlert() {
    if (!document.hidden || muted() || Date.now() - lastDing < 3000) return; lastDing = Date.now();
    var c = actx; // 后台页面不能新建/解锁音频,只能使用此前点击时已解锁的
    if (c && c.state === 'running') try { var o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.type = 'sine'; o.frequency.value = 740; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.04, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.32); } catch (e) {}
    var base = document.title.replace(/^【[^】]*】/, ''), i = 0; clearInterval(tFlash);
    tFlash = setInterval(function () { document.title = (i++ % 2 ? '' : '【客服回复】') + base; if (!document.hidden || i > 30) { clearInterval(tFlash); document.title = base; } }, 900);
  }
  // 实时:SSE 推送;不支持或连接出错时每 3 秒轮询;重连/切回前台时补拉,不丢消息
  if (pg.dataset.login === '1') {
    var es = null, pollT = null;
    function poll(on) { if (on && !pollT) pollT = setInterval(function () { if (document.visibilityState === 'visible') refresh(true); }, 3000); if (!on && pollT) { clearInterval(pollT); pollT = null; } }
    if (window.EventSource) {
      var seen = Date.now();
      es = new EventSource('/service/stream');
      es.addEventListener('open', function () { seen = Date.now(); poll(false); refresh(true); });
      es.addEventListener('ping', function () { seen = Date.now(); poll(false); });
      // 推送到达:立即拉取并渲染,页面可见时随即上报已读
      es.addEventListener('chat', function (e) { seen = Date.now(); var d = {}; try { d = JSON.parse(e.data); } catch (x) {} if (d.type === 'msg' && d.sender === 'staff') replyAlert(); if (d.type !== 'read' && d.type !== 'enter') refresh(true); });
      es.addEventListener('error', function () { poll(true); });
      // 看门狗:45 秒无心跳(代理缓冲/静默断开)则改为 3 秒轮询;另每 15 秒兜底刷新一次
      setInterval(function () { if (Date.now() - seen > 45000) poll(true); }, 5000);
      setInterval(function () { if (document.visibilityState === 'visible') refresh(true); }, 15000);
    } else poll(true);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { refresh(true); reportRead(); } });
    setTimeout(reportRead, 300);
  }
  function post(url, body, isForm) {
    var o = { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf, 'Accept': 'application/json', 'X-Requested-With': 'fetch' }, body: body };
    if (!isForm) o.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return fetch(url, o).then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); }).then(function (j) { if (!j.ok) toast(j.msg || '发送失败'); return refresh(); });
  }
  function toast(m) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200); }
  function sendText(v, quick) { v = (v || '').trim(); if (!v) return; return post('/service', '_csrf=' + encodeURIComponent(csrf) + '&content=' + encodeURIComponent(v) + (quick ? '&quick=1' : '')); }
  bar && bar.addEventListener('submit', function (e) { e.preventDefault(); var v = ta.value; if (!v.trim()) return; ta.value = ''; grow(); sendText(v); ta.focus(); });
  ta && ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !('ontouchstart' in window)) { e.preventDefault(); bar.requestSubmit ? bar.requestSubmit() : bar.dispatchEvent(new Event('submit')); } });
  document.querySelectorAll('.chip-q').forEach(function (b) { b.addEventListener('click', function () { sendText(b.dataset.q, true); }); });
  // 底部弹层
  var bg = document.getElementById('sheetBg');
  function open(id) { closeAll(); bg.hidden = false; document.getElementById(id).hidden = false; }
  function closeAll() { bg.hidden = true; document.querySelectorAll('.sheet').forEach(function (s) { s.hidden = true; }); }
  bg.addEventListener('click', closeAll); document.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', closeAll); });
  var plus = document.getElementById('plusBtn'); plus && plus.addEventListener('click', function () { open('plusSheet'); });
  document.getElementById('ctBtn').addEventListener('click', function () { open('ctSheet'); });
  var pending = null;
  function pick(which) { var inp = document.getElementById(which === 'camera' ? 'fCam' : 'fAlbum'); inp.value = ''; inp.click(); }
  document.querySelectorAll('#plusSheet [data-act]').forEach(function (b) { b.addEventListener('click', function () {
    var act = b.dataset.act; if (act === 'order') return open('orderSheet');
    closeAll();
    var seen = false; try { seen = localStorage.getItem('svcImgNotice') === '1'; } catch (e) {}
    if (!seen) { pending = act; return open('noticeSheet'); }
    pick(act);
  }); });
  document.getElementById('noticeOk').addEventListener('click', function () { try { localStorage.setItem('svcImgNotice', '1'); } catch (e) {} closeAll(); if (pending) pick(pending); pending = null; });
  document.querySelectorAll('.sh-ord').forEach(function (b) { b.addEventListener('click', function () { closeAll(); post('/service/order', '_csrf=' + encodeURIComponent(csrf) + '&order_id=' + b.dataset.oid); }); });
  // 客户端压缩:最长边 1600,JPEG 0.8;GIF 原样
  function compress(f) {
    return new Promise(function (res) {
      if (!/^image\/(jpeg|png|webp)$/.test(f.type) || !window.createImageBitmap && !window.FileReader) return res(f);
      var img = new Image(), url = URL.createObjectURL(f);
      img.onload = function () {
        var s = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        c.toBlob(function (b) { res(b && b.size < f.size ? new File([b], 'img.jpg', { type: 'image/jpeg' }) : f); }, 'image/jpeg', 0.8);
      };
      img.onerror = function () { URL.revokeObjectURL(url); res(f); }; img.src = url;
    });
  }
  function upload(files) {
    files = [].slice.call(files || []); if (!files.length) return;
    if (files.length > 3) { toast('一次最多发送 3 张图片'); files = files.slice(0, 3); }
    Promise.all(files.map(compress)).then(function (fs) {
      if (fs.some(function (f) { return f.size > 5 * 1024 * 1024; })) return toast('单张图片不能超过 5MB');
      var fd = new FormData(); fs.forEach(function (f) { fd.append('images', f, f.name || 'img.jpg'); }); post('/service/image', fd, true);
    });
  }
  ['fAlbum', 'fCam'].forEach(function (id) { document.getElementById(id).addEventListener('change', function (e) { upload(e.target.files); }); });
  // 图片预览
  var pv = document.getElementById('pv');
  list.addEventListener('click', function (e) { var a = e.target.closest('.cimg'); if (!a) return; e.preventDefault(); pv.querySelector('img').src = a.dataset.full; pv.hidden = false; });
  pv.addEventListener('click', function () { pv.hidden = true; });
})();
