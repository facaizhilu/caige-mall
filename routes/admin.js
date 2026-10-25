const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const U = require('../lib/util');
const svc = require('../lib/svc');
const chart = require('../lib/chart');
const crud = require('../lib/crud');
const { now, int, num, round2, esc, money } = U;
const jdvop = require('../lib/suppliers/jdvop');
const J_cfgMode = () => jdvop.config.cfg().mode;

const COMPANIES = ['顺丰速运', '中通快递', '圆通速递', '韵达快递', '申通快递', '京东物流', '极兔速递', 'EMS'];

module.exports = function (r, { filesOf }) {
  const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
  const perms = a => a ? (a.perms === 'all' ? 'all' : String(a.perms).split(',')) : [];
  const can = (a, p) => a && (a.perms === 'all' || String(a.perms).split(',').includes(p));
  const log = (req, action, detail) => db.exec1('INSERT INTO admin_logs(admin_id,admin_name,action,detail,ip,created_at) VALUES(?,?,?,?,?,?)', req.session.admin ? req.session.admin.id : null, req.session.admin ? req.session.admin.username : '-', action, String(detail || '').slice(0, 300), req.ip, now());
  // 种子数据中的默认账号密码:用这些密码登录时必须先改密
  const DEFAULT_PW = { admin: 'admin123', ops: 'ops123456', kefu: 'kefu123456' };
  const isDemo = () => process.env.DEMO_MODE === '1';
  const PW_FREE = ['/password', '/password/skip', '/logout'];
  const need = p => (req, res, next) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    // 每次请求刷新权限,角色变更即时生效
    const a = db.get('SELECT a.*, r.permissions, r.name role_name FROM admins a LEFT JOIN roles r ON r.id=a.role_id WHERE a.id=?', req.session.admin.id);
    if (!a || !a.status) { req.session.admin = null; return res.redirect('/admin/login'); }
    req.session.admin.perms = a.permissions || ''; req.session.admin.name = a.name; req.session.admin.role_name = a.role_name;
    res.locals.admin = req.session.admin; res.locals.pwSkipped = !!req.session.admin.pwSkipped;
    // 默认/临时密码:强制先修改密码(仅 DEMO_MODE=1 的演示环境允许跳过)
    if (req.session.admin.mustChange && !PW_FREE.includes(req.path)) { flash(req, 'warn', '为保障后台安全,请先修改默认/临时密码后再继续操作'); return res.redirect('/admin/password'); }
    if (p && !can(req.session.admin, p)) return res.status(403).page('admin/forbidden', { title: '无权限' });
    next();
  };
  const ctx = { need, flash, log, filesOf };
  // 页面内跨模块链接(如会员详情→订单、客服→会员):当前角色无该模块权限时去掉 href,避免点进 403 页面(菜单已按权限过滤)
  const PERM_OF = [[/^\/admin\/(orders|members|points-log)\/export|^\/admin\/export\//, 'stats'], [/^\/admin\/jdvop\/settings/, 'system'], [/^\/admin\/jdvop\/(logs|reconcile)/, 'stats'], [/^\/admin\/(products|categories|brands|shipping|banned-words|inventory|jdvop)(\/|$|\?)/, 'product'], [/^\/admin\/(orders|aftersales|invoices)(\/|$|\?|#)/, 'order'], [/^\/admin\/reviews/, 'review'], [/^\/admin\/(members|points-log|levels|invites|cloud-)/, 'member'], [/^\/admin\/service/, 'service'], [/^\/admin\/(coupons|seckills|groupbuys|groups|points-goods|banners|keywords)/, 'marketing'], [/^\/admin\/(notices|help-articles|pages|policies)/, 'content'], [/^\/admin\/stats/, 'stats'], [/^\/admin\/(settings|admins|roles|logs)(\/|$|\?)/, 'system']];
  r.use((req, res, next) => {
    const a = req.session.admin; if (!a || a.perms === 'all') return next();
    const send = res.send.bind(res);
    res.send = body => {
      if (typeof body === 'string' && req.session.admin && req.session.admin.perms !== 'all' && /^\s*<!doctype html/i.test(body)) body = body.replace(/<a\b([^>]*?)\shref="(\/admin\/[^"]*)"([^>]*)>/g, (m, pre, href, post) => { const x = PERM_OF.find(([re]) => re.test(href)); return x && !can(req.session.admin, x[1]) ? `<a${pre}${post} aria-disabled="true" title="当前角色无此模块权限" style="pointer-events:none;opacity:.6">` : m; });
      return send(body);
    };
    next();
  });
  const back = (req, res, fb) => res.redirect(req.get('referer') && req.get('referer').includes('/admin') ? req.get('referer') : fb);
  const sendCSV = (res, name, header, rows) => { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}-${U.today()}.csv`); res.send(U.toCSV(header, rows)); };
  r.use((req, res, next) => { res.locals.can = p => can(req.session.admin, p); res.locals.warnCount = 0; res.locals.COMPANIES = COMPANIES; res.locals.cur = req.path; if (req.session.admin) { res.locals.warnCount = db.get('SELECT COUNT(*) n FROM skus s JOIN products p ON p.id=s.product_id WHERE s.stock<=? AND p.status=1', int(svc.S('stock_warn'), 10)).n; res.locals.pending = { orders: db.get("SELECT COUNT(*) n FROM orders WHERE status='paid' AND type!='group' OR (status='paid' AND type='group' AND group_id IN (SELECT id FROM groups WHERE status='success'))").n, as: db.get("SELECT COUNT(*) n FROM aftersales WHERE status IN ('pending','returned')").n, reviews: db.get("SELECT COUNT(*) n FROM reviews WHERE status='pending'").n, msgs: db.get("SELECT COUNT(DISTINCT user_id) n FROM messages WHERE sender='user' AND user_id NOT IN (SELECT user_id FROM messages m2 WHERE m2.sender='staff' AND m2.id > (SELECT MAX(id) FROM messages m3 WHERE m3.sender='user' AND m3.user_id=messages.user_id))").n, invoices: db.get("SELECT COUNT(*) n FROM invoices WHERE status='pending'").n, supAlerts: db.get('SELECT COUNT(*) n FROM supplier_alerts WHERE resolved=0').n }; } next(); });

  // ================= 登录 =================
  const fails = new Map();
  r.get('/login', (req, res) => req.session.admin ? res.redirect('/admin') : res.page('admin/login', { title: '管理员登录', layoutless: true }));
  r.post('/login', (req, res) => {
    const username = String(req.body.username || '').trim(), k = req.ip + username;
    const f = fails.get(k);
    const bad = m => { flash(req, 'error', m); res.redirect('/admin/login'); };
    if (f && f.n >= 8 && Date.now() - f.t < 600000) return bad('尝试次数过多,请 10 分钟后再试');
    const a = db.get('SELECT a.*, r.permissions, r.name role_name FROM admins a LEFT JOIN roles r ON r.id=a.role_id WHERE a.username=?', username);
    if (!a || !bcrypt.compareSync(String(req.body.password || ''), a.password_hash)) { fails.set(k, { n: (f && Date.now() - f.t < 600000 ? f.n : 0) + 1, t: Date.now() }); return bad('账号或密码错误'); }
    if (!a.status) return bad('该管理员账号已被停用');
    fails.delete(k);
    req.session.regenerate(() => {
      const pw = String(req.body.password || '');
      const mustChange = !!a.must_change_pw || DEFAULT_PW[a.username] === pw || Object.values(DEFAULT_PW).includes(pw);
      req.session.admin = { id: a.id, username: a.username, name: a.name, perms: a.permissions || '', role_name: a.role_name, mustChange };
      db.exec1('UPDATE admins SET last_login=? WHERE id=?', now(), a.id); log(req, '登录后台', mustChange ? '使用默认/临时密码,要求修改' : '');
      req.session.save(() => res.redirect(mustChange ? '/admin/password' : '/admin'));
    });
  });
  r.post('/logout', (req, res) => { if (req.session.admin) log(req, '退出后台', ''); req.session.regenerate(() => res.redirect('/admin/login')); });

  // 销售额口径:有效订单(已付款/已发货/已完成)实付金额,扣除已完成的部分退款(售后退款、供应商部分退款);整单退款的订单状态为已退款,不计入
  const NET_PAY = "o.pay_amount - COALESCE((SELECT SUM(a.refund_cash) FROM aftersales a WHERE a.order_id=o.id AND a.status='refunded'),0) - COALESCE((SELECT so.refunded_customer FROM supplier_orders so WHERE so.order_id=o.id),0)";
  const netSales = (where, ...p) => { const x = db.get(`SELECT COALESCE(SUM(${NET_PAY}),0) a, COUNT(*) n FROM orders o WHERE ${where}`, ...p); x.a = round2(x.a); return x; };
  // ================= 数据概览 =================
  // 无「数据概览」权限的角色:登录后落到其第一个有权限的页面,而不是 403
  const LANDING = [['order', '/admin/orders'], ['product', '/admin/products'], ['member', '/admin/members'], ['service', '/admin/service'], ['review', '/admin/reviews'], ['marketing', '/admin/coupons'], ['content', '/admin/notices'], ['stats', '/admin/stats'], ['system', '/admin/settings']];
  r.get('/', need(null), (req, res, next) => { if (can(req.session.admin, 'dashboard')) return next(); const l = LANDING.find(([p]) => can(req.session.admin, p)); if (l) return res.redirect(l[1]); res.status(403).page('admin/forbidden', { title: '无权限' }); });
  r.get('/', need('dashboard'), (req, res) => {
    const today = U.today(), valid = "status NOT IN ('cancelled','unpaid','refunded')";
    const sum = netSales;
    const t = sum(`${valid} AND paid_at LIKE ?`, today + '%'), all = sum(valid);
    const stats = {
      todaySales: t.a, todayOrders: db.get('SELECT COUNT(*) n FROM orders WHERE created_at LIKE ?', today + '%').n, totalSales: all.a, totalOrders: db.get('SELECT COUNT(*) n FROM orders').n,
      members: db.get('SELECT COUNT(*) n FROM users').n, todayMembers: db.get('SELECT COUNT(*) n FROM users WHERE created_at LIKE ?', today + '%').n,
      products: db.get('SELECT COUNT(*) n FROM products WHERE status=1').n, toShip: res.locals.pending.orders, unpaid: db.get("SELECT COUNT(*) n FROM orders WHERE status='unpaid'").n,
      pendingAS: db.get("SELECT COUNT(*) n FROM aftersales WHERE status IN ('pending','returned')").n, pendingReview: db.get("SELECT COUNT(*) n FROM reviews WHERE status='pending'").n, unitPrice: all.n ? all.a / all.n : 0
    };
    const days = [], labels = [], sales = [], orders = [];
    for (let i = 6; i >= 0; i--) { const d = U.offset(-i * 86400000).slice(0, 10); days.push(d); labels.push(d.slice(5)); const x = sum(`${valid} AND paid_at LIKE ?`, d + '%'); sales.push(round2(x.a)); orders.push(x.n); }
    const trend = chart.trend({ labels, series: [{ name: '销售额(元)', color: '#d4202a', values: sales, type: 'bar' }, { name: '订单数', color: '#f2a93b', values: orders, type: 'line' }] });
    const status = Object.keys(U.ORDER_STATUS).map(k => ({ label: U.ORDER_STATUS[k], value: db.get('SELECT COUNT(*) n FROM orders WHERE status=?', k).n }));
    const top = db.all("SELECT oi.name label, SUM(oi.qty) value FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status NOT IN ('cancelled','unpaid','refunded') GROUP BY oi.name ORDER BY value DESC LIMIT 5");
    const recent = db.all('SELECT o.*, u.nickname FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 8');
    const warns = db.all('SELECT p.name, s.spec_text, s.stock, p.id pid FROM skus s JOIN products p ON p.id=s.product_id WHERE s.stock<=? AND p.status=1 ORDER BY s.stock LIMIT 5', int(svc.S('stock_warn'), 10));
    res.page('admin/dashboard', { title: '数据概览', stats, trend, statusChart: chart.donut(status), topChart: chart.hbar(top, { unit: '件' }), recent, warns });
  });

  // ================= 商品 =================
  // 经营范围提示(自营商品不自动处理,只在新增/编辑时提示;复用供应商类目允许/禁售清单)
  const scopeWarnOf = (name, pname) => { const w = jdvop.compliance.scopeWarning([pname, name].filter(Boolean)); return w ? w.msg : ''; };
  const scopeWarnCat = id => { const c = db.get('SELECT c.name, p.name pname FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.id=?', int(id)); return c ? scopeWarnOf(c.name, c.pname) : ''; };
  const catOptions = () => db.all('SELECT c.*, p.name pname FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.status>=0 ORDER BY COALESCE(p.sort,c.sort), c.parent_id, c.sort').map(c => ({ v: c.id, t: (c.parent_id ? '　└ ' : '') + c.name, parent: c.parent_id, scope: c.parent_id ? scopeWarnOf(c.name, c.pname) : '' }));
  r.get('/products', need('product'), (req, res) => {
    const { q = '', cat = '', status = '', stock = '' } = req.query;
    const where = ['1=1'], params = [];
    if (q.trim()) { where.push('(p.name LIKE ? OR p.id=?)'); params.push('%' + q.trim() + '%', int(q)); }
    if (cat) { const ids = [int(cat), ...db.all('SELECT id FROM categories WHERE parent_id=?', int(cat)).map(x => x.id)]; where.push(`p.category_id IN (${ids.join(',')})`); }
    if (status !== '') { where.push('p.status=?'); params.push(int(status)); }
    if (stock === 'low') { where.push(`p.id IN (SELECT product_id FROM skus WHERE stock<=${int(svc.S('stock_warn'), 10)})`); }
    const pg = U.paginate(`SELECT p.*, c.name cname, b.name bname FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id WHERE ${where.join(' AND ')} ORDER BY p.id DESC`, params, req.query.page, 15);
    pg.rows.forEach(p => { p.img = U.firstImg(p.images); p.skuCount = db.get('SELECT COUNT(*) n FROM skus WHERE product_id=?', p.id).n; p.minStock = db.get('SELECT MIN(stock) n FROM skus WHERE product_id=?', p.id).n; });
    res.page('admin/products', { title: '商品管理', pg, q, cat, status, stock, cats: catOptions() });
  });
  const productForm = (req, res, p, skus, flashMsg) => res.page('admin/product-form', { title: p && p.id ? '编辑商品' : '新增商品', p, skus, cats: catOptions(), brands: db.all('SELECT * FROM brands ORDER BY sort'), tpls: db.all('SELECT * FROM shipping_templates'), flash: flashMsg || res.locals.flash });
  r.get('/products/new', need('product'), (req, res) => productForm(req, res, { name: '', subtitle: '', category_id: 0, brand_id: 0, price: 0, market_price: null, description: '', images: '[]', status: 1, is_hot: 0, is_new: 0, template_id: 0, weight: 0.5, spec_names: '规格', sort: 0 }, [{ attrs: '{"规格":"默认"}', spec_text: '默认', price: 0, stock: 100, code: '' }]));
  r.get('/products/:id/edit', need('product'), (req, res) => {
    const p = db.get('SELECT * FROM products WHERE id=?', int(req.params.id));
    if (!p) { flash(req, 'error', '商品不存在'); return res.redirect('/admin/products'); }
    const skus = db.all('SELECT * FROM skus WHERE product_id=? ORDER BY id', p.id);
    res.locals.bannedHits = require('../lib/banned').summarize(require('../lib/banned').checkProduct(p, skus));
    res.locals.scopeHint = p.supplier ? '' : scopeWarnCat(p.category_id);
    productForm(req, res, p, skus);
  });
  r.post('/products/save', need('product'), (req, res) => {
    const b = req.body, id = int(b.id);
    const ex = id ? db.get('SELECT * FROM products WHERE id=?', id) : null;
    const specNames = String(b.spec_names || '').split(/[,,\s]+/).filter(Boolean).slice(0, 3);
    const arr = k => [].concat(b[k] || []);
    const sp = arr('sku_spec'), sprice = arr('sku_price'), sstock = arr('sku_stock'), scode = arr('sku_code'), sid = arr('sku_id');
    let images = [...String(b.images_keep ? [].concat(b.images_keep).join('\n') : '').split('\n').map(s => s.trim()).filter(Boolean), ...filesOf(req, 'image_files')];
    String(b.image_urls || '').split(/\n/).map(s => s.trim()).filter(s => /^(\/|https?:\/\/)/.test(s)).forEach(s => images.push(s));
    images = [...new Set(images)].slice(0, 9);
    const skus = sp.map((spec, i) => {
      const vals = String(spec).split(/[\/|,,]/).map(s => s.trim()).filter(Boolean); const attrs = {}; specNames.forEach((n, k) => attrs[n] = vals[k] || '默认');
      return { id: int(sid[i]), attrs: JSON.stringify(attrs), spec_text: Object.values(attrs).join(' / '), price: round2(num(sprice[i])), stock: Math.max(0, int(sstock[i])), code: String(scode[i] || '').trim() };
    }).filter((s, i) => String(sp[i]).trim() !== '');
    const row = { name: String(b.name || '').trim(), subtitle: String(b.subtitle || '').trim(), ship_from: String(b.ship_from || '').trim().slice(0, 20), category_id: int(b.category_id), brand_id: int(b.brand_id), market_price: String(b.market_price || '').trim() === '' ? null : round2(num(b.market_price)), description: String(b.description || ''), status: b.status ? 1 : 0, is_hot: b.is_hot ? 1 : 0, is_new: b.is_new ? 1 : 0, template_id: int(b.template_id), weight: num(b.weight, 0.5), spec_names: specNames.join(','), sort: int(b.sort), is_top: b.is_top ? 1 : 0, supplier_sales: String(b.supplier_sales ?? '').trim() === '' ? null : Math.max(0, int(b.supplier_sales)), images: JSON.stringify(images), no_reason_return: b.no_reason_return === '1' ? 1 : b.no_reason_return === '0' ? 0 : null };
    const fail = m => { flash(req, 'error', m); const pp = { ...row, id: id || undefined, price: 0 }; productForm(req, res, pp, skus.length ? skus : [{ attrs: '{}', spec_text: '默认', price: 0, stock: 0, code: '' }], { type: 'error', msg: m }); };
    if (!row.name) return fail('请填写商品名称');
    if (!row.category_id) return fail('请选择商品分类');
    if (!row.template_id || !db.get('SELECT 1 FROM shipping_templates WHERE id=?', row.template_id)) return fail('请选择运费模板');
    if (row.market_price != null && row.market_price <= 0) row.market_price = null;
    if (row.market_price != null && skus.length && row.market_price <= Math.min(...skus.map(s => s.price))) return fail('划线原价需高于售价;如不确定曾真实销售的价格,请留空');
    if (!skus.length) return fail('至少需要一个规格(SKU)');
    if (skus.some(s => s.price <= 0)) return fail('每个规格的价格需大于 0');
    if (!specNames.length) return fail('请填写规格名称,如:颜色,尺码');
    // 供应商商品:价格按加价规则自动维护、库存跟随供应商可售,不能在此改价/增删规格;不展示划线价
    const isSup = ex && ex.supplier;
    if (isSup) {
      row.market_price = null;
      const cur = db.all('SELECT * FROM skus WHERE product_id=?', id);
      for (const s of skus) { const c = cur.find(x => x.id === s.id); if (c) { s.price = c.price; s.stock = c.stock; } }
      skus.splice(0, skus.length, ...skus.filter(s => cur.some(x => x.id === s.id)), ...cur.filter(c => !skus.some(s => s.id === c.id)).map(c => ({ ...c })));
    }
    db.transaction(() => {
      let pid = id;
      row.price = Math.min(...skus.map(s => s.price));
      if (ex) { const ks = Object.keys(row); db.prepare(`UPDATE products SET ${ks.map(k => k + '=?').join(',')} WHERE id=?`).run(...ks.map(k => row[k]), id); }
      else { row.created_at = now(); row.stock = 0; const ks = Object.keys(row); pid = db.prepare(`INSERT INTO products(${ks.join(',')}) VALUES(${ks.map(() => '?').join(',')})`).run(...ks.map(k => row[k])).lastInsertRowid; }
      const keep = [];
      for (const s of skus) {
        if (s.id && db.get('SELECT 1 FROM skus WHERE id=? AND product_id=?', s.id, pid)) { db.exec1('UPDATE skus SET attrs=?,spec_text=?,price=?,stock=?,code=? WHERE id=?', s.attrs, s.spec_text, s.price, s.stock, s.code, s.id); keep.push(s.id); }
        else keep.push(db.exec1('INSERT INTO skus(product_id,attrs,spec_text,price,stock,code) VALUES(?,?,?,?,?,?)', pid, s.attrs, s.spec_text, s.price, s.stock, s.code).lastInsertRowid);
      }
      for (const old of db.all('SELECT id FROM skus WHERE product_id=?', pid)) if (!keep.includes(old.id)) {
        if (db.get('SELECT 1 FROM order_items WHERE sku_id=?', old.id) || db.get('SELECT 1 FROM seckills WHERE sku_id=?', old.id) || db.get('SELECT 1 FROM groupbuys WHERE sku_id=?', old.id)) continue; // 已被引用的 SKU 保留
        db.exec1('DELETE FROM cart WHERE sku_id=?', old.id); db.exec1('DELETE FROM skus WHERE id=?', old.id);
      }
      db.exec1('UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM skus WHERE product_id=?), price=(SELECT MIN(price) FROM skus WHERE product_id=?) WHERE id=?', pid, pid, pid);
      log(req, ex ? '编辑商品' : '新增商品', `#${pid} ${row.name}`);
    })();
    if (isSup) {
      const ok = jdvop.recheckReview(id); const why = jdvop.listBlockReason(id);
      if (why && row.status) db.exec1('UPDATE products SET status=0 WHERE id=?', id);
      if (ok === true) log(req, '供应商商品审核通过', `#${id} ${row.name}`);
      if (why) { flash(req, 'warn', '商品已保存,但仍不能上架:' + why); return res.redirect('/admin/products/' + id + '/edit'); }
    }
    const hits = require('../lib/banned').checkProduct(row, skus);
    if (hits.length) { flash(req, 'warn', '商品已保存,但检测到违禁/敏感词,请核实修改:' + require('../lib/banned').summarize(hits)); return res.redirect('/admin/products/' + (id || db.get('SELECT MAX(id) n FROM products').n) + '/edit'); }
    const scope = isSup ? '' : scopeWarnCat(row.category_id);
    if (scope) { flash(req, 'warn', '商品已保存。⚠️ 经营范围提示:' + scope + ';经营范围变更前请勿上架销售,建议设为下架。'); return res.redirect('/admin/products/' + (id || db.get('SELECT MAX(id) n FROM products').n) + '/edit'); }
    if (!ex || ex.sort !== row.sort || (ex.is_top || 0) !== row.is_top) log(req, '修改推荐排序', `#${id || 'new'} ${row.name}:权重 ${ex ? ex.sort : '-'}→${row.sort},置顶 ${ex ? (ex.is_top ? '是' : '否') : '-'}→${row.is_top ? '是' : '否'}`);
    if (ex && (ex.supplier_sales ?? null) !== row.supplier_sales) log(req, '修改供应商销量参考', `#${id} ${ex.supplier_sales ?? '空'}→${row.supplier_sales ?? '空'}`);
    flash(req, 'success', '商品已保存'); res.redirect('/admin/products');
  });
  // 违禁词检查:可编辑词表 + 扫描现有商品
  r.get('/banned-words', need('product'), (req, res) => res.page('admin/banned-words', { title: '违禁词检查', words: require('../lib/banned').words(), rows: require('../lib/banned').scanAll() }));
  r.post('/banned-words', need('product'), (req, res) => {
    const list = [...new Set(String(req.body.words || '').split(/\r?\n/).map(s => s.trim().slice(0, 20)).filter(Boolean))].slice(0, 500);
    svc.setSetting('banned_words', list.join('\n'));
    log(req, '修改违禁词表', `${list.length} 个`); flash(req, 'success', `违禁词表已保存(${list.length} 个)`); res.redirect('/admin/banned-words');
  });
  // 批量上/下架
  r.post('/products/batch', need('product'), (req, res) => {
    const ids = [...new Set([].concat(req.body.ids || []).map(x => int(x)).filter(x => x > 0))].slice(0, 500), st = req.body.action === 'on' ? 1 : req.body.action === 'off' ? 0 : null;
    if (st === null || !ids.length) { flash(req, 'error', '请先勾选商品并选择批量操作'); return back(req, res, '/admin/products'); }
    const blocked = st ? ids.map(id => jdvop.listBlockReason(id)).filter(Boolean) : [];
    const okIds = st ? ids.filter(id => !jdvop.listBlockReason(id)) : ids;
    const n = okIds.length ? db.prepare(`UPDATE products SET status=? WHERE status>=0 AND id IN (${okIds.map(() => '?').join(',')})`).run(st, ...okIds).changes : 0;
    log(req, st ? '批量上架商品' : '批量下架商品', `${n} 件:#${okIds.join(',#')}`.slice(0, 300));
    flash(req, blocked.length ? 'warn' : 'success', `已${st ? '上架' : '下架'} ${n} 件商品` + (blocked.length ? `;${blocked.length} 件不能上架:${blocked.join(';')}`.slice(0, 400) : '')); back(req, res, '/admin/products');
  });
  // 快速上架:单规格商品一页填完(名称/分类/运费模板/价格/库存),同样做违禁词检查
  r.get('/products/quick', need('product'), (req, res) => res.page('admin/product-quick', { title: '快速上架', cats: catOptions(), tpls: db.all('SELECT * FROM shipping_templates ORDER BY id'), brands: db.all('SELECT * FROM brands ORDER BY sort'), b: {} }));
  r.post('/products/quick', need('product'), (req, res) => {
    const b = req.body;
    const row = { name: String(b.name || '').trim().slice(0, 60), subtitle: String(b.subtitle || '').trim().slice(0, 80), category_id: int(b.category_id), brand_id: int(b.brand_id), template_id: int(b.template_id), description: String(b.description || '').trim().slice(0, 5000), market_price: String(b.market_price || '').trim() === '' ? null : round2(num(b.market_price)), no_reason_return: b.no_reason_return === '1' ? 1 : b.no_reason_return === '0' ? 0 : null, status: b.status === '0' ? 0 : 1 };
    const price = round2(num(b.price)), stock = Math.max(0, int(b.stock)), spec = String(b.spec || '').trim().slice(0, 30) || '默认';
    const image = String(b.image_url || '').trim();
    const fail = m => { flash(req, 'error', m); res.page('admin/product-quick', { title: '快速上架', cats: catOptions(), tpls: db.all('SELECT * FROM shipping_templates ORDER BY id'), brands: db.all('SELECT * FROM brands ORDER BY sort'), b, flash: { type: 'error', msg: m } }); };
    if (!row.name) return fail('请填写商品名称');
    if (!row.category_id || !db.get('SELECT 1 FROM categories WHERE id=? AND parent_id>0', row.category_id)) return fail('请选择商品分类(二级分类)');
    if (!row.template_id || !db.get('SELECT 1 FROM shipping_templates WHERE id=?', row.template_id)) return fail('请选择运费模板');
    if (!(price > 0)) return fail('售价需大于 0');
    if (row.market_price != null && row.market_price <= 0) row.market_price = null;
    if (row.market_price != null && row.market_price <= price) return fail('划线原价需高于售价;如不确定曾真实销售的价格,请留空');
    if (image && !/^(\/|https?:\/\/)/.test(image)) return fail('图片地址需以 / 或 http(s):// 开头');
    let pid;
    db.transaction(() => {
      Object.assign(row, { price, stock, images: JSON.stringify(image ? [image] : []), spec_names: '规格', weight: 0.5, sort: 0, is_hot: 0, is_new: 1, created_at: now() });
      const ks = Object.keys(row); pid = db.prepare(`INSERT INTO products(${ks.join(',')}) VALUES(${ks.map(() => '?').join(',')})`).run(...ks.map(k => row[k])).lastInsertRowid;
      db.exec1('INSERT INTO skus(product_id,attrs,spec_text,price,stock,code) VALUES(?,?,?,?,?,?)', pid, JSON.stringify({ 规格: spec }), spec, price, stock, String(b.code || '').trim().slice(0, 40));
      log(req, '快速上架商品', `#${pid} ${row.name}`);
    })();
    const B = require('../lib/banned'), hits = B.checkProduct(row, [{ spec_text: spec }]);
    if (hits.length) { flash(req, 'warn', '商品已保存,但检测到违禁/敏感词,请核实修改:' + B.summarize(hits)); return res.redirect('/admin/products/' + pid + '/edit'); }
    const scope = scopeWarnCat(row.category_id);
    if (scope) { flash(req, 'warn', `商品 #${pid} 已保存。⚠️ 经营范围提示:${scope};经营范围变更前请勿上架销售,建议设为下架。`); return res.redirect('/admin/products/' + pid + '/edit'); }
    flash(req, 'success', `商品 #${pid} 已${row.status ? '上架' : '保存为下架状态'};如需多规格或上传图片,可在「编辑」中补充`); res.redirect('/admin/products');
  });
  // 推荐排序:列表页直接修改权重 / 置顶(销量不可人工编辑)
  r.post('/products/:id/rank', need('product'), (req, res) => {
    const p = db.get('SELECT id, name, sort, is_top FROM products WHERE id=?', int(req.params.id));
    if (!p) { flash(req, 'error', '商品不存在'); return back(req, res, '/admin/products'); }
    const sort = req.body.sort === undefined ? p.sort : Math.max(-999999, Math.min(999999, int(req.body.sort)));
    const topV = req.body.is_top === undefined ? undefined : [].concat(req.body.is_top).pop();
    const top = topV === undefined ? (p.is_top || 0) : (topV === '1' ? 1 : 0);
    if (sort !== p.sort || top !== (p.is_top || 0)) {
      db.exec1('UPDATE products SET sort=?, is_top=? WHERE id=?', sort, top, p.id);
      log(req, '修改推荐排序', `#${p.id} ${p.name}:权重 ${p.sort}→${sort},置顶 ${p.is_top ? '是' : '否'}→${top ? '是' : '否'}`);
      flash(req, 'success', `「${p.name}」推荐排序已更新`);
    }
    back(req, res, '/admin/products');
  });
  r.post('/products/:id/toggle', need('product'), (req, res) => { const tp = db.get('SELECT status FROM products WHERE id=?', int(req.params.id)); const why = tp && !tp.status && jdvop.listBlockReason(int(req.params.id)); if (why) { flash(req, 'error', why); return back(req, res, '/admin/products'); } db.exec1('UPDATE products SET status=1-status WHERE id=?', int(req.params.id)); log(req, '商品上/下架', '#' + req.params.id); back(req, res, '/admin/products'); });
  r.post('/products/:id/stock', need('product'), (req, res) => {
    const s = db.get('SELECT * FROM skus WHERE id=?', int(req.body.sku_id)); if (s) { db.exec1('UPDATE skus SET stock=? WHERE id=?', Math.max(0, int(req.body.stock)), s.id); db.exec1('UPDATE products SET stock=(SELECT SUM(stock) FROM skus WHERE product_id=?) WHERE id=?', s.product_id, s.product_id); log(req, '调整库存', `SKU#${s.id} → ${int(req.body.stock)}`); }
    back(req, res, '/admin/inventory');
  });
  r.post('/products/:id/delete', need('product'), (req, res) => {
    const id = int(req.params.id);
    if (db.get('SELECT 1 FROM order_items WHERE product_id=?', id)) { flash(req, 'error', '该商品已有订单记录,不能删除,请改为下架'); return res.redirect('/admin/products'); }
    db.transaction(() => { for (const t of ['skus', 'favorites', 'history', 'reviews', 'seckills', 'groupbuys']) db.exec1(`DELETE FROM ${t} WHERE product_id=?`, id); db.exec1('DELETE FROM cart WHERE sku_id NOT IN (SELECT id FROM skus)'); db.exec1('DELETE FROM products WHERE id=?', id); })();
    log(req, '删除商品', '#' + id); flash(req, 'success', '商品已删除'); res.redirect('/admin/products');
  });
  r.get('/inventory', need('product'), (req, res) => {
    const th = int(svc.S('stock_warn'), 10);
    const rows = db.all('SELECT s.*, p.name, p.id pid, p.status FROM skus s JOIN products p ON p.id=s.product_id WHERE s.stock<=? ORDER BY s.stock, p.id', th);
    res.page('admin/inventory', { title: '库存预警', rows, th });
  });
  r.get('/export/products', need('stats'), (req, res) => void log(req, '导出商品库存CSV', '') || sendCSV(res, '商品库存', ['商品ID', '商品名称', '分类', '品牌', '规格', '编码', '价格', '库存', '销量', '状态'], db.all('SELECT p.id,p.name,c.name cn,b.name bn,s.spec_text,s.code,s.price,s.stock,p.sales,p.status FROM skus s JOIN products p ON p.id=s.product_id LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id ORDER BY p.id,s.id').map(x => [x.id, x.name, x.cn, x.bn, x.spec_text, x.code, x.price, x.stock, x.sales, x.status ? '上架' : '下架'])));

  // ================= 分类 / 品牌 / 运费模板(通用 CRUD) =================
  crud(r, { path: 'categories', table: 'categories', perm: 'product', title: '分类管理', singular: '分类', order: 'CASE WHEN parent_id=0 THEN sort ELSE (SELECT sort FROM categories p WHERE p.id=categories.parent_id) END, parent_id, sort, id', toggle: 'status',
    cols: [{ label: 'ID', f: x => x.id }, { label: '分类名称', f: x => (x.parent_id ? '　└ ' : '<b>') + esc(x.icon || '') + ' ' + esc(x.name) + (x.parent_id ? '' : '</b>') }, { label: '上级', f: x => x.parent_id ? esc((db.get('SELECT name FROM categories WHERE id=?', x.parent_id) || {}).name) : '<span class="muted">顶级</span>' }, { label: '商品数', f: x => db.get('SELECT COUNT(*) n FROM products WHERE category_id=?', x.id).n }, { label: '排序', f: x => x.sort }, { label: '七天无理由', f: x => x.no_7day ? '<span class="tag">鲜活易腐类(不支持)</span>' : (x.parent_id && (db.get('SELECT no_7day FROM categories WHERE id=?', x.parent_id) || {}).no_7day ? '<span class="tag">随上级:不支持</span>' : '<span class="tag green">支持</span>') }, { label: '状态', f: x => x.status ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>' }],
    fields: [{ name: 'name', label: '分类名称', required: true }, { name: 'parent_id', label: '上级分类', type: 'select', numeric: true, options: () => [{ v: 0, t: '顶级分类' }, ...db.all('SELECT id v, name t FROM categories WHERE parent_id=0')] }, { name: 'icon', label: '图标(emoji)', help: '仅顶级分类使用,例如 📱' }, { name: 'sort', label: '排序(小在前)', type: 'number', int: true }, { name: 'no_7day', label: '鲜活易腐类(不支持7天无理由)', type: 'checkbox', def: 0, help: '勾选后该分类(含子分类)商品默认不支持七天无理由退货,商品编辑页可单独覆盖' }, { name: 'status', label: '启用', type: 'checkbox', def: 1 }],
    validate: (row, ex) => (ex && row.parent_id === ex.id) ? '上级分类不能是自己' : (row.parent_id && db.get('SELECT parent_id FROM categories WHERE id=?', row.parent_id).parent_id ? '仅支持两级分类' : (ex && row.parent_id && db.get('SELECT 1 FROM categories WHERE parent_id=?', ex.id) ? '该分类下有子分类,不能设为二级' : null)),
    canDelete: x => db.get('SELECT 1 FROM products WHERE category_id=?', x.id) ? '该分类下还有商品,不能删除' : (db.get('SELECT 1 FROM categories WHERE parent_id=?', x.id) ? '请先删除子分类' : null) }, ctx);
  crud(r, { path: 'brands', table: 'brands', perm: 'product', title: '品牌管理', singular: '品牌', order: 'sort,id', toggle: 'status', search: ['name'],
    cols: [{ label: 'ID', f: x => x.id }, { label: '品牌', f: x => `<b style="color:${esc(x.color)}">${esc(x.name)}</b>` }, { label: '简介', f: x => esc(x.description) }, { label: '商品数', f: x => db.get('SELECT COUNT(*) n FROM products WHERE brand_id=?', x.id).n }, { label: '排序', f: x => x.sort }, { label: '状态', f: x => x.status ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>' }],
    fields: [{ name: 'name', label: '品牌名称', required: true }, { name: 'description', label: '简介' }, { name: 'color', label: '品牌色', def: '#d4202a', pattern: /^#[0-9a-fA-F]{6}$/, patternMsg: '品牌色格式如 #d4202a' }, { name: 'sort', label: '排序', type: 'number', int: true }, { name: 'status', label: '启用', type: 'checkbox', def: 1 }],
    canDelete: x => db.get('SELECT 1 FROM products WHERE brand_id=?', x.id) ? '该品牌下还有商品,不能删除' : null }, ctx);
  crud(r, { path: 'shipping', table: 'shipping_templates', perm: 'product', title: '运费模板', singular: '运费模板', order: 'id', search: ['name'],
    cols: [{ label: 'ID', f: x => x.id }, { label: '模板名称', f: x => '<b>' + esc(x.name) + '</b>' }, { label: '基础运费', f: x => '¥' + (svc.parseRules(x.rules).base || 0) }, { label: '包邮门槛', f: x => x.free_over > 0 ? (x.free_over < 1 ? '全场包邮' : '满 ¥' + x.free_over) : '无' }, { label: '偏远地区', f: x => esc((svc.parseRules(x.rules).remote_provinces || '-') + (svc.parseRules(x.rules).remote_fee != null ? ' ¥' + svc.parseRules(x.rules).remote_fee : '')) }, { label: '商品数', f: x => db.get('SELECT COUNT(*) n FROM products WHERE template_id=?', x.id).n }],
    fields: [{ name: 'name', label: '模板名称', required: true }, { name: 'base', label: '基础运费(元)', type: 'number', virtual: true }, { name: 'free_over', label: '满额包邮门槛(元,0=不包邮,填0.01=全场包邮)', type: 'number' }, { name: 'remote_provinces', label: '偏远省份(逗号分隔)', virtual: true, help: '例:新疆维吾尔自治区,西藏自治区' }, { name: 'remote_fee', label: '偏远地区运费(元)', type: 'number', virtual: true }, { name: 'remark', label: '备注' }],
    virtualLoad: row => Object.assign(row, { base: svc.parseRules(row.rules).base || 0, remote_provinces: svc.parseRules(row.rules).remote_provinces || '', remote_fee: svc.parseRules(row.rules).remote_fee || 0 }),
    before: row => { row.rules = JSON.stringify({ base: row.base, remote_provinces: row.remote_provinces, remote_fee: row.remote_fee }); delete row.base; delete row.remote_provinces; delete row.remote_fee; },
    canDelete: x => x.id === 1 ? '默认模板不能删除' : (db.get('SELECT 1 FROM products WHERE template_id=?', x.id) ? '有商品使用该模板,不能删除' : null) }, ctx);

  // ================= 订单 =================
  const orderWhere = query => {
    const { q = '', status = '', type = '', from = '', to = '' } = query;
    const where = ['1=1'], params = [];
    if (q.trim()) { where.push('(o.order_no LIKE ? OR o.receiver LIKE ? OR o.phone LIKE ? OR u.phone LIKE ? OR o.tracking_no LIKE ?)'); const k = '%' + q.trim() + '%'; params.push(k, k, k, k, k); }
    if (status) { where.push('o.status=?'); params.push(status); }
    if (type) { where.push('o.type=?'); params.push(type); }
    if (int(query.uid)) { where.push('o.user_id=?'); params.push(int(query.uid)); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('o.created_at>=?'); params.push(from + ' 00:00:00'); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('o.created_at<=?'); params.push(to + ' 23:59:59'); }
    return { where, params, q: String(q), status: String(status), type: String(type), from: String(from), to: String(to) };
  };
  r.get('/orders', need('order'), (req, res) => {
    const { where, params, q, status, type, from, to } = orderWhere(req.query);
    const sql = `SELECT o.*, u.nickname, u.phone uphone FROM orders o JOIN users u ON u.id=o.user_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC`;
    const pg = U.paginate(sql, params, req.query.page, 15);
    pg.rows.forEach(o => { o.items = db.all('SELECT * FROM order_items WHERE order_id=?', o.id); if (o.type === 'group') o.groupStatus = (db.get('SELECT status FROM groups WHERE id=?', o.group_id) || {}).status; });
    const counts = {}; for (const x of db.all('SELECT status, COUNT(*) n FROM orders GROUP BY status')) counts[x.status] = x.n;
    res.page('admin/orders', { title: '订单管理', pg, q, status, type, from, to, counts });
  });
  r.get('/orders/export', need('stats'), (req, res) => {
    const { where, params } = orderWhere(req.query); // 导出与列表筛选条件一致
    const rows = db.all(`SELECT o.*, u.phone uphone FROM orders o JOIN users u ON u.id=o.user_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC`, ...params).map(o => [o.order_no, o.created_at, o.uphone, U.ORDER_STATUS[o.status], o.type, o.goods_amount, o.freight, o.level_discount, o.coupon_discount, o.points_discount, o.pay_amount, U.PAY_METHOD[o.pay_method] || '', o.receiver, o.phone, `${o.province}${o.city}${o.district}${o.detail}`, o.express_company || '', o.tracking_no || '', db.all('SELECT name,spec_text,qty FROM order_items WHERE order_id=?', o.id).map(i => `${i.name}(${i.spec_text})x${i.qty}`).join(';')]);
    log(req, '导出订单CSV', rows.length + '条 ' + JSON.stringify(req.query).slice(0, 150));
    sendCSV(res, '订单', ['订单号', '下单时间', '会员手机', '状态', '类型', '商品金额', '运费', '会员折扣', '优惠券', '积分抵扣', '实付', '支付方式', '收货人', '收货电话', '收货地址', '快递公司', '运单号', '商品'], rows);
  });
  r.get('/orders/:id', need('order'), (req, res) => {
    const o = db.get('SELECT o.*, u.nickname, u.phone uphone FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?', int(req.params.id));
    if (!o) { flash(req, 'error', '订单不存在'); return res.redirect('/admin/orders'); }
    const group = o.group_id ? db.get('SELECT * FROM groups WHERE id=?', o.group_id) : null;
    res.locals.asInfo = asInfo(o);
    const so = db.get('SELECT * FROM supplier_orders WHERE order_id=?', o.id);
    res.locals.sup = { so, packages: db.all('SELECT * FROM order_packages WHERE order_id=? ORDER BY id', o.id).map(p => ({ ...p, nos: U.jsonArr(p.tracking_nos), its: U.jsonArr(p.items) })), items: db.all('SELECT * FROM order_items WHERE order_id=? AND supplier IS NOT NULL', o.id), ownCount: db.get('SELECT COUNT(*) n FROM order_items WHERE order_id=? AND supplier IS NULL', o.id).n, mock: J_cfgMode() === 'mock', alerts: db.all('SELECT * FROM supplier_alerts WHERE order_id=? ORDER BY id DESC LIMIT 10', o.id) };
    res.page('admin/order', { title: '订单详情', o, items: db.all('SELECT * FROM order_items WHERE order_id=?', o.id), traces: db.all('SELECT * FROM traces WHERE order_id=? ORDER BY id DESC', o.id), aftersale: db.get('SELECT * FROM aftersales WHERE order_id=? ORDER BY id DESC LIMIT 1', o.id), invoice: db.get('SELECT * FROM invoices WHERE order_id=?', o.id), group });
  });
  r.post('/orders/:id/ship', need('order'), (req, res) => {
    const company = String(req.body.company || '').trim(), no = String(req.body.tracking_no || '').trim();
    if (!company || !/^[A-Za-z0-9\-]{6,30}$/.test(no)) { flash(req, 'error', '请选择快递公司并填写 6-30 位字母数字运单号'); return back(req, res, '/admin/orders'); }
    const x = svc.shipOrder(int(req.params.id), company, no);
    if (x.ok) log(req, '订单发货', `#${req.params.id} ${company} ${no}`);
    flash(req, x.ok ? 'success' : 'error', x.ok ? '发货成功' : x.msg); res.redirect('/admin/orders/' + int(req.params.id));
  });
  r.post('/orders/:id/cancel', need('order'), (req, res) => {
    const o = db.get('SELECT * FROM orders WHERE id=?', int(req.params.id)); if (!o) return res.redirect('/admin/orders');
    const reason = String(req.body.reason || '商家取消').slice(0, 100);
    const so = db.get('SELECT * FROM supplier_orders WHERE order_id=?', o.id);
    if (so && ['submitted', 'confirmed', 'cancelling'].includes(so.status)) { flash(req, 'error', '该订单含已推送供应商的商品,请先在「供应商发货」面板取消供应商订单(取消成功后自动退款)'); return res.redirect('/admin/orders/' + o.id); }
    if (so && so.status === 'pending') db.exec1("UPDATE supplier_orders SET status='cancelled', error='商家取消订单(未推送)', refunded_customer=sale_amount, updated_at=? WHERE id=?", now(), so.id);
    if (so && ['failed', 'cancelled'].includes(so.status) && so.refunded_customer > 0 && o.status !== 'unpaid') {
      const left = round2(o.pay_amount - so.refunded_customer);
      const x = left > 0 ? svc.refundOrder(o.id, '商家取消:' + reason, false, { amount: left }) : { ok: true, cash: 0 };
      if (x.ok) { db.exec1("UPDATE orders SET status='refunded', cancelled_at=?, cancel_reason=? WHERE id=?", now(), '商家取消:' + reason, o.id); log(req, '取消订单并退款', `#${o.id} ${reason}(供应商部分此前已退)`); }
      flash(req, x.ok ? 'success' : 'error', x.ok ? `订单已取消,退款 ¥${(x.cash || 0).toFixed(2)}(供应商部分此前已退)` : x.msg); return res.redirect('/admin/orders/' + o.id);
    }
    const x = o.status === 'unpaid' ? svc.cancelOrder(o.id, reason) : svc.refundOrder(o.id, '商家取消:' + reason);
    if (x.ok) log(req, o.status === 'unpaid' ? '取消订单' : '取消订单并退款', `#${o.id} ${reason}`);
    flash(req, x.ok ? 'success' : 'error', x.ok ? (o.status === 'unpaid' ? '订单已取消' : '订单已取消,款项原路退回' + (x.points ? `,退回积分 ${x.points}` : '')) : x.msg); res.redirect('/admin/orders/' + o.id);
  });
  r.post('/orders/:id/remark', need('order'), (req, res) => { db.exec1('UPDATE orders SET admin_remark=? WHERE id=?', String(req.body.admin_remark || '').slice(0, 200), int(req.params.id)); log(req, '订单备注', '#' + req.params.id); res.redirect('/admin/orders/' + int(req.params.id)); });
  r.post('/orders/:id/trace', need('order'), (req, res) => { const t = String(req.body.text || '').trim().slice(0, 100); if (t) db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', int(req.params.id), now(), t); else svc.advanceTrace(int(req.params.id)); log(req, '更新物流轨迹', '#' + req.params.id + ' ' + t); res.redirect('/admin/orders/' + int(req.params.id)); });
  r.post('/orders/:id/address', need('order'), (req, res) => {
    const o = db.get('SELECT * FROM orders WHERE id=?', int(req.params.id));
    if (o && ['unpaid', 'paid'].includes(o.status)) { db.exec1('UPDATE orders SET receiver=?, phone=?, detail=? WHERE id=?', String(req.body.receiver || o.receiver).slice(0, 20), String(req.body.phone || o.phone).slice(0, 20), String(req.body.detail || o.detail).slice(0, 100), o.id); log(req, '修改收货信息', '#' + o.id); flash(req, 'success', '收货信息已更新'); }
    res.redirect('/admin/orders/' + int(req.params.id));
  });

  // ================= 售后 =================
  r.get('/aftersales', need('order'), (req, res) => {
    const st = String(req.query.status || ''), q = String(req.query.q || '').trim(), type = String(req.query.type || '');
    const where = ['1=1'], params = [];
    if (st) { where.push('a.status=?'); params.push(st); }
    if (type && U.AFTERSALE_TYPE[type]) { where.push('a.type=?'); params.push(type); }
    if (q) { const k = '%' + q + '%'; where.push('(o.order_no LIKE ? OR u.phone LIKE ? OR u.nickname LIKE ? OR a.reason LIKE ? OR a.id=?)'); params.push(k, k, k, k, int(q.replace(/^#/, ''))); }
    const pg = U.paginate(`SELECT a.*, o.order_no, o.status ostatus, u.phone, u.nickname FROM aftersales a JOIN orders o ON o.id=a.order_id JOIN users u ON u.id=a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC`, params, req.query.page, 15);
    res.page('admin/aftersales', { title: '售后管理', pg, st, q, type });
  });
  r.get('/aftersales/:id', need('order'), (req, res) => {
    const a = db.get('SELECT a.*, o.order_no, o.pay_amount, o.points_used, o.points_discount, o.points_awarded, o.status ostatus, o.completed_at, o.no7_confirmed, u.phone, u.nickname, u.cancelled_at ucancel FROM aftersales a JOIN orders o ON o.id=a.order_id JOIN users u ON u.id=a.user_id WHERE a.id=?', int(req.params.id));
    if (!a) return res.redirect('/admin/aftersales');
    a.estPoints = a.pay_amount > 0 ? Math.round((a.points_used || 0) * Math.min(1, a.amount / a.pay_amount)) : (a.points_used || 0);
    if (a.supplier) { try { a.sup = JSON.parse(a.supplier_status || 'null'); } catch (e) { a.sup = null; } a.mock = J_cfgMode() === 'mock'; }
    res.page('admin/aftersale', { title: '售后详情', a, items: db.all('SELECT * FROM order_items WHERE order_id=?', a.order_id) });
  });
  const asNotify = (a, text) => svc.notifyService(a.user_id, 'staff', `【售后通知】售后单 #${a.id}:${text} 进度可在「我的 - 退款/售后」查看。`);
  function doRefund(req, a, note, okMsg) {
    const x = svc.refundOrder(a.order_id, (a.status === 'returned' ? '退货退款:' : '售后退款:') + a.reason, false, { amount: a.amount, aftersale: true });
    if (!x.ok) return x;
    db.exec1("UPDATE aftersales SET status='refunded', admin_note=?, refund_cash=?, refund_points=?, refund_channel='原路退回', refunded_at=?, updated_at=? WHERE id=?", note || okMsg, x.cash, x.points, now(), now(), a.id);
    asNotify(a, `退款已完成,退现金 ¥${x.cash.toFixed(2)}(原路退回)` + (x.points ? `,退积分 ${x.points}` : '') + '。');
    return x;
  }
  r.post('/aftersales/:id/handle', need('order'), (req, res) => {
    const a = db.get('SELECT * FROM aftersales WHERE id=?', int(req.params.id)); if (!a) return res.redirect('/admin/aftersales');
    const act = req.body.action, note = String(req.body.admin_note || '').slice(0, 200);
    const done = (m, ok = true) => { flash(req, ok ? 'success' : 'error', m); res.redirect('/admin/aftersales/' + a.id); };
    if (a.supplier) return done('供应商售后单由供应商审核/退款,请使用页面上的「供应商售后」操作;顾客退款会在供应商确认退款后自动完成', false);
    const split = x => `退现金 ¥${x.cash.toFixed(2)}(原路退回)/ 退积分 ${x.points}`;
    if (act === 'reject' && ['pending', 'returned'].includes(a.status)) { db.exec1("UPDATE aftersales SET status='rejected', admin_note=?, updated_at=? WHERE id=?", note || '不符合售后条件', now(), a.id); asNotify(a, '审核未通过,原因:' + (note || '不符合售后条件') + '。'); log(req, '拒绝售后', '#' + a.id); return done('已拒绝该申请'); }
    if (act === 'approve' && a.status === 'pending') {
      if (a.type !== 'refund') { db.exec1("UPDATE aftersales SET status='approved_return', admin_note=?, updated_at=? WHERE id=?", note || '同意退货,请寄回商品', now(), a.id); asNotify(a, '已同意退货,请将商品寄回并在售后详情中填写退货快递单号。'); log(req, '同意退货', '#' + a.id); return done('已同意,等待买家寄回商品'); }
      const x = doRefund(req, a, note, '同意退款'); if (!x.ok) return done(x.msg, false);
      log(req, '同意退款', `#${a.id} ${split(x)}`); return done('已同意并退款:' + split(x));
    }
    if (act === 'receive' && a.status === 'returned') {
      const x = doRefund(req, a, note, '已收到退货,退款完成'); if (!x.ok) return done(x.msg, false);
      log(req, '确认收货并退款', `#${a.id} ${split(x)}`); return done('已确认收货并退款:' + split(x));
    }
    if (act === 'exchange' && a.status === 'returned' && a.type === 'quality') {
      db.exec1("UPDATE aftersales SET status='exchanged', admin_note=?, updated_at=? WHERE id=?", note || '已收到退货,换货商品已寄出', now(), a.id);
      db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', a.order_id, now(), '质量问题换货:' + (note || '换货商品已寄出'));
      asNotify(a, '已收到退回商品,换货商品已安排寄出' + (note ? ':' + note : '') + '。'); log(req, '质量问题换货', '#' + a.id); return done('已标记换货完成');
    }
    done('当前状态不可执行该操作', false);
  });
  // 发票
  r.get('/invoices', need('order'), (req, res) => {
    const st = String(req.query.status || ''), q = String(req.query.q || '').trim(), where = ['1=1'], params = [];
    if (st) { where.push('i.status=?'); params.push(st); }
    if (q) { const k = '%' + q + '%'; where.push('(o.order_no LIKE ? OR u.phone LIKE ? OR i.title LIKE ?)'); params.push(k, k, k); }
    const pg = U.paginate(`SELECT i.*, o.order_no, u.phone FROM invoices i JOIN orders o ON o.id=i.order_id JOIN users u ON u.id=i.user_id WHERE ${where.join(' AND ')} ORDER BY i.id DESC`, params, req.query.page, 15);
    res.page('admin/invoices', { title: '发票管理', pg, st, q });
  });
  r.post('/invoices/:id/handle', need('order'), (req, res) => {
    const i = db.get('SELECT * FROM invoices WHERE id=?', int(req.params.id)); if (!i) return res.redirect('/admin/invoices');
    if (req.body.action === 'issue') { const no = 'FP' + U.today().replace(/-/g, '') + U.randCode(6); db.exec1("UPDATE invoices SET status='issued', invoice_no=? WHERE id=?", no, i.id); log(req, '开具发票', '#' + i.id + ' ' + no); }
    else if (req.body.action === 'reject') { db.exec1("UPDATE invoices SET status='rejected', admin_note=? WHERE id=?", String(req.body.admin_note || '信息有误').slice(0, 100), i.id); log(req, '驳回发票', '#' + i.id); }
    res.redirect('/admin/invoices');
  });

  // ================= 评价 =================
  r.get('/reviews', need('review'), (req, res) => {
    const st = req.query.status || '', q = String(req.query.q || '').trim();
    const where = ['1=1'], params = []; if (st) { where.push('r.status=?'); params.push(st); } if (q) { where.push('(r.content LIKE ? OR p.name LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    const pg = U.paginate(`SELECT r.*, p.name pname, u.nickname, u.phone FROM reviews r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.user_id WHERE ${where.join(' AND ')} ORDER BY r.id DESC`, params, req.query.page, 12);
    res.page('admin/reviews', { title: '评价管理', pg, st, q });
  });
  r.post('/reviews/:id/:act', need('review'), (req, res) => {
    const rv = db.get('SELECT * FROM reviews WHERE id=?', int(req.params.id)); if (!rv) return res.redirect('/admin/reviews');
    const act = req.params.act;
    if (act === 'approve' && rv.status !== 'approved') {
      db.transaction(() => { db.exec1("UPDATE reviews SET status='approved', points_awarded=1 WHERE id=?", rv.id); if (!rv.points_awarded && rv.status === 'pending') svc.addPoints(rv.user_id, int(svc.S('review_points'), 10), '评价奖励'); })(); // 新评价在发表时已发放积分;仅补发旧版待审核评价
      log(req, '评价审核通过(显示)', '#' + rv.id);
    } else if (act === 'reject') { db.exec1("UPDATE reviews SET status='rejected' WHERE id=?", rv.id); log(req, '隐藏评价', '#' + rv.id); }
    else if (act === 'reply') { const t = String(req.body.reply || '').trim().slice(0, 300); const B = require('../lib/banned'), hits = B.check({ reply: t }); db.exec1('UPDATE reviews SET reply=? WHERE id=?', t, rv.id); log(req, t ? '回复评价' : '清除评价回复', '#' + rv.id); if (hits.length) flash(req, 'warn', '回复已保存,但含违禁/敏感词:' + B.summarize(hits) + ',请核实修改'); }
    else if (act === 'delete') { db.exec1('DELETE FROM reviews WHERE id=?', rv.id); log(req, '删除评价', '#' + rv.id); }
    back(req, res, '/admin/reviews');
  });

  // ================= 会员 =================
  r.get('/members', need('member'), (req, res) => {
    const { q = '', level = '', status = '', sort = '' } = req.query;
    const where = ['1=1'], params = [];
    if (q.trim()) { where.push('(u.phone LIKE ? OR u.nickname LIKE ? OR u.invite_code=?)'); params.push('%' + q.trim() + '%', '%' + q.trim() + '%', q.trim()); }
    if (level) { where.push('u.level_id=?'); params.push(int(level)); } if (status !== '') { where.push('u.status=?'); params.push(status === 'cancelled' ? 0 : int(status)); }
    const order = { points: 'u.points DESC', spent: 'u.total_spent DESC' }[sort] || 'u.id DESC';
    if (status === 'cancelled') { where.pop(); params.pop(); where.push('u.cancelled_at IS NOT NULL'); } else if (status === '0') where.push('u.cancelled_at IS NULL');
    if (req.query.consent === '1') where.push('u.consent_at IS NOT NULL'); else if (req.query.consent === '0') where.push('u.consent_at IS NULL AND u.cancelled_at IS NULL');
    const pg = U.paginate(`SELECT u.*, l.name level_name, l.color level_color, (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) order_count FROM users u LEFT JOIN member_levels l ON l.id=u.level_id WHERE ${where.join(' AND ')} ORDER BY ${order}`, params, req.query.page, 15);
    res.page('admin/members', { title: '会员管理', pg, q, level, status, sort, consent: req.query.consent || '', levels: db.all('SELECT * FROM member_levels ORDER BY min_growth') });
  });
  r.get('/members/export', need('stats'), (req, res) => { log(req, '导出会员CSV', ''); sendCSV(res, '会员', ['ID', '手机号', '昵称', '等级', '成长值', '积分', '累计消费', '状态', '同意协议时间', '协议版本', '注销时间', '注册时间', '最近登录'], db.all('SELECT u.*, l.name ln FROM users u LEFT JOIN member_levels l ON l.id=u.level_id ORDER BY u.id').map(u => [u.id, u.cancelled_at ? '(已注销)' : u.phone, u.nickname, u.ln, u.growth, u.points, u.total_spent, u.cancelled_at ? '已注销' : u.status ? '正常' : '禁用', u.consent_at || '', u.consent_version || '', u.cancelled_at || '', u.created_at, u.last_login])); });
  r.get('/members/:id', need('member'), (req, res) => {
    const u = db.get('SELECT u.*, l.name level_name, l.color level_color, ref.nickname ref_name FROM users u LEFT JOIN member_levels l ON l.id=u.level_id LEFT JOIN users ref ON ref.id=u.referrer_id WHERE u.id=?', int(req.params.id));
    if (!u) { flash(req, 'error', '会员不存在'); return res.redirect('/admin/members'); }
    res.page('admin/member', { title: '会员详情', u, addrs: db.all('SELECT * FROM addresses WHERE user_id=?', u.id), orders: db.all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10', u.id), plog: db.all('SELECT * FROM points_log WHERE user_id=? ORDER BY id DESC LIMIT 10', u.id), aftersales: db.all('SELECT a.*, o.order_no FROM aftersales a JOIN orders o ON o.id=a.order_id WHERE a.user_id=? ORDER BY a.id DESC LIMIT 10', u.id), levels: db.all('SELECT * FROM member_levels ORDER BY min_growth'), favs: db.get('SELECT COUNT(*) n FROM favorites WHERE user_id=?', u.id).n, invitees: db.get('SELECT COUNT(*) n FROM users WHERE referrer_id=?', u.id).n, cloudStatus: svc.cloud.cardStatus(u), cardTypes: db.all('SELECT * FROM cloud_card_types WHERE status=1 ORDER BY sort,id'), cloudSales: db.all('SELECT s.*, c.name card_name FROM cloud_card_sales s LEFT JOIN cloud_card_types c ON c.id=s.card_type_id WHERE s.user_id=? ORDER BY s.id DESC LIMIT 10', u.id), today: U.today(), coupons: svc.userCoupons(u.id, 'unused').length, db_coupons: db.all('SELECT id,name FROM coupons WHERE status=1') });
  });
  r.post('/members/:id/status', need('member'), (req, res) => { const u = db.get('SELECT * FROM users WHERE id=?', int(req.params.id)); if (u && u.cancelled_at) { flash(req, 'error', '该账号已注销,不可启用'); return back(req, res, '/admin/members'); } if (u) { db.exec1('UPDATE users SET status=1-status WHERE id=?', u.id); if (u.status) db.exec1("DELETE FROM sessions WHERE sid LIKE 's:%' AND (sess LIKE ? OR sess LIKE ?)", `%"uid":${u.id},%`, `%"uid":${u.id}}%`); log(req, u.status ? '禁用会员' : '启用会员', `#${u.id} ${u.phone}`); } back(req, res, '/admin/members'); });
  r.post('/members/:id/points', need('member'), (req, res) => {
    const uid = int(req.params.id), d = int(req.body.delta), reason = String(req.body.reason || '').trim().slice(0, 50);
    const u = db.get('SELECT id, points, phone FROM users WHERE id=?', uid), go = (t, m) => { flash(req, t, m); res.redirect('/admin/members/' + uid + '#points'); };
    if (!u) { flash(req, 'error', '会员不存在'); return res.redirect('/admin/members'); }
    if (!d) return go('error', '请输入非零的调整数值(正数增加,负数扣减)');
    if (Math.abs(d) > 100000) return go('error', '单次调整不能超过 100000 积分');
    if (reason.length < 2) return go('error', '请填写调整原因(必填,将记入积分明细与操作日志)');
    if (d < 0 && u.points + d < 0) return go('error', `扣减数量超过会员当前积分(${u.points})`);
    db.transaction(() => { svc.addPoints(uid, d, '管理员调整:' + reason); log(req, '调整积分', `#${uid} ${u.phone || ''} ${d > 0 ? '+' : ''}${d} 原因:${reason} 调整前 ${u.points}`); })();
    go('success', `积分已调整 ${d > 0 ? '+' : ''}${d}`);
  });
  r.post('/members/:id/level', need('member'), (req, res) => {
    const lv = db.get('SELECT * FROM member_levels WHERE id=?', int(req.body.level_id)); if (lv) { db.exec1('UPDATE users SET level_id=?, growth=MAX(growth,?) WHERE id=?', lv.id, lv.min_growth, int(req.params.id)); log(req, '设置会员等级', `#${req.params.id} → ${lv.name}`); flash(req, 'success', '等级已更新'); }
    res.redirect('/admin/members/' + int(req.params.id));
  });
  // 会员备注名(仅后台可见):只写 users.admin_remark,绝不修改会员昵称(昵称仅会员本人可改)
  const saveRemark = (req, uid) => {
    const u = db.get('SELECT id, phone, admin_remark FROM users WHERE id=?', uid); if (!u) return false;
    const v = String(req.body.admin_remark || '').trim().slice(0, 50), old = u.admin_remark || '';
    if (v === old) return true;
    db.exec1('UPDATE users SET admin_remark=? WHERE id=?', v, uid); log(req, '修改会员备注', `#${uid} ${u.phone}:「${old}」→「${v}」`); return true;
  };
  r.post('/members/:id/edit', need('member'), (req, res) => { const uid = int(req.params.id); saveRemark(req, uid); flash(req, 'success', '备注已保存(仅后台可见,不影响会员昵称)'); res.redirect('/admin/members/' + uid); });
  r.post('/service/:uid/remark', need('service'), (req, res) => { const uid = int(req.params.uid); saveRemark(req, uid); flash(req, 'success', '备注已保存(仅后台可见)'); res.redirect('/admin/service?uid=' + uid); });
  r.post('/members/:id/reset-password', need('member'), (req, res) => { const pw = String(req.body.password || ''); if (pw.length < 6) flash(req, 'error', '新密码至少 6 位'); else { db.exec1('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(pw, 10), int(req.params.id)); log(req, '重置会员密码', '#' + req.params.id); flash(req, 'success', '密码已重置'); } res.redirect('/admin/members/' + int(req.params.id)); });
  r.post('/members/:id/coupon', need('member'), (req, res) => { const x = svc.grantCoupon(int(req.params.id), int(req.body.coupon_id), true); log(req, '发放优惠券', `#${req.params.id} coupon ${req.body.coupon_id}`); flash(req, x.ok ? 'success' : 'error', x.ok ? '优惠券已发放' : x.msg); res.redirect('/admin/members/' + int(req.params.id)); });
  // 积分明细(全站 / 单个会员),积分不可购买、提现、转赠,此处只读;人工调整在会员详情页进行且必须填写原因
  const pointsWhere = query => {
    const where = ['1=1'], params = [], q = String(query.q || '').trim(), dir = String(query.dir || ''), uid = int(query.uid), from = String(query.from || ''), to = String(query.to || '');
    if (uid) { where.push('l.user_id=?'); params.push(uid); }
    if (q) { const k = '%' + q + '%'; where.push('(u.phone LIKE ? OR u.nickname LIKE ? OR l.reason LIKE ?)'); params.push(k, k, k); }
    if (dir === 'in') where.push('l.delta>0'); else if (dir === 'out') where.push('l.delta<0'); else if (dir === 'admin') where.push("l.reason LIKE '管理员调整%'");
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('l.created_at>=?'); params.push(from + ' 00:00:00'); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('l.created_at<=?'); params.push(to + ' 23:59:59'); }
    return { sql: `SELECT l.*, u.nickname, u.phone FROM points_log l LEFT JOIN users u ON u.id=l.user_id WHERE ${where.join(' AND ')} ORDER BY l.id DESC`, params, q, dir, uid, from, to };
  };
  r.get('/points-log', need('member'), (req, res) => {
    const w = pointsWhere(req.query), pg = U.paginate(w.sql, w.params, req.query.page, 25);
    const sum = db.get(`SELECT COALESCE(SUM(CASE WHEN delta>0 THEN delta END),0) inc, COALESCE(SUM(CASE WHEN delta<0 THEN delta END),0) outv FROM (${w.sql})`, ...w.params);
    const member = w.uid ? db.get('SELECT id, nickname, phone, points FROM users WHERE id=?', w.uid) : null;
    res.page('admin/points-log', { title: member ? `积分明细 · ${member.nickname || member.phone}` : '积分明细', pg, sum, member, ...w });
  });
  r.get('/points-log/export', need('stats'), (req, res) => {
    const w = pointsWhere(req.query), rows = db.all(w.sql + ' LIMIT 20000', ...w.params);
    log(req, '导出积分明细CSV', rows.length + '条');
    sendCSV(res, '积分明细', ['时间', '会员ID', '昵称', '手机号', '变动', '变动后余额', '原因'], rows.map(l => [l.created_at, l.user_id, l.nickname, l.phone, l.delta, l.balance, l.reason]));
  });
  crud(r, { path: 'levels', table: 'member_levels', perm: 'member', title: '会员等级', singular: '会员等级', order: 'min_growth',
    cols: [{ label: 'ID', f: x => x.id }, { label: '等级名称', f: x => `<b style="color:${esc(x.color)}">💎 ${esc(x.name)}</b>` }, { label: '所需成长值', f: x => x.min_growth }, { label: '会员折扣', f: x => x.discount < 100 ? (x.discount / 10) + ' 折' : '无折扣' }, { label: '会员数', f: x => db.get('SELECT COUNT(*) n FROM users WHERE level_id=?', x.id).n }, { label: '权益说明', f: x => esc(x.remark) }],
    fields: [{ name: 'name', label: '等级名称', required: true }, { name: 'min_growth', label: '所需成长值', type: 'number', int: true, min: 0 }, { name: 'discount', label: '折扣百分比(100=不打折,95=九五折)', type: 'number', int: true, min: 50, def: 100 }, { name: 'color', label: '徽章颜色', def: '#999999', pattern: /^#[0-9a-fA-F]{6}$/ }, { name: 'remark', label: '权益说明' }],
    validate: row => row.discount > 100 ? '折扣不能大于 100' : null, after: () => db.all('SELECT id FROM users').forEach(u => svc.refreshLevel(u.id)), 
    canDelete: x => x.id === 1 ? '基础等级不能删除' : (db.get('SELECT 1 FROM users WHERE level_id=?', x.id) ? '该等级下还有会员,不能删除' : null) }, ctx);
  // ================= 邀请(单级,一次性积分) =================
  r.get('/invites', need('member'), (req, res) => {
    const st = String(req.query.status || ''), q = String(req.query.q || '').trim(), where = ['1=1'], params = [];
    if (st) { where.push('r.status=?'); params.push(st); }
    if (q) { const k = '%' + q + '%'; where.push('(a.phone LIKE ? OR a.nickname LIKE ? OR b.phone LIKE ? OR b.nickname LIKE ? OR o.order_no LIKE ?)'); params.push(k, k, k, k, k); }
    const pg = U.paginate(`SELECT r.*, a.nickname an, a.phone ap, b.nickname bn, b.phone bp, o.order_no FROM invite_rewards r LEFT JOIN users a ON a.id=r.referrer_id LEFT JOIN users b ON b.id=r.invitee_id LEFT JOIN orders o ON o.id=r.order_id WHERE ${where.join(' AND ')} ORDER BY r.id DESC`, params, req.query.page, 20);
    const sum = db.get("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='granted' THEN points END),0) granted, COALESCE(SUM(CASE WHEN status='pending' THEN 1 END),0) pending FROM invite_rewards");
    const invited = db.get('SELECT COUNT(*) n FROM users WHERE referrer_id IS NOT NULL').n;
    res.page('admin/invites', { title: '邀请管理', pg, st, q, sum, invited, s: svc.settings(), coupons: db.all('SELECT id, name FROM coupons WHERE status=1 ORDER BY id') });
  });
  r.post('/invites/settings', need('member'), (req, res) => {
    const b = req.body;
    const pts = int(b.invite_points, -1), days = int(b.invite_window_days, -1), cid = int(b.invite_coupon_id, 0);
    if (pts < 0 || pts > 100000) { flash(req, 'error', '邀请积分需为 0~100000 的整数'); return res.redirect('/admin/invites'); }
    if (days < 7 || days > 90) { flash(req, 'error', '观察期需为 7~90 天(不得短于七天无理由退货期)'); return res.redirect('/admin/invites'); }
    if (cid && !db.get('SELECT 1 FROM coupons WHERE id=?', cid)) { flash(req, 'error', '优惠券不存在'); return res.redirect('/admin/invites'); }
    svc.setSetting('invite_points', pts); svc.setSetting('invite_window_days', days); svc.setSetting('invite_coupon_id', cid || '');
    log(req, '修改邀请规则', `积分 ${pts} / 观察期 ${days} 天 / 首单券 ${cid || '无'}`);
    flash(req, 'success', '邀请规则已保存'); res.redirect('/admin/invites');
  });
  for (const pth of ['/referral', '/cloud-fans', '/cloud-redeems']) r.get(pth, need('member'), (req, res) => res.redirect(pth === '/cloud-redeems' ? '/admin/cloud-members' : '/admin/invites'));

  // ================= 云商卡(线下销售,后台开通) =================
  crud(r, { path: 'cloud-cards', table: 'cloud_card_types', perm: 'member', title: '云商卡类型', singular: '云商卡类型', order: 'sort,id', toggle: 'status',
    cols: [
      { label: 'ID', f: x => x.id },
      { label: '名称', f: x => '<b>' + esc(x.name) + '</b>' },
      { label: '档位', f: x => (svc.cloud.TIER_LABEL[x.tier] || esc(x.tier)) },
      { label: '时长', f: x => (svc.cloud.DURATION_LABEL[x.duration] || esc(x.duration)) },
      { label: '线下参考售价', f: x => '¥' + Number(x.activation_fee).toFixed(2) },
      { label: '持卡会员', f: x => db.get('SELECT COUNT(*) n FROM users WHERE cloud_card_type_id=? AND cloud_end>=?', x.id, now()).n },
      { label: '排序', f: x => x.sort },
      { label: '状态', f: x => x.status ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>' }
    ],
    fields: [
      { name: 'name', label: '展示名称', required: true, help: '如:白银月卡' },
      { name: 'tier', label: '档位', type: 'select', options: [{ v: 'silver', t: '白银' }, { v: 'gold', t: '黄金' }], required: true },
      { name: 'duration', label: '时长', type: 'select', options: [{ v: 'month', t: '月卡(30天)' }, { v: 'quarter', t: '季卡(90天)' }, { v: 'year', t: '年卡(365天)' }], required: true },
      { name: 'activation_fee', label: '线下参考售价(元,仅展示)', type: 'number', min: 0, help: '云商卡不在线售卖,实际收款以开通时登记的实收金额为准' },
      { name: 'sort', label: '排序', type: 'number', int: true },
      { name: 'remark', label: '备注' },
      { name: 'status', label: '启用', type: 'checkbox', def: 1 }
    ],
    validate: row => (!['silver', 'gold'].includes(row.tier) ? '档位无效' : !['month', 'quarter', 'year'].includes(row.duration) ? '时长无效' : null),
    canDelete: x => db.get('SELECT 1 FROM users WHERE cloud_card_type_id=?', x.id) || db.get('SELECT 1 FROM cloud_card_sales WHERE card_type_id=?', x.id) ? '该卡类型已有会员开通或销售记录,不能删除,请改为停用' : null
  }, ctx);

  const CLOUD_KEYS = ['cloud_discount', 'cloud_free_shipping', 'cloud_signin_extra', 'cloud_signin_extra_step', 'cloud_signin_extra_max', 'cloud_extra_expire_days'];
  r.get('/cloud-settings', need('member'), (req, res) => { svc.cloud.ensureDefaults(); res.page('admin/cloud-settings', { title: '云商卡配置', s: svc.settings() }); });
  r.post('/cloud-settings', need('member'), (req, res) => {
    const b = req.body;
    const d = int(b.cloud_discount, 0), ex = int(b.cloud_signin_extra, -1), step = int(b.cloud_signin_extra_step, -1), mx = int(b.cloud_signin_extra_max, -1), exp = int(b.cloud_extra_expire_days, 0);
    if (d < 50 || d > 100) { flash(req, 'error', '会员价折扣需在 50~100 之间(100=不打折)'); return res.redirect('/admin/cloud-settings'); }
    if (ex < 0 || ex > 1000) { flash(req, 'error', '连续签到第 1 天加赠积分需为 0~1000'); return res.redirect('/admin/cloud-settings'); }
    if (step < 0 || step > 100) { flash(req, 'error', '每连续 1 天递增积分需为 0~100'); return res.redirect('/admin/cloud-settings'); }
    if (mx < ex || mx > 1000) { flash(req, 'error', '每天加赠封顶需不小于第 1 天加赠积分,且不超过 1000'); return res.redirect('/admin/cloud-settings'); }
    if (exp < 1 || exp > 365) { flash(req, 'error', '加赠积分有效期需为 1~365 天'); return res.redirect('/admin/cloud-settings'); }
    svc.setSetting('cloud_discount', d); svc.setSetting('cloud_free_shipping', b.cloud_free_shipping ? '1' : '0');
    svc.setSetting('cloud_signin_extra', ex); svc.setSetting('cloud_signin_extra_step', step); svc.setSetting('cloud_signin_extra_max', mx); svc.setSetting('cloud_extra_expire_days', exp);
    log(req, '修改云商卡配置', CLOUD_KEYS.map(k => k + '=' + svc.S(k)).join(' '));
    flash(req, 'success', '云商卡配置已保存'); res.redirect('/admin/cloud-settings');
  });

  r.get('/cloud-members', need('member'), (req, res) => {
    const { q = '', tier = '', active = '' } = req.query;
    const where = ["u.cloud_tier IS NOT NULL AND u.cloud_tier!=''"], params = [];
    if (q.trim()) { where.push('(u.phone LIKE ? OR u.nickname LIKE ?)'); params.push('%' + q.trim() + '%', '%' + q.trim() + '%'); }
    if (tier) { where.push('u.cloud_tier=?'); params.push(tier); }
    if (active === '1') { where.push('u.cloud_end>=?'); params.push(now()); }
    if (active === '0') { where.push('(u.cloud_end IS NULL OR u.cloud_end<?)'); params.push(now()); }
    const pg = U.paginate(`SELECT u.*, c.name card_name FROM users u LEFT JOIN cloud_card_types c ON c.id=u.cloud_card_type_id WHERE ${where.join(' AND ')} ORDER BY u.cloud_end DESC, u.id DESC`, params, req.query.page, 20);
    pg.rows.forEach(u => { u.active = svc.cloud.isCardActive(u); u.tierLabel = svc.cloud.TIER_LABEL[u.cloud_tier] || u.cloud_tier; });
    const sales = db.all('SELECT s.*, u.nickname, u.phone, c.name card_name, COALESCE(a.name,a.username) admin_name FROM cloud_card_sales s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN cloud_card_types c ON c.id=s.card_type_id LEFT JOIN admins a ON a.id=s.admin_id ORDER BY s.id DESC LIMIT 30');
    res.page('admin/cloud-members', { title: '云商卡会员', pg, q, tier, active, sales });
  });
  r.post('/members/:id/cloud', need('member'), (req, res) => {
    const uid = int(req.params.id);
    const x = db.transaction(() => req.body.action === 'stop' ? svc.cloud.stop(uid, req.body.note, req.session.admin.id) : svc.cloud.grant(uid, req.body, req.session.admin.id))();
    if (x.ok) log(req, req.body.action === 'stop' ? '停用云商卡' : '开通/续期云商卡', `#${uid} ${x.msg}`);
    flash(req, x.ok ? 'success' : 'error', x.msg); res.redirect('/admin/members/' + uid + '#cloud');
  });

  // ================= 营销 =================
  const skuOptions = () => db.all('SELECT s.id v, p.name || \' · \' || s.spec_text || \' (¥\' || s.price || \')\' t FROM skus s JOIN products p ON p.id=s.product_id WHERE p.status>=0 ORDER BY p.id, s.id');
  const stBadge = x => x.status ? '<span class="tag green">启用</span>' : '<span class="tag gray">停用</span>';
  crud(r, { path: 'coupons', table: 'coupons', perm: 'marketing', title: '优惠券管理', singular: '优惠券', toggle: 'status', search: ['name'],
    cols: [{ label: 'ID', f: x => x.id }, { label: '名称', f: x => '<b>' + esc(x.name) + '</b>' }, { label: '面额', f: x => '<span class="price">' + x.amount + '</span>' }, { label: '门槛', f: x => x.threshold ? '满' + x.threshold : '无门槛' }, { label: '范围', f: x => x.category_id ? esc((db.get('SELECT name FROM categories WHERE id=?', x.category_id) || {}).name || '分类') : '全场' }, { label: '领取/总量', f: x => `${x.claimed}/${x.total}` }, { label: '有效期', f: x => x.valid_days + '天' }, { label: '状态', f: stBadge }],
    fields: [{ name: 'name', label: '优惠券名称', required: true, help: '名称以「新人」开头的启用券会自动发给新注册会员' }, { name: 'amount', label: '优惠金额(元)', type: 'number', min: 0.01, required: true }, { name: 'threshold', label: '使用门槛(元,0=无门槛)', type: 'number', min: 0 }, { name: 'total', label: '发行总量', type: 'number', int: true, min: 1, def: 100 }, { name: 'per_limit', label: '每人限领', type: 'number', int: true, min: 1, def: 1 }, { name: 'valid_days', label: '领取后有效天数', type: 'number', int: true, min: 1, def: 30 }, { name: 'category_id', label: '适用分类', type: 'select', numeric: true, options: () => [{ v: 0, t: '全场通用' }, ...catOptions()] }, { name: 'description', label: '说明' }, { name: 'status', label: '启用', type: 'checkbox', def: 1 }],
    validate: row => row.amount > row.threshold && row.threshold > 0 ? '优惠金额不能大于使用门槛' : null, extraInsert: () => ({ created_at: now(), claimed: 0 }),
    canDelete: x => db.get('SELECT 1 FROM user_coupons WHERE coupon_id=?', x.id) ? '已有会员领取,不能删除,请停用' : null }, ctx);
  crud(r, { path: 'banners', table: 'banners', perm: 'marketing', title: 'Banner 管理', singular: 'Banner', order: 'sort,id', toggle: 'status',
    cols: [{ label: 'ID', f: x => x.id }, { label: '预览', f: x => x.image ? `<img src="${esc(x.image)}" style="height:40px;border-radius:6px">` : `<span style="display:inline-block;width:120px;height:40px;border-radius:6px;background:linear-gradient(120deg,${esc(x.bg1)},${esc(x.bg2)})"></span>` }, { label: '标题', f: x => '<b>' + esc(x.title) + '</b><br><span class="muted">' + esc(x.subtitle) + '</span>' }, { label: '链接', f: x => esc(x.link) }, { label: '排序', f: x => x.sort }, { label: '状态', f: stBadge }],
    fields: [{ name: 'title', label: '标题', required: true }, { name: 'subtitle', label: '副标题' }, { name: 'image', label: '图片(可选,建议 750×280,主体放右侧;不传则使用渐变背景)', type: 'image' }, { name: 'link', label: '跳转链接(可留空)', def: '/products', help: '仅支持站内相对路径,以 / 开头,如 /products、/activity;不支持外部链接' }, { name: 'bg1', label: '渐变色 1', def: '#d4202a', pattern: /^#[0-9a-fA-F]{6}$/ }, { name: 'bg2', label: '渐变色 2', def: '#f2a93b', pattern: /^#[0-9a-fA-F]{6}$/ }, { name: 'sort', label: '排序', type: 'number', int: true }, { name: 'status', label: '启用', type: 'checkbox', def: 1 }],
    validate: row => row.link && !U.isInternalLink(row.link) ? '跳转链接仅支持站内相对路径(以 / 开头,如 /products),不支持外部链接' : null }, ctx);
  crud(r, { path: 'seckills', table: 'seckills', perm: 'marketing', title: '限时秒杀', singular: '秒杀活动', toggle: 'status', order: 'start_at DESC',
    decorate: x => { const p = db.get('SELECT p.name, s.spec_text, s.price orig FROM skus s JOIN products p ON p.id=s.product_id WHERE s.id=?', x.sku_id) || {}; x.pn = p.name + ' · ' + p.spec_text; x.orig = p.orig; },
    cols: [{ label: 'ID', f: x => x.id }, { label: '商品/规格', f: x => esc(x.pn) }, { label: '原价 → 秒杀价', f: x => `¥${x.orig} → <b class="price">${x.price}</b>` }, { label: '库存(已售/总)', f: x => `${x.sold}/${x.stock}` }, { label: '时间', f: x => `${x.start_at.slice(5, 16)} ~ ${x.end_at.slice(5, 16)}` }, { label: '限购', f: x => x.limit_per_user }, { label: '状态', f: x => { const t = now(); return !x.status ? '<span class="tag gray">停用</span>' : (x.end_at < t ? '<span class="tag gray">已结束</span>' : x.start_at <= t ? '<span class="tag">进行中</span>' : '<span class="tag gold">未开始</span>'); } }],
    fields: [{ name: 'sku_id', label: '商品规格', type: 'select', numeric: true, options: skuOptions, required: true }, { name: 'price', label: '秒杀价(元)', type: 'number', min: 0.01 }, { name: 'stock', label: '秒杀库存', type: 'number', int: true, min: 1 }, { name: 'start_at', label: '开始时间', type: 'datetime', required: true }, { name: 'end_at', label: '结束时间', type: 'datetime', required: true }, { name: 'limit_per_user', label: '每人限购', type: 'number', int: true, min: 1, def: 1 }, { name: 'status', label: '启用', type: 'checkbox', def: 1 }],
    validate: row => { const s = db.get('SELECT * FROM skus WHERE id=?', row.sku_id); if (!s) return '请选择商品规格'; if (row.price >= s.price) return '秒杀价必须低于原价 ¥' + s.price; if (row.end_at <= row.start_at) return '结束时间必须晚于开始时间'; return null; },
    before: row => { row.product_id = db.get('SELECT product_id FROM skus WHERE id=?', row.sku_id).product_id; }, canDelete: x => db.get("SELECT 1 FROM orders WHERE type='seckill' AND promo_id=?", x.id) ? '已有订单,请停用而非删除' : null }, ctx);
  crud(r, { path: 'groupbuys', table: 'groupbuys', perm: 'marketing', title: '拼团活动', singular: '拼团活动', toggle: 'status',
    decorate: x => { const p = db.get('SELECT p.name, s.spec_text, s.price orig FROM skus s JOIN products p ON p.id=s.product_id WHERE s.id=?', x.sku_id) || {}; x.pn = p.name + ' · ' + p.spec_text; x.orig = p.orig; x.opens = db.get("SELECT COUNT(*) n FROM groups WHERE groupbuy_id=? AND status='open'", x.id).n; x.succ = db.get("SELECT COUNT(*) n FROM groups WHERE groupbuy_id=? AND status='success'", x.id).n; },
    cols: [{ label: 'ID', f: x => x.id }, { label: '商品/规格', f: x => esc(x.pn) }, { label: '原价 → 拼团价', f: x => `¥${x.orig} → <b class="price">${x.price}</b>` }, { label: '成团人数', f: x => x.size + '人' }, { label: '有效时长', f: x => x.hours + '小时' }, { label: '进行中/已成团', f: x => `${x.opens}/${x.succ}` }, { label: '状态', f: stBadge }],
    fields: [{ name: 'sku_id', label: '商品规格(拼团仅支持该规格)', type: 'select', numeric: true, options: skuOptions, required: true }, { name: 'price', label: '拼团价(元)', type: 'number', min: 0.01 }, { name: 'size', label: '成团人数', type: 'number', int: true, min: 2, def: 2 }, { name: 'hours', label: '成团有效时长(小时)', type: 'number', int: true, min: 1, def: 24 }, { name: 'status', label: '启用', type: 'checkbox', def: 1 }],
    validate: row => { const s = db.get('SELECT * FROM skus WHERE id=?', row.sku_id); if (!s) return '请选择商品规格'; if (row.price >= s.price) return '拼团价必须低于原价 ¥' + s.price; return null; },
    before: row => { row.product_id = db.get('SELECT product_id FROM skus WHERE id=?', row.sku_id).product_id; }, canDelete: x => db.get("SELECT 1 FROM orders WHERE type='group' AND promo_id=?", x.id) ? '已有订单,请停用而非删除' : null }, ctx);
  r.get('/groups', need('marketing'), (req, res) => {
    const rows = db.all("SELECT g.*, u.nickname, p.name pname FROM groups g JOIN users u ON u.id=g.leader_id JOIN groupbuys gb ON gb.id=g.groupbuy_id JOIN products p ON p.id=gb.product_id ORDER BY g.id DESC LIMIT 100");
    res.page('admin/groups', { title: '团列表', rows });
  });
  // 积分商城商品:积分数仅在后台按件设置;一律包邮;库存为 0 前台显示「已兑完」并禁止兑换;分类不在经营范围时仅提示不拦截
  const pgCatOptions = () => [{ v: 0, t: '优惠券 / 不选分类' }, ...db.all('SELECT c.id v, CASE WHEN pc.name IS NULL THEN c.name ELSE pc.name || \' / \' || c.name END t FROM categories c LEFT JOIN categories pc ON pc.id=c.parent_id ORDER BY COALESCE(pc.sort,c.sort), c.parent_id>0, c.sort')];
  const pgScope = row => { if (!row.category_id || row.type === 'coupon') return null; const c = db.get('SELECT c.name, pc.name pn FROM categories c LEFT JOIN categories pc ON pc.id=c.parent_id WHERE c.id=?', row.category_id); if (!c) return null; const w = require('../lib/suppliers/jdvop/compliance').scopeWarning([c.pn, c.name].filter(Boolean)); return w ? w.msg : null; };
  crud(r, { path: 'points-goods', table: 'points_goods', perm: 'marketing', title: '积分商城商品', singular: '积分商品', toggle: 'status', order: 'sort,id',
    cols: [{ label: 'ID', f: x => x.id }, { label: '商品', f: x => `<img src="${esc(x.image)}" style="height:36px;width:36px;border-radius:6px;vertical-align:middle;object-fit:cover"> <b>${esc(x.name)}</b>${x.is_demo ? ' <span class="tag">演示</span>' : ''}` }, { label: '类型', f: x => x.type === 'coupon' ? '优惠券' : '实物(包邮)' }, { label: '所需积分', f: x => x.points }, { label: '每人限兑', f: x => x.per_user_limit > 0 ? x.per_user_limit + ' 件' : '不限' }, { label: '库存/已兑', f: x => `${x.stock}/${x.exchanged}` + (x.stock <= 0 ? ' <span class="tag red">已兑完</span>' : '') }, { label: '状态', f: stBadge }],
    fields: [{ name: 'name', label: '名称', required: true }, { name: 'image', label: '图片', type: 'image', help: '建议上传正方形图片,不小于 800×800 像素(JPG/PNG/WebP,≤3MB)' }, { name: 'points', label: '所需积分', type: 'number', int: true, min: 1 }, { name: 'type', label: '类型', type: 'select', options: [{ v: 'goods', t: '实物礼品(包邮)' }, { v: 'coupon', t: '优惠券' }] }, { name: 'coupon_id', label: '关联优惠券(类型为优惠券时)', type: 'select', numeric: true, options: () => [{ v: 0, t: '无' }, ...db.all('SELECT id v, name t FROM coupons')] }, { name: 'category_id', label: '商品分类(用于经营范围提示)', type: 'select', numeric: true, options: pgCatOptions, help: '不在当前经营范围的分类仅提示,不阻止保存' }, { name: 'stock', label: '库存', type: 'number', int: true, min: 0, help: '库存为 0 时前台显示「已兑完」并停止兑换' }, { name: 'per_user_limit', label: '每人限兑(件,0=不限)', type: 'number', int: true, min: 0 }, { name: 'description', label: '说明' }, { name: 'sort', label: '排序', type: 'number', int: true }, { name: 'status', label: '上架', type: 'checkbox', def: 1 }],
    validate: row => row.type === 'coupon' && !row.coupon_id ? '优惠券类型需选择关联优惠券' : null, before: row => { if (!row.image) row.image = U.genImg('🎁', 'f59e0b', 'fde68a', 0, row.name.slice(0, 6)); },
    warn: pgScope }, ctx);
  crud(r, { path: 'keywords', table: 'keywords', perm: 'marketing', title: '热搜词', singular: '热搜词', order: 'is_hot DESC, hits DESC', search: ['word'], toggle: 'is_hot',
    cols: [{ label: 'ID', f: x => x.id }, { label: '关键词', f: x => '<b>' + esc(x.word) + '</b>' }, { label: '搜索次数', f: x => x.hits }, { label: '首页热搜', f: x => x.is_hot ? '<span class="tag">展示中</span>' : '<span class="tag gray">未展示</span>' }, { label: '排序', f: x => x.sort }],
    fields: [{ name: 'word', label: '关键词', required: true }, { name: 'hits', label: '搜索次数', type: 'number', int: true }, { name: 'sort', label: '排序', type: 'number', int: true }, { name: 'is_hot', label: '展示为热搜', type: 'checkbox', def: 1 }],
    validate: (row, ex) => { const d = db.get('SELECT id FROM keywords WHERE word=?', row.word); return d && (!ex || d.id !== ex.id) ? '该关键词已存在' : null; } }, ctx);

  // ================= 内容 CMS =================
  const artFields = [{ name: 'title', label: '标题', required: true }, { name: 'topic', label: '分组/标签', def: '常见问题', help: '帮助中心按此分组' }, { name: 'content', label: '内容(支持 HTML)', type: 'textarea', required: true }, { name: 'sort', label: '排序', type: 'number', int: true }, { name: 'status', label: '发布', type: 'checkbox', def: 1 }];
  const artCols = [{ label: 'ID', f: x => x.id }, { label: '标题', f: x => '<b>' + esc(x.title) + '</b>' }, { label: '分组', f: x => esc(x.topic) }, { label: '阅读', f: x => x.views }, { label: '发布时间', f: x => x.created_at.slice(0, 10) }, { label: '状态', f: x => x.status ? '<span class="tag green">已发布</span>' : '<span class="tag gray">草稿</span>' }];
  for (const [path, cat, title, topicDef] of [['notices', 'notice', '公告管理', '公告'], ['help-articles', 'help', '帮助文章', '新手指南'], ['pages', 'about', '关于/单页', '关于']]) {
    crud(r, { path, table: 'articles', perm: 'content', title, singular: title.replace('管理', ''), toggle: 'status', search: ['title'], order: 'sort, id DESC', filter: () => ({ sql: 'category=?', params: [cat] }), cols: artCols, fields: artFields.map(f => f.name === 'topic' ? { ...f, def: topicDef } : f), extraInsert: () => ({ category: cat, created_at: now() }) }, ctx);
  }
  // 隐私政策 / 用户协议(文章形式存储,带版本号;提升版本号后老用户下次访问需重新同意)
  r.get('/policies', need('content'), (req, res) => {
    const get = t => db.get("SELECT * FROM articles WHERE category='policy' AND topic=? ORDER BY id LIMIT 1", t) || { topic: t, title: t === 'privacy' ? '隐私政策' : '用户协议', content: '' };
    const consented = db.get("SELECT COUNT(*) n FROM users WHERE consent_version=? AND cancelled_at IS NULL", svc.S('policy_version') || '1.1').n;
    const total = db.get('SELECT COUNT(*) n FROM users WHERE cancelled_at IS NULL').n;
    const tab = req.query.tab === 'terms' ? 'terms' : 'privacy';
    const history = db.all('SELECT id, version, title, admin_name, created_at, LENGTH(content) len FROM policy_versions WHERE topic=? ORDER BY id DESC LIMIT 30', tab);
    res.page('admin/policies', { title: '隐私政策 / 用户协议', privacy: get('privacy'), terms: get('terms'), version: svc.S('policy_version') || '1.1', consented, total, tab, history });
  });
  // 历史版本快照(只读查看)
  r.get('/policies/history/:id', need('content'), (req, res) => {
    const h = db.get('SELECT * FROM policy_versions WHERE id=?', int(req.params.id)); if (!h) return res.redirect('/admin/policies');
    res.page('admin/policy-history', { title: `${h.title} 历史版本 v${h.version}`, h });
  });
  r.post('/policies', need('content'), (req, res) => {
    const topic = req.body.topic === 'terms' ? 'terms' : 'privacy';
    const title = String(req.body.title || '').trim().slice(0, 30) || (topic === 'privacy' ? '隐私政策' : '用户协议');
    const content = String(req.body.content || '');
    if (!content.trim()) { flash(req, 'error', '内容不能为空'); return res.redirect('/admin/policies?tab=' + topic); }
    const oldV = svc.S('policy_version') || '1.1', newV = String(req.body.version || '').trim().replace(/^v/i, '').slice(0, 20);
    if (newV && !/^\d{1,3}(\.\d{1,3}){0,3}$/.test(newV)) { flash(req, 'error', '版本号格式应为数字,如 1.2'); return res.redirect('/admin/policies?tab=' + topic); }
    const ex = db.get("SELECT id FROM articles WHERE category='policy' AND topic=?", topic);
    if (ex) db.exec1('UPDATE articles SET title=?, content=?, status=1 WHERE id=?', title, content, ex.id);
    else db.exec1("INSERT INTO articles(category,topic,title,content,status,sort,created_at) VALUES('policy',?,?,?,1,0,?)", topic, title, content, now());
    db.exec1('INSERT INTO policy_versions(topic,version,title,content,admin_name,created_at) VALUES(?,?,?,?,?,?)', topic, newV || oldV, title, content, req.session.admin.name || req.session.admin.username, now());
    if (newV && newV !== oldV) { svc.setSetting('policy_version', newV); log(req, '更新协议版本', `${oldV} → ${newV}`); }
    log(req, '编辑' + title, topic); flash(req, 'success', title + '已保存' + (newV && newV !== oldV ? `,版本号更新为 v${newV}(用户下次访问时需重新同意)` : '')); res.redirect('/admin/policies?tab=' + topic);
  });
  // 客服
  // 实时推送(SSE):需客服权限,接收全部会话事件
  r.get('/service/stream', need('service'), (req, res) => require('../lib/push-sse').sse(req, res, require('../lib/bus').scopes.staff()));
  r.get('/service', need('service'), (req, res) => {
    const uid = int(req.query.uid);
    const convs = db.all("SELECT m.user_id, u.nickname, u.phone, u.admin_remark, MAX(m.id) last_id, COUNT(*) n, SUM(CASE WHEN m.sender='user' THEN 1 ELSE 0 END) un FROM messages m JOIN users u ON u.id=m.user_id GROUP BY m.user_id ORDER BY last_id DESC").map(c => { const l = db.get("SELECT * FROM messages WHERE user_id=? AND sender='user' ORDER BY id DESC LIMIT 1", c.user_id) || db.get('SELECT * FROM messages WHERE id=?', c.last_id); c.last = l.content; c.lastSender = l.sender; c.time = l.created_at; c.unread = db.get("SELECT COUNT(*) n FROM messages WHERE user_id=? AND sender='user' AND id > COALESCE((SELECT MAX(id) FROM messages WHERE user_id=? AND sender='staff'),0)", c.user_id, c.user_id).n; return c; });
    const cur = uid ? db.get('SELECT id,nickname,phone,admin_remark FROM users WHERE id=?', uid) : (convs[0] ? { id: convs[0].user_id, nickname: convs[0].nickname, admin_remark: convs[0].admin_remark, phone: convs[0].phone } : null);
    const days = int(svc.S('aftersale_days'), 7);
    const orders = cur ? db.all("SELECT * FROM orders WHERE user_id=? AND status IN ('paid','shipped','completed','refunded') ORDER BY id DESC LIMIT 8", cur.id).map(o => {
      const items = db.all('SELECT * FROM order_items WHERE order_id=?', o.id);
      const active = db.get("SELECT id, status FROM aftersales WHERE order_id=? AND status NOT IN ('rejected','cancelled','refunded','exchanged') ORDER BY id DESC", o.id);
      const refunded = db.get("SELECT COALESCE(SUM(refund_cash),0) c FROM aftersales WHERE order_id=? AND status='refunded'", o.id).c;
      const noReason = items.every(i => !i.product_id || svc.noReasonOf(i.product_id));
      const daysSince = o.completed_at ? Math.floor((Date.now() - U.parseDate(o.completed_at)) / 86400000) : null;
      const can7 = noReason && o.status === 'completed' && daysSince !== null && daysSince <= 7 && o.type !== 'points';
      const canCreate = ['paid', 'shipped', 'completed'].includes(o.status) && o.type !== 'points' && !active;
      return { ...o, items, active, refunded, maxAmount: round2(Math.max(0, o.pay_amount - refunded)), noReason, daysSince, can7, canCreate };
    }) : [];
    res.page('admin/service', { title: '客服中心', convs, cur, orders, days, msgs: cur ? db.all('SELECT * FROM messages WHERE user_id=? ORDER BY id', cur.id).map(require('../lib/chat').parse).map(m => m.kind === 'order' && m.data ? { ...m, order: db.get('SELECT id, order_no, status, pay_amount FROM orders WHERE id=? AND user_id=?', int(m.data.id), cur.id) } : m).map(m => ({ ...m, canMod: require('../lib/chat').canModify(m), audit: db.all('SELECT * FROM message_audit WHERE message_id=? ORDER BY id', m.id) })) : [], recallMin: require('../lib/chat').recallMinutes() });
  });
  // 客服/订单详情页为用户创建售后单(售后统一由工作人员发起)
  const createAftersale = (req, o, b) => {
    if (!o || !['paid', 'shipped', 'completed'].includes(o.status) || o.type === 'points') return { msg: '该订单当前不可创建售后' };
    if (db.get("SELECT 1 FROM aftersales WHERE order_id=? AND status IN ('pending','approved_return','returned')", o.id)) return { msg: '该订单已有进行中的售后单' };
    const type = b.type;
    if (!U.AFTERSALE_TYPE[type]) return { msg: '请选择售后类型' };
    const items = db.all('SELECT product_id FROM order_items WHERE order_id=?', o.id);
    if (type === 'no_reason') {
      const daysSince = o.completed_at ? (Date.now() - U.parseDate(o.completed_at)) / 86400000 : null;
      if (!items.every(i => !i.product_id || svc.noReasonOf(i.product_id))) return { msg: '该订单含不支持7天无理由退货的商品(如鲜活易腐类),请选择「质量问题退换货」或其他类型' };
      if (o.status !== 'completed' || daysSince === null || daysSince > 7) return { msg: '7天无理由退货仅限签收后 7 天内' };
    }
    if (type !== 'refund' && o.status === 'paid') return { msg: '订单尚未发货,请选择「仅退款」' };
    const refunded = db.get("SELECT COALESCE(SUM(refund_cash),0) c FROM aftersales WHERE order_id=? AND status='refunded'", o.id).c;
    const max = round2(Math.max(0, o.pay_amount - refunded));
    const amount = round2(num(b.amount, max));
    if (!(amount >= 0) || amount > max) return { msg: `退款金额需在 0 ~ ${max.toFixed(2)} 之间` };
    const reason = String(b.reason || '').trim().slice(0, 50); if (!reason) return { msg: '请填写售后原因' };
    const note = String(b.note || '').trim().slice(0, 500);
    const id = db.transaction(() => {
      const r2 = db.exec1('INSERT INTO aftersales(order_id,user_id,type,reason,description,amount,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', o.id, o.user_id, type, reason, note, amount, 'pending', (req.session.admin.name || req.session.admin.username), now(), now());
      db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', o.id, now(), `客服已创建售后单(${U.AFTERSALE_TYPE[type]})`);
      svc.notifyService(o.user_id, 'staff', `【售后通知】已为您的订单 ${o.order_no} 创建售后单 #${r2.lastInsertRowid}(${U.AFTERSALE_TYPE[type]},退款金额 ¥${amount.toFixed(2)}),我们会尽快处理,进度可在「我的 - 退款/售后」查看。`);
      log(req, '创建售后单', `#${r2.lastInsertRowid} 订单 ${o.order_no} ${U.AFTERSALE_TYPE[type]} ¥${amount}`);
      return r2.lastInsertRowid;
    })();
    return { ok: true, id };
  };
  // 订单可创建售后的信息(订单详情页 / 客服中心共用)
  const asInfo = o => {
    const items = db.all('SELECT product_id FROM order_items WHERE order_id=?', o.id);
    const active = db.get("SELECT id, status FROM aftersales WHERE order_id=? AND status IN ('pending','approved_return','returned') ORDER BY id DESC", o.id);
    const refunded = round2(db.get("SELECT COALESCE(SUM(refund_cash),0) c FROM aftersales WHERE order_id=? AND status='refunded'", o.id).c + ((db.get('SELECT refunded_customer FROM supplier_orders WHERE order_id=?', o.id) || {}).refunded_customer || 0));
    const noReason = items.every(i => !i.product_id || svc.noReasonOf(i.product_id));
    const daysSince = o.completed_at ? Math.floor((Date.now() - U.parseDate(o.completed_at)) / 86400000) : null;
    return { active, refunded, maxAmount: round2(Math.max(0, o.pay_amount - refunded)), noReason, daysSince, can7: noReason && o.status === 'completed' && daysSince !== null && daysSince <= 7 && o.type !== 'points', canCreate: ['paid', 'shipped', 'completed'].includes(o.status) && o.type !== 'points' && !active };
  };
  r.post('/service/:uid/aftersale', need('service'), (req, res) => {
    const uid = int(req.params.uid);
    const x = createAftersale(req, db.get('SELECT * FROM orders WHERE id=? AND user_id=?', int(req.body.order_id), uid), req.body);
    if (!x.ok) { flash(req, 'error', x.msg); return res.redirect('/admin/service?uid=' + uid); }
    flash(req, 'success', `售后单 #${x.id} 已创建并通知用户`); res.redirect('/admin/aftersales/' + x.id);
  });
  r.post('/orders/:id/aftersale', need('order'), (req, res) => {
    const o = db.get('SELECT * FROM orders WHERE id=?', int(req.params.id));
    const x = createAftersale(req, o, req.body);
    if (!x.ok) { flash(req, 'error', x.msg); return res.redirect('/admin/orders/' + int(req.params.id) + '#aftersale'); }
    flash(req, 'success', `售后单 #${x.id} 已创建并通知用户`); res.redirect('/admin/aftersales/' + x.id);
  });
  r.post('/service/:uid/reply', need('service'), (req, res) => {
    const uid = int(req.params.uid), c = String(req.body.content || '').trim().slice(0, 500), chat = require('../lib/chat'), fs = require('fs');
    const files = (req.files || []).filter(f => f.fieldname === 'images');
    const back = () => res.redirect('/admin/service?uid=' + uid);
    const drop = () => files.forEach(f => { try { fs.unlinkSync(f.path); } catch (e) {} });
    if (!db.get('SELECT 1 FROM users WHERE id=?', uid)) { drop(); return back(); }
    if (files.length) {
      const bufs = files.map(f => fs.readFileSync(f.path)); drop();
      const x = chat.saveImages(bufs); if (!x.ok) { flash(req, 'error', x.msg); return back(); }
      chat.addMessage(uid, 'staff', 'image', `[图片×${x.urls.length}]`, { images: x.urls });
    }
    if (c) chat.addMessage(uid, 'staff', 'text', c);
    if (c || files.length) log(req, '客服回复', '#' + uid + (files.length ? ' 图片×' + files.length : ''));
    back();
  });

  // 撤回 / 重新编辑人工客服消息(限时;原文与操作人留痕,仅后台可见)
  for (const act of ['recall', 'edit']) r.post('/service/:uid/msg/:mid/' + act, need('service'), (req, res) => {
    const uid = int(req.params.uid), mid = int(req.params.mid), chat = require('../lib/chat');
    const m = db.get('SELECT id FROM messages WHERE id=? AND user_id=?', mid, uid);
    const op = req.session.admin.name || req.session.admin.username || ('#' + req.session.admin.id);
    const x = !m ? { ok: false, msg: '消息不存在' } : act === 'recall' ? chat.recall(mid, op) : chat.edit(mid, req.body.content, op);
    if (x.ok) log(req, act === 'recall' ? '撤回客服消息' : '编辑客服消息', `#${uid} 消息 ${mid}`);
    flash(req, x.ok ? 'success' : 'error', x.ok ? (act === 'recall' ? '已撤回' : '已修改') : x.msg);
    res.redirect('/admin/service?uid=' + uid + '#m' + mid);
  });

  // ================= 统计报表 =================
  r.get('/stats', need('stats'), (req, res) => {
    const range = [7, 30, 90].includes(int(req.query.days)) ? int(req.query.days) : 30;
    const valid = "status NOT IN ('cancelled','unpaid','refunded')";
    const labels = [], sales = [], orders = [], newUsers = [], uv = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = U.offset(-i * 86400000).slice(0, 10); labels.push(d.slice(5));
      const x = netSales(`${valid} AND paid_at LIKE ?`, d + '%'); sales.push(round2(x.a)); orders.push(x.n);
      newUsers.push(db.get('SELECT COUNT(*) n FROM users WHERE created_at LIKE ?', d + '%').n);
    }
    const salesChart = chart.trend({ labels, series: [{ name: '销售额(元)', color: '#d4202a', values: sales, type: 'bar' }, { name: '订单数', color: '#f2a93b', values: orders, type: 'line' }], width: 900, height: 280 });
    const userChart = chart.trend({ labels, series: [{ name: '新增会员', color: '#2a5bd7', values: newUsers, type: 'bar' }], width: 900, height: 220 });
    const since = U.offset(-range * 86400000).slice(0, 10) + ' 00:00:00';
    const topProducts = db.all(`SELECT oi.name label, SUM(oi.qty) qty, SUM(oi.price*oi.qty) amt FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.${valid.replace(/status/, 'status')} AND o.paid_at>=? GROUP BY oi.name ORDER BY amt DESC LIMIT 10`, since);
    const catSales = db.all(`SELECT COALESCE(c.name,'其他') label, SUM(oi.price*oi.qty) value FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN categories c ON c.id=p.category_id WHERE o.status NOT IN ('cancelled','unpaid','refunded') AND o.paid_at>=? GROUP BY c.name ORDER BY value DESC`, since).map(x => ({ label: x.label, value: Math.round(x.value) }));
    const payDist = db.all(`SELECT pay_method label, COUNT(*) value FROM orders WHERE ${valid} AND paid_at>=? GROUP BY pay_method`, since).map(x => ({ label: U.PAY_METHOD[x.label] || x.label, value: x.value }));
    const levelDist = db.all('SELECT l.name label, COUNT(u.id) value FROM member_levels l LEFT JOIN users u ON u.level_id=l.id GROUP BY l.id ORDER BY l.min_growth');
    const topUsers = db.all(`SELECT u.id, u.nickname, u.phone, SUM(${NET_PAY}) amt, COUNT(*) n FROM orders o JOIN users u ON u.id=o.user_id WHERE o.${valid.replace(/status/, 'status')} AND o.paid_at>=? GROUP BY u.id ORDER BY amt DESC LIMIT 8`, since);
    const sum = netSales(`${valid} AND paid_at>=?`, since);
    const conv = { users: db.get('SELECT COUNT(*) n FROM users').n, buyers: db.get(`SELECT COUNT(DISTINCT user_id) n FROM orders WHERE ${valid}`).n, repeat: db.get(`SELECT COUNT(*) n FROM (SELECT user_id FROM orders WHERE ${valid} GROUP BY user_id HAVING COUNT(*)>1)`).n };
    res.page('admin/stats', { title: '统计报表', range, sum, salesChart, userChart, topProducts, catChart: chart.donut(catSales), payChart: chart.donut(payDist), levelChart: chart.hbar(levelDist, { color: '#2a5bd7', unit: '人' }), topUsers, conv });
  });

  // ================= 系统 =================
  r.get('/settings', need('system'), (req, res) => res.page('admin/settings', { title: '站点设置', s: svc.settings() }));
  r.post('/settings', need('system'), (req, res) => {
    const keys = ['shop_name', 'slogan', 'announcement', 'service_phone', 'service_wechat', 'ship_from', 'service_quick_questions', 'service_recall_minutes', 'service_hours', 'service_email', 'address', 'icp', 'signin_base', 'stock_warn', 'unpaid_cancel_minutes', 'auto_confirm_days', 'aftersale_days', 'register_points', 'review_points', 'hot_sales_threshold', 'new_days'];
    req.body.show_sales = req.body.show_sales === '1' ? '1' : '0'; keys.push('show_sales');
    for (const k of ['hot_sales_threshold', 'new_days']) if (req.body[k] == null || req.body[k] === '') req.body[k] = svc.S(k) || svc.settings()[k];
    const numeric = ['signin_base', 'stock_warn', 'unpaid_cancel_minutes', 'auto_confirm_days', 'aftersale_days', 'register_points', 'review_points', 'hot_sales_threshold', 'new_days'];
    if (!String(req.body.shop_name || '').trim()) { flash(req, 'error', '商城名称不能为空'); return res.redirect('/admin/settings'); }
    for (const k of numeric) if (!(num(req.body[k], -1) >= 0)) { flash(req, 'error', '数值类设置需为非负数字'); return res.redirect('/admin/settings'); }
    for (const k of keys) svc.setSetting(k, String(req.body[k] == null ? '' : req.body[k]).trim().slice(0, 300));
    log(req, '修改站点设置', ''); flash(req, 'success', '设置已保存'); res.redirect('/admin/settings');
  });
  // 积分设置:有效期清零日、到期提醒、积分专区横幅、兑换须知;下单积分抵现(默认关闭,关闭时前台不出现积分折现比例)
  r.post('/settings/points', need('system'), (req, res) => {
    const b = req.body, go = (t, m) => { flash(req, t, m); res.redirect('/admin/settings#points'); };
    const cd = String(b.points_clear_day || '').trim();
    if (!/^(0[1-9]|1[0-2])-(0[1-9]|1\d|2[0-8])$/.test(cd)) return go('error', '清零日格式为 MM-DD(日期 01-28),如 06-01');
    const remind = int(b.points_expiry_remind_days, -1), rate = int(b.points_rate, -1), pct = int(b.points_max_percent, -1);
    if (remind < 1 || remind > 180) return go('error', '到期提醒天数需为 1-180');
    if (rate < 1) return go('error', '积分抵现比例至少为 1');
    if (pct < 0 || pct > 100) return go('error', '积分最高抵扣比例需为 0-100');
    svc.setSetting('points_clear_day', cd); svc.setSetting('points_expiry_remind_days', remind);
    svc.setSetting('points_expiry_enable', b.points_expiry_enable === '1' ? '1' : '0');
    svc.setSetting('points_deduct_enable', b.points_deduct_enable === '1' ? '1' : '0');
    svc.setSetting('points_rate', rate); svc.setSetting('points_max_percent', pct);
    svc.setSetting('points_redeem_notice', String(b.points_redeem_notice == null ? '' : b.points_redeem_notice).trim().slice(0, 200));
    log(req, '修改积分设置', `清零日 ${cd} 提醒 ${remind} 天 抵现 ${b.points_deduct_enable === '1' ? '开' : '关'}`); go('success', '积分设置已保存');
  });
  crud(r, { path: 'roles', table: 'roles', perm: 'system', title: '角色权限', singular: '角色',
    cols: [{ label: 'ID', f: x => x.id }, { label: '角色', f: x => '<b>' + esc(x.name) + '</b>' }, { label: '权限', f: x => x.permissions === 'all' ? '<span class="tag">全部权限</span>' : x.permissions.split(',').filter(Boolean).map(p => `<span class="tag gold">${esc(U.PERMS[p] ? U.PERMS[p].split('/')[0] : p)}</span>`).join('') }, { label: '管理员数', f: x => db.get('SELECT COUNT(*) n FROM admins WHERE role_id=?', x.id).n }, { label: '说明', f: x => esc(x.remark) }],
    fields: [{ name: 'name', label: '角色名称', required: true }, { name: 'permissions', label: '权限', type: 'perms' }, { name: 'remark', label: '说明' }],
    // 权限以勾选项为准(无 JS 时也生效),只保留有效权限键;不能削减自己当前所用角色的权限,避免把自己锁在后台外
    validate: (row, ex, req) => {
      const b = req.body, picked = [].concat(b.perm || []).length ? [].concat(b.perm) : String(row.permissions || '').split(',');
      row.permissions = b.permissions_all === '1' || row.permissions === 'all' ? 'all' : [...new Set(picked.flatMap(x => String(x).split(',')).map(x => x.trim()).filter(k => U.PERMS[k]))].join(',');
      if (!row.permissions) return '请至少勾选一项权限';
      const mine = db.get('SELECT role_id FROM admins WHERE id=?', req.session.admin.id);
      if (ex && mine && mine.role_id === ex.id && row.permissions !== ex.permissions && (ex.permissions === 'all' || !row.permissions.split(',').includes('system'))) return '不能削减自己当前所用角色的权限(请用其他超级管理员账号修改)';
      if (ex && ex.permissions === 'all' && row.permissions !== 'all' && !db.get("SELECT 1 FROM roles WHERE permissions='all' AND id<>?", ex.id)) return '至少需要保留一个拥有全部权限的角色';
      return null;
    },
    canDelete: x => x.permissions === 'all' ? '超级管理员角色不能删除' : (db.get('SELECT 1 FROM admins WHERE role_id=?', x.id) ? '该角色下还有管理员' : null) }, ctx);
  r.get('/admins', need('system'), (req, res) => res.page('admin/admins', { title: '管理员账号', rows: db.all('SELECT a.*, r.name role_name FROM admins a LEFT JOIN roles r ON r.id=a.role_id ORDER BY a.id'), roles: db.all('SELECT * FROM roles'), edit: req.query.edit ? db.get('SELECT * FROM admins WHERE id=?', int(req.query.edit)) : null }));
  r.post('/admins/save', need('system'), (req, res) => {
    const b = req.body, id = int(b.id), username = String(b.username || '').trim(), name = String(b.name || '').trim() || username;
    const fail = m => { flash(req, 'error', m); res.redirect('/admin/admins' + (id ? '?edit=' + id : '')); };
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return fail('账号为 3-20 位字母/数字/下划线');
    if (!db.get('SELECT 1 FROM roles WHERE id=?', int(b.role_id))) return fail('请选择角色');
    const dup = db.get('SELECT id FROM admins WHERE username=?', username); if (dup && dup.id !== id) return fail('账号已存在');
    const pw = String(b.password || '');
    if (id) {
      if (pw && pw.length < 8) return fail('密码至少 8 位');
      const me = id === req.session.admin.id;
      if (me && !b.status) return fail('不能停用自己');
      if (me && int(b.role_id) !== db.get('SELECT role_id FROM admins WHERE id=?', id).role_id && db.get('SELECT permissions FROM roles WHERE id=?', int(b.role_id)).permissions !== 'all') return fail('不能降低自己的权限');
      db.exec1('UPDATE admins SET username=?, name=?, role_id=?, status=? WHERE id=?', username, name, int(b.role_id), b.status ? 1 : 0, id);
      if (pw) db.exec1('UPDATE admins SET password_hash=?, must_change_pw=? WHERE id=?', bcrypt.hashSync(pw, 10), me ? 0 : 1, id); // 他人重置的密码为临时密码,登录后须修改
      log(req, '编辑管理员', username);
    } else {
      if (pw.length < 8) return fail('密码至少 8 位');
      db.exec1('INSERT INTO admins(username,password_hash,name,role_id,status,must_change_pw,created_at) VALUES(?,?,?,?,?,1,?)', username, bcrypt.hashSync(pw, 10), name, int(b.role_id), b.status ? 1 : 0, now()); log(req, '新增管理员', username);
    }
    flash(req, 'success', '管理员已保存'); res.redirect('/admin/admins');
  });
  r.post('/admins/:id/delete', need('system'), (req, res) => {
    const id = int(req.params.id);
    if (id === req.session.admin.id) flash(req, 'error', '不能删除自己'); else { db.exec1('DELETE FROM admins WHERE id=?', id); log(req, '删除管理员', '#' + id); flash(req, 'success', '已删除'); }
    res.redirect('/admin/admins');
  });
  r.get('/password', need(null), (req, res) => res.page('admin/password', { title: '修改密码', forced: !!req.session.admin.mustChange, demo: isDemo() }));
  r.post('/password', need(null), (req, res) => {
    const a = db.get('SELECT * FROM admins WHERE id=?', req.session.admin.id), pw = String(req.body.password || '');
    if (!bcrypt.compareSync(String(req.body.old_password || ''), a.password_hash)) flash(req, 'error', '原密码错误');
    else if (pw.length < 8) flash(req, 'error', '新密码至少 8 位');
    else if (pw !== req.body.password2) flash(req, 'error', '两次输入不一致');
    else if (pw === req.body.old_password) flash(req, 'error', '新密码不能与原密码相同');
    else if (Object.values(DEFAULT_PW).includes(pw) || /^(\d)\1+$|^12345678|^password$/i.test(pw)) flash(req, 'error', '新密码过于简单或为系统默认密码,请换一个');
    else {
      const wasForced = !!req.session.admin.mustChange;
      db.exec1('UPDATE admins SET password_hash=?, must_change_pw=0 WHERE id=?', bcrypt.hashSync(pw, 10), a.id);
      req.session.admin.mustChange = false; req.session.admin.pwSkipped = false;
      log(req, '修改自己的密码', wasForced ? '首次登录强制改密' : ''); flash(req, 'success', '密码已修改');
      if (wasForced) return res.redirect('/admin');
    }
    res.redirect('/admin/password');
  });
  // 仅演示环境(环境变量 DEMO_MODE=1)可跳过强制改密
  r.post('/password/skip', need(null), (req, res) => {
    if (!isDemo()) { flash(req, 'error', '正式环境必须修改默认密码后才能使用后台'); return res.redirect('/admin/password'); }
    if (req.session.admin.mustChange) { req.session.admin.mustChange = false; req.session.admin.pwSkipped = true; log(req, '演示模式跳过修改默认密码', ''); }
    res.redirect('/admin');
  });
  r.get('/logs', need('system'), (req, res) => {
    const q = String(req.query.q || '').trim(), where = ['1=1'], params = []; if (q) { where.push('(admin_name LIKE ? OR action LIKE ? OR detail LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    res.page('admin/logs', { title: '操作日志', pg: U.paginate(`SELECT * FROM admin_logs WHERE ${where.join(' AND ')} ORDER BY id DESC`, params, req.query.page, 25), q });
  });
  r.get('/logs/export', need('system'), (req, res) => void log(req, '导出操作日志CSV', '') || sendCSV(res, '操作日志', ['时间', '管理员', '操作', '详情', 'IP'], db.all('SELECT * FROM admin_logs ORDER BY id DESC LIMIT 5000').map(l => [l.created_at, l.admin_name, l.action, l.detail, l.ip])));
  require('./admin-jdvop')(r, ctx);
};
