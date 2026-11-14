// 活动专区「邀三位好友下单，你这单我们请」
// 规则：用户支付活动专区订单后，该订单生成一个邀请活动（ac_campaigns）。好友通过邀请链接（?ac=邀请码）进入活动专区，
// 下单并付款活动专区商品即计入（ac_friends）；30 天内计入 3 位，邀请人获得等额活动专区专享券（封顶，后台可设）。
// 好友退款/取消 → 未计入；发券后好友退款：券未使用则收回，已使用转人工审核；邀请人本单退款 → 活动失效。
// 收货地址、收货手机号、付款人标识与邀请人或同活动其他好友重复 → 审核中（人工审核）。
// 进度一律由 progress() 实时计算：活动专区横幅、订单详情卡、我的免单、后台页面共用。
const db = require('./db');
const U = require('./util');
const { now, int, round2 } = U;
const svc = () => require('./svc');
const NEED = 3;
const DEFAULTS = {
  ac_on: '1', ac_days: '30', ac_cap: '100', ac_coupon_days: '30', ac_review_days: '3',
  ac_time: '以活动页公告为准', ac_title: '好物一起买，邀三位好友下单，你这单我们请', ac_subtitle: '',
  ac_note: '仅限活动专区商品，好友下单付款即计入，详见活动规则',
  ac_share_title: '韵农甄选 · 活动专区好物'
};
db.exec(`CREATE TABLE IF NOT EXISTS ac_campaigns(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, order_id INTEGER NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open', expire_at TEXT, reward_amount REAL, user_coupon_id INTEGER, review_note TEXT, note TEXT,
  unread INTEGER DEFAULT 0, popup INTEGER DEFAULT 0, created_at TEXT, done_at TEXT);
CREATE INDEX IF NOT EXISTS idx_ac_c_user ON ac_campaigns(user_id);
CREATE TABLE IF NOT EXISTS ac_friends(id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, order_id INTEGER NOT NULL UNIQUE,
  state TEXT NOT NULL, reason TEXT, flag TEXT, counted_at TEXT, reviewed_by TEXT, created_at TEXT);
CREATE INDEX IF NOT EXISTS idx_ac_f_c ON ac_friends(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ac_f_friend ON ac_friends(friend_id);`);
{
  const cols = t => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name));
  if (!cols('orders').has('ac_campaign_id')) db.exec('ALTER TABLE orders ADD COLUMN ac_campaign_id INTEGER');
  if (!cols('orders').has('payer_id')) db.exec('ALTER TABLE orders ADD COLUMN payer_id TEXT'); // 付款人标识(正式接入微信支付后写入 openid;演示环境为空)
  if (!cols('coupons').has('scope')) db.exec("ALTER TABLE coupons ADD COLUMN scope TEXT DEFAULT ''"); // activity = 仅限活动专区
  for (const [k, v] of Object.entries(DEFAULTS)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);
}
const S = k => { const v = svc().S(k); return v == null ? DEFAULTS[k] : v; };
const cfg = () => ({ on: S('ac_on') === '1', days: Math.max(1, int(S('ac_days'), 30)), cap: Math.max(0, +S('ac_cap') || 0), couponDays: Math.max(1, int(S('ac_coupon_days'), 30)), reviewDays: Math.max(1, int(S('ac_review_days'), 3)), time: S('ac_time'), title: S('ac_title'), subtitle: S('ac_subtitle'), note: S('ac_note'), shareTitle: S('ac_share_title'), need: NEED });
const maskP = p => { p = String(p || ''); return /^\d{11}$/.test(p) ? U.maskPhone(p) : (p ? p.slice(0, 3) + '****' : '****'); };
const mask = s => { s = String(s || '').trim(); return s ? [...s][0] + '**' : '**'; };
const addDays = (t, d) => U.fmtDate(new Date(U.parseDate(t).getTime() + d * 86400000));
const genCode = () => { for (;;) { const c = 'A' + require('crypto').randomBytes(4).toString('hex').toUpperCase().slice(0, 7); if (!db.get('SELECT 1 FROM ac_campaigns WHERE code=?', c)) return c; } };
const isActivity = o => o && o.type === 'seckill';
const refunded = o => !o || o.status === 'refunded' || o.status === 'cancelled' || svc().inviteHasRefund(o.id);
const REASON = { refund: '好友已退款，未计入', self: '本人下单不计入', dup: '该好友已计入过', late: '已超过30天', rejected: '审核未通过，未计入', ended: '活动已结束' };

