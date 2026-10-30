// 云商卡按档位折扣:白银9.5/黄金8.5/钻石7.5折,开关、取更优、活动价/积分兑换/优惠卡不参与、校验、迁移
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
const { CLOUD_TIER_HELP_EDIT } = require('../lib/seed-texts');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const S = k => (db.get('SELECT value FROM settings WHERE key=?', k) || {}).value;
  const user = ph => db.get('SELECT * FROM users WHERE phone=?', ph);
  console.log('== 迁移:旧库 cloud_discount=98、无钻石卡 → 三档配置 + 钻石卡类型 ==');
  {
    db.exec("DELETE FROM settings WHERE key LIKE 'cloud_on_%' OR key LIKE 'cloud_discount%' OR key='migr_cloud_tier_discount_20261029'");
    db.exec1("INSERT INTO settings(key,value) VALUES('cloud_discount','98')");
    db.exec("DELETE FROM cloud_card_types WHERE tier='diamond'");
    db.exec1("UPDATE articles SET content=REPLACE(content,?,?) WHERE title='云商卡会员权益说明'", CLOUD_TIER_HELP_EDIT[1], CLOUD_TIER_HELP_EDIT[0]);
    const cp = require('child_process').spawn(process.execPath, ['server.js'], { cwd: require('path').join(__dirname, '..'), env: { ...process.env, PORT: '3978' }, stdio: 'ignore' });
    for (let i = 0; i < 40 && !S('migr_cloud_tier_discount_20261029'); i++) await sleep(250);
    await sleep(500); cp.kill();
    ok(S('cloud_discount') == null, '迁移删除旧 cloud_discount');
    ok(S('cloud_on_silver') === '1' && S('cloud_discount_silver') === '9.5' && S('cloud_discount_gold') === '8.5' && S('cloud_discount_diamond') === '7.5' && S('cloud_on_diamond') === '1', '迁移写入三档默认值');
    const dt = db.all("SELECT name, duration, remark, status FROM cloud_card_types WHERE tier='diamond' ORDER BY sort");
    ok(dt.map(x => x.name).join() === '钻石月卡,钻石季卡,钻石年卡' && dt.every(x => x.remark === '线下办理' && x.status === 1), '迁移补钻石月/季/年卡(线下办理)', JSON.stringify(dt));
    ok(db.get("SELECT content FROM articles WHERE title='云商卡会员权益说明'").content.includes('积分兑换商品及优惠卡除外'), '迁移更新权益说明文章');
  }
  const adm = new C(); await adm.admin();
  const base = { cloud_on_silver: '1', cloud_discount_silver: '9.5', cloud_on_gold: '1', cloud_discount_gold: '8.5', cloud_on_diamond: '1', cloud_discount_diamond: '7.5', cloud_free_shipping: '1' };
  console.log('== 后台配置与校验 ==');
  let r = await adm.get('/admin/cloud-settings');
  ok(['silver', 'gold', 'diamond'].every(t => r.text.includes(`name="cloud_on_${t}"`) && r.text.includes(`name="cloud_discount_${t}"`)) && !r.text.includes('name="cloud_discount"'), '配置页每档有开关+折扣,无旧单一折扣');
  for (const bad of ['7.4', '9.6', '10', '', 'abc', '8.555']) { await adm.post('/admin/cloud-settings', { ...base, cloud_discount_gold: bad }); ok(S('cloud_discount_gold') === '8.5', `折扣 ${bad || '空'} 被拒`); }
  await adm.post('/admin/cloud-settings', { ...base, cloud_discount_gold: '7.5' }); ok(S('cloud_discount_gold') === '7.5', '边界 7.5 可保存');
  await adm.post('/admin/cloud-settings', { ...base, cloud_discount_gold: '9.5' }); ok(S('cloud_discount_gold') === '9.5', '边界 9.5 可保存');
  await adm.post('/admin/cloud-settings', base);
  r = await adm.get('/admin/cloud-cards'); ok(r.text.includes('钻石月卡') && r.text.includes('钻石年卡'), '卡类型列表含钻石卡');
  console.log('== 各档价格 ==');
  const ph = '13800000003', uid = user(ph).id;
  db.exec1('UPDATE users SET level_id=1 WHERE id=?', uid);
  const prod = db.get("SELECT p.id, s.id sku, s.price FROM products p JOIN skus s ON s.product_id=p.id WHERE p.status=1 AND (p.supplier IS NULL OR p.supplier='') AND p.id NOT IN (SELECT product_id FROM seckills) AND p.id NOT IN (SELECT product_id FROM groupbuys) ORDER BY s.price DESC LIMIT 1");
  const m = new C(); await m.login(ph, '123456');
  const quote = async (extra) => JSON.parse((await m.post('/api/quote', { items: JSON.stringify([{ sku_id: prod.sku, qty: 2 }]), ...(extra || {}) })).text);
  const give = async tier => { const ct = db.get("SELECT id FROM cloud_card_types WHERE tier=? AND duration='month'", tier).id; db.exec1('UPDATE users SET cloud_tier=NULL, cloud_end=NULL, cloud_start=NULL WHERE id=?', uid); const x = await adm.post(`/admin/members/${uid}/cloud`, { action: 'grant', card_type_id: ct, amount: '0', sale_date: U.today(), staff: '折扣验证', receipt_note: 'test' }); return x; };
  const money = v => (Math.round(v * 100) / 100).toFixed(2);
  // 游客/非会员:小字区间
  { const g = new C(); const t = (await g.get('/product/' + prod.id)).text; ok(t.includes('云商卡会员享7.5～9.5折') && !t.includes('云商会员价'), '游客看到区间小字,无会员价'); }
  { const t = (await m.get('/product/' + prod.id)).text; ok(t.includes('云商卡会员享7.5～9.5折') && !t.includes('云商会员价'), '未开卡会员看到区间小字'); const q = await quote(); ok(q.levelDiscount === 0, '未开卡无折扣'); }
  for (const [tier, zhe] of [['silver', 9.5], ['gold', 8.5], ['diamond', 7.5]]) {
    await give(tier); ok(user(ph).cloud_tier === tier, `后台开通${tier}卡`);
    const t = (await m.get('/product/' + prod.id)).text;
    ok(t.includes(`云商会员价 ${zhe}折 <b>¥<span id="cloudPrice" data-rate="${zhe * 10}">${money(prod.price * zhe / 10)}</span>`) && !t.includes('云商卡会员享7.5'), `${tier} 商品页显示 云商会员价 ${zhe}折 ¥${money(prod.price * zhe / 10)}`);
    const q = await quote(), goods = money(prod.price * 2);
    ok(money(q.levelDiscount) === money(goods - Math.round(goods * zhe * 10) / 100) || money(q.levelDiscount) === money(goods * (100 - zhe * 10) / 100), `${tier} 结算折扣额正确`, JSON.stringify(q));
    const ck = (await m.post('/checkout', { sku_id: prod.sku, qty: '2', no7_ok: '1' })).text;
    ok(ck.includes(`云商会员价 ${zhe}折`) && ck.includes(money(q.goods - q.levelDiscount)) && ck.includes('-¥' + money(q.levelDiscount)), `${tier} 结算页显示 云商会员价 ${zhe}折 及优惠额`);
    const mc = (await m.get('/me/cloud')).text;
    ok(mc.includes('云商卡会员购物享 7.5～9.5 折：白银 9.5 折、黄金 8.5 折、钻石 7.5 折') && mc.includes('积分兑换商品及优惠卡除外'), `${tier} /me/cloud 权益说明`);
  }
  console.log('== 档位关闭 ==');
  await adm.post('/admin/cloud-settings', { ...base, cloud_on_diamond: '' });
  { const q = await quote(); ok(q.levelDiscount === 0, '钻石档关闭 → 钻石卡会员无卡折扣'); const t = (await m.get('/product/' + prod.id)).text; ok(!t.includes('云商会员价'), '关闭后商品页不显示会员价'); }
  { const mc = (await m.get('/me/cloud')).text; ok(mc.includes('云商卡会员购物享 8.5～9.5 折：白银 9.5 折、黄金 8.5 折，') && !mc.includes('钻石 7.5 折'), '关闭钻石后说明去掉钻石、区间重算'); const g = new C(); ok((await g.get('/product/' + prod.id)).text.includes('云商卡会员享8.5～9.5折'), '游客区间重算'); }
  await adm.post('/admin/cloud-settings', { ...base, cloud_on_diamond: '', cloud_on_gold: '', cloud_on_silver: '' });
  { const mc = (await m.get('/me/cloud')).text; ok(!mc.includes('云商卡会员购物享') && !mc.includes('会员折扣</b>'), '全部关闭隐藏折扣说明'); const g = new C(); ok(!(await g.get('/product/' + prod.id)).text.includes('云商卡会员享'), '全部关闭游客无区间小字'); }
  await adm.post('/admin/cloud-settings', base);
  console.log('== 与会员等级折扣取更优,不叠加 ==');
  const lv90 = db.get('SELECT id FROM member_levels WHERE discount=90').id;
  db.exec1('UPDATE users SET level_id=? WHERE id=?', lv90, uid);
  await give('silver');
  { const q = await quote(), goods = prod.price * 2; ok(money(q.levelDiscount) === money(goods * 0.1), '白银9.5 vs 等级9折 → 取9折(不叠加)', JSON.stringify(q)); const t = (await m.get('/product/' + prod.id)).text; ok(!t.includes('云商会员价') && t.includes('专享 9 折'), '等级更优时商品页显示等级折扣'); }
  await give('diamond');
  { const q = await quote(), goods = prod.price * 2; ok(money(q.levelDiscount) === money(goods * 0.25), '钻石7.5 vs 等级9折 → 取7.5折(不叠加)'); }
  db.exec1('UPDATE users SET level_id=1 WHERE id=?', uid);
  console.log('== 活动价/拼团/积分兑换/优惠卡不参与 ==');
  { const gb = db.get('SELECT * FROM groupbuys LIMIT 1'); const q = JSON.parse((await m.post('/api/quote', { items: JSON.stringify([{ sku_id: gb.sku_id, qty: 1 }]), promo_type: 'group', promo_id: gb.id })).text); ok(q.ok && q.levelDiscount === 0 && q.goods === gb.price, '拼团价不再打会员折扣', JSON.stringify(q)); }
  { const sk = db.get('SELECT * FROM seckills LIMIT 1'); if (sk) { db.exec1('UPDATE seckills SET start_at=?, end_at=? WHERE id=?', U.offset(-3600000), U.offset(3600000), sk.id); const q = JSON.parse((await m.post('/api/quote', { items: JSON.stringify([{ sku_id: sk.sku_id, qty: 1 }]), promo_type: 'seckill', promo_id: sk.id })).text); ok(q.ok && q.levelDiscount === 0, '活动价(秒杀)不打会员折扣', JSON.stringify(q)); const t = (await m.get('/product/' + sk.product_id)).text; ok(!t.includes('云商会员价'), '活动商品页不显示会员价'); } }
  { const pg = db.get('SELECT * FROM points_goods WHERE status=1 AND stock>0 AND type=? ORDER BY points LIMIT 1', 'goods');
    const t = (await m.get('/points-mall/' + pg.id)).text; ok(!t.includes('云商会员价') && !t.includes('云商卡会员享'), '积分兑换商品页无会员价');
    db.exec1('UPDATE users SET points=999999 WHERE id=?', uid);
    if (!db.get('SELECT 1 FROM addresses WHERE user_id=?', uid)) db.exec1("INSERT INTO addresses(user_id,name,phone,province,city,district,detail,is_default) VALUES(?,'测','13812345678','海南省','海口市','龙华区','测试路1号',1)", uid);
    const ex = await m.post('/points-mall/' + pg.id + '/exchange', {});
    const o = db.get("SELECT * FROM orders WHERE user_id=? AND type='points' ORDER BY id DESC LIMIT 1", uid);
    ok(o && !o.level_discount && Math.abs(o.pay_amount - o.goods_amount) < 1e-9, '积分兑换订单无会员折扣', JSON.stringify(o && { ld: o.level_discount, g: o.goods_amount, p: o.pay_amount })); }
  { const t = (await m.get('/storecard')).text; ok(!t.includes('云商会员价') && !t.includes('云商卡会员享'), '线下门店优惠卡页不显示会员价'); }
  console.log('== 三档都享签到会员档 ==');
  { const svc = require('../lib/svc'); for (const t of ['silver', 'gold', 'diamond']) ok(require('../lib/cloud').isCardActive({ ...user(ph), cloud_tier: t }) && svc.signinPoints(1, true) === 37, `${t} 签到首日 37`); }
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
