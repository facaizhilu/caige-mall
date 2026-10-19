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
  function refresh() { return fetch('/service?partial=1', { headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (h) { list.innerHTML = h; toBottom(); list.querySelectorAll('img').forEach(function (i) { i.addEventListener('load', toBottom, { once: true }); }); }); }
  function post(url, body, isForm) {
    var o = { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': csrf, 'Accept': 'application/json', 'X-Requested-With': 'fetch' }, body: body };
    if (!isForm) o.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return fetch(url, o).then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); }).then(function (j) { if (!j.ok) toast(j.msg || '发送失败'); return refresh(); });
  }
  function toast(m) { var t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2200); }
  function sendText(v) { v = (v || '').trim(); if (!v) return; return post('/service', '_csrf=' + encodeURIComponent(csrf) + '&content=' + encodeURIComponent(v)); }
  bar && bar.addEventListener('submit', function (e) { e.preventDefault(); var v = ta.value; if (!v.trim()) return; ta.value = ''; grow(); sendText(v); ta.focus(); });
  ta && ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !('ontouchstart' in window)) { e.preventDefault(); bar.requestSubmit ? bar.requestSubmit() : bar.dispatchEvent(new Event('submit')); } });
  document.querySelectorAll('.chip-q').forEach(function (b) { b.addEventListener('click', function () { sendText(b.dataset.q); }); });
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
