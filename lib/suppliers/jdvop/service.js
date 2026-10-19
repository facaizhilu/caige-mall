// 京东货盘(来一票)业务层:选品导入、价格/可售刷新、结算校验、推单、回调、轮询兜底、售后、对账
const crypto = require('crypto');
const db = require('../../db');
const U = require('../../util');
const { now, round2 } = U;
const client = require('./client');
const { cfg } = require('./config');
const C = require('./compliance');
const images = require('./images');
const svc = () => require('../../svc');
const S = k => svc().S(k);
const SUP = 'jdvop';
const isDemo = () => process.env.DEMO_MODE === '1';
const trace = (oid, text) => db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, now(), text);
function alert(message, orderId, level = 'error') { db.exec1('INSERT INTO supplier_alerts(supplier,level,order_id,message,created_at) VALUES(?,?,?,?,?)', SUP, level, orderId || null, String(message).slice(0, 500), now()); console.warn('[jdvop][alert]', message); }
const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
const ceil2 = x => Math.ceil(round2(x * 100) - 1e-6) / 100;

// ================= 价格规则 =================
// 售价必须是真实售价;供应商「京东价」仅作为定价参考,永不作为划线价展示给顾客(market_price 恒为 NULL)
function salePrice(cost, retail) {
  const pct = Math.max(0, parseFloat(S('jdvop_markup_pct')) || 0), floor = ceil2(cost * (1 + pct / 100));
  if (S('jdvop_markup_mode') === 'cost_plus') return floor;
  return round2(Math.max(retail > 0 ? retail : 0, floor)); // 默认:max(京东价, 成本×(1+加价率))
}
const validPrice = v => v != null && +v > 0;

// ================= 分类 & 映射 =================
let catCache = null, catCacheAt = 0;
async function categoryIndex(force) {
  if (!force && catCache && Date.now() - catCacheAt < 3600000) return catCache;
  const list = await client.call('searchAllCategory', {});
  // TODO(文档歧义 #8):分类接口返回的 id 与商品里的京东分类 ID 是否同一套,待确认;这里按同一套处理
  const idx = {}; for (const c of list || []) idx[String(c.id)] = { id: String(c.id), parentId: String(c.parentId), name: c.groupName, level: +c.groupLevel };
  catCache = idx; catCacheAt = Date.now(); return idx;
}
const PERISHABLE_RE = /生鲜|水果|蔬菜|肉|禽|蛋|海鲜|水产|冷藏|冷冻|冻品|鲜奶|低温|鲜花|活体/;
// 鲜活易腐(不支持7天无理由):名称规则,或命中允许清单「食用农产品」组
const perishableNames = names => PERISHABLE_RE.test(names.join(' / ')) || C.isFarmProduce(names);
// 本站一级分类建议(按名称;找不到时退回到第一个一级分类)。旧库分类名(食品生鲜/数码家电等)作为后备
const PARENT_RULES = [[/生鲜|水果|蔬菜|蛋|原粮|农产品/, ['新鲜农产品', '食品生鲜']], [/食品|饮料|乳|奶|零食|坚果|海鲜|水产|粮油|酒水/, ['食品生鲜']], [/服饰|女装|男装|内衣|鞋|箱包/, ['服饰鞋包']], [/美妆|个护|个人护理|洗发|口腔|护肤/, ['美妆个护']], [/电脑|外设|网络|办公/, ['电脑外设', '数码家电']], [/数码|手机|影音|家电|电器/, ['数码配件', '数码家电']], [/运动|户外|健身/, ['运动户外']], [/.*/, ['家居日用']]];
// 供应商分类名 → 本站演示分类名(找不到同名分类时使用)
const CAT_ALIAS = { 水果: '新鲜水果', 蔬菜: '新鲜蔬菜', 蛋品: '鲜蛋', 禽蛋: '鲜蛋', 外设产品: '电脑配件', 网络产品: '网络设备', 影音娱乐: '影音耳机', 数码配件: '手机配件' };
/** 供应商三级分类 → 本站分类(没有映射时按名称自动建议并创建,后台可改) */
function mapCategory(path /* [{id,name}...] 一级→三级 */) {
  const c3 = path[path.length - 1];
  let m = db.get('SELECT * FROM supplier_category_map WHERE supplier=? AND supplier_cat_id=?', SUP, String(c3.id));
  if (m && m.category_id && db.get('SELECT 1 FROM categories WHERE id=?', m.category_id)) return m;
  const names = path.map(c => c.name), text = names.join(' / ');
  let cat = db.get('SELECT id FROM categories WHERE parent_id>0 AND (name=? OR name=?)', c3.name, path[1] && path[1].name);
  if (!cat) { const al = [c3.name, path[1] && path[1].name].map(n => CAT_ALIAS[n]).filter(Boolean); if (al.length) cat = db.get(`SELECT id FROM categories WHERE parent_id>0 AND name IN (${al.map(() => '?').join(',')}) ORDER BY id LIMIT 1`, ...al); }
  if (!cat) {
    const pnames = PARENT_RULES.find(([re]) => re.test(text))[1];
    const parent = pnames.map(n => db.get('SELECT id FROM categories WHERE parent_id=0 AND name=?', n)).find(Boolean) || db.get('SELECT id FROM categories WHERE parent_id=0 ORDER BY sort,id LIMIT 1');
    const subName = (path[1] || c3).name.split(/[\/、]/)[0].slice(0, 10);
    cat = db.get('SELECT id FROM categories WHERE parent_id=? AND name=?', parent.id, subName) || { id: db.exec1('INSERT INTO categories(name,parent_id,sort,status,no_7day) VALUES(?,?,?,1,?)', subName, parent.id, 50, perishableNames(names) ? 1 : 0).lastInsertRowid };
  }
  db.exec1(`INSERT INTO supplier_category_map(supplier,supplier_cat_id,supplier_cat_name,supplier_path,category_id,perishable,reviewed,updated_at) VALUES(?,?,?,?,?,?,0,?)
    ON CONFLICT(supplier,supplier_cat_id) DO UPDATE SET category_id=excluded.category_id, supplier_path=excluded.supplier_path, updated_at=excluded.updated_at`, SUP, String(c3.id), c3.name, text, cat.id, perishableNames(names) ? 1 : 0, now());
  return db.get('SELECT * FROM supplier_category_map WHERE supplier=? AND supplier_cat_id=?', SUP, String(c3.id));
}
/** 后台修改映射:可选择同步到已导入商品 */
function updateMapping(catId, { category_id, perishable, apply }) {
  db.exec1('UPDATE supplier_category_map SET category_id=?, perishable=?, reviewed=1, updated_at=? WHERE supplier=? AND supplier_cat_id=?', category_id, perishable ? 1 : 0, now(), SUP, String(catId));
  let n = 0;
  if (apply) for (const p of db.all('SELECT id FROM products WHERE supplier=? AND supplier_cat=?', SUP, String(catId))) { db.exec1('UPDATE products SET category_id=?, is_perishable=? WHERE id=?', category_id, perishable ? 1 : 0, p.id); if (perishable) db.exec1('UPDATE products SET no_reason_return=0 WHERE id=?', p.id); n++; }
  return n;
}
async function pathOfIds(ids) { const idx = await categoryIndex(); return ids.map(id => idx[String(id)] || { id: String(id), name: '分类' + id }); }

// ================= 浏览(后台「供应商商品」) =================
// 后台选品页预览图:mock 用本地演示图;live 直接显示供应商图片(仅后台,前台商品图一律转存本站)
const adminImg = u => { if (cfg().mode !== 'mock') return u; const l = require('./mock').localImage(u); return l ? '/static/img/supplier-demo/' + require('path').basename(l) : U.PLACEHOLDER; };
async function browse({ cat1, cat2, cat3, q, page = 1, limit = 20 }) {
  const idx = await categoryIndex();
  const data = await client.call('searchGoodsList', { page: +page || 1, limit, categoryOne: cat1 ? +cat1 : undefined, categoryTwo: cat2 ? +cat2 : undefined, categoryThree: cat3 ? +cat3 : undefined, skuName: q || undefined });
  const list = (data && data.list || []).map(g => {
    const names = [g.categoryOneName, g.categoryTwoName, g.categoryThreeName];
    const imported = db.get('SELECT p.id, p.status, p.supplier_state FROM skus s JOIN products p ON p.id=s.product_id WHERE s.supplier_sku=? AND p.supplier=?', String(g.skuId), SUP);
    return { ...g, skuId: String(g.skuId), blocked: C.review(names), imported, img: adminImg(images.imageUrl(g.imagePath)), sale: validPrice(g.sellPrice) ? salePrice(+g.sellPrice, +g.retail) : null };
  });
  const cats = Object.values(idx);
  return { list, count: data ? data.count : 0, cats1: cats.filter(c => c.level === 1), cats2: cats.filter(c => c.level === 2 && (!cat1 || c.parentId === String(cat1))), cats3: cats.filter(c => c.level === 3 && (cat2 ? c.parentId === String(cat2) : !cat1 || cats.some(p => p.id === c.parentId && p.parentId === String(cat1)))) };
}

