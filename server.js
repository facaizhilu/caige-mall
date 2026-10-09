const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const ejs = require('ejs');
const db = require('./lib/db');
const U = require('./lib/util');
const svc = require('./lib/svc');
const { RETURN_HELP, CLOUD_HELP, SEED_DESC_EDITS, CLOUD_HELP_EDIT, CLOUD_HELP_EDIT2 } = require('./lib/seed-texts');
const banned = require('./lib/banned');
const SqliteStore = require('./lib/session-store');

if (db.get('SELECT COUNT(*) n FROM admins').n === 0) require('./lib/seed')(false);
// 前台已下线账户余额:旧库中的相关帮助文案同步更新(幂等)
db.exec1("UPDATE articles SET title='支付方式说明', content='<p>本站为演示站点,支持微信支付(模拟)与支付宝(模拟),不产生真实扣款。</p>' WHERE category='help' AND title='余额充值说明'");
db.exec1("UPDATE articles SET content=REPLACE(content, '款项原路退回账户余额。', '款项原路退回(演示环境为模拟退款)。') WHERE category='help' AND content LIKE '%原路退回账户余额%'");
// 隐私政策 / 用户协议(文章形式,后台可编辑)
require('./lib/policies').ensurePolicies(db, U.now);
require('./lib/policies').ensurePointsRules(db, U.now);
svc.cloud.ensureDefaults();
// 一次性迁移(用 settings 标记,避免覆盖后台后续修改)
(function oneTimeMigrations() {
  const done = k => !!db.get('SELECT 1 FROM settings WHERE key=?', 'migr_' + k);
  const mark = k => db.exec1('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', 'migr_' + k, U.now());
  if (!done('no7_fresh')) { // 鲜活易腐类分类默认不支持七天无理由
    db.exec1("UPDATE categories SET no_7day=1 WHERE name='水果生鲜' OR name LIKE '%蔬菜%' OR name LIKE '%鲜活%' OR name LIKE '%海鲜%'");
    mark('no7_fresh');
  }
  if (!done('return_help_v2')) {
    db.exec1("UPDATE articles SET content=? WHERE category='help' AND title='退款退货政策'", RETURN_HELP);
    db.exec1("UPDATE articles SET content=REPLACE(content,'<p>本站为演示站点,支持微信支付(模拟)与支付宝(模拟),不产生真实扣款。</p>','<p>本站为演示站点,支持微信支付(模拟)与支付宝(模拟),不产生真实扣款。本平台不提供账户余额与充值功能;积分仅限本账户使用,不可转让、不可提现。</p>') WHERE category='help' AND title='支付方式说明'");
    mark('return_help_v2');
  }
  if (!done('batch3_texts')) { // 云商卡改为线下办理、取消分销/推三返一后,同步旧库中的展示文案
    db.exec1("UPDATE banners SET subtitle='会员价 · 包邮 · 签到加赠积分,线下办理' WHERE link='/me/cloud'");
    db.exec1("UPDATE articles SET content=? WHERE category='help' AND title='云商卡会员权益说明'", CLOUD_HELP);
    db.exec1("UPDATE articles SET title='积分规则说明(旧)', status=0 WHERE category='help' AND title LIKE '%分销%'");
    db.exec1("UPDATE articles SET content=REPLACE(REPLACE(content,'<td>计算与展示积分、会员权益、每日返积分及兑换记录</td>','<td>计算与展示积分、会员等级与云商卡权益(会员价、包邮、签到加赠积分)</td>'),'<td>计算邀请奖励与分销佣金</td>','<td>计算邀请好友首单积分奖励</td>') WHERE category='policy' AND topic='privacy'");
    db.exec1("UPDATE articles SET content='<p>积分可在下单时抵扣部分金额,抵扣比例与单笔上限以《积分规则》页面公示为准。优惠券需满足门槛,每单限用一张。</p>' WHERE category='help' AND title='积分与优惠券使用说明'");
    db.exec1("UPDATE articles SET content=REPLACE(content,'<b>积分仅限本账户使用,不可转让、不可提现、不可兑换现金</b>','<b>积分仅限本账户使用,不可购买、不可转让、不可提现、不可兑换现金</b>,具体以《积分规则》为准') WHERE category='policy' AND topic='terms'");
    mark('batch3_texts');
  }
  if (!done('v11_compliance')) { // 合规审查报告 v1.1 修订:同步旧库中的展示文案与协议(仅替换仍为原文的内容)
    db.transaction(() => {
      // G1:顶部公告与首页 Banner 的包邮口径与运费模板一致
      const ann = svc.S('announcement');
      if (ann === '🎉 财哥商城开业大吉!新人注册即送积分与优惠券,全场满99元包邮') svc.setSetting('announcement', svc.ANNOUNCEMENT);
      else if (ann && ann.includes('全场满99元包邮')) svc.setSetting('announcement', ann.split('全场满99元包邮').join('普通商品满99元包邮(大件、偏远地区除外,以商品页标示为准)'));
      db.exec1("UPDATE banners SET subtitle=REPLACE(subtitle,'全场满99包邮','普通商品满99元包邮(大件、偏远地区除外)') WHERE subtitle LIKE '%全场满99包邮%'");
      // D1:积分规则中没有「每周五积分翻倍」活动,下线该公告(保留记录,status=0)
      db.exec1("UPDATE articles SET status=0 WHERE category='notice' AND title LIKE '%积分翻倍%'");
      // C1/G6:商品详情通用模板去掉「财哥严选」「假一赔十」「7天无理由退换」「全国联保」(退货政策以商品页「服务」栏按商品实际显示)
      for (const [o, n] of SEED_DESC_EDITS) db.exec1('UPDATE products SET description=REPLACE(description,?,?) WHERE instr(description,?)>0', o, n, o);
      // G6:「财哥严选」不再作为品牌名使用
      if (!db.get("SELECT 1 FROM brands WHERE name='财哥'")) db.exec1("UPDATE brands SET name='财哥', description='财哥品牌官方旗舰' WHERE name='财哥严选'");
      db.exec1("UPDATE products SET name=REPLACE(name,'财哥严选 ','财哥 ') WHERE name LIKE '财哥严选 %'");
      // G6:违禁词表补充(后台已编辑过的词表只追加缺少的词)
      const bw = svc.S('banned_words');
      if (bw != null) { const have = new Set(String(bw).split(/\r?\n/).map(x => x.trim())); const add = banned.ADDED_WORDS.filter(w => !have.has(w)); if (add.length) svc.setSetting('banned_words', String(bw).replace(/\s*$/, '') + '\n' + add.join('\n')); }
      // 店主要求:云商卡签到加赠改为按连续签到天数递增(第 1 天 25,每连续 1 天 +2),取消每月上限;有效期不变
      svc.setSetting('cloud_signin_extra', '25'); svc.setSetting('cloud_signin_extra_step', '2');
      db.exec1("DELETE FROM settings WHERE key='cloud_signin_extra_cap'");
      db.exec1("UPDATE articles SET content=REPLACE(content,?,?) WHERE category='help' AND instr(content,?)>0", CLOUD_HELP_EDIT[0], CLOUD_HELP_EDIT[1], CLOUD_HELP_EDIT[0]);
      // A2/A3/A4/A11/B1/H1/D2:隐私政策、用户协议、积分规则修订,并提升协议版本号使老用户重新确认
      // (全新安装时正文已是新版、版本默认 1.1,不会重复提升)
      const ed = require('./lib/policies').applyV11Edits(db), changed = ed.privacy + ed.terms;
      const m = String(svc.S('policy_version') || '1.0').match(/^(\d+)\.(\d+)$/);
      if (changed && m) { svc.setSetting('policy_version', m[1] + '.' + (+m[2] + 1)); console.log('协议已修订,版本号提升为 v' + svc.S('policy_version')); }
      mark('v11_compliance');
    })();
  }
  if (!done('v11b_policy')) { // v1.1 补充修订:供应商代发标注、头像昵称说明(v1.1 尚未被确认,原地更新、不提升版本号;对 v1.0 旧库在上一步之后执行)
    require('./lib/policies').applyV11bEdits(db);
    // 店主要求:云商卡签到加赠每天封顶 35(25 起每连续 1 天 +2)
    svc.setSetting('cloud_signin_extra_max', '35');
    db.exec1("UPDATE articles SET content=REPLACE(content,?,?) WHERE category='help' AND instr(content,?)>0", CLOUD_HELP_EDIT2[0], CLOUD_HELP_EDIT2[1], CLOUD_HELP_EDIT2[0]);
    mark('v11b_policy');
  }
})();

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- 静态资源 & 占位图 ----
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.get('/img/gen.svg', (req, res) => {
  const hex = s => /^[0-9a-fA-F]{6}$/.test(s) ? '#' + s : '#d4202a';
  const a = hex(req.query.a), b = hex(req.query.b), v = parseInt(req.query.v) || 0;
  const t = U.esc(String(req.query.t || '财').slice(0, 4)), n = U.esc(String(req.query.n || '').slice(0, 14));
  const angle = [[0, 0, 1, 1], [1, 0, 0, 1], [0, 1, 1, 0], [0.5, 0, 0.5, 1]][v % 4];
  const shapes = [
    `<circle cx="520" cy="120" r="170" fill="#fff" opacity=".13"/><circle cx="90" cy="520" r="130" fill="#fff" opacity=".1"/>`,
    `<rect x="-60" y="380" width="700" height="140" fill="#fff" opacity=".12" transform="rotate(-12 300 450)"/><circle cx="500" cy="140" r="90" fill="#fff" opacity=".15"/>`,
    `<circle cx="100" cy="100" r="150" fill="#fff" opacity=".13"/><circle cx="500" cy="500" r="200" fill="#fff" opacity=".1"/>`,
    `<polygon points="600,0 600,300 300,0" fill="#fff" opacity=".14"/><polygon points="0,600 0,350 250,600" fill="#fff" opacity=".12"/>`
  ][v % 4];
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600"><defs><linearGradient id="g" x1="${angle[0]}" y1="${angle[1]}" x2="${angle[2]}" y2="${angle[3]}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/>${shapes}<text x="300" y="${n ? 330 : 365}" font-size="${n ? 190 : 230}" text-anchor="middle" font-family="Noto Color Emoji,Apple Color Emoji,Segoe UI Emoji,Noto Sans CJK SC,sans-serif" fill="#fff">${t}</text>${n ? `<text x="300" y="500" font-size="44" font-weight="700" text-anchor="middle" font-family="Noto Sans CJK SC,PingFang SC,Microsoft YaHei,sans-serif" fill="#fff" opacity=".95">${n}</text>` : ''}<text x="580" y="585" font-size="22" text-anchor="end" font-family="sans-serif" fill="#fff" opacity=".55">CAIGE MALL</text></svg>`);
});
app.get('/favicon.ico', (req, res) => res.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#d4202a"/><text x="32" y="46" font-size="38" font-weight="700" text-anchor="middle" fill="#f9d66b" font-family="Noto Sans CJK SC,sans-serif">财</text></svg>`));

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// ---- 上传(仅登录用户/管理员,图片白名单) ----
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, 'public', 'uploads'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(5).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 9 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype) && /\.(png|jpe?g|gif|webp)$/i.test(file.originalname))
});
fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });
function multipart(isAuthed) {
  return (req, res, next) => {
    if (!(req.headers['content-type'] || '').startsWith('multipart/form-data')) return next();
    if (!isAuthed(req)) return res.status(403).send('请先登录');
    upload.any()(req, res, err => { if (err) return res.status(400).send('上传失败:' + U.esc(err.message)); next(); });
  };
}
const filesOf = (req, field) => (req.files || []).filter(f => f.fieldname === field).map(f => '/uploads/' + f.filename);

