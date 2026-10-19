// 进阶流程测试:拼团成团/失败、秒杀下单、优惠券+积分抵扣、客服创建售后+积分/现金按比例退款、前台禁止上传
const base = process.argv[2] || 'http://localhost:' + (process.env.PORT || 3000);
const db = require('../lib/db');
let pass = 0, fail = 0;
const ok = (c, n, x) => { c ? (pass++, console.log('  ✔', n)) : (fail++, console.log('  ✘', n, x || '')); };
class C { constructor(b) { this.k = {}; this.t = ''; this.b = b || base; }
  async req(m, p, body, o = {}) { const h = { Cookie: Object.entries(this.k).map(([a, b]) => a + '=' + b).join('; ') }; let b; if (body && !o.form) { b = new URLSearchParams({ _csrf: this.t, ...body }).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; } if (o.form) { body.append('_csrf', this.t); b = body; } if (o.json) h.Accept = 'application/json'; if (o.h) Object.assign(h, o.h);
    const r = await fetch(this.b + p, { method: m, headers: h, body: b, redirect: 'manual' }); for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.k[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await r.text(); const mm = text.match(/name="csrf" content="([0-9a-f]+)"/) || text.match(/name="_csrf" value="([0-9a-f]+)"/); if (mm) this.t = mm[1]; return { status: r.status, loc: r.headers.get('location'), text }; }
  get(p) { return this.req('GET', p); } post(p, b, o) { return this.req('POST', p, b || {}, o); }
  async login(phone, pw) { await this.get('/login'); const r = await this.post('/login', { phone, password: pw }); const c = await this.get('/consent'); if (c.status === 200) await this.post('/consent', { agree: '1', next: '/' }); await this.get('/'); return r; } }
(async () => {
  const items = t => JSON.parse(t.match(/name="items" value='([^']+)'/)[1].replace(/&#34;/g, '"'));
  const itemsRaw = t => t.match(/name="items" value='([^']+)'/)[1].replace(/&#34;/g, '"');
  const a = new C(), b = new C(), adm = new C();
  // 演示环境启动后会异步导入 mock 供应商商品:等它完成,避免与「商品数量」类断言竞争
  for (let t = Date.now(); Date.now() - t < 30000 && !/^done|^$/.test((db.get("SELECT value FROM settings WHERE key='jdvop_demo_seed'") || { value: process.env.DEMO_MODE === '1' ? 'pending' : '' }).value);) await new Promise(r => setTimeout(r, 100));
  await a.login('13800000002', '123456'); await b.login('13800000003', '123456'); // 小美 / 老王
  console.log('== 拼团 ==');
  console.log('== 演示数据经营范围(2026-10-19 实际登记:仅数码、食用农产品上架) ==');
  { let x; const CC = require('../lib/suppliers/jdvop/compliance');
    const own = db.all('SELECT p.id, p.name, c.name cn, pc.name pn, c.no_7day FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN categories pc ON pc.id=c.parent_id WHERE p.supplier IS NULL AND p.status=1');
    const bad = own.filter(p => CC.scopeWarning([p.pn, p.cn])); ok(own.length >= 10 && !bad.length, '上架的演示自营商品均在经营范围内(数码/新鲜农产品)', bad.map(p => p.name).join('|'));
    ok(own.filter(p => p.pn === '新鲜农产品').every(p => p.no_7day === 1) && own.some(p => p.cn === '新鲜水果') && own.some(p => p.cn === '新鲜蔬菜') && own.some(p => p.cn === '鲜蛋'), '新鲜水果/蔬菜/鲜蛋演示商品,分类标记不支持7天无理由');
    const navs = db.all('SELECT c.name, pc.name pn FROM categories c LEFT JOIN categories pc ON pc.id=c.parent_id WHERE c.status=1'); ok(navs.every(c => !CC.scopeWarning([c.pn, c.name].filter(Boolean)) || !c.pn && ['数码电脑', '新鲜农产品'].includes(c.name)), '前台分类只含经营范围内类目', navs.map(c => c.name).join(','));
    x = await a.get('/products'); ok(!/服饰鞋包|美妆个护|家居日用|运动户外|零食坚果|食品生鲜/.test(x.text) && x.text.includes('新鲜农产品'), '「全部商品」分类标签无范围外类目');
    x = await a.get('/points-mall'); ok(!/帆布袋|保温杯/.test(x.text), '积分商城演示礼品无日用百货/箱包');
    x = await a.get('/'); ok(!/日用|百货|护肤|美妆|服饰|零食|坚果|茶叶/.test(x.text.replace(/<script[\s\S]*?<\/script>/g, '')), '首页(横幅/专区卡/精选)无范围外品类文案');
    x = await a.get('/activity'); ok(!/面霜|坚果|T恤|衬衫|连衣裙/.test(x.text), '活动专区演示内容仅范围内商品'); }
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
  r = await adm.get('/admin/login'); await adm.post('/admin/login', { username: 'admin', password: 'admin123' }); await adm.get('/admin/password'); await adm.post('/admin/password/skip'); await adm.get('/admin');
  r = await adm.post('/admin/orders/' + oid + '/ship', { company: '中通快递', tracking_no: 'ZT0000000001' }); ok(db.get('SELECT status FROM orders WHERE id=?', oid).status === 'shipped', '成团后可发货');
  // 失败团:创建一个新团后强制过期
  r = await b.post('/checkout', { sku_id: gb.sku_id, qty: 1, promo_type: 'group', promo_id: gb.id }); r = await b.post('/order/create', { items: itemsRaw(r.text), promo_type: 'group', promo_id: gb.id, address_id: (r.text.match(/name="address_id" value="(\d+)"/) || [])[1] || db.get('SELECT id FROM addresses WHERE user_id=3').id });
  const goid = r.loc.match(/order\/(\d+)/)[1]; await b.post('/order/' + goid + '/pay', { method: 'wechat' });
  const g2 = db.get('SELECT * FROM orders WHERE id=?', goid); ok(g2.status === 'paid' || g2.status === 'unpaid', '开团订单创建并支付');
  if (g2.status === 'unpaid') { await b.post('/order/' + goid + '/pay', { method: 'wechat' }); }
  const gg = db.get('SELECT group_id FROM orders WHERE id=?', goid).group_id; db.prepare("UPDATE groups SET expire_at='2000-01-01 00:00:00' WHERE id=?").run(gg);
  require('../lib/svc').expireGroups();
  ok(db.get('SELECT status FROM groups WHERE id=?', gg).status === 'failed' && db.get('SELECT status FROM orders WHERE id=?', goid).status === 'refunded', '超时未成团自动失败并退款');
  console.log('== 秒杀 ==');
  const sk = db.get('SELECT * FROM seckills WHERE id=2');
  r = await a.post('/checkout', { sku_id: sk.sku_id, qty: 3, promo_type: 'activity', promo_id: sk.id, no7_ok: '1' }); ok(r.status === 302 && r.loc, '超过限购被拒(限2)');
  r = await a.post('/checkout', { sku_id: sk.sku_id, qty: 1, promo_type: 'activity', promo_id: sk.id, no7_ok: '1' }); ok(r.text.includes('确认订单') && r.text.includes('19.9'), '秒杀价结算');
  const before = db.get('SELECT sold FROM seckills WHERE id=2').sold;
  r = await a.post('/order/create', { items: itemsRaw(r.text), promo_type: 'seckill', promo_id: sk.id, address_id: addr, no7_confirm: '1' }); const soid = r.loc.match(/order\/(\d+)/)[1];
  ok(db.get('SELECT sold FROM seckills WHERE id=2').sold === before + 1, '秒杀已售数+1'); await a.post('/order/' + soid + '/cancel');
  ok(db.get('SELECT sold FROM seckills WHERE id=2').sold === before, '取消订单后秒杀库存回滚');
  console.log('== 优惠券/积分/运费 ==');
  // 下单积分抵现默认关闭(店主要求前台不出现折现比例);此处临时开启以覆盖历史抵扣订单的退款/售后逻辑,末尾「积分专区」段关闭并断言
  const PTS_SET = { points_clear_day: '06-01', points_expiry_remind_days: '30', points_expiry_enable: '1', points_redeem_notice: '积分兑换商品非质量问题不退不换;如有质量问题或发错货,请联系客服换货或退回积分。', points_rate: '100', points_max_percent: '50' };
  await adm.post('/admin/settings/points', { ...PTS_SET, points_deduct_enable: '1' });
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
  console.log('== 客服创建售后:部分退款按比例退积分/现金 ==');
  const svcm = require('../lib/svc');
  // 小美:用 300 积分下单 → 付款 → 发货 → 确认收货(获得奖励积分/成长值)
  r = await a.post('/checkout', { sku_id: sku4.id, qty: 1 }); const its2 = itemsRaw(r.text);
  r = await a.post('/order/create', { items: its2, address_id: addr, use_points: '300' }); const poid = r.loc.match(/order\/(\d+)/)[1];
  await a.post('/order/' + poid + '/pay', { method: 'wechat' });
  await adm.post('/admin/orders/' + poid + '/ship', { company: '顺丰速运', tracking_no: 'SF100200300' });
  await a.get('/order/' + poid); await a.post('/order/' + poid + '/confirm');
  let po = db.get('SELECT * FROM orders WHERE id=?', poid); ok(po.status === 'completed' && po.points_used === 300 && po.points_awarded > 0, '积分抵扣订单已完成并获得奖励积分');
  await a.get('/order/' + poid); r = await a.post('/order/' + poid + '/aftersale'); ok(r.loc === '/service#end', '用户联系客服申请售后');
  ok(!!db.get("SELECT 1 FROM messages WHERE user_id=2 AND content LIKE ?", '我要申请售后:订单号 ' + po.order_no + '%'), '客服会话收到含订单号与商品的售后消息');
  r = await adm.get('/admin/service?uid=2'); ok(r.text.includes(po.order_no) && r.text.includes('签收 <b>0</b> 天') && r.text.includes('7天无理由退货(签收第 0 天)'), '后台会话显示近期订单、签收天数与7天无理由选项');
  const half = Math.round(po.pay_amount * 50) / 100;
  r = await adm.post('/admin/service/2/aftersale', { order_id: poid, type: 'quality', reason: '质量问题', amount: String(half), note: '部分退款' }); const pasid = (r.loc || '').split('/').pop(); ok(/^\d+$/.test(pasid), '客服创建「质量问题退换货」售后单');
  ok(db.get('SELECT created_by FROM aftersales WHERE id=?', pasid).created_by, '记录创建客服');
  r = await adm.get('/admin/aftersales/' + pasid); ok(r.text.includes('预计 退积分 150') && r.text.includes('原路退回'), '后台售后详情预计拆分(退积分/退现金)');
  await adm.post('/admin/aftersales/' + pasid + '/handle', { action: 'approve' }); ok(db.get('SELECT status FROM aftersales WHERE id=?', pasid).status === 'approved_return', '同意退货');
  ok(!!db.get("SELECT 1 FROM messages WHERE user_id=2 AND sender='staff' AND content LIKE '【售后通知】售后单 #" + pasid + "%同意退货%'"), '状态变更通过客服消息通知用户');
  await a.get('/aftersale/' + pasid); r = await a.post('/aftersale/' + pasid + '/return', { company: '顺丰速运', tracking: 'SF999888777' }); ok(db.get('SELECT status FROM aftersales WHERE id=?', pasid).status === 'returned', '买家填写退货物流');
  const p0 = db.get('SELECT points, growth FROM users WHERE id=2');
  r = await adm.post('/admin/aftersales/' + pasid + '/handle', { action: 'receive' });
  const pas = db.get('SELECT * FROM aftersales WHERE id=?', pasid); const p1 = db.get('SELECT points, growth FROM users WHERE id=2');
  const awardBack = Math.round(po.points_awarded * half / po.pay_amount), growthBack = Math.round(po.growth_awarded * half / po.pay_amount);
  ok(pas.status === 'refunded' && pas.refund_points === 150 && Math.abs(pas.refund_cash - half) < 0.001 && pas.refund_channel === '原路退回', '部分退款:退积分 150 / 退现金按金额,原路退回', JSON.stringify(pas));
  ok(p1.points === p0.points + 150 - awardBack, '积分:退回抵扣积分并按比例扣回奖励积分', `${p0.points}→${p1.points}`);
  ok(p1.growth === p0.growth - growthBack, '成长值按比例扣回');
  ok(!!db.get("SELECT 1 FROM points_log WHERE user_id=2 AND delta=150 AND reason LIKE '售后退回积分%'"), 'points_log 记录「售后退回积分」');
  ok(db.get('SELECT status FROM orders WHERE id=?', poid).status === 'completed', '部分退款后订单保持已完成');
  r = await a.get('/aftersale/' + pasid); ok(r.text.includes('退积分 150') && r.text.includes('退现金 ¥' + half.toFixed(2)), '用户售后页显示退积分/退现金拆分');
  r = await adm.post('/admin/service/2/aftersale', { order_id: poid, type: 'refund', reason: '再退', amount: String(po.pay_amount) }); ok((r.loc || '').includes('/admin/service'), '剩余可退金额校验(不可超额退款)');
  console.log('== 全额退款 / 七天无理由校验 ==');
  const u = new C(); await u.login('13800000001', '123456');
  const co = db.get("SELECT * FROM orders WHERE user_id=1 AND status='completed' AND id NOT IN (SELECT order_id FROM aftersales) ORDER BY id DESC");
  db.prepare("UPDATE orders SET completed_at='2000-01-01 00:00:00' WHERE id=?").run(co.id);
  r = await adm.post('/admin/service/1/aftersale', { order_id: co.id, type: 'no_reason', reason: '不喜欢' }); ok((r.loc || '').includes('/admin/service') && !db.get('SELECT 1 FROM aftersales WHERE order_id=?', co.id), '超过签收 7 天不能创建7天无理由退货');
  r = await adm.post('/admin/service/1/aftersale', { order_id: co.id, type: 'refund_return', reason: '质量问题' }); const asid = (r.loc || '').split('/').pop();
  await adm.post('/admin/aftersales/' + asid + '/handle', { action: 'approve', admin_note: '请寄回' });
  await u.get('/aftersale/' + asid); await u.post('/aftersale/' + asid + '/return', { company: '顺丰速运', tracking: 'SF999888778' });
  const up0 = db.get('SELECT points FROM users WHERE id=1').points;
  r = await adm.post('/admin/aftersales/' + asid + '/handle', { action: 'receive' });
  const fas = db.get('SELECT * FROM aftersales WHERE id=?', asid);
  ok(db.get('SELECT status FROM orders WHERE id=?', co.id).status === 'refunded' && fas.refund_cash === co.pay_amount && fas.refund_channel === '原路退回', '确认收货→全额退款,原路退回(不再退余额)');
  ok(db.get('SELECT points FROM users WHERE id=1').points < up0, '已完成订单退款扣回奖励积分');
  ok(!db.prepare('PRAGMA table_info(users)').all().some(c => ['balance', 'birthday'].includes(c.name)) && !db.get("SELECT 1 FROM sqlite_master WHERE name IN ('balance_log','recharges')"), '数据库已删除余额/生日字段及余额/充值表');
  ok(!db.prepare('PRAGMA table_info(reviews)').all().some(c => c.name === 'images') && !db.prepare('PRAGMA table_info(aftersales)').all().some(c => c.name === 'images'), '评价/售后图片字段已删除');
  // 鲜活易腐类商品订单不可走7天无理由,但可选质量问题
  const apple = db.get("SELECT o.* FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE oi.product_id=8 AND o.status='completed' LIMIT 1");
  if (apple) { r = await adm.post('/admin/service/' + apple.user_id + '/aftersale', { order_id: apple.id, type: 'no_reason', reason: 'x' }); ok((r.loc || '').includes('/admin/service'), '鲜活易腐类订单不能创建7天无理由退货'); }
  ok(!svcm.noReasonOf(8) && svcm.noReasonOf(9), '七天无理由:分类标记鲜活易腐类的商品默认不支持');
  console.log('== 前台禁止上传 ==');
  const rc = db.get("SELECT o.id, oi.id iid FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.user_id=1 AND o.status='completed' AND oi.reviewed=0 LIMIT 1");
  if (rc) { const fd = new FormData(); fd.append('rating_' + rc.iid, '4'); fd.append('content_' + rc.iid, '带图评价测试'); fd.append('images_' + rc.iid, new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')], { type: 'image/png' }), 'a.png');
    r = await u.req('POST', '/order/' + rc.id + '/review', fd, { form: true }); ok(r.status === 403 && !db.get('SELECT 1 FROM reviews WHERE content=?', '带图评价测试'), '前台不接受图片上传(multipart 被拒)', r.status);
    r = await u.post('/order/' + rc.id + '/review', { ['rating_' + rc.iid]: '4', ['content_' + rc.iid]: '纯文字评价测试' }); ok(!!db.get('SELECT 1 FROM reviews WHERE content=?', '纯文字评价测试'), '纯文字 + 星级评价'); } else ok(true, '(无可评价订单,跳过)');
  r = await u.get('/order/' + (rc ? rc.id : 1) + '/review'); ok(!r.text.includes('type="file"') && !r.text.includes('multipart'), '评价页无图片上传');
  const anon = await fetch(base + '/order/1/review', { method: 'POST', body: (() => { const f = new FormData(); f.append('images_1', new Blob(['x'], { type: 'image/png' }), 'a.png'); return f; })() }); ok(anon.status === 403, '未登录不能上传文件');
  console.log('== 后台商品图片上传 ==');
  const fd2 = new FormData(); const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  Object.entries({ name: '上传图测试商品', category_id: '3', brand_id: '1', template_id: '1', status: '1', spec_names: '规格', market_price: '10', description: 'd' }).forEach(([k, v]) => fd2.append(k, v)); fd2.append('sku_spec', '默认'); fd2.append('sku_price', '9.9'); fd2.append('sku_stock', '5'); fd2.append('sku_code', ''); fd2.append('sku_id', ''); fd2.append('image_files', new Blob([png], { type: 'image/png' }), 'p.png');
  await adm.get('/admin/products/new'); r = await adm.req('POST', '/admin/products/save', fd2, { form: true }); const np = db.get("SELECT * FROM products WHERE name='上传图测试商品'"); ok(np && /\/uploads\//.test(np.images), '后台商品图片上传', r.status);
  if (np) { const up = JSON.parse(np.images)[0]; const g = await fetch(base + up); ok(g.status === 200 && g.headers.get('content-type').includes('image'), '上传图片可访问'); await adm.post('/admin/products/' + np.id + '/delete'); }

  console.log('== 单级邀请:首单完成 + 观察期后发放 ==');
  const svc = require('../lib/svc');
  const buyOne = async (cli, pid) => {
    let rr = await cli.post('/checkout', { sku_id: db.get('SELECT id FROM skus WHERE product_id=? ORDER BY id LIMIT 1', pid).id, qty: 1 });
    rr = await cli.post('/order/create', { items: itemsRaw(rr.text), address_id: (rr.text.match(/name="address_id" value="(\d+)"/) || [])[1], no7_confirm: '1' });
    const id = rr.loc.match(/order\/(\d+)/)[1]; await cli.post('/order/' + id + '/pay', { method: 'wechat' });
    await adm.post('/admin/orders/' + id + '/ship', { company: '中通快递', tracking_no: 'ZT' + String(id).padStart(10, '0') });
    await cli.get('/order/' + id); await cli.post('/order/' + id + '/confirm'); return +id;
  };
  const mkInvitee = async tag => {
    const c = new C(); const ph = '133' + String(Date.now()).slice(-8);
    await c.get('/register'); await c.post('/register', { phone: ph, password: 'abc12345', password2: 'abc12345', nickname: tag, agree: '1', ref: '100001' }); await c.get('/me');
    await c.post('/me/addresses', { name: tag, phone: '13812345678', province: '广东省', city: '深圳市', district: '南山区', detail: '邀请路 1 号' });
    return { c, uid: db.get('SELECT id FROM users WHERE phone=?', ph).id };
  };
  const refPts = () => db.get('SELECT points FROM users WHERE id=1').points;
  const rp0 = refPts();
  const inv1 = await mkInvitee('邀一');
  ok(db.get('SELECT referrer_id FROM users WHERE id=?', inv1.uid).referrer_id === 1, '邀请关系建立');
  ok(refPts() === rp0, '注册不给邀请人奖励');
  const o1 = await buyOne(inv1.c, 9);
  ok(db.get('SELECT status FROM orders WHERE id=?', o1).status === 'completed', '被邀请人首单已确认收货');
  let ir = db.get('SELECT * FROM invite_rewards WHERE invitee_id=?', inv1.uid);
  ok(ir && ir.status === 'pending' && ir.points === 100 && ir.order_id === o1, '首单完成后进入观察期(待发放)');
  svc.settleInvites(); ok(db.get('SELECT status FROM invite_rewards WHERE id=?', ir.id).status === 'pending' && refPts() === rp0, '观察期内不发放');
  db.prepare("UPDATE invite_rewards SET due_at='2000-01-01 00:00:00' WHERE id=?").run(ir.id);
  svc.settleInvites();
  ok(db.get('SELECT status FROM invite_rewards WHERE id=?', ir.id).status === 'granted' && refPts() === rp0 + 100, '观察期满后一次性发放 100 积分');
  const o1b = await buyOne(inv1.c, 9);
  ok(db.all('SELECT * FROM invite_rewards WHERE invitee_id=?', inv1.uid).length === 1, '第二单不再奖励(仅首单)');
  // 观察期内退款 → 取消
  const inv2 = await mkInvitee('邀二');
  const o2 = await buyOne(inv2.c, 9);
  const ir2 = db.get('SELECT * FROM invite_rewards WHERE invitee_id=?', inv2.uid); ok(ir2 && ir2.status === 'pending', '第二位好友首单进入观察期');
  svc.refundOrder(o2, '测试全额退款', false, { aftersale: true });
  ok(db.get('SELECT status FROM invite_rewards WHERE id=?', ir2.id).status === 'cancelled', '观察期内退款,奖励取消');
  const rp1 = refPts(); db.prepare("UPDATE invite_rewards SET due_at='2000-01-01 00:00:00' WHERE id=?").run(ir2.id); svc.settleInvites(); ok(refPts() === rp1, '已取消的奖励不会发放');

  console.log('== 云商卡加赠积分到期作废 ==');
  const cloud = require('../lib/cloud');
  ok(cloud.isCardActive(db.get('SELECT * FROM users WHERE id=1')), '演示会员云商卡生效中');
  db.prepare("DELETE FROM signins WHERE user_id=1 AND day=?").run(require('../lib/util').today());
  const lotBefore = db.get('SELECT points FROM users WHERE id=1').points;
  const ex = cloud.signinExtra(1, svc.addPoints); ok(ex > 0, '会员签到加赠 ' + ex);
  const lot = db.get('SELECT * FROM point_lots WHERE user_id=1 ORDER BY id DESC LIMIT 1'); ok(lot && lot.remaining === ex && lot.expire_at > require('../lib/util').now(), '加赠积分记为限期积分');
  db.prepare("UPDATE point_lots SET expire_at='2000-01-01 00:00:00' WHERE id=?").run(lot.id);
  svc.expirePointLots();
  ok(db.get('SELECT points FROM users WHERE id=1').points === lotBefore && db.get('SELECT remaining FROM point_lots WHERE id=?', lot.id).remaining === 0, '到期未用的加赠积分自动作废');
  // 先使用后到期:只作废剩余部分
  const ex2 = cloud.signinExtra(1, svc.addPoints) || (svc.addPoints(1, 5, 'test lot', { expireAt: '2099-01-01 00:00:00' }), 5);
  const lot2 = db.get('SELECT * FROM point_lots WHERE user_id=1 ORDER BY id DESC LIMIT 1');
  svc.addPoints(1, -2, '测试消费'); ok(db.get('SELECT remaining FROM point_lots WHERE id=?', lot2.id).remaining === lot2.points - 2, '消费积分优先扣减限期积分');
  const ptsNow = db.get('SELECT points FROM users WHERE id=1').points;
  db.prepare("UPDATE point_lots SET expire_at='2000-01-01 00:00:00' WHERE id=?").run(lot2.id); svc.expirePointLots();
  ok(db.get('SELECT points FROM users WHERE id=1').points === ptsNow - (lot2.points - 2), '仅作废未使用的部分');
  // 非会员:签到无加赠
  ok(cloud.signinExtra(3, svc.addPoints) === 0, '过期/未开通会员无签到加赠');
  ok(!db.get("SELECT name FROM sqlite_master WHERE name IN ('commissions','cloud_referral_log','cloud_daily_log','cloud_redeem_requests')"), '分销/推三返一/每日返积分/兑换申请表已归档');

  console.log('== v1.1 合规修订 ==');
  {
    const U2 = require('../lib/util');
    const ok2 = ok;
    ok2(cloud.extraForStreak(1) === 25 && cloud.extraForStreak(2) === 27 && cloud.extraForStreak(5) === 33 && cloud.extraForStreak(6) === 35 && cloud.extraForStreak(40) === 35, '云商卡签到加赠:25、27……封顶 35');
    ok2(cloud.extraSeries().join(',') === '25,27,29,31,33,35', '加赠序列说明到封顶为止');
    db.prepare("DELETE FROM signins WHERE user_id=1 AND day=?").run(U2.today());
    let tot = 0; for (let i = 0; i < 5; i++) tot += cloud.signinExtra(1, svc.addPoints, 30); ok2(tot === 5 * 35, '云商卡签到加赠每天封顶 35,不设每月上限', tot);
    ok2(cloud.signinExtra(1, svc.addPoints, 1) === 25, '中断后从 25 重新计算');
    const c1 = new C(); await c1.login('13800000001', '123456');
    // C2:久远的已完成订单仍有质量问题售后入口
    const o1 = db.get("SELECT id FROM orders WHERE user_id=1 AND status='completed' AND type='normal' AND id NOT IN (SELECT order_id FROM aftersales WHERE status IN ('pending','approved_return','returned')) ORDER BY id LIMIT 1");
    db.prepare("UPDATE orders SET completed_at=? WHERE id=?").run(U2.offset(-60 * 86400000), o1.id);
    r = await c1.get('/order/' + o1.id); ok2(r.text.includes('联系客服申请售后(质量问题)') && r.text.includes('已超过七天无理由退货期'), 'C2:60 天前完成的订单仍可联系客服申请质量问题售后');
    r = await c1.get('/orders'); ok2(r.text.includes('/order/' + o1.id + '/aftersale'), 'C2:订单列表也保留售后入口');
    r = await c1.post('/order/' + o1.id + '/aftersale'); ok2(r.loc === '/service#end', 'C2:售后申请转客服');
    // C1:鲜活易腐商品页
    r = await c1.get('/product/8'); ok2(r.text.includes('本商品属于鲜活易腐类,不支持七天无理由退货') && !r.text.includes('签收后 7 天内可申请') && !r.text.includes('7天无理由退换') && !r.text.includes('全国联保'), 'C1:鲜活易腐商品页无七天无理由模板文案');
    r = await c1.get('/product/9'); ok2(!/全国联保|假一赔十|财哥严选/.test(r.text), 'G6:商品详情无全国联保/假一赔十/财哥严选');
    // G3:无评价不显示好评率
    const noRv = db.get("SELECT id FROM products WHERE status=1 AND id NOT IN (SELECT product_id FROM reviews WHERE status='approved') LIMIT 1");
    r = await c1.get('/product/' + noRv.id); ok2(r.text.includes('暂无评价') && !r.text.includes('好评率'), 'G3:无评价时显示「暂无评价」');
    // G4:秒杀未开始不把原价标为秒杀价
    const skPre = db.get("SELECT * FROM seckills WHERE start_at>? AND status=1 LIMIT 1", U2.now());
    if (skPre) { r = await c1.get('/product/' + skPre.product_id); ok2(r.text.includes('活动价 <b style="color:var(--red)">¥' + skPre.price + '</b>') && r.text.includes('开始,每人限购') && !r.text.includes(' 活动价,每人限购') && !/秒杀|限时|倒计时|data-countdown|抢/.test(r.text), 'G4:活动未开始时显示「活动价 ¥x,开始时间」'); }
    // G1 / D1
    r = await c1.get('/'); ok2(r.text.includes('普通商品满99元包邮(大件、偏远地区除外') && !r.text.includes('全场满99'), 'G1:包邮口径更新');
    r = await c1.get('/notices'); ok2(!r.text.includes('积分翻倍'), 'D1:积分翻倍公告已下线');
    ok2(['全国联保', '假一赔十', '财哥严选'].every(w => require('../lib/banned').words().includes(w)), 'G6:违禁词表含全国联保/假一赔十/财哥严选');
    // 协议
    ok2(svc.S('policy_version') === '1.1', '协议版本 1.1');
    r = await c1.get('/privacy'); ok2(r.text.includes('如后续由供应商直接发货,我们会在订单页标注') && r.text.includes('头像使用默认头像,昵称由您自行填写') && !r.text.includes('头像昵称与手机号') && !r.text.includes('以商品页或订单页标注为准'), '隐私政策:供应商标注与头像昵称说明');
    ok2(['商品供应商', '第三方 SDK 与服务清单', '评价内容(文字、星级评分)', '账号密码(加密存储)', '成长值、会员等级、优惠券', '【公司全称】', '【联系邮箱】', '【生效日期】', '版本号:1.1'].every(x => r.text.includes(x)), '隐私政策补充 A2/A3/A4/A11,保留占位符');
    r = await c1.get('/terms'); ok2(r.text.includes('勾选同意,即表示') && !r.text.includes('注册、登录或使用本平台,即表示'), 'B1:用户协议不再默示同意');
    r = await new C().get('/login'); ok2(!r.text.includes('登录即表示') && r.text.includes('首次注册或协议更新时'), 'B1:登录页文案');
    r = await c1.get('/points-rules'); ok2(r.text.includes('与评分高低无关') && r.text.includes('最高每天 35 积分') && !r.text.includes('{{'), '积分规则:评价积分与云商卡递增加赠');
    r = await c1.get('/me/cloud'); ok2(r.text.includes('25、27、29、31、33、35') && r.text.includes('最高每天 35 积分') && !r.text.includes('每月最多'), '云商卡页:递增加赠封顶说明');
    r = await c1.get('/me/points'); ok2(r.text.includes('最高每天 35 积分'), '签到页:封顶说明');
    r = await c1.get('/privacy'); ok2(r.text.includes('我的 - 设置 - 账号与安全 - 注销账号'), '隐私政策:注销路径');
    // A1:性别不再保存
    db.prepare("UPDATE users SET gender='保密' WHERE id=1").run();
    await c1.get('/me/profile'); await c1.post('/me/profile', { nickname: '韵农粉丝', gender: '男' }); ok2(db.get('SELECT gender FROM users WHERE id=1').gender === '保密', 'A1:提交 gender 不被保存');
    // D2:差评也在发表时发放积分,审核通过不重复发放
    const oc = db.get("SELECT o.id, i.id iid FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.user_id=1 AND o.status='completed' AND i.product_id IS NOT NULL ORDER BY o.id LIMIT 1");
    ok2(!!oc, 'D2:找到可评价订单');
    if (oc) {
      db.prepare('UPDATE order_items SET reviewed=0 WHERE id=?').run(oc.iid);
      r = await c1.get('/order/' + oc.id + '/review'); const iid = (r.text.match(/name="content_(\d+)"/) || [])[1];
      ok2(r.text.includes('与评分高低无关'), 'D2:评价页文案');
      const p0 = db.get('SELECT points FROM users WHERE id=1').points;
      await c1.post('/order/' + oc.id + '/review', { ['rating_' + iid]: '1', ['content_' + iid]: '差评测试:不太满意' });
      const p1 = db.get('SELECT points FROM users WHERE id=1').points; ok2(p1 === p0 + 10, 'D2:一星差评发表即得 10 积分', p1 - p0);
      const rvId = db.get("SELECT id FROM reviews WHERE content='差评测试:不太满意'").id;
      await adm.post('/admin/reviews/' + rvId + '/approve'); ok2(db.get('SELECT points FROM users WHERE id=1').points === p1, 'D2:审核通过不重复发放');
      // 用户删除自己的评价:商品页移除、计数更新、积分不扣回、不能删除他人评价
      const pid = db.get('SELECT product_id FROM reviews WHERE id=?', rvId).product_id;
      const cnt = t => +((t.match(/用户评价\((\d+)\)/) || [])[1]);
      r = await c1.get('/product/' + pid); const n0 = cnt(r.text); ok2(r.text.includes('差评测试:不太满意'), '删除前商品页展示该评价');
      r = await c1.get('/me/reviews'); ok2(r.text.includes('/me/reviews/' + rvId + '/delete') && r.text.includes('删除我的评价') && r.text.includes('data-confirm'), '我的评价有「删除我的评价」及确认');
      const other = db.get('SELECT id FROM reviews WHERE user_id<>1 LIMIT 1');
      if (other) { await c1.post('/me/reviews/' + other.id + '/delete'); ok2(!!db.get('SELECT 1 FROM reviews WHERE id=?', other.id), '不能删除他人评价'); }
      await c1.post('/me/reviews/' + rvId + '/delete');
      r = await c1.get('/product/' + pid); ok2(!r.text.includes('差评测试:不太满意') && cnt(r.text) === n0 - 1 && !db.get('SELECT 1 FROM reviews WHERE id=?', rvId), '删除后商品页移除且评价数减一');
      ok2(db.get('SELECT points FROM users WHERE id=1').points === p1, '删除评价不扣回积分');
    }
    // H1:待付款订单不阻止注销,注销时自动取消
    const h = new C(); const hp = '137' + String(Date.now()).slice(-8);
    await h.get('/register'); await h.post('/register', { phone: hp, password: 'abc12345', password2: 'abc12345', nickname: '注销测2', agree: '1' }); await h.get('/me');
    await h.post('/me/addresses', { name: '注销测', phone: '13812345678', province: '广东省', city: '深圳市', district: '南山区', detail: '注销路 2 号' });
    const sk9 = (await h.get('/product/9')).text.match(/\{"id":(\d+),"attrs"/)[1];
    r = await h.post('/checkout', { sku_id: sk9, qty: 1 });
    r = await h.post('/order/create', { items: itemsRaw(r.text), address_id: (r.text.match(/name="address_id" value="(\d+)"/) || [])[1] }); const hoid = (r.loc.match(/order\/(\d+)/) || [])[1];
    ok2(db.get('SELECT status FROM orders WHERE id=?', hoid).status === 'unpaid', 'H1:已有待付款订单');
    r = await h.get('/me/cancel'); ok2(!r.text.includes('暂不能注销') && r.text.includes('将在注销时自动取消'), 'H1:待付款订单不阻止注销');
    r = await h.post('/me/cancel', { confirm_text: '确认注销', ack: '1' }); ok2(r.loc === '/' && db.get('SELECT status FROM orders WHERE id=?', hoid).status === 'cancelled', 'H1:注销时自动取消待付款订单');
  }

  console.log('== 后台完善 ==');
  {
    const lastLog = () => db.get('SELECT * FROM admin_logs ORDER BY id DESC LIMIT 1');
    // 人工调整积分:原因必填,写入积分明细与操作日志
    const mu = db.get("SELECT id, points FROM users WHERE phone='13800000003'");
    r = await adm.get('/admin/members/' + mu.id);
    ok(r.text.includes('调整原因(必填'), '会员详情:积分调整原因为必填项');
    await adm.post('/admin/members/' + mu.id + '/points', { delta: 50, reason: '' });
    ok(db.get('SELECT points FROM users WHERE id=?', mu.id).points === mu.points, '未填原因不能调整积分');
    r = await adm.get('/admin/members/' + mu.id); ok(r.text.includes('请填写调整原因'), '未填原因有错误提示');
    await adm.post('/admin/members/' + mu.id + '/points', { delta: -(mu.points + 1), reason: '测试扣减' });
    ok(db.get('SELECT points FROM users WHERE id=?', mu.id).points === mu.points, '扣减不能超过当前积分');
    await adm.post('/admin/members/' + mu.id + '/points', { delta: 50, reason: '活动补发' });
    ok(db.get('SELECT points FROM users WHERE id=?', mu.id).points === mu.points + 50, '填写原因后积分调整成功');
    ok(db.get('SELECT reason FROM points_log WHERE user_id=? ORDER BY id DESC', mu.id).reason === '管理员调整:活动补发', '积分明细记录调整原因');
    ok(lastLog().action === '调整积分' && lastLog().detail.includes('活动补发') && lastLog().detail.includes('+50'), '操作日志记录积分调整(含原因与数值)');
    r = await adm.get('/admin/points-log?uid=' + mu.id); ok(r.status === 200 && r.text.includes('管理员调整:活动补发'), '会员积分明细页(分页)');
    r = await adm.get('/admin/points-log?dir=admin&q=活动补发'); ok(r.text.includes('活动补发'), '全站积分明细可按人工调整/关键词筛选');
    r = await adm.get('/admin/points-log/export?uid=' + mu.id); ok(r.text.includes('变动后余额') && r.text.includes('活动补发'), '积分明细导出CSV');
    ok(lastLog().action === '导出积分明细CSV', '导出积分明细记入操作日志');

    // 评价:显示/隐藏/回复均记日志(修复「审核通过」日志被注释)
    const rv = db.get("SELECT id FROM reviews ORDER BY id LIMIT 1");
    db.exec1("UPDATE reviews SET status='rejected' WHERE id=?", rv.id);
    await adm.post('/admin/reviews/' + rv.id + '/approve');
    ok(db.get('SELECT status FROM reviews WHERE id=?', rv.id).status === 'approved' && lastLog().action.startsWith('评价审核通过'), '评价重新显示并记入操作日志');
    await adm.post('/admin/reviews/' + rv.id + '/reject'); ok(lastLog().action === '隐藏评价', '隐藏评价记入操作日志');
    await adm.post('/admin/reviews/' + rv.id + '/approve');
    r = await adm.post('/admin/reviews/' + rv.id + '/reply', { reply: '感谢支持,本品全国联保' }); r = await adm.get('/admin/reviews');
    ok(r.text.includes('含违禁/敏感词'), '评价回复做违禁词检查并提示');
    await adm.post('/admin/reviews/' + rv.id + '/reply', { reply: '感谢您的支持' });

    // 批量上/下架
    await adm.get('/admin/products');
    await adm.post('/admin/products/batch', { action: 'off', ids: '1' }); // URLSearchParams 单值
    ok(db.get('SELECT status FROM products WHERE id=1').status === 0 && lastLog().action === '批量下架商品', '批量下架并记日志');
    r = await adm.req('POST', '/admin/products/batch', null); // 无 body
    const multi = new URLSearchParams([['_csrf', adm.t], ['action', 'on'], ['ids', '1'], ['ids', '2']]).toString();
    await fetch(base + '/admin/products/batch', { method: 'POST', headers: { Cookie: Object.entries(adm.k).map(([x, y]) => x + '=' + y).join('; '), 'Content-Type': 'application/x-www-form-urlencoded' }, body: multi, redirect: 'manual' });
    ok(db.get('SELECT status FROM products WHERE id=1').status === 1 && db.get('SELECT status FROM products WHERE id=2').status === 1 && lastLog().action === '批量上架商品', '批量上架(多选)');
    r = await adm.get('/admin/products'); ok(r.text.includes('name="ids"') && r.text.includes('批量下架') && r.text.includes('快速上架'), '商品列表有勾选框、批量操作与快速上架入口');

    // 快速上架
    const cat = db.get('SELECT id FROM categories WHERE parent_id>0 ORDER BY id LIMIT 1').id, before = db.get('SELECT COUNT(*) n FROM products').n;
    await adm.get('/admin/products/quick');
    r = await adm.post('/admin/products/quick', { name: '快速上架测试', category_id: cat, template_id: '', price: '9.9', stock: '20' });
    ok(db.get('SELECT COUNT(*) n FROM products').n === before && r.text.includes('请选择运费模板'), '快速上架:运费模板必选');
    r = await adm.post('/admin/products/quick', { name: '快速上架测试', category_id: cat, template_id: 1, price: '9.9', stock: '20', market_price: '5' });
    ok(r.text.includes('划线原价需高于售价'), '快速上架:划线价校验');
    r = await adm.post('/admin/products/quick', { name: '快速上架测试', category_id: cat, template_id: 1, price: '9.9', stock: '20', spec: '500g' });
    const qp = db.get("SELECT * FROM products WHERE name='快速上架测试'");
    ok(qp && qp.status === 1 && r.loc === '/admin/products' && db.get('SELECT stock, spec_text, price FROM skus WHERE product_id=?', qp.id).stock === 20, '快速上架:单规格商品创建并上架');
    ok((await a.get('/product/' + qp.id)).status === 200, '快速上架商品前台可访问');
    r = await adm.post('/admin/products/quick', { name: '假一赔十 测试品', category_id: cat, template_id: 1, price: '9.9', stock: '1' });
    ok(/\/admin\/products\/\d+\/edit/.test(r.loc || ''), '快速上架:命中违禁词时保存并跳转编辑页提示');
    r = await adm.get(r.loc); ok(r.text.includes('违禁/敏感词'), '违禁词提示显示');

    // 订单详情页直接创建售后单
    const eo = db.get("SELECT o.* FROM orders o WHERE o.status IN ('paid','shipped') AND o.type!='points' AND o.pay_amount>0 AND NOT EXISTS (SELECT 1 FROM aftersales s WHERE s.order_id=o.id AND s.status IN ('pending','approved_return','returned')) ORDER BY o.id DESC LIMIT 1");
    r = await adm.get('/admin/orders/' + eo.id); ok(r.text.includes('为此订单创建售后单'), '订单详情:可创建售后单');
    r = await adm.post('/admin/orders/' + eo.id + '/aftersale', { type: 'refund', reason: '', amount: '0.01' });
    ok(!db.get("SELECT 1 FROM aftersales WHERE order_id=? AND status='pending'", eo.id), '售后原因必填');
    r = await adm.post('/admin/orders/' + eo.id + '/aftersale', { type: 'refund', reason: '用户来电申请退款', amount: '0.01' });
    const nas = db.get("SELECT * FROM aftersales WHERE order_id=? AND status='pending' ORDER BY id DESC", eo.id);
    ok(nas && /\/admin\/aftersales\/\d+/.test(r.loc || '') && nas.created_by, '订单详情创建售后单成功');
    ok(db.get("SELECT content FROM messages WHERE user_id=? AND sender='staff' ORDER BY id DESC", eo.user_id).content.includes('#' + nas.id), '创建售后单后客服消息通知用户');
    r = await adm.post('/admin/orders/' + eo.id + '/aftersale', { type: 'refund', reason: '重复', amount: '0.01' });
    ok(db.get("SELECT COUNT(*) n FROM aftersales WHERE order_id=? AND status='pending'", eo.id).n === 1, '已有进行中售后单时不可重复创建');
    r = await adm.get('/admin/aftersales?q=' + eo.order_no); ok(r.text.includes(eo.order_no) && r.text.includes('用户来电申请退款'), '售后列表按订单号搜索');
    r = await adm.get('/admin/aftersales?q=不存在的单号XYZ'); ok(r.text.includes('暂无售后单'), '售后搜索无结果');
    await adm.post('/admin/aftersales/' + nas.id + '/handle', { action: 'reject', admin_note: '测试驳回' });

    // 订单导出按筛选条件
    r = await adm.get('/admin/orders/export?status=completed'); const lines = r.text.trim().split('\n').slice(1);
    ok(lines.length > 0 && lines.every(l => l.includes('已完成')), '订单导出按当前筛选条件');
    // 物流轨迹记日志
    await adm.post('/admin/orders/' + eo.id + '/trace', { text: '包裹已到达分拣中心' }); ok(lastLog().action === '更新物流轨迹', '物流轨迹更新记入日志');

    // 政策编辑:版本号校验 + 保存快照
    const pv = db.get("SELECT * FROM articles WHERE category='policy' AND topic='terms'"), ver = db.get("SELECT value FROM settings WHERE key='policy_version'").value;
    await adm.get('/admin/policies?tab=terms');
    await adm.post('/admin/policies', { topic: 'terms', title: pv.title, content: pv.content, version: 'abc' });
    ok(db.get("SELECT value FROM settings WHERE key='policy_version'").value === ver && !db.get("SELECT 1 FROM policy_versions WHERE topic='terms'"), '协议版本号格式校验');
    await adm.post('/admin/policies', { topic: 'terms', title: pv.title, content: pv.content, version: ver });
    const hv = db.get("SELECT * FROM policy_versions WHERE topic='terms' ORDER BY id DESC");
    ok(hv && hv.version === ver && hv.content === pv.content, '保存协议时留存历史快照');
    r = await adm.get('/admin/policies?tab=terms'); ok(r.text.includes('历史版本') && r.text.includes('/admin/policies/history/' + hv.id), '协议页显示保存记录');
    ok((await adm.get('/admin/policies/history/' + hv.id)).status === 200, '历史快照可查看');

    // 新建管理员:首次登录必须改密(临时密码)
    await adm.get('/admin/admins');
    await adm.post('/admin/admins/save', { username: 'tmpstaff', name: '临时员工', role_id: db.get("SELECT id FROM roles WHERE permissions!='all' ORDER BY id LIMIT 1").id, password: 'Temp#2026x', status: '1' });
    ok(db.get("SELECT must_change_pw FROM admins WHERE username='tmpstaff'").must_change_pw === 1, '新建管理员账号标记为首次登录须改密');

    // 正式环境(未设置 DEMO_MODE):在进程内启动一份不带 DEMO_MODE 的后台,验证不能跳过
    delete process.env.DEMO_MODE;
    const app = require('../server');
    const srv = await new Promise(res => { const s2 = app.listen(0, () => res(s2)); });
    const pbase = 'http://127.0.0.1:' + srv.address().port;
    const p1 = new C(pbase); await p1.get('/admin/login');
    r = await p1.post('/admin/login', { username: 'admin', password: 'admin123' }); ok(r.loc === '/admin/password', '正式环境:默认密码登录强制改密');
    r = await p1.get('/admin/password'); ok(!r.text.includes('暂不修改'), '正式环境:改密页不提供跳过');
    r = await p1.post('/admin/password/skip'); r = await p1.get('/admin'); ok(r.status === 302 && r.loc === '/admin/password', '正式环境:跳过请求被拒绝,仍被拦截');
    const p2 = new C(pbase); await p2.get('/admin/login');
    r = await p2.post('/admin/login', { username: 'tmpstaff', password: 'Temp#2026x' }); ok(r.loc === '/admin/password', '新建账号用临时密码登录需改密');
    await p2.get('/admin/password');
    r = await p2.post('/admin/password', { old_password: 'Temp#2026x', password: 'Staff#2026New', password2: 'Staff#2026New' }); ok(r.loc === '/admin', '修改密码后进入后台');
    ok(db.get("SELECT must_change_pw FROM admins WHERE username='tmpstaff'").must_change_pw === 0, '改密后清除首次登录标记');
    r = await p2.get('/admin/products'); ok(r.status === 200, '改密后可正常使用后台', r.status);
    const p3 = new C(pbase); await p3.get('/admin/login'); r = await p3.post('/admin/login', { username: 'tmpstaff', password: 'Staff#2026New' }); ok(r.loc === '/admin', '新密码再次登录不再要求改密');
    srv.close();
  }

  console.log('== 真实销量 / 推荐排序 / 全部商品 / 供应商销量 ==');
  {
    const real = pid => db.get("SELECT COALESCE(SUM(oi.qty),0) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=? AND o.status IN ('paid','shipped','completed')", pid).n;
    const bad = db.all('SELECT id, sales FROM products').filter(p => p.sales !== real(p.id));
    ok(!bad.length, '所有商品销量 = 真实订单件数(无预置/虚构销量)', JSON.stringify(bad.slice(0, 3)));
    const sku = db.get("SELECT s.* FROM skus s JOIN products p ON p.id=s.product_id WHERE p.status=1 AND s.stock>=5 AND p.id NOT IN (SELECT product_id FROM seckills) AND p.id NOT IN (SELECT product_id FROM groupbuys) ORDER BY s.id LIMIT 1");
    const s0 = db.get('SELECT sales FROM products WHERE id=?', sku.product_id).sales;
    r = await a.post('/checkout', { sku_id: sku.id, qty: 2 });
    r = await a.post('/order/create', { items: itemsRaw(r.text), address_id: (r.text.match(/name="address_id" value="(\d+)"/) || [])[1], no7_confirm: '1' });
    const noid = +(r.loc || '').match(/order\/(\d+)/)[1];
    ok(db.get('SELECT sales FROM products WHERE id=?', sku.product_id).sales === s0, '未支付订单不计销量');
    await a.post('/order/' + noid + '/pay', { method: 'alipay' });
    ok(db.get('SELECT sales FROM products WHERE id=?', sku.product_id).sales === s0 + 2, '支付后销量 +2');
    require('../lib/svc').refundOrder(noid, '测试退款');
    ok(db.get('SELECT sales FROM products WHERE id=?', sku.product_id).sales === s0, '整单退款后销量扣回');
    r = await adm.get('/admin/products/' + sku.product_id + '/edit'); ok(r.status === 200 && !/name="sales"/.test(r.text), '后台商品表单无销量输入框');
    r = await adm.get('/admin/products'); ok(!/name="sales"/.test(r.text) && r.text.includes('/rank'), '后台商品列表无销量输入,可改推荐排序');
    r = await adm.get('/admin/products/quick'); ok(!/name="sales"/.test(r.text), '快速上架无销量输入框');
    // 前台显示销量开关(默认关闭)
    ok(db.get("SELECT value FROM settings WHERE key='show_sales'").value === '0', '「前台显示销量」默认关闭');
    const sold = db.get('SELECT id FROM products WHERE status=1 AND sales>0 ORDER BY sales DESC LIMIT 1'), zero = db.get('SELECT id FROM products WHERE status=1 AND sales=0 LIMIT 1');
    for (const u of ['/', '/products', '/products?sort=sales', '/product/' + sold.id]) { r = await a.get(u); ok(!r.text.includes('已售'), '关闭时不显示已售:' + u); }
    const st = await adm.get('/admin/settings'); ok(st.text.includes('前台显示销量'), '站点设置含「前台显示销量」');
    const form = {}; for (const m of st.text.matchAll(/<input[^>]*name="([a-z_]+)"[^>]*value="([^"]*)"/g)) form[m[1]] = m[2]; for (const m of st.text.matchAll(/<textarea[^>]*name="([a-z_]+)"[^>]*>([^<]*)<\/textarea>/g)) form[m[1]] = m[2].replace(/&#10;/g, '\n'); delete form._csrf;
    await adm.post('/admin/settings', { ...form, show_sales: '1' });
    r = await a.get('/product/' + sold.id); ok(r.text.includes('已售 ' + db.get('SELECT sales FROM products WHERE id=?', sold.id).sales + ' 件'), '开启后显示真实销量');
    if (zero) { r = await a.get('/product/' + zero.id); ok(!r.text.includes('<dt>销量</dt>') && !r.text.includes('已售 0'), '销量为 0 时不显示'); }
    r = await a.get('/products'); ok(!r.text.includes('已售 0'), '列表不显示「已售 0」');
    await adm.post('/admin/settings', { ...form, show_sales: '0' }); r = await a.get('/product/' + sold.id); ok(!r.text.includes('已售'), '再次关闭后隐藏');
    // 推荐排序
    const target = db.get('SELECT id, sort, name FROM products WHERE status=1 ORDER BY sort ASC, id DESC LIMIT 1');
    await adm.get('/admin/products');
    await adm.post('/admin/products/' + target.id + '/rank', { sort: '99999', is_top: '1' });
    let pr = db.get('SELECT sort, is_top FROM products WHERE id=?', target.id); ok(pr.sort === 99999 && pr.is_top === 1, '列表页修改推荐权重与置顶');
    ok(db.get("SELECT 1 FROM admin_logs WHERE action='修改推荐排序' AND detail LIKE ?", '#' + target.id + ' %'), '推荐排序变更写入操作日志');
    r = await a.get('/products'); ok((r.text.match(/href="\/product\/(\d+)"/) || [])[1] === String(target.id), '综合排序:置顶/权重高的在最前');
    await adm.post('/admin/products/' + target.id + '/rank', { sort: String(target.sort), is_top: '0' }); pr = db.get('SELECT sort, is_top FROM products WHERE id=?', target.id); ok(pr.sort === target.sort && !pr.is_top, '恢复推荐排序');
    // 全部商品页
    const ids = t => [...t.matchAll(/class="pcard" href="\/product\/(\d+)"/g)].map(m => +m[1]);
    const prices = t => ids(t).map(i => db.get('SELECT price FROM products WHERE id=?', i).price);
    const asc = prices((await a.get('/products?sort=price_asc')).text), desc = prices((await a.get('/products?sort=price_desc')).text);
    ok(asc.length && asc.every((v, i) => !i || asc[i - 1] <= v), '价格升序'); ok(desc.length && desc.every((v, i) => !i || desc[i - 1] >= v), '价格降序');
    r = await a.get('/products?sort=price_asc'); ok(r.text.includes('sort=price_desc'), '价格按钮可切换升/降序');
    const sl = ids((await a.get('/products?sort=sales')).text).map(i => db.get('SELECT sales FROM products WHERE id=?', i).sales); ok(sl.every((v, i) => !i || sl[i - 1] >= v), '销量排序按真实销量');
    r = await a.get('/products'); ok(r.text.includes('综合') && r.text.includes('新品') && r.text.includes('class="psearch"') && r.text.includes('mchip'), '全部商品页:分类标签、搜索框、排序');
    r = await a.get('/products?q=' + encodeURIComponent('不存在的商品zzq')); ok(r.text.includes('暂无商品'), '空状态「暂无商品」');
    r = await a.req('GET', '/products?page=2&partial=1', null, {}); let js = {}; try { js = JSON.parse(r.text); } catch (e) {} ok(js.page === 2 && js.html.includes('pcard'), '无限滚动分页接口');
    // 首页不再有个性化推荐
    r = await a.get('/'); ok(!r.text.includes('为你推荐') && !r.text.includes('猜你喜欢'), '首页无「为你推荐/猜你喜欢」');
    // 供应商销量:仅后台
    const SUP = 987654321; db.prepare('UPDATE products SET supplier_sales=? WHERE status=1').run(SUP);
    let leak = false; for (const u of ['/', '/products', '/products?sort=sales', '/products?page=1&partial=1', '/product/' + target.id, '/activity', '/groupbuy', '/me/favorites', '/me/history']) { r = await a.get(u); if (r.text.includes(String(SUP))) { leak = u; break; } }
    ok(!leak, '供应商销量不出现在前台 HTML', leak);
    r = await adm.get('/admin/products/' + target.id + '/edit'); ok(r.text.includes('name="supplier_sales"') && r.text.includes(String(SUP)), '后台可查看/编辑供应商销量');
    db.prepare('UPDATE products SET supplier_sales=NULL').run();
  }

  console.log('== 功能审计回归(2026-10) ==');
  {
    const svcR = require('../lib/svc');
    const login2 = async (u, pw) => { const c = new C(); await c.get('/admin/login'); await c.post('/admin/login', { username: u, password: pw }); await c.get('/admin/password'); await c.post('/admin/password/skip'); await c.get('/admin'); return c; };
    const m = new C(); await m.login('13800000001', '123456');
    const sk = db.get("SELECT s.id, s.price FROM skus s JOIN products p ON p.id=s.product_id WHERE p.status=1 AND p.supplier IS NULL AND s.stock>10 AND COALESCE(p.no_reason_return,1)=1 ORDER BY s.price DESC LIMIT 1");
    const ad = db.get('SELECT id FROM addresses WHERE user_id=1 LIMIT 1');
    db.prepare('UPDATE users SET points=points+5000 WHERE id=1').run();
    await m.get('/cart'); r = await m.post('/order/create', { sku_id: sk.id, qty: 2, address_id: ad.id, no7_confirm: '1', use_points: '2000' });
    const ro = +r.loc.match(/order\/(\d+)/)[1]; await m.get(`/order/${ro}/pay`); await m.post(`/order/${ro}/pay`, { method: 'wechat' });
    await adm.post(`/admin/orders/${ro}/ship`, { company: '中通快递', tracking_no: 'ZT7700000001' }); await m.get('/order/' + ro); await m.post(`/order/${ro}/confirm`, {});
    const o0 = db.get('SELECT * FROM orders WHERE id=?', ro), u0 = db.get('SELECT points, growth FROM users WHERE id=1');
    ok(o0.status === 'completed' && o0.points_used > 0, '回归准备:已完成订单(使用积分抵扣)');
    // 1) 两次部分退款合计等于实付 → 订单变为已退款,积分/奖励累计退回(扣回)正确,销量与销售额不再计入
    const h1 = Math.round(o0.pay_amount * 40) / 100, h2 = Math.round((o0.pay_amount - h1) * 100) / 100;
    const dash0 = await adm.get('/admin'); const tot = t => +(t.match(/累计销售额<\/span><b>¥([\d.]+)/) || [])[1];
    await adm.post(`/admin/orders/${ro}/aftersale`, { type: 'refund', reason: '部分退款1', amount: String(h1) });
    let as = db.get('SELECT id FROM aftersales WHERE order_id=? ORDER BY id DESC', ro); await adm.post(`/admin/aftersales/${as.id}/handle`, { action: 'approve' });
    ok(db.get('SELECT status FROM orders WHERE id=?', ro).status === 'completed', '第一次部分退款后订单仍为已完成');
    const dash1 = await adm.get('/admin'); ok(Math.abs(tot(dash0.text) - tot(dash1.text) - h1) <= 1, `数据概览累计销售额扣除部分退款(${tot(dash0.text)}→${tot(dash1.text)},退 ${h1})`);
    await adm.post(`/admin/orders/${ro}/aftersale`, { type: 'refund', reason: '部分退款2', amount: String(h2) });
    as = db.get('SELECT id FROM aftersales WHERE order_id=? ORDER BY id DESC', ro); await adm.post(`/admin/aftersales/${as.id}/handle`, { action: 'approve' });
    const o1 = db.get('SELECT * FROM orders WHERE id=?', ro), u1 = db.get('SELECT points, growth FROM users WHERE id=1');
    const rs = db.get("SELECT SUM(refund_cash) c, SUM(refund_points) p FROM aftersales WHERE order_id=? AND status='refunded'", ro);
    ok(o1.status === 'refunded', '两次部分退款合计等于实付后订单变为「已退款」', o1.status);
    ok(Math.abs(rs.c - o0.pay_amount) < 0.001 && rs.p === o0.points_used, `累计退现金=实付、退积分=下单抵扣积分(${rs.c}/${rs.p})`, JSON.stringify(rs));
    ok(u1.points === u0.points + o0.points_used - o0.points_awarded && u1.growth === u0.growth - o0.growth_awarded, '购物奖励积分/成长值全部扣回、抵扣积分全部退回', JSON.stringify({ u0, u1, used: o0.points_used, aw: o0.points_awarded }));
    ok(db.get('SELECT sales FROM products WHERE id=(SELECT product_id FROM skus WHERE id=?)', sk.id).sales === db.get("SELECT COALESCE(SUM(oi.qty),0) n FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.sku_id=? AND o.status IN ('paid','shipped','completed')", sk.id).n, '整单退完后销量按真实订单重算');
    r = await adm.post(`/admin/orders/${ro}/aftersale`, { type: 'refund', reason: '再退', amount: '0.01' }); ok(db.get('SELECT COUNT(*) n FROM aftersales WHERE order_id=?', ro).n === 2, '已全额退款的订单不能再创建售后');
    // 2) 统计报表与数据概览口径一致(有效订单实付 - 部分退款)
    const NET = "o.pay_amount - COALESCE((SELECT SUM(a.refund_cash) FROM aftersales a WHERE a.order_id=o.id AND a.status='refunded'),0) - COALESCE((SELECT so.refunded_customer FROM supplier_orders so WHERE so.order_id=o.id),0)";
    const net = db.get(`SELECT COALESCE(SUM(${NET}),0) a FROM orders o WHERE o.status NOT IN ('cancelled','unpaid','refunded')`).a;
    ok(Math.abs(tot((await adm.get('/admin')).text) - net) <= 1, '数据概览累计销售额 = 有效订单实付 - 部分退款');
    const st90 = +((await adm.get('/admin/stats?days=90')).text.match(/期间销售额<\/span><b>¥([\d.]+)/) || [])[1];
    const net90 = db.get(`SELECT COALESCE(SUM(${NET}),0) a FROM orders o WHERE o.status NOT IN ('cancelled','unpaid','refunded') AND o.paid_at>=?`, require('../lib/util').offset(-90 * 86400000).slice(0, 10) + ' 00:00:00').a;
    ok(Math.abs(st90 - net90) < 0.011, `统计报表期间销售额扣除部分退款(${st90} vs ${net90.toFixed(2)})`);
    const dt = (await adm.get('/admin')).text; ok(+(dt.match(/待发货订单<\/span><b[^>]*>(\d+)/) || [])[1] === +((dt.match(/订单管理<\/span><span class="dot">(\d+)/) || [])[1] || 0), '待发货数与菜单角标口径一致(未成团拼团不计)');
    // 3) 禁用会员只踢掉该会员的会话(#1 不应误伤 #10~#19)
    const victims = [];
    while (db.get('SELECT MAX(id) n FROM users').n < 10) { const c = new C(); const ph = '1330000' + String(1000 + Math.floor(Math.random() * 8999)); if (db.get('SELECT 1 FROM users WHERE phone=?', ph)) continue; await c.get('/register'); await c.post('/register', { phone: ph, password: '123456', password2: '123456', agree: '1' }); victims.push(c); }
    const v10 = new C(); const ph10 = '1320000' + String(1000 + Math.floor(Math.random() * 8999)); await v10.get('/register'); await v10.post('/register', { phone: ph10, password: '123456', password2: '123456', agree: '1' });
    const vid = db.get('SELECT id FROM users WHERE phone=?', ph10).id; ok(String(vid).startsWith('1') && vid >= 10, '回归准备:#' + vid + ' 会员已登录');
    const m1 = new C(); await m1.login('13800000001', '123456');
    await adm.get('/admin/members'); await adm.post('/admin/members/1/status', {});
    ok((await m1.get('/me')).text.includes('href="/login?next=/me"'), '禁用 #1 后 #1 会话失效'); ok((await v10.get('/me')).text.includes('class="mecard"'), `禁用 #1 不影响 #${vid} 的登录会话`);
    await adm.post('/admin/members/1/status', {}); ok(db.get('SELECT status FROM users WHERE id=1').status === 1, '恢复 #1');
    // 4) 角色权限:按勾选保存并过滤无效键;不能削减自己所用角色、不能去掉最后一个全权限角色
    await adm.get('/admin/roles/new'); await adm.post('/admin/roles/save', { name: '回归角色', perm: ['order', 'bogus', 'member'], permissions: '' });
    ok((db.get("SELECT permissions FROM roles WHERE name='回归角色'") || {}).permissions === 'order,member', '角色权限按勾选保存(无 JS 也生效)并过滤无效值');
    await adm.post('/admin/roles/save', { id: '1', name: '超级管理员', permissions: 'order', remark: '' });
    ok(db.get('SELECT permissions FROM roles WHERE id=1').permissions === 'all', '不能削减自己当前所用角色(超级管理员)的权限');
    ok((await adm.get('/admin/settings')).status === 200, '超级管理员仍可访问系统设置');
    // 5) 无「数据概览」权限的角色登录后落到第一个有权限的页面;页面内无权限的跨模块链接不可点
    const rid = db.get("SELECT id FROM roles WHERE name='回归角色'").id;
    await adm.post('/admin/roles/save', { id: String(rid), name: '回归角色', perm: ['member'] });
    await adm.post('/admin/admins/save', { username: 'reg_member', name: '回归会员管理', role_id: String(rid), password: 'Reg#member2026', status: '1' });
    const rm = new C(); await rm.get('/admin/login'); await rm.post('/admin/login', { username: 'reg_member', password: 'Reg#member2026' }); await rm.get('/admin/password'); await rm.post('/admin/password', { old_password: 'Reg#member2026', password: 'Reg#member2027', password2: 'Reg#member2027' });
    r = await rm.get('/admin'); ok(r.status === 302 && r.loc === '/admin/members', '无数据概览权限:/admin 跳转到会员管理', r.status + ' ' + r.loc);
    r = await rm.get('/admin/members/1'); ok(r.status === 200 && !/href="\/admin\/orders/.test(r.text) && r.text.includes('aria-disabled="true"'), '会员详情页:无订单权限时订单链接不可点');
    ok((await rm.get('/admin/orders')).status === 403, '无订单权限访问订单页仍为 403');
    const ops = await login2('ops', 'ops123456'); r = await ops.get('/admin');
    ok(r.status === 200 && !/href="\/admin\/(orders|aftersales|members|logs)/.test(r.text), '运营专员数据概览不出现无权限页面链接');
    r = await ops.get('/admin/stats'); ok(!/href="\/admin\/(logs\/export|members\/\d)/.test(r.text), '运营专员统计报表不出现操作日志导出/会员详情链接');
    const kf = await login2('kefu', 'kefu123456');
    r = await kf.get('/admin/orders'); ok(!r.text.includes('href="/admin/orders/export'), '客服专员订单页不显示导出(需统计/导出权限)');
    r = await kf.get('/admin/points-log'); ok(!r.text.includes('href="/admin/settings"'), '客服专员积分明细不链接站点设置');
    r = await kf.get('/admin'); ok(!/href="\/admin\/(inventory|products)/.test(r.text), '客服专员数据概览不链接商品/库存页');
    // 6) 云商卡类型:已有开通/销售记录不能删除
    const ctp = db.get('SELECT id FROM cloud_card_types WHERE status=1 LIMIT 1');
    await adm.post('/admin/members/2/cloud', { card_type_id: String(ctp.id), amount: '0', sale_date: require('../lib/util').today(), staff: '回归' });
    await adm.post(`/admin/cloud-cards/${ctp.id}/delete`, {}); ok(db.get('SELECT 1 FROM cloud_card_types WHERE id=?', ctp.id), '已有会员开通的云商卡类型不能删除');
    // 7) 数组/对象形式的查询参数不再导致 500
    for (const [c, u] of [[a, '/products?q[]=1&q[]=2&cat[]=1&sort[a]=x&page[]=2'], [a, '/orders?status[]=paid&status[]=x'], [adm, '/admin/orders?q[]=1&status[]=paid&from[a]=1'], [adm, '/admin/members?q[]=1&level[]=1'], [adm, '/admin/products?q[a]=1&cat[]=1'], [adm, '/admin/reviews?status[]=a&status[]=b'], [adm, '/admin/cloud-members?q[]=1']]) { r = await c.get(u); ok(r.status === 200, '数组查询参数不报错 ' + u.split('?')[0], r.status); }
    // 8) 设置页「注销账号」在最下方
    r = await a.get('/me/settings'); { const i = r.text.indexOf('<div class="card"><h3'); const sl = r.text.slice(i, r.text.indexOf('</div></div>', i)); const ls = [...sl.matchAll(/href="([^"]+)"/g)].map(x => x[1]); ok(ls[ls.length - 1] === '/me/cancel', '设置页「注销账号」位于最下方', ls.join(',')); }
    // 9) 通用开关切换不跳转到站外 Referer
    const bn = db.get('SELECT id FROM banners LIMIT 1'); r = await adm.req('POST', `/admin/banners/${bn.id}/toggle`, { _csrf: adm.t }, {}); await adm.get('/admin/banners');
    const rr = await fetch(base + `/admin/banners/${bn.id}/toggle`, { method: 'POST', redirect: 'manual', headers: { Cookie: Object.entries(adm.k).map(([x, y]) => x + '=' + y).join('; '), 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://evil.example/admin/x' }, body: '_csrf=' + adm.t });
    ok(rr.headers.get('location') === '/admin/banners', '开关切换忽略站外 Referer', rr.headers.get('location'));
    // 10) 首页横幅轮播:读取后台启用的 Banner(按排序);仅一张时无圆点;全部停用时回退固定横幅;链接只允许站内相对路径
    r = await adm.get('/admin/banners'); ok(r.status === 200 && !r.text.includes('不读取此处的 Banner') && !r.text.includes('暂不在前台展示'), 'Banner 列表不再提示「首页未使用 Banner」');
    { const anon = new C(); const home = async () => (await anon.get('/')).text;
      const titles = t => [...t.matchAll(/class="bnr-s[^"]*"[\s\S]*?<h2>([^<]*)<\/h2>/g)].map(m => m[1]);
      const en = db.all('SELECT title FROM banners WHERE status=1 ORDER BY sort, id').map(x => x.title);
      let t = await home(); ok(en.length >= 2 && t.includes('class="hero bnr"') && t.includes(`data-n="${en.length}"`) && JSON.stringify(titles(t)) === JSON.stringify(en) && (t.match(/<button type="button"[^>]*aria-label="第 \d+ 张"/g) || []).length === en.length, '首页轮播展示全部启用 Banner(按排序)及圆点', titles(t));
      ok(/\/static\/js\/home\.js\?v=\d+/.test(t) && !t.includes('home.css?v=9'), '首页引入轮播脚本,样式版本号已更新');
      await adm.get('/admin/banners/new');
      for (const bad of ['https://evil.example/x', 'http://evil.example', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', 'products']) {
        r = await adm.post('/admin/banners/save', { title: '外链测试', subtitle: '', image: '', link: bad, bg1: '#d4202a', bg2: '#f2a93b', sort: '9', status: '1' });
        ok(r.status === 200 && r.text.includes('仅支持站内相对路径') && !db.get("SELECT 1 FROM banners WHERE title='外链测试'"), 'Banner 保存拒绝非站内链接 ' + bad, r.status);
      }
      r = await adm.post('/admin/banners/save', { title: '站内链接测试', subtitle: '副标题', image: '', link: '/product/1?from=banner', bg1: '#d4202a', bg2: '#f2a93b', sort: '98', status: '1' }); ok(r.status === 302 && db.get("SELECT 1 FROM banners WHERE title='站内链接测试'"), 'Banner 保存接受站内相对链接');
      r = await adm.post('/admin/banners/save', { title: '无链接测试', subtitle: '', image: '', link: '', bg1: '#d4202a', bg2: '#f2a93b', sort: '99', status: '1' }); ok(r.status === 302 && db.get("SELECT link FROM banners WHERE title='无链接测试'").link === '', 'Banner 链接可留空');
      db.prepare("INSERT INTO banners(title,subtitle,link,bg1,bg2,sort,status) VALUES('旧外链测试','','https://evil.example','#d4202a','#f2a93b',100,1)").run();
      t = await home(); ok(/<div class="bnr-s[^"]*"[^>]*>[\s\S]*?<h2>无链接测试<\/h2>(?:(?!<\/div>)[\s\S])*?<\/div>/.test(t) && !/<h2>无链接测试<\/h2>[^<]*<span class="btn"/.test(t), '无链接 Banner 渲染为不可点击且无按钮');
      ok(!t.includes('evil.example') && t.includes('<h2>旧外链测试</h2>') && t.includes('href="/product/1?from=banner"'), '旧数据中的外部链接不输出到首页');
      db.prepare("DELETE FROM banners WHERE title IN ('站内链接测试','无链接测试','旧外链测试')").run();
      const keep = db.get('SELECT id FROM banners WHERE status=1 ORDER BY sort, id LIMIT 1').id, saved = db.all('SELECT id, status FROM banners');
      db.prepare('UPDATE banners SET status=CASE WHEN id=? THEN 1 ELSE 0 END').run(keep);
      t = await home(); ok(t.includes('class="hero bnr"') && !t.includes('data-n=') && !t.includes('class="bnr-d"') && (t.match(/class="bnr-s/g) || []).length === 1, '仅一个启用 Banner:单张展示,无圆点/轮播');
      db.prepare('UPDATE banners SET status=0').run();
      t = await home(); ok(!t.includes('bnr') && t.includes('<a class="hero" href="/register">') && t.includes('新人注册有礼'), '无启用 Banner:回退为固定横幅');
      const st = db.prepare('UPDATE banners SET status=? WHERE id=?'); saved.forEach(x => st.run(x.status, x.id));
      t = await home(); ok(titles(t).length === en.length, 'Banner 状态已恢复'); }
  }

  console.log('== 积分专区 v1.3:限兑/库存/并发/包邮/退回积分/周期过期/无折现比例 ==');
  { const svc = require('../lib/svc'); let x;
    // 1) 下单积分抵现默认关闭:前台无任何积分折现比例,服务端忽略 use_points
    await adm.post('/admin/settings/points', { ...PTS_SET, points_deduct_enable: '0' });
    ok(db.get("SELECT value FROM settings WHERE key='points_deduct_enable'").value === '0', '积分抵现关闭(默认值 0)');
    const sku = db.get('SELECT s.* FROM skus s JOIN products p ON p.id=s.product_id WHERE p.status=1 AND p.supplier IS NULL AND s.stock>5 AND s.price>=50 LIMIT 1');
    x = await a.post('/checkout', { sku_id: sku.id, qty: 1 }); ok(x.text.includes('确认订单') && !x.text.includes('积分抵扣') && !/积分抵\s*¥|可抵\s*¥|积分可抵/.test(x.text), '结算页无积分抵扣/折现比例');
    const qx = JSON.parse((await a.post('/api/quote', { items: itemsRaw(x.text), address_id: addr, use_points: '500' }, { json: true })).text); ok(qx.ok && qx.pointsDiscount === 0 && qx.pointsUsed === 0 && qx.maxPoints === 0, '关闭时服务端忽略 use_points', JSON.stringify(qx));
    for (const pth of ['/', '/products', '/product/' + sku.product_id, '/me/points', '/points-mall']) { x = await a.get(pth); ok(!/积分可抵|可抵\s*¥|积分\s*=\s*¥|积分抵\s*¥/.test(x.text), '前台无积分折现比例 ' + pth); }
    // 2) 积分专区列表/详情:金色积分标签 + 包邮,按钮「立即兑换」,演示标记,无金额/退换说明
    x = await a.get('/points-mall');
    ok(x.text.includes('class="pm-ptag">3000 积分') && x.text.includes('class="pm-ship">包邮') && x.text.includes('立即兑换') && x.text.includes('class="tag demo">演示'), '积分专区卡片:金色「xxx 积分」+「包邮」+「立即兑换」+演示标记');
    const grid = x.text.slice(x.text.indexOf('class="grid"')); ok(!/¥|退换|无理由/.test(grid), '积分商品卡片无金额、无退换说明');
    ok(!x.text.includes('pm-banner') && !x.text.includes('points_mall_banner') && !x.text.includes('设计稿待提供') && x.text.includes('class="pm-head"') && x.text.includes('#9e1712'), '积分专区:无顶部横幅/占位,顶部一行「我的积分 · 去签到」(朱红金)');
    const demoGoods = db.all('SELECT g.*, c.name cn, pc.name pn FROM points_goods g LEFT JOIN categories c ON c.id=g.category_id LEFT JOIN categories pc ON pc.id=c.parent_id');
    const CC = require('../lib/suppliers/jdvop/compliance');
    ok(demoGoods.length >= 6 && demoGoods.every(g => g.is_demo === 1) && demoGoods.every(g => g.type === 'coupon' || (g.category_id && !CC.scopeWarning([g.pn, g.cn]))) && demoGoods.some(g => g.pn === '新鲜农产品') && demoGoods.some(g => g.pn === '数码电脑') && demoGoods.some(g => g.type === 'coupon'), '演示积分商品均在经营范围(数码配件/新鲜农产品/优惠券)并标记演示');
    const mango = demoGoods.find(g => g.pn === '新鲜农产品');
    x = await a.get('/points-mall/' + mango.id); ok(x.text.includes('积分兑换') && x.text.includes('包邮') && x.text.includes('class="pg-notice">积分兑换商品非质量问题不退不换') && !/无理由/.test(x.text), '兑换确认页:积分兑换按钮、包邮、兑换须知小字,无退换标记');
    ok(x.text.includes('每人限兑 1 件') && x.text.includes('class="pg-left">1<'), '兑换确认页显示每人限兑及剩余可兑');
    await adm.post('/admin/settings/points', { ...PTS_SET, points_redeem_notice: '' }); x = await a.get('/points-mall/' + mango.id); ok(!x.text.includes('class="pg-notice"'), '兑换须知清空后不显示');
    await adm.post('/admin/settings/points', { ...PTS_SET });
    // 3) 后台新增积分商品:图片上传、限兑、分类经营范围提示(不拦截)
    x = await adm.get('/admin/points-goods/new'); ok(x.text.includes('800×800') && x.text.includes('每人限兑') && !/name="(shipping_fee|returnable|return_note)"/.test(x.text), '后台表单:方图≥800 提示、每人限兑;无运费/退换字段');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const subCat = db.get("SELECT id FROM categories WHERE name='手机配件'").id;
    const fd = (o, file) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, String(v)); if (file) f.append('image_file', new Blob([png], { type: 'image/png' }), 'a.png'); return f; };
    x = await adm.post('/admin/points-goods/save', fd({ name: '回归测试数据线', image: '', points: 10, type: 'goods', coupon_id: 0, category_id: subCat, stock: 5, per_user_limit: 1, description: '', sort: 99, status: 1 }, true), { form: true });
    const tg = db.get("SELECT * FROM points_goods WHERE name='回归测试数据线'"); ok(x.status === 302 && tg && /^\/uploads\/.+\.png$/.test(tg.image) && tg.per_user_limit === 1, '后台新增积分商品:图片上传成功、限兑已保存', tg && tg.image);
    x = await adm.get('/admin/points-goods'); ok(x.text.includes('积分商品已保存') && !x.text.includes('不影响保存'), '范围内分类无经营范围提示');
    const badCat = db.exec1("INSERT INTO categories(name,parent_id,sort,status) VALUES('服饰鞋包',0,99,0)").lastInsertRowid;
    await adm.get('/admin/points-goods/new'); x = await adm.post('/admin/points-goods/save', fd({ name: '回归范围外礼品', image: '', points: 10, type: 'goods', coupon_id: 0, category_id: badCat, stock: 1, per_user_limit: 0, description: '', sort: 99, status: 0 }), { form: true });
    x = await adm.get('/admin/points-goods'); ok(db.get("SELECT 1 FROM points_goods WHERE name='回归范围外礼品'") && x.text.includes('不影响保存') && x.text.includes('经营范围'), '范围外分类:保存成功并提示(复用 scopeWarning)');
    db.exec1("DELETE FROM points_goods WHERE name='回归范围外礼品'"); db.exec1('DELETE FROM categories WHERE id=?', badCat);
    // 4) 每人限兑 + 取消退回积分/库存/名额
    db.exec1('UPDATE users SET points=points+5000 WHERE id=2');
    let p0 = db.get('SELECT points FROM users WHERE id=2').points;
    x = await a.post('/points-mall/' + tg.id + '/exchange'); const toid = +(x.loc.match(/order\/(\d+)/) || [])[1];
    const to = db.get('SELECT * FROM orders WHERE id=?', toid);
    ok(to && to.type === 'points' && to.freight === 0 && to.pay_amount === 0 && to.points_goods_id === tg.id && db.get('SELECT points FROM users WHERE id=2').points === p0 - 10, '兑换成功:包邮(运费 0)、扣 10 积分、生成兑换单');
    x = await a.post('/points-mall/' + tg.id + '/exchange', {}); const ff = await a.get(x.loc); ok(ff.text.includes('每人限兑 1 件') && db.get('SELECT stock FROM points_goods WHERE id=?', tg.id).stock === 4, '超过每人限兑被拒(服务端校验)');
    x = await a.get('/points-mall/' + tg.id); ok(x.text.includes('已达兑换上限'), '达上限后按钮显示「已达兑换上限」');
    await adm.post('/admin/orders/' + toid + '/cancel', { reason: '回归测试' });
    ok(db.get('SELECT status FROM orders WHERE id=?', toid).status === 'refunded' && db.get('SELECT points FROM users WHERE id=2').points === p0 && db.get('SELECT stock FROM points_goods WHERE id=?', tg.id).stock === 5, '兑换单退款:积分退回、库存回补');
    ok(svc.redeemedCount(2, tg.id) === 0, '已退款兑换不计入限兑次数');
    x = await a.post('/points-mall/' + tg.id + '/exchange'); ok(/\/order\/\d+/.test(x.loc || ''), '退款后可再次兑换');
    // 5) 库存 0:已兑完、禁止兑换
    db.exec1("UPDATE points_goods SET stock=1, per_user_limit=0 WHERE id=?", tg.id);
    x = await b.post('/points-mall/' + tg.id + '/exchange'); ok(db.get('SELECT stock FROM points_goods WHERE id=?', tg.id).stock === 0, '最后一件兑出,库存为 0');
    x = await a.get('/points-mall'); const soldIdx = x.text.indexOf('回归测试数据线'); ok(soldIdx > 0 && x.text.lastIndexOf('pm-so', soldIdx) > x.text.lastIndexOf('class="pcard', soldIdx) - 1 && /回归测试数据线[\s\S]{0,700}已兑完/.test(x.text), '列表标「已兑完」');
    p0 = db.get('SELECT points FROM users WHERE id=2').points; x = await a.post('/points-mall/' + tg.id + '/exchange', {}, { json: true }); ok(JSON.parse(x.text).ok === false && JSON.parse(x.text).msg === '已兑完' && db.get('SELECT points FROM users WHERE id=2').points === p0, '库存 0 时兑换被拒且不扣积分');
    x = await a.get('/points-mall/' + tg.id); ok(x.text.includes('disabled>已兑完'), '详情页按钮「已兑完」禁用');
    // 6) 并发:库存 3,同时 30 个兑换请求 → 恰好 3 个成功,不超兑
    db.exec1("UPDATE points_goods SET stock=3, exchanged=0 WHERE id=?", tg.id); db.exec1('UPDATE users SET points=points+1000 WHERE id IN (2,3)');
    const maxO = db.get('SELECT MAX(id) m FROM orders').m, pa = db.get('SELECT points FROM users WHERE id=2').points, pb = db.get('SELECT points FROM users WHERE id=3').points;
    const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? a : b).post('/points-mall/' + tg.id + '/exchange', {}, { json: true }).then(r => JSON.parse(r.text))));
    const succ = rs.filter(r => r.ok).length, g3 = db.get('SELECT stock, exchanged FROM points_goods WHERE id=?', tg.id);
    ok(succ === 3 && g3.stock === 0 && g3.exchanged === 3, '并发 30 次兑换:成功 3 次,库存 0,无超兑', JSON.stringify({ succ, g3 }));
    ok((pa - db.get('SELECT points FROM users WHERE id=2').points) + (pb - db.get('SELECT points FROM users WHERE id=3').points) === 30 && db.get('SELECT COUNT(*) n FROM orders WHERE points_goods_id=? AND id>?', tg.id, maxO).n === 3, '并发:仅成功的 3 次扣积分并生成订单');
    // 7) 积分专区横幅已移除:后台无上传项,上传字段被忽略
    const bf = new FormData(); for (const [k, v] of Object.entries(PTS_SET)) bf.append(k, v); bf.append('points_mall_banner_file', new Blob([png], { type: 'image/png' }), 'banner.png');
    x = await adm.get('/admin/settings'); ok(!x.text.includes('points_mall_banner'), '后台设置无积分专区横幅上传项');
    x = await adm.post('/admin/settings/points', { ...PTS_SET, points_clear_day: '13-01' }); ok(db.get("SELECT value FROM settings WHERE key='points_clear_day'").value === '06-01', '清零日格式校验');
    // 8) 周期过期:跨 6/1 边界
    const E = svc.cycleExpireAt;
    ok(E('2026-05-31 23:59:59', '06-01') === '2027-05-31 23:59:59' && E('2026-06-01 00:00:00', '06-01') === '2028-05-31 23:59:59' && E('2027-05-31 23:59:59', '06-01') === '2028-05-31 23:59:59' && E('2027-06-01 00:00:00', '06-01') === '2029-05-31 23:59:59', '周期过期:6/1 前后分属不同周期(5/31→次年 5/31,6/1→后年 5/31)');
    ok(E('2026-03-15 10:00:00', '03-01') === '2028-02-29 23:59:59' && E('2026-02-28 10:00:00', '03-01') === '2027-02-28 23:59:59' && E('2027-03-01 00:00:00', '03-01') === '2029-02-28 23:59:59', '清零日可配置(03-01 跨闰年计算正确)');
    const cu = db.get("SELECT id FROM users WHERE phone='13800000003'").id; svc.addPoints(cu, 77, '回归测试获得');
    const cl = db.get("SELECT * FROM point_lots WHERE user_id=? ORDER BY id DESC LIMIT 1", cu); ok(cl && cl.kind === 'cycle' && cl.remaining === 77 && cl.expire_at === E(cl.created_at, '06-01'), '获得积分记入周期批次并按清零日计算到期');
    db.exec1("UPDATE point_lots SET expire_at='2000-05-31 23:59:59' WHERE id=?", cl.id); const bp = db.get('SELECT points FROM users WHERE id=?', cu).points; svc.expirePointLots();
    ok(db.get('SELECT points FROM users WHERE id=?', cu).points === bp - 77 && db.get('SELECT remaining FROM point_lots WHERE id=?', cl.id).remaining === 0, '到期批次自动清零');
    const soon = require('../lib/util').offset(20 * 86400000).slice(0, 10) + ' 23:59:59';
    svc.addPoints(cu, 66, '回归提醒'); const rl = db.get("SELECT id FROM point_lots WHERE user_id=? ORDER BY id DESC LIMIT 1", cu).id; db.exec1('UPDATE point_lots SET expire_at=? WHERE id=?', soon, rl);
    x = await b.get('/me/points'); const md = `${+soon.slice(5, 7)}月${+soon.slice(8, 10)}日`; ok(x.text.includes(`66积分将于${md}过期`), '积分页显示「xxx积分将于x月x日过期」', md);
    const m0 = db.get('SELECT COUNT(*) n FROM messages WHERE user_id=?', cu).n; const sent = svc.remindExpiringPoints();
    ok(sent.some(s => s.uid === cu && s.n === 66) && db.get('SELECT COUNT(*) n FROM messages WHERE user_id=?', cu).n === m0 + 1 && db.get("SELECT content FROM messages WHERE user_id=? ORDER BY id DESC", cu).content.includes(`66 积分将于 ${md}过期`), '到期前 30 天站内消息提醒');
    svc.remindExpiringPoints(); ok(db.get('SELECT COUNT(*) n FROM messages WHERE user_id=?', cu).n === m0 + 1, '提醒不重复发送');
    ok(svc.wechatSubscribeNotify(cu, 'points_expire', {}).stub === true, '微信订阅消息桩函数存在(待接入)');
    x = await b.get('/points-rules'); ok(x.text.includes('6 月 1 日') && !x.text.includes('= ¥1'), '积分规则:6/1 清零规则,无折现比例');
    // 会话持久:登录会员多页跳转后「我的」仍为登录态;Cookie 为 rolling 30 天;HTML 不缓存
    let still = true; for (const u of ['/', '/products', '/points-mall', '/cart', '/orders', '/me/points', '/product/9', '/service', '/me/coupons', '/help', '/me/favorites', '/activity', '/me']) { const y = await b.get(u); if (y.status !== 200 || y.text.includes('href="/login"') && !y.text.includes('href="/me"')) { still = false; break; } }
    x = await b.get('/me'); ok(still && x.status === 200 && x.text.includes('在线客服') && !x.text.includes('>去登录<'), '会员多页跳转后进入「我的」仍为登录态');
    const sraw = await fetch(base + '/', { headers: { cookie: b.cookie || '' } }).catch(() => null);
    const row = db.all("SELECT expire FROM sessions WHERE sid LIKE 's:%' ORDER BY expire DESC LIMIT 1")[0]; ok(row && row.expire > Date.now() + 29 * 86400000, '前台会话 30 天有效期(SQLite 持久化,rolling 续期)');
    ok(/no-store/.test((sraw && sraw.headers.get('cache-control')) || ''), '前台 HTML 不缓存(避免返回缓存显示未登录旧页)');
    ok(x.text.includes('class="me-kf" data-mp-open-type="contact" href="/service"'), '「我的」常用功能含「在线客服」入口');
    x = await b.get('/product/9'); ok(x.text.includes('class="pd-kf"') && x.text.includes('data-mp-open-type="contact"'), '商品详情底栏「客服」入口(含小程序 open-type=contact 预留)');
    x = await b.get('/service'); ok(x.text.includes('400-888-6666(演示)') && x.text.includes('yunnong-kefu(演示)') && x.text.includes('id="chatList"') && x.text.includes('class="chat-bar"'), '联系客服页:电话/微信号(演示)+在线对话');
    // 在线客服:图片上传(有效/超限/错误类型/超过 3 张/未登录)、订单卡片、管理员图片回复、180 天自动删除
    { const chat = require('../lib/chat'), fs = require('fs'), path = require('path');
      const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1), Buffer.from([0xff, 0xd9])]);
      const fd = (...bufs) => { const f = new FormData(); bufs.forEach((x, i) => f.append('images', new Blob([x.b], { type: x.t || 'image/png' }), x.n || 'a' + i + '.png')); return f; };
      const bid = db.get("SELECT id FROM users WHERE phone='13800000003'").id;
      await b.get('/service'); const H = { 'x-csrf-token': b.t, 'X-Requested-With': 'fetch' };
      const n0 = db.get("SELECT COUNT(*) n FROM messages WHERE user_id=? AND kind='image'", bid).n;
      let y = await b.req('POST', '/service/image', fd({ b: PNG }, { b: JPG, t: 'image/jpeg', n: 'b.jpg' }), { form: true, json: true, h: H });
      const im = db.get("SELECT * FROM messages WHERE user_id=? AND kind='image' ORDER BY id DESC LIMIT 1", bid); const urls = im ? JSON.parse(im.payload).images : [];
      ok(y.status === 200 && urls.length === 2 && urls.every(u => fs.existsSync(path.join(__dirname, '..', 'public', u.replace(/^\/static\//, '').replace(/^\//, ''))) || fs.existsSync(path.join(chat.DIR, path.basename(u)))), '客服:上传有效 PNG/JPEG 图片(保存至 uploads)', y.status + y.text.slice(0, 80));
      y = await b.req('POST', '/service/image', fd({ b: Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024 + 10)]) }), { form: true, json: true, h: H }); ok(y.status === 413 && y.text.includes('5MB'), '客服:单张超过 5MB 被拒(413)', y.status);
      y = await b.req('POST', '/service/image', fd({ b: Buffer.from('hello, not an image'), n: 'fake.png' }), { form: true, json: true, h: H }); ok(y.status === 400 && y.text.includes('仅支持'), '客服:伪装扩展名的非图片被拒(校验文件头)', y.status);
      y = await b.req('POST', '/service/image', fd({ b: PNG }, { b: PNG }, { b: PNG }, { b: PNG }), { form: true, json: true, h: H }); ok(y.status === 400 && y.text.includes('3 张'), '客服:一次超过 3 张被拒', y.status);
      ok(db.get("SELECT COUNT(*) n FROM messages WHERE user_id=? AND kind='image'", bid).n === n0 + 1, '客服:被拒的上传不产生消息');
      const anon = new C(); await anon.get('/service'); y = await anon.req('POST', '/service/image', fd({ b: PNG }), { form: true, json: true, h: { 'x-csrf-token': anon.t } }); ok(y.status === 403, '客服:未登录不可上传图片', y.status);
      y = await b.req('POST', '/service/image', fd({ b: PNG }), { form: true, json: true, h: { 'X-Requested-With': 'fetch' } }); ok(y.status === 403, '客服:无 CSRF 令牌的上传被拒', y.status);
      const myo = db.get('SELECT id, order_no FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 1', bid), other = db.get('SELECT id FROM orders WHERE user_id<>? LIMIT 1', bid);
      if (myo) { y = await b.req('POST', '/service/order', { order_id: String(myo.id) }, { json: true, h: H }); x = await b.get('/service'); ok(y.status === 200 && x.text.includes('class="cord"') && x.text.includes(myo.order_no), '客服:发送订单卡片', y.status); }
      if (other) { const k = db.get("SELECT COUNT(*) n FROM messages WHERE kind='order'").n; await b.req('POST', '/service/order', { order_id: String(other.id) }, { json: true, h: H }); ok(db.get("SELECT COUNT(*) n FROM messages WHERE kind='order'").n === k, '客服:不能发送他人订单'); }
      x = await b.get('/service'); ok(x.text.includes('自动回复') && x.text.includes('cimg') && x.text.includes('chip-q'), '客服页:自动回复标签/图片缩略图/快捷问题', [x.text.includes('自动回复'), x.text.includes('cimg'), x.text.includes('chip-q'), x.status]);
      ok(db.get("SELECT COUNT(*) n FROM messages WHERE sender='staff' AND content='您好,订单将在24小时内为您安排发货哦~'").n === 0, '「24 小时发货」提示按自动回复(bot)发送');
      const af = new FormData(); af.append('content', '收到图片,已为您登记'); af.append('images', new Blob([PNG], { type: 'image/png' }), 'r.png');
      await adm.get('/admin/service?uid=' + bid); y = await adm.req('POST', '/admin/service/' + bid + '/reply', af, { form: true });
      const sm = db.get("SELECT * FROM messages WHERE user_id=? AND sender='staff' AND kind='image' ORDER BY id DESC LIMIT 1", bid);
      x = await adm.get('/admin/service?uid=' + bid); ok(y.status === 302 && sm && JSON.parse(sm.payload).images.length === 1 && x.text.includes(JSON.parse(sm.payload).images[0]) && x.text.includes('自动回复') && (!myo || x.text.includes('/admin/orders/' + myo.id)), '管理员:图片回复 + 后台显示会员图片/订单卡片链接', y.status);
      const bf = new FormData(); bf.append('images', new Blob([Buffer.from('nope')], { type: 'image/png' }), 'x.png'); const k2 = db.get('SELECT COUNT(*) n FROM messages').n;
      await adm.req('POST', '/admin/service/' + bid + '/reply', bf, { form: true }); ok(db.get('SELECT COUNT(*) n FROM messages').n === k2, '管理员:非图片文件回复被拒');
      // 180 天保存期:最后一条消息超过 180 天的会话图片被删除,近期会话保留
      const old = db.get("SELECT id FROM users WHERE id<>? ORDER BY id LIMIT 1", bid).id, sv = chat.saveImages([PNG]);
      db.exec1('DELETE FROM messages WHERE user_id=?', old);
      db.exec1("INSERT INTO messages (user_id, sender, kind, content, payload, created_at) VALUES (?, 'user', 'image', '[图片×1]', ?, ?)", old, JSON.stringify({ images: sv.urls }), require('../lib/util').offset(-181 * 86400000));
      const fp = path.join(chat.DIR, path.basename(sv.urls[0])); const had = fs.existsSync(fp);
      chat.purgeImages();
      const om = db.get('SELECT * FROM messages WHERE user_id=?', old), rm2 = db.get('SELECT payload FROM messages WHERE id=?', im.id);
      ok(had && !fs.existsSync(fp) && om.payload === null && rm2.payload && fs.existsSync(path.join(chat.DIR, path.basename(urls[0]))), '客服图片:会话结束 180 天后自动删除,近期会话保留');
      x = await b.get('/privacy'); ok(x.text.includes('售后图片'), '隐私政策含「售后图片」条目');
    }
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