// ================= 导入 =================
// 数码电子类目判定:一级为数码/手机通讯,或二/三级为数码配件、电脑外设等(「电脑、办公 > 文具」不算)
const isDigital = path => C.isDigitalNames((path || []).map(c => c.name || ''));
const RR_OK = rr => +rr > 0; // returnRuleType 0=文案空(不支持),其余均为支持 7/15/30 天无理由(部分有拆封/使用后不支持的限制)
const escH = U.esc;
function buildDescription(d) {
  const rows = [];
  for (const a of d.categoryAttrList || []) rows.push([a.cateAttrName, (a.cateAttrValList || []).join('、')]);
  if (d.productArea) rows.push(['产地', d.productArea]); if (d.weight) rows.push(['重量', d.weight + ' kg']); if (d.saleUnit) rows.push(['售卖单位', d.saleUnit]);
  if (d.warrantDesc && d.warrantDesc !== '无质保') rows.push(['质保说明', d.warrantDesc]);
  const ware = C.stripJd(d.wareInfo || '');
  return (ware ? `<p><b>包装清单:</b>${escH(ware)}</p>` : '') + (rows.length ? '<table class="spec-t">' + rows.map(([k, v]) => `<tr><th>${escH(C.stripJd(k))}</th><td>${escH(C.stripJd(v))}</td></tr>`).join('') + '</table>' : '') + '<p class="muted">本商品由合作供应商发货,实际以收到的商品为准。</p>';
}
/** 导入一个 SKU(连同同一商品的其他规格)。返回 {ok, productId, status, note} */
async function importSku(skuId, { admin } = {}) {
  skuId = String(skuId);
  const ex = db.get('SELECT p.id FROM skus s JOIN products p ON p.id=s.product_id WHERE s.supplier_sku=? AND p.supplier=?', skuId, SUP);
  if (ex) return { ok: false, productId: ex.id, msg: `SKU ${skuId} 已导入(商品 #${ex.id})` };
  const raw = await client.call('searchGoodsDetail', { skuId });
  const d = raw && raw.detail ? raw.detail : raw; // TODO(文档歧义 #6):文档未写外层 detail,示例里有
  if (!d) return { ok: false, msg: '供应商未返回商品详情' };
  const path = await pathOfIds([d.category_one, d.category_two, d.category_three].filter(Boolean));
  const blocked = C.review(path.map(c => c.name));
  if (blocked) return { ok: false, blocked, msg: blocked.notAllowed ? `「${C.stripJd(d.skuName)}」的分类「${path.map(c => c.name).join(' / ')}」不在允许上架范围(经营范围变更前仅开放数码配件、电脑外设/网络设备、食用农产品),不能导入` : `「${C.stripJd(d.skuName)}」属于禁售类目「${blocked.group}」(命中「${blocked.kw}」),不能导入` };
  let sims = []; try { sims = await client.call('getSimilarSkuInfoList', { skuId }) || []; } catch (e) { sims = []; }
  if (!sims.length) sims = [{ sku_id: skuId, label: { 规格: d.color || d.size || '默认' }, imgList: (d.imageList || []).map(i => i.shortPath), imgPath: d.imagePath, sellPrice: d.sellPrice, retail: d.retail, skuName: d.skuName, returnRuleType: null, saleState: d.skuState === 1 ? 1 : 0 }];
  sims = sims.filter(s => !db.get('SELECT 1 FROM skus WHERE supplier_sku=?', String(s.sku_id)));
  // 以批量价格接口为准(V1/V2 结算价不同,文档要求以此接口为准)
  const ids = sims.map(s => String(s.sku_id));
  const prices = {}; for (const p of await client.call('getSellPrice', { skuIds: ids.join(',') }) || []) prices[String(p.skuId)] = p;
  const map = mapCategory(path);
  const perishable = !!map.perishable || !!(db.get('SELECT no_7day FROM categories WHERE id=?', map.category_id) || {}).no_7day || C.isFarmProduce(path.map(c => c.name));
  const specNames = [...new Set(sims.flatMap(s => Object.keys(s.label || {})))].slice(0, 3);
  if (!specNames.length) specNames.push('规格');
  const labelVals = sims.flatMap(s => Object.values(s.label || {}));
  let name = C.stripJd(d.spuName || d.skuName || ''); if (sims.length > 1) { const toks = name.split(/\s+/), keep = toks.filter((t, i) => i === 0 || !labelVals.some(v => v && (t === v || (t.startsWith(v) && t.length - v.length <= 2)))); name = keep.join(' '); } // 去掉规格值(如「白色」「39码」),规格单独展示
  name = name.replace(/\s+/g, ' ').trim().slice(0, 60) || '供应商商品';
  // 图片转存(主图 + 各规格图,去重,最多 6 张)
  const urls = [...new Set([...(d.imageList || []).sort((a, b) => (b.isPrimary || 0) - (a.isPrimary || 0) || a.orderSort - b.orderSort).map(i => images.imageUrl(i.shortPath)), images.imageUrl(d.defaultImagePath || d.imagePath), ...sims.flatMap(s => (s.imgList || [s.imgUrl || s.imgPath]).map(images.imageUrl))].filter(Boolean))].slice(0, 6);
  const stored = []; for (const u of urls) { const r = await images.store(u, { mode: cfg().mode }); if (r.ok && !stored.includes(r.path)) stored.push(r.path); }
  const imgs = stored.length ? stored : [U.PLACEHOLDER];
  const skus = sims.map(s => {
    const id = String(s.sku_id), pr = prices[id] || {};
    const cost = num(pr.sellPrice), retail = num(pr.retail);
    const ok = validPrice(cost) && +s.saleState !== 0;
    const attrs = {}; specNames.forEach(n => attrs[n] = (s.label || {})[n] || '默认');
    const sImg = (s.imgUrl || s.imgPath) ? images.imageUrl(s.imgUrl || s.imgPath) : null;
    return { supplier_sku: id, attrs, spec_text: Object.values(attrs).join(' / '), cost: ok ? cost : null, retail: validPrice(retail) ? retail : null, price: ok ? salePrice(cost, validPrice(retail) ? retail : 0) : 0, ok, rr: s.returnRuleType, sImg };
  });
  if (!skus.some(s => s.ok)) return { ok: false, msg: `SKU ${skuId} 当前不可售或不在商品池(价格为空/-1)` };
  const rrKnown = skus.filter(s => s.rr != null);
  const noReason = perishable ? 0 : rrKnown.length ? (rrKnown.every(s => RR_OK(s.rr)) ? 1 : 0) : null;
  // 数码电子首批只开放:京东自营 + 支持7天无理由(3C 认证以供应商资质为准);不满足的不导入
  if (isDigital(path)) {
    if (+d.selfSellType !== 1) return { ok: false, blocked: { group: '数码电子(仅限自营)', kw: '非自营' }, msg: `「${C.stripJd(d.skuName)}」是数码类非自营商品,首批只开放自营数码商品,不能导入` };
    if (noReason !== 1) return { ok: false, blocked: { group: '数码电子(须支持7天无理由)', kw: '不支持7天无理由' }, msg: `「${C.stripJd(d.skuName)}」是数码类商品但不支持7天无理由退货,不能导入` };
  }
  const description = buildDescription(d);
  const subtitle = '供应商直发';
  const B = require('../../banned'), hits = B.checkProduct({ name, subtitle, description }, skus);
  const note = hits.length ? '违禁/敏感词:' + B.summarize(hits) + ',请修改后再上架' : null;
  const vstock = Math.max(1, parseInt(S('jdvop_virtual_stock'), 10) || 200);
  const pid = db.transaction(() => {
    const dup = db.get('SELECT product_id FROM skus WHERE supplier_sku IN (' + skus.map(() => '?').join(',') + ') LIMIT 1', ...skus.map(x => x.supplier_sku));
    if (dup) return -dup.product_id; // 并发导入同一商品:以先导入的为准
    const row = { name, subtitle, category_id: map.category_id, brand_id: 0, supplier_brand: String(d.brand_name || d.brandName || '').trim().slice(0, 40), price: Math.min(...skus.filter(s => s.ok).map(s => s.price)), market_price: null, stock: 0, description, images: JSON.stringify(imgs), status: note ? 0 : 1, is_hot: 0, is_new: 0, template_id: 1, weight: num(d.weight) || 0.5, spec_names: specNames.join(','), sort: 0, created_at: now(),
      no_reason_return: noReason, supplier: SUP, supplier_spu: String(d.spuId || skuId), supplier_cat: String(path[path.length - 1].id), is_perishable: perishable ? 1 : 0, supplier_state: note ? 'pending_review' : 'ok', supplier_sync_at: now(), supplier_review_note: note };
    const ks = Object.keys(row); const id = db.prepare(`INSERT INTO products(${ks.join(',')}) VALUES(${ks.map(() => '?').join(',')})`).run(...ks.map(k => row[k])).lastInsertRowid;
    for (const s of skus) db.exec1('INSERT INTO skus(product_id,attrs,spec_text,price,stock,code,supplier_sku,cost_price,supplier_retail,return_rule_type) VALUES(?,?,?,?,?,?,?,?,?,?)', id, JSON.stringify(s.attrs), s.spec_text, s.price || 0.01, s.ok ? vstock : 0, '', s.supplier_sku, s.cost, s.retail, s.rr);
    db.exec1('UPDATE products SET stock=(SELECT COALESCE(SUM(stock),0) FROM skus WHERE product_id=?) WHERE id=?', id, id);
    return id;
  })();
  if (pid < 0) return { ok: false, productId: -pid, msg: `SKU ${skuId} 已导入(商品 #${-pid})` };
  return { ok: true, productId: pid, status: note ? 0 : 1, note, failedImages: urls.length - stored.length };
}
/** 已导入的待审核商品:后台编辑保存后重新检查,通过则允许上架 */
function recheckReview(pid) {
  const p = db.get('SELECT * FROM products WHERE id=?', pid); if (!p || p.supplier !== SUP || p.supplier_state !== 'pending_review') return null;
  const cat = C.review(namesOf(p)); if (cat) { db.exec1('UPDATE products SET status=0, supplier_review_note=? WHERE id=?', catNote(cat), pid); return false; }
  const B = require('../../banned'), hits = B.checkProduct(p, db.all('SELECT spec_text FROM skus WHERE product_id=?', pid));
  if (hits.length) { db.exec1('UPDATE products SET status=0, supplier_review_note=? WHERE id=?', '违禁/敏感词:' + B.summarize(hits) + ',请修改后再上架', pid); return false; }
  db.exec1("UPDATE products SET supplier_state='ok', supplier_review_note=NULL WHERE id=?", pid); return true;
}
/** 已导入商品的供应商分类路径(按分类映射记录) */
function namesOf(p) {
  const m = db.get('SELECT supplier_path, supplier_cat_name FROM supplier_category_map WHERE supplier=? AND supplier_cat_id=?', SUP, p.supplier_cat);
  return m && m.supplier_path ? m.supplier_path.split(' / ') : m ? [m.supplier_cat_name] : [];
}
const catNote = r => (r.notAllowed ? '经营范围外:' : '禁售类目:') + r.group;
/** 上架前校验(列表上下架/批量上架时调用):返回不能上架的原因或 null */
function listBlockReason(pid) {
  const p = db.get('SELECT supplier, supplier_state, supplier_review_note, supplier_cat, name FROM products WHERE id=?', pid);
  if (!p || p.supplier !== SUP) return null;
  const cat = C.review(namesOf(p)); if (cat) return `「${p.name}」${cat.notAllowed ? '不在允许上架范围' : '属于禁售类目'}(${cat.group}),不能上架`; // 清单改动后尚未刷新时也即时生效
  if (p.supplier_state === 'pending_review') return `「${p.name}」导入审核未通过:${p.supplier_review_note || ''}`;
  if (p.supplier_state === 'blocked') return `「${p.name}」属于禁售类目,不能上架`;
  if (p.supplier_state === 'auto_delisted') return `「${p.name}」供应商当前不可售,将在价格刷新恢复可售后自动上架`;
  return null;
}

