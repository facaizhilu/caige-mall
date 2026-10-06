// 云商卡会员权益(合规子集):激活、日返积分、一级直推、推三返一、兑换申请
// 文案一律用「会员权益 / 消费返积分」,不做多级、不做提现、不写投资收益
const db = require('./db');
const U = require('./util');
const { now, today, round2, int, num } = U;

const TIER_LABEL = { silver: '白银', gold: '黄金' };
const DURATION_LABEL = { month: '月卡', quarter: '季卡', year: '年卡' };
const DURATION_DAYS = { month: 30, quarter: 90, year: 365 };

const CLOUD_DEFAULTS = {
  cloud_daily_points: '10',
  cloud_referral_pct_silver: '5',
  cloud_referral_pct_gold: '8',
  cloud_referral_enable_silver: '1',
  cloud_referral_enable_gold: '1',
  cloud_push3_pct: '30',
  cloud_push3_mode: 'per_third', // once | per_third
  cloud_redeem_label: '权益值',
  cloud_redeem_ratio: '100', // 多少积分 = 1 权益值(仅展示)
  cloud_redeem_min: '100'
};

function ensureDefaults() {
  const svc = require('./svc');
  for (const [k, v] of Object.entries(CLOUD_DEFAULTS)) {
    if (!db.get('SELECT 1 FROM settings WHERE key=?', k)) svc.setSetting(k, v);
  }
}

function isCardActive(u, when) {
  if (!u || !u.cloud_tier) return false;
  const t = when || now();
  return !!(u.cloud_end && u.cloud_start && u.cloud_start <= t && u.cloud_end >= t);
}

function cardStatus(u) {
  if (!u || !u.cloud_tier) return { active: false, label: '未开通', tier: '', tierLabel: '' };
  const active = isCardActive(u);
  return {
    active,
    label: active ? (TIER_LABEL[u.cloud_tier] || u.cloud_tier) + '会员权益生效中' : '会员权益已到期',
    tier: u.cloud_tier,
    tierLabel: TIER_LABEL[u.cloud_tier] || u.cloud_tier,
    start: u.cloud_start,
    end: u.cloud_end
  };
}

function activationProductIds() {
  return db.all('SELECT DISTINCT product_id FROM cloud_card_types WHERE status=1 AND product_id>0').map(r => r.product_id);
}

function findCardTypeByProduct(productId) {
  return db.get('SELECT * FROM cloud_card_types WHERE product_id=? AND status=1 ORDER BY sort,id LIMIT 1', productId);
}

function activateFromOrder(orderId, addPoints) {
  const o = db.get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o || !['paid', 'shipped', 'completed'].includes(o.status)) return null;
  const items = db.all('SELECT * FROM order_items WHERE order_id=?', orderId);
  let activated = null;
  for (const it of items) {
    if (!it.product_id) continue;
    const ct = findCardTypeByProduct(it.product_id);
    if (!ct) continue;
    const days = DURATION_DAYS[ct.duration] || 30;
    const u = db.get('SELECT * FROM users WHERE id=?', o.user_id);
    const start = now();
    const rank = { silver: 1, gold: 2 };
    // 未过期则从到期日顺延;已过期/新开从今天起算。低档不覆盖高档(仍顺延天数,保留高档)。
    let base = start;
    let newTier = ct.tier;
    let typeId = ct.id;
    if (isCardActive(u) && u.cloud_end && u.cloud_end > start) {
      base = u.cloud_end;
      if ((rank[u.cloud_tier] || 0) > (rank[ct.tier] || 0)) {
        newTier = u.cloud_tier;
        typeId = u.cloud_card_type_id || ct.id;
      }
    }
    const endDate = new Date(String(base).replace(' ', 'T'));
    endDate.setDate(endDate.getDate() + days);
    const end = U.fmtDate(endDate);
    const newStart = (isCardActive(u) && u.cloud_start) ? u.cloud_start : start;
    db.exec1('UPDATE users SET cloud_tier=?, cloud_start=?, cloud_end=?, cloud_card_type_id=? WHERE id=?',
      newTier, newStart, end, typeId, o.user_id);
    activated = { tier: newTier, end, cardType: ct, userId: o.user_id };
    break; // 一单一张卡
  }
  return activated;
}

