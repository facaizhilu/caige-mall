// 通用后台 CRUD 生成器:列表 / 新增 / 编辑 / 删除,字段驱动
const db = require('./db');
const U = require('./util');
const { esc, num, int } = U;

const toDT = s => s ? String(s).slice(0, 16).replace(' ', 'T') : '';
const fromDT = s => s ? String(s).replace('T', ' ').slice(0, 16) + ':00' : '';

module.exports = function crud(router, cfg, ctx) {
  const base = '/' + cfg.path;
  const need = ctx.need(cfg.perm);
  const fields = cfg.fields;
  const optsOf = f => typeof f.options === 'function' ? f.options() : (f.options || []);

  function pick(req, existing) {
    const b = req.body, row = {};
    for (const f of fields) {
      let v = b[f.name];
      if (f.type === 'number') v = f.int ? int(v, f.def || 0) : num(v, f.def || 0);
      else if (f.type === 'checkbox') v = b[f.name] ? 1 : 0;
      else if (f.type === 'datetime') v = fromDT(v);
      else if (f.type === 'image') { const up = ctx.filesOf(req, f.name + '_file'); v = up[0] || String(b[f.name] || '').trim(); }
      else if (f.type === 'select' && f.numeric) v = int(v);
      else v = String(v == null ? '' : v).trim();
      row[f.name] = v;
    }
    return row;
  }
  function validate(row) {
    for (const f of fields) {
      if (f.required && (row[f.name] === '' || row[f.name] == null)) return `请填写「${f.label}」`;
      if (f.type === 'number' && f.min != null && row[f.name] < f.min) return `「${f.label}」不能小于 ${f.min}`;
      if (f.pattern && row[f.name] && !f.pattern.test(row[f.name])) return f.patternMsg || `「${f.label}」格式不正确`;
    }
    return null;
  }

  router.get(base, need, (req, res) => {
    const q = String(req.query.q || '').trim();
    const where = [], params = [];
    if (q && cfg.search) { where.push('(' + cfg.search.map(c => `${c} LIKE ?`).join(' OR ') + ')'); cfg.search.forEach(() => params.push('%' + q + '%')); }
    if (cfg.filter) { const f = cfg.filter(req); if (f) { where.push(f.sql); params.push(...(f.params || [])); } }
    const sql = `SELECT * FROM ${cfg.table}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${cfg.order || 'id DESC'}`;
    const pg = U.paginate(sql, params, req.query.page, cfg.pageSize || 20);
    if (cfg.decorate) pg.rows.forEach(r => cfg.decorate(r));
    res.page('admin/crud-list', { title: cfg.title, cfg, pg, q, base: '/admin' + base, hasSearch: !!cfg.search });
  });
  router.get(base + '/new', need, (req, res) => {
    const row = {}; fields.forEach(f => { row[f.name] = f.def != null ? f.def : (f.type === 'number' ? 0 : ''); });
    res.page('admin/crud-form', { title: '新增' + cfg.singular, cfg, row, isNew: true, base: '/admin' + base, optsOf, toDT });
  });
  router.get(base + '/:id/edit', need, (req, res) => {
    const row = db.get(`SELECT * FROM ${cfg.table} WHERE id=?`, int(req.params.id));
    if (!row) { ctx.flash(req, 'error', '记录不存在'); return res.redirect('/admin' + base); }
    if (cfg.virtualLoad) cfg.virtualLoad(row);
    res.page('admin/crud-form', { title: '编辑' + cfg.singular, cfg, row, isNew: false, base: '/admin' + base, optsOf, toDT });
  });
  router.post(base + '/save', need, (req, res) => {
    const id = int(req.body.id);
    const existing = id ? db.get(`SELECT * FROM ${cfg.table} WHERE id=?`, id) : null;
    const row = pick(req, existing);
    let err = validate(row);
    if (!err && cfg.validate) err = cfg.validate(row, existing, req);
    if (err) {
      row.id = id || undefined;
      return res.page('admin/crud-form', { title: (id ? '编辑' : '新增') + cfg.singular, cfg, row, isNew: !id, base: '/admin' + base, optsOf, toDT, flash: { type: 'error', msg: err } });
    }
    if (cfg.before) cfg.before(row, existing, req);
    if (existing) {
      const ks = Object.keys(row);
      db.prepare(`UPDATE ${cfg.table} SET ${ks.map(k => k + '=?').join(',')} WHERE id=?`).run(...ks.map(k => row[k]), id);
      ctx.log(req, `编辑${cfg.singular}`, `#${id} ${row.name || row.title || row.word || ''}`);
    } else {
      if (cfg.extraInsert) Object.assign(row, cfg.extraInsert(req));
      const ks = Object.keys(row);
      const nid = db.prepare(`INSERT INTO ${cfg.table}(${ks.join(',')}) VALUES(${ks.map(() => '?').join(',')})`).run(...ks.map(k => row[k])).lastInsertRowid;
      ctx.log(req, `新增${cfg.singular}`, `#${nid} ${row.name || row.title || row.word || ''}`);
      if (cfg.after) cfg.after(nid, row, req);
    }
    ctx.flash(req, 'success', cfg.singular + '已保存');
    res.redirect('/admin' + base);
  });
  router.post(base + '/:id/delete', need, (req, res) => {
    const id = int(req.params.id);
    const row = db.get(`SELECT * FROM ${cfg.table} WHERE id=?`, id);
    if (!row) return res.redirect('/admin' + base);
    const block = cfg.canDelete ? cfg.canDelete(row, req) : null;
    if (block) { ctx.flash(req, 'error', block); return res.redirect('/admin' + base); }
    db.exec1(`DELETE FROM ${cfg.table} WHERE id=?`, id);
    if (cfg.afterDelete) cfg.afterDelete(row);
    ctx.log(req, `删除${cfg.singular}`, `#${id} ${row.name || row.title || row.word || ''}`);
    ctx.flash(req, 'success', '已删除'); res.redirect('/admin' + base);
  });
  if (cfg.toggle) router.post(base + '/:id/toggle', need, (req, res) => {
    const id = int(req.params.id);
    db.prepare(`UPDATE ${cfg.table} SET ${cfg.toggle}=1-${cfg.toggle} WHERE id=?`).run(id);
    ctx.log(req, `切换${cfg.singular}状态`, '#' + id); res.redirect(req.get('referer') || '/admin' + base);
  });
};
module.exports.toDT = toDT;
