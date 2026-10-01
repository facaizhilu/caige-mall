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
const SqliteStore = require('./lib/session-store');

if (db.get('SELECT COUNT(*) n FROM admins').n === 0) require('./lib/seed')(false);

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
app.locals.AFTERSALE_STATUS = U.AFTERSALE_STATUS; app.locals.PERMS = U.PERMS; app.locals.regions = require('./lib/regions');
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
app.use(multipart(req => !!req.session.uid));
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