function notify(c, text) {
  svc().notifyService(c.user_id, 'system', '【活动专区邀请】' + text);
  db.exec1('UPDATE ac_campaigns SET unread=1 WHERE id=?', c.id);
}
// 邀请人看到的好友身份:默认头像 + 打码手机号(如 130****2001),不显示昵称、商品、金额
const whoOf = uid => { const u = db.get('SELECT phone FROM users WHERE id=?', uid); return maskP(u && u.phone); };
const countedN = cid => db.get("SELECT COUNT(*) n FROM ac_friends WHERE campaign_id=? AND state='counted'", cid).n;

// 下单时：读取邀请码，活动专区订单记录所属邀请活动（好友不需填写任何内容）
function attach(uid, orderId, code) {
  code = String(code || '').trim().toUpperCase(); if (!code || !cfg().on) return null;
  const o = db.get('SELECT * FROM orders WHERE id=?', orderId); if (!isActivity(o)) return null;
  const c = db.get("SELECT * FROM ac_campaigns WHERE code=? AND status IN ('open','expired','done','frozen')", code); if (!c) return null;
  db.exec1('UPDATE orders SET ac_campaign_id=? WHERE id=?', c.id, orderId);
  return c.id;
}

// 风控比对：收货手机号 / 收货地址 / 付款人标识与邀请人订单或同活动其他好友订单重复
const addrKey = o => [o.province, o.city, o.district, o.detail].map(x => String(x || '').replace(/\s+/g, '')).join('|');
function fraudFlag(c, o) {
  const inviter = db.get('SELECT * FROM orders WHERE id=?', c.order_id);
  const others = db.all("SELECT o.* FROM ac_friends f JOIN orders o ON o.id=f.order_id WHERE f.campaign_id=? AND f.order_id<>? AND f.state<>'void'", c.id, o.id);
  const hits = [];
  for (const [who, x] of [['邀请人', inviter], ...others.map(x => ['其他好友', x])]) {
    if (!x) continue;
    if (o.phone && x.phone === o.phone) hits.push('收货手机号与' + who + '相同');
    if (o.detail && addrKey(x) === addrKey(o)) hits.push('收货地址与' + who + '相同');
    if (o.payer_id && x.payer_id === o.payer_id) hits.push('付款人与' + who + '相同');
  }
  return [...new Set(hits)].join('；');
}

// 支付成功后调用（在 payOrder 事务内）
function onPaid(orderId) {
  const o = db.get('SELECT * FROM orders WHERE id=?', orderId); if (!isActivity(o) || o.status !== 'paid') return;
  const t = now();
  if (o.ac_campaign_id && !db.get('SELECT 1 FROM ac_friends WHERE order_id=?', o.id)) {
    const c = db.get('SELECT * FROM ac_campaigns WHERE id=?', o.ac_campaign_id);
    if (c) {
      let state = 'counted', reason = null, flag = null;
      const who = whoOf(o.user_id);
      if (o.user_id === c.user_id) { state = 'void'; reason = REASON.self; }
      else if (c.status === 'void') { state = 'void'; reason = REASON.ended; }
      else if (o.created_at > c.expire_at || t > c.expire_at) { state = 'void'; reason = REASON.late; }
      else if (db.get("SELECT 1 FROM ac_friends f JOIN ac_campaigns c2 ON c2.id=f.campaign_id WHERE f.friend_id=? AND c2.user_id=? AND f.state IN ('counted','review')", o.user_id, c.user_id)) { state = 'void'; reason = REASON.dup; }
      else if (c.status === 'done' || c.status === 'expired' || countedN(c.id) >= NEED) { state = 'void'; reason = REASON.ended; }
      else { flag = fraudFlag(c, o); if (flag) state = 'review'; }
      db.exec1('INSERT INTO ac_friends(campaign_id,friend_id,order_id,state,reason,flag,counted_at,created_at) VALUES(?,?,?,?,?,?,?,?)', c.id, o.user_id, o.id, state, reason, flag, state === 'counted' ? t : null, t);
      if (state === 'counted') notify(c, `好友 ${who} 已下单付款，已计入 ${countedN(c.id)}/${NEED}`);
      else if (state === 'review') notify(c, `好友 ${who} 已下单付款，订单进入人工审核，${cfg().reviewDays} 个工作日内出结果`);
      else notify(c, `好友 ${who} 已下单付款，未计入：${reason}`);
      settle(c.id);
    }
  }
  // 使用活动专区专享券的订单不再生成新一轮邀请(否则用券即开新一轮);实付为 0 的订单也不生成
  const usedAcCoupon = o.user_coupon_id && db.get("SELECT 1 FROM user_coupons uc JOIN coupons cp ON cp.id=uc.coupon_id WHERE uc.id=? AND cp.scope='activity'", o.user_coupon_id);
  if (cfg().on && !usedAcCoupon && o.pay_amount > 0 && !db.get('SELECT 1 FROM ac_campaigns WHERE order_id=?', o.id))
    db.exec1("INSERT INTO ac_campaigns(user_id,order_id,code,status,expire_at,created_at) VALUES(?,?,?,'open',?,?)", o.user_id, o.id, genCode(), addDays(t, cfg().days), t);
}