// ================= 刷新价格/可售(定时 + 手动) =================
async function refreshProducts({ productIds } = {}) {
  const where = productIds && productIds.length ? `AND p.id IN (${productIds.map(Number).join(',')})` : '';
  const rows = db.all(`SELECT s.id, s.product_id, s.supplier_sku, s.price, s.cost_price, p.supplier_cat FROM skus s JOIN products p ON p.id=s.product_id WHERE p.supplier=? AND s.supplier_sku IS NOT NULL ${where}`, SUP);
  const res = { skus: rows.length, priceChanged: 0, unsellable: 0, delisted: 0, relisted: 0, errors: [] };
  const vstock = Math.max(1, parseInt(S('jdvop_virtual_stock'), 10) || 200);
  const pr = {}, sale = {};
  for (let i = 0; i < rows.length; i += 100) {
    const ids = rows.slice(i, i + 100).map(r => r.supplier_sku).join(',');
    try { for (const p of await client.call('getSellPrice', { skuIds: ids }) || []) pr[String(p.skuId)] = p; for (const s of await client.call('checkSkuSaleList', { skuIds: ids }) || []) sale[String(s.sku_id)] = +s.saleState; }
    catch (e) { res.errors.push(e.message); return finish(res); }
  }
  const idx = await categoryIndex().catch(() => ({}));
  db.transaction(() => {
    for (const r of rows) {
      const p = pr[r.supplier_sku] || {}, cost = num(p.sellPrice), retail = num(p.retail);
      const ok = validPrice(cost) && sale[r.supplier_sku] !== 0; // 价格为空/-1:不在商品池,下架
      if (!ok) { db.exec1('UPDATE skus SET stock=0 WHERE id=?', r.id); res.unsellable++; continue; }
      const np = salePrice(cost, validPrice(retail) ? retail : 0);
      if (Math.abs(np - r.price) > 0.001 || cost !== r.cost_price) res.priceChanged += Math.abs(np - r.price) > 0.001 ? 1 : 0;
      db.exec1('UPDATE skus SET cost_price=?, supplier_retail=?, price=?, stock=MAX(stock,?) WHERE id=?', cost, validPrice(retail) ? retail : null, np, vstock, r.id);
    }
    for (const pid of [...new Set(rows.map(r => r.product_id))]) {
      const p = db.get('SELECT * FROM products WHERE id=?', pid);
      const live = db.get('SELECT COUNT(*) n, MIN(price) mp, SUM(stock) st FROM skus WHERE product_id=? AND stock>0', pid);
      // 禁售清单可能被后台修改:重新检查
      const m = db.get('SELECT supplier_path FROM supplier_category_map WHERE supplier=? AND supplier_cat_id=?', SUP, p.supplier_cat);
      const names = m && m.supplier_path ? m.supplier_path.split(' / ') : [idx[p.supplier_cat] && idx[p.supplier_cat].name];
      const blocked = C.review(names);
      db.exec1('UPDATE products SET price=COALESCE(?,price), stock=COALESCE(?,0), supplier_sync_at=? WHERE id=?', live.mp, live.st, now(), pid);
      if (blocked) { if (p.status) res.delisted++; db.exec1("UPDATE products SET status=0, supplier_state='blocked', supplier_review_note=? WHERE id=?", catNote(blocked), pid); continue; }
      if (!live.n && p.status) { db.exec1("UPDATE products SET status=0, supplier_state='auto_delisted' WHERE id=?", pid); res.delisted++; }
      else if (live.n && (p.supplier_state === 'auto_delisted' || p.supplier_state === 'blocked')) {
        // 类目恢复允许后重新上架前,再做一次违禁词检查(被禁售覆盖掉的待审核状态不能绕过)
        const B = require('../../banned'), hits = p.supplier_state === 'blocked' ? B.checkProduct(p, db.all('SELECT spec_text FROM skus WHERE product_id=?', pid)) : [];
        if (hits.length) { db.exec1("UPDATE products SET status=0, supplier_state='pending_review', supplier_review_note=? WHERE id=?", '违禁/敏感词:' + B.summarize(hits) + ',请修改后再上架', pid); continue; }
        db.exec1("UPDATE products SET status=1, supplier_state='ok', supplier_review_note=NULL WHERE id=?", pid); res.relisted++;
      }
    }
  })();
  return finish(res);
  function finish(r) { if (!productIds) svc().setSetting('jdvop_last_sync', now() + ' ' + JSON.stringify({ skus: r.skus, priceChanged: r.priceChanged, delisted: r.delisted, relisted: r.relisted, errors: r.errors.length })); return r; }
}

/**
 * 本地复检(不调用供应商接口):允许/禁售清单修改后、服务启动时执行。
 * 已导入且不再通过类目审核的商品 → 自动下架(supplier_state=blocked,记录原因);恢复上架交给价格刷新(需确认可售)。
 * 只处理供应商商品,自营商品不动。
 */
function recheckCategories() {
  const res = { checked: 0, delisted: 0, blocked: 0 };
  db.transaction(() => {
    for (const p of db.all("SELECT id, status, supplier_cat, supplier_state FROM products WHERE supplier=? AND COALESCE(supplier_state,'')<>'removed'", SUP)) {
      res.checked++;
      const r = C.review(namesOf(p)); if (!r) continue;
      if (p.status) res.delisted++;
      if (p.status || p.supplier_state !== 'blocked') { db.exec1("UPDATE products SET status=0, supplier_state='blocked', supplier_review_note=? WHERE id=?", catNote(r), p.id); res.blocked++; }
    }
  })();
  return res;
}

