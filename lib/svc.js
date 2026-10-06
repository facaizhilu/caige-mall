// 业务服务层:积分/余额/成长值、运费、下单、支付、取消、退款、完成、拼团、分销等
const db = require('./db');
const U = require('./util');
const { now, round2, int } = U;

const DEFAULT_SETTINGS = {
  shop_name: '财哥商城', slogan: '好货不贵,财源广进', announcement: '🎉 财哥商城开业大吉!新人注册即送积分与优惠券,全场满99元包邮',
  service_phone: '400-888-6666', service_hours: '每日 9:00 - 22:00', service_email: 'help@caige-mall.example', address: '广东省深圳市南山区科技园财哥大厦 18 层',
  icp: '粤ICP备00000000号(演示)', points_rate: '100', points_max_percent: '50', commission_rate: '5', signin_base: '5', stock_warn: '10',
  unpaid_cancel_minutes: '30', auto_confirm_days: '7', aftersale_days: '7', register_points: '100', review_points: '10', referral_points: '50',
  cloud_daily_points: '10', cloud_referral_pct_silver: '5', cloud_referral_pct_gold: '8',
  cloud_referral_enable_silver: '1', cloud_referral_enable_gold: '1',
  cloud_push3_pct: '30', cloud_push3_mode: 'per_third',
  cloud_redeem_label: '权益值', cloud_redeem_ratio: '100', cloud_redeem_min: '100'
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);
let _settings = null;
const settings = () => { if (!_settings) { _settings = {}; for (const r of db.all('SELECT * FROM settings')) _settings[r.key] = r.value; } return _settings; };
const setSetting = (k, v) => { db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k, String(v)); _settings = null; };
const S = (k) => settings()[k];

function addPoints(uid, delta, reason) {
  const u = db.get('SELECT points FROM users WHERE id=?', uid); if (!u) return false;
  const nb = Math.max(0, u.points + delta);
  db.exec1('UPDATE users SET points=? WHERE id=?', nb, uid);
  db.exec1('INSERT INTO points_log(user_id,delta,balance,reason,created_at) VALUES(?,?,?,?,?)', uid, nb - u.points, nb, reason, now());
  return true;
}
function addBalance(uid, delta, type, remark) {
  const u = db.get('SELECT balance FROM users WHERE id=?', uid); if (!u) return false;
  const nb = round2(u.balance + delta);
  if (nb < 0) return false;
  db.exec1('UPDATE users SET balance=? WHERE id=?', nb, uid);
  db.exec1('INSERT INTO balance_log(user_id,delta,balance,type,remark,created_at) VALUES(?,?,?,?,?,?)', uid, round2(delta), nb, type, remark, now());
  return true;
}
function refreshLevel(uid) {
  const u = db.get('SELECT growth FROM users WHERE id=?', uid);
  const lv = db.get('SELECT id FROM member_levels WHERE min_growth<=? ORDER BY min_growth DESC LIMIT 1', u.growth);
  if (lv) db.exec1('UPDATE users SET level_id=? WHERE id=?', lv.id, uid);
}
function addGrowth(uid, n) { db.exec1('UPDATE users SET growth=MAX(0,growth+?) WHERE id=?', n, uid); refreshLevel(uid); }
function genInviteCode() { for (;;) { const c = U.randCode(6); if (!db.get('SELECT 1 FROM users WHERE invite_code=?', c)) return c; } }

function createUser({ phone, password_hash, nickname, referrerCode }) {
  const ref = referrerCode ? db.get('SELECT id FROM users WHERE invite_code=?', referrerCode) : null;
  const r = db.exec1('INSERT INTO users(phone,password_hash,nickname,invite_code,referrer_id,created_at,last_login) VALUES(?,?,?,?,?,?,?)',
    phone, password_hash, nickname || '会员' + phone.slice(-4), genInviteCode(), ref ? ref.id : null, now(), now());
  const id = r.lastInsertRowid;
  const rp = int(S('register_points'));
  if (rp) addPoints(id, rp, '注册奖励');
  if (ref) addPoints(ref.id, int(S('referral_points')), '邀请好友注册奖励(' + U.maskPhone(phone) + ')');
  // 新人券
  for (const c of db.all("SELECT id FROM coupons WHERE status=1 AND name LIKE '新人%'")) grantCoupon(id, c.id, true);
  return id;
}

