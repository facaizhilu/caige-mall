// 后台客服提醒:会员进入客服页(「某某会员正在咨询」)、会员发来消息时提示音 + 浮层提示。
// 浏览器禁止无交互自动播放:需点一次「🔔 开启提示音」解锁(之后记住开启状态,下次打开页面任意点击即可恢复);
// 无法发声时改为标题闪烁 + 系统通知(需在按钮处授权)。静音状态保存在 localStorage。
(function () {
  var btn = document.getElementById('sndBtn'); if (!btn) return;
  var KEY = 'admSound', actx = null, last = {}, flashT = null, baseTitle = null;
  function pref() { try { return localStorage.getItem(KEY); } catch (e) { return null; } } // '1' 开 | '0' 静音 | null 未设置
  function setPref(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function running() { return actx && actx.state === 'running'; }
  function ctx() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state !== 'running') actx.resume(); } catch (e) {} return actx; }
  function beep(vol, freq) {
    var c = ctx(); if (!c || c.state !== 'running') return false;
    try { var o = c.createOscillator(), g = c.createGain(), t = c.currentTime; o.type = 'sine'; o.frequency.setValueAtTime(freq || 880, t); o.frequency.setValueAtTime((freq || 880) * 1.25, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.34); return true; } catch (e) { return false; }
  }
  function render() {
    var p = pref(), on = p === '1';
    btn.textContent = p === '0' ? '🔕 已静音' : on && running() ? '🔔 提示音开' : '🔔 开启提示音';
    btn.classList.toggle('snd-off', !(on && running())); btn.title = on && running() ? '点击静音' : p === '0' ? '点击开启提示音' : '点击开启提示音(浏览器需要点一次才能发声)';
    var hint = document.getElementById('sndHint'); if (hint) hint.hidden = !(on && !running());
  }
  btn.addEventListener('click', function () {
    if (pref() === '1' && running()) { setPref('0'); return render(); } // 已开启 → 静音
    setPref('1'); ctx(); setTimeout(function () { beep(0.08); render(); }, 60);
    if (window.Notification && Notification.permission === 'default') try { Notification.requestPermission(); } catch (e) {}
  });
  // 已开启过:页面任意一次点击/触摸即解锁音频(移动端 Safari / 安卓 Chrome 要求在用户手势内 resume)
  function unlock() { if (pref() === '1') { ctx(); setTimeout(render, 60); } }
  ['pointerdown', 'touchend', 'keydown'].forEach(function (ev) { document.addEventListener(ev, unlock, { passive: true }); });
  function flash(msg) {
    if (baseTitle === null) baseTitle = document.title; var i = 0; clearInterval(flashT);
    flashT = setInterval(function () { document.title = (i++ % 2 ? '' : '【' + msg + '】') + (document.title.replace(/^【[^】]*】/, '')); if (i > 20 || (!document.hidden && i > 6)) { clearInterval(flashT); document.title = document.title.replace(/^【[^】]*】/, ''); } }, 800);
  }
  function sysNotify(title, body) { try { if (window.Notification && Notification.permission === 'granted' && (document.hidden || !running())) { var n = new Notification(title, { body: body, tag: 'svc', renotify: true }); n.onclick = function () { window.focus(); location.href = '/admin/service' + (body.uid ? '' : ''); n.close(); }; } } catch (e) {} }
  function toast(t, href) {
    var box = document.getElementById('admToasts'); if (!box) { box = document.createElement('div'); box.id = 'admToasts'; box.className = 'adm-toasts'; document.body.appendChild(box); }
    var a = document.createElement('a'); a.className = 'adm-toast'; a.href = href; a.textContent = t; box.appendChild(a);
    setTimeout(function () { a.classList.add('out'); setTimeout(function () { a.remove(); }, 400); }, 6000);
  }
  // 提醒(同一会员同类事件 4 秒内只响一次)
  function alertEvt(kind, uid, text) {
    var k = kind + ':' + uid, t = Date.now(); if (t - (last[k] || 0) < 4000) return; last[k] = t;
    var href = '/admin/service?uid=' + uid; toast(text, href);
    if (pref() === '0') return;
    var ok = pref() === '1' && beep(kind === 'enter' ? 0.09 : 0.13, kind === 'enter' ? 660 : 880);
    if (!ok || document.hidden) { flash(kind === 'enter' ? '有会员咨询' : '新消息'); sysNotify(kind === 'enter' ? '会员正在咨询' : '会员新消息', text); }
  }
  // 推送事件入口:客服中心页由 admin-service.js 调用(共用其 SSE 连接),其他后台页面自己连接
  window.AdmNotify = { handle: function (d) {
    if (!d || d.sender !== 'user') return; // 只提醒会员动作,不提醒客服自己发的消息
    if (d.type === 'enter') alertEvt('enter', d.uid, (d.name || '会员') + ' 正在咨询' + (d.from === 'storecard' ? '(门店优惠卡)' : d.from === 'coop' ? '(合作专区)' : ''));
    else if (d.type === 'msg') alertEvt('msg', d.uid, '会员发来新消息' + (d.name ? ':' + d.name : ''));
  } };
  if (!document.getElementById('convs') && window.EventSource) {
    var es = new EventSource('/admin/service/stream');
    es.addEventListener('chat', function (e) { try { window.AdmNotify.handle(JSON.parse(e.data)); } catch (x) {} });
  }
  render();
})();
