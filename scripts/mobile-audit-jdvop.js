// 供应商相关页面移动端审计:node scripts/mobile-audit-jdvop.js <baseUrl> <outDir> [--shots]
// 前置:先在同一数据目录跑过 test/jdvop.js(生成已导入商品、混合订单、售后单)
// 前台新页面在 320/375/430 宽度检查横向溢出;后台供应商页面在 375 宽度检查页面级横向溢出(表格允许在容器内横向滚动)
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const db = require('../lib/db');
const base = process.argv[2], out = process.argv[3] || '/tmp/mobile-jdvop', shots = process.argv.includes('--shots');
fs.mkdirSync(out, { recursive: true });
const pid = sku => db.get('SELECT product_id FROM skus WHERE supplier_sku=?', sku).product_id;
const mixed = db.get("SELECT o.id FROM orders o WHERE o.user_id=2 AND EXISTS(SELECT 1 FROM order_packages p WHERE p.order_id=o.id AND p.source='own') ORDER BY o.id DESC").id;
const afs = db.get("SELECT id FROM aftersales WHERE supplier='jdvop' ORDER BY id DESC").id;
const SHOP = [['products', '/products'], ['search', '/products?q=' + encodeURIComponent('衬衫') + '&sort=price_asc'], ['product-roll', '/product/' + pid('900001001')], ['product-shirt', '/product/' + pid('900005101')], ['product-apple', '/product/' + pid('900003001')], ['checkout-mixed', 'CHECKOUT'], ['order-mixed', '/order/' + mixed], ['logistics-mixed', '/order/' + mixed + '/logistics'], ['cart', '/cart']];
const ADMIN = ['/admin/jdvop', '/admin/jdvop/products', '/admin/jdvop/mapping', '/admin/jdvop/settings', '/admin/jdvop/logs', '/admin/jdvop/reconcile', '/admin/orders/' + mixed, '/admin/aftersales/' + afs, '/admin/products'];
const measure = () => {
  const W = document.documentElement.clientWidth, res = { overflowX: document.documentElement.scrollWidth - W, wide: [] };
  const inView = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length; };
  const scrollable = el => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
  document.querySelectorAll('body *').forEach(el => { if (!inView(el)) return; const b = el.getBoundingClientRect(); if (b.right > W + 1 && !scrollable(el) && res.wide.length < 6) res.wide.push(el.tagName + '.' + (el.className || '').toString().slice(0, 30) + ' r=' + Math.round(b.right)); });
  return res;
};
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const issues = []; let checked = 0;
  for (const w of [320, 375, 430]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
    const page = await ctx.newPage();
    await page.goto(base + '/login'); await page.fill('#f1 [name=phone]', '13800000002'); await page.fill('#f1 [name=password]', '123456'); await Promise.all([page.waitForNavigation(), page.click('#f1 button')]);
    if (page.url().includes('/consent')) { await page.check('[name=agree]').catch(() => {}); await Promise.all([page.waitForNavigation(), page.click('form button')]).catch(() => {}); }
    for (const [name, url] of SHOP) {
      if (url === 'CHECKOUT') {
        await page.goto(base + '/products');
        const own = db.get('SELECT id FROM skus WHERE product_id=4 LIMIT 1').id, sup = db.get("SELECT id FROM skus WHERE supplier_sku='900005104'").id;
        await page.evaluate(([own, sup]) => { const f = document.createElement('form'); f.method = 'post'; f.action = '/checkout'; const add = (n, v) => { const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; f.appendChild(i); }; add('_csrf', document.querySelector('meta[name=csrf]') ? document.querySelector('meta[name=csrf]').content : ''); add('items', JSON.stringify([{ sku_id: own, qty: 1 }, { sku_id: sup, qty: 1 }])); document.body.appendChild(f); f.submit(); }, [own, sup]);
        await page.waitForLoadState('load');
      } else await page.goto(base + url);
      await page.waitForTimeout(400);
      const r = await page.evaluate(measure); checked++;
      const title = await page.title();
      if (r.overflowX > 0 || r.wide.length) issues.push({ w, page: name, title, ...r });
      if (shots) await page.screenshot({ path: path.join(out, `shop-${w}-${name}.png`), fullPage: true });
    }
    await ctx.close();
  }
  const ctx = await browser.newContext({ viewport: { width: 375, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  const page = await ctx.newPage();
  await page.goto(base + '/admin/login'); await page.fill('[name=username]', 'admin'); await page.fill('[name=password]', 'admin123'); await Promise.all([page.waitForNavigation(), page.click('form button')]);
  if (page.url().includes('/password')) { const b = page.locator('form[action="/admin/password/skip"] button'); if (await b.count()) await Promise.all([page.waitForNavigation(), b.click()]); }
  for (const url of ADMIN) {
    await page.goto(base + url); await page.waitForTimeout(300); const r = await page.evaluate(measure); checked++;
    if (r.overflowX > 0) issues.push({ w: 375, page: url, ...r });
    if (shots) await page.screenshot({ path: path.join(out, `admin-${url.replace(/\W+/g, '_')}.png`), fullPage: true });
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'issues.json'), JSON.stringify(issues, null, 1));
  for (const i of issues) console.log(i.w, i.page, 'overflowX=' + i.overflowX, i.wide.join('; '));
  console.log(`checked ${checked} page views, issues: ${issues.length}`);
  process.exit(issues.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