// ================= 结算校验 =================
const addrText = a => `${a.province || ''}${a.city || ''}${a.district || ''}${a.detail || ''}`;
/** lines: quote 返回的行(含 supplier_sku);返回 {ok, errors[], freight, area, changed} */
async function checkout(lines, address) {
  const sl = lines.filter(l => l.supplier === SUP);
  if (!sl.length) return { ok: true, errors: [], freight: 0, area: null };
  if (!address || !address.province) return { ok: false, errors: ['请选择收货地址后再结算供应商发货商品'], freight: 0 };
  const errors = []; let area;
  try {
    area = await client.call('changeArea', { addressDetailStr: addrText(address) });
    if (!area || !area.provinceId) throw new Error('地址解析失败');
    await client.call('checkArea', { provinceId: +area.provinceId, cityId: +area.cityId, countyId: +area.countyId, townId: +area.townId || 0 });
  } catch (e) { return { ok: false, errors: ['收货地址无法识别,请检查省市区与详细地址(' + e.message + ')'], freight: 0 }; }
  const geo = { provinceId: +area.provinceId, cityId: +area.cityId, countyId: +area.countyId, townId: +area.townId || 0 };
  let freight = 0, changed = false;
  try {
    const lim = await client.call('checkAreaLimitList', { skuId: sl.map(l => l.supplier_sku).join(','), skuNum: '1', skuNumInfoList: sl.map(l => ({ skuId: l.supplier_sku, skuNumber: l.qty })), ...geo });
    for (const l of sl) { const r = (lim || []).find(x => String(x.skuId) === l.supplier_sku); if (!r || !r.isSell) errors.push(`「${l.name}」暂不可售`); else if (r.areaRestrict) errors.push(`「${l.name}」不支持配送到您的收货地区`); else if (!r.inStock) errors.push(`「${l.name}」在您的收货地区暂时无货`); }
    const prices = await client.call('getSellPrice', { skuIds: sl.map(l => l.supplier_sku).join(',') });
    for (const l of sl) {
      const p = (prices || []).find(x => String(x.skuId) === l.supplier_sku), cost = p && num(p.sellPrice), retail = p && num(p.retail);
      if (!validPrice(cost)) { errors.push(`「${l.name}」已下架`); db.exec1('UPDATE skus SET stock=0 WHERE supplier_sku=?', l.supplier_sku); continue; }
      const np = salePrice(cost, validPrice(retail) ? retail : 0), sku = db.get('SELECT id, price, product_id FROM skus WHERE supplier_sku=?', l.supplier_sku);
      db.exec1('UPDATE skus SET cost_price=?, supplier_retail=? WHERE id=?', cost, validPrice(retail) ? retail : null, sku.id);
      if (Math.abs(np - sku.price) > 0.001) { db.exec1('UPDATE skus SET price=? WHERE id=?', np, sku.id); db.exec1('UPDATE products SET price=(SELECT MIN(price) FROM skus WHERE product_id=? AND stock>0) WHERE id=?', sku.product_id, sku.product_id); errors.push(`「${l.name}」价格已更新为 ¥${np.toFixed(2)}(原 ¥${(+sku.price).toFixed(2)}),请确认后重新提交`); changed = true; }
    }
    const fr = await client.call('querySkuFreight', { ...geo, skuInfo: sl.map(l => ({ skuId: l.supplier_sku, skuNum: l.qty })) });
    freight = round2(num(fr && fr.totalFreight) || 0); // TODO(文档歧义 #9):运费金额单位(元/分)未说明,按「元」处理
  } catch (e) { return { ok: false, errors: ['供应商商品校验失败,请稍后重试(' + e.message + ')'], freight: 0, area: geo }; }
  return { ok: !errors.length, errors, freight, area: { ...geo, names: [area.provinceName, area.cityName, area.countyName, area.townName].filter(Boolean).join(' ') }, changed };
}

// ================= 推单(支付成功之后) =================
function supplierItems(oid) { return db.all('SELECT * FROM order_items WHERE order_id=? AND supplier=?', oid, SUP); }
/** 支付成功时调用(在 payOrder 事务内):登记待推送记录 */
function onPaid(oid) {
  const its = supplierItems(oid); if (!its.length) return;
  const o = db.get('SELECT * FROM orders WHERE id=?', oid);
  const goods = o.goods_amount || 1, supGoods = its.reduce((a, i) => a + i.price * i.qty, 0);
  const allSup = !db.get('SELECT 1 FROM order_items WHERE order_id=? AND (supplier IS NULL OR supplier<>?)', oid, SUP);
  const disc = (o.level_discount || 0) + (o.coupon_discount || 0) + (o.points_discount || 0);
  const share = allSup ? o.pay_amount : round2(Math.max(0, supGoods - disc * supGoods / goods) + (o.supplier_freight || 0));
  db.exec1("INSERT OR IGNORE INTO supplier_orders(order_id,supplier,out_order_sn,status,sale_amount,created_at,updated_at) VALUES(?,?,?,'pending',?,?,?)", oid, SUP, o.order_no, share, now(), now());
  trace(oid, '订单含供应商发货商品,已提交供应商备货');
}
let kicking = null;
/** 立即处理待推送订单(异步,不阻塞支付请求) */
function kick() {
  if (kicking) { kickState.again = true; return kicking; }
  const p = kickState;
  kicking = (async () => {
    await null;
    const done = new Set();
    try {
      do { p.again = false; for (const so of db.all("SELECT * FROM supplier_orders WHERE supplier=? AND status IN ('pending','submitted') AND (next_try_at IS NULL OR next_try_at<=?) ORDER BY id", SUP, now())) { if (done.has(so.id)) continue; done.add(so.id); await processOrder(so.id); } } while (p.again);
    } catch (e) { console.error('[jdvop] kick', e); } finally { kicking = null; }
  })();
  return kicking;
}
const kickState = { again: false };
const upd = (id, f) => { const ks = Object.keys(f); db.prepare(`UPDATE supplier_orders SET ${ks.map(k => k + '=?').join(',')}, updated_at=? WHERE id=?`).run(...ks.map(k => f[k]), now(), id); };
async function processOrder(soId) {
  let so = db.get('SELECT * FROM supplier_orders WHERE id=?', soId); if (!so || !['pending', 'submitted'].includes(so.status)) return so;
  const o = db.get('SELECT * FROM orders WHERE id=?', so.order_id);
  if (!o || !['paid', 'shipped'].includes(o.status)) { upd(so.id, { status: 'cancelled', error: '本站订单状态为 ' + (o ? o.status : '不存在') + ',未推送' }); return; }
  const its = supplierItems(o.id), maxTry = Math.max(1, parseInt(S('jdvop_max_push_attempts'), 10) || 3);
  const retryLater = e => { const n = so.attempts + 1; if (n >= maxTry) return fail(so, `${e.message}(已重试 ${n} 次)`, { uncertain: e.network }); upd(so.id, { attempts: n, error: e.message, next_try_at: U.offset(Math.min(30, 2 ** n) * 60000) }); alert(`订单 ${o.order_no} 推送供应商暂时失败,将自动重试:${e.message}`, o.id, 'warn'); };
  try {
    if (so.status === 'pending') {
      // 1) 实时价格:不能按本地存价扣款;成本价涨到高于顾客实付单价则不下单(避免亏本),自动退款
      const prices = await client.call('getSellPrice', { skuIds: its.map(i => i.supplier_sku).join(',') });
      for (const i of its) { const p = (prices || []).find(x => String(x.skuId) === i.supplier_sku), cost = p && num(p.sellPrice); if (!validPrice(cost)) return fail(so, `「${i.name}」已不在供应商商品池`); if (cost > i.price) return fail(so, `「${i.name}」供应商成本价上涨至 ¥${cost},高于售价 ¥${i.price}`); }
      // 2) 四级地址:结算时已转换;缺失则重新转换
      let area = o.supplier_area ? JSON.parse(o.supplier_area) : null;
      if (!area || !area.provinceId) { const a = await client.call('changeArea', { addressDetailStr: addrText(o) }); area = { provinceId: +a.provinceId, cityId: +a.cityId, countyId: +a.countyId, townId: +a.townId || 0 }; }
      // 3) 预下单(会扣预存款、锁库存)
      const r = await client.call('submitOrder', { outOrderSn: so.out_order_sn, skuInfo: its.map(i => ({ skuId: i.supplier_sku, skuNum: i.qty })), provinceId: area.provinceId, cityId: area.cityId, countyId: area.countyId, townId: area.townId || 0, consigneeAddress: o.detail, consigneeZip: '000000', consigneeName: o.receiver, consigneeMobile: o.phone, remark: (o.remark || '').slice(0, 100) });
      upd(so.id, { status: 'submitted', order_sn: String(r.orderSn), sys_order_id: r.orderId ? String(r.orderId) : null, deduction_price: num(r.deductionPrice), error: null, attempts: 0, next_try_at: null });
      trace(o.id, '供应商已接单,正在备货');
      so = db.get('SELECT * FROM supplier_orders WHERE id=?', so.id);
    }
    // 4) 确认订单(确认后才会发货)
    await client.call('confirmOrder', { outOrderSn: so.out_order_sn, orderSn: so.order_sn });
    upd(so.id, { status: 'confirmed', remote_status: 3, error: null, attempts: 0, next_try_at: null });
    await syncOrder(db.get('SELECT * FROM supplier_orders WHERE id=?', so.id)).catch(() => {});
  } catch (e) {
    if (e.network) return retryLater(e);
    if (so.status === 'submitted' && so.order_sn) { // 确认失败:先尝试取消供应商预下单,避免占用预存款
      try { await client.call('cancelOrder', { outOrderSn: so.out_order_sn, orderSn: so.order_sn, cancelReason: '确认失败自动取消' }); } catch (e2) { alert(`订单 ${o.order_no} 确认失败且取消供应商预下单失败,请人工处理:${e2.message}`, o.id); }
    }
    return fail(so, e.message);
  }
}
/** 推送失败:标记、自动退还顾客对应金额、后台告警 */
function fail(so, reason, { uncertain } = {}) {
  const o = db.get('SELECT * FROM orders WHERE id=?', so.order_id);
  upd(so.id, { status: 'failed', error: String(reason).slice(0, 300), attempts: so.attempts + 1, next_try_at: null });
  const r = refundShare(so, '供应商下单失败:' + reason);
  rollupShipped(o.id);
  trace(o.id, '供应商发货商品下单失败,' + (r.ok ? `已自动退款 ¥${r.cash.toFixed(2)}(原路退回)` : '退款待人工处理'));
  alert(`订单 ${o.order_no} 供应商下单失败:${reason}。${r.ok ? '已自动退款 ¥' + r.cash.toFixed(2) : '自动退款失败:' + r.msg}${uncertain ? '。注意:失败原因为网络错误,请到供应商后台核对是否已生成订单' : ''}`, o.id);
  svc().notifyService(o.user_id, 'staff', `【订单通知】很抱歉,您的订单 ${o.order_no} 中由供应商发货的商品暂时无法发货,已为您自动退款 ¥${(r.cash || 0).toFixed(2)}(原路退回)。`);
  return { ok: false, msg: reason };
}
/** 退还顾客「供应商部分」的金额(幂等:按 refunded_customer 记录) */
function refundShare(so, reason) {
  so = db.get('SELECT * FROM supplier_orders WHERE id=?', so.id);
  const o = db.get('SELECT * FROM orders WHERE id=?', so.order_id);
  const left = round2(so.sale_amount - (so.refunded_customer || 0)); if (left <= 0) return { ok: true, cash: 0 };
  const allSup = !db.get('SELECT 1 FROM order_items WHERE order_id=? AND (supplier IS NULL OR supplier<>?)', o.id, SUP);
  if (!['paid', 'shipped', 'completed'].includes(o.status)) return { ok: false, msg: '订单状态 ' + o.status + ' 不可退款', cash: 0 };
  const x = svc().refundOrder(o.id, reason, false, allSup ? {} : { amount: left });
  if (x.ok) upd(so.id, { refunded_customer: round2((so.refunded_customer || 0) + x.cash) });
  return x;
}

