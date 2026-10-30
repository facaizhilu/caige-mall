// 业务服务层:积分/成长值、运费、下单、支付、取消、退款、完成、拼团、邀请奖励等
const db = require('./db');
const U = require('./util');
const { now, round2, int } = U;

// 违禁词默认清单见 lib/banned.js(后台「违禁词检查」可编辑,每行一个)
const { BANNED_DEFAULT } = require('./banned');
// 顶部公告:运费口径须与运费模板一致(普通商品满99包邮;大件模板与新疆、西藏另有标准,见商品页「运费」栏)
const ANNOUNCEMENT = '🎉 韵农甄选开业!新人注册即送积分与优惠券;普通商品满99元包邮(大件、偏远地区除外,以商品页标示为准)';
const DEFAULT_SETTINGS = {
  shop_name: '韵农甄选', slogan: '韵农甄选 · 新鲜好物', announcement: ANNOUNCEMENT,
  service_phone: '', service_wechat: '', ship_from: '海口发货', service_recall_minutes: '2', storecard_on: '1', storecard_nature: '折扣资格卡，卡内不存钱、不能充值', storecard_stores: '全国韵农甄选线下门店均可使用，门店名单和地址见本页下方的门店列表', storecard_valid: '自开卡之日起 1 年', storecard_excluded: '烟草、特价或促销商品、购物卡和礼品卡，以及门店标明「不参与折扣」的商品', storecard_stack: '不与门店其他折扣同时使用', storecard_usage: '结账时出示商城会员账号中的优惠卡；一卡一人，不可转借', storecard_refund: '如需退卡，请联系在线客服办理', storecard_provider: '由海南韵农科技有限公司及合作门店提供', storecard_tips: '本卡为折扣卡，不可充值或储值，不可兑换现金，仅限本人使用', storecard_store_list: '', service_quick_questions: '什么时候发货\n怎么退换货\n积分怎么用', service_hours: '每日 9:00 - 22:00', service_email: '', address: '',
  icp: '', points_rate: '100', points_max_percent: '50', group_auto_max_minutes: '180', // 拼团:开团支付后最迟 N 分钟内自动成团(随机 10~N 分钟),未满员也按拼团价发货
  signin_base: '12', signin_step: '1', signin_max: '18', cloud_signin_base: '37', cloud_signin_step: '2', cloud_signin_max: '55', stock_warn: '10',
  unpaid_cancel_minutes: '30', auto_confirm_days: '7', aftersale_days: '7', register_points: '100', review_points: '10',
  // 单级邀请:被邀请人首单确认收货且满观察期(无退款)后,邀请人一次性获得积分;注册本身不奖励
  invite_points: '100', invite_window_days: '7', invite_coupon_id: '',
  // 云商卡权益(保守占位值)
  cloud_on_silver: '1', cloud_discount_silver: '9.5', cloud_on_gold: '1', cloud_discount_gold: '8.5', cloud_on_diamond: '1', cloud_discount_diamond: '7.5', cloud_free_shipping: '1',
  banned_words: BANNED_DEFAULT,
  hot_sales_threshold: '10', new_days: '30', // 「热卖」=真实销量≥阈值;「新品」=上架 N 天内(自动判定)
  show_sales: '0', // 前台显示销量:默认关闭;开启后也仅显示真实销量(>0)
  // 积分专区 / 积分有效期(v1.3)
  points_deduct_enable: '0', // 下单积分抵现:店主要求前台不出现积分折现,默认关闭(关闭时前台不展示比例/抵扣,服务端忽略 use_points)
  points_expiry_enable: '1', points_clear_day: '06-01', points_expiry_remind_days: '30', // 每年清零日清除上上周期获得的积分
  points_mall_banner: '', // 已停用:积分专区不再显示顶部横幅(保留键兼容旧库)
  company_name: '海南韵农科技有限公司', // 运营主体(前台页脚/协议展示)
  points_zone_ratio: '2', // 积分专区:1元 = N 积分(按参考价自动计算默认积分价;接入真实供应商接口后需复核)
  points_redeem_notice: '积分兑换商品非质量问题不退不换;如有质量问题或发错货,请联系客服换货或退回积分。',
  policy_version: '1.1' // 协议更新时提升版本号,老用户下次访问时重新确认
};
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);