function revokeCoupon(c) {
  const uc = c.user_coupon_id ? db.get('SELECT * FROM user_coupons WHERE id=?', c.user_coupon_id) : null;
  if (!uc) return 'none';
  if (uc.status === 'used') return 'used';
  db.exec1('DELETE FROM user_coupons WHERE id=?', uc.id); // 收回未使用(含冻结)的券
  return 'revoked';
}
// 发券后好友退款:未使用的券冻结(不可用),再计入满 3 位恢复;已使用的转人工审核
function freezeCoupon(c) {
  const uc = c.user_coupon_id ? db.get('SELECT * FROM user_coupons WHERE id=?', c.user_coupon_id) : null;
  if (!uc) return 'none';
  if (uc.status === 'used') return 'used';
  db.exec1("UPDATE user_coupons SET status='frozen' WHERE id=?", uc.id);
  return 'frozen';
}

// 订单退款/取消时调用（好友订单或邀请人订单）
function onRefund(orderId) {
  const o = db.get('SELECT * FROM orders WHERE id=?', orderId); if (!o) return;
  const f = db.get('SELECT * FROM ac_friends WHERE order_id=?', o.id);
  if (f && f.state !== 'void' && refunded(o)) {
    const c = db.get('SELECT * FROM ac_campaigns WHERE id=?', f.campaign_id);
    db.exec1("UPDATE ac_friends SET state='void', reason=? WHERE id=?", REASON.refund, f.id);
    const who = whoOf(f.friend_id);
    if (c.status === 'done' && f.state === 'counted') {
      const r = freezeCoupon(c);
      if (r === 'used') { db.exec1("UPDATE ac_campaigns SET review_note=? WHERE id=?", `好友 ${who} 在发券后退款，免单券已使用，待人工审核`, c.id); notify(c, `好友 ${who} 已退款，未计入。你的免单券已使用，平台将人工审核处理`); }
      else if (r === 'none') { db.exec1("UPDATE ac_campaigns SET status='open' WHERE id=?", c.id); notify(c, `好友 ${who} 已退款，未计入，当前 ${countedN(c.id)}/${NEED}`); settle(c.id); }
      else { db.exec1("UPDATE ac_campaigns SET status='frozen', popup=0 WHERE id=?", c.id); const n = countedN(c.id); notify(c, `好友 ${who} 已退款，未计入，当前 ${n}/${NEED}；你的免单券已冻结，再邀 ${NEED - n} 位好友下单付款即可恢复`); settle(c.id); }
    } else notify(c, `好友 ${who} 已退款，未计入，当前 ${countedN(c.id)}/${NEED}`);
  }
  const c = db.get('SELECT * FROM ac_campaigns WHERE order_id=?', o.id);
  if (c && c.status !== 'void' && refunded(o)) {
    let extra = '';
    if (c.status === 'done' || c.status === 'frozen') { const r = revokeCoupon(c); if (r === 'revoked') extra = '，未使用的免单券已收回'; else if (r === 'used') { extra = '，免单券已使用，平台将人工审核处理'; db.exec1('UPDATE ac_campaigns SET review_note=? WHERE id=?', '邀请人本单发券后退款，免单券已使用，待人工审核', c.id); } }
    db.exec1("UPDATE ac_campaigns SET status='void', note='邀请人本单已退款' WHERE id=?", c.id);
    notify(c, '你的活动订单已退款，本单邀请活动已失效' + extra);
  }
}