// ================= 订单状态同步(回调触发 / 轮询兜底) =================
async function syncOrder(so) {
  if (!so || !so.order_sn) return;
  const d = await client.call('getOrderDetail', { outOrderSn: so.out_order_sn, orderSn: so.order_sn });
  const info = d.orderInfo || {}, det = Array.isArray(d.orderDetail) ? d.orderDetail : d.orderDetail ? [d.orderDetail] : []; // TODO(文档歧义 #7):对象/列表两种写法都兼容
  upd(so.id, { remote_status: +info.orderStatus || null, settlement_price: num(d.settlementPrice) ?? so.settlement_price, sku_total: num(info.skuTotalPrice), freight: num(info.skuTotalFreight), charge_fee: num(info.chargeFee), last_polled_at: now() });
  if (+info.orderStatus === 4 && so.status !== 'cancelled') return onCancelled(so, '供应商订单已取消');
  // 未拆单时整单作为一个包裹;拆单后以子单为包裹(并移除尚未发货的整单占位包裹)
  const children = {}; for (const x of det) if (x.childOrderSn) (children[x.childOrderSn] = children[x.childOrderSn] || []).push(x);
  if (Object.keys(children).some(k => k !== so.order_sn)) { delete children[so.order_sn]; db.exec1("DELETE FROM order_packages WHERE order_id=? AND source=? AND child_order_sn=? AND tracking_nos='[]'", so.order_id, SUP, so.order_sn); }
  for (const [sn, rows] of Object.entries(children)) {
    const items = rows.map(x => ({ skuId: String(x.skuId), num: x.skuNum, name: C.stripJd(x.skuName) }));
    const cs = +rows[0].childOrderStatus, deliv = Math.min(...rows.map(x => +x.deliveredStatus || 3));
    db.exec1(`INSERT INTO order_packages(order_id,source,child_order_sn,items,status,remote_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(order_id,source,child_order_sn) DO UPDATE SET items=excluded.items, remote_status=excluded.remote_status, updated_at=excluded.updated_at`, so.order_id, SUP, sn, JSON.stringify(items), 'created', cs, now(), now());
    const pkg = db.get('SELECT * FROM order_packages WHERE order_id=? AND source=? AND child_order_sn=?', so.order_id, SUP, sn);
    if (cs === 4 || cs === 5) { db.exec1("UPDATE order_packages SET status='cancelled' WHERE id=?", pkg.id); continue; }
    if ((cs === 7 || cs === 1 || deliv <= 2) && JSON.parse(pkg.tracking_nos || '[]').length === 0) await syncDelivery(so, pkg);
    if (deliv === 1 && !pkg.delivered) { db.exec1("UPDATE order_packages SET delivered=1, delivered_at=?, status='delivered' WHERE id=?", now(), pkg.id); trace(so.order_id, `包裹 ${pkgLabel(pkg)} 已签收`); }
    if (cs === 1 && pkg.status !== 'completed') db.exec1("UPDATE order_packages SET status='completed' WHERE id=?", pkg.id);
  }
  rollupShipped(so.order_id);
}
const pkgLabel = p => '#' + p.id;
async function syncDelivery(so, pkg) {
  const d = await client.call('queryDeliveryInfo', { outOrderSn: so.out_order_sn, childOrderSn: pkg.child_order_sn });
  const nos = [...new Set((d.logisticInfoList || []).map(x => String(x.deliveryOrderId)).filter(Boolean))];
  if (!nos.length) return;
  const first = !JSON.parse(pkg.tracking_nos || '[]').length;
  db.exec1("UPDATE order_packages SET tracking_nos=?, company=?, status=CASE WHEN status IN ('created') THEN 'shipped' ELSE status END, shipped_at=COALESCE(shipped_at,?) WHERE id=?", JSON.stringify(nos), '供应商物流', now(), pkg.id);
  if (first) {
    trace(so.order_id, `包裹 ${pkgLabel(pkg)} 已由供应商发货,运单号 ${nos.join('、')}`);
    const last = (d.trackInfoList || []).slice(-1)[0]; if (last) trace(so.order_id, `包裹 ${pkgLabel(pkg)}:${C.stripTrace(last.trackContent)}`);
  }
}
/** 所有部分(自营 + 供应商包裹)都已发货 → 本站订单变为「待收货」 */
function rollupShipped(oid) {
  const o = db.get('SELECT * FROM orders WHERE id=?', oid); if (!o || o.status !== 'paid') return;
  const so = db.get('SELECT * FROM supplier_orders WHERE order_id=? AND supplier=?', oid, SUP);
  const supActive = so && !['failed', 'cancelled'].includes(so.status);
  const ownItems = db.get('SELECT COUNT(*) n FROM order_items WHERE order_id=? AND (supplier IS NULL OR supplier<>?)', oid, SUP).n;
  if (ownItems && !o.own_shipped_at) return;
  if (supActive) {
    const its = supplierItems(oid), pk = db.all("SELECT * FROM order_packages WHERE order_id=? AND source=? AND status<>'cancelled'", oid, SUP);
    const shipped = new Set(pk.filter(p => JSON.parse(p.tracking_nos || '[]').length).flatMap(p => JSON.parse(p.items).map(i => i.skuId)));
    if (!its.every(i => shipped.has(i.supplier_sku))) return;
  } else if (!ownItems) return;
  const firstPkg = db.get("SELECT * FROM order_packages WHERE order_id=? AND tracking_nos<>'[]' ORDER BY id LIMIT 1", oid);
  db.exec1("UPDATE orders SET status='shipped', shipped_at=?, express_company=COALESCE(express_company,?), tracking_no=COALESCE(tracking_no,?) WHERE id=?", now(), firstPkg ? firstPkg.company : '供应商物流', firstPkg ? JSON.parse(firstPkg.tracking_nos)[0] : null, oid);
  trace(oid, '订单商品已全部发货' + (db.get('SELECT COUNT(*) n FROM order_packages WHERE order_id=?', oid).n > 1 ? '(分多个包裹配送)' : ''));
}
/** 混合订单中自营部分发货(svc.shipOrder 调用) */
function ownShipped(oid, company, tracking) {
  db.exec1("INSERT INTO order_packages(order_id,source,child_order_sn,company,tracking_nos,items,status,shipped_at,created_at,updated_at) VALUES(?,?,?,?,?,?,'shipped',?,?,?) ON CONFLICT(order_id,source,child_order_sn) DO UPDATE SET company=excluded.company, tracking_nos=excluded.tracking_nos",
    oid, 'own', 'own', company, JSON.stringify([tracking]), JSON.stringify(db.all('SELECT name, qty num FROM order_items WHERE order_id=? AND (supplier IS NULL OR supplier<>?)', oid, SUP)), now(), now(), now());
  db.exec1('UPDATE orders SET own_shipped_at=?, express_company=?, tracking_no=? WHERE id=?', now(), company, tracking, oid);
  rollupShipped(oid);
}
function onCancelled(so, reason) {
  so = db.get('SELECT * FROM supplier_orders WHERE id=?', so.id);
  if (so.status === 'cancelled' && round2(so.sale_amount - (so.refunded_customer || 0)) <= 0) return;
  upd(so.id, { status: 'cancelled', remote_status: 4, supplier_refund: so.deduction_price || so.supplier_refund || 0 });
  const r = refundShare(so, reason);
  const o = db.get('SELECT order_no, user_id FROM orders WHERE id=?', so.order_id);
  trace(so.order_id, '供应商发货商品已取消' + (r.ok && r.cash ? `,已退款 ¥${r.cash.toFixed(2)}(原路退回)` : ''));
  alert(`订单 ${o.order_no} 供应商订单已取消(${reason})${r.ok ? (r.cash ? ',已自动退款 ¥' + r.cash.toFixed(2) : '') : ',退款失败:' + r.msg}`, so.order_id, r.ok ? 'warn' : 'error');
  rollupShipped(so.order_id);
}
/** 后台:取消供应商订单 */
async function cancelSupplierOrder(soId, reason) {
  const so = db.get('SELECT * FROM supplier_orders WHERE id=?', soId); if (!so) return { ok: false, msg: '供应商订单不存在' };
  if (so.status === 'pending') { upd(so.id, { status: 'cancelled', error: '未推送前由后台取消' }); onCancelled(so, '后台取消(未推送)'); return { ok: true, msg: '已取消(尚未推送供应商),已退款' }; }
  if (!['submitted', 'confirmed'].includes(so.status)) return { ok: false, msg: '当前状态不可取消' };
  const en = await client.call('queryOrderCancelEnable', { orderSn: so.order_sn });
  const e = (en || [])[0]; if (!e || !e.cancelFlag) return { ok: false, msg: '供应商不允许取消:' + ((e && e.reasonMessage) || '已出库') + '。已发货订单需联系供应商客服拦截,或由顾客拒收后走售后' };
  await client.call('cancelOrder', { outOrderSn: so.out_order_sn, orderSn: so.order_sn, cancelReason: String(reason || '商家取消').slice(0, 50) });
  upd(so.id, { status: 'cancelling' });
  if (cfg().mode === 'mock') setImmediate(() => simulate(so.id, 'cancelled').catch(() => {}));
  return { ok: true, msg: '已向供应商提交取消,收到取消/退款回调后自动退款给顾客' };
}
async function retry(soId) {
  const so = db.get('SELECT * FROM supplier_orders WHERE id=?', soId); if (!so) return { ok: false, msg: '不存在' };
  if (['pending', 'submitted'].includes(so.status)) { upd(so.id, { next_try_at: null }); await processOrder(so.id); }
  else if (['confirmed', 'cancelling'].includes(so.status)) await syncOrder(so);
  else return { ok: false, msg: '失败订单已自动退款,不能重新推送;如需补发请让顾客重新下单' };
  const n = db.get('SELECT status, error FROM supplier_orders WHERE id=?', so.id);
  return { ok: !['failed'].includes(n.status), msg: '当前状态:' + n.status + (n.error ? '(' + n.error + ')' : '') };
}