// ---------- 优惠券 ----------
function grantCoupon(uid, couponId, force) {
  const c = db.get('SELECT * FROM coupons WHERE id=? AND status=1', couponId);
  if (!c) return { ok: false, msg: '优惠券不存在或已下架' };
  if (!force) {
    if (c.claimed >= c.total) return { ok: false, msg: '优惠券已被领完' };
    const mine = db.get('SELECT COUNT(*) n FROM user_coupons WHERE user_id=? AND coupon_id=?', uid, couponId).n;
    if (mine >= c.per_limit) return { ok: false, msg: '已达到领取上限' };
  }
  db.exec1('INSERT INTO user_coupons(user_id,coupon_id,expire_at,created_at) VALUES(?,?,?,?)', uid, couponId, U.offset(c.valid_days * 86400000).slice(0, 10) + ' 23:59:59', now());
  db.exec1('UPDATE coupons SET claimed=claimed+1 WHERE id=?', couponId);
  return { ok: true, msg: '领取成功' };
}
function userCoupons(uid, status) {
  const t = now();
  let rows = db.all(`SELECT uc.*, c.name, c.threshold, c.amount, c.category_id, c.description FROM user_coupons uc JOIN coupons c ON c.id=uc.coupon_id WHERE uc.user_id=? ORDER BY uc.id DESC`, uid);
  rows.forEach(r => { r.state = r.status === 'used' ? 'used' : (r.expire_at < t ? 'expired' : 'unused'); });
  return status ? rows.filter(r => r.state === status) : rows;
}