function grantDirectReferral(orderId, addPoints) {
  const o = db.get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o) return;
  const buyer = db.get('SELECT * FROM users WHERE id=?', o.user_id);
  if (!buyer || !buyer.referrer_id) return;
  const ref = db.get('SELECT * FROM users WHERE id=?', buyer.referrer_id);
  if (!isCardActive(ref)) return;
  const svc = require('./svc');
  const enableKey = ref.cloud_tier === 'gold' ? 'cloud_referral_enable_gold' : 'cloud_referral_enable_silver';
  if (String(svc.S(enableKey) || '0') !== '1') return;
  const pct = num(svc.S(ref.cloud_tier === 'gold' ? 'cloud_referral_pct_gold' : 'cloud_referral_pct_silver'), 0);
  if (pct <= 0) return;
  const actIds = new Set(activationProductIds());
  if (!actIds.size) return;
  const items = db.all('SELECT * FROM order_items WHERE order_id=?', orderId);
  let goodsAmt = 0, hitPid = 0;
  for (const it of items) {
    if (actIds.has(it.product_id)) { goodsAmt = round2(goodsAmt + it.price * it.qty); hitPid = it.product_id; }
  }
  if (goodsAmt <= 0) return;
  // 防重复
  if (db.get("SELECT 1 FROM cloud_referral_log WHERE order_id=? AND type='direct'", orderId)) return;
  const pts = Math.floor(goodsAmt * pct / 100);
  if (pts <= 0) return;
  addPoints(ref.id, pts, `云商卡直推会员权益返还(${U.maskPhone(buyer.phone)})`);
  db.exec1('INSERT INTO cloud_referral_log(user_id,from_user_id,order_id,product_id,amount,points,type,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    ref.id, buyer.id, orderId, hitPid, goodsAmt, pts, 'direct', `直推消费返积分 ${pct}%`, now());
}

function countQualifiedFans(referrerId) {
  // 直推粉丝中,已购买过任意激活商品且订单已支付/完成的人数
  const actIds = activationProductIds();
  if (!actIds.length) return { count: 0, fans: [] };
  const placeholders = actIds.map(() => '?').join(',');
  const fans = db.all(`
    SELECT u.id, u.nickname, u.phone, u.created_at,
      (SELECT MIN(o.paid_at) FROM orders o JOIN order_items oi ON oi.order_id=o.id
        WHERE o.user_id=u.id AND o.status IN ('paid','shipped','completed') AND oi.product_id IN (${placeholders})) first_buy
    FROM users u
    WHERE u.referrer_id=?
      AND EXISTS(
        SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id=o.id
        WHERE o.user_id=u.id AND o.status IN ('paid','shipped','completed') AND oi.product_id IN (${placeholders})
      )
    ORDER BY first_buy, u.id
  `, ...actIds, referrerId, ...actIds);
  return { count: fans.length, fans };
}