// ================= 回调 =================
function verifyCallback(payload, query) {
  const c = cfg();
  if (!payload || typeof payload !== 'object' || !payload.data || payload.data.type == null) return '报文格式错误';
  if (payload.interfaceTypeCode && payload.interfaceTypeCode !== 'jd_mall_interface') return 'interfaceTypeCode 不匹配';
  const eq = (a, b) => { a = Buffer.from(String(a || '')); b = Buffer.from(String(b || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };
  // TODO(文档未说明验签方式):目前采用「回调地址带 token」+「tenantAppId 比对」;且所有状态都会回查接口确认后才改账
  if (c.callbackToken && !eq(query && query.token, c.callbackToken)) return 'token 校验失败';
  if (c.callbackTenantAppId && !eq(payload.tenantAppId, c.callbackTenantAppId)) return 'tenantAppId 不匹配';
  if (c.mode === 'live' && !c.callbackToken && !c.callbackTenantAppId) return '正式环境未配置 JDVOP_CALLBACK_TOKEN / JDVOP_CALLBACK_TENANT_APP_ID,拒绝回调';
  return null;
}
const findSoBySn = sn => sn ? db.get('SELECT * FROM supplier_orders WHERE supplier=? AND order_sn=?', SUP, String(sn)) : null;
function findSoByChild(sn) { const p = db.get('SELECT order_id FROM order_packages WHERE source=? AND child_order_sn=?', SUP, String(sn)); return p ? db.get('SELECT * FROM supplier_orders WHERE order_id=? AND supplier=?', p.order_id, SUP) : findSoBySn(sn); }
async function locate(childSn) {
  let so = findSoByChild(childSn); if (so) return so;
  for (const s of db.all("SELECT * FROM supplier_orders WHERE supplier=? AND status IN ('confirmed','cancelling') ORDER BY id DESC LIMIT 20", SUP)) { await syncOrder(s).catch(() => {}); so = findSoByChild(childSn); if (so) return so; } // 漏收拆单消息时:回查最近订单
  return null;
}
/** 处理回调;返回 {ok, duplicate?, msg} */
async function handleCallback(payload, { query } = {}) {
  const bad = verifyCallback(payload, query); if (bad) return { ok: false, status: 403, msg: bad };
  const d = payload.data, type = String(d.type);
  const key = crypto.createHash('sha256').update([type, d.pOrderSn, d.childOrderSn, d.afsSn, d.skuId, d.skuState, d.refundAmount, d.createTime].map(x => x == null ? '' : String(x)).join('|')).digest('hex');
  const ins = db.exec1('INSERT OR IGNORE INTO supplier_callbacks(supplier,dedup_key,type,payload,created_at) VALUES(?,?,?,?,?)', SUP, key, type, JSON.stringify(payload).slice(0, 4000), now());
  if (!ins.changes) return { ok: true, duplicate: true, msg: '重复回调,已忽略' };
  let result;
  try { result = await dispatch(type, d); } catch (e) { result = '处理失败:' + e.message; alert(`回调处理失败(type=${type}):${e.message},轮询任务会继续兜底`, null, 'warn'); }
  db.exec1('UPDATE supplier_callbacks SET result=? WHERE dedup_key=?', String(result || 'ok').slice(0, 300), key);
  return { ok: true, msg: result || 'ok' };
}
async function dispatch(type, d) {
  if (['1', '2', '3'].includes(type)) { const p = db.get('SELECT product_id FROM skus WHERE supplier_sku=?', String(d.skuId)); if (p) await refreshProducts({ productIds: [p.product_id] }); return '商品已刷新'; }
  if (type === '11') { const so = findSoBySn(d.pOrderSn); if (!so) return '未找到订单'; await syncOrder(so); return '拆单已同步'; }
  if (['10', '13', '14', '18'].includes(type)) { const so = await locate(d.childOrderSn); if (!so) return '未找到子单'; await syncOrder(so); return '已同步'; }
  if (['12', '15', '16'].includes(type)) {
    const so = findSoBySn(d.pOrderSn) || await locate(d.childOrderSn); if (!so) return '未找到订单';
    await syncOrder(so).catch(() => {}); const s2 = db.get('SELECT * FROM supplier_orders WHERE id=?', so.id);
    if (s2.status !== 'cancelled' && (s2.remote_status === 4 || cfg().mode === 'mock')) onCancelled(s2, type === '16' ? '确认后取消,供应商已退款' : '供应商订单已取消');
    return '取消已处理';
  }
  if (type === '119') return onAfsRefund(d);
  return '忽略的类型 ' + type;
}

// ================= 售后 =================
const genAfsSn = () => 'CG' + U.now().replace(/[-: ]/g, '').slice(2) + U.randCode(4); // ≤20 位
async function afsEnable(order, pkg, skuId) {
  const r = await client.call('queryAfsEnable', { skuIds: String(skuId), childOrderSn: pkg.child_order_sn });
  return (r || []).find(x => String(x.skuId) === String(skuId)) || null;
}
/** 后台为订单中供应商商品创建售后 */
async function createAftersale(admin, o, b) {
  const pkg = db.get('SELECT * FROM order_packages WHERE id=? AND order_id=? AND source=?', parseInt(b.package_id, 10), o.id, SUP); if (!pkg) return { msg: '请选择包裹' };
  const skuId = String(b.sku || ''); const item = db.get('SELECT * FROM order_items WHERE order_id=? AND supplier_sku=?', o.id, skuId); if (!item || !JSON.parse(pkg.items).some(i => i.skuId === skuId)) return { msg: '请选择包裹内的商品' };
  if (db.get("SELECT 1 FROM aftersales WHERE order_id=? AND status IN ('pending','approved_return','returned')", o.id)) return { msg: '该订单已有进行中的售后单' };
  const qty = Math.max(1, parseInt(b.qty, 10) || 1), afsType = +b.afs_type === 2 ? 2 : 1, pickType = [1, 2, 3].includes(+b.pick_type) ? +b.pick_type : 1;
  const reason = String(b.reason || '').trim().slice(0, 50); if (!reason) return { msg: '请填写售后原因' };
  const imgs = String(b.images || '').split(/[\s,]+/).filter(u => /^https?:\/\//.test(u)).slice(0, 5); if (!imgs.length) return { msg: '供应商要求上传问题图片(需公网可访问的图片链接)' };
  const refunded = db.get("SELECT COALESCE(SUM(refund_cash),0) c FROM aftersales WHERE order_id=? AND status='refunded'", o.id).c + ((db.get('SELECT refunded_customer FROM supplier_orders WHERE order_id=?', o.id) || {}).refunded_customer || 0);
  const max = round2(Math.max(0, o.pay_amount - refunded));
  const amount = afsType === 2 ? 0 : round2(Math.min(max, b.amount === undefined || b.amount === '' ? item.price * qty : +b.amount));
  if (!(amount >= 0)) return { msg: '退款金额无效' };
  const en = await afsEnable(o, pkg, skuId);
  if (!en || +en.enable !== 1) return { msg: '供应商返回:该商品当前不可申请售后' };
  if (qty > +en.num) return { msg: `供应商返回:最多可申请 ${en.num} 件` };
  if (en.supportedAfsTypes && !en.supportedAfsTypes.some(t => +t.value === afsType)) return { msg: '供应商不支持该售后类型' };
  const area = o.supplier_area ? JSON.parse(o.supplier_area) : {}; const afsSn = genAfsSn();
  await client.call('createAfs', { orderNo: (db.get('SELECT order_sn FROM supplier_orders WHERE order_id=?', o.id) || {}).order_sn, afsSn, childOrderSn: pkg.child_order_sn, skuId, skuNum: qty, afsType, pickType, questionDesc: reason + (b.note ? ':' + String(b.note).slice(0, 200) : ''), questionImg: imgs.join(','),
    afsProvinceId: area.provinceId, afsCityId: area.cityId, afsAreaId: area.countyId, afsStreetId: area.townId || 0, afsDetail: o.detail, backProvinceId: area.provinceId, backCityId: area.cityId, backAreaId: area.countyId, backStreetId: area.townId || 0, backDetail: o.detail, name: o.receiver, phone: o.phone });
  // TODO(文档歧义 #10):创建成功不返回供应商售后单号,只能用我们自己的 afsSn 跟踪
  const id = db.exec1(`INSERT INTO aftersales(order_id,user_id,type,reason,description,amount,status,created_by,created_at,updated_at,supplier,supplier_afs_sn,supplier_child_sn,supplier_sku,supplier_qty,supplier_afs_type,supplier_pick_type) VALUES(?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?)`,
    o.id, o.user_id, afsType === 2 ? 'quality' : 'refund_return', reason, String(b.note || '').slice(0, 500), amount, admin, now(), now(), SUP, afsSn, pkg.child_order_sn, skuId, qty, afsType, pickType).lastInsertRowid;
  trace(o.id, `客服已为供应商商品创建售后单(${afsType === 2 ? '换货' : '退货退款'})`);
  svc().notifyService(o.user_id, 'staff', `【售后通知】已为您的订单 ${o.order_no} 创建售后单 #${id}(${afsType === 2 ? '换货' : '退货退款'}${amount ? ',预计退款 ¥' + amount.toFixed(2) : ''})。${pickType === 1 ? '物流人员将联系您上门取件' : '退货地址将以短信通知您'},退款在供应商确认后原路退回。`);
  return { ok: true, id };
}
const AFS_MAP = a => a.applyStatus === 7 ? 'cancelled' : a.afsStatus === 3 ? 'rejected' : a.refundStatus === 3 ? 'refunded' : a.afsStatus === 2 && a.afsType === 2 ? 'exchanged' : a.applyStatus >= 3 ? 'returned' : a.applyStatus === 2 ? 'approved_return' : 'pending';
async function syncAftersale(asId) {
  const a = db.get('SELECT * FROM aftersales WHERE id=?', asId); if (!a || a.supplier !== SUP) return null;
  const r = ((await client.call('queryAfs', { childOrderSn: a.supplier_child_sn, afsSn: a.supplier_afs_sn })) || [])[0];
  if (!r) return null;
  db.exec1('UPDATE aftersales SET supplier_status=?, updated_at=? WHERE id=?', JSON.stringify(r), now(), a.id);
  const target = AFS_MAP(r);
  if (target === 'refunded') { await confirmAfsRefund(a, null, r); return 'refunded'; } // 查询结果「退款成功」作为回调兜底
  if (['pending', 'approved_return', 'returned'].includes(a.status) && target !== a.status) {
    db.exec1('UPDATE aftersales SET status=?, admin_note=?, updated_at=? WHERE id=?', target, '供应商:' + [r.applyStatusText, r.afsStatusText].filter(Boolean).join(' / '), now(), a.id);
    if (target === 'rejected') svc().notifyService(a.user_id, 'staff', `【售后通知】售后单 #${a.id}:供应商审核未通过,客服会与您联系。`);
  }
  return target;
}
async function onAfsRefund(d) {
  let a = d.afsSn ? db.get('SELECT * FROM aftersales WHERE supplier=? AND supplier_afs_sn=?', SUP, String(d.afsSn)) : null;
  if (!a && d.childOrderSn) a = db.get("SELECT * FROM aftersales WHERE supplier=? AND supplier_child_sn=? AND status IN ('pending','approved_return','returned') ORDER BY id DESC", SUP, String(d.childOrderSn));
  if (!a) { const so = d.childOrderSn ? findSoByChild(d.childOrderSn) : null; alert(`收到供应商售后退款 ¥${d.refundAmount || '?'}(子单 ${d.childOrderSn || '-'},售后单 ${d.afsSn || '-'}),未找到对应售后单(可能是顾客直接联系了供应商客服),请人工核对是否需要退款给顾客`, so && so.order_id); return '未匹配售后单,已告警'; }
  const r = ((await client.call('queryAfs', { childOrderSn: a.supplier_child_sn, afsSn: a.supplier_afs_sn })) || [])[0];
  if (!r || +r.refundStatus !== 3) { alert(`售后单 #${a.id} 收到退款回调但查询结果尚未「退款成功」,暂不退款给顾客,轮询会继续确认`, a.order_id, 'warn'); return '待确认'; }
  await confirmAfsRefund(a, num(d.refundAmount), r); return '售后退款已处理';
}
/** 供应商退款已确认 → 才给顾客退款(幂等) */
async function confirmAfsRefund(a, supplierAmount, r) {
  a = db.get('SELECT * FROM aftersales WHERE id=?', a.id); if (a.status === 'refunded' || a.supplier_refunded_at) return;
  db.exec1('UPDATE aftersales SET supplier_refund_amount=COALESCE(?,supplier_refund_amount), supplier_refunded_at=?, supplier_status=? WHERE id=?', supplierAmount, now(), JSON.stringify(r || {}), a.id);
  if (a.supplier_afs_type === 2 || !(a.amount > 0)) { db.exec1("UPDATE aftersales SET status='exchanged', updated_at=? WHERE id=?", now(), a.id); return; }
  const x = svc().refundOrder(a.order_id, '供应商售后退款:' + a.reason, false, { amount: a.amount, aftersale: true });
  if (!x.ok) { alert(`售后单 #${a.id} 供应商已退款,但给顾客退款失败:${x.msg}`, a.order_id); return; }
  db.exec1("UPDATE aftersales SET status='refunded', admin_note=?, refund_cash=?, refund_points=?, refund_channel='原路退回', refunded_at=?, updated_at=? WHERE id=?", '供应商已确认退款', x.cash, x.points, now(), now(), a.id);
  const so = db.get('SELECT * FROM supplier_orders WHERE order_id=?', a.order_id); if (so) upd(so.id, { supplier_refund: round2((so.supplier_refund || 0) + (supplierAmount || 0)) });
  svc().notifyService(a.user_id, 'staff', `【售后通知】售后单 #${a.id}:退款已完成,退现金 ¥${x.cash.toFixed(2)}(原路退回)` + (x.points ? `,退积分 ${x.points}` : '') + '。');
}
async function afsAction(asId, act, b = {}) {
  const a = db.get('SELECT * FROM aftersales WHERE id=?', asId); if (!a || a.supplier !== SUP) return { ok: false, msg: '不是供应商售后单' };
  if (act === 'sync') { const t = await syncAftersale(a.id); return { ok: true, msg: '已刷新:' + (U.AFTERSALE_STATUS[t] || t || '无数据') }; }
  if (act === 'send') {
    const code = String(b.express_code || '').trim(), comp = String(b.express_company || '').trim(); if (!code || !comp) return { ok: false, msg: '请填写快递公司与运单号' };
    const o = db.get('SELECT phone FROM orders WHERE id=?', a.order_id);
    await client.call('updateSendInfo', { childOrderSn: a.supplier_child_sn, afsSn: a.supplier_afs_sn, cpin: o.phone, skuId: a.supplier_sku, skuNum: a.supplier_qty, expressCode: code, expressCompany: comp, freightMoney: String(b.freight || '0'), deliverDate: now() });
    db.exec1("UPDATE aftersales SET return_express=?, return_tracking=?, status=CASE WHEN status IN ('pending','approved_return') THEN 'returned' ELSE status END, updated_at=? WHERE id=?", comp, code, now(), a.id); return { ok: true, msg: '寄回运单已提交供应商' };
  }
  if (act === 'cancel') { await client.call('cancelAfs', { childOrderSn: a.supplier_child_sn, afsSn: a.supplier_afs_sn, reason: String(b.reason || '客户取消').slice(0, 50) }); db.exec1("UPDATE aftersales SET status='cancelled', updated_at=? WHERE id=?", now(), a.id); return { ok: true, msg: '已取消供应商售后申请' }; }
  if (act === 'confirm') { await client.call('confirmAfs', { childOrderSn: a.supplier_child_sn, afsSn: a.supplier_afs_sn }); return { ok: true, msg: '已确认售后完成' }; }
  return { ok: false, msg: '未知操作' };
}

// ================= mock 模拟推进 =================
async function simulate(soId, action) {
  if (cfg().mode !== 'mock') throw new Error('仅 mock 模式可模拟');
  const so = db.get('SELECT * FROM supplier_orders WHERE id=?', soId); if (!so || !so.order_sn) throw new Error('该订单尚未推送到供应商');
  const msgs = require('./mock').simulate(action, { orderSn: so.order_sn });
  for (const m of msgs) await handleCallback(m, { query: { token: cfg().callbackToken } });
  return msgs.length;
}
async function simulateAfs(asId, action) {
  if (cfg().mode !== 'mock') throw new Error('仅 mock 模式可模拟');
  const a = db.get('SELECT * FROM aftersales WHERE id=?', asId);
  const msgs = require('./mock').simulate(action, { afsSn: a.supplier_afs_sn });
  for (const m of msgs) await handleCallback(m, { query: { token: cfg().callbackToken } });
  await syncAftersale(a.id);
  return msgs.length;
}

// ================= 轮询兜底 & 定时任务 =================
async function poll() {
  const res = { orders: 0, aftersales: 0 };
  await kick();
  for (const so of db.all("SELECT * FROM supplier_orders WHERE supplier=? AND status IN ('confirmed','cancelling') ORDER BY COALESCE(last_polled_at,'') LIMIT 50", SUP)) {
    try {
      if (cfg().mode === 'mock' && S('jdvop_mock_auto') === '1') for (const m of require('./mock').autoStep(so.order_sn)) await handleCallback(m, { query: { token: cfg().callbackToken } });
      await syncOrder(so); res.orders++;
    } catch (e) { console.error('[jdvop] poll order', so.id, e.message); }
  }
  for (const a of db.all("SELECT id FROM aftersales WHERE supplier=? AND status IN ('pending','approved_return','returned') LIMIT 50", SUP)) { try { await syncAftersale(a.id); res.aftersales++; } catch (e) { console.error('[jdvop] poll afs', a.id, e.message); } }
  svc().setSetting('jdvop_last_poll', now());
  return res;
}
let busy = false;
/** 每分钟调用:到点则执行刷新/轮询(进程内定时器;多实例部署需改为单实例任务) */
async function tick() {
  if (busy) return; busy = true;
  try {
    if (db.get("SELECT 1 FROM supplier_orders WHERE status IN ('pending','submitted') AND (next_try_at IS NULL OR next_try_at<=?)", now())) await kick();
    const pm = Math.max(1, parseInt(S('jdvop_poll_minutes'), 10) || 10), lp = S('jdvop_last_poll');
    if (!lp || U.parseDate(lp) < new Date(Date.now() - pm * 60000)) await poll();
    const sh = parseFloat(S('jdvop_sync_hours')) || 0, ls = (S('jdvop_last_sync') || '').slice(0, 19);
    if (sh > 0 && db.get('SELECT 1 FROM products WHERE supplier=? LIMIT 1', SUP) && (!ls || U.parseDate(ls) < new Date(Date.now() - sh * 3600000))) await refreshProducts();
  } catch (e) { console.error('[jdvop] tick', e.message); } finally { busy = false; }
}

// ================= 对账 =================
function reconcile({ from, to } = {}) {
  const where = ['so.supplier=?'], p = [SUP];
  if (/^\d{4}-\d{2}-\d{2}$/.test(from || '')) { where.push('o.created_at>=?'); p.push(from + ' 00:00:00'); }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to || '')) { where.push('o.created_at<=?'); p.push(to + ' 23:59:59'); }
  const rows = db.all(`SELECT so.*, o.order_no, o.status ostatus, o.created_at ocreated FROM supplier_orders so JOIN orders o ON o.id=so.order_id WHERE ${where.join(' AND ')} ORDER BY so.id DESC LIMIT 500`, ...p).map(r => {
    const afsRefund = db.get("SELECT COALESCE(SUM(refund_cash),0) c, COALESCE(SUM(supplier_refund_amount),0) s FROM aftersales WHERE order_id=? AND supplier=? AND status='refunded'", r.order_id, SUP);
    const cost = r.settlement_price ?? r.deduction_price ?? 0;
    const custRefund = round2((r.refunded_customer || 0) + afsRefund.c), supRefund = round2(r.status === 'cancelled' ? cost : afsRefund.s);
    const pushed = ['submitted', 'confirmed', 'cancelling', 'cancelled'].includes(r.status) && r.order_sn;
    const costNet = pushed ? round2(cost - supRefund) : 0, saleNet = round2(r.sale_amount - custRefund);
    return { ...r, cost: pushed ? cost : 0, custRefund, supRefund, saleNet, costNet, margin: round2(saleNet - costNet) };
  });
  const sum = k => round2(rows.reduce((a, r) => a + (r[k] || 0), 0));
  return { rows, total: { sale: sum('sale_amount'), custRefund: sum('custRefund'), cost: sum('cost'), supRefund: sum('supRefund'), margin: sum('margin') } };
}

// ================= 演示环境自动导入(仅 mock + DEMO_MODE=1,且库内还没有供应商商品) =================
// 走正常导入流程:禁售类目不导入,违禁词商品导入为待审核/下架,其余上架并显示「演示」「由供应商发货」
let seeding = null;
function demoSeedEnabled() { return cfg().mode === 'mock' && process.env.DEMO_MODE === '1' && process.env.JDVOP_DEMO_SEED !== '0'; }
function demoSeed() {
  if (seeding) return seeding;
  if (!demoSeedEnabled()) return Promise.resolve({ skipped: 'not mock+demo' });
  if (db.get('SELECT 1 FROM products WHERE supplier=? LIMIT 1', SUP)) return Promise.resolve({ skipped: 'already has supplier products' });
  svc().setSetting('jdvop_demo_seed', 'running ' + now());
  seeding = (async () => {
    const res = { imported: [], pending: [], skipped: [] };
    try {
      for (const sku of require('./mock').SKUS) {
        if (cfg().mode !== 'mock') break; // 防御:模式变化立即停止
        if (db.get('SELECT 1 FROM skus WHERE supplier_sku=?', String(sku.skuId))) continue; // 同款其他规格已随主 SKU 导入
        try { const x = await importSku(sku.skuId); if (x.ok) (x.note ? res.pending : res.imported).push(x.productId); else res.skipped.push(sku.skuId + ':' + x.msg); }
        catch (e) { res.skipped.push(sku.skuId + ':' + e.message); }
      }
      // 演示:给自动导入的商品设置推荐排序权重,与自营商品在「全部商品」首页交错显示(后台可改)
      // 首页「好物精选」演示固定为以新鲜农产品为主的 6 个自营演示商品(seed-texts.DEMO_PICK_SORT),供应商演示商品排在其后
      const picks = Object.keys(require('../../seed-texts').DEMO_PICK_SORT);
      const top = (db.get(`SELECT MAX(sort) m FROM products WHERE supplier IS NULL AND status=1 AND name NOT IN (${picks.map(() => '?').join(',')})`, ...picks) || {}).m || 0;
      res.imported.forEach((id, i) => db.exec1('UPDATE products SET sort=? WHERE id=?', Math.max(0, top - i), id));
      console.log(`[jdvop] 演示商品自动导入:上架 ${res.imported.length},待审核 ${res.pending.length},未导入 ${res.skipped.length}`);
    } catch (e) { console.error('[jdvop] demoSeed', e); }
    finally { svc().setSetting('jdvop_demo_seed', 'done ' + now() + ' ' + JSON.stringify({ imported: res.imported.length, pending: res.pending.length, skipped: res.skipped.length })); seeding = null; }
    return res;
  })();
  return seeding;
}

module.exports = { recheckCategories, demoSeed, demoSeedEnabled, salePrice, browse, importSku, recheckReview, listBlockReason, refreshProducts, checkout, onPaid, kick, processOrder, retry, cancelSupplierOrder, ownShipped, rollupShipped, syncOrder, handleCallback, verifyCallback, createAftersale, syncAftersale, afsAction, simulate, simulateAfs, poll, tick, reconcile, updateMapping, categoryIndex, mapCategory, alert, SUP, isDemo };
