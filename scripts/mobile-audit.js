// 移动端审计:node scripts/mobile-audit.js <baseUrl> <outDir> [--shots]
// 对多个手机视口访问所有前台页面,检测横向溢出/过小点击区域/输入框字号,并可截图
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const base = process.argv[2], out = process.argv[3], shots = process.argv.includes('--shots');
const VPS = { 'iphone-se-375x667': [375, 667, 2], 'iphone14-390x844': [390, 844, 3], 'android-360x800': [360, 800, 3], 'android-412x915': [412, 915, 2.6] };
const PAGES = [['home', '/'], ['products', '/products'], ['products-cat', '/products?cat=1&sort=price_asc'], ['product', '/product/1'], ['product-seckill', '/product/3'], ['cart', '/cart'], ['checkout', 'CHECKOUT'], ['orders', '/orders'], ['order', 'ORDER'], ['me', '/me'], ['me-addresses', '/me/addresses'], ['me-points', '/me/points'], ['login', '/login'], ['register', '/register'], ['seckill', '/seckill'], ['groupbuy', '/groupbuy'], ['coupons', '/coupons'], ['points-mall', '/points-mall'], ['help', '/help'], ['article', '/article/4'], ['service', '/service']];
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const issues = [];
  for (const [vn, [w, h, dsf]] of Object.entries(VPS)) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, isMobile: true, hasTouch: true, locale: 'zh-CN', userAgent: vn.startsWith('iphone') ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' });
    const page = await ctx.newPage();
    await page.goto(base + '/login'); await page.fill('#f1 [name=phone]', '13800000001'); await page.fill('#f1 [name=password]', '123456'); await Promise.all([page.waitForNavigation(), page.click('#f1 button')]);
    // 准备购物车/订单
    await page.goto(base + '/product/1'); await page.click('text=加入购物车'); await page.waitForTimeout(500);
    for (const [name, url0] of PAGES) {
      let url = url0;
      if (url === 'CHECKOUT') { await page.goto(base + '/cart'); await page.click('#go'); await page.waitForLoadState('load'); } else {
        if (url === 'ORDER') { await page.goto(base + '/orders'); url = await page.locator('a[href^="/order/"]').first().getAttribute('href'); }
        await page.goto(base + url);
      }
      await page.waitForLoadState('load'); await page.waitForTimeout(700);
      const r = await page.evaluate(() => {
        const W = document.documentElement.clientWidth, res = { overflowX: document.documentElement.scrollWidth - W, wide: [], small: [], smallInput: [], clipped: [] };
        const inView = el => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length; };
        const scrollable = el => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return true; } return false; };
        document.querySelectorAll('body *').forEach(el => { if (!inView(el)) return; const b = el.getBoundingClientRect(); if (b.right > W + 1 && !scrollable(el) && res.wide.length < 6) res.wide.push(el.tagName + '.' + (el.className || '').toString().slice(0, 30) + ' r=' + Math.round(b.right)); });
        document.querySelectorAll('a,button,input:not([type=hidden]),select,textarea,summary,[onclick]').forEach(el => { if (!inView(el)) return; const b = el.getBoundingClientRect(); if (el.closest('.hide')) return; const tag = el.tagName; if ((tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file') { if (parseFloat(getComputedStyle(el).fontSize) < 16) res.smallInput.push((el.name || el.id || tag).slice(0, 20)); } if (b.height < 43.5 && !(tag === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) && res.small.length < 12) { const t = (el.textContent || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 10); if (b.width > 0) res.small.push(tag + ':' + t + ' ' + Math.round(b.width) + 'x' + Math.round(b.height)); } });
        const mn = document.querySelector('.mnav'); if (mn) { const mb = mn.getBoundingClientRect(); res.mnavH = Math.round(mb.height); }
        res.bodyPB = getComputedStyle(document.body).paddingBottom;
        return res;
      });
      if (r.overflowX > 0 || r.wide.length || r.smallInput.length || r.small.length > 0) issues.push({ vp: vn, page: name, ...r });
      if (shots) await page.screenshot({ path: path.join(out, `${vn}__${name}.png`), fullPage: true });
    }
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, 'issues.json'), JSON.stringify(issues, null, 1));
  const sum = {}; for (const i of issues) { const k = i.page; (sum[k] = sum[k] || { overflow: 0, wide: new Set(), small: new Set(), smallInput: new Set() }); if (i.overflowX > 0) sum[k].overflow = Math.max(sum[k].overflow, i.overflowX); i.wide.forEach(x => sum[k].wide.add(x)); i.small.forEach(x => sum[k].small.add(x.replace(/ \d+x\d+$/, ''))); i.smallInput.forEach(x => sum[k].smallInput.add(x)); }
  for (const [k, v] of Object.entries(sum)) console.log(k.padEnd(14), 'overflowX=' + v.overflow, '| wide:', [...v.wide].slice(0, 3).join('; '), '| smallTap:', [...v.small].slice(0, 6).join(', '), '| input<16px:', [...v.smallInput].join(','));
  console.log('pages with issues:', Object.keys(sum).length, '/', PAGES.length);
})().catch(e => { console.error(e); process.exit(1); });
