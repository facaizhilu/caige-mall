// 每日签到测试:普通 12 起 +1 封顶 18;云商卡 37 起 +2 封顶 55(当日总数不叠加);断签重置(改库模拟日期)、同日不可重复、后台可改六个数值
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
(async () => {
  const S = k => +((db.get('SELECT value FROM settings WHERE key=?', k) || {}).value);
  const user = ph => db.get('SELECT * FROM users WHERE phone=?', ph);
  const logs = id => db.get('SELECT COUNT(*) n, COALESCE(SUM(delta),0) s FROM points_log WHERE user_id=?', id);
  // 模拟「过了 n 天」:把该会员的签到日期整体前移 n 天
  const shift = (id, n) => { db.exec1(`UPDATE signins SET day=date(day,'-${n} day') WHERE user_id=?`, id); db.exec1(`UPDATE users SET last_signin=date(last_signin,'-${n} day') WHERE id=?`, id); };
  const run = async (cli, ph, days, cloud) => {
    const id = user(ph).id; const exp = []; let streak = user(ph).signin_streak || 0;
    for (const [i, gap] of days.entries()) {
      if (gap) shift(id, gap); streak = gap <= 1 ? streak + 1 : 1;
      const p0 = user(ph).points, l0 = logs(id);
      const r = await cli.post('/me/signin', {}); 
      const pre = cloud ? 'cloud_signin_' : 'signin_', want = Math.min(S(pre + 'max'), S(pre + 'base') + S(pre + 'step') * (streak - 1));
      const p1 = user(ph).points, l1 = logs(id), last = db.get('SELECT * FROM points_log WHERE user_id=? ORDER BY id DESC LIMIT 1', id);
      const lots = db.get("SELECT COUNT(*) n FROM point_lots WHERE user_id=? AND kind<>'cycle' AND created_at>=?", id, U.today()).n;
      ok(r.status === 302 && p1 - p0 === want && l1.s - l0.s === want && l1.n - l0.n === 1 && last.reason === `每日签到(连续${streak}天)` && user(ph).signin_streak === streak && !lots, `${cloud ? '云商卡' : '普通'}会员第${i + 1}次签到(连续${streak}天):+${want},一条流水、余额一致`, `实际 +${p1 - p0} 流水+${l1.s - l0.s}/${l1.n - l0.n}条 ${last && last.reason}`);
      exp.push(want);
    }
    const p0 = user(ph).points, r = await cli.post('/me/signin', {}), m = await cli.get('/me/points');
    ok(user(ph).points === p0 && m.text.includes('今天已经签到过啦'), '同一天重复签到被拒、积分不变');
    return exp;
  };
  const adm = new C(); await adm.admin();
  console.log('== 普通会员 ==');
  const a = new C(); await a.login('13500000007', '123456');
  ok(user('13500000007').points === 0 && logs(user('13500000007').id).n === 0, '新库演示会员积分为 0、无积分流水');
  const sa = await run(a, '13500000007', [0, 1, 1, 1, 1, 1, 1, 1, 2, 1], false);
  ok(sa.join(',') === '12,13,14,15,16,17,18,18,12,13', '普通序列 12…18 封顶,断签回 12', sa.join(','));
  console.log('== 云商卡会员(37 起,每连续一天 +2,封顶 55;断签重置) ==');
  const ph = '13600000006', cid = user(ph).id, ct = db.get('SELECT id FROM cloud_card_types ORDER BY id LIMIT 1').id;
  db.exec1("UPDATE users SET cloud_tier='silver', cloud_start=?, cloud_end=?, cloud_card_type_id=? WHERE id=?", U.offset(-86400000 * 30), U.offset(86400000 * 30), ct, cid);
  const b = new C(); await b.login(ph, '123456');
  ok([12, 1, 18, 37, 2, 55].join() === ['signin_base', 'signin_step', 'signin_max', 'cloud_signin_base', 'cloud_signin_step', 'cloud_signin_max'].map(S).join(), '默认值 12/1/18、37/2/55');
  const seq = await run(b, ph, [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 1], true);
  ok(seq.join(',') === '37,39,41,43,45,47,49,51,53,55,55,37,39', '云商卡序列 37…55 封顶,断签回 37(总数,不叠加)', seq.join(','));
  { const m = await b.get('/me/points'); ok(m.text.includes('最高每天 55 积分') && m.text.includes('37、39、41'), '积分页按配置展示规则'); }
  console.log('== 后台修改数值即时生效 ==');
  const keep = {}; for (const r0 of db.all('SELECT key, value FROM settings')) keep[r0.key] = r0.value;
  const base0 = {}; for (const k of ['shop_name', 'company_name', 'slogan', 'announcement', 'service_phone', 'service_wechat', 'ship_from', 'service_quick_questions', 'service_recall_minutes', 'service_hours', 'service_email', 'address', 'icp', 'stock_warn', 'unpaid_cancel_minutes', 'auto_confirm_days', 'aftersale_days', 'register_points', 'review_points', 'hot_sales_threshold', 'new_days', 'show_sales']) base0[k] = keep[k] == null ? '' : keep[k];
  let r = await adm.get('/admin/settings'); ok(['signin_step', 'signin_max', 'cloud_signin_base', 'cloud_signin_step', 'cloud_signin_max'].every(k => r.text.includes('name="' + k + '"')), '站点设置页含六项签到配置');
  r = await adm.post('/admin/settings', { ...base0, signin_base: '20', signin_step: '1', signin_max: '10', cloud_signin_base: '37', cloud_signin_step: '2', cloud_signin_max: '55' });
  ok(S('signin_base') === 12, '封顶小于首日被拒');
  r = await adm.post('/admin/settings', { ...base0, signin_base: '10', signin_step: '2', signin_max: '20', cloud_signin_base: '40', cloud_signin_step: '3', cloud_signin_max: '60' });
  ok(S('signin_base') === 10 && S('cloud_signin_max') === 60, '后台保存签到配置');
  const s2 = await run(b, ph, [2, 1], true); ok(s2.join(',') === '40,43', '云商卡新配置即时生效', s2.join(','));
  { const pr = await b.get('/points-rules'); ok(pr.text.includes('第 1 天 10 积分') && pr.text.includes('第 1 天 40 积分') && pr.text.includes('最高每天 60 积分'), '《积分规则》读取当前配置'); }
  console.log('== 云商卡过期后不再加赠 ==');
  db.exec1('UPDATE users SET cloud_end=? WHERE id=?', U.offset(-86400000), cid);
  const s3 = await run(b, ph, [1], false); ok(s3[0] === 14, '过期后按普通档(连续第 3 天 10+2×2=14)', s3.join());
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