// 真实销量:已支付/已发货/已完成订单中的件数;整单退款的订单状态为 refunded,不计入。
// products.sales 仅作为缓存,只能由本函数写入(支付、退款路径及启动迁移时调用),不允许人工设置。
const SOLD_STATUSES = "('paid','shipped','completed')";
function recalcSales(pids) {
  const sql = `UPDATE products SET sales=COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=products.id AND o.status IN ${SOLD_STATUSES}),0)`;
  if (pids === undefined) return db.prepare(sql).run().changes;
  const ids = [...new Set([].concat(pids).map(Number).filter(Boolean))];
  if (!ids.length) return 0;
  return db.prepare(`${sql} WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids).changes;
}
const orderPids = oid => db.prepare('SELECT DISTINCT product_id FROM order_items WHERE order_id=?').all(oid).map(r => r.product_id);
recalcSales(); // 迁移:清除历史演示/人工销量,统一为订单真实值
let _settings = null;
const settings = () => { if (!_settings) { _settings = {}; for (const r of db.all('SELECT * FROM settings')) _settings[r.key] = r.value; } return _settings; };
const setSetting = (k, v) => { db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)').run(k, String(v)); _settings = null; };
const S = (k) => settings()[k];

// opts.expireAt:限期积分(如云商卡签到加赠),到期未用自动作废;扣减积分时优先消耗最早到期的限期积分
function addPoints(uid, delta, reason, opts = {}) {
  const u = db.get('SELECT points FROM users WHERE id=?', uid); if (!u) return false;
  const nb = Math.max(0, u.points + delta);
  db.exec1('UPDATE users SET points=? WHERE id=?', nb, uid);
  db.exec1('INSERT INTO points_log(user_id,delta,balance,reason,created_at) VALUES(?,?,?,?,?)', uid, nb - u.points, nb, reason, now());
  if (delta > 0 && opts.expireAt) db.exec1('INSERT INTO point_lots(user_id,points,remaining,expire_at,reason,created_at) VALUES(?,?,?,?,?,?)', uid, delta, delta, opts.expireAt, reason, now());
  else if (delta > 0 && S('points_expiry_enable') === '1') db.exec1("INSERT INTO point_lots(user_id,points,remaining,expire_at,reason,created_at,kind) VALUES(?,?,?,?,?,?,'cycle')", uid, delta, delta, cycleExpireAt(now()), reason, now());
  if (delta < 0 && !opts.expiring) {
    let left = u.points - nb;
    for (const l of db.all('SELECT * FROM point_lots WHERE user_id=? AND remaining>0 ORDER BY expire_at, id', uid)) {
      if (left <= 0) break;
      const take = Math.min(left, l.remaining); left -= take;
      db.exec1('UPDATE point_lots SET remaining=remaining-? WHERE id=?', take, l.id);
    }
  }
  return true;
}
function expirePointLots() {
  for (const l of db.all('SELECT * FROM point_lots WHERE remaining>0 AND expire_at<?', now())) {
    db.transaction(() => {
      const u = db.get('SELECT points FROM users WHERE id=?', l.user_id);
      const n = Math.min(l.remaining, u ? u.points : 0);
      db.exec1('UPDATE point_lots SET remaining=0 WHERE id=?', l.id);
      if (n > 0) addPoints(l.user_id, -n, '限期积分到期作废(' + (l.reason || '') + ')', { expiring: true });
    })();
  }
}
/** 用户当前积分中即将到期的限期积分(云商卡加赠等,不含周期清零批次) */
function expiringPoints(uid) { return db.all("SELECT expire_at, remaining FROM point_lots WHERE user_id=? AND remaining>0 AND COALESCE(kind,'limited')<>'cycle' ORDER BY expire_at", uid); }
// ---- 积分周期清零:清零日(默认 06-01)起算一个周期;周期 [Y-清零日, Y+1-清零日) 内获得的积分于 Y+2 清零日前一天 23:59:59 过期 ----
// 例:2026-06-01 ~ 2027-05-31 获得 → 2028-05-31 23:59:59 过期(2028-06-01 清零)
function clearDay() { const m = /^(\d{2})-(\d{2})$/.exec(S('points_clear_day') || ''); return m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 28 ? m[0] : '06-01'; }
function cycleExpireAt(t, cd) {
  cd = cd || clearDay(); const y = +String(t).slice(0, 4), md = String(t).slice(5, 10);
  const start = md >= cd ? y : y - 1;
  const d = new Date(Date.UTC(start + 2, +cd.slice(0, 2) - 1, +cd.slice(3, 5)) - 86400000);
  return d.toISOString().slice(0, 10) + ' 23:59:59';
}
/** 周期积分:按到期日汇总的剩余量(最近的在前) */
function cyclePointsExpiry(uid) { return db.all("SELECT substr(expire_at,1,10) day, SUM(remaining) n FROM point_lots WHERE user_id=? AND remaining>0 AND kind='cycle' GROUP BY substr(expire_at,1,10) ORDER BY day", uid); }
// 到期前提醒(默认 30 天):写站内消息;微信订阅消息暂为桩函数,接入后在 wechatSubscribeNotify 内实现
function wechatSubscribeNotify(uid, tpl, data) { return { ok: false, stub: true, uid, tpl, data }; }
function remindExpiringPoints() {
  const days = Math.max(1, int(S('points_expiry_remind_days'), 30)), lim = U.offset(days * 86400000), sent = [];
  const rows = db.all('SELECT user_id, substr(expire_at,1,10) day, SUM(remaining) n, GROUP_CONCAT(id) ids FROM point_lots WHERE remaining>0 AND reminded_at IS NULL AND expire_at>=? AND expire_at<=? GROUP BY user_id, substr(expire_at,1,10)', now(), lim);
  for (const r of rows) {
    const u = db.get('SELECT points, status FROM users WHERE id=?', r.user_id), n = Math.min(r.n, u ? u.points : 0);
    db.transaction(() => {
      if (n > 0 && u.status) {
        const text = `【积分到期提醒】您有 ${n} 积分将于 ${+r.day.slice(5, 7)}月${+r.day.slice(8, 10)}日过期,请尽快前往积分专区兑换。`;
        notifyService(r.user_id, 'system', text); wechatSubscribeNotify(r.user_id, 'points_expire', { points: n, day: r.day }); sent.push({ uid: r.user_id, n, day: r.day });
      }
      db.prepare(`UPDATE point_lots SET reminded_at=? WHERE id IN (${String(r.ids).split(',').map(Number).join(',')})`).run(now());
    })();
  }
  return sent;
}
const deductEnabled = () => S('points_deduct_enable') === '1';
// ---- 积分商城 ----
// 用户对某积分商品的有效兑换次数(不含已取消/已退款订单)
function redeemedCount(uid, gid) { return db.get("SELECT COUNT(*) n FROM points_redemptions r LEFT JOIN orders o ON o.id=r.order_id WHERE r.user_id=? AND r.goods_id=? AND (r.order_id IS NULL OR o.status NOT IN ('cancelled','refunded'))", uid, gid).n; }
// 积分专区价格:pay_mode points/cash/mix;所需积分 >0 为单品覆盖,否则 = 参考价 × 全局比例(1元=N积分)
const zoneRatio = () => { const n = Number(S('points_zone_ratio')); return isFinite(n) && n > 0 ? n : 2; };
function pgPrice(g) {
  const mode = ['points', 'cash', 'mix'].includes(g.pay_mode) ? g.pay_mode : 'points';
  const auto = !(g.points > 0);
  const points = mode === 'cash' ? 0 : (auto ? Math.round((Number(g.ref_price) || 0) * zoneRatio()) : g.points);
  const cash = mode === 'points' ? 0 : Math.round((Number(g.cash_price) || 0) * 100) / 100;
  const cs = '¥' + (cash % 1 ? cash.toFixed(2) : String(cash));
  const label = mode === 'cash' ? cs : mode === 'mix' ? points + '积分+' + cs : points + '积分';
  return { mode, points, cash, auto: mode !== 'cash' && auto, label, modeText: { points: '纯积分', cash: '纯现金', mix: '积分+现金' }[mode] };
}
// 前台公开的运营者信息:占位/虚构的地址、电话、邮箱、备案号一律显示「待公布」,后台「系统设置」填写真实值后自动展示
const PLACEHOLDER_INFO = { service_phone: v => v === '400-888-6666', service_email: v => /example/i.test(v), address: v => ['海南韵农科技有限公司 · 海南省海口市龙华区', '广东省深圳市南山区科技园', '广东省深圳市南山区科技园财哥大厦 18 层'].includes(v), icp: v => /0{8}|演示/.test(v), service_wechat: v => v === 'yunnong-kefu' };
function publicInfo() {
  const s = settings(), val = k => { const v = String(s[k] || '').trim(); return v && !(PLACEHOLDER_INFO[k] && PLACEHOLDER_INFO[k](v)) ? v : ''; };
  const phone = val('service_phone');
  return { company: String(s.company_name || '').trim() || '海南韵农科技有限公司', phone: phone || '待公布', phoneReal: !!phone, email: val('service_email') || '待公布', address: val('address') || '待公布', icp: val('icp') || 'ICP备案号:待公布', wechat: val('service_wechat') };
}
function fillOperator(html, p = publicInfo()) { return String(html || '').split('【公司全称】').join(p.company).split('【联系地址】').join(p.address).split('【联系邮箱】').join(p.email).split('【客服电话】').join(p.phone).split('【公司住所地】').join('运营者住所地').split('【生效日期】').join(String(S('policy_effective_date') || '').trim() || '2026年10月29日').split('【更新日期】').join('2026年10月29日').split('【服务商名称】').join('(待公布)').replace(/<li>【其他支付服务[^】]*】<\/li>\n?/g, ''); }
function redeemLeft(uid, g) { return g.per_user_limit > 0 ? Math.max(0, g.per_user_limit - (uid ? redeemedCount(uid, g.id) : 0)) : null; }
// 兑换:同一事务内条件扣减库存(stock>0)防超兑,积分不足/限兑/库存不足均回滚;积分商品一律包邮
function redeemPointsGoods(uid, gid) {
  try { return redeemTx(uid, gid); } catch (e) { if (e.r) return e.r; throw e; }
}
function redeemTx(uid, gid) {
  return db.transaction(() => {
    const g = db.get('SELECT * FROM points_goods WHERE id=? AND status=1', gid);
    const u = db.get('SELECT * FROM users WHERE id=?', uid);
    if (!g || !u) return { ok: false, msg: '商品不存在或已下架' };
    const pp = pgPrice(g);
    if (pp.mode !== 'cash' && !(pp.points > 0)) return { ok: false, msg: '该商品积分价未设置,请联系客服' };
    if (pp.mode !== 'points' && !(pp.cash > 0)) return { ok: false, msg: '该商品现金价未设置,请联系客服' };
    if (pp.mode !== 'points' && g.type !== 'goods') return { ok: false, msg: '该商品暂不支持现金支付' };
    if (g.stock <= 0) return { ok: false, msg: '已兑完' };
    if (g.per_user_limit > 0 && redeemedCount(uid, g.id) >= g.per_user_limit) return { ok: false, msg: `每人限兑 ${g.per_user_limit} 件,您已达上限` };
    if (u.points < pp.points) return { ok: false, msg: `积分不足:需要 ${pp.points} 积分,您当前有 ${u.points} 积分,还差 ${pp.points - u.points} 积分`, short: true };
    let a = null;
    if (g.type === 'goods') { a = db.get('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id LIMIT 1', uid); if (!a) return { ok: false, msg: '请先添加收货地址再兑换实物', addr: true }; }
    if (db.prepare('UPDATE points_goods SET stock=stock-1, exchanged=exchanged+1 WHERE id=? AND stock>0 AND status=1').run(g.id).changes !== 1) return { ok: false, msg: '已兑完' };
    let oid = null;
    const needPay = pp.cash > 0;
    if (g.type === 'goods') {
      // 含现金:生成待付款订单(积分先冻结扣除,超时/取消自动退回),现金走现有收银台(微信支付/模拟支付)
      oid = db.exec1(`INSERT INTO orders(order_no,user_id,type,status,goods_amount,freight,pay_amount,pay_method,paid_at,receiver,phone,province,city,district,detail,points_used,points_goods_id,created_at) VALUES(?,?,'points',?,?,0,?,?,?,?,?,?,?,?,?,?,?,?)`, U.orderNo(), uid, needPay ? 'unpaid' : 'paid', pp.cash, pp.cash, needPay ? null : 'points', needPay ? null : now(), a.name, a.phone, a.province, a.city, a.district, a.detail, pp.points, g.id, now()).lastInsertRowid;
      db.exec1('INSERT INTO order_items(order_id,name,spec_text,image,price,qty) VALUES(?,?,?,?,?,1)', oid, g.name, pp.label + (pp.mode === 'cash' ? ' 积分专区' : ' 兑换') + ' · 包邮', g.image, pp.cash);
      db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, now(), needPay ? `积分专区下单(${pp.label}),待支付现金 ¥${pp.cash.toFixed(2)}` : '积分兑换成功,等待商家发货');
    } else if (g.type === 'coupon') { const c = grantCoupon(uid, g.coupon_id, true); if (!c.ok) throw Object.assign(new Error('coupon'), { r: c }); }
    db.exec1('INSERT INTO points_redemptions(user_id,goods_id,order_id,points,created_at) VALUES(?,?,?,?,?)', uid, g.id, oid, pp.points, now());
    if (pp.points > 0) addPoints(uid, -pp.points, '积分兑换:' + g.name);
    if (needPay) return { ok: true, msg: `订单已生成(${pp.label}),请支付现金 ¥${pp.cash.toFixed(2)}`, oid, pay: true };
    return { ok: true, msg: g.type === 'coupon' ? '兑换成功,优惠券已发放到「我的优惠券」' : '兑换成功,订单已生成,请等待发货(包邮)', oid };
  })();
}
// 七天无理由:商品级设置优先(1 支持 / 0 不支持),未设置时跟随分类(本级或上级分类标记「鲜活易腐类」则不支持)
// 2026-10-20 起:常规商品(含生鲜)一律支持七天无理由,商品/分类旧标记忽略(积分兑换订单另按「非质量问题不退不换」)
function noReasonOf(productId) { return true; }
function _legacyNoReasonOf(productId) {
  const p = db.get('SELECT p.no_reason_return, c.no_7day, pc.no_7day pno FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN categories pc ON pc.id=c.parent_id WHERE p.id=?', productId);
  if (!p) return true;
  if (p.no_reason_return === 0 || p.no_reason_return === 1) return !!p.no_reason_return;
  return !(p.no_7day || p.pno);
}
function refreshLevel(uid) {
  const u = db.get('SELECT growth FROM users WHERE id=?', uid);
  const lv = db.get('SELECT id FROM member_levels WHERE min_growth<=? ORDER BY min_growth DESC LIMIT 1', u.growth);
  if (lv) db.exec1('UPDATE users SET level_id=? WHERE id=?', lv.id, uid);
}
function addGrowth(uid, n) { db.exec1('UPDATE users SET growth=MAX(0,growth+?) WHERE id=?', n, uid); refreshLevel(uid); }
function genInviteCode() { for (;;) { const c = U.randCode(6); if (!db.get('SELECT 1 FROM users WHERE invite_code=?', c)) return c; } }

function createUser({ phone, password_hash, nickname, referrerCode, consent }) {
  const ref = referrerCode ? db.get('SELECT id FROM users WHERE invite_code=?', referrerCode) : null;
  const r = db.exec1('INSERT INTO users(phone,password_hash,nickname,invite_code,referrer_id,created_at,last_login) VALUES(?,?,?,?,?,?,?)',
    phone, password_hash, nickname || '会员' + phone.slice(-4), genInviteCode(), ref ? ref.id : null, now(), now());
  const id = r.lastInsertRowid;
  if (consent) db.exec1('UPDATE users SET consent_at=?, consent_version=? WHERE id=?', now(), S('policy_version') || '1.1', id);
  const rp = int(S('register_points'));
  if (rp) addPoints(id, rp, '注册奖励');
  // 邀请注册不给邀请人任何奖励;被邀请人获得「首单优惠券」(后台可配置,留空则不发)
  if (ref && int(S('invite_coupon_id'))) grantCoupon(id, int(S('invite_coupon_id')), true);
  // 新人券
  for (const c of db.all("SELECT id FROM coupons WHERE status=1 AND name LIKE '新人%'")) grantCoupon(id, c.id, true);
  return id;
}

// ---------- 单级邀请奖励 ----------
// 被邀请人「首个订单」确认收货后登记一条待发放记录,观察期(默认 7 天)内未退款则发放固定积分给邀请人;观察期内退款则取消。
function inviteOnComplete(o) {
  const u = db.get('SELECT referrer_id FROM users WHERE id=?', o.user_id);
  if (!u || !u.referrer_id) return;
  if (db.get("SELECT 1 FROM invite_rewards WHERE invitee_id=? AND status IN ('pending','granted')", o.user_id)) return;
  const prior = db.get("SELECT COUNT(*) n FROM orders WHERE user_id=? AND id<>? AND status='completed'", o.user_id, o.id).n;
  if (prior > 0) return; // 仅首单
  const pts = Math.max(0, int(S('invite_points'), 100));
  if (!pts) return;
  const days = Math.max(0, int(S('invite_window_days'), 7));
  db.exec1("INSERT INTO invite_rewards(referrer_id,invitee_id,order_id,points,status,due_at,created_at) VALUES(?,?,?,?,'pending',?,?)",
    u.referrer_id, o.user_id, o.id, pts, U.offset(days * 86400000), now());
}
function settleInvites() {
  for (const r of db.all("SELECT * FROM invite_rewards WHERE status='pending' AND due_at<=?", now())) {
    db.transaction(() => {
      const o = db.get('SELECT status FROM orders WHERE id=?', r.order_id);
      const ref = db.get('SELECT status, cancelled_at FROM users WHERE id=?', r.referrer_id);
      if (!o || o.status !== 'completed') { db.exec1("UPDATE invite_rewards SET status='cancelled', note='首单未完成或已退款' WHERE id=?", r.id); return; }
      if (!ref || ref.cancelled_at || !ref.status) { db.exec1("UPDATE invite_rewards SET status='cancelled', note='邀请人账号不可用' WHERE id=?", r.id); return; }
      const inv = db.get('SELECT phone FROM users WHERE id=?', r.invitee_id);
      addPoints(r.referrer_id, r.points, '邀请好友首单奖励(' + U.maskPhone(inv ? inv.phone : '') + ')');
      db.exec1("UPDATE invite_rewards SET status='granted', granted_at=? WHERE id=?", now(), r.id);
    })();
  }
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
// 拼团自动成团:开团支付后在 [10, N] 分钟内随机一个时间点(存于 expire_at),到点仍未满员则系统自动成团。
// 只统计真实参团会员,不添加任何虚拟团员,也不修改参团人数;已付款的拼团订单不会失败。
function groupAutoMaxMinutes() { return Math.min(180, Math.max(10, int(S('group_auto_max_minutes'), 180))); }
function groupAutoHours() { return 3; } // 前台规则固定「最迟3小时」,后台上限已限定 ≤180 分钟
function groupAutoDelayMs() { const mx = groupAutoMaxMinutes(), mn = Math.min(10, mx); return Math.round((mn + Math.random() * (mx - mn)) * 60000); }
function markGroupSuccess(gid, auto) {
  db.exec1("UPDATE groups SET status='success', auto_success=?, success_at=? WHERE id=? AND status='open'", auto ? 1 : 0, now(), gid);
  const text = '拼团成功'; // 前台统一显示「拼团成功」;是否自动成团仅后台可见(auto_success)
  for (const m of db.all("SELECT m.order_id FROM group_members m JOIN orders o ON o.id=m.order_id WHERE m.group_id=? AND o.status='paid'", gid)) db.exec1("DELETE FROM traces WHERE order_id=? AND text LIKE '拼团中%'", m.order_id), db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', m.order_id, now(), text);
}
function autoSucceedGroups() {
  const rows = db.all("SELECT * FROM groups WHERE status='open' AND expire_at<=?", now());
  for (const g of rows) db.transaction(() => markGroupSuccess(g.id, true))();
  return rows.length;
}
const expireGroups = autoSucceedGroups; // 兼容旧调用名:不再有「超时失败退款」

// ---------- 下单 ----------
// opts: {items:[{sku_id,qty}], address:{...}, couponId, usePoints, promo:{type,id,groupId}, remark, preview}
function quote(uid, opts) {
  const user = db.get('SELECT * FROM users WHERE id=?', uid);
  const lines = []; let err = null;
  const promo = opts.promo || null;
  let seckill = null, groupbuy = null;
  if (promo && promo.type === 'seckill') { seckill = activeSeckill(promo.id); if (!seckill) return { error: '活动未开始或已结束' }; }
  if (promo && promo.type === 'group') {
    groupbuy = db.get('SELECT * FROM groupbuys WHERE id=? AND status=1', promo.id); if (!groupbuy) return { error: '拼团活动不存在' };
    if (promo.groupId) {
      const g = db.get('SELECT * FROM groups WHERE id=?', promo.groupId);
      if (!g || g.status !== 'open' || g.expire_at < now() || g.joined >= g.need) return { error: '该团已成团,可返回商品页自己开团' };
      if (db.get('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?', g.id, uid)) return { error: '您已在该团中' };
    }
  }
  for (const it of opts.items) {
    const qty = Math.max(1, int(it.qty, 1));
    const sku = db.get('SELECT s.*, p.name pname, p.images, p.status pstatus, p.template_id, p.category_id, p.id pid, p.supplier FROM skus s JOIN products p ON p.id=s.product_id WHERE s.id=?', it.sku_id);
    if (!sku || !sku.pstatus) { err = '商品已下架或不存在'; break; }
    if (sku.stock < qty) { err = `「${sku.pname}」库存不足(当前库存${sku.stock}件)`; break; }
    let price = sku.price;
    if (sku.supplier && (seckill || groupbuy)) { err = '供应商发货商品不参与该活动'; break; }
    if (seckill) {
      if (seckill.sku_id !== sku.id) { err = '活动商品规格不匹配'; break; }
      if (seckill.stock - seckill.sold < qty) { err = '活动商品已售罄'; break; }
      const bought = db.get("SELECT COALESCE(SUM(oi.qty),0) n FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.user_id=? AND o.type='seckill' AND o.promo_id=? AND o.status NOT IN ('cancelled','refunded')", uid, seckill.id).n;
      if (bought + qty > seckill.limit_per_user) { err = `该活动商品每人限购${seckill.limit_per_user}件`; break; }
      price = seckill.price;
    }
    if (groupbuy) { if (groupbuy.sku_id !== sku.id) { err = '拼团商品不匹配'; break; } price = groupbuy.price; }
    lines.push({ sku_id: sku.id, product_id: sku.pid, name: sku.pname, spec_text: sku.spec_text, image: U.firstImg(sku.images), price, qty, template_id: sku.template_id, category_id: sku.category_id, amount: round2(price * qty), supplier: sku.supplier || null, supplier_sku: sku.supplier_sku || null, cost_price: sku.cost_price ?? null });
  }
  if (err) return { error: err };
  if (!lines.length) return { error: '没有可结算的商品' };
  if ((seckill || groupbuy) && lines.length > 1) return { error: '活动商品需单独下单' };
  const goods = round2(lines.reduce((a, l) => a + l.amount, 0));
  const level = db.get('SELECT * FROM member_levels WHERE id=?', user.level_id) || { discount: 100 };
  // 会员价:会员等级折扣与云商卡会员价取更优,不叠加
  const cloudRate = require('./cloud').discountFor(user);
  const rate100 = Math.min(level.discount, cloudRate);
  const cloudBetter = cloudRate < level.discount;
  const levelName = cloudBetter ? '云商会员价 ' + require('./cloud').fmtZhe(cloudRate / 10) + '折' : level.name;
  // 活动/秒杀/拼团价不参与;积分专区与线下门店优惠卡不走本结算流程(见 exchangePoints / storecard),永不享受会员折扣
  const levelDiscount = (seckill || groupbuy || opts.points) ? 0 : round2(goods * (100 - rate100) / 100);
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
  if (deductEnabled() && int(opts.usePoints) > 0 && !seckill && !groupbuy) {
    const maxByPct = Math.floor(afterDisc * int(S('points_max_percent'), 50) / 100);
    const yuan = Math.min(Math.floor(Math.min(int(opts.usePoints), user.points) / rate), maxByPct);
    pointsUsed = yuan * rate; pointsDiscount = yuan;
  }
  const cloudFree = require('./cloud').freeShippingFor(user);
  // 供应商发货商品:运费以供应商实时查询为准(opts.supplierFreight,结算校验时取得),不走本站运费模板;云商卡包邮时由本站承担
  const ownLines = lines.filter(l => !l.supplier), hasSupplier = ownLines.length < lines.length;
  const supplierFreight = hasSupplier ? round2(+opts.supplierFreight || 0) : 0;
  const freight = cloudFree ? 0 : round2((ownLines.length ? calcFreight(ownLines, opts.address ? opts.address.province : null) : 0) + supplierFreight);
  const pay = Math.max(0, round2(afterDisc - pointsDiscount + freight));
  return { lines, hasSupplier, supplierFreight: cloudFree ? 0 : supplierFreight, goods, levelDiscount, levelName, levelRate: rate100, cloudFree, couponDiscount, uc, pointsUsed, pointsDiscount, freight, pay, seckill, groupbuy, user, rate, maxPoints: !deductEnabled() ? 0 : Math.min(user.points, Math.floor(afterDisc * int(S('points_max_percent'), 50) / 100) * rate) };
}

function createOrder(uid, opts) {
  return db.transaction(() => {
    const q = quote(uid, opts);
    if (q.error) return { ok: false, msg: q.error };
    const a = opts.address;
    if (!a) return { ok: false, msg: '请选择收货地址' };
    // 不支持七天无理由的商品:必须由用户明确确认后才能下单
    const no7 = q.lines.filter(l => !noReasonOf(l.product_id));
    if (no7.length && !opts.no7Confirmed) return { ok: false, msg: `「${no7[0].name}」不支持7天无理由退货,请勾选「我已知晓」后再提交订单`, no7: true };
    const no = U.orderNo();
    const type = q.seckill ? 'seckill' : q.groupbuy ? 'group' : 'normal';
    const promoId = q.seckill ? q.seckill.id : q.groupbuy ? q.groupbuy.id : null;
    const r = db.exec1(`INSERT INTO orders(order_no,user_id,type,status,goods_amount,freight,level_discount,coupon_discount,points_discount,points_used,pay_amount,receiver,phone,province,city,district,detail,remark,user_coupon_id,group_id,promo_id,created_at,level_label) VALUES(?,?,?,'unpaid',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      no, uid, type, q.goods, q.freight, q.levelDiscount, q.couponDiscount, q.pointsDiscount, q.pointsUsed, q.pay, a.name, a.phone, a.province, a.city, a.district, a.detail, (opts.remark || '').slice(0, 200), q.uc ? q.uc.id : null, opts.promo && opts.promo.groupId || null, promoId, now(), q.levelDiscount > 0 ? q.levelName : null);
    const oid = r.lastInsertRowid;
    if (no7.length) db.exec1('UPDATE orders SET no7_confirmed=1 WHERE id=?', oid);
    if (q.hasSupplier) db.exec1('UPDATE orders SET supplier_freight=?, supplier_area=? WHERE id=?', q.supplierFreight, opts.supplierArea ? JSON.stringify(opts.supplierArea) : null, oid);
    for (const l of q.lines) {
      db.exec1('INSERT INTO order_items(order_id,product_id,sku_id,name,spec_text,image,price,qty,supplier,supplier_sku,cost_price) VALUES(?,?,?,?,?,?,?,?,?,?,?)', oid, l.product_id, l.sku_id, l.name, l.spec_text, l.image, l.price, l.qty, l.supplier, l.supplier_sku, l.cost_price);
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

function restoreOrderResources(o, pointsReason, opts = {}) {
  const items = db.all('SELECT * FROM order_items WHERE order_id=?', o.id);
  for (const it of items) {
    if (it.sku_id) {
      db.exec1('UPDATE skus SET stock=stock+? WHERE id=?', it.qty, it.sku_id);
      db.exec1('UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM skus WHERE product_id=?) WHERE id=?', it.product_id, it.product_id);
    }
    if (o.type === 'seckill') db.exec1('UPDATE seckills SET sold=MAX(0,sold-?) WHERE id=?', it.qty, o.promo_id);
  }
  if (o.user_coupon_id) db.exec1("UPDATE user_coupons SET status='unused', order_id=NULL WHERE id=?", o.user_coupon_id);
  if (o.type === 'points' && o.points_goods_id) db.exec1('UPDATE points_goods SET stock=stock+1, exchanged=MAX(0,exchanged-1) WHERE id=?', o.points_goods_id); // 兑换单取消/退款:库存回补
  const pts = opts.points == null ? (o.points_used || 0) : opts.points;
  if (pts > 0) addPoints(o.user_id, pts, (pointsReason || '订单取消/退款返还积分') + ' ' + o.order_no);
}
// 该订单此前已退给顾客的现金/积分(已完成的售后退款 + 供应商部分退款)
function priorRefunds(o) {
  const a = db.get("SELECT COALESCE(SUM(refund_cash),0) c, COALESCE(SUM(refund_points),0) p FROM aftersales WHERE order_id=? AND status='refunded'", o.id);
  const so = db.get('SELECT refunded_customer FROM supplier_orders WHERE order_id=?', o.id);
  const supCash = so ? +so.refunded_customer || 0 : 0;
  const supPts = supCash && o.pay_amount > 0 ? Math.round((o.points_used || 0) * Math.min(1, supCash / o.pay_amount)) : 0;
  return { cash: round2(a.c + supCash), points: a.p + supPts };
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

// 退款:现金部分「原路退回」(演示环境为模拟,真实微信退款接口后续接入),订单使用的积分退回账户。
// opts.amount:本次退款现金金额(售后部分退款);缺省为全额。部分退款按比例退回积分并扣回已奖励积分/成长值。
// 返回 { ok, cash, points, full }
function refundOrder(id, reason, silent, opts = {}) {
  const run = () => {
    const o = db.get('SELECT * FROM orders WHERE id=?', id);
    if (!o || !['paid', 'shipped', 'completed'].includes(o.status)) return { ok: false, msg: '当前状态不可退款' };
    const wasCompleted = o.status === 'completed';
    // 售后退款可分多次:此前已退部分 + 本次 ≥ 实付 时视为整单退款(订单变为已退款、不再计入销售额/销量)
    const prior = opts.aftersale && opts.amount != null ? priorRefunds(o) : { cash: 0, points: 0 };
    const cash = opts.amount == null ? o.pay_amount : Math.min(round2(o.pay_amount - prior.cash), Math.max(0, round2(opts.amount)));
    const ratio = o.pay_amount > 0 ? cash / o.pay_amount : 1;
    const full = o.pay_amount > 0 ? round2(prior.cash + cash) >= round2(o.pay_amount) - 0.001 : ratio >= 0.9999;
    const pReason = opts.aftersale ? '售后退回积分' : '订单退款返还积分';
    let points = 0;
    if (full) {
      db.exec1("UPDATE orders SET status='refunded', cancelled_at=?, cancel_reason=? WHERE id=?", now(), reason || '退款', id);
      points = Math.max(0, (o.points_used || 0) - prior.points);
      restoreOrderResources(o, pReason, { points });
      recalcSales(orderPids(id));
      // 观察期内退款:取消该订单对应的待发放邀请奖励
      db.exec1("UPDATE invite_rewards SET status='cancelled', note='首单观察期内退款,奖励取消' WHERE order_id=? AND status='pending'", id);
    } else {
      points = Math.round((o.points_used || 0) * ratio);
      if (points) addPoints(o.user_id, points, pReason + ' ' + o.order_no);
    }
    if (wasCompleted) {
      // 分次退款时最后一次扣回剩余部分,避免四舍五入累计误差
      const share = (v, r0, r1) => Math.round((v || 0) * r1) - Math.round((v || 0) * r0);
      const r0 = o.pay_amount > 0 ? prior.cash / o.pay_amount : 0, r1 = full ? 1 : r0 + ratio;
      const pa = share(o.points_awarded, r0, r1), ga = share(o.growth_awarded, r0, r1);
      if (pa) addPoints(o.user_id, -pa, '订单退款扣回奖励积分 ' + o.order_no);
      if (ga) addGrowth(o.user_id, -ga);
      db.exec1('UPDATE users SET total_spent=MAX(0,total_spent-?) WHERE id=?', cash, o.user_id);
    }
    const split = `退现金 ¥${cash.toFixed(2)}(原路退回)` + (points ? ` / 退积分 ${points}` : '');
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), (full ? '订单已退款:' : '订单部分退款:') + (reason || '') + ',' + split);
    return { ok: true, cash, points, full };
  };
  return silent ? run() : db.transaction(run)();
}

function payOrder(id, uid, method) {
  const res = db.transaction(() => {
    const o = db.get('SELECT * FROM orders WHERE id=? AND user_id=?', id, uid);
    if (!o) return { ok: false, msg: '订单不存在' };
    if (o.status !== 'unpaid') return { ok: false, msg: '订单状态不是待付款' };
    if (!['wechat', 'alipay'].includes(method)) return { ok: false, msg: '请选择支付方式' };
    // 拼团校验
    let gid = o.group_id;
    if (o.type === 'group') {
      if (gid) {
        const g = db.get('SELECT * FROM groups WHERE id=?', gid);
        if (!g || g.status !== 'open' || g.expire_at < now() || g.joined >= g.need) return { ok: false, msg: '该团已成团,请返回商品页自己开团' };
      }
    }
    db.exec1("UPDATE orders SET status='paid', pay_method=?, paid_at=? WHERE id=?", method, now(), id);
    recalcSales(orderPids(id));
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), `订单支付成功(${U.PAY_METHOD[method]}),等待商家发货`);
    if (o.type === 'group') {
      const gb = db.get('SELECT * FROM groupbuys WHERE id=?', o.promo_id);
      if (!gid) {
        const r = db.exec1("INSERT INTO groups(groupbuy_id,leader_id,need,joined,status,expire_at,created_at) VALUES(?,?,?,0,'open',?,?)", gb.id, uid, gb.size, U.offset(groupAutoDelayMs()), now());
        gid = r.lastInsertRowid; db.exec1('UPDATE orders SET group_id=? WHERE id=?', gid, id);
      }
      db.exec1('INSERT INTO group_members(group_id,user_id,order_id) VALUES(?,?,?)', gid, uid, id);
      db.exec1('UPDATE groups SET joined=joined+1 WHERE id=?', gid);
      const g = db.get('SELECT * FROM groups WHERE id=?', gid);
      if (g.joined >= g.need) markGroupSuccess(gid, false);
      else db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), '拼团中,邀请好友一起拼');
    }
    jdvop().onPaid(id); // 含供应商商品:登记待推送(支付确认之后才向供应商下单)
    return { ok: true };
  })();
  if (res.ok) setImmediate(() => jdvop().kick());
  return res;
}
const jdvop = () => require('./suppliers/jdvop');