// ---- CSRF (session token, 表单隐藏域/请求头) ----
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const tok = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
    if (!tok || tok !== req.session.csrf) return res.status(403).send('<meta charset="utf-8"><h3>页面已过期或请求非法(CSRF 校验失败),请返回刷新后重试。</h3>');
  }
  next();
}

// ---- 渲染助手(布局) ----
function pageRenderer(layout) {
  return (req, res, next) => {
    res.page = (view, data = {}) => {
      const locals = { ...app.locals, ...res.locals, ...data, req };
      ejs.renderFile(path.join(__dirname, 'views', view + '.ejs'), locals, { views: [path.join(__dirname, 'views')] }, (e, body) => {
        if (e) return next(e);
        ejs.renderFile(path.join(__dirname, 'views', layout + '.ejs'), { ...locals, body }, (e2, html) => e2 ? next(e2) : res.send(html));
      });
    };
    next();
  };
}
app.locals.U = U; app.locals.money = U.money; app.locals.ORDER_STATUS = U.ORDER_STATUS; app.locals.PAY_METHOD = U.PAY_METHOD;
// 划线原价:仅在填写且高于售价时展示(《明码标价和禁止价格欺诈规定》)
app.locals.showMkt = (mkt, price) => mkt != null && +mkt > 0 && +mkt > +price;
app.locals.AFTERSALE_STATUS = U.AFTERSALE_STATUS; app.locals.AFTERSALE_TYPE = U.AFTERSALE_TYPE; app.locals.PERMS = U.PERMS; app.locals.regions = require('./lib/regions');
app.locals.qs = (req, over) => { const q = { ...req.query, ...over }; return '?' + Object.entries(q).filter(([, v]) => v !== '' && v != null).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); };