function maybePush3(referrerId, triggerOrderId, addPoints) {
  const ref = db.get('SELECT * FROM users WHERE id=?', referrerId);
  if (!ref || !isCardActive(ref)) return;
  const svc = require('./svc');
  const pct = num(svc.S('cloud_push3_pct'), 0);
  if (pct <= 0) return;
  const mode = svc.S('cloud_push3_mode') || 'per_third';
  const { count, fans } = countQualifiedFans(referrerId);
  const deserved = mode === 'once' ? (count >= 3 ? 1 : 0) : Math.floor(count / 3);
  const granted = int(ref.cloud_push3_granted, 0);
  if (deserved <= granted) return;
  // 取触发这笔订单中激活商品金额作为基数;若无则用最近粉丝购买金额
  let amount = 0, productId = 0;
  if (triggerOrderId) {
    const actIds = new Set(activationProductIds());
    for (const it of db.all('SELECT * FROM order_items WHERE order_id=?', triggerOrderId)) {
      if (actIds.has(it.product_id)) { amount = round2(amount + it.price * it.qty); productId = it.product_id; }
    }
  }
  if (amount <= 0) {
    const ct = db.get('SELECT * FROM cloud_card_types WHERE status=1 ORDER BY activation_fee DESC LIMIT 1');
    amount = ct ? ct.activation_fee : 0;
    productId = ct ? ct.product_id : 0;
  }
  const toGrant = deserved - granted;
  for (let i = 0; i < toGrant; i++) {
    const pts = Math.floor(amount * pct / 100);
    if (pts <= 0) continue;
    addPoints(referrerId, pts, `云商卡推三返一会员权益(${granted + i + 1}次)`);
    db.exec1('INSERT INTO cloud_referral_log(user_id,from_user_id,order_id,product_id,amount,points,type,note,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      referrerId, fans[Math.min((granted + i + 1) * 3 - 1, fans.length - 1)]?.id || null,
      triggerOrderId || null, productId, amount, pts, 'push3', `推三返一 ${pct}% ×1`, now());
  }
  db.exec1('UPDATE users SET cloud_push3_granted=? WHERE id=?', deserved, referrerId);
}

/** 订单支付成功后调用:激活卡 + 直推返积分 + 推三返一 */
function onOrderPaid(orderId, addPoints) {
  const activated = activateFromOrder(orderId, addPoints);
  grantDirectReferral(orderId, addPoints);
  const o = db.get('SELECT user_id FROM orders WHERE id=?', orderId);
  if (o) {
    const buyer = db.get('SELECT referrer_id FROM users WHERE id=?', o.user_id);
    if (buyer && buyer.referrer_id) maybePush3(buyer.referrer_id, orderId, addPoints);
  }
  return activated;
}

function dailyReturn(uid, addPoints) {
  const u = db.get('SELECT * FROM users WHERE id=?', uid);
  if (!isCardActive(u)) return { ok: false, msg: '会员权益未生效,无法领取每日返积分' };
  const day = today();
  if (u.cloud_daily_day === day || db.get('SELECT 1 FROM cloud_daily_log WHERE user_id=? AND day=?', uid, day)) {
    return { ok: false, msg: '今日已领取会员每日返积分' };
  }
  const svc = require('./svc');
  const pts = Math.max(0, int(svc.S('cloud_daily_points'), 10));
  if (!pts) return { ok: false, msg: '每日返积分暂未开放' };
  db.exec1('INSERT INTO cloud_daily_log(user_id,day,points) VALUES(?,?,?)', uid, day, pts);
  db.exec1('UPDATE users SET cloud_daily_day=? WHERE id=?', day, uid);
  addPoints(uid, pts, '云商卡每日会员权益返积分');
  return { ok: true, msg: `领取成功,获得 ${pts} 积分`, pts };
}

function submitRedeem(uid, points, note) {
  const svc = require('./svc');
  const min = Math.max(1, int(svc.S('cloud_redeem_min'), 100));
  const pts = int(points);
  if (pts < min) return { ok: false, msg: `兑换积分不少于 ${min}` };
  const u = db.get('SELECT * FROM users WHERE id=?', uid);
  if (!u || u.points < pts) return { ok: false, msg: '积分不足' };
  if (!isCardActive(u)) return { ok: false, msg: '仅会员权益生效期间可提交兑换申请' };
  const pending = db.get("SELECT COALESCE(SUM(points),0) n FROM cloud_redeem_requests WHERE user_id=? AND status='pending'", uid).n;
  if (u.points - pending < pts) return { ok: false, msg: '可用积分不足(含待审核兑换占用)' };
  db.exec1('INSERT INTO cloud_redeem_requests(user_id,points,note,status,created_at) VALUES(?,?,?,?,?)',
    uid, pts, String(note || '').slice(0, 200), 'pending', now());
  return { ok: true, msg: '兑换申请已提交,等待管理员审核(不会自动打款)' };
}

