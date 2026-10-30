// 每日签到测试:积分到账/流水、连续递增、断签重置(改库模拟日期)、同日不可重复、云商卡会员加赠、后台可改数值
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
      const basePts = S('signin_base') + Math.min(streak - 1, 5);
      const extra = cloud ? Math.min(Math.max(S('cloud_signin_extra_max'), S('cloud_signin_extra')), S('cloud_signin_extra') + S('cloud_signin_extra_step') * (streak - 1)) : 0;
      const p1 = user(ph).points, l1 = logs(id), want = basePts + extra;
      ok(r.status === 302 && p1 - p0 === want && l1.s - l0.s === want && l1.n - l0.n === (cloud ? 2 : 1) && user(ph).signin_streak === streak, `${cloud ? '云商卡' : '普通'}会员第${i + 1}次签到(连续${streak}天):+${want}(基础${basePts}${cloud ? '+加赠' + extra : ''}),余额与流水一致`, `实际 +${p1 - p0} 流水+${l1.s - l0.s}/${l1.n - l0.n}条`);
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
  await run(a, '13500000007', [0, 1, 1, 1, 1, 1, 1, 2, 1], false);
  console.log('== 云商卡会员(25 起,每连续一天 +2,封顶可配;断签重置) ==');
  const ph = '13600000006', cid = user(ph).id, ct = db.get('SELECT id FROM cloud_card_types ORDER BY id LIMIT 1').id;
  db.exec1("UPDATE users SET cloud_tier='silver', cloud_start=?, cloud_end=?, cloud_card_type_id=? WHERE id=?", U.offset(-86400000 * 30), U.offset(86400000 * 30), ct, cid);
  const b = new C(); await b.login(ph, '123456');
  ok(S('cloud_signin_extra') === 25 && S('cloud_signin_extra_step') === 2, '默认加赠:首日 25,每天 +2');
  const seq = await run(b, ph, [0, 1, 1, 1, 1, 1, 1, 3, 1], true);
  ok(seq[7] === seq[0], '断签后重新从首日计算');
  console.log('== 后台修改数值即时生效 ==');
  await adm.get('/admin/cloud-settings');
  let r = await adm.post('/admin/cloud-settings', { cloud_discount: '98', cloud_free_shipping: '1', cloud_signin_extra: '30', cloud_signin_extra_step: '3', cloud_signin_extra_max: '60', cloud_extra_expire_days: '90' });
  ok(S('cloud_signin_extra') === 30 && S('cloud_signin_extra_step') === 3, '后台保存云商卡签到加赠配置');
  await run(b, ph, [2, 1], true);
  console.log('== 云商卡过期后不再加赠 ==');
  db.exec1('UPDATE users SET cloud_end=? WHERE id=?', U.offset(-86400000), cid);
  await run(b, ph, [1], false);
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
