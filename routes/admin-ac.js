// 后台:活动专区「邀三位好友下单」——设置、进度列表、人工审核、会员「活动邀请详情」(数据均来自 lib/ac.progress)
const db = require('../lib/db'), U = require('../lib/util'), svc = require('../lib/svc'), AC = require('../lib/ac'), B = require('../lib/banned');
const SHARE_BAD = /免单|免费|白拿|0元|零元|返现|返还|奖励|红包|领券|越分享|分享.*得|邀请.*得|全额/;
module.exports = (r, { need, flash, log, sendCSV }) => {
  r.get('/ac', need('marketing'), (req, res) => {
    const q = String(req.query.q || '').trim(), st = String(req.query.status || ''), where = ['1=1'], params = [];
    if (st === 'review') where.push("(EXISTS(SELECT 1 FROM ac_friends f WHERE f.campaign_id=c.id AND f.state='review') OR COALESCE(c.review_note,'')<>'')");
    else if (st) { where.push('c.status=?'); params.push(st); }
    if (q) { const k = '%' + q + '%'; where.push('(o.order_no LIKE ? OR u.phone LIKE ? OR u.nickname LIKE ? OR c.code=? OR EXISTS(SELECT 1 FROM ac_friends f JOIN orders fo ON fo.id=f.order_id WHERE f.campaign_id=c.id AND fo.order_no LIKE ?))'); params.push(k, k, k, q.toUpperCase(), k); }
    const pg = U.paginate(`SELECT c.*, u.phone, u.nickname FROM ac_campaigns c LEFT JOIN users u ON u.id=c.user_id LEFT JOIN orders o ON o.id=c.order_id WHERE ${where.join(' AND ')} ORDER BY c.id DESC`, params, req.query.page, 20);
    pg.rows = pg.rows.map(c => ({ ...AC.progress(c), phone: c.phone, nickname: c.nickname, user_id: c.user_id }));
    const reviews = db.all("SELECT f.*, o.order_no, c.user_id inviter_id, u.phone fphone FROM ac_friends f JOIN ac_campaigns c ON c.id=f.campaign_id LEFT JOIN orders o ON o.id=f.order_id LEFT JOIN users u ON u.id=f.friend_id WHERE f.state='review' ORDER BY f.id");
    res.page('admin/ac', { title: '邀好友免单', pg, q, st, reviews, s: AC.cfg(), demo: process.env.DEMO_MODE === '1' });
  });
  r.post('/ac/settings', need('marketing'), (req, res) => {
    const b = req.body, T = k => String(b[k] == null ? '' : b[k]).trim(), e = [];
    const days = U.int(b.ac_days, -1), cap = Number(b.ac_cap), cdays = U.int(b.ac_coupon_days, -1), rdays = U.int(b.ac_review_days, -1);
    if (days < 1 || days > 90) e.push('邀请期限需为 1~90 天');
    if (!Number.isFinite(cap) || cap < 0 || cap > 10000) e.push('专享券上限需为 0~10000 元');
    if (cdays < 1 || cdays > 365) e.push('专享券有效期需为 1~365 天');
    if (rdays < 1 || rdays > 15) e.push('人工审核时限需为 1~15 个工作日');
    const txt = { ac_title: T('ac_title').slice(0, 40), ac_subtitle: T('ac_subtitle').slice(0, 40), ac_note: T('ac_note').slice(0, 60), ac_share_title: T('ac_share_title').slice(0, 30) };
    if (!txt.ac_title) e.push('请填写横幅主标题'); if (!txt.ac_note) e.push('请填写横幅小字'); if (!txt.ac_share_title) e.push('请填写分享标题');
    if (SHARE_BAD.test(txt.ac_share_title)) e.push('分享标题不能出现免单、奖励、返还等诱导分享字样（微信规则）');
    if (/越分享|全额返还|分享.*得/.test(txt.ac_title + txt.ac_subtitle + txt.ac_note)) e.push('横幅文案不能出现「越分享越划算」「全额返还」等诱导分享表述');
    const hits = B.check(txt); if (hits.length) e.push('请先修改敏感或违禁表述：' + B.summarize(hits));
    if (e.length) { flash(req, 'error', e.join('；')); return res.redirect('/admin/ac'); }
    svc.setSetting('ac_on', b.ac_on === '1' ? '1' : '0'); svc.setSetting('ac_days', days); svc.setSetting('ac_cap', U.round2(cap)); svc.setSetting('ac_coupon_days', cdays); svc.setSetting('ac_review_days', rdays);
    for (const [k, v] of Object.entries(txt)) svc.setSetting(k, v);
    log(req, '修改邀好友免单设置', `${b.ac_on === '1' ? '开启' : '关闭'} / ${days}天 / 上限¥${U.round2(cap)} / 券${cdays}天 / 审核${rdays}个工作日`);
    flash(req, 'success', '设置已保存'); res.redirect('/admin/ac');
  });
  r.post('/ac/friend/:id/review', need('marketing'), (req, res) => {
    const approve = req.body.approve === '1', f = db.get('SELECT * FROM ac_friends WHERE id=?', U.int(req.params.id));
    const x = AC.review(U.int(req.params.id), approve, req.session.admin.username);
    if (x.ok) log(req, approve ? '邀好友免单审核通过' : '邀好友免单审核驳回', '记录#' + req.params.id + (f ? ' 订单#' + f.order_id : ''));
    flash(req, x.ok ? 'success' : 'error', x.ok ? '已处理' : x.msg); res.redirect(req.body.back && U.isInternalLink(req.body.back) ? req.body.back : '/admin/ac?status=review');
  });
  r.post('/ac/:id/clear-note', need('marketing'), (req, res) => {
    db.exec1('UPDATE ac_campaigns SET review_note=NULL WHERE id=?', U.int(req.params.id)); log(req, '邀好友免单审核备注已处理', '活动#' + req.params.id);
    flash(req, 'success', '已标记处理'); res.redirect('/admin/ac?status=review');
  });
  // 会员「活动邀请详情」
  const detail = uid => {
    const u = db.get('SELECT id, phone, nickname FROM users WHERE id=?', uid); if (!u) return null;
    const list = AC.ofUser(uid), all = list.flatMap(p => p.friends);
    return { u, list, sum: { invited: all.length, counted: list.reduce((a, p) => a + p.counted, 0), coupons: list.filter(p => p.status === 'done' && p.coupon).length } };
  };
  r.get('/ac/user/:uid', need('member'), (req, res) => {
    const d = detail(U.int(req.params.uid)); if (!d) return res.status(404).send('会员不存在');
    log(req, '查看活动邀请详情', '会员#' + d.u.id);
    res.page('admin/ac-user', { title: '活动邀请详情', ...d });
  });
  r.post('/ac/user/:uid/reveal/:fid', need('member'), (req, res) => {
    const f = db.get('SELECT f.id, u.phone FROM ac_friends f JOIN ac_campaigns c ON c.id=f.campaign_id LEFT JOIN users u ON u.id=f.friend_id WHERE f.id=? AND c.user_id=?', U.int(req.params.fid), U.int(req.params.uid));
    if (!f) return res.status(404).json({ ok: false, msg: '记录不存在' });
    log(req, '显示好友完整手机号', '会员#' + U.int(req.params.uid) + ' 记录#' + f.id);
    res.json({ ok: true, phone: f.phone || '' });
  });
  r.get('/ac/user/:uid/export', need('member'), (req, res) => {
    const d = detail(U.int(req.params.uid)); if (!d) return res.status(404).send('会员不存在');
    log(req, '导出活动邀请详情', '会员#' + d.u.id);
    const rows = d.list.flatMap(p => p.friends.map(f => [p.orderNo, p.counted + '/' + p.need, U.maskPhone(f.friend_phone), f.created_at, f.order_no, (+f.pay_amount || 0).toFixed(2), f.slot.label, f.state === 'void' ? f.reason || '' : f.state === 'review' ? (f.flag || '') : '', f.counted_at || '']));
    sendCSV(res, '活动邀请详情-' + d.u.id, ['邀请人订单', '进度', '好友手机号', '邀请时间', '好友订单号', '实付', '状态', '未计入原因/审核原因', '计入时间'], rows);
  });
};