function shipOrder(id, company, tracking) {
  return db.transaction(() => {
    const o = db.get('SELECT * FROM orders WHERE id=?', id);
    if (!o || o.status !== 'paid') return { ok: false, msg: '仅待发货订单可发货' };
    if (o.type === 'group') { const g = db.get('SELECT status FROM groups WHERE id=?', o.group_id); if (g && g.status !== 'success') return { ok: false, msg: '拼团尚未成功,不能发货' }; }
    // 含供应商商品的订单:这里只发「自营部分」,供应商部分由供应商发货,全部发出后订单才变为待收货
    const supN = db.get("SELECT COUNT(*) n FROM order_items WHERE order_id=? AND supplier IS NOT NULL", id).n;
    if (supN) {
      const ownN = db.get("SELECT COUNT(*) n FROM order_items WHERE order_id=? AND supplier IS NULL", id).n;
      if (!ownN) return { ok: false, msg: '该订单商品均由供应商发货,无需手动发货' };
      if (o.own_shipped_at) return { ok: false, msg: '自营商品已发货,等待供应商发货' };
      db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), `自营商品已发货,${company} 运单号 ${tracking}`);
      jdvop().ownShipped(id, company, tracking);
      return { ok: true, partial: db.get('SELECT status FROM orders WHERE id=?', id).status !== 'shipped' };
    }
    db.exec1("UPDATE orders SET status='shipped', express_company=?, tracking_no=?, shipped_at=? WHERE id=?", company, tracking, now(), id);
    const t = now();
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, t, `商家已发货,${company} 运单号 ${tracking}`);
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, t, `${company} 已揽收包裹`);
    return { ok: true };
  })();
}
const TRACE_STEPS = ['包裹已到达【始发地分拨中心】', '包裹已发往【目的地转运中心】', '包裹已到达【目的地转运中心】', '快递员正在派送中,请保持电话畅通', '包裹已签收,感谢您在韵农甄选购物'];
function advanceTrace(id) {
  const o = db.get('SELECT * FROM orders WHERE id=?', id);
  if (!o || o.status !== 'shipped') return false;
  if (db.get('SELECT 1 FROM order_items WHERE order_id=? AND supplier IS NOT NULL', id)) return false; // 供应商包裹:轨迹来自供应商接口
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
    inviteOnComplete(o);
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', id, now(), '买家已确认收货,交易完成');
    return { ok: true };
  })();
}