// 计入满 3 位发券；超过 30 天未满结束。幂等，可重复调用
function settle(cid) {
  const c = db.get('SELECT * FROM ac_campaigns WHERE id=?', cid); if (!c || (c.status !== 'open' && c.status !== 'frozen')) return;
  const o = db.get('SELECT * FROM orders WHERE id=?', c.order_id);
  if (refunded(o)) return onRefund(c.order_id);
  const n = countedN(c.id);
  if (n >= NEED && c.status === 'frozen') {
    db.exec1("UPDATE user_coupons SET status='unused' WHERE id=? AND status='frozen'", c.user_coupon_id);
    db.exec1("UPDATE ac_campaigns SET status='done', popup=1 WHERE id=?", c.id);
    notify(c, `已计入 ${NEED}/${NEED}，你这单的免单券已恢复，可正常使用`);
    return;
  }
  if (n >= NEED) {
    const amt = round2(Math.min(o.pay_amount, cfg().cap));
    if (!(amt > 0)) { db.exec1("UPDATE ac_campaigns SET status='done', reward_amount=0, done_at=? WHERE id=?", now(), c.id); return; }
    const cpn = Number(db.exec1("INSERT INTO coupons(name,threshold,amount,total,claimed,per_limit,valid_days,status,description,scope,created_at) VALUES(?,0,?,1,0,1,?,1,?,'activity',?)", '活动专区专享券', amt, cfg().couponDays, '邀请好友活动奖励，仅限活动专区商品使用，不与其他优惠叠加，不可兑换现金', now()).lastInsertRowid);
    svc().grantCoupon(c.user_id, cpn, true);
    const uc = db.get('SELECT id FROM user_coupons WHERE user_id=? AND coupon_id=? ORDER BY id DESC', c.user_id, cpn);
    db.exec1("UPDATE ac_campaigns SET status='done', reward_amount=?, user_coupon_id=?, done_at=?, popup=1 WHERE id=?", amt, uc.id, now(), c.id);
    notify(c, `你这单的免单券已到账：¥${amt.toFixed(2)} 活动专区专享券，${cfg().couponDays} 天内有效，可在「我的-优惠券」查看`);
    return;
  }
  if (now() > c.expire_at && n + db.get("SELECT COUNT(*) n FROM ac_friends WHERE campaign_id=? AND state='review'", c.id).n < NEED) {
    const fz = c.status === 'frozen' && revokeCoupon(c) === 'revoked';
    db.exec1("UPDATE ac_campaigns SET status='expired' WHERE id=?", c.id);
    notify(c, `邀请已超过${cfg().days}天，本单邀请活动已结束（已计入 ${n}/${NEED}）` + (fz ? '，冻结的免单券已失效' : ''));
  }
}
function sweep() {
  for (const c of db.all("SELECT id FROM ac_campaigns WHERE status IN ('open','frozen')")) try { db.transaction(() => settle(c.id))(); } catch (e) { console.error('ac settle', e); }
}