const cookieBase = { httpOnly: true, sameSite: 'lax', maxAge: 7 * 86400000 };
const secret = process.env.SESSION_SECRET || 'caige-mall-demo-secret-change-me';

// ================= 后台 /admin(独立会话、独立布局) =================
const adminSession = session({ name: 'cg_admin.sid', secret, resave: false, saveUninitialized: false, store: new SqliteStore('a:'), cookie: { ...cookieBase, maxAge: 8 * 3600000, path: '/admin' } });
const adminRouter = express.Router();
adminRouter.use(adminSession);
adminRouter.use(multipart(req => !!req.session.admin));
adminRouter.use(csrf);
adminRouter.use(pageRenderer('admin/layout'));
adminRouter.use((req, res, next) => { res.locals.admin = req.session.admin || null; res.locals.shop = svc.settings(); res.locals.flash = req.session.flash; delete req.session.flash; res.locals.filesOf = filesOf; next(); });
require('./routes/admin')(adminRouter, { filesOf });
app.use('/admin', adminRouter);
app.use('/admin', (req, res) => res.status(404).send('后台页面不存在'));

// ================= 前台 =================
app.use(session({ name: 'cg.sid', secret, resave: false, saveUninitialized: false, store: new SqliteStore('s:'), cookie: cookieBase }));
// 前台不提供任何图片/文件上传(评价、售后、客服均为纯文字),不挂载 multipart 解析
app.use(csrf);
app.use(pageRenderer('shop/layout'));
app.use((req, res, next) => {
  res.locals.shop = svc.settings();
  res.locals.flash = req.session.flash; delete req.session.flash;
  res.locals.user = null; res.locals.cartCount = 0;
  if (req.session.uid) {
    const u = db.get('SELECT u.*, l.name level_name, l.color level_color, l.discount level_discount FROM users u LEFT JOIN member_levels l ON l.id=u.level_id WHERE u.id=?', req.session.uid);
    if (!u || !u.status) { req.session.uid = null; } else {
      res.locals.user = u; req.user = u;
      res.locals.cartCount = db.get('SELECT COALESCE(SUM(qty),0) n FROM cart WHERE user_id=?', u.id).n;
      // 未同意当前版本《用户协议》《隐私政策》的老用户:先完成一次性确认
      if (u.consent_version !== (svc.S('policy_version') || '1.1') && !/^\/(consent|privacy|terms|logout)(\/|$|\?)/.test(req.path)) {
        if (req.method === 'GET') return res.redirect('/consent?next=' + encodeURIComponent(req.originalUrl));
        return res.status(403).redirect('/consent');
      }
    }
  }
  res.locals.navCats = db.all('SELECT * FROM categories WHERE parent_id=0 AND status=1 ORDER BY sort,id');
  res.locals.hotWords = db.all('SELECT word FROM keywords WHERE is_hot=1 ORDER BY sort,hits DESC LIMIT 8').map(r => r.word);
  res.locals.filesOf = filesOf;
  const ab = db.get("SELECT id FROM articles WHERE category='about' LIMIT 1"); res.locals.aboutId = ab ? ab.id : 0;
  next();
});
require('./routes/shop')(app, { filesOf });

app.use((req, res) => res.status(404).page('shop/error', { title: '页面不存在', code: 404, message: '您访问的页面不存在或已下架' }));
app.use((err, req, res, next) => { console.error(err); if (res.headersSent) return next(err); res.status(500).send('<meta charset="utf-8"><h3>服务器开小差了:' + U.esc(err.message) + '</h3><a href="/">返回首页</a>'); });

setInterval(svc.sweep, 60000).unref(); svc.sweep();
if (require.main === module) app.listen(PORT, () => console.log(`\n🛒 财哥商城已启动:  前台 http://localhost:${PORT}/   后台 http://localhost:${PORT}/admin  (admin / admin123)\n`));
module.exports = app;
