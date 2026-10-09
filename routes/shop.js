const bcrypt = require('bcryptjs');
const db = require('../lib/db');
const U = require('../lib/util');
const svc = require('../lib/svc');
const regions = require('../lib/regions');
const { now, int, num, round2 } = U;

module.exports = function (app, { filesOf }) {
  const flash = (req, type, msg) => { req.session.flash = { type, msg }; };
  const safeNext = n => (typeof n === 'string' && /^\/(?!\/)/.test(n) ? n : '/me');
  const needLogin = (req, res, next) => {
    if (!req.user) { if (req.method === 'GET') return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl)); if (req.xhr || req.headers.accept === 'application/json' || (req.headers['content-type'] || '').includes('json')) return res.status(401).json({ ok: false, msg: '请先登录', login: true }); return res.redirect('/login'); }
    next();
  };
  const wantsJson = req => req.headers.accept && req.headers.accept.includes('application/json');
  const back = (req, res, fb) => res.redirect(req.get('referer') && req.get('referer').startsWith(req.protocol + '://' + req.get('host')) ? req.get('referer') : fb);
  const prodCard = 'SELECT p.*, b.name brand_name FROM products p LEFT JOIN brands b ON b.id=p.brand_id';
  const withImg = rows => rows.map(r => ({ ...r, img: U.firstImg(r.images) }));
  const catIds = cid => { const subs = db.all('SELECT id FROM categories WHERE parent_id=?', cid).map(r => r.id); return [cid, ...subs]; };

  // ---------------- 首页 ----------------
  app.get('/', (req, res) => {
    const t = now();
    const banners = db.all('SELECT * FROM banners WHERE status=1 ORDER BY sort,id');
    const seckills = db.all(`SELECT s.*, p.name, p.images, p.market_price FROM seckills s JOIN products p ON p.id=s.product_id WHERE s.status=1 AND p.status=1 AND s.end_at>=? ORDER BY s.start_at LIMIT 4`, t).map(s => ({ ...s, img: U.firstImg(s.images), live: s.start_at <= t }));
    const hot = withImg(db.all(`${prodCard} WHERE p.status=1 AND p.is_hot=1 ORDER BY p.sales DESC LIMIT 8`));
    const fresh = withImg(db.all(`${prodCard} WHERE p.status=1 AND p.is_new=1 ORDER BY p.created_at DESC LIMIT 8`));
    const groups = withImg(db.all(`SELECT g.*, p.name, p.images, p.market_price FROM groupbuys g JOIN products p ON p.id=g.product_id WHERE g.status=1 AND p.status=1 LIMIT 4`));
    const notices = db.all("SELECT * FROM articles WHERE category='notice' AND status=1 ORDER BY id DESC LIMIT 4");
    const brands = db.all('SELECT * FROM brands WHERE status=1 ORDER BY sort LIMIT 8');
    const coupons = db.all('SELECT * FROM coupons WHERE status=1 AND claimed<total ORDER BY id LIMIT 4');
    res.page('shop/home', { title: '首页', banners, seckills, hot, fresh, groups, notices, brands, coupons });
  });

  // ---------------- 商品列表 ----------------
  app.get('/products', (req, res) => {
    const { q = '', cat = '', brand = '', sort = '', min = '', max = '' } = req.query;
    const where = ['p.status=1'], params = [];
    if (q.trim()) {
      where.push('(p.name LIKE ? OR p.subtitle LIKE ? OR b.name LIKE ?)'); const k = '%' + q.trim().replace(/[%_]/g, '') + '%'; params.push(k, k, k);
      if (db.get('SELECT 1 FROM keywords WHERE word=?', q.trim())) db.exec1('UPDATE keywords SET hits=hits+1 WHERE word=?', q.trim());
      else if (q.trim().length <= 20) db.exec1('INSERT INTO keywords(word,hits,is_hot) VALUES(?,1,0)', q.trim());
    }
    let curCat = null;
    if (cat) { curCat = db.get('SELECT * FROM categories WHERE id=?', int(cat)); const ids = catIds(int(cat)); where.push(`p.category_id IN (${ids.join(',')})`); }
    if (brand) { where.push('p.brand_id=?'); params.push(int(brand)); }
    if (min !== '') { where.push('p.price>=?'); params.push(num(min)); }
    if (max !== '') { where.push('p.price<=?'); params.push(num(max, 1e9)); }
    const order = { sales: 'p.sales DESC', price_asc: 'p.price ASC', price_desc: 'p.price DESC', new: 'p.created_at DESC' }[sort] || 'p.sort DESC, p.id ASC';
    const pg = U.paginate(`${prodCard} WHERE ${where.join(' AND ')} ORDER BY ${order}`, params, req.query.page, 12);
    pg.rows = withImg(pg.rows);
    const subCats = curCat ? db.all('SELECT * FROM categories WHERE parent_id=? AND status=1 ORDER BY sort', curCat.parent_id || curCat.id) : [];
    const brands = db.all('SELECT * FROM brands WHERE status=1 ORDER BY sort');
    res.page('shop/products', { title: q ? `搜索「${q}」` : (curCat ? curCat.name : '全部商品'), pg, q, cat, brand, sort, min, max, curCat, subCats, brands });
  });

  // ---------------- 商品详情 ----------------
  app.get('/product/:id', (req, res, next) => {
    const p = db.get(`${prodCard} WHERE p.id=?`, int(req.params.id));
    if (!p || (!p.status && !req.query.preview)) return res.status(404).page('shop/error', { title: '商品不存在', code: 404, message: '该商品不存在或已下架' });
    const images = U.jsonArr(p.images);
    const skus = db.all('SELECT * FROM skus WHERE product_id=? ORDER BY id', p.id).map(s => ({ ...s, attrs: JSON.parse(s.attrs || '{}') }));
    const specNames = p.spec_names ? p.spec_names.split(',').filter(Boolean) : [];
    const specs = specNames.map(n => ({ name: n, values: [...new Set(skus.map(s => s.attrs[n]).filter(Boolean))] }));
    const t = now();
    const seckill = db.get('SELECT * FROM seckills WHERE product_id=? AND status=1 AND end_at>=? ORDER BY start_at LIMIT 1', p.id, t);
    if (seckill) seckill.live = seckill.start_at <= t;
    const groupbuy = db.get('SELECT * FROM groupbuys WHERE product_id=? AND status=1', p.id);
    const openGroups = groupbuy ? db.all(`SELECT g.*, u.nickname FROM groups g JOIN users u ON u.id=g.leader_id WHERE g.groupbuy_id=? AND g.status='open' AND g.expire_at>? ORDER BY g.expire_at LIMIT 3`, groupbuy.id, t) : [];
    const rv = req.query.rv || 'all';
    let rvWhere = "r.product_id=? AND r.status='approved'";
    if (rv === 'good') rvWhere += ' AND r.rating>=4'; else if (rv === 'bad') rvWhere += ' AND r.rating<=3';
    const reviews = db.all(`SELECT r.*, u.nickname, u.phone FROM reviews r JOIN users u ON u.id=r.user_id WHERE ${rvWhere} ORDER BY r.id DESC LIMIT 30`, p.id).map(r => ({ ...r, nick: r.nickname.slice(0, 1) + '***' + r.nickname.slice(-1) }));
    const rs = db.get("SELECT COUNT(*) n, COALESCE(AVG(rating),5) avg, SUM(rating>=4) good FROM reviews WHERE product_id=? AND status='approved'", p.id);
    const related = withImg(db.all(`${prodCard} WHERE p.status=1 AND p.category_id=? AND p.id!=? LIMIT 4`, p.category_id, p.id));
    const brand = db.get('SELECT * FROM brands WHERE id=?', p.brand_id);
    const category = db.get('SELECT c.*, pc.name parent_name, pc.id parent_cid FROM categories c LEFT JOIN categories pc ON pc.id=c.parent_id WHERE c.id=?', p.category_id);
    const tpl = db.get('SELECT * FROM shipping_templates WHERE id=?', p.template_id);
    let faved = false;
    if (req.user) {
      faved = !!db.get('SELECT 1 FROM favorites WHERE user_id=? AND product_id=?', req.user.id, p.id);
      db.exec1('INSERT OR REPLACE INTO history(user_id,product_id,viewed_at) VALUES(?,?,?)', req.user.id, p.id, now());
    }
    res.page('shop/product', { title: p.name, p, images, skus, specs, seckill, groupbuy, openGroups, reviews, rs, rv, related, brand, category, tpl, faved, noReason: svc.noReasonOf(p.id) });
  });

  app.post('/favorite/:id', needLogin, (req, res) => {
    const pid = int(req.params.id);
    const has = db.get('SELECT 1 FROM favorites WHERE user_id=? AND product_id=?', req.user.id, pid);
    if (has) db.exec1('DELETE FROM favorites WHERE user_id=? AND product_id=?', req.user.id, pid);
    else if (db.get('SELECT 1 FROM products WHERE id=?', pid)) db.exec1('INSERT INTO favorites VALUES(?,?,?)', req.user.id, pid, now());
    if (wantsJson(req)) return res.json({ ok: true, faved: !has });
    back(req, res, '/me/favorites');
  });

  // ---------------- 购物车 ----------------
  app.get('/cart', needLogin, (req, res) => {
    const items = db.all(`SELECT c.id, c.qty, s.id sku_id, s.spec_text, s.price, s.stock, p.id pid, p.name, p.images, p.status FROM cart c JOIN skus s ON s.id=c.sku_id JOIN products p ON p.id=s.product_id WHERE c.user_id=? ORDER BY c.id DESC`, req.user.id).map(i => ({ ...i, img: U.firstImg(i.images), ok: i.status && i.stock > 0 }));
    res.page('shop/cart', { title: '购物车', items });
  });
  app.post('/cart/add', needLogin, (req, res) => {
    const skuId = int(req.body.sku_id), qty = Math.max(1, int(req.body.qty, 1));
    const sku = db.get('SELECT s.*, p.status FROM skus s JOIN products p ON p.id=s.product_id WHERE s.id=?', skuId);
    const fail = m => wantsJson(req) ? res.json({ ok: false, msg: m }) : (flash(req, 'error', m), back(req, res, '/cart'));
    if (!sku || !sku.status) return fail('商品不存在或已下架');
    if (!svc.noReasonOf(sku.product_id) && req.body.no7_ok !== '1') return wantsJson(req) ? res.json({ ok: false, no7: true, msg: '本商品不支持7天无理由退货,请确认知晓后再加入购物车' }) : fail('本商品不支持7天无理由退货,请勾选「我已知晓」后再加入购物车');
    const cur = db.get('SELECT qty FROM cart WHERE user_id=? AND sku_id=?', req.user.id, skuId);
    const nq = (cur ? cur.qty : 0) + qty;
    if (nq > sku.stock) return fail(`库存不足,当前仅剩 ${sku.stock} 件`);
    db.exec1('INSERT INTO cart(user_id,sku_id,qty,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,sku_id) DO UPDATE SET qty=?', req.user.id, skuId, qty, now(), nq);
    const count = db.get('SELECT COALESCE(SUM(qty),0) n FROM cart WHERE user_id=?', req.user.id).n;
    if (wantsJson(req)) return res.json({ ok: true, count, msg: '已加入购物车' });
    flash(req, 'success', '已加入购物车'); back(req, res, '/cart');
  });
  app.post('/cart/update', needLogin, (req, res) => {
    const c = db.get('SELECT c.*, s.stock FROM cart c JOIN skus s ON s.id=c.sku_id WHERE c.id=? AND c.user_id=?', int(req.body.id), req.user.id);
    if (!c) return res.json({ ok: false, msg: '购物车项不存在' });
    const qty = Math.min(Math.max(1, int(req.body.qty, 1)), Math.max(1, c.stock));
    db.exec1('UPDATE cart SET qty=? WHERE id=?', qty, c.id);
    res.json({ ok: true, qty, limited: qty < int(req.body.qty, 1) });
  });
  app.post('/cart/remove', needLogin, (req, res) => {
    const ids = [].concat(req.body.id || []).map(int);
    for (const id of ids) db.exec1('DELETE FROM cart WHERE id=? AND user_id=?', id, req.user.id);
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect('/cart');
  });

  // ---------------- 结算 ----------------
  function parseCheckout(req) {
    const b = req.body;
    let items = [], fromCart = false, promo = null;
    if (b.items) { try { items = JSON.parse(b.items).map(i => ({ sku_id: int(i.sku_id), qty: int(i.qty, 1) })); } catch (e) { items = []; } }
    else if (b.cart_id) { fromCart = true; const ids = [].concat(b.cart_id).map(int); items = ids.map(id => db.get('SELECT sku_id, qty FROM cart WHERE id=? AND user_id=?', id, req.user.id)).filter(Boolean); }
    else if (b.sku_id) items = [{ sku_id: int(b.sku_id), qty: int(b.qty, 1) }];
    if (b.from_cart === '1') fromCart = true;
    if (b.promo_type === 'seckill' || b.promo_type === 'group') promo = { type: b.promo_type, id: int(b.promo_id), groupId: int(b.group_id) || null };
    return { items, fromCart, promo };
  }
  const myAddrs = uid => db.all('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id DESC', uid);
  app.post('/checkout', needLogin, (req, res) => {
    const { items, fromCart, promo } = parseCheckout(req);
    if (!items.length) { flash(req, 'error', '请先选择要结算的商品'); return res.redirect('/cart'); }
    const addrs = myAddrs(req.user.id);
    const a0 = addrs[0];
    const q = svc.quote(req.user.id, { items, promo, address: a0 });
    if (q.error) { flash(req, 'error', q.error); return back(req, res, '/cart'); }
    const coupons = svc.userCoupons(req.user.id, 'unused').filter(c => !promo && q.goods >= c.threshold);
    const no7Items = q.lines.filter(l => !svc.noReasonOf(l.product_id));
    res.page('shop/checkout', { title: '确认订单', items, fromCart, promo, q, addrs, coupons, no7Items });
  });
  app.post('/api/quote', needLogin, (req, res) => {
    const { items, promo } = parseCheckout(req);
    const a = db.get('SELECT * FROM addresses WHERE id=? AND user_id=?', int(req.body.address_id), req.user.id) || (req.body.province ? { province: req.body.province } : null);
    const q = svc.quote(req.user.id, { items, promo, address: a, couponId: int(req.body.coupon_id), usePoints: int(req.body.use_points) });
    if (q.error) return res.json({ ok: false, msg: q.error });
    res.json({ ok: true, goods: q.goods, freight: q.freight, levelDiscount: q.levelDiscount, couponDiscount: q.couponDiscount, pointsDiscount: q.pointsDiscount, pointsUsed: q.pointsUsed, pay: q.pay, maxPoints: q.maxPoints });
  });
  function readAddress(req) {
    const b = req.body;
    if (b.address_id && b.address_id !== 'new') return db.get('SELECT * FROM addresses WHERE id=? AND user_id=?', int(b.address_id), req.user.id);
    return validateAddress(b, 'new_');
  }
  function validateAddress(b, pre = '') {
    const a = { name: String(b[pre + 'name'] || '').trim(), phone: String(b[pre + 'phone'] || '').trim(), province: b[pre + 'province'], city: b[pre + 'city'], district: b[pre + 'district'], detail: String(b[pre + 'detail'] || '').trim() };
    if (!a.name || !U.isPhone(a.phone) || !a.province || !a.city || !a.district || !a.detail) return null;
    if (!regions[a.province] || !regions[a.province][a.city] || !regions[a.province][a.city].includes(a.district)) return null;
    return a;
  }
  app.post('/order/create', needLogin, (req, res) => {
    const { items, fromCart, promo } = parseCheckout(req);
    const addr = readAddress(req);
    if (!addr) { flash(req, 'error', '请选择或正确填写收货地址(姓名、手机号、省市区、详细地址)'); return back(req, res, '/cart'); }
    if (req.body.address_id === 'new' && req.body.save_addr) {
      const has = db.get('SELECT COUNT(*) n FROM addresses WHERE user_id=?', req.user.id).n;
      db.exec1('INSERT INTO addresses(user_id,name,phone,province,city,district,detail,is_default) VALUES(?,?,?,?,?,?,?,?)', req.user.id, addr.name, addr.phone, addr.province, addr.city, addr.district, addr.detail, has ? 0 : 1);
    }
    const r = svc.createOrder(req.user.id, { items, promo, address: addr, couponId: int(req.body.coupon_id), usePoints: int(req.body.use_points), remark: req.body.remark, no7Confirmed: req.body.no7_confirm === '1' });
    if (!r.ok) { flash(req, 'error', r.msg); return res.redirect('/cart'); }
    if (fromCart) for (const i of items) db.exec1('DELETE FROM cart WHERE user_id=? AND sku_id=?', req.user.id, i.sku_id);
    res.redirect('/order/' + r.id + '/pay');
  });

  // ---------------- 订单 ----------------
  const myOrder = (req, id) => db.get('SELECT * FROM orders WHERE id=? AND user_id=?', int(id), req.user.id);
  app.get('/orders', needLogin, (req, res) => {
    const st = req.query.status || '';
    const where = ['o.user_id=?'], params = [req.user.id];
    if (st === 'aftersale') where.push("o.status IN ('refunded') OR EXISTS(SELECT 1 FROM aftersales a WHERE a.order_id=o.id)"); else if (st) { where.push('o.status=?'); params.push(st); }
    const pg = U.paginate(`SELECT o.* FROM orders o WHERE ${where.map(w => '(' + w + ')').join(' AND ')} ORDER BY o.id DESC`, params, req.query.page, 8);
    pg.rows.forEach(o => { o.items = db.all('SELECT * FROM order_items WHERE order_id=?', o.id); });
    const counts = {}; for (const r of db.all('SELECT status, COUNT(*) n FROM orders WHERE user_id=? GROUP BY status', req.user.id)) counts[r.status] = r.n;
    res.page('shop/orders', { title: '我的订单', pg, st, counts });
  });
  // 可联系客服申请售后:已付款/已发货/已完成(完成后 N 天内),非积分兑换单,且无进行中的售后
  function canAftersale(o) {
    if (!o || o.type === 'points' || !['paid', 'shipped', 'completed'].includes(o.status)) return false;
    const days = int(svc.S('aftersale_days'), 7);
    if (o.status === 'completed' && U.parseDate(o.completed_at) < new Date(Date.now() - Math.max(days, 15) * 86400000)) return false;
    return !db.get("SELECT 1 FROM aftersales WHERE order_id=? AND status NOT IN ('rejected','cancelled')", o.id);
  }
  app.locals.canAftersale = canAftersale;
  app.get('/order/:id', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id);
    if (!o) return res.status(404).page('shop/error', { title: '订单不存在', code: 404, message: '订单不存在' });
    const items = db.all('SELECT * FROM order_items WHERE order_id=?', o.id);
    const traces = db.all('SELECT * FROM traces WHERE order_id=? ORDER BY id DESC', o.id);
    const aftersale = db.get('SELECT * FROM aftersales WHERE order_id=? ORDER BY id DESC LIMIT 1', o.id);
    const invoice = db.get('SELECT * FROM invoices WHERE order_id=?', o.id);
    const group = o.group_id ? db.get('SELECT * FROM groups WHERE id=?', o.group_id) : null;
    const expireAt = o.status === 'unpaid' ? U.fmtDate(new Date(U.parseDate(o.created_at).getTime() + int(svc.S('unpaid_cancel_minutes'), 30) * 60000)) : null;
    res.page('shop/order', { title: '订单详情', o, items, traces, aftersale, invoice, group, expireAt, canAfter: canAftersale(o) });
  });
  app.get('/order/:id/pay', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id);
    if (!o) return res.redirect('/orders');
    if (o.status !== 'unpaid') return res.redirect('/order/' + o.id);
    res.page('shop/pay', { title: '收银台(模拟)', o });
  });
  app.post('/order/:id/pay', needLogin, (req, res) => {
    // 前台仅支持模拟微信/支付宝支付,余额支付已下线
    if (!['wechat', 'alipay'].includes(req.body.method)) { flash(req, 'error', '请选择微信支付或支付宝(模拟)'); return res.redirect('/order/' + int(req.params.id) + '/pay'); }
    const r = svc.payOrder(int(req.params.id), req.user.id, req.body.method);
    if (!r.ok) { flash(req, 'error', r.msg); return res.redirect('/order/' + int(req.params.id) + '/pay'); }
    flash(req, 'success', '支付成功(模拟支付,未产生真实扣款)'); res.redirect('/order/' + int(req.params.id) + '?paid=1');
  });
  app.post('/order/:id/cancel', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id); if (!o) return res.redirect('/orders');
    const r = svc.cancelOrder(o.id, '用户取消'); flash(req, r.ok ? 'success' : 'error', r.ok ? '订单已取消' : r.msg); res.redirect('/order/' + o.id);
  });
  app.post('/order/:id/confirm', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id); if (!o) return res.redirect('/orders');
    const r = svc.completeOrder(o.id); flash(req, r.ok ? 'success' : 'error', r.ok ? '已确认收货,积分与成长值已到账' : r.msg); res.redirect('/order/' + o.id);
  });
  app.post('/order/:id/rebuy', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id); if (!o) return res.redirect('/orders');
    for (const it of db.all('SELECT * FROM order_items WHERE order_id=? AND sku_id IS NOT NULL', o.id)) {
      const s = db.get('SELECT s.stock FROM skus s JOIN products p ON p.id=s.product_id WHERE s.id=? AND p.status=1', it.sku_id);
      if (s && s.stock > 0) db.exec1('INSERT INTO cart(user_id,sku_id,qty,created_at) VALUES(?,?,?,?) ON CONFLICT(user_id,sku_id) DO UPDATE SET qty=MIN(qty+?,?)', req.user.id, it.sku_id, 1, now(), 1, s.stock);
    }
    res.redirect('/cart');
  });
  app.get('/order/:id/logistics', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id); if (!o) return res.redirect('/orders');
    const traces = db.all('SELECT * FROM traces WHERE order_id=? ORDER BY id DESC', o.id);
    res.page('shop/logistics', { title: '物流跟踪', o, traces, items: db.all('SELECT * FROM order_items WHERE order_id=?', o.id) });
  });
  app.post('/order/:id/logistics/simulate', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id); if (o) svc.advanceTrace(o.id);
    res.redirect('/order/' + int(req.params.id) + '/logistics');
  });

  // 评价
  app.get('/order/:id/review', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id);
    if (!o || o.status !== 'completed') { flash(req, 'error', '仅已完成订单可评价'); return res.redirect('/orders'); }
    res.page('shop/review', { title: '评价晒单', o, items: db.all('SELECT * FROM order_items WHERE order_id=? AND product_id IS NOT NULL', o.id) });
  });
  app.post('/order/:id/review', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id);
    if (!o || o.status !== 'completed') { flash(req, 'error', '仅已完成订单可评价'); return res.redirect('/orders'); }
    let n = 0;
    for (const it of db.all('SELECT * FROM order_items WHERE order_id=? AND reviewed=0 AND product_id IS NOT NULL', o.id)) {
      const content = String(req.body['content_' + it.id] || '').trim().slice(0, 500);
      if (!content) continue;
      const rating = Math.min(5, Math.max(1, int(req.body['rating_' + it.id], 5)));
      db.exec1('INSERT INTO reviews(product_id,order_id,order_item_id,user_id,rating,content,status,created_at) VALUES(?,?,?,?,?,?,?,?)', it.product_id, o.id, it.id, req.user.id, rating, content, 'pending', now());
      db.exec1('UPDATE order_items SET reviewed=1 WHERE id=?', it.id); n++;
    }
    flash(req, n ? 'success' : 'error', n ? '评价已提交,审核通过后展示并奖励积分' : '请至少填写一条评价内容');
    res.redirect(n ? '/me/reviews' : '/order/' + o.id + '/review');
  });
  app.get('/me/reviews', needLogin, (req, res) => {
    const rows = db.all('SELECT r.*, p.name pname, p.images pimages FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.user_id=? ORDER BY r.id DESC', req.user.id).map(r => ({ ...r, pimg: U.firstImg(r.pimages) }));
    res.page('shop/me-reviews', { title: '我的评价', rows });
  });

  // 售后
  // 售后统一走客服:用户点击「联系客服申请售后」→ 自动向客服会话发送订单信息,由客服在后台创建售后单
  app.get('/order/:id/aftersale', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id);
    const ex = o && db.get("SELECT id FROM aftersales WHERE order_id=? AND status NOT IN ('rejected','cancelled') ORDER BY id DESC", o.id);
    res.redirect(ex ? '/aftersale/' + ex.id : o ? '/order/' + o.id : '/orders');
  });
  app.post('/order/:id/aftersale', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id);
    if (!canAftersale(o)) { flash(req, 'error', '该订单当前不可申请售后'); return o ? res.redirect('/order/' + o.id) : res.redirect('/orders'); }
    const items = db.all('SELECT name, spec_text, qty FROM order_items WHERE order_id=?', o.id).map(i => `${i.name}${i.spec_text ? '(' + i.spec_text + ')' : ''} ×${i.qty}`).join('、');
    const recent = db.get("SELECT 1 FROM messages WHERE user_id=? AND sender='user' AND content LIKE ? AND created_at>?", req.user.id, '我要申请售后:订单号 ' + o.order_no + '%', U.offset(-600000));
    if (!recent) {
      svc.notifyService(req.user.id, 'user', `我要申请售后:订单号 ${o.order_no},商品:${items},实付 ¥${o.pay_amount.toFixed(2)}`);
      db.exec1('INSERT INTO messages(user_id,sender,content,created_at,is_read) VALUES(?,?,?,?,1)', req.user.id, 'bot', '【智能助手】已收到您的售后申请,客服核实订单后会为您创建售后单。请在下方补充说明问题(如:退货原因、商品情况),售后进度可在「我的 - 退款/售后」查看。', now());
    }
    res.redirect('/service#end');
  });
  app.get('/aftersales', needLogin, (req, res) => {
    const rows = db.all('SELECT a.*, o.order_no FROM aftersales a JOIN orders o ON o.id=a.order_id WHERE a.user_id=? ORDER BY a.id DESC', req.user.id);
    res.page('shop/aftersales', { title: '退款/售后', rows });
  });
  app.get('/aftersale/:id', needLogin, (req, res) => {
    const a = db.get('SELECT a.*, o.order_no, o.points_used, o.pay_amount FROM aftersales a JOIN orders o ON o.id=a.order_id WHERE a.id=? AND a.user_id=?', int(req.params.id), req.user.id);
    if (!a) return res.redirect('/aftersales');
    res.page('shop/aftersale', { title: '售后详情', a, items: db.all('SELECT * FROM order_items WHERE order_id=?', a.order_id) });
  });
  app.post('/aftersale/:id/return', needLogin, (req, res) => {
    const co = String(req.body.company || '').slice(0, 30), tn = String(req.body.tracking || '').trim().slice(0, 40);
    if (!co || !tn) { flash(req, 'error', '请填写退货快递公司与运单号'); return res.redirect('/aftersale/' + int(req.params.id)); }
    db.exec1("UPDATE aftersales SET status='returned', return_express=?, return_tracking=?, updated_at=? WHERE id=? AND user_id=? AND status='approved_return'", co, tn, now(), int(req.params.id), req.user.id);
    const a = db.get('SELECT a.id, o.order_no FROM aftersales a JOIN orders o ON o.id=a.order_id WHERE a.id=? AND a.user_id=?', int(req.params.id), req.user.id);
    if (a) svc.notifyService(req.user.id, 'user', `售后单 #${a.id}(订单号 ${a.order_no})退货已寄出:${co} ${tn}`);
    flash(req, 'success', '退货信息已提交,等待商家收货确认'); res.redirect('/aftersale/' + int(req.params.id));
  });

  // 发票
  app.post('/order/:id/invoice', needLogin, (req, res) => {
    const o = myOrder(req, req.params.id);
    if (!o || !['paid', 'shipped', 'completed'].includes(o.status)) { flash(req, 'error', '该订单暂不可开票'); return res.redirect('/orders'); }
    if (db.get('SELECT 1 FROM invoices WHERE order_id=?', o.id)) { flash(req, 'error', '该订单已申请过发票'); return res.redirect('/order/' + o.id); }
    const type = req.body.type === 'company' ? 'company' : 'personal';
    const title = String(req.body.title || '').trim().slice(0, 60), tax = String(req.body.tax_no || '').trim().toUpperCase().slice(0, 30), email = String(req.body.email || '').trim().slice(0, 60);
    if (!title || !/^\S+@\S+\.\S+$/.test(email) || (type === 'company' && !/^[0-9A-Z]{15,20}$/.test(tax))) { flash(req, 'error', '请正确填写发票抬头、邮箱(企业需填写15-20位税号)'); return res.redirect('/order/' + o.id); }
    db.exec1('INSERT INTO invoices(order_id,user_id,type,title,tax_no,email,amount,created_at) VALUES(?,?,?,?,?,?,?,?)', o.id, req.user.id, type, title, type === 'company' ? tax : '', email, o.pay_amount, now());
    flash(req, 'success', '发票申请已提交,请等待开具'); res.redirect('/order/' + o.id);
  });

  // ---------------- 登录 / 注册 / 短信 ----------------
  const fails = new Map();
  const tooMany = k => { const f = fails.get(k); return f && f.n >= 8 && Date.now() - f.t < 600000; };
  const addFail = k => { const f = fails.get(k); if (!f || Date.now() - f.t > 600000) fails.set(k, { n: 1, t: Date.now() }); else f.n++; };
  const doLogin = (req, res, id, next) => {
    req.session.regenerate(err => {
      req.session.uid = id; db.exec1('UPDATE users SET last_login=? WHERE id=?', now(), id);
      req.session.save(() => res.redirect(safeNext(next)));
    });
  };
  app.get('/login', (req, res) => req.user ? res.redirect('/me') : res.page('shop/login', { title: '登录', next: req.query.next || '', tab: req.query.tab || 'pwd', phone: '' }));
  app.post('/login', (req, res) => {
    const phone = String(req.body.phone || '').trim(), k = req.ip + phone;
    const u = db.get('SELECT * FROM users WHERE phone=?', phone);
    const err = m => { res.locals.flash = { type: 'error', msg: m }; res.page('shop/login', { title: '登录', next: req.body.next, tab: 'pwd', phone }); };
    if (tooMany(k)) return err('尝试次数过多,请 10 分钟后再试');
    if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.password_hash)) { addFail(k); return err('手机号或密码错误'); }
    if (!u.status) return err(u.cancelled_at ? '该账号已注销' : '该账号已被禁用,请联系客服');
    fails.delete(k); doLogin(req, res, u.id, req.body.next);
  });
  app.post('/sms/send', (req, res) => {
    const phone = String(req.body.phone || '').trim();
    if (!U.isPhone(phone)) return res.json({ ok: false, msg: '请输入正确的 11 位手机号' });
    const last = db.get('SELECT created_at FROM sms_codes WHERE phone=? ORDER BY id DESC LIMIT 1', phone);
    if (last && Date.now() - U.parseDate(last.created_at) < 30000) return res.json({ ok: false, msg: '发送过于频繁,请稍后再试' });
    const code = U.randCode(6);
    db.exec1('INSERT INTO sms_codes(phone,code,purpose,created_at) VALUES(?,?,?,?)', phone, code, req.body.purpose || 'login', now());
    res.json({ ok: true, msg: '验证码已发送(演示环境:不会真实发送短信)', demoCode: code });
  });
  app.post('/login/sms', (req, res) => {
    const phone = String(req.body.phone || '').trim(), code = String(req.body.code || '').trim(), k = 'sms' + req.ip + phone;
    const err = m => { res.locals.flash = { type: 'error', msg: m }; res.page('shop/login', { title: '登录', next: req.body.next, tab: 'sms', phone }); };
    if (tooMany(k)) return err('尝试次数过多,请稍后再试');
    const row = db.get("SELECT * FROM sms_codes WHERE phone=? AND used=0 ORDER BY id DESC LIMIT 1", phone);
    if (!U.isPhone(phone) || !row || row.code !== code || U.parseDate(row.created_at) < Date.now() - 300000) { addFail(k); return err('验证码错误或已过期'); }
    if (!db.get('SELECT 1 FROM users WHERE phone=?', phone) && req.body.agree !== '1') return err('新用户需先阅读并勾选同意《用户协议》《隐私政策》');
    db.exec1('UPDATE sms_codes SET used=1 WHERE id=?', row.id);
    let u = db.get('SELECT * FROM users WHERE phone=?', phone);
    if (!u) { const id = svc.createUser({ phone, password_hash: bcrypt.hashSync(U.randCode(12), 10), consent: true }); u = { id, status: 1 }; }
    if (!u.status) return err('该账号已被禁用,请联系客服');
    doLogin(req, res, u.id, req.body.next);
  });
  app.get('/register', (req, res) => res.page('shop/register', { title: '注册', ref: req.query.ref || '', form: {} }));
  app.post('/register', (req, res) => {
    const f = { phone: String(req.body.phone || '').trim(), nickname: String(req.body.nickname || '').trim().slice(0, 20), ref: String(req.body.ref || '').trim() };
    const err = m => { res.locals.flash = { type: 'error', msg: m }; res.page('shop/register', { title: '注册', ref: f.ref, form: f }); };
    if (!U.isPhone(f.phone)) return err('请输入正确的 11 位手机号');
    const pw = String(req.body.password || '');
    if (pw.length < 6 || pw.length > 32) return err('密码长度需为 6-32 位');
    if (pw !== req.body.password2) return err('两次输入的密码不一致');
    if (req.body.agree !== '1') return err('请先阅读并勾选同意《用户协议》《隐私政策》');
    if (db.get('SELECT 1 FROM users WHERE phone=?', f.phone)) return err('该手机号已注册,请直接登录');
    const id = svc.createUser({ phone: f.phone, password_hash: bcrypt.hashSync(pw, 10), nickname: f.nickname, referrerCode: f.ref, consent: true });
    req.session.regenerate(() => { req.session.uid = id; req.session.flash = { type: 'success', msg: '注册成功!已赠送新人积分与新人优惠券' }; req.session.save(() => res.redirect('/me')); });
  });
  app.post('/logout', (req, res) => { req.session.regenerate(() => res.redirect('/')); });

  // ---------------- 会员中心 ----------------
  app.get('/me', needLogin, (req, res) => {
    const u = req.user;
    const cnt = {}; for (const r of db.all('SELECT status, COUNT(*) n FROM orders WHERE user_id=? GROUP BY status', u.id)) cnt[r.status] = r.n;
    const next = db.get('SELECT * FROM member_levels WHERE min_growth>? ORDER BY min_growth LIMIT 1', u.growth);
    const prev = db.get('SELECT * FROM member_levels WHERE id=?', u.level_id);
    const stats = { coupons: svc.userCoupons(u.id, 'unused').length, favs: db.get('SELECT COUNT(*) n FROM favorites WHERE user_id=?', u.id).n, hist: db.get('SELECT COUNT(*) n FROM history WHERE user_id=?', u.id).n, as: db.get("SELECT COUNT(*) n FROM aftersales WHERE user_id=? AND status IN ('pending','approved_return','returned')", u.id).n };
    const recent = db.all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 3', u.id).map(o => ({ ...o, items: db.all('SELECT * FROM order_items WHERE order_id=?', o.id) }));
    const today = U.today();
    res.page('shop/me', { title: '会员中心', cnt, next, prev, stats, recent, signed: u.last_signin === today });
  });
  app.post('/me/profile', needLogin, (req, res) => {
    const nick = String(req.body.nickname || '').trim().slice(0, 20) || req.user.nickname;
    const g = ['男', '女', '保密'].includes(req.body.gender) ? req.body.gender : '保密';
    db.exec1('UPDATE users SET nickname=?, gender=? WHERE id=?', nick, g, req.user.id);
    flash(req, 'success', '资料已保存'); res.redirect('/me/profile');
  });
  app.get('/me/profile', needLogin, (req, res) => res.page('shop/profile', { title: '个人资料' }));
  app.post('/me/password', needLogin, (req, res) => {
    const { old_password, password, password2 } = req.body;
    if (!bcrypt.compareSync(String(old_password || ''), req.user.password_hash)) flash(req, 'error', '原密码错误');
    else if (String(password || '').length < 6) flash(req, 'error', '新密码至少 6 位');
    else if (password !== password2) flash(req, 'error', '两次输入的新密码不一致');
    else { db.exec1('UPDATE users SET password_hash=? WHERE id=?', bcrypt.hashSync(password, 10), req.user.id); flash(req, 'success', '密码已修改'); }
    res.redirect('/me/profile');
  });
  // 地址
  app.get('/me/addresses', needLogin, (req, res) => {
    const edit = req.query.edit ? db.get('SELECT * FROM addresses WHERE id=? AND user_id=?', int(req.query.edit), req.user.id) : null;
    res.page('shop/addresses', { title: '收货地址', addrs: myAddrs(req.user.id), edit });
  });
  app.post('/me/addresses', needLogin, (req, res) => {
    const a = validateAddress(req.body);
    if (!a) { flash(req, 'error', '请完整并正确填写收货信息(手机号需 11 位,省市区需选择)'); return res.redirect('/me/addresses' + (req.body.id ? '?edit=' + int(req.body.id) : '')); }
    const has = db.get('SELECT COUNT(*) n FROM addresses WHERE user_id=?', req.user.id).n;
    const def = req.body.is_default || !has ? 1 : 0;
    if (def) db.exec1('UPDATE addresses SET is_default=0 WHERE user_id=?', req.user.id);
    if (req.body.id && db.get('SELECT 1 FROM addresses WHERE id=? AND user_id=?', int(req.body.id), req.user.id))
      db.exec1('UPDATE addresses SET name=?,phone=?,province=?,city=?,district=?,detail=?, is_default=CASE WHEN ?=1 THEN 1 ELSE is_default END WHERE id=?', a.name, a.phone, a.province, a.city, a.district, a.detail, def, int(req.body.id));
    else db.exec1('INSERT INTO addresses(user_id,name,phone,province,city,district,detail,is_default) VALUES(?,?,?,?,?,?,?,?)', req.user.id, a.name, a.phone, a.province, a.city, a.district, a.detail, def);
    flash(req, 'success', '地址已保存'); res.redirect('/me/addresses');
  });
  app.post('/me/addresses/:id/default', needLogin, (req, res) => {
    if (db.get('SELECT 1 FROM addresses WHERE id=? AND user_id=?', int(req.params.id), req.user.id)) { db.exec1('UPDATE addresses SET is_default=0 WHERE user_id=?', req.user.id); db.exec1('UPDATE addresses SET is_default=1 WHERE id=?', int(req.params.id)); }
    res.redirect('/me/addresses');
  });
  app.post('/me/addresses/:id/delete', needLogin, (req, res) => {
    db.exec1('DELETE FROM addresses WHERE id=? AND user_id=?', int(req.params.id), req.user.id);
    const left = db.get('SELECT id FROM addresses WHERE user_id=? ORDER BY id LIMIT 1', req.user.id);
    if (left && !db.get('SELECT 1 FROM addresses WHERE user_id=? AND is_default=1', req.user.id)) db.exec1('UPDATE addresses SET is_default=1 WHERE id=?', left.id);
    res.redirect('/me/addresses');
  });
  // 收藏/足迹
  app.get('/me/favorites', needLogin, (req, res) => {
    const rows = withImg(db.all(`${prodCard} JOIN favorites f ON f.product_id=p.id WHERE f.user_id=? ORDER BY f.created_at DESC`, req.user.id));
    res.page('shop/me-favorites', { title: '我的收藏', rows });
  });
  app.get('/me/history', needLogin, (req, res) => {
    const rows = withImg(db.all(`SELECT p.*, h.viewed_at FROM history h JOIN products p ON p.id=h.product_id WHERE h.user_id=? ORDER BY h.viewed_at DESC LIMIT 60`, req.user.id));
    res.page('shop/me-history', { title: '浏览记录', rows });
  });
  app.post('/me/history/clear', needLogin, (req, res) => { db.exec1('DELETE FROM history WHERE user_id=?', req.user.id); flash(req, 'success', '浏览记录已清空'); res.redirect('/me/history'); });
  app.post('/me/history/:pid/delete', needLogin, (req, res) => {
    db.exec1('DELETE FROM history WHERE user_id=? AND product_id=?', req.user.id, int(req.params.pid));
    if (wantsJson(req)) return res.json({ ok: true });
    res.redirect('/me/history');
  });

  // ---------------- 隐私政策 / 用户协议 / 同意 ----------------
  const policyVersion = () => svc.S('policy_version') || '1.0';
  const policy = topic => {
    const a = db.get("SELECT * FROM articles WHERE category='policy' AND topic=? ORDER BY id LIMIT 1", topic);
    return a ? { ...a, content: String(a.content || '').split('{{version}}').join(policyVersion()) } : null;
  };
  for (const [path, topic, title] of [['/privacy', 'privacy', '隐私政策'], ['/terms', 'terms', '用户协议']]) {
    app.get(path, (req, res) => {
      const a = policy(topic);
      if (!a) return res.status(404).page('shop/error', { title, code: 404, message: '内容暂未发布' });
      res.page('shop/policy', { title: a.title || title, a, version: policyVersion() });
    });
  }
  app.get('/consent', needLogin, (req, res) => {
    if (req.user.consent_version === policyVersion()) return res.redirect(safeNext(req.query.next));
    res.page('shop/consent', { title: '用户协议与隐私政策', next: req.query.next || '/me', version: policyVersion(), updated: !!req.user.consent_version });
  });
  app.post('/consent', needLogin, (req, res) => {
    if (req.body.agree !== '1') { flash(req, 'error', '请勾选同意《用户协议》《隐私政策》后继续,或退出登录'); return res.redirect('/consent?next=' + encodeURIComponent(req.body.next || '/me')); }
    db.exec1('UPDATE users SET consent_at=?, consent_version=? WHERE id=?', now(), policyVersion(), req.user.id);
    res.redirect(safeNext(req.body.next));
  });

  // ---------------- 注销账号 ----------------
  const cancelBlockers = uid => {
    const b = [];
    const o = db.get("SELECT COUNT(*) n FROM orders WHERE user_id=? AND status IN ('unpaid','paid','shipped')", uid).n;
    if (o) b.push(`有 ${o} 笔未完成的订单(待付款/待发货/待收货)`);
    const a = db.get("SELECT COUNT(*) n FROM aftersales WHERE user_id=? AND status IN ('pending','approved_return','returned')", uid).n;
    if (a) b.push(`有 ${a} 个处理中的售后`);
    const r = db.get("SELECT COUNT(*) n FROM cloud_redeem_requests WHERE user_id=? AND status='pending'", uid).n;
    if (r) b.push(`有 ${r} 笔待处理的积分兑换申请`);
    return b;
  };
  app.get('/me/cancel', needLogin, (req, res) => res.page('shop/cancel-account', { title: '注销账号', blockers: cancelBlockers(req.user.id) }));
  app.post('/me/cancel', needLogin, (req, res) => {
    const uid = req.user.id;
    const blockers = cancelBlockers(uid);
    if (blockers.length) { flash(req, 'error', '暂不能注销:' + blockers.join(';')); return res.redirect('/me/cancel'); }
    if (String(req.body.confirm_text || '').trim() !== '确认注销') { flash(req, 'error', '请在输入框中填写「确认注销」'); return res.redirect('/me/cancel'); }
    if (req.body.ack !== '1') { flash(req, 'error', '请勾选「我已了解注销后果」'); return res.redirect('/me/cancel'); }
    db.transaction(() => {
      const t = now();
      // 账号本身:去标识化,保留 id 以便订单等法定留存记录匿名关联
      db.exec1(`UPDATE users SET phone=?, password_hash=?, nickname='已注销用户', gender='保密', invite_code=NULL, referrer_id=NULL, points=0, growth=0, level_id=1, remark=NULL,
        signin_streak=0, last_signin=NULL, cloud_tier='', cloud_start=NULL, cloud_end=NULL, cloud_card_type_id=0, status=0, cancelled_at=? WHERE id=?`, 'del_' + uid + '_' + Date.now(), bcrypt.hashSync(require('crypto').randomBytes(16).toString('hex'), 4), t, uid);
      db.exec1('UPDATE users SET referrer_id=NULL WHERE referrer_id=?', uid); // 解除邀请关系
      for (const tb of ['addresses', 'favorites', 'history', 'cart', 'messages', 'signins', 'cloud_daily_log']) db.exec1(`DELETE FROM ${tb} WHERE user_id=?`, uid);
      db.exec1("DELETE FROM user_coupons WHERE user_id=? AND status='unused'", uid);
      db.exec1("UPDATE invoices SET email='', title=CASE WHEN type='personal' THEN '个人' ELSE title END WHERE user_id=?", uid);
      db.exec1("UPDATE orders SET receiver='已注销用户', phone='***', detail='***', remark='' WHERE user_id=?", uid);
      db.exec1("UPDATE reviews SET status='hidden' WHERE user_id=?", uid);
      db.exec1('INSERT INTO points_log(user_id,delta,balance,reason,created_at) VALUES(?,?,?,?,?)', uid, -(req.user.points || 0), 0, '账号注销,积分清零', t);
    })();
    req.session.regenerate(() => { req.session.flash = { type: 'success', msg: '账号已注销,感谢您的使用' }; req.session.save(() => res.redirect('/')); });
  });
  // 积分 / 签到
  app.get('/me/points', needLogin, (req, res) => {
    const pg = U.paginate('SELECT * FROM points_log WHERE user_id=? ORDER BY id DESC', [req.user.id], req.query.page, 15);
    const days = []; const signed = new Set(db.all('SELECT day FROM signins WHERE user_id=?', req.user.id).map(r => r.day));
    for (let i = 6; i >= 0; i--) { const d = U.offset(-i * 86400000).slice(0, 10); days.push({ d, signed: signed.has(d), today: i === 0 }); }
    res.page('shop/me-points', { title: '我的积分', pg, days, signed: req.user.last_signin === U.today() });
  });
  app.post('/me/signin', needLogin, (req, res) => {
    const today = U.today(), yest = U.offset(-86400000).slice(0, 10);
    const r = db.transaction(() => {
      const u = db.get('SELECT * FROM users WHERE id=?', req.user.id);
      if (u.last_signin === today) return { ok: false, msg: '今天已经签到过啦' };
      const streak = u.last_signin === yest ? u.signin_streak + 1 : 1;
      const pts = int(svc.S('signin_base'), 5) + Math.min(streak - 1, 5);
      db.exec1('INSERT INTO signins VALUES(?,?,?,?)', u.id, today, pts, streak);
      db.exec1('UPDATE users SET signin_streak=?, last_signin=? WHERE id=?', streak, today, u.id);
      svc.addPoints(u.id, pts, `每日签到(连续${streak}天)`); svc.addGrowth(u.id, 2);
      let extra = 0;
      if (svc.cloud.isCardActive(u) && u.cloud_daily_day !== today) {
        const cr = svc.cloud.dailyReturn(u.id, svc.addPoints);
        if (cr.ok) extra = cr.pts || 0;
      }
      const msg = extra
        ? `签到成功,获得 ${pts} 积分(连续${streak}天),会员每日返积分 +${extra}`
        : `签到成功,获得 ${pts} 积分(连续签到 ${streak} 天)`;
      return { ok: true, msg, pts: pts + extra };
    })();
    if (wantsJson(req)) return res.json(r);
    flash(req, r.ok ? 'success' : 'error', r.msg); back(req, res, '/me/points');
  });
  // 优惠券
  app.get('/me/coupons', needLogin, (req, res) => {
    const st = req.query.status || 'unused';
    res.page('shop/me-coupons', { title: '我的优惠券', st, rows: svc.userCoupons(req.user.id, st) });
  });
  app.get('/coupons', (req, res) => {
    const rows = db.all('SELECT c.*, cat.name cat_name FROM coupons c LEFT JOIN categories cat ON cat.id=c.category_id WHERE c.status=1 ORDER BY c.id').map(c => ({ ...c, mine: req.user ? db.get('SELECT COUNT(*) n FROM user_coupons WHERE user_id=? AND coupon_id=?', req.user.id, c.id).n : 0 }));
    res.page('shop/coupons', { title: '领券中心', rows });
  });
  app.post('/coupons/:id/claim', needLogin, (req, res) => {
    const r = svc.grantCoupon(req.user.id, int(req.params.id));
    if (wantsJson(req)) return res.json(r);
    flash(req, r.ok ? 'success' : 'error', r.msg); back(req, res, '/coupons');
  });
  // 余额 / 充值:前台已下线账户余额,旧链接统一回到会员中心
  app.get('/me/balance', needLogin, (req, res) => res.redirect('/me'));
  app.post('/me/recharge', needLogin, (req, res) => res.redirect('/me'));
  // 分销
  app.get('/me/referral', needLogin, (req, res) => {
    const invitees = db.all('SELECT id, nickname, phone, created_at, total_spent FROM users WHERE referrer_id=? ORDER BY id DESC', req.user.id);
    const sum = db.get("SELECT COALESCE(SUM(CASE WHEN status='available' THEN amount END),0) available, COALESCE(SUM(CASE WHEN status='settled' THEN amount END),0) settled FROM commissions WHERE user_id=?", req.user.id);
    const list = db.all('SELECT c.*, o.order_no, u.nickname FROM commissions c JOIN orders o ON o.id=c.order_id JOIN users u ON u.id=c.from_user_id WHERE c.user_id=? ORDER BY c.id DESC LIMIT 30', req.user.id);
    res.page('shop/me-referral', { title: '邀请好友 · 分销', invitees, sum, list, link: `${req.protocol}://${req.get('host')}/register?ref=${req.user.invite_code}` });
  });
  app.post('/me/referral/settle', needLogin, (req, res) => {
    const r = db.transaction(() => {
      const amt = db.get("SELECT COALESCE(SUM(amount),0) a FROM commissions WHERE user_id=? AND status='available'", req.user.id).a;
      if (amt <= 0) return null;
      db.exec1("UPDATE commissions SET status='settled', settled_at=? WHERE user_id=? AND status='available'", now(), req.user.id);
      return amt;
    })();
    flash(req, r ? 'success' : 'error', r ? `已申请结算佣金 ¥${r.toFixed(2)},将由平台线下发放(演示)` : '暂无可结算佣金'); res.redirect('/me/referral');
  });
  app.get('/me/invoices', needLogin, (req, res) => {
    const rows = db.all('SELECT i.*, o.order_no FROM invoices i JOIN orders o ON o.id=i.order_id WHERE i.user_id=? ORDER BY i.id DESC', req.user.id);
    res.page('shop/me-invoices', { title: '我的发票', rows });
  });
  app.get('/me/levels', needLogin, (req, res) => res.page('shop/me-levels', { title: '会员等级', levels: db.all('SELECT * FROM member_levels ORDER BY min_growth') }));


  // ---------------- 云商卡会员权益 ----------------
  app.get('/me/cloud', needLogin, (req, res) => {
    const cloud = svc.cloud;
    const status = cloud.cardStatus(req.user);
    const types = db.all('SELECT c.*, p.name pname, p.price pprice, p.images FROM cloud_card_types c LEFT JOIN products p ON p.id=c.product_id WHERE c.status=1 ORDER BY c.sort, c.id')
      .map(t => ({ ...t, tierLabel: cloud.TIER_LABEL[t.tier] || t.tier, durationLabel: cloud.DURATION_LABEL[t.duration] || t.duration, img: U.firstImg(t.images) }));
    const dailyDone = req.user.cloud_daily_day === U.today();
    const redeems = db.all('SELECT * FROM cloud_redeem_requests WHERE user_id=? ORDER BY id DESC LIMIT 10', req.user.id);
    const refLog = db.all('SELECT * FROM cloud_referral_log WHERE user_id=? ORDER BY id DESC LIMIT 15', req.user.id);
    const ratio = int(svc.S('cloud_redeem_ratio'), 100);
    const label = svc.S('cloud_redeem_label') || '权益值';
    res.page('shop/me-cloud', { title: '云商卡 · 会员权益', status, types, dailyDone, redeems, refLog, ratio, label, dailyPts: int(svc.S('cloud_daily_points'), 10), redeemMin: int(svc.S('cloud_redeem_min'), 100) });
  });
  app.post('/me/cloud/daily', needLogin, (req, res) => {
    const r = db.transaction(() => svc.cloud.dailyReturn(req.user.id, svc.addPoints))();
    if (wantsJson(req)) return res.json(r);
    flash(req, r.ok ? 'success' : 'error', r.msg); res.redirect('/me/cloud');
  });
  app.post('/me/cloud/redeem', needLogin, (req, res) => {
    const r = svc.cloud.submitRedeem(req.user.id, req.body.points, req.body.note);
    flash(req, r.ok ? 'success' : 'error', r.msg); res.redirect('/me/cloud');
  });
  app.get('/me/cloud-fans', needLogin, (req, res) => {
    const stats = svc.cloud.fanStats(req.user.id);
    const status = svc.cloud.cardStatus(req.user);
    const push3Pct = svc.S('cloud_push3_pct');
    const push3Mode = svc.S('cloud_push3_mode');
    res.page('shop/me-cloud-fans', { title: '我的云粉', stats, status, push3Pct, push3Mode, link: `${req.protocol}://${req.get('host')}/register?ref=${req.user.invite_code}` });
  });

  // ---------------- 积分商城 ----------------
  app.get('/points-mall', (req, res) => res.page('shop/points-mall', { title: '积分商城', goods: db.all('SELECT * FROM points_goods WHERE status=1 ORDER BY sort,id') }));
  app.post('/points-mall/:id/exchange', needLogin, (req, res) => {
    const r = db.transaction(() => {
      const g = db.get('SELECT * FROM points_goods WHERE id=? AND status=1', int(req.params.id));
      const u = db.get('SELECT * FROM users WHERE id=?', req.user.id);
      if (!g) return { ok: false, msg: '商品不存在' };
      if (g.stock <= 0) return { ok: false, msg: '库存不足' };
      if (u.points < g.points) return { ok: false, msg: `积分不足,还差 ${g.points - u.points} 积分` };
      let oid = null;
      if (g.type === 'goods') {
        const a = db.get('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC, id LIMIT 1', u.id);
        if (!a) return { ok: false, msg: '请先添加收货地址再兑换实物', addr: true };
        oid = db.exec1("INSERT INTO orders(order_no,user_id,type,status,goods_amount,pay_amount,pay_method,paid_at,receiver,phone,province,city,district,detail,points_used,created_at) VALUES(?,?,'points','paid',0,0,'points',?,?,?,?,?,?,?,?,?)", U.orderNo(), u.id, now(), a.name, a.phone, a.province, a.city, a.district, a.detail, g.points, now()).lastInsertRowid;
        db.exec1('INSERT INTO order_items(order_id,name,spec_text,image,price,qty) VALUES(?,?,?,?,0,1)', oid, g.name, g.points + ' 积分兑换', g.image);
        db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, now(), '积分兑换成功,等待商家发货');
      } else if (g.type === 'coupon') { const c = svc.grantCoupon(u.id, g.coupon_id, true); if (!c.ok) return c; }
      svc.addPoints(u.id, -g.points, '积分兑换:' + g.name);
      db.exec1('UPDATE points_goods SET stock=stock-1, exchanged=exchanged+1 WHERE id=?', g.id);
      return { ok: true, msg: g.type === 'coupon' ? '兑换成功,优惠券已发放到「我的优惠券」' : '兑换成功,订单已生成,请等待发货', oid };
    })();
    flash(req, r.ok ? 'success' : 'error', r.msg);
    res.redirect(r.ok && r.oid ? '/order/' + r.oid : r.addr ? '/me/addresses' : '/points-mall');
  });

  // ---------------- 秒杀 / 拼团 ----------------
  app.get('/seckill', (req, res) => {
    const t = now();
    const rows = db.all(`SELECT s.*, p.name, p.images, p.market_price, p.subtitle FROM seckills s JOIN products p ON p.id=s.product_id WHERE s.status=1 AND p.status=1 AND s.end_at>=? ORDER BY s.start_at`, t).map(s => ({ ...s, img: U.firstImg(s.images), live: s.start_at <= t }));
    res.page('shop/seckill', { title: '限时秒杀', rows });
  });
  app.get('/groupbuy', (req, res) => {
    const rows = withImg(db.all('SELECT g.*, p.name, p.images, p.market_price, p.subtitle FROM groupbuys g JOIN products p ON p.id=g.product_id WHERE g.status=1 AND p.status=1'));
    const open = db.all(`SELECT g.*, u.nickname, p.name pname, gb.price FROM groups g JOIN users u ON u.id=g.leader_id JOIN groupbuys gb ON gb.id=g.groupbuy_id JOIN products p ON p.id=gb.product_id WHERE g.status='open' AND g.expire_at>? ORDER BY g.expire_at LIMIT 8`, now());
    res.page('shop/groupbuy', { title: '拼团专区', rows, open });
  });
  app.get('/group/:id', (req, res) => {
    const g = db.get('SELECT g.*, u.nickname FROM groups g JOIN users u ON u.id=g.leader_id WHERE g.id=?', int(req.params.id));
    if (!g) return res.status(404).page('shop/error', { title: '拼团不存在', code: 404, message: '该团不存在' });
    const gb = db.get('SELECT * FROM groupbuys WHERE id=?', g.groupbuy_id);
    const p = db.get('SELECT * FROM products WHERE id=?', gb.product_id);
    const members = db.all('SELECT u.nickname FROM group_members m JOIN users u ON u.id=m.user_id WHERE m.group_id=?', g.id);
    res.page('shop/group', { title: '参与拼团', g, gb, p, img: U.firstImg(p.images), members, expired: g.expire_at < now() });
  });

  // ---------------- 内容 / 客服 ----------------
  app.get('/notices', (req, res) => res.page('shop/articles', { title: '商城公告', rows: db.all("SELECT * FROM articles WHERE category='notice' AND status=1 ORDER BY id DESC") }));
  app.get('/help', (req, res) => {
    const rows = db.all("SELECT * FROM articles WHERE category='help' AND status=1 ORDER BY sort,id");
    const q = String(req.query.q || '').trim();
    res.page('shop/help', { title: '帮助中心', rows: q ? rows.filter(r => (r.title + r.content).includes(q)) : rows, q });
  });
  app.get('/article/:id', (req, res) => {
    const a = db.get('SELECT * FROM articles WHERE id=? AND status=1', int(req.params.id));
    if (!a) return res.status(404).page('shop/error', { title: '文章不存在', code: 404, message: '文章不存在' });
    db.exec1('UPDATE articles SET views=views+1 WHERE id=?', a.id);
    res.page('shop/article', { title: a.title, a });
  });
  app.get('/service', (req, res) => {
    let msgs = [];
    if (req.user) { msgs = db.all('SELECT * FROM messages WHERE user_id=? ORDER BY id', req.user.id); db.exec1("UPDATE messages SET is_read=1 WHERE user_id=? AND sender IN ('staff','bot')", req.user.id); }
    res.page('shop/service', { title: '联系客服', msgs, faq: db.all("SELECT * FROM articles WHERE category='help' AND status=1 ORDER BY sort LIMIT 6") });
  });
  app.post('/service', needLogin, (req, res) => {
    const c = String(req.body.content || '').trim().slice(0, 500);
    if (c) { svc.notifyService(req.user.id, 'user', c); db.exec1('INSERT INTO messages(user_id,sender,content,created_at,is_read) VALUES(?,?,?,?,1)', req.user.id, 'bot', '【智能助手】' + svc.botReply(c), now()); }
    res.redirect('/service#end');
  });
};