function handleRedeem(id, action, adminNote, adminId, addPoints) {
  const r = db.get('SELECT * FROM cloud_redeem_requests WHERE id=?', id);
  if (!r || r.status !== 'pending') return { ok: false, msg: '申请不存在或已处理' };
  if (action === 'reject') {
    db.exec1("UPDATE cloud_redeem_requests SET status='rejected', admin_note=?, handled_at=?, handled_by=? WHERE id=?",
      String(adminNote || '已拒绝').slice(0, 200), now(), adminId, id);
    return { ok: true, msg: '已拒绝该兑换申请' };
  }
  if (action === 'approve') {
    // 仅在通过时扣积分;拒绝不扣也不回补(申请阶段未扣款)
    const u = db.get('SELECT * FROM users WHERE id=?', r.user_id);
    if (!u || u.points < r.points) return { ok: false, msg: '用户积分不足,无法通过' };
    addPoints(r.user_id, -r.points, '积分兑换申请通过(权益登记,非现金)');
    db.exec1("UPDATE cloud_redeem_requests SET status='approved', admin_note=?, handled_at=?, handled_by=? WHERE id=?",
      String(adminNote || '已通过,权益已登记').slice(0, 200), now(), adminId, id);
    return { ok: true, msg: '已通过并扣减积分(未自动打款)' };
  }
  return { ok: false, msg: '未知操作' };
}

function fanStats(uid) {
  const fans = db.all('SELECT id, nickname, phone, created_at, total_spent, cloud_tier, cloud_end FROM users WHERE referrer_id=? ORDER BY id DESC', uid);
  const actIds = activationProductIds();
  const todayStr = today();
  const monthStr = todayStr.slice(0, 7);
  let todayAmt = 0, monthAmt = 0, totalAmt = 0, todayCnt = 0, monthCnt = 0, totalCnt = 0;
  const fanDetails = fans.map(f => {
    let bought = [];
    if (actIds.length) {
      const ph = actIds.map(() => '?').join(',');
      bought = db.all(`
        SELECT o.id oid, o.order_no, o.paid_at, o.pay_amount, oi.name, oi.price, oi.qty, oi.product_id
        FROM orders o JOIN order_items oi ON oi.order_id=o.id
        WHERE o.user_id=? AND o.status IN ('paid','shipped','completed') AND oi.product_id IN (${ph})
        ORDER BY o.paid_at DESC`, f.id, ...actIds);
    }
    const amt = round2(bought.reduce((a, b) => a + b.price * b.qty, 0));
    for (const b of bought) {
      const a = round2(b.price * b.qty);
      totalAmt = round2(totalAmt + a); totalCnt++;
      if (b.paid_at && b.paid_at.startsWith(todayStr)) { todayAmt = round2(todayAmt + a); todayCnt++; }
      if (b.paid_at && b.paid_at.startsWith(monthStr)) { monthAmt = round2(monthAmt + a); monthCnt++; }
    }
    return { ...f, bought, buyAmount: amt, buyCount: bought.length };
  });
  const pointsEarned = db.get("SELECT COALESCE(SUM(points),0) n FROM cloud_referral_log WHERE user_id=?", uid).n;
  const { count: qualified } = countQualifiedFans(uid);
  return {
    fans: fanDetails,
    directCount: fans.length,
    qualifiedCount: qualified,
    pointsEarned,
    perf: {
      today: { amount: todayAmt, count: todayCnt },
      month: { amount: monthAmt, count: monthCnt },
      total: { amount: totalAmt, count: totalCnt }
    }
  };
}

module.exports = {
  TIER_LABEL, DURATION_LABEL, DURATION_DAYS, CLOUD_DEFAULTS,
  ensureDefaults, isCardActive, cardStatus, activationProductIds, findCardTypeByProduct,
  activateFromOrder, grantDirectReferral, maybePush3, onOrderPaid, dailyReturn,
  submitRedeem, handleRedeem, fanStats, countQualifiedFans
};
