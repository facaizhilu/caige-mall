// 拼团/结算 QA:无「还差N人」、规则固定3小时且后台限10~180分钟、活动价结算不显示-¥0.00、订单折扣名称
const base = process.argv[2] || 'http://localhost:' + (process.env.PORT || 3000);
const db = require('../lib/db');
let pass = 0, fail = 0;
const ok = (c, n, x) => { c ? (pass++, console.log('  ✔', n)) : (fail++, console.log('  ✘', n, x || '')); };
class C { constructor() { this.k = {}; this.t = ''; }
  async req(m, p, body) { const h = { Cookie: Object.entries(this.k).map(([a, b]) => a + '=' + b).join('; ') }; let b; if (body) { b = new URLSearchParams({ _csrf: this.t, ...body }).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
    const r = await fetch(base + p, { method: m, headers: h, body: b, redirect: 'manual' }); for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.k[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await r.text(); const mm = text.match(/name="csrf" content="([0-9a-f]+)"/) || text.match(/name="_csrf" value="([0-9a-f]+)"/); if (mm) this.t = mm[1]; return { status: r.status, loc: r.headers.get('location'), text }; }
  get(p) { return this.req('GET', p); } post(p, b) { return this.req('POST', p, b || {}); }
  async login(phone, pw) { await this.get('/login'); await this.post('/login', { phone, password: pw }); const c = await this.get('/consent'); if (c.status === 200) await this.post('/consent', { agree: '1', next: '/' }); await this.get('/'); }
  async admin() { await this.get('/admin/login'); await this.post('/admin/login', { username: 'admin', password: 'admin123' }); await this.get('/admin/password'); await this.post('/admin/password/skip', {}); }
}
const U = require('../lib/util');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const itemsRaw = t => t.match(/name="items" value='([^']+)'/)[1].replace(/&#34;/g, '"');
(async () => {
  const S = k => (db.get('SELECT value FROM settings WHERE key=?', k) || {}).value;
  const user = ph => db.get('SELECT * FROM users WHERE phone=?', ph);
  console.log('== 迁移:最迟成团分钟 >180 夹到 180;旧物流文案 ==');
  {
    db.exec("DELETE FROM settings WHERE key='migr_group_qa_fix_20261029'"); db.exec1("UPDATE settings SET value='600' WHERE key='group_auto_max_minutes'");
    const o = 999999; db.exec1("INSERT INTO traces(order_id,time,text) VALUES(?,?,'拼团中,还差2人,邀请好友一起拼')", o, U.now());
    const cp = require('child_process').spawn(process.execPath, ['server.js'], { cwd: require('path').join(__dirname, '..'), env: { ...process.env, PORT: '3979' }, stdio: 'ignore' });
    for (let i = 0; i < 40 && !S('migr_group_qa_fix_20261029'); i++) await sleep(250); await sleep(300); cp.kill();
    ok(S('group_auto_max_minutes') === '180', '迁移:600 → 180', S('group_auto_max_minutes'));
    ok(!db.get("SELECT 1 FROM traces WHERE text LIKE '%还差%'"), '迁移:物流里不再有「还差N人」');
  }
  const adm = new C(); await adm.admin();
  console.log('== 后台 拼团最迟自动成团(分钟) 10~180 ==');
  const keep = {}; for (const r0 of db.all('SELECT key, value FROM settings')) keep[r0.key] = r0.value;
  const base0 = {}; for (const k of ['shop_name', 'company_name', 'slogan', 'announcement', 'service_phone', 'service_wechat', 'ship_from', 'service_quick_questions', 'service_recall_minutes', 'service_hours', 'service_email', 'address', 'icp', 'stock_warn', 'unpaid_cancel_minutes', 'auto_confirm_days', 'aftersale_days', 'register_points', 'review_points', 'hot_sales_threshold', 'new_days', 'show_sales', 'signin_base', 'signin_step', 'signin_max', 'cloud_signin_base', 'cloud_signin_step', 'cloud_signin_max']) base0[k] = keep[k] == null ? '' : keep[k];
  let r = await adm.get('/admin/settings'); ok(/min="10" max="180" name="group_auto_max_minutes"/.test(r.text), '输入框限制 10~180');
  for (const bad of ['181', '1440', '9', 'x']) { await adm.post('/admin/settings', { ...base0, group_auto_max_minutes: bad }); ok(S('group_auto_max_minutes') === '180', `${bad} 被拒`); }
  await adm.post('/admin/settings', { ...base0, group_auto_max_minutes: '10' }); ok(S('group_auto_max_minutes') === '10', '10 可保存');
  { const g = new C(); const t = (await g.get('/groupbuy')).text; ok(t.includes('开团后最迟3小时内成团') && !t.includes('最迟1小时'), '设为 10 分钟后规则仍固定「最迟3小时」'); }
  ok(require('../lib/svc').groupAutoMaxMinutes() === 10, '内部上限读取 10 分钟');
  await adm.post('/admin/settings', { ...base0, group_auto_max_minutes: '180' }); ok(S('group_auto_max_minutes') === '180', '恢复默认 180');
  console.log('== 结算页:不参与折扣时的展示 ==');
  const ph = '13900000004', uid = user(ph).id; db.exec1('UPDATE users SET level_id=1 WHERE id=?', uid);
  if (!db.get('SELECT 1 FROM addresses WHERE user_id=?', uid)) db.exec1("INSERT INTO addresses(user_id,name,phone,province,city,district,detail,is_default) VALUES(?,'测','13812345678','海南省','海口市','龙华区','测试路1号',1)", uid);
  const m = new C(); await m.login(ph, '123456');
  const gb = db.get('SELECT * FROM groupbuys LIMIT 1');
  if (!db.get('SELECT 1 FROM seckills')) { const x = db.get("SELECT p.id, s.id sku, s.price FROM products p JOIN skus s ON s.product_id=p.id WHERE p.status=1 AND (p.supplier IS NULL OR p.supplier='') AND p.id NOT IN (SELECT product_id FROM groupbuys) ORDER BY s.price LIMIT 1"); db.exec1('INSERT INTO seckills(product_id,sku_id,price,stock,start_at,end_at,limit_per_user,status) VALUES(?,?,?,?,?,?,5,1)', x.id, x.sku, Math.max(1, Math.floor(x.price / 2)), 50, U.offset(-3600000), U.offset(3600000)); }
  const sk = db.get('SELECT * FROM seckills LIMIT 1'); db.exec1('UPDATE seckills SET start_at=?, end_at=? WHERE id=?', U.offset(-3600000), U.offset(3600000), sk.id);
  const ckG = async () => (await m.post('/checkout', { sku_id: gb.sku_id, qty: '1', promo_type: 'group', promo_id: gb.id, no7_ok: '1' })).text;
  const ckS = async () => (await m.post('/checkout', { sku_id: sk.sku_id, qty: '1', promo_type: 'seckill', promo_id: sk.id, no7_ok: '1' })).text;
  for (const [n, f] of [['拼团', ckG], ['秒杀', ckS]]) { const t = await f(); ok(t.includes('rGoods') && !/id="rLevel"[^>]*>-/.test(t) && !t.includes('云商会员价') && !t.includes('本商品不参与云商卡折扣'), `未开卡 ${n} 结算页隐藏折扣行`); }
  const ct = db.get("SELECT id FROM cloud_card_types WHERE tier='diamond' AND duration='month'").id;
  await adm.post(`/admin/members/${uid}/cloud`, { action: 'grant', card_type_id: ct, amount: '0', sale_date: U.today(), staff: '折扣验证', receipt_note: 'test' });
  for (const [n, f] of [['拼团', ckG], ['秒杀', ckS]]) { const t = await f(); ok(t.includes('本商品不参与云商卡折扣') && !t.includes('云商会员价') && !/id="rLevel"[^>]*>-/.test(t), `钻石卡 ${n} 结算页显示「本商品不参与云商卡折扣」,无 -¥0.00`); }
  console.log('== 订单详情折扣名称 ==');
  const prod = db.get("SELECT p.id, s.id sku, s.price FROM products p JOIN skus s ON s.product_id=p.id WHERE p.status=1 AND (p.supplier IS NULL OR p.supplier='') AND p.id NOT IN (SELECT product_id FROM seckills) AND p.id NOT IN (SELECT product_id FROM groupbuys) ORDER BY s.price DESC LIMIT 1");
  const mk = async cli => { const c = await cli.post('/checkout', { sku_id: prod.sku, qty: '1', no7_ok: '1' }); const x = await cli.post('/order/create', { items: itemsRaw(c.text), address_id: (c.text.match(/name="address_id" value="(\d+)"/) || [])[1], no7_confirm: '1' }); return x.loc.match(/order\/(\d+)/)[1]; };
  { const oid = await mk(m); await m.post('/order/' + oid + '/pay', { method: 'wechat' }); const t = (await m.get('/order/' + oid)).text; ok(t.includes('<dt>云商会员价 7.5折</dt>') && !t.includes('<dt>会员折扣</dt>'), '已付款订单显示「云商会员价 7.5折」'); const a = (await adm.get('/admin/orders/' + oid)).text; ok(a.includes('<dt>云商会员价 7.5折</dt>'), '后台订单详情同样显示'); }
  { const lv = db.get('SELECT id, name FROM member_levels WHERE discount=90'); const ph2 = '13700000005', u2 = user(ph2).id; db.exec1('UPDATE users SET level_id=? WHERE id=?', lv.id, u2);
    if (!db.get('SELECT 1 FROM addresses WHERE user_id=?', u2)) db.exec1("INSERT INTO addresses(user_id,name,phone,province,city,district,detail,is_default) VALUES(?,'测','13812345678','海南省','海口市','龙华区','测试路1号',1)", u2);
    const c2 = new C(); await c2.login(ph2, '123456'); const oid = await mk(c2); const t = (await c2.get('/order/' + oid)).text; ok(t.includes(`<dt>${lv.name}折扣</dt>`) && !t.includes('云商会员价'), `会员等级折扣订单显示「${lv.name}折扣」`); }
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
