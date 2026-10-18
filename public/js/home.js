/* 首页横幅轮播:约 4 秒自动切换、左右滑动、圆点指示;页面隐藏/触摸/聚焦时暂停;减少动态效果时不自动播放、切换无动画。无依赖。 */
(function () {
  'use strict';
  function init() {
    var root = document.querySelector('.bnr[data-n]');
    if (!root) return;
    var slides = [].slice.call(root.querySelectorAll('.bnr-s')), dots = [].slice.call(root.querySelectorAll('.bnr-d button'));
    var n = slides.length;
    if (n < 2) return;
    var DELAY = 4000, DUR = 450;
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var reduced = function () { return !!(mq && mq.matches); };
    var cur = 0, timer = 0, doneTimer = 0, busy = false, hovering = false, focused = false, touching = false;
    var mod = function (i) { return (i % n + n) % n; };
    function pos(el, x, anim) { // x:百分比数值或像素字符串
      el.style.transition = anim ? '' : 'none';
      el.style.transform = 'translate3d(' + (typeof x === 'number' ? x + '%' : x) + ',0,0)';
    }
    function show(el, on) {
      el.classList.toggle('off', !on);
      if (on) { el.removeAttribute('aria-hidden'); el.removeAttribute('tabindex'); } else { el.setAttribute('aria-hidden', 'true'); el.setAttribute('tabindex', '-1'); }
      if (on) { var img = el.querySelector('img[loading="lazy"]'); if (img) img.loading = 'eager'; }
    }
    function setDots() { dots.forEach(function (d, i) { d.classList.toggle('on', i === cur); if (i === cur) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); }); }
    function settle() { // 只保留当前张可见,其余移出可视区并隐藏
      clearTimeout(doneTimer); busy = false;
      slides.forEach(function (s, i) { if (i !== cur) { show(s, false); pos(s, 100, false); } });
    }
    function go(to, dir, instant) {
      to = mod(to);
      if (to === cur) return;
      if (!dir) dir = to > cur ? 1 : -1;
      var from = slides[cur], next = slides[to], anim = !instant && !reduced();
      if (busy) settle();
      show(next, true);
      if (anim) {
        pos(next, dir * 100, false);
        void next.offsetWidth; // 仅一次强制布局,确保起点生效
        pos(next, 0, true); pos(from, -dir * 100, true);
      } else { pos(next, 0, false); }
      cur = to; setDots();
      if (anim) { busy = true; doneTimer = setTimeout(settle, DUR + 60); } else settle();
    }
    function stop() { clearTimeout(timer); timer = 0; }
    function play() {
      stop();
      if (reduced() || document.hidden || hovering || focused || touching) return;
      timer = setTimeout(function () { go(cur + 1, 1); play(); }, DELAY);
    }
    // 圆点
    dots.forEach(function (d, i) { d.addEventListener('click', function () { go(i, i > cur ? 1 : -1); play(); }); });
    // 触摸滑动(touch-action:pan-y 让浏览器处理竖向,横向由此处理;被动监听,不阻塞滚动)
    var sx = 0, sy = 0, dx = 0, st = 0, w = 0, lock = '', moved = false, nb = null, nbDir = 0;
    root.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      if (busy) settle();
      touching = true; stop();
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; dx = 0; st = Date.now(); lock = ''; moved = false; nb = null; nbDir = 0;
      w = root.clientWidth || 1;
    }, { passive: true });
    root.addEventListener('touchmove', function (e) {
      if (!touching || e.touches.length !== 1) return;
      var x = e.touches[0].clientX - sx, y = e.touches[0].clientY - sy;
      if (!lock) { if (Math.abs(x) < 6 && Math.abs(y) < 6) return; lock = Math.abs(x) > Math.abs(y) ? 'x' : 'y'; }
      if (lock !== 'x') return;
      moved = true; dx = x;
      var d = dx < 0 ? 1 : -1;
      if (d !== nbDir) { if (nb) { show(nb, false); pos(nb, 100, false); } nbDir = d; nb = slides[mod(cur + d)]; show(nb, true); }
      pos(slides[cur], dx + 'px', false);
      pos(nb, (d * w + dx) + 'px', false);
    }, { passive: true });
    function end() {
      if (!touching) return;
      touching = false;
      if (moved && nb) {
        var fast = Math.abs(dx) > 30 && Date.now() - st < 300;
        if (Math.abs(dx) > w * 0.2 || fast) {
          var from = slides[cur], to = mod(cur + nbDir), anim = !reduced();
          pos(slides[to], 0, anim); pos(from, -nbDir * 100, anim);
          cur = to; setDots();
          if (anim) { busy = true; doneTimer = setTimeout(settle, DUR + 60); } else settle();
        } else { // 回弹
          var anim2 = !reduced();
          pos(slides[cur], 0, anim2); pos(nb, nbDir * 100, anim2);
          if (anim2) { busy = true; doneTimer = setTimeout(settle, DUR + 60); } else settle();
        }
      }
      play();
    }
    root.addEventListener('touchend', end, { passive: true });
    root.addEventListener('touchcancel', end, { passive: true });
    // 滑动后不触发链接点击
    root.addEventListener('click', function (e) { if (moved) { e.preventDefault(); moved = false; } }, true);
    // 鼠标悬停/键盘聚焦时暂停
    // (只认真实鼠标与键盘焦点:手机点按会模拟 mouseenter/聚焦按钮,不能因此永久暂停)
    root.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') { hovering = true; stop(); } });
    root.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { hovering = false; play(); } });
    root.addEventListener('focusin', function (e) { var kb = false; try { kb = e.target.matches(':focus-visible'); } catch (x) { kb = false; } if (kb) { focused = true; stop(); } });
    root.addEventListener('focusout', function () { if (focused) { focused = false; play(); } });
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else play(); });
    if (mq) { var onMq = function () { play(); }; if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }
    // 首屏加载完成后再预取其余横幅图片
    var warm = function () { slides.forEach(function (s) { var img = s.querySelector('img[loading="lazy"]'); if (img) img.loading = 'eager'; }); };
    if (document.readyState === 'complete') setTimeout(warm, 300); else window.addEventListener('load', function () { setTimeout(warm, 300); });
    // 供自动化检查使用:立即切到第 i 张并停止自动播放
    root.bnrGo = function (i) { stop(); hovering = true; go(i, 0, true); };
    slides.forEach(function (s, i) { if (i) pos(s, 100, false); });
    play();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
