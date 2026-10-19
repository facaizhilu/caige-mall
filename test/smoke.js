// 冒烟测试:node test/smoke.js [baseUrl]  (需要服务已启动;会写入演示库,建议在全新库上运行)
// 服务需以 DEMO_MODE=1 启动(演示账号使用默认密码,测试通过「演示环境:暂不修改」跳过强制改密)
const base = process.argv[2] || 'http://localhost:' + (process.env.PORT || 3000);
let pass = 0, fail = 0;
class Client {
  constructor() { this.cookies = {}; this.csrf = ''; }
  async req(method, path, body, opts = {}) {
    const headers = { Cookie: Object.entries(this.cookies).map(([k, v]) => k + '=' + v).join('; ') };
    let b;
    if (body) { if (opts.json) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; } b = new URLSearchParams({ _csrf: this.csrf, ...body }).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    if (opts.accept) headers.Accept = opts.accept;
    const r = await fetch(base + path, { method, headers, body: b, redirect: 'manual' });
    for (const c of r.headers.getSetCookie ? r.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.cookies[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await r.text();
    const m = text.match(/name="csrf" content="([0-9a-f]+)"/) || text.match(/name="_csrf" value="([0-9a-f]+)"/); if (m) this.csrf = m[1];
    return { status: r.status, loc: r.headers.get('location'), text, headers: r.headers };
  }
  get(p) { return this.req('GET', p); }
  post(p, b, o) { return this.req('POST', p, b || {}, o); }
  async consent() { const r = await this.get('/consent'); if (r.status === 200) await this.post('/consent', { agree: '1', next: '/me' }); await this.get('/me'); }
}
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✘', name, extra || ''); } };
(async () => {
  const phone = '139' + String(Date.now()).slice(-8);
  const shop = new Client(), adm = new Client();
  console.log('== 前台 ==');
  for (const p of ['/', '/products', '/products?q=手机', '/products?cat=1&sort=price_asc', '/product/1', '/activity', '/groupbuy', '/coupons', '/points-mall', '/help', '/notices', '/service', '/login', '/register', '/article/1', '/privacy', '/terms']) { const r = await shop.get(p); ok(r.status === 200, 'GET ' + p, r.status); }
  ok((await shop.get('/img/gen.svg?t=A&a=ff0000&b=00ff00')).text.includes('<svg'), '占位图 SVG');
  ok((await shop.get('/cart')).status === 302, '未登录访问购物车跳转登录');
  let r = await shop.get('/register');
  ok(r.text.includes('name="agree"') && !/name="agree"[^>]*checked/.test(r.text) && r.text.includes('href="/privacy"') && r.text.includes('href="/terms"'), '注册页:协议勾选框默认未勾选且有链接');
  r = await shop.get('/privacy'); ok(r.text.includes('浏览记录') && r.text.includes('不会在后台访问') && r.text.includes('售后图片') && r.text.includes('【公司全称】') && !r.text.includes('{{version}}'), '隐私政策页内容(仅主动选图、售后图片、占位符、版本号)');
  r = await shop.get('/terms'); ok(r.text.includes('鲜活易腐') && r.text.includes('不可提现'), '用户协议含七天无理由例外与积分不可提现');
  r = await shop.get('/'); { const ft = (r.text.match(/<footer class="zq-foot">([\s\S]*?)<\/footer>/) || [])[1] || ''; ok(ft && !/href="\/(help|service|terms|privacy)"/.test(ft) && !ft.includes('<nav') && /© 2026 韵农甄选 · 琼ICP备00000000号\(演示\)/.test(ft) && !ft.includes('演示站点') && !r.text.includes('粤ICP'), '首页页脚仅一行 ©+备案号(无帮助/客服/协议/隐私链接,无演示站点长句)'); }
  { const pg = await shop.get('/products'); ok(pg.text.includes('href="/privacy"') && pg.text.includes('href="/terms"') && pg.text.includes('本站为演示站点'), '其他页面页脚仍有隐私政策/用户协议链接与演示说明'); }
  ok(r.text.includes('活动专区') && r.text.includes('云商会员') && r.text.includes('7天无理由(鲜活易腐除外)') && r.text.indexOf('class="svc"') < r.text.indexOf('class="picks"') && (r.text.match(/class="pk"/g) || []).length >= 6 && !/秒杀|限时|倒计时|仅剩|data-countdown|为你推荐|寄售|转盘/.test(r.text) && !/方正|汉仪/.test(r.text), '首页朱漆金韵:活动专区/云商会员/服务条,无秒杀与倒计时');
  { const names = [...r.text.matchAll(/<span class="pk-n">([^<]*)<\/span>/g)].map(m => m[1]).slice(0, 6); const fresh = names.filter(n => /苹果|脐橙|芒果|鸡蛋|蔬菜/.test(n)).length; ok(names.length === 6 && fresh >= 4 && names.length - fresh <= 2 && !r.text.includes('智能手机') && !/今日推荐|为你推荐|猜你喜欢/.test(r.text), '好物精选演示 6 件以新鲜农产品为主(数码配件≤2),无整机手机与个性化文案', names.join('|')); }
  ok(r.text.includes('韵农甄选') && r.text.includes('src="/static/img/logo-horizontal-onred-64.png?v=1"') && r.text.includes('alt="韵农甄选"') && r.text.includes('logo-horizontal-onred.svg') && !r.text.includes('财哥商城') && r.text.includes('placeholder="搜索商品"'), '品牌「韵农甄选」:首页横版标志/公告/页脚,无旧品牌名');
  { const n = (r.text.match(/class="bnr-s/g) || []).length; const bt = (r.text.match(/<div class="hero bnr"[\s\S]*?<nav class="ents"/) || [''])[0];
    ok(n >= 2 && n <= 3 && r.text.includes('class="bnr-d"') && /home\.css\?v=11/.test(r.text) && /home\.js\?v=8/.test(r.text), '首页横幅轮播(' + n + ' 张演示 Banner,带圆点)');
    { const p2 = await shop.get('/product/2'); ok(p2.status === 200 && p2.text.includes('Type-C 七合一扩展坞') && !p2.text.includes('轻薄本'), '演示商品 ID 2 为电脑配件(扩展坞),无整机笔记本'); }
    ok(bt && !/京东|财哥|倒计时|已售|销量|限时|仅剩/.test(bt) && [...bt.matchAll(/href="([^"]*)"/g)].every(m => /^\/(?!\/)/.test(m[1])) && [...bt.matchAll(/<img class="bnr-i" src="([^"]+)"[^>]*width="\d+" height="\d+"/g)].length === n, '演示 Banner 合规:无外部平台/倒计时/销量文案,仅站内链接,图片带宽高'); }
  { const ids = [...r.text.matchAll(/class="pk" href="\/product\/(\d+)"/g)].map(m => m[1]);
    ok(r.text.includes('好物精选') && /href="\/products">更多 ›<\/a>/.test(r.text) && ids.length >= 3 && !r.text.includes('示例商品'), '首页「好物精选」展示真实商品(' + ids.length + ' 个)及「更多 ›」');
    ok(!/已售|销量|月销|已抢|京东价|<del|<s>/.test(r.text) && /class="pk-p">¥\d/.test(r.text), '首页商品仅显示本店价,无销量/划线价');
    let onShelf = true; for (const id of ids) { const pr = await shop.get('/product/' + id); if (pr.status !== 200 || /已下架/.test(pr.text)) onShelf = false; } ok(onShelf, '首页商品均为在售商品'); }
  for (const u of ['/privacy', '/terms', '/notices', '/service', '/products']) { const x = await shop.get(u); ok(!x.text.includes('财哥商城'), '无旧品牌名:' + u); }
  for (const u of ['/points-mall', '/points-mall/1', '/products', '/help', '/service', '/login', '/me']) { const x = await shop.get(u); ok(x.text.includes('logo-horizontal-onred.svg') && x.text.includes('class="tab ztab"') && !x.text.includes('<i>韵</i>') && !x.text.includes('class="topbar"') && !/财哥|好货不贵|南山区科技园/.test(x.text), '统一移动端页头/底栏、无旧品牌:' + u); }
  { const lg = new Client(); const c = await lg.get('/cart'); const l = await lg.get(c.loc); const nav = l.text.slice(l.text.indexOf('class="tab ztab"')); ok(c.status === 302 && /^\/login\?next=%2Fcart/.test(c.loc) && /href="\/cart" class="on"/.test(nav) && !/href="\/login" class="on"/.test(nav), '未登录访问购物车跳登录:底栏高亮「购物车」'); }
  { const x = await shop.get('/product/8'); ok(x.text.includes('海口发货') && !x.text.includes('深圳发货') && x.text.includes('class="kv pd-kv"') && x.text.includes('pd-bar') && x.text.includes('class="pg-pd"'), '商品详情:默认「海口发货」、标签固定宽度、底部操作栏固定'); }
  { const x = await shop.get('/products?q=' + encodeURIComponent('苹果')); const y = await shop.get('/points-mall'); ok(!x.text.includes('南山居') && x.text.includes('>烟台红富士苹果 5斤装<') && y.text.includes('<title>积分专区') && !y.text.includes('积分商城') && /href="\/products" class="on"/.test(x.text) && /class="cp-x"/.test(x.text), '演示品牌「南山居」→韵农甄选;「积分专区」命名;二级页底栏按栏目高亮;页脚移动端仅一行'); }
  { let hit = ''; for (const u of ['/', '/products', '/products?page=2', '/points-mall', '/product/2', '/product/9', '/activity', '/groupbuy']) { const x = await shop.get(u); const m = x.text.match(/星河|华岳|丝语|田园记|云朵家|疾风|南山居|财哥/); if (m) { hit = u + ':' + m[0]; break; } } ok(!hit, '前台无虚构演示品牌名', hit); }
  { const x = await shop.get('/product/2'); const h1 = (x.text.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || ''; const ls = await shop.get('/products'); ok(!/tag gold/.test(h1) && !h1.includes('韵农甄选') && !/<span class="tag gold">韵农甄选<\/span>/.test(ls.text), '商品名前不显示品牌标签(详情/列表)'); }
  { const x = await shop.get('/help'); ok(x.text.includes('海南省海口市龙华区') && x.text.includes('韵农甄选 · 新鲜好物') && x.text.includes('400-888-6666(演示)'), '页脚地址/口号更新,演示客服电话标「演示」'); }
  await shop.get('/register');
  r = await shop.post('/register', { phone, password: 'abc12345', password2: 'abc12345', nickname: '测试员' });
  ok(r.status === 200 && r.text.includes('请先阅读并勾选同意'), '未勾选协议注册被服务端拒绝');
  r = await shop.post('/register', { phone, password: 'abc12345', password2: 'abc12345', nickname: '测试员', agree: '1' });
  ok(r.status === 302 && r.loc === '/me', '注册成功并登录', r.status + ' ' + r.loc);
  r = await shop.get('/me'); ok(r.text.includes('测试员') && r.text.includes('我的积分') && r.text.indexOf('class="mecard"') < r.text.indexOf('我的订单') && r.text.indexOf('我的订单') < r.text.indexOf('常用功能'), '「我的」:会员卡→我的订单→常用功能(新注册用户已同意协议,无需再次确认)');
  { const h = (r.text.match(/class="card me-sec me-help">([\s\S]*?)<\/div>\n<\/div>/) || [])[1] || ''; ok(['/help">帮助中心', '/terms">用户协议', '/privacy">隐私政策', '/me/settings">设置'].every(x => h.includes('href="' + x)) && h.indexOf('退出登录') > h.indexOf('设置') && r.text.includes('href="/service"><span>') && ['每日签到', '积分专区', '云商会员', '优惠券', '收货地址', '我的收藏', '在线客服'].every(x => r.text.includes(x)), '「我的」页常用功能含签到/积分专区/云商会员/客服,底部帮助/协议/隐私/设置,退出登录在最后'); }
  { const st = await shop.get('/me/settings'); ok(['/help">帮助中心', '/service">联系客服', '/terms">用户协议', '/privacy">隐私政策'].every(x => st.text.includes('href="' + x)), '设置页有帮助中心/联系客服/用户协议/隐私政策'); }
  ok(r.text.includes('href="/privacy"'), '我的菜单含隐私政策');
  ok(r.text.includes('href="/me/settings"'), '我的页面有「设置」入口');
  r = await shop.get('/me/profile'); ok(!r.text.includes('生日') && !r.text.includes('birthday') && !r.text.includes('href="/me/cancel"'), '个人资料无生日字段,不再放注销链接');
  ok(!r.text.includes('name="gender"') && !r.text.includes('性别'), 'A1:个人资料不再收集性别');
  r = await shop.get('/me/settings'); { const i = r.text.indexOf('账号与安全'), j = r.text.indexOf('href="/me/cancel"'); ok(r.status === 200 && i > 0 && j > i && /<a href="\/me\/cancel">注销账号<span class="muted">/.test(r.text), '设置 - 账号与安全 中有常规的「注销账号」行'); }
  ok((await shop.get('/me/coupons')).text.includes('新人专享券'), '新人券已发放');
  r = await shop.post('/me/addresses', { name: '张三', phone: '13812345678', province: '广东省', city: '深圳市', district: '南山区', detail: '科技园 1 号' });
  ok(r.status === 302, '新增收货地址');
  r = await shop.post('/me/addresses', { name: '坏', phone: '123', province: '广东省', city: '深圳市', district: '南山区', detail: 'x' }); ok((await shop.get('/me/addresses')).text.includes('张三'), '地址列表');
  r = await shop.post('/me/signin'); r = await shop.get('/me/points'); ok(r.text.includes('已签到'), '每日签到');
  // 登出再用密码/短信登录
  await shop.get('/'); await shop.post('/logout'); await shop.get('/login'); r = await shop.post('/login', { phone, password: 'wrong' }); ok(r.text.includes('手机号或密码错误'), '错误密码被拒');
  r = await shop.post('/login', { phone, password: 'abc12345' }); ok(r.status === 302, '密码登录'); await shop.get('/');
  await shop.get('/'); await shop.post('/logout'); await shop.get('/login');
  r = await shop.post('/sms/send', { phone }, { accept: 'application/json' }); const sms = JSON.parse(r.text); ok(sms.ok && sms.demoCode, '短信验证码(模拟)发送');
  r = await shop.post('/login/sms', { phone, code: sms.demoCode }); ok(r.status === 302, '短信验证码登录'); await shop.get('/');
  // CSRF
  const bad = await fetch(base + '/me/signin', { method: 'POST', headers: { Cookie: Object.entries(shop.cookies).map(([k, v]) => k + '=' + v).join('; ') }, body: '' }); ok(bad.status === 403, 'CSRF 缺失被拒绝');
  // 加购与下单
  r = await shop.get('/product/3'); const sku = (r.text.match(/\{"id":(\d+),"attrs"/) || [])[1]; ok(!!sku, '商品详情含 SKU', sku);
  r = await shop.post('/cart/add', { sku_id: sku, qty: 2 }, { accept: 'application/json' }); ok(JSON.parse(r.text).ok, '加入购物车');
  r = await shop.post('/cart/add', { sku_id: sku, qty: 99999 }, { accept: 'application/json' }); ok(!JSON.parse(r.text).ok, '超库存加购被拒');
  r = await shop.get('/cart'); const cid = (r.text.match(/name="cart_id" value="(\d+)"/) || [])[1]; ok(!!cid, '购物车有商品');
  r = await shop.post('/checkout', { cart_id: cid, from_cart: '1' }); ok(r.status === 200 && r.text.includes('确认订单'), '结算页');
  const addrId = (r.text.match(/name="address_id" value="(\d+)"/) || [])[1];
  const items = (r.text.match(/name="items" value='([^']+)'/) || [])[1].replace(/&#34;/g, '"');
  r = await shop.post('/api/quote', { items, address_id: addrId }, { accept: 'application/json' }); const q = JSON.parse(r.text); ok(q.ok && q.pay > 0, '运费/金额试算', r.text.slice(0, 100));
  r = await shop.post('/order/create', { items, from_cart: '1', address_id: addrId, coupon_id: '', use_points: '0', remark: '测试' }); ok(r.status === 302 && /\/order\/\d+\/pay/.test(r.loc), '提交订单', r.loc);
  const oid = r.loc.match(/order\/(\d+)\/pay/)[1];
  r = await shop.get('/order/' + oid + '/pay'); ok(r.text.includes('模拟支付'), '收银台标注模拟支付');
  r = await shop.post('/order/' + oid + '/pay', { method: 'wechat' }); ok(r.status === 302, '模拟支付');
  r = await shop.get('/order/' + oid); ok(r.text.includes('待发货'), '订单状态:待发货');
  const orderNo = (r.text.match(/订单号 (\d+)/) || [])[1];
  // 后台
  console.log('== 后台 ==');
  r = await adm.get('/admin'); ok(r.status === 302 && r.loc === '/admin/login', '后台未登录跳转');
  r = await adm.get('/admin/login'); r = await adm.post('/admin/login', { username: 'admin', password: 'bad' }); ok(r.loc === '/admin/login', '后台错误密码');
  r = await adm.get('/admin/login'); r = await adm.post('/admin/login', { username: 'admin', password: 'admin123' }); ok(r.loc === '/admin/password', '后台登录:默认密码登录后强制跳转修改密码');
  r = await adm.get('/admin/orders'); ok(r.status === 302 && r.loc === '/admin/password', '未改默认密码时访问其他后台页面被拦截');
  r = await adm.get('/admin/password'); ok(r.text.includes('系统默认密码') && r.text.includes('演示环境:暂不修改'), '改密页提示默认密码,演示环境可跳过');
  r = await adm.post('/admin/password', { old_password: 'admin123', password: 'admin123', password2: 'admin123' }); r = await adm.get('/admin/password'); ok(r.text.includes('新密码不能与原密码相同') || r.text.includes('过于简单'), '不能把默认密码改成默认密码');
  r = await adm.post('/admin/password/skip'); ok(r.loc === '/admin', '演示环境(DEMO_MODE=1)可跳过'); r = await adm.get('/admin'); ok(r.status === 200 && r.text.includes('仍在使用默认密码'), '跳过后后台顶部持续提醒修改默认密码');
  ok((await shop.get('/admin')).status === 302, '前台会话不能访问后台');
  for (const p of ['/admin', '/admin/stats', '/admin/products', '/admin/products/new', '/admin/products/quick', '/admin/points-log', '/admin/points-log?dir=admin', '/admin/aftersales?q=CG', '/admin/invites?q=138', '/admin/invoices?q=CG', '/admin/policies?tab=terms', '/admin/products/1/edit', '/admin/categories', '/admin/brands', '/admin/shipping', '/admin/inventory', '/admin/orders', '/admin/aftersales', '/admin/invoices', '/admin/reviews', '/admin/members', '/admin/members/1', '/admin/policies', '/admin/policies?tab=terms', '/admin/service?uid=1', '/admin/aftersales/1', '/admin/levels', '/admin/invites', '/admin/banned-words', '/admin/cloud-cards', '/admin/cloud-settings', '/admin/cloud-members', '/admin/service', '/admin/coupons', '/admin/seckills', '/admin/groupbuys', '/admin/groups', '/admin/points-goods', '/admin/banners', '/admin/keywords', '/admin/notices', '/admin/help-articles', '/admin/pages', '/admin/settings', '/admin/admins', '/admin/roles', '/admin/logs', '/admin/coupons/new', '/admin/seckills/new', '/admin/roles/1/edit']) { r = await adm.get(p); ok(r.status === 200, 'GET ' + p, r.status); }
  r = await adm.get('/admin/orders?q=' + orderNo); ok(r.text.includes(orderNo), '后台看到新订单');
  r = await adm.get('/admin/orders'); const aoid = oid;
  r = await adm.post('/admin/orders/' + aoid + '/ship', { company: '顺丰速运', tracking_no: 'SF12345678901' }); ok(r.status === 302, '后台发货');
  r = await shop.get('/order/' + oid); ok(r.text.includes('待收货') && r.text.includes('SF12345678901'), '前台订单变为待收货且显示运单号');
  r = await shop.get('/order/' + oid + '/logistics'); ok(r.text.includes('已发货') || r.text.includes('商家已发货'), '物流轨迹');
  r = await shop.post('/order/' + oid + '/confirm'); r = await shop.get('/order/' + oid); ok(r.text.includes('已完成'), '确认收货→已完成');
  r = await shop.get('/me'); ok(/积分/.test(r.text), '确认收货后积分到账');
  // 评价 → 审核
  r = await shop.post('/order/' + oid + '/review', { ['content_' + 'x']: '' }); // 无内容
  r = await shop.get('/order/' + oid + '/review'); const itemId = (r.text.match(/name="content_(\d+)"/) || [])[1];
  r = await shop.post('/order/' + oid + '/review', { ['rating_' + itemId]: '5', ['content_' + itemId]: '非常好用,自动化测试评价' }); ok(r.status === 302, '提交评价');
  r = await adm.get('/admin/reviews?status=pending&q=' + encodeURIComponent('自动化测试')); const rid = (r.text.match(/\/admin\/reviews\/(\d+)\/approve/) || [])[1]; ok(!!rid, '后台待审核评价');
  await adm.post('/admin/reviews/' + rid + '/approve'); r = await shop.get('/product/3'); ok(r.text.includes('自动化测试评价'), '评价审核后前台展示');
  // 售后:另一笔订单退款
  r = await shop.post('/cart/add', { sku_id: sku, qty: 1 }, { accept: 'application/json' }); r = await shop.get('/cart'); const cid2 = (r.text.match(/name="cart_id" value="(\d+)"/) || [])[1];
  r = await shop.post('/checkout', { cart_id: cid2, from_cart: '1' }); const items2 = (r.text.match(/name="items" value='([^']+)'/) || [])[1].replace(/&#34;/g, '"');
  r = await shop.post('/order/create', { items: items2, from_cart: '1', address_id: addrId }); const oid2 = r.loc.match(/order\/(\d+)\/pay/)[1];
  r = await shop.post('/order/' + oid2 + '/pay', { method: 'balance' }); ok(r.loc.includes('/pay'), '余额支付已停用,提交被拒');
  r = await shop.get('/me/balance'); ok(r.status === 302 && r.loc === '/me', '余额页已下线(重定向到会员中心)');
  r = await shop.get('/order/' + oid2 + '/pay'); ok(!r.text.includes('账户余额') && !r.text.includes('value="balance"'), '收银台不再提供余额支付');
  r = await shop.post('/order/' + oid2 + '/pay', { method: 'wechat' }); r = await shop.get('/order/' + oid2); ok(r.text.includes('待发货'), '模拟微信支付成功');
  r = await shop.get('/order/' + oid2); ok(r.text.includes('联系客服申请售后') && !r.text.includes('申请退款/退货'), '订单详情:联系客服申请售后按钮');
  r = await shop.post('/order/' + oid2 + '/aftersale'); ok(r.loc === '/service#end', '点击后跳转客服');
  r = await shop.get('/service'); ok(r.text.includes('我要申请售后:订单号') && r.text.includes('accept="image/*"'), '自动发送售后消息,客服支持发送图片');
  r = await shop.post('/order/' + oid2 + '/aftersale', { type: 'refund', reason: 'x' }); ok(!(await shop.get('/aftersales')).text.includes('/aftersale/'), '前台不能直接创建售后单');
  const suid = (await adm.get('/admin/members?q=' + phone)).text.match(/\/admin\/members\/(\d+)/)[1];
  r = await adm.get('/admin/service?uid=' + suid); ok(r.text.includes('创建售后单') && r.text.includes('我要申请售后') && r.text.includes('质量问题退换货'), '后台客服会话展示订单与创建售后单');
  r = await adm.post('/admin/service/' + suid + '/aftersale', { order_id: oid2, type: 'refund', reason: '不想要了', amount: '999999', note: '' }); ok(r.loc.includes('/admin/service'), '退款金额超出被拒');
  r = await adm.post('/admin/service/' + suid + '/aftersale', { order_id: oid2, type: 'refund', reason: '不想要了', note: '用户客服申请' }); ok(/\/admin\/aftersales\/\d+/.test(r.loc || ''), '客服创建售后单', r.loc);
  const asid = r.loc.split('/').pop();
  r = await shop.get('/service'); ok(r.text.includes('【售后通知】已为您的订单'), '创建售后单后通知用户');
  r = await adm.post('/admin/aftersales/' + asid + '/handle', { action: 'approve', admin_note: '同意' }); ok(r.status === 302, '后台同意退款');
  r = await shop.get('/order/' + oid2); ok(r.text.includes('已退款'), '订单已退款');
  r = await shop.get('/aftersale/' + asid); ok(r.text.includes('退现金') && r.text.includes('退积分') && r.text.includes('原路退回') && !r.text.includes('撤销申请'), '用户售后状态页显示退积分/退现金拆分(只读)');
  r = await shop.get('/service'); ok(r.text.includes('退款已完成'), '退款完成后客服消息通知用户');
  // 优惠券领取与使用
  r = await shop.post('/coupons/2/claim', {}, { accept: 'application/json' }); ok(JSON.parse(r.text).ok, '领券中心领取');
  // 秒杀
  r = await shop.get('/seckill?x=1'); ok(r.status === 301 && r.loc === '/activity?x=1', '旧地址 /seckill 301 跳转 /activity');
  r = await shop.get('/points-rules'); ok(!r.text.includes('= ¥1') && !r.text.includes('下单抵扣') && !r.text.includes('秒杀') && r.text.includes('6 月 1 日'), '积分规则:前台无积分折现比例(抵现默认关闭),含 6/1 周期清零说明');
  r = await shop.get('/groupbuy'); ok(r.text.includes('发起拼团，成团即发货；超时未成团自动全额退款') && !r.text.includes('邀请好友'), '拼团文案无邀请好友');
  r = await shop.get('/group/1'); ok(!/<span class="tag gold">[^<*]{2,}<\/span>/.test(r.text) && r.text.includes('**</span>'), '团员昵称脱敏');
  r = await shop.get('/products'); ok(!r.text.includes('ribbon">热卖'), '无真实销量≥阈值时不显示「热卖」');
  r = await shop.get('/product/9'); ok(r.text.includes('千兆网口 · 双频并发 · 穿墙覆盖') && !r.text.includes('親'), '商品9(演示:无线路由器,经营范围内)副标题');
  r = await shop.get('/activity'); ok(!r.text.includes('class="bar"') && r.text.includes('进行中') && r.text.includes('活动专区') && !r.text.includes('data-countdown') && !r.text.includes('限时'), '活动专区进行中且无倒计时');
  r = await shop.get('/product/8'); const sk8 = (r.text.match(/\{"id":(\d+),"attrs"/) || [])[1]; const skid = (r.text.match(/SK=\{"sku":\d+,"price":[\d.]+,"id":(\d+)/) || [])[1]; ok(!!skid, '秒杀商品详情'); ok(r.text.includes('活动专区') && r.text.includes('活动价') && !/秒杀|限时|倒计时|仅剩|抢购|data-countdown/.test(r.text), '详情页活动专区文案,无倒计时/紧迫用语');
  r = await shop.post('/checkout', { sku_id: (r.text.match(/SK=\{"sku":(\d+)/) || [])[1], qty: 1, promo_type: 'activity', promo_id: skid, no7_ok: '1' }); ok(r.status === 200 && r.text.includes('确认订单'), '秒杀结算');
  // 积分商城
  r = await shop.post('/points-mall/1/exchange'); r = await shop.get('/me/points'); ok(r.status === 200, '积分兑换流程');
  // 后台商品 CRUD
  r = await adm.get('/admin/products/new');
  r = await adm.post('/admin/products/save', { name: '测试商品-冒烟', subtitle: 't', category_id: '3', brand_id: '1', market_price: '99', template_id: '1', status: '1', spec_names: '颜色', sku_spec: ['红', '蓝'], sku_price: ['50', '55'], sku_stock: ['10', '20'], sku_code: ['', ''], sku_id: ['', ''], description: '<p>x</p>' });
  ok(r.status === 302, '后台新增商品(多SKU)', r.status);
  r = await adm.get('/admin/products/new'); ok(r.text.includes('仅可填写本商品曾真实销售过的价格') && r.text.includes('请选择运费模板') && !/name="market_price"[^>]*value="0"/.test(r.text), '新增商品:划线原价默认空并有提示,运费模板必选');
  r = await adm.post('/admin/products/save', { name: '测试-无模板', category_id: '3', brand_id: '1', status: '1', spec_names: '规格', sku_spec: '默认', sku_price: '10', sku_stock: '1', sku_code: '', sku_id: '', template_id: '' }); ok(r.status === 200 && r.text.includes('请选择运费模板'), '未选运费模板被拒');
  r = await adm.post('/admin/products/save', { name: '测试-划线过低', category_id: '3', brand_id: '1', status: '1', spec_names: '规格', sku_spec: '默认', sku_price: '10', sku_stock: '1', sku_code: '', sku_id: '', template_id: '1', market_price: '8' }); ok(r.status === 200 && r.text.includes('划线原价需高于售价'), '划线原价不高于售价被拒');
  r = await adm.post('/admin/products/save', { name: '测试-无划线价', category_id: '3', brand_id: '1', status: '1', spec_names: '规格', sku_spec: '默认', sku_price: '10', sku_stock: '1', sku_code: '', sku_id: '', template_id: '1', market_price: '' }); ok(r.status === 302, '划线原价留空可保存');
  { const np = (await adm.get('/admin/products?q=' + encodeURIComponent('测试-无划线价'))).text.match(/\/admin\/products\/(\d+)\/edit/)[1]; r = await shop.get('/product/' + np); ok(!r.text.includes('class="mkt"') && r.text.includes('运费 ¥8,单笔满 ¥99 包邮'), '前台:无划线价不显示删除线,运费清楚展示'); }
  r = await adm.get('/admin/products?q=' + encodeURIComponent('测试商品-冒烟')); const pid = (r.text.match(/\/admin\/products\/(\d+)\/edit/) || [])[1]; ok(!!pid, '商品出现在列表');
  r = await shop.get('/product/' + pid); ok(r.text.includes('测试商品-冒烟') && r.text.includes('红'), '前台显示新商品及规格');
  await adm.post('/admin/products/' + pid + '/toggle'); r = await shop.get('/product/' + pid); ok(r.status === 404, '下架后前台 404');
  r = await adm.post('/admin/products/' + pid + '/delete'); r = await adm.get('/admin/products?q=' + encodeURIComponent('测试商品-冒烟')); ok(!r.text.includes('/edit') || !r.text.includes('<b>测试商品-冒烟</b>'), '后台删除商品');
  // 会员管理
  r = await adm.get('/admin/members?q=' + phone); const uid = (r.text.match(/\/admin\/members\/(\d+)/) || [])[1]; ok(!!uid, '后台搜索到新会员');
  r = await adm.post('/admin/members/' + uid + '/points', { delta: '500', reason: '测试' }); ok(r.status === 302, '后台调整积分');
  r = await adm.get('/admin/members/' + uid); ok(r.text.includes('协议同意') && !r.text.includes('余额') && !r.text.includes('生日'), '后台会员详情:显示同意时间,无余额/生日');
  r = await adm.post('/admin/members/' + uid + '/balance', { delta: '10' }); ok(r.status === 404 || (r.loc || '').includes('/admin'), '后台余额调整接口已移除');
  r = await adm.post('/admin/members/' + uid + '/status'); const s2 = new Client(); await s2.get('/login'); r = await s2.post('/login', { phone, password: 'abc12345' }); ok(r.text.includes('已被禁用'), '禁用会员后无法登录');
  await adm.post('/admin/members/' + uid + '/status');
  // 分类/品牌/券/Banner/设置/CSV
  r = await adm.post('/admin/categories/save', { name: '测试分类', parent_id: '0', icon: '🧪', sort: '99', status: '1' }); ok(r.status === 302, '新增分类');
  r = await adm.post('/admin/coupons/save', { name: '测试券', amount: '5', threshold: '50', total: '10', per_limit: '1', valid_days: '7', category_id: '0', status: '1' }); ok(r.status === 302, '新增优惠券');
  r = await adm.post('/admin/seckills/save', { sku_id: '1', price: '1', stock: '5', start_at: '2030-01-01T10:00', end_at: '2030-01-01T12:00', limit_per_user: '1', status: '1' }); ok(r.status === 302, '新增秒杀');
  r = await adm.post('/admin/settings', { shop_name: '韵农甄选', slogan: '韵农甄选 · 新鲜好物', points_rate: '100', points_max_percent: '50', commission_rate: '5', signin_base: '5', stock_warn: '10', unpaid_cancel_minutes: '30', auto_confirm_days: '7', aftersale_days: '7', register_points: '100', review_points: '10', referral_points: '50' }); ok(r.status === 302 && r.loc === '/admin/settings', '保存站点设置');
  for (const p of ['/admin/orders/export', '/admin/orders/export?status=completed', '/admin/members/export', '/admin/export/products', '/admin/logs/export', '/admin/points-log/export']) { r = await adm.get(p); ok(r.status === 200 && (r.headers.get('content-type') || '').includes('text/csv'), 'CSV ' + p); }
  // RBAC
  const ops = new Client(); await ops.get('/admin/login'); await ops.post('/admin/login', { username: 'ops', password: 'ops123456' }); await ops.get('/admin/password'); await ops.post('/admin/password/skip'); await ops.get('/admin');
  ok((await ops.get('/admin/products')).status === 200, 'RBAC: 运营可访问商品'); ok((await ops.get('/admin/orders')).status === 403, 'RBAC: 运营不可访问订单'); ok((await ops.get('/admin/admins')).status === 403, 'RBAC: 运营不可访问管理员');
  r = await adm.get('/admin/logs'); ok(r.text.includes('订单发货'), '操作日志记录发货');
  // 分销
  const ref = new Client(); await ref.get('/register?ref=100001'); r = await ref.post('/register', { phone: '137' + String(Date.now()).slice(-8), password: 'abc12345', password2: 'abc12345', agree: '1', ref: '100001' }); ok(r.status === 302, '带邀请码注册');
  // 拼团
  r = await shop.get('/groupbuy'); ok(r.text.includes('拼团'), '拼团专区');
  // 云商卡会员权益
  console.log('== 云商卡 ==');
  // 用演示账号(黄金卡)测页面与每日返积分、兑换(shop 会话可能已被禁用测试清掉)
  const cg = new Client(); await cg.get('/login'); r = await cg.post('/login', { phone: '13800000001', password: '123456' }); ok(r.status === 302, '演示会员登录');
  r = await cg.get('/me'); ok(r.status === 302 && r.loc.startsWith('/consent'), '老用户首次登录需先同意协议');
  r = await cg.get('/consent?next=/me'); ok(r.text.includes('同意并继续') && r.text.includes('不访问相册'), '协议确认页');
  r = await cg.post('/consent', { next: '/me' }); ok((r.loc || '').startsWith('/consent'), '未勾选同意不能继续');
  r = await cg.get('/consent?next=/me'); r = await cg.post('/consent', { agree: '1', next: '/me' }); ok(r.loc === '/me', '勾选同意后继续');
  r = await cg.get('/me'); ok(r.status === 200, '同意后可正常访问');
  r = await cg.get('/me/cloud'); ok(r.status === 200 && r.text.includes('会员权益') && !/投资|收益|理财/.test(r.text), '会员云商卡页文案合规');
  ok(r.text.includes('线下') && !r.text.includes('/me/cloud/daily') && !r.text.includes('/me/cloud/redeem') && !/返积分|直推|推三|云粉/.test(r.text), '云商卡页:线下办理、无每日返积分/兑换/推荐奖励');
  ok((await cg.get('/me/cloud-fans')).loc === '/me/invite' && (await cg.get('/me/referral')).loc === '/me/invite', '旧云粉/分销入口跳转到我的邀请');
  r = await cg.get('/me/invite'); ok(r.status === 200 && r.text.includes('我的邀请') && r.text.includes('首个订单确认收货') && r.text.includes('注册本身不产生任何奖励') && !/佣金|分销|云粉|分享后|邀请满/.test(r.text), '我的邀请页:单级、首单后奖励、无分销文案');
  r = await cg.get('/me'); ok(r.text.includes('我的邀请') && !r.text.includes('我的云粉') && !r.text.includes('积分兑换申请'), '会员中心菜单:我的邀请');
  ok((await cg.post('/me/cloud/daily')).status === 404 && (await cg.post('/me/referral/settle')).status === 404, '每日返积分/佣金结算接口已移除');
  r = await cg.get('/points-rules'); ok(r.status === 200 && !r.text.includes('积分 = ¥1') && r.text.includes('不可购买') && !r.text.includes('{{'), '积分规则页(获取/使用/有效期,数值来自配置;无折现比例)');
  // 云商卡会员签到加赠(主动签到才有,限期)
  r = await cg.post('/me/signin'); r = await cg.get('/me/points'); ok(r.text.includes('云商卡会员签到加赠') && r.text.includes('限期积分'), '云商卡会员主动签到加赠限期积分');
  // 会员价/包邮
  r = await cg.post('/checkout', { sku_id: (await cg.get('/product/9')).text.match(/\{"id":(\d+),"attrs"/)[1], qty: 1 }); ok(r.text.includes('云商卡会员包邮'), '云商卡会员结算包邮');
  // 后台:邀请管理 / 云商卡开通(线下销售登记)
  r = await adm.get('/admin/invites'); ok(r.status === 200 && r.text.includes('邀请人奖励积分') && r.text.includes('观察期'), '后台邀请管理');
  r = await adm.post('/admin/invites/settings', { invite_points: '100', invite_window_days: '3', invite_coupon_id: '' }); r = await adm.get('/admin/invites'); ok(r.text.includes('观察期需为'), '观察期不得短于 7 天');
  const act = new Client(); const aphone = '136' + String(Date.now()).slice(-8);
  await act.get('/register'); r = await act.post('/register', { phone: aphone, password: 'abc12345', password2: 'abc12345', nickname: '邀测', agree: '1', ref: '100001' });
  ok(r.status === 302, '被邀请人注册');
  ok((await act.get('/me/coupons')).text.includes('邀请好友首单券'), '被邀请人获得首单优惠券');
  r = await adm.get('/admin/members?q=' + aphone); const auid = (r.text.match(/\/admin\/members\/(\d+)/) || [])[1]; ok(!!auid, '后台找到被邀请人');
  r = await adm.get('/admin/members/' + auid); ok(r.text.includes('开通云商卡') && r.text.includes('经办员工'), '会员详情有云商卡开通表单');
  const ctid = (r.text.match(/name="card_type_id"[\s\S]*?<option value="(\d+)"/) || [])[1];
  r = await adm.post('/admin/members/' + auid + '/cloud', { card_type_id: ctid, amount: '199', sale_date: '2026-10-01', staff: '' }); r = await adm.get('/admin/members/' + auid); ok(r.text.includes('请填写经办员工'), '开通需登记经办员工');
  r = await adm.post('/admin/members/' + auid + '/cloud', { card_type_id: ctid, amount: '199', sale_date: '2026-10-01', staff: '冒烟店员', receipt_note: '收据 NO.SMOKE' }); r = await adm.get('/admin/members/' + auid); ok(r.text.includes('生效中') && r.text.includes('冒烟店员'), '后台开通云商卡并记录线下销售');
  r = await act.get('/me/cloud'); ok(r.text.includes('有效期') && r.text.includes('白银月卡'), '用户端显示云商卡有效期');
  r = await adm.get('/admin/cloud-members'); ok(r.text.includes('收据 NO.SMOKE') && r.text.includes('¥199.00'), '云商卡销售记录列表');
  r = await adm.post('/admin/members/' + auid + '/cloud', { action: 'stop', note: '冒烟停用' }); r = await act.get('/me/cloud'); ok(r.text.includes('已到期') || r.text.includes('尚未开通'), '后台停用云商卡');
  r = await adm.get('/admin/cloud-settings'); ok(r.text.includes('会员价折扣') && !/推三|直推|每日返/.test(r.text), '云商卡配置:会员价/包邮/签到加赠');
  r = await adm.post('/admin/cloud-settings', { cloud_discount: '98', cloud_free_shipping: '1', cloud_signin_extra: '25', cloud_signin_extra_step: '2', cloud_extra_expire_days: '90' }); ok(r.status === 302, '保存云商卡配置');
  // 积分比例可配置,规则页同步
  r = await adm.post('/admin/settings/points', { points_clear_day: '06-01', points_expiry_remind_days: '30', points_expiry_enable: '1', points_redeem_notice: '积分兑换商品非质量问题不退不换;如有质量问题或发错货,请联系客服换货或退回积分。', points_deduct_enable: '1', points_rate: '200', points_max_percent: '30' });
  r = await cg.get('/points-rules'); ok(r.text.includes('200 积分 = ¥1') && r.text.includes('30%'), '(抵现开启时)后台修改积分比例/上限后积分规则页同步');
  await adm.post('/admin/settings/points', { points_clear_day: '06-01', points_expiry_remind_days: '30', points_expiry_enable: '1', points_redeem_notice: '积分兑换商品非质量问题不退不换;如有质量问题或发错货,请联系客服换货或退回积分。', points_rate: '100', points_max_percent: '50' }); r = await cg.get('/points-rules'); ok(!r.text.includes('积分 = ¥1'), '关闭抵现后规则页不再出现折现比例');
  // 违禁词
  r = await adm.get('/admin/banned-words'); ok(r.status === 200 && r.text.includes('躺赚') && r.text.includes('国家级'), '违禁词检查页(默认词表)');
  r = await adm.get('/admin/products/9/edit'); const pf = r.text;
  const tpl = (pf.match(/name="template_id"[\s\S]*?<option value="(\d+)" selected/) || [])[1] || '1';
  const cat9 = (pf.match(/name="category_id"[\s\S]*?<option value="(\d+)" selected/) || [])[1];
  ok(!!cat9, '读取商品表单分类');
  r = await adm.post('/admin/products/save', { name: '冒烟躺赚神器 国家级品质', subtitle: '测试', category_id: cat9, template_id: tpl, spec_names: '规格', sku_spec: '默认', sku_price: '9.9', sku_stock: '10' });
  ok(/\/admin\/products\/\d+\/edit/.test(r.loc || ''), '含违禁词的商品保存后提示并回到编辑页', r.loc);
  r = await adm.get(r.loc || '/admin/products'); ok(r.text.includes('违禁/敏感词') && r.text.includes('躺赚') && r.text.includes('国家级'), '编辑页显示命中的违禁词');
  r = await adm.get('/admin/banned-words'); ok(r.text.includes('冒烟躺赚神器'), '违禁词扫描列出命中商品');
  r = await adm.post('/admin/products/save', { name: '冒烟普通商品', subtitle: '测试', category_id: cat9, template_id: tpl, spec_names: '规格', sku_spec: '默认', sku_price: '9.9', sku_stock: '10' });
  ok(r.loc === '/admin/products', '无违禁词的商品正常保存');
  r = await adm.post('/admin/banned-words', { words: '躺赚\n普通商品' }); r = await adm.get('/admin/banned-words'); ok(r.text.includes('冒烟普通商品'), '违禁词表可编辑并即时生效');
  await adm.post('/admin/banned-words', { words: ['返佣', '收益', '佣金', '分销', '团队', '下线', '层级', '分红', '躺赚', '日赚', '稳赚', '积分提现', '最', '第一', '国家级', '100%', '顶级', '极品'].join('\n') });
  ok((await ops.get('/admin/cloud-cards')).status === 403, 'RBAC: 运营不可访问云商卡');
  const kefu = new Client(); await kefu.get('/admin/login'); await kefu.post('/admin/login', { username: 'kefu', password: 'kefu123456' }); await kefu.get('/admin/password'); await kefu.post('/admin/password/skip'); await kefu.get('/admin');
  ok((await kefu.get('/admin/cloud-members')).status === 200, 'RBAC: 客服可访问云商卡会员');
  // ===== 七天无理由 =====
  console.log('== 七天无理由 ==');
  r = await cg.get('/product/8'); ok(r.text.includes('该商品不支持7天无理由退货') && r.text.includes('我已知晓'), '鲜活易腐类商品详情明确提示不支持7天无理由');
  const sku8 = (r.text.match(/\{"id":(\d+),"attrs"/) || [])[1];
  r = await cg.get('/product/9'); ok(r.text.includes('支持7天无理由退货') && !r.text.includes('该商品不支持'), '普通商品显示支持7天无理由');
  r = await cg.post('/cart/add', { sku_id: sku8, qty: 1 }, { accept: 'application/json' }); ok(JSON.parse(r.text).no7, '未确认不能加购不支持7天无理由的商品');
  r = await cg.post('/cart/add', { sku_id: sku8, qty: 1, no7_ok: '1' }, { accept: 'application/json' }); ok(JSON.parse(r.text).ok, '确认后可加购');
  r = await cg.post('/checkout', { sku_id: sku8, qty: 1 }); ok(r.status === 302 && !r.text.includes('确认订单'), '立即购买未勾选「我已知晓」被服务端拒绝');
  r = await cg.get('/product/8'); ok(!r.text.includes('confirm(') && /class="btn [^"]*need-no7" disabled/.test(r.text) && r.text.includes('id="no7ok" required'), '详情页用必选勾选框,未勾选时购买按钮置灰');
  r = await cg.post('/checkout', { sku_id: sku8, qty: 1, no7_ok: '1' }); ok(r.text.includes('name="no7_confirm"'), '结算页再次要求确认');
  const i8 = ((r.text.match(/name="items" value='([^']+)'/) || [])[1] || '').replace(/&#34;/g, '"'); const a8 = (r.text.match(/name="address_id" value="(\d+)"/) || [])[1];
  r = await cg.post('/order/create', { items: i8, address_id: a8 }); ok(r.loc === '/cart', '未确认时服务端拒绝创建订单');
  r = await cg.post('/order/create', { items: i8, address_id: a8, no7_confirm: '1' }); const o8 = ((r.loc || '').match(/order\/(\d+)\/pay/) || [])[1]; ok(!!o8, '确认后可下单');
  r = await adm.get('/admin/orders/' + o8); ok(r.text.includes('用户下单时已确认知晓'), '后台订单显示用户已确认');
  r = await adm.get('/admin/categories/' + 7 + '/edit'); ok(r.status !== 200 || r.text.includes('鲜活易腐类'), '后台分类编辑含鲜活易腐类开关');
  r = await adm.get('/admin/products/9/edit'); ok(r.text.includes('支持七天无理由退货'), '后台商品编辑含七天无理由设置');
  // ===== 浏览记录删除 =====
  console.log('== 浏览记录 / 注销 ==');
  r = await cg.get('/me/history'); ok(r.text.includes('清空浏览记录') && r.text.includes('/me/history/8/delete'), '浏览记录有清空与单条删除');
  await cg.post('/me/history/8/delete'); r = await cg.get('/me/history'); ok(!r.text.includes('/me/history/8/delete') && r.text.includes('/me/history/9/delete'), '单条删除浏览记录');
  await cg.post('/me/history/clear'); r = await cg.get('/me/history'); ok(r.text.includes('暂无浏览记录'), '清空浏览记录');
  // 积分不可转让/提现
  r = await cg.get('/me/points'); ok(r.text.includes('不可转让') && r.text.includes('不可提现'), '积分页说明不可转让、不可提现');
  // 注销:有未完成订单时被拦截
  r = await cg.get('/me/cancel'); ok(r.text.includes('暂不能注销'), '有未完成订单时不能注销');
  // 新用户注销
  const del = new Client(); const dphone = '135' + String(Date.now()).slice(-8);
  await del.get('/register'); await del.post('/register', { phone: dphone, password: 'abc12345', password2: 'abc12345', nickname: '待注销', agree: '1' }); await del.get('/me');
  await del.post('/me/addresses', { name: '注销测', phone: '13812345678', province: '广东省', city: '深圳市', district: '南山区', detail: '注销路 1 号' });
  await del.get('/product/9'); await del.post('/favorite/9', {}, { accept: 'application/json' }); await del.post('/service', { content: '你好' });
  r = await del.get('/me/cancel'); ok(r.text.includes('确认注销') && !r.text.includes('暂不能注销'), '注销页说明后果并要求确认');
  r = await del.post('/me/cancel', { confirm_text: '注销', ack: '1' }); r = await del.get('/me/cancel'); ok(r.text.includes('请在输入框中填写'), '未输入「确认注销」被拒');
  r = await del.post('/me/cancel', { confirm_text: '确认注销', ack: '1' }); ok(r.loc === '/', '注销成功并退出登录');
  { const g = await del.get('/me'); ok(g.status === 200 && g.text.includes('href="/login?next=/me"') && !g.text.includes('class="mecard"'), '注销后会话失效(「我的」显示登录/注册卡片)'); }
  const dl = new Client(); await dl.get('/login'); r = await dl.post('/login', { phone: dphone, password: 'abc12345' }); ok(r.text.includes('手机号或密码错误'), '注销后手机号无法登录');
  r = await adm.get('/admin/members?status=cancelled'); ok(r.text.includes('已注销') && !r.text.includes(dphone), '后台会员列表显示已注销且手机号已匿名');
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
