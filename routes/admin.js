const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const U = require('../lib/util');
const svc = require('../lib/svc');
const chart = require('../lib/chart');
const crud = require('../lib/crud');
const { now, int, num, round2, esc, money } = U;

const COMPANIES = ['顺丰速运', '中通快递', '圆通速递', '韵达快递', '申通快递', '京东物流', '极兔速递', 'EMS'];

module.exports = function (r, { filesOf }) {
  const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
  const perms = a => a ? (a.perms === 'all' ? 'all' : String(a.perms).split(',')) : [];
  const can = (a, p) => a && (a.perms === 'all' || String(a.perms).split(',').includes(p));
  const log = (req, action, detail) => db.exec1('INSERT INTO admin_logs(admin_id,admin_name,action,detail,ip,created_at) VALUES(?,?,?,?,?,?)', req.session.admin ? req.session.admin.id : null, req.session.admin ? req.session.admin.username : '-', action, String(detail || '').slice(0, 300), req.ip, now());
  const need = p => (req, res, next) => {
    if (!req.session.admin) return res.redirect('/admin/login');
    // 每次请求刷新权限,角色变更即时生效
    const a = db.get('SELECT a.*, r.permissions, r.name role_name FROM admins a LEFT JOIN roles r ON r.id=a.role_id WHERE a.id=?', req.session.admin.id);
    if (!a || !a.status) { req.session.admin = null; return res.redirect('/admin/login'); }
    req.session.admin.perms = a.permissions || ''; req.session.admin.name = a.name; req.session.admin.role_name = a.role_name;
    res.locals.admin = req.session.admin;
    if (p && !can(req.session.admin, p)) return res.status(403).page('admin/forbidden', { title: '无权限' });
    next();
  };
  const ctx = { need, flash, log, filesOf };
  const back = (req, res, fb) => res.redirect(req.get('referer') && req.get('referer').includes('/admin') ? req.get('referer') : fb);
  const sendCSV = (res, name, header, rows) => { res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}-${U.today()}.csv`); res.send(U.toCSV(header, rows)); };
  r.use((req, res, next) => { res.locals.can = p => can(req.session.admin, p); res.locals.warnCount = 0; res.locals.COMPANIES = COMPANIES; res.locals.cur = req.path; if (req.session.admin) { res.locals.warnCount = db.get('SELECT COUNT(*) n FROM skus s JOIN products p ON p.id=s.product_id WHERE s.stock<=? AND p.status=1', int(svc.S('stock_warn'), 10)).n; res.locals.pending = { orders: db.get("SELECT COUNT(*) n FROM orders WHERE status='paid' AND type!='group' OR (status='paid' AND type='group' AND group_id IN (SELECT id FROM groups WHERE status='success'))").n, as: db.get("SELECT COUNT(*) n FROM aftersales WHERE status IN ('pending','returned')").n, reviews: db.get("SELECT COUNT(*) n FROM reviews WHERE status='pending'").n, msgs: db.get("SELECT COUNT(DISTINCT user_id) n FROM messages WHERE sender='user' AND user_id NOT IN (SELECT user_id FROM messages m2 WHERE m2.sender='staff' AND m2.id > (SELECT MAX(id) FROM messages m3 WHERE m3.sender='user' AND m3.user_id=messages.user_id))").n, invoices: db.get("SELECT COUNT(*) n FROM invoices WHERE status='pending'").n }; } next(); });

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
      req.session.admin = { id: a.id, username: a.username, name: a.name, perms: a.permissions || '', role_name: a.role_name };
      db.exec1('UPDATE admins SET last_login=? WHERE id=?', now(), a.id); log(req, '登录后台', '');
      req.session.save(() => res.redirect('/admin'));
    });
  });
  r.post('/logout', (req, res) => { if (req.session.admin) log(req, '退出后台', ''); req.session.regenerate(() => res.redirect('/admin/login')); });

  // ================= 数据概览 =================
  r.get('/', need('dashboard'), (req, res) => {
    const today = U.today(), valid = "status NOT IN ('cancelled','unpaid','refunded')";
    const sum = (where, ...p) => db.get(`SELECT COALESCE(SUM(pay_amount),0) a, COUNT(*) n FROM orders WHERE ${where}`, ...p);
    const t = sum(`${valid} AND paid_at LIKE ?`, today + '%'), all = sum(valid);
    const stats = {
      todaySales: t.a, todayOrders: db.get('SELECT COUNT(*) n FROM orders WHERE created_at LIKE ?', today + '%').n, totalSales: all.a, totalOrders: db.get('SELECT COUNT(*) n FROM orders').n,
      members: db.get('SELECT COUNT(*) n FROM users').n, todayMembers: db.get('SELECT COUNT(*) n FROM users WHERE created_at LIKE ?', today + '%').n,
      products: db.get('SELECT COUNT(*) n FROM products WHERE status=1').n, toShip: db.get("SELECT COUNT(*) n FROM orders WHERE status='paid'").n, unpaid: db.get("SELECT COUNT(*) n FROM orders WHERE status='unpaid'").n,
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
  const catOptions = () => db.all('SELECT c.*, p.name pname FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.status>=0 ORDER BY COALESCE(p.sort,c.sort), c.parent_id, c.sort').map(c => ({ v: c.id, t: (c.parent_id ? '　└ ' : '') + c.name, parent: c.parent_id }));
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
    const row = { name: String(b.name || '').trim(), subtitle: String(b.subtitle || '').trim(), category_id: int(b.category_id), brand_id: int(b.brand_id), market_price: String(b.market_price || '').trim() === '' ? null : round2(num(b.market_price)), description: String(b.description || ''), status: b.status ? 1 : 0, is_hot: b.is_hot ? 1 : 0, is_new: b.is_new ? 1 : 0, template_id: int(b.template_id), weight: num(b.weight, 0.5), spec_names: specNames.join(','), sort: int(b.sort), images: JSON.stringify(images), no_reason_return: b.no_reason_return === '1' ? 1 : b.no_reason_return === '0' ? 0 : null };
    const fail = m => { flash(req, 'error', m); const pp = { ...row, id: id || undefined, price: 0 }; productForm(req, res, pp, skus.length ? skus : [{ attrs: '{}', spec_text: '默认', price: 0, stock: 0, code: '' }], { type: 'error', msg: m }); };
    if (!row.name) return fail('请填写商品名称');
    if (!row.category_id) return fail('请选择商品分类');
    if (!row.template_id || !db.get('SELECT 1 FROM shipping_templates WHERE id=?', row.template_id)) return fail('请选择运费模板');
    if (row.market_price != null && row.market_price <= 0) row.market_price = null;
    if (row.market_price != null && skus.length && row.market_price <= Math.min(...skus.map(s => s.price))) return fail('划线原价需高于售价;如不确定曾真实销售的价格,请留空');
    if (!skus.length) return fail('至少需要一个规格(SKU)');
    if (skus.some(s => s.price <= 0)) return fail('每个规格的价格需大于 0');
    if (!specNames.length) return fail('请填写规格名称,如:颜色,尺码');
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
    const hits = require('../lib/banned').checkProduct(row, skus);
    if (hits.length) { flash(req, 'warn', '商品已保存,但检测到违禁/敏感词,请核实修改:' + require('../lib/banned').summarize(hits)); return res.redirect('/admin/products/' + (id || db.get('SELECT MAX(id) n FROM products').n) + '/edit'); }
    flash(req, 'success', '商品已保存'); res.redirect('/admin/products');
  });
  // 违禁词检查:可编辑词表 + 扫描现有商品
  r.get('/banned-words', need('product'), (req, res) => res.page('admin/banned-words', { title: '违禁词检查', words: require('../lib/banned').words(), rows: require('../lib/banned').scanAll() }));
  r.post('/banned-words', need('product'), (req, res) => {
    const list = [...new Set(String(req.body.words || '').split(/\r?\n/).map(s => s.trim().slice(0, 20)).filter(Boolean))].slice(0, 500);
    svc.setSetting('banned_words', list.join('\n'));
    log(req, '修改违禁词表', `${list.length} 个`); flash(req, 'success', `违禁词表已保存(${list.length} 个)`); res.redirect('/admin/banned-words');
  });
  r.post('/products/:id/toggle', need('product'), (req, res) => { db.exec1('UPDATE products SET status=1-status WHERE id=?', int(req.params.id)); log(req, '商品上/下架', '#' + req.params.id); back(req, res, '/admin/products'); });
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
  r.get('/export/products', need('stats'), (req, res) => sendCSV(res, '商品库存', ['商品ID', '商品名称', '分类', '品牌', '规格', '编码', '价格', '库存', '销量', '状态'], db.all('SELECT p.id,p.name,c.name cn,b.name bn,s.spec_text,s.code,s.price,s.stock,p.sales,p.status FROM skus s JOIN products p ON p.id=s.product_id LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN brands b ON b.id=p.brand_id ORDER BY p.id,s.id').map(x => [x.id, x.name, x.cn, x.bn, x.spec_text, x.code, x.price, x.stock, x.sales, x.status ? '上架' : '下架'])));

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
  r.get('/orders', need('order'), (req, res) => {
    const { q = '', status = '', type = '', from = '', to = '' } = req.query;
    const where = ['1=1'], params = [];
    if (q.trim()) { where.push('(o.order_no LIKE ? OR o.receiver LIKE ? OR o.phone LIKE ? OR u.phone LIKE ? OR o.tracking_no LIKE ?)'); const k = '%' + q.trim() + '%'; params.push(k, k, k, k, k); }
    if (status) { where.push('o.status=?'); params.push(status); }
    if (type) { where.push('o.type=?'); params.push(type); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) { where.push('o.created_at>=?'); params.push(from + ' 00:00:00'); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) { where.push('o.created_at<=?'); params.push(to + ' 23:59:59'); }
    const sql = `SELECT o.*, u.nickname, u.phone uphone FROM orders o JOIN users u ON u.id=o.user_id WHERE ${where.join(' AND ')} ORDER BY o.id DESC`;
    const pg = U.paginate(sql, params, req.query.page, 15);
    pg.rows.forEach(o => { o.items = db.all('SELECT * FROM order_items WHERE order_id=?', o.id); if (o.type === 'group') o.groupStatus = (db.get('SELECT status FROM groups WHERE id=?', o.group_id) || {}).status; });
    const counts = {}; for (const x of db.all('SELECT status, COUNT(*) n FROM orders GROUP BY status')) counts[x.status] = x.n;
    res.page('admin/orders', { title: '订单管理', pg, q, status, type, from, to, counts });
  });
  r.get('/orders/export', need('stats'), (req, res) => {
    const rows = db.all('SELECT o.*, u.phone uphone FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC').map(o => [o.order_no, o.created_at, o.uphone, U.ORDER_STATUS[o.status], o.type, o.goods_amount, o.freight, o.level_discount, o.coupon_discount, o.points_discount, o.pay_amount, U.PAY_METHOD[o.pay_method] || '', o.receiver, o.phone, `${o.province}${o.city}${o.district}${o.detail}`, o.express_company || '', o.tracking_no || '', db.all('SELECT name,spec_text,qty FROM order_items WHERE order_id=?', o.id).map(i => `${i.name}(${i.spec_text})x${i.qty}`).join(';')]);
    log(req, '导出订单CSV', rows.length + '条');
    sendCSV(res, '订单', ['订单号', '下单时间', '会员手机', '状态', '类型', '商品金额', '运费', '会员折扣', '优惠券', '积分抵扣', '实付', '支付方式', '收货人', '收货电话', '收货地址', '快递公司', '运单号', '商品'], rows);
  });
  r.get('/orders/:id', need('order'), (req, res) => {
    const o = db.get('SELECT o.*, u.nickname, u.phone uphone FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=?', int(req.params.id));
    if (!o) { flash(req, 'error', '订单不存在'); return res.redirect('/admin/orders'); }
    const group = o.group_id ? db.get('SELECT * FROM groups WHERE id=?', o.group_id) : null;
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
    const x = o.status === 'unpaid' ? svc.cancelOrder(o.id, reason) : svc.refundOrder(o.id, '商家取消:' + reason);
    if (x.ok) log(req, o.status === 'unpaid' ? '取消订单' : '取消订单并退款', `#${o.id} ${reason}`);
    flash(req, x.ok ? 'success' : 'error', x.ok ? (o.status === 'unpaid' ? '订单已取消' : '订单已取消,款项原路退回' + (x.points ? `,退回积分 ${x.points}` : '')) : x.msg); res.redirect('/admin/orders/' + o.id);
  });
  r.post('/orders/:id/remark', need('order'), (req, res) => { db.exec1('UPDATE orders SET admin_remark=? WHERE id=?', String(req.body.admin_remark || '').slice(0, 200), int(req.params.id)); log(req, '订单备注', '#' + req.params.id); res.redirect('/admin/orders/' + int(req.params.id)); });
  r.post('/orders/:id/trace', need('order'), (req, res) => { const t = String(req.body.text || '').trim().slice(0, 100); if (t) db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', int(req.params.id), now(), t); else svc.advanceTrace(int(req.params.id)); res.redirect('/admin/orders/' + int(req.params.id)); });
  r.post('/orders/:id/address', need('order'), (req, res) => {
    const o = db.get('SELECT * FROM orders WHERE id=?', int(req.params.id));
    if (o && ['unpaid', 'paid'].includes(o.status)) { db.exec1('UPDATE orders SET receiver=?, phone=?, detail=? WHERE id=?', String(req.body.receiver || o.receiver).slice(0, 20), String(req.body.phone || o.phone).slice(0, 20), String(req.body.detail || o.detail).slice(0, 100), o.id); log(req, '修改收货信息', '#' + o.id); flash(req, 'success', '收货信息已更新'); }
    res.redirect('/admin/orders/' + int(req.params.id));
  });

  // ================= 售后 =================
  r.get('/aftersales', need('order'), (req, res) => {
    const st = req.query.status || '';
    const pg = U.paginate(`SELECT a.*, o.order_no, o.status ostatus, u.phone, u.nickname FROM aftersales a JOIN orders o ON o.id=a.order_id JOIN users u ON u.id=a.user_id ${st ? 'WHERE a.status=?' : ''} ORDER BY a.id DESC`, st ? [st] : [], req.query.page, 15);
    res.page('admin/aftersales', { title: '售后管理', pg, st });
  });
  r.get('/aftersales/:id', need('order'), (req, res) => {
    const a = db.get('SELECT a.*, o.order_no, o.pay_amount, o.points_used, o.points_discount, o.points_awarded, o.status ostatus, o.completed_at, o.no7_confirmed, u.phone, u.nickname, u.cancelled_at ucancel FROM aftersales a JOIN orders o ON o.id=a.order_id JOIN users u ON u.id=a.user_id WHERE a.id=?', int(req.params.id));
    if (!a) return res.redirect('/admin/aftersales');
    a.estPoints = a.pay_amount > 0 ? Math.round((a.points_used || 0) * Math.min(1, a.amount / a.pay_amount)) : (a.points_used || 0);
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
    const st = req.query.status || '';
    const pg = U.paginate(`SELECT i.*, o.order_no, u.phone FROM invoices i JOIN orders o ON o.id=i.order_id JOIN users u ON u.id=i.user_id ${st ? 'WHERE i.status=?' : ''} ORDER BY i.id DESC`, st ? [st] : [], req.query.page, 15);
    res.page('admin/invoices', { title: '发票管理', pg, st });
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
      db.transaction(() => { db.exec1("UPDATE reviews SET status='approved' WHERE id=?", rv.id); if (rv.status === 'pending') svc.addPoints(rv.user_id, int(svc.S('review_points'), 10), '评价奖励'); })(); log(req, '评价审核通过', '#' + rv.id);
    } else if (act === 'reject') { db.exec1("UPDATE reviews SET status='rejected' WHERE id=?", rv.id); log(req, '评价审核拒绝', '#' + rv.id); }
    else if (act === 'reply') { db.exec1('UPDATE reviews SET reply=? WHERE id=?', String(req.body.reply || '').slice(0, 300), rv.id); log(req, '回复评价', '#' + rv.id); }
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
  r.get('/members/export', need('stats'), (req, res) => { log(req, '导出会员CSV', ''); sendCSV(res, '会员', ['ID', '手机号', '昵称', '性别', '等级', '成长值', '积分', '累计消费', '状态', '同意协议时间', '协议版本', '注销时间', '注册时间', '最近登录'], db.all('SELECT u.*, l.name ln FROM users u LEFT JOIN member_levels l ON l.id=u.level_id ORDER BY u.id').map(u => [u.id, u.cancelled_at ? '(已注销)' : u.phone, u.nickname, u.gender, u.ln, u.growth, u.points, u.total_spent, u.cancelled_at ? '已注销' : u.status ? '正常' : '禁用', u.consent_at || '', u.consent_version || '', u.cancelled_at || '', u.created_at, u.last_login])); });
  r.get('/members/:id', need('member'), (req, res) => {
    const u = db.get('SELECT u.*, l.name level_name, l.color level_color, ref.nickname ref_name FROM users u LEFT JOIN member_levels l ON l.id=u.level_id LEFT JOIN users ref ON ref.id=u.referrer_id WHERE u.id=?', int(req.params.id));
    if (!u) { flash(req, 'error', '会员不存在'); return res.redirect('/admin/members'); }
    res.page('admin/member', { title: '会员详情', u, addrs: db.all('SELECT * FROM addresses WHERE user_id=?', u.id), orders: db.all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 10', u.id), plog: db.all('SELECT * FROM points_log WHERE user_id=? ORDER BY id DESC LIMIT 10', u.id), aftersales: db.all('SELECT a.*, o.order_no FROM aftersales a JOIN orders o ON o.id=a.order_id WHERE a.user_id=? ORDER BY a.id DESC LIMIT 10', u.id), levels: db.all('SELECT * FROM member_levels ORDER BY min_growth'), favs: db.get('SELECT COUNT(*) n FROM favorites WHERE user_id=?', u.id).n, invitees: db.get('SELECT COUNT(*) n FROM users WHERE referrer_id=?', u.id).n, cloudStatus: svc.cloud.cardStatus(u), cardTypes: db.all('SELECT * FROM cloud_card_types WHERE status=1 ORDER BY sort,id'), cloudSales: db.all('SELECT s.*, c.name card_name FROM cloud_card_sales s LEFT JOIN cloud_card_types c ON c.id=s.card_type_id WHERE s.user_id=? ORDER BY s.id DESC LIMIT 10', u.id), today: U.today(), coupons: svc.userCoupons(u.id, 'unused').length, db_coupons: db.all('SELECT id,name FROM coupons WHERE status=1') });
  });
  r.post('/members/:id/status', need('member'), (req, res) => { const u = db.get('SELECT * FROM users WHERE id=?', int(req.params.id)); if (u && u.cancelled_at) { flash(req, 'error', '该账号已注销,不可启用'); return back(req, res, '/admin/members'); } if (u) { db.exec1('UPDATE users SET status=1-status WHERE id=?', u.id); if (u.status) db.exec1('DELETE FROM sessions WHERE sess LIKE ?', `%"uid":${u.id}%`); log(req, u.status ? '禁用会员' : '启用会员', `#${u.id} ${u.phone}`); } back(req, res, '/admin/members'); });
  r.post('/members/:id/points', need('member'), (req, res) => {
    const d = int(req.body.delta), reason = String(req.body.reason || '').trim().slice(0, 50) || '管理员调整';
    if (!d) { flash(req, 'error', '请输入非零的调整数值(正数增加,负数扣减)'); return res.redirect('/admin/members/' + int(req.params.id)); }
    svc.addPoints(int(req.params.id), d, '管理员调整:' + reason); log(req, '调整积分', `#${req.params.id} ${d > 0 ? '+' : ''}${d} ${reason}`); flash(req, 'success', '积分已调整'); res.redirect('/admin/members/' + int(req.params.id));
  });
  r.post('/members/:id/level', need('member'), (req, res) => {
    const lv = db.get('SELECT * FROM member_levels WHERE id=?', int(req.body.level_id)); if (lv) { db.exec1('UPDATE users SET level_id=?, growth=MAX(growth,?) WHERE id=?', lv.id, lv.min_growth, int(req.params.id)); log(req, '设置会员等级', `#${req.params.id} → ${lv.name}`); flash(req, 'success', '等级已更新'); }
    res.redirect('/admin/members/' + int(req.params.id));
  });
  r.post('/members/:id/edit', need('member'), (req, res) => { db.exec1('UPDATE users SET nickname=?, remark=? WHERE id=?', String(req.body.nickname || '').slice(0, 20), String(req.body.remark || '').slice(0, 200), int(req.params.id)); log(req, '编辑会员', '#' + req.params.id); flash(req, 'success', '已保存'); res.redirect('/admin/members/' + int(req.params.id)); });
  r.post('/members/:id/reset-password', need('member'), (req, res) => { const pw = String(req.body.password || ''); if (pw.length < 6) flash(req, 'error', '新密码至少 6 位'); else { db.exec1('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(pw, 10), int(req.params.id)); log(req, '重置会员密码', '#' + req.params.id); flash(req, 'success', '密码已重置'); } res.redirect('/admin/members/' + int(req.params.id)); });
  r.post('/members/:id/coupon', need('member'), (req, res) => { const x = svc.grantCoupon(int(req.params.id), int(req.body.coupon_id), true); log(req, '发放优惠券', `#${req.params.id} coupon ${req.body.coupon_id}`); flash(req, x.ok ? 'success' : 'error', x.ok ? '优惠券已发放' : x.msg); res.redirect('/admin/members/' + int(req.params.id)); });
  crud(r, { path: 'levels', table: 'member_levels', perm: 'member', title: '会员等级', singular: '会员等级', order: 'min_growth',
    cols: [{ label: 'ID', f: x => x.id }, { label: '等级名称', f: x => `<b style="color:${esc(x.color)}">💎 ${esc(x.name)}</b>` }, { label: '所需成长值', f: x => x.min_growth }, { label: '会员折扣', f: x => x.discount < 100 ? (x.discount / 10) + ' 折' : '无折扣' }, { label: '会员数', f: x => db.get('SELECT COUNT(*) n FROM users WHERE level_id=?', x.id).n }, { label: '权益说明', f: x => esc(x.remark) }],
    fields: [{ name: 'name', label: '等级名称', required: true }, { name: 'min_growth', label: '所需成长值', type: 'number', int: true, min: 0 }, { name: 'discount', label: '折扣百分比(100=不打折,95=九五折)', type: 'number', int: true, min: 50, def: 100 }, { name: 'color', label: '徽章颜色', def: '#999999', pattern: /^#[0-9a-fA-F]{6}$/ }, { name: 'remark', label: '权益说明' }],
    validate: row => row.discount > 100 ? '折扣不能大于 100' : null, after: () => db.all('SELECT id FROM users').forEach(u => svc.refreshLevel(u.id)), 
    canDelete: x => x.id === 1 ? '基础等级不能删除' : (db.get('SELECT 1 FROM users WHERE level_id=?', x.id) ? '该等级下还有会员,不能删除' : null) }, ctx);
  // ================= 邀请(单级,一次性积分) =================
  r.get('/invites', need('member'), (req, res) => {
    const st = req.query.status || '';
    const pg = U.paginate(`SELECT r.*, a.nickname an, a.phone ap, b.nickname bn, b.phone bp, o.order_no FROM invite_rewards r LEFT JOIN users a ON a.id=r.referrer_id LEFT JOIN users b ON b.id=r.invitee_id LEFT JOIN orders o ON o.id=r.order_id ${st ? 'WHERE r.status=?' : ''} ORDER BY r.id DESC`, st ? [st] : [], req.query.page, 20);
    const sum = db.get("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN status='granted' THEN points END),0) granted, COALESCE(SUM(CASE WHEN status='pending' THEN 1 END),0) pending FROM invite_rewards");
    const invited = db.get('SELECT COUNT(*) n FROM users WHERE referrer_id IS NOT NULL').n;
    res.page('admin/invites', { title: '邀请管理', pg, st, sum, invited, s: svc.settings(), coupons: db.all('SELECT id, name FROM coupons WHERE status=1 ORDER BY id') });
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
    validate: row => (!['silver', 'gold'].includes(row.tier) ? '档位无效' : !['month', 'quarter', 'year'].includes(row.duration) ? '时长无效' : null)
  }, ctx);

  const CLOUD_KEYS = ['cloud_discount', 'cloud_free_shipping', 'cloud_signin_extra', 'cloud_signin_extra_cap', 'cloud_extra_expire_days'];
  r.get('/cloud-settings', need('member'), (req, res) => { svc.cloud.ensureDefaults(); res.page('admin/cloud-settings', { title: '云商卡配置', s: svc.settings() }); });
  r.post('/cloud-settings', need('member'), (req, res) => {
    const b = req.body;
    const d = int(b.cloud_discount, 0), ex = int(b.cloud_signin_extra, -1), cap = int(b.cloud_signin_extra_cap, -1), exp = int(b.cloud_extra_expire_days, 0);
    if (d < 50 || d > 100) { flash(req, 'error', '会员价折扣需在 50~100 之间(100=不打折)'); return res.redirect('/admin/cloud-settings'); }
    if (ex < 0 || ex > 100) { flash(req, 'error', '签到加赠积分需为 0~100'); return res.redirect('/admin/cloud-settings'); }
    if (cap < 0 || cap > 3000) { flash(req, 'error', '每月加赠上限需为 0~3000'); return res.redirect('/admin/cloud-settings'); }
    if (exp < 1 || exp > 365) { flash(req, 'error', '加赠积分有效期需为 1~365 天'); return res.redirect('/admin/cloud-settings'); }
    svc.setSetting('cloud_discount', d); svc.setSetting('cloud_free_shipping', b.cloud_free_shipping ? '1' : '0');
    svc.setSetting('cloud_signin_extra', ex); svc.setSetting('cloud_signin_extra_cap', cap); svc.setSetting('cloud_extra_expire_days', exp);
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
    fields: [{ name: 'title', label: '标题', required: true }, { name: 'subtitle', label: '副标题' }, { name: 'image', label: '图片(可选,不传则使用渐变背景)', type: 'image' }, { name: 'link', label: '跳转链接', def: '/products', pattern: /^(\/|https?:\/\/)/, patternMsg: '链接需以 / 或 http(s):// 开头' }, { name: 'bg1', label: '渐变色 1', def: '#d4202a', pattern: /^#[0-9a-fA-F]{6}$/ }, { name: 'bg2', label: '渐变色 2', def: '#f2a93b', pattern: /^#[0-9a-fA-F]{6}$/ }, { name: 'sort', label: '排序', type: 'number', int: true }, { name: 'status', label: '启用', type: 'checkbox', def: 1 }] }, ctx);
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
  crud(r, { path: 'points-goods', table: 'points_goods', perm: 'marketing', title: '积分商城商品', singular: '积分商品', toggle: 'status', order: 'sort,id',
    cols: [{ label: 'ID', f: x => x.id }, { label: '商品', f: x => `<img src="${esc(x.image)}" style="height:36px;width:36px;border-radius:6px;vertical-align:middle;object-fit:cover"> <b>${esc(x.name)}</b>` }, { label: '类型', f: x => x.type === 'coupon' ? '优惠券' : '实物' }, { label: '所需积分', f: x => x.points }, { label: '库存/已兑', f: x => `${x.stock}/${x.exchanged}` }, { label: '状态', f: stBadge }],
    fields: [{ name: 'name', label: '名称', required: true }, { name: 'image', label: '图片', type: 'image' }, { name: 'points', label: '所需积分', type: 'number', int: true, min: 1 }, { name: 'type', label: '类型', type: 'select', options: [{ v: 'goods', t: '实物礼品' }, { v: 'coupon', t: '优惠券' }] }, { name: 'coupon_id', label: '关联优惠券(类型为优惠券时)', type: 'select', numeric: true, options: () => [{ v: 0, t: '无' }, ...db.all('SELECT id v, name t FROM coupons')] }, { name: 'stock', label: '库存', type: 'number', int: true, min: 0 }, { name: 'description', label: '说明' }, { name: 'sort', label: '排序', type: 'number', int: true }, { name: 'status', label: '上架', type: 'checkbox', def: 1 }],
    validate: row => row.type === 'coupon' && !row.coupon_id ? '优惠券类型需选择关联优惠券' : null, before: row => { if (!row.image) row.image = U.genImg('🎁', 'f59e0b', 'fde68a', 0, row.name.slice(0, 6)); } }, ctx);
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
    const consented = db.get("SELECT COUNT(*) n FROM users WHERE consent_version=? AND cancelled_at IS NULL", svc.S('policy_version') || '1.0').n;
    const total = db.get('SELECT COUNT(*) n FROM users WHERE cancelled_at IS NULL').n;
    res.page('admin/policies', { title: '隐私政策 / 用户协议', privacy: get('privacy'), terms: get('terms'), version: svc.S('policy_version') || '1.0', consented, total, tab: req.query.tab === 'terms' ? 'terms' : 'privacy' });
  });
  r.post('/policies', need('content'), (req, res) => {
    const topic = req.body.topic === 'terms' ? 'terms' : 'privacy';
    const title = String(req.body.title || '').trim().slice(0, 30) || (topic === 'privacy' ? '隐私政策' : '用户协议');
    const content = String(req.body.content || '');
    if (!content.trim()) { flash(req, 'error', '内容不能为空'); return res.redirect('/admin/policies?tab=' + topic); }
    const ex = db.get("SELECT id FROM articles WHERE category='policy' AND topic=?", topic);
    if (ex) db.exec1('UPDATE articles SET title=?, content=?, status=1 WHERE id=?', title, content, ex.id);
    else db.exec1("INSERT INTO articles(category,topic,title,content,status,sort,created_at) VALUES('policy',?,?,?,1,0,?)", topic, title, content, now());
    const oldV = svc.S('policy_version') || '1.0', newV = String(req.body.version || '').trim().slice(0, 20);
    if (newV && newV !== oldV) { svc.setSetting('policy_version', newV); log(req, '更新协议版本', `${oldV} → ${newV}`); }
    log(req, '编辑' + title, topic); flash(req, 'success', title + '已保存' + (newV && newV !== oldV ? `,版本号更新为 v${newV}(用户下次访问时需重新同意)` : '')); res.redirect('/admin/policies?tab=' + topic);
  });
  // 客服
  r.get('/service', need('service'), (req, res) => {
    const uid = int(req.query.uid);
    const convs = db.all("SELECT m.user_id, u.nickname, u.phone, MAX(m.id) last_id, COUNT(*) n, SUM(CASE WHEN m.sender='user' THEN 1 ELSE 0 END) un FROM messages m JOIN users u ON u.id=m.user_id GROUP BY m.user_id ORDER BY last_id DESC").map(c => { const l = db.get('SELECT * FROM messages WHERE id=?', c.last_id); c.last = l.content; c.lastSender = l.sender; c.time = l.created_at; return c; });
    const cur = uid ? db.get('SELECT id,nickname,phone FROM users WHERE id=?', uid) : (convs[0] ? { id: convs[0].user_id, nickname: convs[0].nickname, phone: convs[0].phone } : null);
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
    res.page('admin/service', { title: '客服中心', convs, cur, orders, days, msgs: cur ? db.all('SELECT * FROM messages WHERE user_id=? ORDER BY id', cur.id) : [] });
  });
  // 客服根据会话为用户创建售后单
  r.post('/service/:uid/aftersale', need('service'), (req, res) => {
    const uid = int(req.params.uid), back2 = m => { flash(req, 'error', m); res.redirect('/admin/service?uid=' + uid); };
    const o = db.get('SELECT * FROM orders WHERE id=? AND user_id=?', int(req.body.order_id), uid);
    if (!o || !['paid', 'shipped', 'completed'].includes(o.status) || o.type === 'points') return back2('该订单当前不可创建售后');
    if (db.get("SELECT 1 FROM aftersales WHERE order_id=? AND status IN ('pending','approved_return','returned')", o.id)) return back2('该订单已有进行中的售后单');
    const type = req.body.type;
    if (!U.AFTERSALE_TYPE[type]) return back2('请选择售后类型');
    const items = db.all('SELECT product_id FROM order_items WHERE order_id=?', o.id);
    if (type === 'no_reason') {
      const daysSince = o.completed_at ? (Date.now() - U.parseDate(o.completed_at)) / 86400000 : null;
      if (!items.every(i => !i.product_id || svc.noReasonOf(i.product_id))) return back2('该订单含不支持7天无理由退货的商品,请选择「质量问题退换货」或其他类型');
      if (o.status !== 'completed' || daysSince === null || daysSince > 7) return back2('7天无理由退货仅限签收后 7 天内');
    }
    if (type !== 'refund' && o.status === 'paid') return back2('订单尚未发货,请选择「仅退款」');
    const refunded = db.get("SELECT COALESCE(SUM(refund_cash),0) c FROM aftersales WHERE order_id=? AND status='refunded'", o.id).c;
    const max = round2(Math.max(0, o.pay_amount - refunded));
    const amount = round2(num(req.body.amount, max));
    if (amount < 0 || amount > max) return back2(`退款金额需在 0 ~ ${max.toFixed(2)} 之间`);
    const reason = String(req.body.reason || '').trim().slice(0, 50); if (!reason) return back2('请填写售后原因');
    const note = String(req.body.note || '').trim().slice(0, 500);
    const r2 = db.exec1('INSERT INTO aftersales(order_id,user_id,type,reason,description,amount,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', o.id, uid, type, reason, note, amount, 'pending', (req.session.admin.name || req.session.admin.username), now(), now());
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', o.id, now(), `客服已创建售后单(${U.AFTERSALE_TYPE[type]})`);
    svc.notifyService(uid, 'staff', `【售后通知】已为您的订单 ${o.order_no} 创建售后单 #${r2.lastInsertRowid}(${U.AFTERSALE_TYPE[type]},退款金额 ¥${amount.toFixed(2)}),我们会尽快处理,进度可在「我的 - 退款/售后」查看。`);
    log(req, '创建售后单', `#${r2.lastInsertRowid} 订单 ${o.order_no} ${U.AFTERSALE_TYPE[type]} ¥${amount}`);
    flash(req, 'success', `售后单 #${r2.lastInsertRowid} 已创建并通知用户`); res.redirect('/admin/aftersales/' + r2.lastInsertRowid);
  });
  r.post('/service/:uid/reply', need('service'), (req, res) => { const c = String(req.body.content || '').trim().slice(0, 500); if (c && db.get('SELECT 1 FROM users WHERE id=?', int(req.params.uid))) { db.exec1("INSERT INTO messages(user_id,sender,content,created_at) VALUES(?,?,?,?)", int(req.params.uid), 'staff', c, now()); log(req, '客服回复', '#' + req.params.uid); } res.redirect('/admin/service?uid=' + int(req.params.uid)); });

  // ================= 统计报表 =================
  r.get('/stats', need('stats'), (req, res) => {
    const range = [7, 30, 90].includes(int(req.query.days)) ? int(req.query.days) : 30;
    const valid = "status NOT IN ('cancelled','unpaid','refunded')";
    const labels = [], sales = [], orders = [], newUsers = [], uv = [];
    for (let i = range - 1; i >= 0; i--) {
      const d = U.offset(-i * 86400000).slice(0, 10); labels.push(d.slice(5));
      const x = db.get(`SELECT COALESCE(SUM(pay_amount),0) a, COUNT(*) n FROM orders WHERE ${valid} AND paid_at LIKE ?`, d + '%'); sales.push(round2(x.a)); orders.push(x.n);
      newUsers.push(db.get('SELECT COUNT(*) n FROM users WHERE created_at LIKE ?', d + '%').n);
    }
    const salesChart = chart.trend({ labels, series: [{ name: '销售额(元)', color: '#d4202a', values: sales, type: 'bar' }, { name: '订单数', color: '#f2a93b', values: orders, type: 'line' }], width: 900, height: 280 });
    const userChart = chart.trend({ labels, series: [{ name: '新增会员', color: '#2a5bd7', values: newUsers, type: 'bar' }], width: 900, height: 220 });
    const since = U.offset(-range * 86400000).slice(0, 10) + ' 00:00:00';
    const topProducts = db.all(`SELECT oi.name label, SUM(oi.qty) qty, SUM(oi.price*oi.qty) amt FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.${valid.replace(/status/, 'status')} AND o.paid_at>=? GROUP BY oi.name ORDER BY amt DESC LIMIT 10`, since);
    const catSales = db.all(`SELECT COALESCE(c.name,'其他') label, SUM(oi.price*oi.qty) value FROM order_items oi JOIN orders o ON o.id=oi.order_id LEFT JOIN products p ON p.id=oi.product_id LEFT JOIN categories c ON c.id=p.category_id WHERE o.status NOT IN ('cancelled','unpaid','refunded') AND o.paid_at>=? GROUP BY c.name ORDER BY value DESC`, since).map(x => ({ label: x.label, value: Math.round(x.value) }));
    const payDist = db.all(`SELECT pay_method label, COUNT(*) value FROM orders WHERE ${valid} AND paid_at>=? GROUP BY pay_method`, since).map(x => ({ label: U.PAY_METHOD[x.label] || x.label, value: x.value }));
    const levelDist = db.all('SELECT l.name label, COUNT(u.id) value FROM member_levels l LEFT JOIN users u ON u.level_id=l.id GROUP BY l.id ORDER BY l.min_growth');
    const topUsers = db.all(`SELECT u.id, u.nickname, u.phone, SUM(o.pay_amount) amt, COUNT(*) n FROM orders o JOIN users u ON u.id=o.user_id WHERE o.${valid.replace(/status/, 'status')} AND o.paid_at>=? GROUP BY u.id ORDER BY amt DESC LIMIT 8`, since);
    const sum = db.get(`SELECT COALESCE(SUM(pay_amount),0) a, COUNT(*) n FROM orders WHERE ${valid} AND paid_at>=?`, since);
    const conv = { users: db.get('SELECT COUNT(*) n FROM users').n, buyers: db.get(`SELECT COUNT(DISTINCT user_id) n FROM orders WHERE ${valid}`).n, repeat: db.get(`SELECT COUNT(*) n FROM (SELECT user_id FROM orders WHERE ${valid} GROUP BY user_id HAVING COUNT(*)>1)`).n };
    res.page('admin/stats', { title: '统计报表', range, sum, salesChart, userChart, topProducts, catChart: chart.donut(catSales), payChart: chart.donut(payDist), levelChart: chart.hbar(levelDist, { color: '#2a5bd7', unit: '人' }), topUsers, conv });
  });

  // ================= 系统 =================
  r.get('/settings', need('system'), (req, res) => res.page('admin/settings', { title: '站点设置', s: svc.settings() }));
  r.post('/settings', need('system'), (req, res) => {
    const keys = ['shop_name', 'slogan', 'announcement', 'service_phone', 'service_hours', 'service_email', 'address', 'icp', 'points_rate', 'points_max_percent', 'signin_base', 'stock_warn', 'unpaid_cancel_minutes', 'auto_confirm_days', 'aftersale_days', 'register_points', 'review_points'];
    const numeric = ['points_rate', 'points_max_percent', 'signin_base', 'stock_warn', 'unpaid_cancel_minutes', 'auto_confirm_days', 'aftersale_days', 'register_points', 'review_points'];
    if (!String(req.body.shop_name || '').trim()) { flash(req, 'error', '商城名称不能为空'); return res.redirect('/admin/settings'); }
    for (const k of numeric) if (!(num(req.body[k], -1) >= 0)) { flash(req, 'error', '数值类设置需为非负数字'); return res.redirect('/admin/settings'); }
    if (num(req.body.points_rate) < 1) { flash(req, 'error', '积分抵现比例至少为 1'); return res.redirect('/admin/settings'); }
    if (num(req.body.points_max_percent) > 100) { flash(req, 'error', '积分最高抵扣比例不能超过 100%'); return res.redirect('/admin/settings'); }
    for (const k of keys) svc.setSetting(k, String(req.body[k] == null ? '' : req.body[k]).trim().slice(0, 300));
    log(req, '修改站点设置', ''); flash(req, 'success', '设置已保存'); res.redirect('/admin/settings');
  });
  crud(r, { path: 'roles', table: 'roles', perm: 'system', title: '角色权限', singular: '角色',
    cols: [{ label: 'ID', f: x => x.id }, { label: '角色', f: x => '<b>' + esc(x.name) + '</b>' }, { label: '权限', f: x => x.permissions === 'all' ? '<span class="tag">全部权限</span>' : x.permissions.split(',').filter(Boolean).map(p => `<span class="tag gold">${esc(U.PERMS[p] ? U.PERMS[p].split('/')[0] : p)}</span>`).join('') }, { label: '管理员数', f: x => db.get('SELECT COUNT(*) n FROM admins WHERE role_id=?', x.id).n }, { label: '说明', f: x => esc(x.remark) }],
    fields: [{ name: 'name', label: '角色名称', required: true }, { name: 'permissions', label: '权限', type: 'perms' }, { name: 'remark', label: '说明' }],
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
      if (pw) db.exec1('UPDATE admins SET password_hash=? WHERE id=?', bcrypt.hashSync(pw, 10), id);
      log(req, '编辑管理员', username);
    } else {
      if (pw.length < 8) return fail('密码至少 8 位');
      db.exec1('INSERT INTO admins(username,password_hash,name,role_id,status,created_at) VALUES(?,?,?,?,?,?)', username, bcrypt.hashSync(pw, 10), name, int(b.role_id), b.status ? 1 : 0, now()); log(req, '新增管理员', username);
    }
    flash(req, 'success', '管理员已保存'); res.redirect('/admin/admins');
  });
  r.post('/admins/:id/delete', need('system'), (req, res) => {
    const id = int(req.params.id);
    if (id === req.session.admin.id) flash(req, 'error', '不能删除自己'); else { db.exec1('DELETE FROM admins WHERE id=?', id); log(req, '删除管理员', '#' + id); flash(req, 'success', '已删除'); }
    res.redirect('/admin/admins');
  });
  r.get('/password', need(null), (req, res) => res.page('admin/password', { title: '修改密码' }));
  r.post('/password', need(null), (req, res) => {
    const a = db.get('SELECT * FROM admins WHERE id=?', req.session.admin.id);
    if (!bcrypt.compareSync(String(req.body.old_password || ''), a.password_hash)) flash(req, 'error', '原密码错误');
    else if (String(req.body.password || '').length < 8) flash(req, 'error', '新密码至少 8 位');
    else if (req.body.password !== req.body.password2) flash(req, 'error', '两次输入不一致');
    else { db.exec1('UPDATE admins SET password_hash=? WHERE id=?', bcrypt.hashSync(req.body.password, 10), a.id); log(req, '修改自己的密码', ''); flash(req, 'success', '密码已修改'); }
    res.redirect('/admin/password');
  });
  r.get('/logs', need('system'), (req, res) => {
    const q = String(req.query.q || '').trim(), where = ['1=1'], params = []; if (q) { where.push('(admin_name LIKE ? OR action LIKE ? OR detail LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    res.page('admin/logs', { title: '操作日志', pg: U.paginate(`SELECT * FROM admin_logs WHERE ${where.join(' AND ')} ORDER BY id DESC`, params, req.query.page, 25), q });
  });
  r.get('/logs/export', need('stats'), (req, res) => sendCSV(res, '操作日志', ['时间', '管理员', '操作', '详情', 'IP'], db.all('SELECT * FROM admin_logs ORDER BY id DESC LIMIT 5000').map(l => [l.created_at, l.admin_name, l.action, l.detail, l.ip])));
};
