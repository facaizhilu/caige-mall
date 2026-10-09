// 云商卡:会员权益卡,线下销售,由后台为会员手动开通/续期/停用(不在线售卖,不与邀请/推荐挂钩)
// 权益:会员价折扣、包邮、主动签到时加赠积分(按连续签到天数递增、每天封顶、到期作废)。不发放每日自动积分,无推荐奖励。
const db = require('./db');
const U = require('./util');
const { now, int, num, round2 } = U;

const TIER_LABEL = { silver: '白银', gold: '黄金' };
const DURATION_LABEL = { month: '月卡', quarter: '季卡', year: '年卡' };
const DURATION_DAYS = { month: 30, quarter: 90, year: 365 };

// 保守的占位默认值,可在后台「云商卡配置」调整
const CLOUD_DEFAULTS = {
  cloud_discount: '98',          // 会员价:商品售价 × 98%(与会员等级折扣取更优,不叠加)
  cloud_free_shipping: '1',      // 1=会员订单免运费
  cloud_signin_extra: '25',      // 主动签到加赠:连续签到第 1 天的加赠积分
  cloud_signin_extra_step: '2',  // 此后每连续签到 1 天多加赠的积分(25、27、29……);中断后从第 1 天重新计算
  cloud_signin_extra_max: '35',  // 每天加赠封顶:递增到该值后不再增加(25、27、29、31、33、35、35……)
  cloud_extra_expire_days: '90'  // 加赠积分有效期(天),到期未使用自动作废
};

function ensureDefaults() {
  const svc = require('./svc');
  for (const [k, v] of Object.entries(CLOUD_DEFAULTS)) if (svc.S(k) == null) svc.setSetting(k, v);
}
function cfg() {
  const svc = require('./svc');
  const g = k => svc.S(k) == null ? CLOUD_DEFAULTS[k] : svc.S(k);
  return {
    discount: Math.min(100, Math.max(1, int(g('cloud_discount'), 98))),
    freeShipping: String(g('cloud_free_shipping')) === '1',
    signinExtra: Math.max(0, int(g('cloud_signin_extra'), 25)),
    signinStep: Math.max(0, int(g('cloud_signin_extra_step'), 2)),
    signinMax: Math.max(0, int(g('cloud_signin_extra_max'), 35)),
    expireDays: Math.max(1, int(g('cloud_extra_expire_days'), 90))
  };
}

function isCardActive(u, when) {
  if (!u || !u.cloud_tier) return false;
  const t = when || now();
  return !!(u.cloud_end && u.cloud_start && u.cloud_start <= t && u.cloud_end >= t);
}
function cardStatus(u) {
  if (!u || !u.cloud_tier) return { active: false, label: '未开通', tier: '', tierLabel: '' };
  const active = isCardActive(u);
  const tierLabel = TIER_LABEL[u.cloud_tier] || u.cloud_tier;
  return { active, label: active ? tierLabel + '会员权益生效中' : '会员权益已到期', tier: u.cloud_tier, tierLabel, start: u.cloud_start, end: u.cloud_end };
}