function sweep() {
  try { require('./chat').purgeImages(); } catch (e) { console.error('chat purge error', e); }
  try {
    const mins = int(S('unpaid_cancel_minutes'), 30);
    for (const o of db.all("SELECT id FROM orders WHERE status='unpaid' AND created_at<?", U.offset(-mins * 60000))) cancelOrder(o.id, '超时未支付自动取消');
    const days = int(S('auto_confirm_days'), 7);
    for (const o of db.all("SELECT id FROM orders WHERE status='shipped' AND shipped_at<?", U.offset(-days * 86400000))) completeOrder(o.id);
    autoSucceedGroups();
    settleInvites();
    expirePointLots();
    remindExpiringPoints();
  } catch (e) { console.error('sweep error', e); }
}

function notifyService(uid, sender, content) { const r = db.exec1('INSERT INTO messages(user_id,sender,content,created_at,is_read) VALUES(?,?,?,?,?)', uid, sender, content, now(), sender === 'user' ? 0 : 0); require('./bus').pub(uid, 'msg', r && r.lastInsertRowid, sender); }
const FAQ = [
  [/发货|物流|快递/, '一般下单后 24 小时内发货,您可在「我的订单 - 查看物流」查看实时轨迹。'],
  [/退|换|售后/, '如需售后,请在订单详情点击「联系客服申请售后」,客服核实后为您创建售后单。商品签收后 7 天内可申请无理由退货(含生鲜农产品;积分兑换商品非质量问题不退不换),质量问题可退换;退款原路退回,下单使用的积分同步退回。'],
  [/优惠券|券/, '您可以在「领券中心」领取优惠券,结算时选择使用即可。'],
  [/积分/, () => (deductEnabled() ? '积分可在下单时抵扣部分金额或在「积分专区」兑换商品,' : '积分可在「积分专区」兑换商品,') + '每日签到可得积分,具体见帮助中心《积分规则》。'],
  [/发票/, '订单支付后可在订单详情申请发票,电子发票将在 1-3 个工作日内开具。'],
  [/运费|包邮/, '普通商品单笔满 ¥99 包邮(大件、偏远地区除外);大件商品(如手机、笔记本电脑)及新疆、西藏地区运费按商品页「运费」栏标示收取,具体以结算页为准。']
];
const BOT_FALLBACK = '您好,已收到您的留言,人工客服将尽快回复您。常见问题可查看「帮助中心」。';
const BOT_OFFHOURS = '您好,已收到您的留言。当前为非客服时间,客服上班后会尽快回复您。';
const PINNED_QUICK = '积分怎么用'; // 固定快捷问题,后台设置不可移除
// 客服时间:取设置 service_hours 中的 H:MM - H:MM,默认 9:00-22:00(北京时间,TZ=Asia/Shanghai)
function serviceHours() { const m = String(S('service_hours') || '').match(/(\d{1,2})[::](\d{2})\s*[-–~至到]\s*(\d{1,2})[::](\d{2})/); return m ? [+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]] : [540, 1320]; }
function isOffHours(ts) { const t = ts || U.now(); const mins = +t.slice(11, 13) * 60 + +t.slice(14, 16); const [a, b] = serviceHours(); return a < b ? (mins < a || mins >= b) : (mins < a && mins >= b); }
function quickAnswer(text) { for (const [re, a] of FAQ) if (re.test(text)) return typeof a === 'function' ? a() : a; return BOT_FALLBACK; }
// 自动回复规则:
//  - 点击快捷问题(quick=true):每次都给对应的固定答案;
//  - 手动输入:仅在本会话首条手动消息时回复一次(非客服时间发「客服上班后会尽快回复您」,否则发通用兜底),
//    之后的手动消息一律不自动回复(不做关键词匹配);人工客服回复后视为新会话,重新计数。
function botReply(text, uid, o = {}) {
  if (o.quick) return quickAnswer(text);
  if (uid) {
    const lastStaff = (db.get("SELECT MAX(id) m FROM messages WHERE user_id=? AND sender='staff'", uid) || {}).m || 0;
    if (db.get("SELECT 1 FROM messages WHERE user_id=? AND sender='bot' AND content IN (?,?) AND id>?", uid, BOT_FALLBACK, BOT_OFFHOURS, lastStaff)) return null;
  }
  return isOffHours(o.now) ? BOT_OFFHOURS : BOT_FALLBACK;
}