// ---------- 运费 ----------
function parseRules(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
function calcFreight(lines, province) {
  // lines: [{template_id, amount}]
  const groups = {};
  for (const l of lines) groups[l.template_id || 1] = (groups[l.template_id || 1] || 0) + l.amount;
  let total = 0;
  for (const [tid, amt] of Object.entries(groups)) {
    const t = db.get('SELECT * FROM shipping_templates WHERE id=?', tid) || db.get('SELECT * FROM shipping_templates ORDER BY id LIMIT 1');
    if (!t) continue;
    if (t.free_over > 0 && amt >= t.free_over) continue;
    const r = parseRules(t.rules);
    let fee = +r.base || 0;
    if (province && r.remote_provinces && String(r.remote_provinces).split(/[,,、\s]+/).includes(province)) fee = +r.remote_fee || fee;
    total += fee;
  }
  return round2(total);
}

// ---------- 秒杀 / 拼团 ----------
function activeSeckill(id) {
  const t = now();
  return db.get('SELECT * FROM seckills WHERE id=? AND status=1 AND start_at<=? AND end_at>=?', id, t, t);
}
function expireGroups() {
  const rows = db.all("SELECT * FROM groups WHERE status='open' AND expire_at<?", now());
  for (const g of rows) {
    db.transaction(() => {
      db.exec1("UPDATE groups SET status='failed' WHERE id=?", g.id);
      for (const m of db.all('SELECT order_id FROM group_members WHERE group_id=?', g.id)) refundOrder(m.order_id, '拼团失败自动退款', true);
    })();
  }
}

// ---------- 下单 ----------
// opts: {items:[{sku_id,qty}], address:{...}, couponId, usePoints, promo:{type,id,groupId}, remark, preview}
function quote(uid, opts) {
  const user = db.get('SELECT * FROM users WHERE id=?', uid);
  const lines = []; let err = null;
  const promo = opts.promo || null;
  let seckill = null, groupbuy = null;
  if (promo && promo.type === 'seckill') { seckill = activeSeckill(promo.id); if (!seckill) return { error: '秒杀活动未开始或已结束' }; }
  if (promo && promo.type === 'group') {
    groupbuy = db.get('SELECT * FROM groupbuys WHERE id=? AND status=1', promo.id); if (!groupbuy) return { error: '拼团活动不存在' };
    if (promo.groupId) {
      const g = db.get('SELECT * FROM groups WHERE id=?', promo.groupId);
      if (!g || g.status !== 'open' || g.expire_at < now() || g.joined >= g.need) return { error: '该团已结束或已满员' };
      if (db.get('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', g.id, uid)) return { error: '您已在该团中' };
    }
  }
  for (const it of opts.items) {
    const qty = Math.max(1, int(it.qty, 1));
    const sku = db.get('SELECT s.*, p.name pname, p.images, p.status pstatus, p.template_id, p.category_id, p.id pid FROM skus s JOIN products p ON p.id=s.product_id WHERE s.id=?', it.sku_id);
    if (!sku || !sku.pstatus) { err = '商品已下架或不存在'; break; }
    if (sku.stock < qty) { err = `「${sku.pname}」库存不足(仅剩${sku.stock}件)`; break; }
    let price = sku.price;
    if (seckill) {
      if (seckill.sku_id !== sku.id) { err = '秒杀商品不匹配'; break; }
      if (seckill.stock - seckill.sold < qty) { err = '秒杀商品已抢光'; break; }
      const bought = db.get("SELECT COALESCE(SUM(oi.qty),0) n FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.user_id=? AND o.type='seckill' AND o.promo_id=? AND o.status NOT IN ('cancelled','refunded')", uid, seckill.id).n;
      if (bought + qty > seckill.limit_per_user) { err = `该秒杀商品每人限购${seckill.limit_per_user}件`; break; }
      price = seckill.price;
    }
    if (groupbuy) { if (groupbuy.sku_id !== sku.id) { err = '拼团商品不匹配'; break; } price = groupbuy.price; }
    lines.push({ sku_id: sku.id, product_id: sku.pid, name: sku.pname, spec_text: sku.spec_text, image: U.firstImg(sku.images), price, qty, template_id: sku.template_id, category_id: sku.category_id, amount: round2(price * qty) });
  }
  if (err) return { error: err };
  if (!lines.length) return { error: '没有可结算的商品' };
  if ((seckill || groupbuy) && lines.length > 1) return { error: '活动商品需单独下单' };
  const goods = round2(lines.reduce((a, l) => a + l.amount, 0));
  const level = db.get('SELECT * FROM member_levels WHERE id=?', user.level_id) || { discount: 100 };
  const levelDiscount = (seckill || groupbuy) ? 0 : round2(goods * (100 - level.discount) / 100);
  let couponDiscount = 0, uc = null;
  if (opts.couponId && !seckill && !groupbuy) {
    uc = db.get(`SELECT uc.*, c.threshold, c.amount, c.category_id, c.name FROM user_coupons uc JOIN coupons c ON c.id=uc.coupon_id WHERE uc.id=? AND uc.user_id=? AND uc.status='unused' AND uc.expire_at>=?`, opts.couponId, uid, now());
    if (uc) {
      const elig = uc.category_id ? lines.filter(l => l.category_id === uc.category_id).reduce((a, l) => a + l.amount, 0) : goods;
      if (elig >= uc.threshold && elig > 0) couponDiscount = Math.min(uc.amount, round2(goods - levelDiscount)); else uc = null;
    }
  }
  const afterDisc = round2(goods - levelDiscount - couponDiscount);
  const rate = Math.max(1, int(S('points_rate'), 100));
  let pointsUsed = 0, pointsDiscount = 0;
  if (int(opts.usePoints) > 0 && !seckill && !groupbuy) {
    const maxByPct = Math.floor(afterDisc * int(S('points_max_percent'), 50) / 100);
    const yuan = Math.min(Math.floor(Math.min(int(opts.usePoints), user.points) / rate), maxByPct);
    pointsUsed = yuan * rate; pointsDiscount = yuan;
  }
  const freight = calcFreight(lines, opts.address ? opts.address.province : null);
  const pay = Math.max(0, round2(afterDisc - pointsDiscount + freight));
  return { lines, goods, levelDiscount, levelName: level.name, levelRate: level.discount, couponDiscount, uc, pointsUsed, pointsDiscount, freight, pay, seckill, groupbuy, user, rate, maxPoints: Math.min(user.points, Math.floor(afterDisc * int(S('points_max_percent'), 50) / 100) * rate) };
}

function createOrder(uid, opts) {
  return db.transaction(() => {
    const q = quote(uid, opts);
    if (q.error) return { ok: false, msg: q.error };
    const a = opts.address;
    if (!a) return { ok: false, msg: '请选择收货地址' };
    const no = U.orderNo();
    const type = q.seckill ? 'seckill' : q.groupbuy ? 'group' : 'normal';
    const promoId = q.seckill ? q.seckill.id : q.groupbuy ? q.groupbuy.id : null;
    const r = db.exec1(`INSERT INTO orders(order_no,user_id,type,status,goods_amount,freight,level_discount,coupon_discount,points_discount,points_used,pay_amount,receiver,phone,province,city,district,detail,remark,user_coupon_id,group_id,promo_id,created_at) VALUES(?,?,?,'unpaid',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      no, uid, type, q.goods, q.freight, q.levelDiscount, q.couponDiscount, q.pointsDiscount, q.pointsUsed, q.pay, a.name, a.phone, a.province, a.city, a.district, a.detail, (opts.remark || '').slice(0, 200), q.uc ? q.uc.id : null, opts.promo && opts.promo.groupId || null, promoId, now());
    const oid = r.lastInsertRowid;
    for (const l of q.lines) {
      db.exec1('INSERT INTO order_items(order_id,product_id,sku_id,name,spec_text,image,price,qty) VALUES(?,?,?,?,?,?,?,?)', oid, l.product_id, l.sku_id, l.name, l.spec_text, l.image, l.price, l.qty);
      db.exec1('UPDATE skus SET stock=stock-? WHERE id=?', l.qty, l.sku_id);
      db.exec1('UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM skus WHERE product_id=?) WHERE id=?', l.product_id, l.product_id);
      if (q.seckill) db.exec1('UPDATE seckills SET sold=sold+? WHERE id=?', l.qty, q.seckill.id);
    }
    if (q.uc) db.exec1("UPDATE user_coupons SET status='used', order_id=? WHERE id=?", oid, q.uc.id);
    if (q.pointsUsed) addPoints(uid, -q.pointsUsed, '下单抵扣 ' + no);
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, now(), '订单已提交,等待付款');
    return { ok: true, id: oid, no };
  })();
}

function restoreOrderResources(o) {
  const items = db.all('SELECT * FROM order_items WHERE order_id=?', o.id);
  for (const it of items) {
    if (it.sku_id) {
      db.exec1('UPDATE skus SET stock=stock+? WHERE id=?', it.qty, it.sku_id);
      db.exec1('UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM skus WHERE product_id=?) WHERE id=?', it.product_id, it.product_id);
    }
    if (o.type === 'seckill') db.exec1('UPDATE seckills SET sold=MAX(0,sold-?) WHERE id=?', it.qty, o.promo_id);
  }
  if (o.user_coupon_id) db.exec1("UPDATE user_coupons SET status='unused', order_id=NULL WHERE id=?", o.user_coupon_id);
  if (o.points_used) addPoints(o.user_id, o.points_used, '订单取消/退款返还积分 ' + o.order_no);
}

function cancelOrder(id, reason) {
  return db.transaction(() => {
    const o = db.get('SELECT * FROM orders WHERE id=?', id);
    if (!o || o.status !== 'unpaid') return { ok: false, msg: '仅待付款订单可取消' };
    db.exec1("UPDATE orders SET status='cancelled', cancelled_at=?, cancel_reason=? WHERE id=?", now(), reason || '用户取消', id);
    restoreOrderResources(o);
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), '订单已取消:' + (reason || '用户取消'));
    return { ok: true };
  })();
}

function refundOrder(id, reason, silent) {
  const run = () => {
    const o = db.get('SELECT * FROM orders WHERE id=?', id);
    if (!o || !['paid', 'shipped', 'completed'].includes(o.status)) return { ok: false, msg: '当前状态不可退款' };
    const wasCompleted = o.status === 'completed';
    db.exec1("UPDATE orders SET status='refunded', cancelled_at=?, cancel_reason=? WHERE id=?", now(), reason || '退款', id);
    restoreOrderResources(o);
    for (const it of db.all('SELECT * FROM order_items WHERE order_id=?', id)) if (it.product_id) db.exec1('UPDATE products SET sales=MAX(0,sales-?) WHERE id=?', it.qty, it.product_id);
    if (o.pay_amount > 0) addBalance(o.user_id, o.pay_amount, 'refund', `订单 ${o.order_no} 退款(${reason || '退款'}),已退回账户余额`);
    if (wasCompleted) {
      if (o.points_awarded) addPoints(o.user_id, -o.points_awarded, '订单退款扣回积分 ' + o.order_no);
      if (o.growth_awarded) addGrowth(o.user_id, -o.growth_awarded);
      db.exec1('UPDATE users SET total_spent=MAX(0,total_spent-?) WHERE id=?', o.pay_amount, o.user_id);
    }
    db.exec1("UPDATE commissions SET status='revoked' WHERE order_id=? AND status='available'", id);
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), '订单已退款:' + (reason || ''));
    return { ok: true };
  };
  return silent ? run() : db.transaction(run)();
}

function payOrder(id, uid, method) {
  return db.transaction(() => {
    const o = db.get('SELECT * FROM orders WHERE id=? AND user_id=?', id, uid);
    if (!o) return { ok: false, msg: '订单不存在' };
    if (o.status !== 'unpaid') return { ok: false, msg: '订单状态不是待付款' };
    if (!['wechat', 'alipay', 'balance'].includes(method)) return { ok: false, msg: '请选择支付方式' };
    // 拼团校验
    let gid = o.group_id;
    if (o.type === 'group') {
      if (gid) {
        const g = db.get('SELECT * FROM groups WHERE id=?', gid);
        if (!g || g.status !== 'open' || g.expire_at < now() || g.joined >= g.need) return { ok: false, msg: '该团已结束或已满员,请重新下单' };
      }
    }
    if (method === 'balance' && o.pay_amount > 0 && !addBalance(uid, -o.pay_amount, 'pay', '支付订单 ' + o.order_no)) return { ok: false, msg: '账户余额不足' };
    db.exec1("UPDATE orders SET status='paid', pay_method=?, paid_at=? WHERE id=?", method, now(), id);
    for (const it of db.all('SELECT * FROM order_items WHERE order_id=?', id)) db.exec1('UPDATE products SET sales=sales+? WHERE id=?', it.qty, it.product_id);
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), `订单支付成功(${U.PAY_METHOD[method]}),等待商家发货`);
    if (o.type === 'group') {
      const gb = db.get('SELECT * FROM groupbuys WHERE id=?', o.promo_id);
      if (!gid) {
        const r = db.exec1("INSERT INTO groups(groupbuy_id,leader_id,need,joined,status,expire_at,created_at) VALUES(?,?,?,0,'open',?,?)", gb.id, uid, gb.size, U.offset(gb.hours * 3600000), now());
        gid = r.lastInsertRowid; db.exec1('UPDATE orders SET group_id=? WHERE id=?', gid, id);
      }
      db.exec1('INSERT INTO group_members(group_id,user_id,order_id) VALUES(?,?,?)', gid, uid, id);
      db.exec1('UPDATE groups SET joined=joined+1 WHERE id=?', gid);
      const g = db.get('SELECT * FROM groups WHERE id=?', gid);
      if (g.joined >= g.need) {
        db.exec1("UPDATE groups SET status='success' WHERE id=?", gid);
        for (const m of db.all('SELECT order_id FROM group_members WHERE group_id=?', gid)) db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', m.order_id, now(), '拼团成功,商家将尽快发货');
      } else db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), `拼团中,还差${g.need - g.joined}人成团`);
    }
    // 云商卡:支付成功后激活 / 直推返积分 / 推三返一
    try { require('./cloud').onOrderPaid(id, addPoints); } catch (e) { console.error('cloud onOrderPaid', e); }
    return { ok: true };
  })();
}

function shipOrder(id, company, tracking) {
  return db.transaction(() => {
    const o = db.get('SELECT * FROM orders WHERE id=?', id);
    if (!o || o.status !== 'paid') return { ok: false, msg: '仅待发货订单可发货' };
    if (o.type === 'group') { const g = db.get('SELECT status FROM groups WHERE id=?', o.group_id); if (g && g.status !== 'success') return { ok: false, msg: '拼团尚未成功,不能发货' }; }
    db.exec1("UPDATE orders SET status='shipped', express_company=?, tracking_no=?, shipped_at=? WHERE id=?", company, tracking, now(), id);
    const t = now();
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, t, `商家已发货,${company} 运单号 ${tracking}`);
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, t, `${company} 已揽收包裹`);
    return { ok: true };
  })();
}
const TRACE_STEPS = ['包裹已到达【始发地分拨中心】', '包裹已发往【目的地转运中心】', '包裹已到达【目的地转运中心】', '快递员正在派送中,请保持电话畅通', '包裹已签收,感谢您在财哥商城购物'];
function advanceTrace(id) {
  const o = db.get('SELECT * FROM orders WHERE id=?', id);
  if (!o || o.status !== 'shipped') return false;
  const n = db.get("SELECT COUNT(*) n FROM traces WHERE order_id=? AND time>=?", id, o.shipped_at).n;
  const step = TRACE_STEPS[Math.min(Math.max(0, n - 2), TRACE_STEPS.length - 1)];
  db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), step);
  return true;
}

function completeOrder(id) {
  return db.transaction(() => {
    const o = db.get('SELECT * FROM orders WHERE id=?', id);
    if (!o || o.status !== 'shipped') return { ok: false, msg: '仅待收货订单可确认收货' };
    const pts = Math.floor(o.pay_amount), gr = Math.floor(o.pay_amount);
    db.exec1("UPDATE orders SET status='completed', completed_at=?, points_awarded=?, growth_awarded=? WHERE id=?", now(), pts, gr, id);
    if (pts) addPoints(o.user_id, pts, '购物奖励 ' + o.order_no);
    if (gr) addGrowth(o.user_id, gr);
    db.exec1('UPDATE users SET total_spent=total_spent+? WHERE id=?', o.pay_amount, o.user_id);
    const u = db.get('SELECT referrer_id FROM users WHERE id=?', o.user_id);
    if (u && u.referrer_id) {
      const amt = round2(o.pay_amount * (+S('commission_rate') || 0) / 100);
      if (amt > 0) db.exec1("INSERT INTO commissions(user_id,from_user_id,order_id,amount,status,created_at) VALUES(?,?,?,?,'available',?)", u.referrer_id, o.user_id, id, amt, now());
    }
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), '买家已确认收货,交易完成');
    return { ok: true };
  })();
}

function sweep() {
  try {
    const mins = int(S('unpaid_cancel_minutes'), 30);
    for (const o of db.all("SELECT id FROM orders WHERE status='unpaid' AND created_at<?", U.offset(-mins * 60000))) cancelOrder(o.id, '超时未支付自动取消');
    const days = int(S('auto_confirm_days'), 7);
    for (const o of db.all("SELECT id FROM orders WHERE status='shipped' AND shipped_at<?", U.offset(-days * 86400000))) completeOrder(o.id);
    expireGroups();
  } catch (e) { console.error('sweep error', e); }
}

function notifyService(uid, sender, content) { db.exec1('INSERT INTO messages(user_id,sender,content,created_at,is_read) VALUES(?,?,?,?,?)', uid, sender, content, now(), sender === 'user' ? 0 : 0); }
const FAQ = [
  [/发货|物流|快递/, '一般下单后 24 小时内发货,您可在「我的订单 - 查看物流」查看实时轨迹。'],
  [/退|换|售后/, '收货后 7 天内可在订单详情申请「退款/退货退款」,审核通过后款项将退回账户余额。'],
  [/优惠券|券/, '您可以在「领券中心」领取优惠券,结算时选择使用即可。'],
  [/积分/, '积分可抵现(100 积分=¥1)或在「积分商城」兑换好礼,每日签到可得积分。'],
  [/发票/, '订单支付后可在订单详情申请发票,电子发票将在 1-3 个工作日内开具。'],
  [/运费|包邮/, '单笔订单满 ¥99 包邮,偏远地区(新疆、西藏)运费另计。']
];
function botReply(text) { for (const [re, a] of FAQ) if (re.test(text)) return a; return '您好,已收到您的留言,人工客服将尽快回复您。常见问题可查看「帮助中心」。'; }

const cloud = require('./cloud');
module.exports = { settings, S, setSetting, addPoints, addBalance, addGrowth, refreshLevel, createUser, grantCoupon, userCoupons, calcFreight, quote, createOrder, cancelOrder, refundOrder, payOrder, shipOrder, advanceTrace, completeOrder, sweep, activeSeckill, expireGroups, notifyService, botReply, parseRules, cloud };
