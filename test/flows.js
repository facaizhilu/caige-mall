// 进阶流程测试:拼团成团/失败、秒杀下单、优惠券+积分抵扣、客服创建售后+积分/现金按比例退款、前台禁止上传
const base = process.argv[2] || 'http://localhost:' + (process.env.PORT || 3000);
const db = require('../lib/db');
let pass = 0, fail = 0;
const ok = (c, n, x) => { c ? (pass++, console.log('  ✔', n)) : (fail++, console.log('  ✘', n, x || '')); };
class C { constructor() { this.k = {}; this.t = ''; }
  async req(m, p, body, o = {}) { const h = { Cookie: Object.entries(this.k).map(([a, b]) => a + '=' + b).join('; ') }; let b; if (body && !o.form) { b = new URLSearchParams({ _csrf: this.t, ...body }).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; } if (o.form) { body.append('_csrf', this.t); b = body; } if (o.json) h.Accept = 'application/json';
    const r = await fetch(base + p, { method: m, headers: h, body: b, redirect: 'manual' }); for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.k[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await r.text(); const mm = text.match(/name="csrf" content="([0-9a-f]+)"/) || text.match(/name="_csrf" value="([0-9a-f]+)"/); if (mm) this.t = mm[1]; return { status: r.status, loc: r.headers.get('location'), text }; }
  get(p) { return this.req('GET', p); } post(p, b, o) { return this.req('POST', p, b || {}, o); }
  async login(phone, pw) { await this.get('/login'); const r = await this.post('/login', { phone, password: pw }); const c = await this.get('/consent'); if (c.status === 200) await this.post('/consent', { agree: '1', next: '/' }); await this.get('/'); return r; } }
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
  const goid = r.loc.match(/order\/(\d+)/)[1]; await b.post('/order/' + goid + '/pay', { method: 'wechat' });
  const g2 = db.get('SELECT * FROM orders WHERE id=?', goid); ok(g2.status === 'paid' || g2.status === 'unpaid', '开团订单创建并支付');
  if (g2.status === 'unpaid') { await b.post('/order/' + goid + '/pay', { method: 'wechat' }); }
  const gg = db.get('SELECT group_id FROM orders WHERE id=?', goid).group_id; db.prepare("UPDATE groups SET expire_at='2000-01-01 00:00:00' WHERE id=?").run(gg);
  require('../lib/svc').expireGroups();
  ok(db.get('SELECT status FROM groups WHERE id=?', gg).status === 'failed' && db.get('SELECT status FROM orders WHERE id=?', goid).status === 'refunded', '超时未成团自动失败并退款');
  console.log('== 秒杀 ==');
  const sk = db.get('SELECT * FROM seckills WHERE id=2');
  r = await a.post('/checkout', { sku_id: sk.sku_id, qty: 3, promo_type: 'seckill', promo_id: sk.id }); ok(r.status === 302 && r.loc, '超过限购被拒(限2)');
  r = await a.post('/checkout', { sku_id: sk.sku_id, qty: 1, promo_type: 'seckill', promo_id: sk.id }); ok(r.text.includes('确认订单') && r.text.includes('19.9'), '秒杀价结算');
  const before = db.get('SELECT sold FROM seckills WHERE id=2').sold;
  r = await a.post('/order/create', { items: itemsRaw(r.text), promo_type: 'seckill', promo_id: sk.id, address_id: addr, no7_confirm: '1' }); const soid = r.loc.match(/order\/(\d+)/)[1];
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