const cloud = require('./cloud');
// 每日签到:当日所得总积分(云商卡有效会员按会员档,不与普通档叠加)。连续第 n 天 = 首日 + 递增×(n-1),封顶
const SIGNIN_KEYS = ['signin_base', 'signin_step', 'signin_max', 'cloud_signin_base', 'cloud_signin_step', 'cloud_signin_max'];
function signinCfg() {
  const g = (k, d) => { const v = parseInt(S(k), 10); return Number.isFinite(v) && v >= 0 ? v : d; };
  const n = { base: g('signin_base', 12), step: g('signin_step', 1), max: g('signin_max', 18) };
  const c = { base: g('cloud_signin_base', 37), step: g('cloud_signin_step', 2), max: g('cloud_signin_max', 55) };
  n.max = Math.max(n.max, n.base); c.max = Math.max(c.max, c.base);
  return { normal: n, cloud: c };
}
function signinPoints(streak, cloud, cfg) { const r = (cfg || signinCfg())[cloud ? 'cloud' : 'normal']; return Math.min(r.max, r.base + r.step * (Math.max(1, streak | 0) - 1)); }
function signinSeries(cloud, cfg) { cfg = cfg || signinCfg(); const r = cfg[cloud ? 'cloud' : 'normal'], out = []; for (let d = 1; d <= 12; d++) { const v = signinPoints(d, cloud, cfg); out.push(v); if (v >= r.max || !r.step) break; } return out; }
module.exports = { groupAutoMaxMinutes, groupAutoHours, autoSucceedGroups, markGroupSuccess, SIGNIN_KEYS, signinCfg, signinPoints, signinSeries, recalcSales, BANNED_DEFAULT, ANNOUNCEMENT, settings, S, setSetting, addPoints, expirePointLots, expiringPoints, cycleExpireAt, cyclePointsExpiry, remindExpiringPoints, wechatSubscribeNotify, deductEnabled, redeemedCount, redeemLeft, redeemPointsGoods, pgPrice, zoneRatio, publicInfo, fillOperator, settleInvites, inviteOnComplete, noReasonOf, addGrowth, refreshLevel, createUser, grantCoupon, userCoupons, calcFreight, quote, createOrder, cancelOrder, refundOrder, payOrder, shipOrder, advanceTrace, completeOrder, sweep, activeSeckill, expireGroups, notifyService, botReply, BOT_FALLBACK, BOT_OFFHOURS, PINNED_QUICK, isOffHours, quickAnswer, parseRules, cloud };