const fmtDay = d => U.fmtDate(d).slice(0, 10);
function addDays(dateStr, days) { const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00'); d.setDate(d.getDate() + days); return fmtDay(d); }

/** 后台开通/续期(记录线下销售信息)。f: {card_type_id, amount, sale_date, staff, receipt_note, start, end} */
function grant(uid, f, adminId) {
  const u = db.get('SELECT * FROM users WHERE id=?', uid);
  if (!u || u.cancelled_at) return { ok: false, msg: '会员不存在或已注销' };
  const ct = db.get('SELECT * FROM cloud_card_types WHERE id=?', int(f.card_type_id));
  if (!ct) return { ok: false, msg: '请选择卡类型' };
  const amount = round2(num(f.amount, -1));
  if (!(amount >= 0)) return { ok: false, msg: '请填写实收金额(线下销售金额)' };
  const saleDate = String(f.sale_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(saleDate)) return { ok: false, msg: '请填写销售日期' };
  const staff = String(f.staff || '').trim().slice(0, 40);
  if (!staff) return { ok: false, msg: '请填写经办员工' };
  const active = isCardActive(u);
  // 默认:生效中则从原到期日顺延,否则从今天起算;可手动指定起止日期
  let start = String(f.start || '').slice(0, 10) || (active ? String(u.cloud_start).slice(0, 10) : fmtDay(new Date()));
  let end = String(f.end || '').slice(0, 10) || addDays(active ? u.cloud_end : start, DURATION_DAYS[ct.duration] || 30);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) return { ok: false, msg: '起止日期无效' };
  const s = start + ' 00:00:00', e = end + ' 23:59:59';
  db.exec1('UPDATE users SET cloud_tier=?, cloud_start=?, cloud_end=?, cloud_card_type_id=? WHERE id=?', ct.tier, s, e, ct.id, uid);
  db.exec1('INSERT INTO cloud_card_sales(user_id,action,card_type_id,amount,sale_date,staff,receipt_note,start_at,end_at,admin_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    uid, active ? 'renew' : 'open', ct.id, amount, saleDate, staff, String(f.receipt_note || '').slice(0, 200), s, e, adminId || null, now());
  return { ok: true, msg: `已${active ? '续期' : '开通'}「${ct.name}」,有效期至 ${end}` };
}
function stop(uid, note, adminId) {
  const u = db.get('SELECT * FROM users WHERE id=?', uid);
  if (!u || !u.cloud_tier) return { ok: false, msg: '该会员未开通云商卡' };
  const t = now();
  if (u.cloud_end > t) db.exec1('UPDATE users SET cloud_end=? WHERE id=?', U.offset(-1000), uid);
  db.exec1('INSERT INTO cloud_card_sales(user_id,action,card_type_id,amount,sale_date,staff,receipt_note,start_at,end_at,admin_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    uid, 'stop', u.cloud_card_type_id || null, 0, t.slice(0, 10), '', String(note || '').slice(0, 200), u.cloud_start, t, adminId || null, t);
  return { ok: true, msg: '已停用该会员的云商卡权益' };
}

/** 会员价折扣率(%),非会员返回 100 */
function discountFor(u) { return isCardActive(u) ? cfg().discount : 100; }
function freeShippingFor(u) { return isCardActive(u) && cfg().freeShipping; }

/** 第 streak 个连续签到日的会员加赠积分:基数 + 递增 ×(streak-1),每天不超过封顶值 */
function extraForStreak(streak, c) { c = c || cfg(); return Math.min(Math.max(c.signinMax, c.signinExtra), c.signinExtra + c.signinStep * (Math.max(1, int(streak, 1)) - 1)); }
/** 加赠积分序列示例(到封顶为止,最多 8 项),用于页面说明 */
function extraSeries(c) { c = c || cfg(); const out = []; for (let d = 1; d <= 8; d++) { const v = extraForStreak(d, c); out.push(v); if (v >= Math.max(c.signinMax, c.signinExtra) || !c.signinStep) break; } return out; }
/** 主动签到时的会员加赠积分(按连续签到天数递增,到期作废)。streak 缺省取用户当前连续签到天数。返回实际加赠数 */
function signinExtra(uid, addPoints, streak) {
  const u = db.get('SELECT * FROM users WHERE id=?', uid);
  if (!isCardActive(u)) return 0;
  const c = cfg();
  const pts = extraForStreak(streak == null ? (u.signin_streak || 1) : streak, c);
  if (pts <= 0) return 0;
  const exp = addDays(U.today(), c.expireDays) + ' 23:59:59';
  addPoints(uid, pts, `云商卡会员签到加赠(${exp.slice(0, 10)} 前有效)`, { expireAt: exp });
  return pts;
}

module.exports = { extraForStreak, extraSeries, TIER_LABEL, DURATION_LABEL, DURATION_DAYS, CLOUD_DEFAULTS, ensureDefaults, cfg, isCardActive, cardStatus, grant, stop, discountFor, freeShippingFor, signinExtra };
