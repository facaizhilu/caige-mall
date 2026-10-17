// 后台:供应商(京东货盘 / 来一票 VOP)—— 选品导入、已导入商品、分类映射、设置、对账、接口日志、订单/售后操作
const db = require('../lib/db');
const U = require('../lib/util');
const svc = require('../lib/svc');
const J = require('../lib/suppliers/jdvop');
const { now, int } = U;

module.exports = function (r, { need, flash, log, filesOf }) {
  const back = (req, res, fb) => res.redirect(req.get('referer') && req.get('referer').includes('/admin') ? req.get('referer') : fb);
  const aw = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { if (e instanceof J.client.SupplierError) { flash(req, 'error', '供应商接口返回:' + e.message); return back(req, res, '/admin/jdvop'); } next(e); });
  const catOptions = () => db.all('SELECT c.id, c.name, p.name pname FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.parent_id>0 ORDER BY c.parent_id, c.sort, c.id');
  const modeInfo = () => ({ cfg: J.config.status(), missing: J.config.missing(), demo: process.env.DEMO_MODE === '1' });

  // ---------- 选品:浏览供应商分类与商品,勾选导入 ----------
  r.get('/jdvop', need('product'), aw(async (req, res) => {
    const f = { cat1: req.query.cat1 || '', cat2: req.query.cat2 || '', cat3: req.query.cat3 || '', q: String(req.query.q || '').slice(0, 30), page: Math.max(1, int(req.query.page, 1)) };
    let data = { list: [], count: 0, cats1: [], cats2: [], cats3: [] }, err = null;
    try { data = await J.browse(f); } catch (e) { err = e.message; }
    res.page('admin/jdvop-browse', { title: '供应商商品', f, data, err, mi: modeInfo(), pages: Math.max(1, Math.ceil((data.count || 0) / 20)) });
  }));
  r.post('/jdvop/import', need('product'), aw(async (req, res) => {
    const ids = [...new Set([].concat(req.body.sku || []).map(s => String(s).replace(/\D/g, '')).filter(Boolean))].slice(0, 30);
    if (!ids.length) { flash(req, 'error', '请先勾选要导入的商品'); return back(req, res, '/admin/jdvop'); }
    const ok = [], bad = [];
    for (const id of ids) {
      try { const x = await J.importSku(id); if (x.ok) ok.push(`#${x.productId}${x.note ? '(待审核:' + x.note + ')' : ''}`); else bad.push(x.msg); }
      catch (e) { bad.push(`SKU ${id}:${e.message}`); }
    }
    log(req, '导入供应商商品', `成功 ${ok.length}:${ok.join(',')};失败 ${bad.length}`.slice(0, 300));
    flash(req, bad.length ? 'warn' : 'success', `导入成功 ${ok.length} 个商品 ${ok.join(' ')}` + (bad.length ? `;未导入 ${bad.length} 个:${bad.join(';')}` : '').slice(0, 900));
    back(req, res, '/admin/jdvop');
  }));

  // ---------- 已导入商品 ----------
  r.get('/jdvop/products', need('product'), (req, res) => {
    const st = String(req.query.state || ''), where = ['p.supplier=?'], params = [J.SUP];
    if (st) { where.push('p.supplier_state=?'); params.push(st); }
    const pg = U.paginate(`SELECT p.*, c.name cname FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE ${where.join(' AND ')} ORDER BY p.id DESC`, params, req.query.page, 20);
    pg.rows.forEach(p => { p.img = U.firstImg(p.images); p.skus = db.all('SELECT spec_text, supplier_sku, cost_price, supplier_retail, price, stock, return_rule_type FROM skus WHERE product_id=? ORDER BY id', p.id); });
    res.page('admin/jdvop-products', { title: '已导入供应商商品', pg, st, lastSync: svc.S('jdvop_last_sync') });
  });
  r.post('/jdvop/refresh', need('product'), aw(async (req, res) => {
    const ids = [].concat(req.body.ids || []).map(int).filter(x => x > 0);
    const x = await J.refreshProducts(ids.length ? { productIds: ids } : {});
    log(req, '刷新供应商价格/可售', JSON.stringify(x).slice(0, 300));
    flash(req, x.errors.length ? 'error' : 'success', `已刷新 ${x.skus} 个规格:价格变动 ${x.priceChanged},不可售 ${x.unsellable},自动下架 ${x.delisted},恢复上架 ${x.relisted}` + (x.errors.length ? ';错误:' + x.errors.join(';') : ''));
    back(req, res, '/admin/jdvop/products');
  }));

  // ---------- 分类映射 ----------
  r.get('/jdvop/mapping', need('product'), (req, res) => {
    const rows = db.all('SELECT m.*, c.name cname, (SELECT COUNT(*) FROM products p WHERE p.supplier=m.supplier AND p.supplier_cat=m.supplier_cat_id) n FROM supplier_category_map m LEFT JOIN categories c ON c.id=m.category_id WHERE m.supplier=? ORDER BY m.reviewed, m.supplier_path', J.SUP);
    rows.forEach(m => { m.blocked = J.compliance.blockedBy((m.supplier_path || '').split(' / ')); });
    res.page('admin/jdvop-mapping', { title: '供应商分类映射', rows, cats: catOptions() });
  });
  r.post('/jdvop/mapping/:cat', need('product'), (req, res) => {
    const cid = int(req.body.category_id);
    if (!db.get('SELECT 1 FROM categories WHERE id=? AND parent_id>0', cid)) { flash(req, 'error', '请选择本站二级分类'); return res.redirect('/admin/jdvop/mapping'); }
    const n = J.updateMapping(req.params.cat, { category_id: cid, perishable: req.body.perishable === '1', apply: req.body.apply === '1' });
    log(req, '修改供应商分类映射', `${req.params.cat} → #${cid} 生鲜=${req.body.perishable === '1' ? '是' : '否'},同步 ${n} 个商品`);
    flash(req, 'success', '映射已保存' + (req.body.apply === '1' ? `,已同步 ${n} 个商品` : '')); res.redirect('/admin/jdvop/mapping');
  });

  // ---------- 设置 / 告警 / 余额 ----------
  r.get('/jdvop/settings', need('system'), aw(async (req, res) => {
    let balance = null, balErr = null;
    try { balance = await J.client.balance(); } catch (e) { balErr = e.message; }
    const alerts = db.all('SELECT a.*, o.order_no FROM supplier_alerts a LEFT JOIN orders o ON o.id=a.order_id WHERE a.resolved=0 ORDER BY a.id DESC LIMIT 50');
    res.page('admin/jdvop-settings', { title: '供应商设置', s: svc.settings(), mi: modeInfo(), balance, balErr, alerts, mockSkus: J.config.cfg().mode === 'mock' ? J.mock.SKUS.map(x => ({ id: x.skuId, name: x.skuName, now: J.mock.skuNow(x.skuId) })) : [] });
  }));
  r.post('/jdvop/settings', need('system'), (req, res) => {
    const b = req.body, pct = Math.min(500, Math.max(0, parseFloat(b.jdvop_markup_pct) || 0));
    const vals = { jdvop_markup_mode: b.jdvop_markup_mode === 'cost_plus' ? 'cost_plus' : 'max_retail_cost', jdvop_markup_pct: String(pct), jdvop_sync_hours: String(Math.min(168, Math.max(0, parseFloat(b.jdvop_sync_hours) || 0))), jdvop_poll_minutes: String(Math.min(1440, Math.max(1, int(b.jdvop_poll_minutes, 10)))), jdvop_virtual_stock: String(Math.min(9999, Math.max(1, int(b.jdvop_virtual_stock, 200)))), jdvop_max_push_attempts: String(Math.min(10, Math.max(1, int(b.jdvop_max_push_attempts, 3)))), jdvop_mock_auto: b.jdvop_mock_auto === '1' ? '1' : '0' };
    if (typeof b.jdvop_blocklist === 'string') vals.jdvop_blocklist = b.jdvop_blocklist.split(/\r?\n/).map(s => s.trim()).filter(Boolean).join('\n').slice(0, 5000) || J.compliance.BLOCKLIST_DEFAULT;
    for (const [k, v] of Object.entries(vals)) svc.setSetting(k, v);
    log(req, '修改供应商设置', JSON.stringify({ ...vals, jdvop_blocklist: vals.jdvop_blocklist ? '(已更新)' : undefined }).slice(0, 300));
    flash(req, 'success', '供应商设置已保存(加价规则在下次价格刷新时生效,可点「立即刷新价格」)'); res.redirect('/admin/jdvop/settings');
  });
  r.post('/jdvop/poll', need('system'), aw(async (req, res) => { const x = await J.poll(); log(req, '供应商订单轮询', JSON.stringify(x)); flash(req, 'success', `已轮询 ${x.orders} 个供应商订单、${x.aftersales} 个售后单`); back(req, res, '/admin/jdvop/settings'); }));
  r.post('/jdvop/alerts/:id/resolve', need('system'), (req, res) => { db.exec1('UPDATE supplier_alerts SET resolved=1 WHERE id=?', int(req.params.id)); log(req, '处理供应商告警', '#' + req.params.id); back(req, res, '/admin/jdvop/settings'); });
  r.post('/jdvop/alerts/resolve-all', need('system'), (req, res) => { db.exec1('UPDATE supplier_alerts SET resolved=1 WHERE resolved=0'); log(req, '处理全部供应商告警', ''); back(req, res, '/admin/jdvop/settings'); });
  r.post('/jdvop/mock/sku', need('system'), (req, res) => {
    if (J.config.cfg().mode !== 'mock') { flash(req, 'error', '仅 mock 模式可用'); return back(req, res, '/admin/jdvop/settings'); }
    const patch = {}; const b = req.body;
    if (b.sellPrice !== undefined && b.sellPrice !== '') patch.sellPrice = +b.sellPrice;
    if (b.retail !== undefined && b.retail !== '') patch.retail = +b.retail;
    if (b.saleState === '0' || b.saleState === '1') patch.saleState = +b.saleState;
    if (b.removed === '1') patch.removed = true; else if (b.removed === '0') patch.removed = false;
    J.mock.setSkuOverride(String(b.sku).replace(/\D/g, ''), patch);
    log(req, '模拟供应商商品变化', `${b.sku} ${JSON.stringify(patch)}`);
    flash(req, 'success', `已模拟 SKU ${b.sku} 变化,点「立即刷新价格」查看效果`); back(req, res, '/admin/jdvop/settings');
  });

  // ---------- 接口日志 ----------
  r.get('/jdvop/logs', need('stats'), (req, res) => {
    const q = String(req.query.q || '').trim(), ok = String(req.query.ok || ''), where = ['1=1'], params = [];
    if (q) { where.push('(interface_code LIKE ? OR msg LIKE ?)'); params.push('%' + q + '%', '%' + q + '%'); }
    if (ok === '0' || ok === '1') { where.push('ok=?'); params.push(int(ok)); }
    const pg = U.paginate(`SELECT * FROM supplier_call_logs WHERE ${where.join(' AND ')} ORDER BY id DESC`, params, req.query.page, 30);
    const cbs = db.all('SELECT * FROM supplier_callbacks ORDER BY id DESC LIMIT 30');
    res.page('admin/jdvop-logs', { title: '供应商接口日志', pg, q, ok, cbs });
  });

  // ---------- 对账 ----------
  r.get('/jdvop/reconcile', need('stats'), (req, res) => {
    const from = String(req.query.from || ''), to = String(req.query.to || '');
    res.page('admin/jdvop-reconcile', { title: '供应商对账', rec: J.reconcile({ from, to }), from, to });
  });

  // ---------- 订单:重试 / 取消 / 模拟 ----------
  const soOf = id => db.get('SELECT * FROM supplier_orders WHERE id=?', int(id));
  r.post('/jdvop/orders/:so/retry', need('order'), aw(async (req, res) => { const so = soOf(req.params.so); if (!so) return res.redirect('/admin/orders'); const x = await J.retry(so.id); log(req, '重试供应商订单', `#${so.order_id} ${x.msg}`); flash(req, x.ok ? 'success' : 'error', x.msg); res.redirect('/admin/orders/' + so.order_id); }));
  r.post('/jdvop/orders/:so/cancel', need('order'), aw(async (req, res) => { const so = soOf(req.params.so); if (!so) return res.redirect('/admin/orders'); const x = await J.cancelSupplierOrder(so.id, String(req.body.reason || '商家取消')); log(req, '取消供应商订单', `#${so.order_id} ${x.msg}`); flash(req, x.ok ? 'success' : 'error', x.msg); res.redirect('/admin/orders/' + so.order_id); }));
  r.post('/jdvop/orders/:so/simulate', need('order'), aw(async (req, res) => {
    const so = soOf(req.params.so); if (!so) return res.redirect('/admin/orders');
    const act = String(req.body.action || ''); if (!['split', 'ship', 'deliver', 'complete'].includes(act)) { flash(req, 'error', '未知模拟动作'); return res.redirect('/admin/orders/' + so.order_id); }
    try { const n = await J.simulate(so.id, act); flash(req, 'success', `已模拟供应商${{ split: '拆单', ship: '发货', deliver: '签收', complete: '完成' }[act]},处理回调 ${n} 条`); } catch (e) { flash(req, 'error', e.message); }
    log(req, '模拟供应商订单', `#${so.order_id} ${act}`); res.redirect('/admin/orders/' + so.order_id);
  }));

  // ---------- 售后:创建 / 操作 / 模拟 ----------
  const absUrl = (req, p) => /^https?:\/\//.test(p) ? p : (process.env.PUBLIC_BASE_URL || (req.protocol + '://' + req.get('host'))).replace(/\/$/, '') + p;
  r.post('/orders/:id/jdvop-aftersale', need('order'), aw(async (req, res) => {
    const o = db.get('SELECT * FROM orders WHERE id=?', int(req.params.id)); if (!o) return res.redirect('/admin/orders');
    const imgs = [...filesOf(req, 'images').map(p => absUrl(req, p)), ...String(req.body.image_urls || '').split(/\s+/).filter(u => /^https?:\/\//.test(u))];
    if (!['paid', 'shipped', 'completed'].includes(o.status)) { flash(req, 'error', '当前订单状态不可申请售后'); return res.redirect('/admin/orders/' + o.id); }
    const x = await J.createAftersale(req.session.admin.username, o, { ...req.body, images: imgs.join(',') });
    if (!x.ok) { flash(req, 'error', x.msg); return res.redirect('/admin/orders/' + o.id + '#supplier'); }
    log(req, '创建供应商售后', `订单#${o.id} 售后#${x.id}`); flash(req, 'success', `售后单 #${x.id} 已提交供应商`); res.redirect('/admin/aftersales/' + x.id);
  }));
  r.post('/jdvop/aftersales/:id/:act', need('order'), aw(async (req, res) => {
    const id = int(req.params.id), act = req.params.act;
    let x;
    if (act.startsWith('sim-')) { try { const n = await J.simulateAfs(id, act.slice(4)); x = { ok: true, msg: `已模拟,处理回调 ${n} 条` }; } catch (e) { x = { ok: false, msg: e.message }; } }
    else x = await J.afsAction(id, act, req.body);
    log(req, '供应商售后操作', `#${id} ${act} ${x.msg}`); flash(req, x.ok ? 'success' : 'error', x.msg); res.redirect('/admin/aftersales/' + id);
  }));
};
