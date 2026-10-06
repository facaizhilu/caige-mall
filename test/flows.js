// 进阶流程测试:拼团成团/失败、秒杀下单、优惠券+积分抵扣、退货退款、评价图片上传
const base = process.argv[2] || 'http://localhost:' + (process.env.PORT || 3000);
const db = require('../lib/db');
let pass = 0, fail = 0;
const ok = (c, n, x) => { c ? (pass++, console.log('  ✔', n)) : (fail++, console.log('  ✘', n, x || '')); };
class C { constructor() { this.k = {}; this.t = ''; }
  async req(m, p, body, o = {}) { const h = { Cookie: Object.entries(this.k).map(([a, b]) => a + '=' + b).join('; ') }; let b; if (body && !o.form) { b = new URLSearchParams({ _csrf: this.t, ...body }).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; } if (o.form) { body.append('_csrf', this.t); b = body; } if (o.json) h.Accept = 'application/json';
    const r = await fetch(base + p, { method: m, headers: h, body: b, redirect: 'manual' }); for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.k[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await r.text(); const mm = text.match(/name="csrf" content="([0-9a-f]+)"/) || text.match(/name="_csrf" value="([0-9a-f]+)"/); if (mm) this.t = mm[1]; return { status: r.status, loc: r.headers.get('location'), text }; }
  get(p) { return this.req('GET', p); } post(p, b, o) { return this.req('POST', p, b || {}, o); }
  async login(phone, pw) { await this.get('/login'); const r = await this.post('/login', { phone, password: pw }); await this.get('/'); return r; } }
(async () => {
  const items = t => JSON.parse(t.match(/name="items" value='([^']+)'/)[1].replace(/&#34;/g, '"'));
  const itemsRaw = t => t.match(/name="items" value='([^']+)'/)[1].replace(/&#34;/g, '"');
  const a = new C(), b = new C(), adm = new C();
  await a.login('13800000002', '123456'); await b.login('13800000003', '123456'); // 小美 / 老王
  console.log('== 拼团 ==');
  // 老王已发起一个团(已付),小美参团
  let r = await a.get('/groupbuy'); ok(r.text.includes('正在拼团'), '拼团专区展示进行中的团');
  const gid = (r.text.match(/\/group\/(\d+)/) || [])[1]; r = await a.get('/group/' + gid); ok(r.text.includes('立即参团'), '参团页');
  const gb = db.get('SELECT * FROM groupbuys WHERE id=1');
  r = await a.post('/checkout', { sku_id: gb.sku_id, qty: 1, promo_type: 'group', promo_id: gb.id, group_id: gid }); ok(r.text.includes('确认订单'), '参团结算页');
  const addr = (r.text.match(/name="address_id" value="(\d+)"/) || [])[1];
  r = await a.post('/order/create', { items: itemsRaw(r.text), promo_type: 'group', promo_id: gb.id, group_id: gid, address_id: addr }); const oid = r.loc.match(/order\/(\d+)/)[1];
  r = await a.post('/order/' + oid + '/pay', { method: 'wechat' });
  ok(db.get("SELECT status FROM groups WHERE id=?", gid).status === 'success', '满员后成团');
  const ords = db.all("SELECT id,status FROM orders WHERE group_id=?", gid); ok(ords.length === 2, '团内两张订单');
  r = await adm.get('/admin/login'); await adm.post('/admin/login', { username: 'admin', password: 'admin123' }); await adm.get('/admin');
  r = await adm.post('/admin/orders/' + oid + '/ship', { company: '中通快递', tracking_no: 'ZT0000000001' }); ok(db.get('SELECT status FROM orders WHERE id=?', oid).status === 'shipped', '成团后可发货');
  // 失败团:创建一个新团后强制过期
  r = await b.post('/checkout', { sku_id: gb.sku_id, qty: 1, promo_type: 'group', promo_id: gb.id }); r = await b.post('/order/create', { items: itemsRaw(r.text), promo_type: 'group', promo_id: gb.id, address_id: (r.text.match(/name="address_id" value="(\d+)"/) || [])[1] || db.get('SELECT id FROM addresses WHERE user_id=3').id });
  const goid = r.loc.match(/order\/(\d+)/)[1]; await b.post('/order/' + goid + '/pay', { method: 'balance' });
  let bal = db.get('SELECT balance FROM users WHERE id=3').balance;
  const g2 = db.get('SELECT * FROM orders WHERE id=?', goid); ok(g2.status === 'paid' || g2.status === 'unpaid', '开团订单创建(余额不足则未支付)');
  if (g2.status === 'unpaid') { await b.post('/order/' + goid + '/pay', { method: 'wechat' }); }
  const gg = db.get('SELECT group_id FROM orders WHERE id=?', goid).group_id; db.prepare("UPDATE groups SET expire_at='2000-01-01 00:00:00' WHERE id=?").run(gg);
  require('../lib/svc').expireGroups();
  ok(db.get('SELECT status FROM groups WHERE id=?', gg).status === 'failed' && db.get('SELECT status FROM orders WHERE id=?', goid).status === 'refunded', '超时未成团自动失败并退款');
  console.log('== 秒杀 ==');
  const sk = db.get('SELECT * FROM seckills WHERE id=2');
  r = await a.post('/checkout', { sku_id: sk.sku_id, qty: 3, promo_type: 'seckill', promo_id: sk.id }); ok(r.status === 302 && r.loc, '超过限购被拒(限2)');
  r = await a.post('/checkout', { sku_id: sk.sku_id, qty: 1, promo_type: 'seckill', promo_id: sk.id }); ok(r.text.includes('确认订单') && r.text.includes('19.9'), '秒杀价结算');
  const before = db.get('SELECT sold FROM seckills WHERE id=2').sold;
  r = await a.post('/order/create', { items: itemsRaw(r.text), promo_type: 'seckill', promo_id: sk.id, address_id: addr }); const soid = r.loc.match(/order\/(\d+)/)[1];
  ok(db.get('SELECT sold FROM seckills WHERE id=2').sold === before + 1, '秒杀已售数+1'); await a.post('/order/' + soid + '/cancel');
  ok(db.get('SELECT sold FROM seckills WHERE id=2').sold === before, '取消订单后秒杀库存回滚');
  console.log('== 优惠券/积分/运费 ==');
  const sku4 = db.get('SELECT * FROM skus WHERE product_id=4 LIMIT 1');
  r = await a.post('/checkout', { sku_id: sku4.id, qty: 1 });
  const cp = (r.text.match(/<option value="(\d+)">减¥10 · 满99减10/) || [])[1]; ok(!!cp, '结算页可选满99减10券');
  const its = itemsRaw(r.text); const qres = await a.post('/api/quote', { items: its, address_id: addr, coupon_id: cp, use_points: '300' }, { json: true }); const q = JSON.parse(qres.text);
  ok(q.ok && q.couponDiscount === 10 && q.pointsDiscount === 3, '优惠券+积分抵扣试算', qres.text);
  const pts0 = db.get('SELECT points FROM users WHERE id=2').points;
  r = await a.post('/order/create', { items: its, address_id: addr, coupon_id: cp, use_points: '300' }); const coid = r.loc.match(/order\/(\d+)/)[1];
  ok(db.get('SELECT points FROM users WHERE id=2').points === pts0 - 300, '积分已扣'); ok(db.get('SELECT status FROM user_coupons WHERE id=?', cp).status === 'used', '优惠券已使用');
  await a.post('/order/' + coid + '/cancel'); ok(db.get('SELECT points FROM users WHERE id=2').points === pts0 && db.get('SELECT status FROM user_coupons WHERE id=?', cp).status === 'unused', '取消后积分与优惠券返还');
  const tpl = require('../lib/svc'); ok(tpl.calcFreight([{ template_id: 1, amount: 50 }], '广东省') === 8 && tpl.calcFreight([{ template_id: 1, amount: 120 }], '广东省') === 0 && tpl.calcFreight([{ template_id: 1, amount: 50 }], '新疆维吾尔自治区') === 18, '运费模板计算(基础/包邮/偏远)');
  console.log('== 退货退款 ==');
  const u = new C(); await u.login('13800000001', '123456');
  const co = db.get("SELECT * FROM orders WHERE user_id=1 AND status='completed' AND id NOT IN (SELECT order_id FROM aftersales) ORDER BY id DESC");
  await u.get('/order/' + co.id + '/aftersale'); r = await u.post('/order/' + co.id + '/aftersale', { type: 'refund_return', reason: '质量问题', description: 'x' }); const asid = r.loc.match(/aftersale\/(\d+)/)[1];
  r = await adm.post('/admin/aftersales/' + asid + '/handle', { action: 'approve', admin_note: '请寄回' }); ok(db.get('SELECT status FROM aftersales WHERE id=?', asid).status === 'approved_return', '后台同意退货');
  r = await u.post('/aftersale/' + asid + '/return', { company: '顺丰速运', tracking: 'SF999888777' }); ok(db.get('SELECT status FROM aftersales WHERE id=?', asid).status === 'returned', '买家填写退货物流');
  const b0 = db.get('SELECT balance FROM users WHERE id=1').balance; const p0 = db.get('SELECT points FROM users WHERE id=1').points;
  r = await adm.post('/admin/aftersales/' + asid + '/handle', { action: 'receive' }); ok(db.get('SELECT status FROM orders WHERE id=?', co.id).status === 'refunded' && db.get('SELECT balance FROM users WHERE id=1').balance > b0, '确认收货→订单退款→退回余额');
  ok(db.get('SELECT points FROM users WHERE id=1').points < p0, '已完成订单退款扣回积分');
  console.log('== 评价图片上传 ==');
  const rc = db.get("SELECT o.id, oi.id iid FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.user_id=1 AND o.status='completed' AND oi.reviewed=0 LIMIT 1");
  if (rc) { const fd = new FormData(); fd.append('rating_' + rc.iid, '4'); fd.append('content_' + rc.iid, '带图评价测试'); fd.append('images_' + rc.iid, new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'a.png'); fd.append('images_' + rc.iid, new Blob(['<?php echo 1;'], { type: 'application/x-php' }), 'evil.php');
    r = await u.req('POST', '/order/' + rc.id + '/review', fd, { form: true }); const rv = db.get('SELECT * FROM reviews WHERE content=?', '带图评价测试'); ok(rv && JSON.parse(rv.images).length === 1 && /\.png$/.test(JSON.parse(rv.images)[0]), '评价上传仅保留合法图片', rv && rv.images); } else ok(true, '(无可评价订单,跳过)');
  r = await u.req('POST', '/me/profile', (() => { const f = new FormData(); f.append('x', '1'); return f; })(), { form: true }); ok(r.status === 302 || r.status === 200, 'multipart 表单带 CSRF');
  const anon = await fetch(base + '/order/1/review', { method: 'POST', body: (() => { const f = new FormData(); f.append('images_1', new Blob(['x'], { type: 'image/png' }), 'a.png'); return f; })() }); ok(anon.status === 403, '未登录不能上传文件');
  console.log('== 后台商品图片上传 ==');
  const fd2 = new FormData(); const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  Object.entries({ name: '上传图测试商品', category_id: '3', brand_id: '1', template_id: '1', status: '1', spec_names: '规格', market_price: '10', description: 'd' }).forEach(([k, v]) => fd2.append(k, v)); fd2.append('sku_spec', '默认'); fd2.append('sku_price', '9.9'); fd2.append('sku_stock', '5'); fd2.append('sku_code', ''); fd2.append('sku_id', ''); fd2.append('image_files', new Blob([png], { type: 'image/png' }), 'p.png');
  await adm.get('/admin/products/new'); r = await adm.req('POST', '/admin/products/save', fd2, { form: true }); const np = db.get("SELECT * FROM products WHERE name='上传图测试商品'"); ok(np && /\/uploads\//.test(np.images), '后台商品图片上传', r.status);
  if (np) { const up = JSON.parse(np.images)[0]; const g = await fetch(base + up); ok(g.status === 200 && g.headers.get('content-type').includes('image'), '上传图片可访问'); await adm.post('/admin/products/' + np.id + '/delete'); }

  console.log('== 云商卡兑换审核通过 ==');
  const cg = new C(); await cg.login('13800000001', '123456');
  const ptsBefore = db.get('SELECT points FROM users WHERE phone=?', '13800000001').points;
  await cg.get('/me/cloud');
  r = await cg.post('/me/cloud/redeem', { points: '150', note: 'flows兑换' });
  const pending = db.get("SELECT * FROM cloud_redeem_requests WHERE user_id=1 AND status='pending' ORDER BY id DESC LIMIT 1");
  ok(!!pending && pending.points === 150, '兑换申请入库');
  ok(db.get('SELECT points FROM users WHERE id=1').points === ptsBefore, '申请阶段未扣积分');
  r = await adm.post('/admin/cloud-redeems/' + pending.id + '/handle', { action: 'approve', admin_note: 'flows通过', back: 'pending' });
  ok(db.get('SELECT status FROM cloud_redeem_requests WHERE id=?', pending.id).status === 'approved', '后台通过兑换');
  ok(db.get('SELECT points FROM users WHERE id=1').points === ptsBefore - 150, '通过后扣减积分');
  const expired = require('../lib/cloud').dailyReturn(3, require('../lib/svc').addPoints);
  ok(!expired.ok, '过期/未生效卡不可领取每日返积分', expired.msg);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
