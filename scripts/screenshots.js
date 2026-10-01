// 生成截图:先启动服务,然后 node scripts/screenshots.js [baseUrl]
// 需要本机 Chrome/Chromium(默认 /usr/bin/google-chrome,可用 CHROME_PATH 覆盖)
const { chromium } = require('playwright-core');
const path = require('path');
const base = process.argv[2] || 'http://localhost:' + (process.env.PORT || 3000);
const out = path.join(__dirname, '..', 'screenshots');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const shot = async (page, name, full = true) => { await page.waitForLoadState('load'); await page.waitForTimeout(1200); await page.screenshot({ path: path.join(out, name + '.png'), fullPage: full }); console.log('saved', name); };
  // 前台(桌面)
  let ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'zh-CN' }); let page = await ctx.newPage();
  await page.goto(base + '/'); await shot(page, '01-storefront-home');
  await page.goto(base + '/products'); await shot(page, '02-product-list');
  await page.goto(base + '/product/1'); await shot(page, '03-product-detail');
  await page.goto(base + '/login'); await page.fill('[name=phone]', '13800000001'); await page.fill('#f1 [name=password]', '123456'); await Promise.all([page.waitForNavigation(), page.click('#f1 button')]);
  await page.goto(base + '/product/1'); await page.click('text=加入购物车'); await page.waitForTimeout(600);
  await page.goto(base + '/product/7'); await page.click('text=加入购物车'); await page.waitForTimeout(600);
  await page.goto(base + '/cart'); await shot(page, '04-cart');
  await page.click('#go'); await page.waitForLoadState('load'); await shot(page, '05-checkout');
  await page.goto(base + '/me'); await shot(page, '06-member-center');
  await page.goto(base + '/seckill'); await shot(page, '07-seckill');
  await page.goto(base + '/orders'); await shot(page, '08-orders');
  await ctx.close();
  // 前台(手机)
  ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, locale: 'zh-CN' }); page = await ctx.newPage();
  await page.goto(base + '/'); await shot(page, '09-mobile-home', false); await ctx.close();
  // 后台
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' }); page = await ctx.newPage();
  await page.goto(base + '/admin/login'); await shot(page, '10-admin-login', false);
  await page.fill('[name=username]', 'admin'); await page.fill('[name=password]', 'admin123'); await Promise.all([page.waitForNavigation(), page.click('button')]);
  await shot(page, '11-admin-dashboard');
  await page.goto(base + '/admin/products'); await shot(page, '12-admin-products');
  await page.goto(base + '/admin/members'); await shot(page, '13-admin-members');
  await page.goto(base + '/admin/orders'); await shot(page, '14-admin-orders');
  await page.goto(base + '/admin/stats'); await shot(page, '15-admin-stats');
  await page.goto(base + '/admin/members/1'); await shot(page, '16-admin-member-detail');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
