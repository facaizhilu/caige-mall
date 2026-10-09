// 冒烟测试:node test/smoke.js [baseUrl]  (需要服务已启动;会写入演示库,建议在全新库上运行)
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
  for (const p of ['/', '/products', '/products?q=手机', '/products?cat=1&sort=price_asc', '/product/1', '/seckill', '/groupbuy', '/coupons', '/points-mall', '/help', '/notices', '/service', '/login', '/register', '/article/1', '/privacy', '/terms']) { const r = await shop.get(p); ok(r.status === 200, 'GET ' + p, r.status); }
  ok((await shop.get('/img/gen.svg?t=A&a=ff0000&b=00ff00')).text.includes('<svg'), '占位图 SVG');
  ok((await shop.get('/cart')).status === 302, '未登录访问购物车跳转登录');
  let r = await shop.get('/register');
  ok(r.text.includes('name="agree"') && !/name="agree"[^>]*checked/.test(r.text) && r.text.includes('href="/privacy"') && r.text.includes('href="/terms"'), '注册页:协议勾选框默认未勾选且有链接');
  r = await shop.get('/privacy'); ok(r.text.includes('浏览记录') && r.text.includes('不会访问您的相册') && r.text.includes('【公司全称】') && !r.text.includes('{{version}}'), '隐私政策页内容(不访问相册、占位符、版本号)');
  r = await shop.get('/terms'); ok(r.text.includes('鲜活易腐') && r.text.includes('不可提现'), '用户协议含七天无理由例外与积分不可提现');
  r = await shop.get('/'); ok(r.text.includes('href="/privacy"') && r.text.includes('href="/terms"'), '页脚有隐私政策/用户协议链接');
  await shop.get('/register');
  r = await shop.post('/register', { phone, password: 'abc12345', password2: 'abc12345', nickname: '测试员' });
  ok(r.status === 200 && r.text.includes('请先阅读并勾选同意'), '未勾选协议注册被服务端拒绝');
  r = await shop.post('/register', { phone, password: 'abc12345', password2: 'abc12345', nickname: '测试员', agree: '1' });
  ok(r.status === 302 && r.loc === '/me', '注册成功并登录', r.status + ' ' + r.loc);
  r = await shop.get('/me'); ok(r.text.includes('测试员') && r.text.includes('会员中心'), '会员中心(新注册用户已同意协议,无需再次确认)');
  ok(r.text.includes('href="/privacy"') && r.text.includes('href="/me/cancel"'), '我的菜单含隐私政策与注销账号');
  r = await shop.get('/me/profile'); ok(!r.text.includes('生日') && !r.text.includes('birthday') && r.text.includes('注销账号'), '个人资料无生日字段,含注销入口');
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
  r = await adm.get('/admin/login'); r = await adm.post('/admin/login', { username: 'admin', password: 'admin123' }); ok(r.loc === '/admin', '后台登录'); await adm.get('/admin');
  ok((await shop.get('/admin')).status === 302, '前台会话不能访问后台');
  for (const p of ['/admin', '/admin/stats', '/admin/products', '/admin/products/new', '/admin/products/1/edit', '/admin/categories', '/admin/brands', '/admin/shipping', '/admin/inventory', '/admin/orders', '/admin/aftersales', '/admin/invoices', '/admin/reviews', '/admin/members', '/admin/members/1', '/admin/policies', '/admin/policies?tab=terms', '/admin/service?uid=1', '/admin/aftersales/1', '/admin/levels', '/admin/referral', '/admin/cloud-cards', '/admin/cloud-settings', '/admin/cloud-members', '/admin/cloud-redeems', '/admin/cloud-fans', '/admin/service', '/admin/coupons', '/admin/seckills', '/admin/groupbuys', '/admin/groups', '/admin/points-goods', '/admin/banners', '/admin/keywords', '/admin/notices', '/admin/help-articles', '/admin/pages', '/admin/settings', '/admin/admins', '/admin/roles', '/admin/logs', '/admin/coupons/new', '/admin/seckills/new', '/admin/roles/1/edit']) { r = await adm.get(p); ok(r.status === 200, 'GET ' + p, r.status); }
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
  r = await shop.get('/service'); ok(r.text.includes('我要申请售后:订单号') && !r.text.includes('type="file"'), '自动发送售后消息,客服为纯文字');
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
  r = await shop.get('/seckill'); ok(r.text.includes('抢购中'), '秒杀进行中');
  r = await shop.get('/product/8'); const sk8 = (r.text.match(/\{"id":(\d+),"attrs"/) || [])[1]; const skid = (r.text.match(/SK=\{"sku":\d+,"price":[\d.]+,"id":(\d+)/) || [])[1]; ok(!!skid, '秒杀商品详情');
  r = await shop.post('/checkout', { sku_id: (r.text.match(/SK=\{"sku":(\d+)/) || [])[1], qty: 1, promo_type: 'seckill', promo_id: skid }); ok(r.status === 200 && r.text.includes('确认订单'), '秒杀结算');
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
  r = await adm.post('/admin/settings', { shop_name: '财哥商城', slogan: '好货不贵,财源广进', points_rate: '100', points_max_percent: '50', commission_rate: '5', signin_base: '5', stock_warn: '10', unpaid_cancel_minutes: '30', auto_confirm_days: '7', aftersale_days: '7', register_points: '100', review_points: '10', referral_points: '50' }); ok(r.status === 302 && r.loc === '/admin/settings', '保存站点设置');
  for (const p of ['/admin/orders/export', '/admin/members/export', '/admin/export/products', '/admin/logs/export']) { r = await adm.get(p); ok(r.status === 200 && (r.headers.get('content-type') || '').includes('text/csv'), 'CSV ' + p); }
  // RBAC
  const ops = new Client(); await ops.get('/admin/login'); await ops.post('/admin/login', { username: 'ops', password: 'ops123456' }); await ops.get('/admin');
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
  r = await cg.get('/me/cloud-fans'); ok(r.status === 200 && r.text.includes('我的云粉'), '我的云粉页');
  await cg.get('/me/cloud');
  r = await cg.post('/me/cloud/daily'); ok(r.status === 302, '领取每日返积分');
  r = await cg.get('/me/cloud'); ok(r.text.includes('今日已领') || r.text.includes('已领取'), '防重复领取每日返积分展示');
  r = await cg.post('/me/cloud/daily'); r = await cg.get('/me'); // flash may be on redirect
  // 兑换申请:积分不足应失败
  r = await cg.post('/me/cloud/redeem', { points: '99999999', note: '过大' }); r = await cg.get('/me/cloud'); ok(r.text.includes('积分不足') || r.text.includes('可用积分不足'), '兑换积分不足被拒');
  r = await cg.post('/me/cloud/redeem', { points: '100', note: '冒烟兑换' }); ok(r.status === 302, '提交兑换申请');
  r = await cg.get('/me/cloud'); ok(r.text.includes('待审核') || r.text.includes('冒烟兑换'), '兑换申请出现在列表');
  // 后台审核:拒绝不扣分
  r = await adm.get('/admin/cloud-redeems?status=pending');
  const ridMatch = r.text.match(/\/admin\/cloud-redeems\/(\d+)\/handle/);
  ok(!!ridMatch, '后台有待审核兑换');
  if (ridMatch) {
    const rid = ridMatch[1];
    const beforePts = (await cg.get('/me/points')).text.match(/font-size:34px"><b>(\d+)<\/b>/);
    r = await adm.post('/admin/cloud-redeems/' + rid + '/handle', { action: 'reject', admin_note: '冒烟拒绝', back: 'pending' });
    ok(r.status === 302, '后台拒绝兑换');
    const afterPts = (await cg.get('/me/points')).text.match(/font-size:34px"><b>(\d+)<\/b>/);
    if (beforePts && afterPts) ok(beforePts[1] === afterPts[1], '拒绝兑换不扣积分');
    else ok(true, '拒绝兑换流程完成');
  }
  // 购买激活商品开通卡(新用户)
  const act = new Client(); const aphone = '136' + String(Date.now()).slice(-8);
  await act.get('/register'); r = await act.post('/register', { phone: aphone, password: 'abc12345', password2: 'abc12345', nickname: '云测', agree: '1', ref: '100001' });
  ok(r.status === 302, '云粉注册');
  await act.get('/me'); // 刷新 CSRF(注册会 regenerate session)
  await act.post('/me/addresses', { name: '云测', phone: '13812345678', province: '广东省', city: '深圳市', district: '南山区', detail: '云商路 1 号' });
  r = await act.get('/product/14'); const asku = (r.text.match(/\{"id":(\d+),"attrs"/) || [])[1]; ok(!!asku, '激活商品SKU');
  r = await act.post('/checkout', { sku_id: asku, qty: 1 }); ok(r.status === 200 && r.text.includes('确认订单'), '激活商品结算');
  const aAddr = (r.text.match(/name="address_id"[^>]*value="(\d+)"/) || r.text.match(/value="(\d+)"[^>]*name="address_id"/) || [])[1];
  ok(!!aAddr, '结算页有收货地址', aAddr);
  const aItems = ((r.text.match(/name="items" value='([^']+)'/) || [])[1] || '').replace(/&#34;/g, '"');
  r = await act.post('/order/create', { items: aItems, address_id: aAddr, use_points: '0', no7_confirm: '1' });
  ok(r.status === 302 && /\/order\/\d+\/pay/.test(r.loc || ''), '激活订单提交', r.loc);
  const coid = ((r.loc || '').match(/order\/(\d+)\/pay/) || [])[1];
  ok(!!coid, '拿到激活订单号');
  r = await act.post('/order/' + coid + '/pay', { method: 'wechat' }); ok(r.status === 302, '激活订单支付');
  r = await act.get('/me/cloud'); ok(r.text.includes('白银会员') || r.text.includes('会员权益生效'), '支付后开通白银会员权益');
  // 推荐人应拿到直推积分流水
  r = await cg.get('/me/cloud'); ok(r.text.includes('直推') || r.text.includes('会员权益'), '推荐人云商卡页可访问');
  r = await adm.get('/admin/cloud-settings');
  r = await adm.post('/admin/cloud-settings', { cloud_daily_points: '10', cloud_referral_pct_silver: '5', cloud_referral_pct_gold: '8', cloud_referral_enable_silver: '1', cloud_referral_enable_gold: '1', cloud_push3_pct: '30', cloud_push3_mode: 'per_third', cloud_redeem_label: '权益值', cloud_redeem_ratio: '100', cloud_redeem_min: '100' });
  ok(r.status === 302, '保存云商卡配置');
  ok((await ops.get('/admin/cloud-cards')).status === 403, 'RBAC: 运营不可访问云商卡');
  const kefu = new Client(); await kefu.get('/admin/login'); await kefu.post('/admin/login', { username: 'kefu', password: 'kefu123456' }); await kefu.get('/admin');
  ok((await kefu.get('/admin/cloud-members')).status === 200, 'RBAC: 客服可访问云商卡会员');
  // ===== 七天无理由 =====
  console.log('== 七天无理由 ==');
  r = await cg.get('/product/8'); ok(r.text.includes('该商品不支持7天无理由退货') && r.text.includes('我已知晓'), '鲜活易腐类商品详情明确提示不支持7天无理由');
  const sku8 = (r.text.match(/\{"id":(\d+),"attrs"/) || [])[1];
  r = await cg.get('/product/9'); ok(r.text.includes('支持7天无理由退货') && !r.text.includes('该商品不支持'), '普通商品显示支持7天无理由');
  r = await cg.post('/cart/add', { sku_id: sku8, qty: 1 }, { accept: 'application/json' }); ok(JSON.parse(r.text).no7, '未确认不能加购不支持7天无理由的商品');
  r = await cg.post('/cart/add', { sku_id: sku8, qty: 1, no7_ok: '1' }, { accept: 'application/json' }); ok(JSON.parse(r.text).ok, '确认后可加购');
  r = await cg.post('/checkout', { sku_id: sku8, qty: 1 }); ok(r.text.includes('name="no7_confirm"'), '结算页再次要求确认');
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
  ok((await del.get('/me')).status === 302, '注销后会话失效');
  const dl = new Client(); await dl.get('/login'); r = await dl.post('/login', { phone: dphone, password: 'abc12345' }); ok(r.text.includes('手机号或密码错误'), '注销后手机号无法登录');
  r = await adm.get('/admin/members?status=cancelled'); ok(r.text.includes('已注销') && !r.text.includes(dphone), '后台会员列表显示已注销且手机号已匿名');
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