// 后台人工审核
function review(fid, approve, admin) {
  return db.transaction(() => {
    const f = db.get("SELECT * FROM ac_friends WHERE id=? AND state='review'", fid); if (!f) return { ok: false, msg: '该记录不在审核中' };
    const c = db.get('SELECT * FROM ac_campaigns WHERE id=?', f.campaign_id), who = whoOf(f.friend_id);
    const o = db.get('SELECT * FROM orders WHERE id=?', f.order_id);
    if (refunded(o)) { db.exec1("UPDATE ac_friends SET state='void', reason=?, reviewed_by=? WHERE id=?", REASON.refund, admin, f.id); notify(c, `好友 ${who} 已退款，未计入`); return { ok: true }; }
    if (approve && (c.status === 'open' || c.status === 'frozen') && countedN(c.id) < NEED) {
      db.exec1("UPDATE ac_friends SET state='counted', counted_at=?, reviewed_by=? WHERE id=?", now(), admin, f.id);
      notify(c, `好友 ${who} 审核通过，已计入 ${countedN(c.id)}/${NEED}`); settle(c.id);
    } else {
      const reason = approve ? REASON.ended : REASON.rejected;
      db.exec1("UPDATE ac_friends SET state='void', reason=?, reviewed_by=? WHERE id=?", reason, admin, f.id);
      notify(c, `好友 ${who} ${approve ? '审核通过但' : ''}未计入：${reason}`);
    }
    return { ok: true };
  })();
}

