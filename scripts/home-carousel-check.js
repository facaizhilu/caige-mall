// 首页横幅轮播行为检查(puppeteer-core):自动切换、滑动、圆点、页面隐藏暂停、减少动态效果、非首张图片延迟加载、无布局偏移
// 用法:NODE_PATH=/tmp/pp/node_modules node scripts/home-carousel-check.js   (服务在 3999 端口,库中有 ≥2 个启用 Banner)
const p = require('puppeteer-core'); const URL = process.env.URL || 'http://localhost:3999/';
let pass = 0, fail = 0; const ok = (c, n, x) => { c ? (pass++, console.log('  ✔', n)) : (fail++, console.log('  ✘', n, x === undefined ? '' : JSON.stringify(x))); };
const cur = pg => pg.evaluate(() => [...document.querySelectorAll('.bnr-s')].findIndex(s => !s.classList.contains('off')));
const dot = pg => pg.evaluate(() => [...document.querySelectorAll('.bnr-d button')].findIndex(d => d.classList.contains('on')));
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await p.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const pg = await b.newPage(); await pg.setViewport({ width: 375, height: 667, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await pg.evaluateOnNewDocument(() => { window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); });
  const reqs = []; pg.on('request', r => reqs.push(r.url()));
  await pg.goto(URL, { waitUntil: 'domcontentloaded' });
  const n = await pg.evaluate(() => document.querySelectorAll('.bnr-s').length); ok(n >= 2, '轮播有多张横幅', n);
  const lazyInit = await pg.evaluate(() => [...document.querySelectorAll('.bnr-s img')].map(i => i.getAttribute('loading')));
  ok(lazyInit[0] !== 'lazy' && lazyInit.slice(1).every(x => x === 'lazy'), '首张立即加载,其余 loading=lazy', lazyInit);
  ok(await pg.evaluate(() => [...document.querySelectorAll('.bnr-s img')].every(i => i.getAttribute('width') && i.getAttribute('height'))), '横幅图片带宽高属性');
  ok(await cur(pg) === 0 && await dot(pg) === 0, '初始第 1 张');
  await wait(4600); ok(await cur(pg) === 1 && await dot(pg) === 1, '约 4 秒自动切到第 2 张', await cur(pg));
  // 页面隐藏时暂停
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  const c0 = await cur(pg); await wait(5000); ok(await cur(pg) === c0, '页面隐藏时暂停轮播');
  await pg.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  await wait(4600); ok(await cur(pg) === (c0 + 1) % n, '页面恢复可见后继续轮播');
  // 触摸滑动(左滑下一张、右滑上一张),滑动后不跳转链接
  const box = await pg.evaluate(() => { const r = document.querySelector('.bnr').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const swipe = async (from, to) => { const c = await pg.target().createCDPSession(); const y = box.y + box.h / 2; await c.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] }); for (let i = 1; i <= 8; i++) { await c.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from + (to - from) * i / 8, y }] }); await wait(16); } await c.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await c.detach(); await wait(600); };
  let s0 = await cur(pg); const url0 = pg.url();
  await swipe(box.x + box.w * .8, box.x + box.w * .2); ok(await cur(pg) === (s0 + 1) % n && pg.url() === url0, '左滑切到下一张且不触发跳转', await cur(pg));
  s0 = await cur(pg); await swipe(box.x + box.w * .2, box.x + box.w * .8); ok(await cur(pg) === (s0 - 1 + n) % n, '右滑切到上一张', await cur(pg));
  s0 = await cur(pg); await swipe(box.x + box.w * .5, box.x + box.w * .45); ok(await cur(pg) === s0, '短距离滑动回弹不切换');
  ok(await pg.evaluate(() => document.querySelectorAll('.bnr-s:not(.off)').length) === 1, '空闲时只有一张可见');
  // 圆点
await pg.evaluate(k => document.querySelectorAll('.bnr-d button')[k].click(), n - 1); await wait(600); ok(await cur(pg) === n - 1, '点击圆点切换');
  await wait(600); const loaded = await pg.evaluate(() => [...document.querySelectorAll('.bnr-s img')].every(i => i.complete && i.naturalWidth > 0)); ok(loaded, '其余横幅图片在首屏后加载完成');
  const cls = await pg.evaluate(() => window.__cls); ok(cls < 0.01, '无布局偏移(CLS<0.01)', cls);
  const hs = await pg.evaluate(() => document.documentElement.scrollHeight - innerHeight); ok(hs <= 0, '375×667 一屏无滚动', hs);
  await pg.close();
  // 减少动态效果:不自动播放,滑动仍可用
  const p2 = await b.newPage(); await p2.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]); await p2.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p2.goto(URL, { waitUntil: 'networkidle0' }); await wait(5000); ok(await cur(p2) === 0, '减少动态效果:不自动轮播');
  ok(await p2.evaluate(() => getComputedStyle(document.querySelector('.bnr-s')).transitionDuration) === '0s', '减少动态效果:切换无过渡动画');
  await p2.evaluate(() => document.querySelectorAll('.bnr-d button')[1].click()); ok(await cur(p2) === 1, '减少动态效果:圆点仍可切换(立即)');
  await b.close(); console.log(`\n结果: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
