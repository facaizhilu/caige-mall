// 客服中心实时更新:SSE 推送新消息/撤回/编辑/已读;出错时每 3 秒轮询;重连/切回前台补拉。标题显示待回复数,新消息提示音
(function () {
  var convs = document.getElementById('convs'); if (!convs) return;
  var baseTitle = document.title.replace(/^\(\d+\) /, '');
  function badge() { var n = 0; convs.querySelectorAll('.un-dot').forEach(function (e) { n += parseInt(e.textContent, 10) || 0; }); document.title = (n ? '(' + n + ') ' : '') + baseTitle; }
  function chatEl() { return document.getElementById('chat'); }
  function url() { var c = chatEl(); return '/admin/service' + (c ? '?uid=' + c.dataset.uid : ''); }
  var busy = null, again = false;
  function refresh() {
    if (busy) { again = true; return; }
    busy = fetch(url(), { credentials: 'same-origin', cache: 'no-store', headers: { 'X-Requested-With': 'fetch' } }).then(function (r) { return r.ok && !r.redirected ? r.text() : null; }).then(function (h) {
      if (!h) return; var d = new DOMParser().parseFromString(h, 'text/html');
      var nc = d.getElementById('convs'); if (nc && nc.innerHTML !== convs.innerHTML) convs.innerHTML = nc.innerHTML;
      var c = chatEl(), n2 = d.getElementById('chat');
      // 正在编辑消息时不替换会话区,避免丢失输入
      if (c && n2 && n2.innerHTML !== c.innerHTML && !c.querySelector('details.msg-edit[open]')) {
        var near = c.scrollHeight - c.scrollTop - c.clientHeight < 120, top = c.scrollTop;
        c.innerHTML = n2.innerHTML; c.scrollTop = near ? c.scrollHeight : top;
      }
      badge();
    }).catch(function () {}).then(function () { busy = null; if (again) { again = false; refresh(); } });
  }
  var actx = null;
  function ding() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); var o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.06, actx.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + 0.25); o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + 0.26); } catch (e) {} }
  var pollT = null;
  function poll(on) { if (on && !pollT) pollT = setInterval(function () { if (document.visibilityState === 'visible') refresh(); }, 3000); if (!on && pollT) { clearInterval(pollT); pollT = null; } }
  if (window.EventSource) {
    var es = new EventSource('/admin/service/stream'), opened = false, seen = Date.now();
    es.addEventListener('open', function () { seen = Date.now(); poll(false); if (opened) refresh(); opened = true; });
    es.addEventListener('ping', function () { seen = Date.now(); poll(false); });
    setInterval(function () { if (Date.now() - seen > 45000) poll(true); }, 5000);
    setInterval(function () { if (document.visibilityState === 'visible') refresh(); }, 15000);
    es.addEventListener('chat', function (e) { seen = Date.now(); var d = {}; try { d = JSON.parse(e.data); } catch (x) {} if (d.type === 'msg' && d.sender === 'user') ding(); refresh(); });
    es.addEventListener('error', function () { poll(true); });
  } else poll(true);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') refresh(); });
  badge();
})();