// ---- 展示：唯一数据来源 ----
const C_STATUS = { open: '邀请中', done: '免单券已到账', frozen: '免单券已冻结', expired: '已结束', void: '已失效' };
function slotOf(f) {
  if (f.state === 'counted') return { k: 'ok', label: '已计入' };
  if (f.state === 'review') return { k: 'review', label: '审核中', reason: `${cfg().reviewDays} 个工作日内出结果` };
  return { k: 'void', label: '未计入', reason: f.reason || '' };
}
function progress(cOrId) {
  const c = typeof cOrId === 'object' ? cOrId : db.get('SELECT * FROM ac_campaigns WHERE id=?', cOrId); if (!c) return null;
  const friends = db.all('SELECT f.*, u.nickname, u.phone friend_phone, o.order_no, o.pay_amount, o.status o_status FROM ac_friends f LEFT JOIN users u ON u.id=f.friend_id LEFT JOIN orders o ON o.id=f.order_id WHERE f.campaign_id=? ORDER BY f.id', c.id)
    .map(f => ({ ...f, who: maskP(f.friend_phone), slot: slotOf(f) }));
  const counted = friends.filter(f => f.state === 'counted').length, inReview = friends.filter(f => f.state === 'review').length;
  const o = db.get('SELECT order_no, pay_amount FROM orders WHERE id=?', c.order_id) || {};
  const uc = c.user_coupon_id ? db.get('SELECT * FROM user_coupons WHERE id=?', c.user_coupon_id) : null;
  // 3 个圆点：已计入优先亮起，其次审核中，余下为空位
  const slots = [...friends.filter(f => f.state === 'counted'), ...friends.filter(f => f.state === 'review')].slice(0, NEED).map(f => ({ who: f.who, ...f.slot }));
  while (slots.length < NEED) slots.push({ k: 'empty', label: '待邀请' });
  return { c, id: c.id, code: c.code, status: c.status, statusLabel: C_STATUS[c.status] || c.status, need: NEED, counted: Math.min(counted, NEED), left: Math.max(0, NEED - counted), inReview, friends, slots, deadline: String(c.expire_at || '').slice(0, 10), orderNo: o.order_no, payAmount: o.pay_amount, reward: c.reward_amount, coupon: uc, reviewNote: c.review_note };
}
const ofOrder = oid => { const c = db.get('SELECT * FROM ac_campaigns WHERE order_id=?', oid); return c ? progress(c) : null; };
const ofUser = uid => db.all('SELECT * FROM ac_campaigns WHERE user_id=? ORDER BY id DESC', uid).map(progress);
const current = uid => { const c = db.get("SELECT * FROM ac_campaigns WHERE user_id=? AND status='open' ORDER BY id DESC LIMIT 1", uid); return c ? progress(c) : null; };
// 活动规则(伙伴定稿原文,11 条)。动态值:活动时间(ac_time)、封顶金额、天数、审核时限取后台设置;客服电话取站点设置,未配置时引导到「我的」→「在线客服」
// items: [标题, 正文或子项数组];返回值中正文均为已转义的 HTML 片段
function rules() {
  const c = cfg(), S2 = k => String(svc().S(k) || '').trim(), e = U.esc, phone = S2('service_phone');
  const capY = (+c.cap || 0) % 1 ? (+c.cap).toFixed(2) : String(+c.cap || 0);
  const priv = '<a href="/privacy">《隐私政策》</a>';
  return { title: '「好物一起买」活动规则', company: e(S2('company_name') || '海南韵农科技有限公司'), items: [
    ['活动时间', e(S2('ac_time') || '以活动页公告为准') + '。'],
    ['参与范围', '仅限「活动专区」内的商品，其他商品不参加本活动。所有注册用户都可以参加，不限新老用户，也不限金额。'],
    ['怎么参加', '你在活动专区下单付款后，把商品分享给好友。好友通过你的分享进入并下单付款活动专区商品，就算邀请成功一位。'],
    ['免单条件', `自你的订单付款之日起 ${c.days} 天内，邀请成功 ${c.need} 位好友，即可获得这一单的免单券。`],
    ['计入规则', ['自己给自己下单不计入；', '同一位好友只计入一次；', '好友的一笔订单只计入一位邀请人；', `超过 ${c.days} 天才下单的好友不计入。`]],
    ['免单券说明', [`面额等于你这一单的实付金额，单张最高 ${e(capY)} 元；`, `有效期 ${c.couponDays} 天，只能用于活动专区商品；`, '不和其他优惠叠加，不能兑换现金，不能转让；', '每笔订单只能免单一次。']],
    ['好友退款', ['凑满之前有好友退款，这一位不计入，你可以继续邀请；', `免单券发放后有好友退款，未使用的券会先冻结，${c.days} 天内再邀请成功一位即自动恢复，逾期作废；`, '券已经用掉的，由客服人工处理。']],
    ['公平规则', [`同一收货地址、手机号或支付账户下的多笔订单会转入人工审核，${c.reviewDays} 个工作日内给出结果；`, '刷单、虚假交易等违规行为，平台将取消相关奖励，情节严重的限制账号参加活动。']],
    ['个人信息', ['你只能看到好友的脱敏手机号（如 138****0001）和计入状态，看不到好友买了什么、花了多少钱；', `为防作弊审核使用的信息，只用于本活动，不用于推荐或广告，详见${priv}。`]],
    ['活动调整', '如需提前结束或修改规则，平台会提前在活动页公告。已经满足条件的奖励照常发放。'],
    ['', phone ? `如有疑问，请联系客服：电话 ${e(phone)}。` : '如有疑问，请在「我的」→「在线客服」咨询。']
  ] };
}
// 活动专区横幅:取用户最相关的一单(邀请中 > 券冻结 > 券已到账未使用 > 其他)。mode: progress / frozen / done / again / none
function banner(uid) {
  if (!uid) return { mode: 'none' };
  const pick = st => db.get(`SELECT * FROM ac_campaigns WHERE user_id=? AND status='${st}' ORDER BY id DESC LIMIT 1`, uid);
  let c = pick('open'); if (c) return { mode: 'progress', p: progress(c) };
  c = pick('frozen'); if (c) return { mode: 'frozen', p: progress(c) };
  c = db.get("SELECT c.* FROM ac_campaigns c JOIN user_coupons uc ON uc.id=c.user_coupon_id WHERE c.user_id=? AND c.status='done' AND uc.status='unused' ORDER BY c.id DESC LIMIT 1", uid);
  if (c) return { mode: 'done', p: progress(c) };
  return db.get('SELECT 1 FROM ac_campaigns WHERE user_id=?', uid) ? { mode: 'again' } : { mode: 'none' };
}
const unread = uid => db.get('SELECT COUNT(*) n FROM ac_campaigns WHERE user_id=? AND unread=1', uid).n;
// 好友视角：本单是否通过邀请计入（只显示「已为好友助力」，不含奖励字样）
const helped = oid => !!db.get("SELECT 1 FROM ac_friends WHERE order_id=? AND state IN ('counted','review')", oid);

module.exports = { rules, banner, NEED, DEFAULTS, cfg, mask, maskP, attach, onPaid, onRefund, settle, sweep, review, progress, ofOrder, ofUser, current, unread, helped, REASON, C_STATUS, fraudFlag };
