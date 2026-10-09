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
    ok2(cloud.extraForStreak(1) === 25 && cloud.extraForStreak(2) === 27 && cloud.extraForStreak(3) === 29 && cloud.extraForStreak(40) === 103, '云商卡签到加赠:25、27、29……逐日递增');
    db.prepare("DELETE FROM signins WHERE user_id=1 AND day=?").run(U2.today());
    let tot = 0; for (let i = 0; i < 5; i++) tot += cloud.signinExtra(1, svc.addPoints, 30); ok2(tot === 5 * 83, '云商卡签到加赠不设每月上限', tot);
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
    if (skPre) { r = await c1.get('/product/' + skPre.product_id); ok2(r.text.includes('秒杀价 <b style="color:var(--red)">¥' + skPre.price + '</b>') && r.text.includes('开抢') && !r.text.includes(' 秒杀价,每人限购'), 'G4:秒杀未开始时显示「秒杀价 ¥x,开抢时间」'); }
    // G1 / D1
    r = await c1.get('/'); ok2(r.text.includes('普通商品满99元包邮(大件、偏远地区除外') && !r.text.includes('全场满99'), 'G1:包邮口径更新');
    r = await c1.get('/notices'); ok2(!r.text.includes('积分翻倍'), 'D1:积分翻倍公告已下线');
    ok2(['全国联保', '假一赔十', '财哥严选'].every(w => require('../lib/banned').words().includes(w)), 'G6:违禁词表含全国联保/假一赔十/财哥严选');
    // 协议
    ok2(svc.S('policy_version') === '1.1', '协议版本 1.1');
    r = await c1.get('/privacy'); ok2(['商品供应商', '第三方 SDK 与服务清单', '评价内容(文字、星级评分)', '账号密码(加密存储)', '成长值、会员等级、优惠券', '【公司全称】', '【联系邮箱】', '【生效日期】', '版本号:1.1'].every(x => r.text.includes(x)), '隐私政策补充 A2/A3/A4/A11,保留占位符');
    r = await c1.get('/terms'); ok2(r.text.includes('勾选同意,即表示') && !r.text.includes('注册、登录或使用本平台,即表示'), 'B1:用户协议不再默示同意');
    r = await new C().get('/login'); ok2(!r.text.includes('登录即表示') && r.text.includes('首次注册或协议更新时'), 'B1:登录页文案');
    r = await c1.get('/points-rules'); ok2(r.text.includes('与评分高低无关') && r.text.includes('不设每日或每月上限') && !r.text.includes('{{'), '积分规则:评价积分与云商卡递增加赠');
    r = await c1.get('/me/cloud'); ok2(r.text.includes('25、27、29') && !r.text.includes('每月最多'), '云商卡页:递增加赠说明');
    // A1:性别不再保存
    db.prepare("UPDATE users SET gender='保密' WHERE id=1").run();
    await c1.get('/me/profile'); await c1.post('/me/profile', { nickname: '财哥粉丝', gender: '男' }); ok2(db.get('SELECT gender FROM users WHERE id=1').gender === '保密', 'A1:提交 gender 不被保存');
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

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
