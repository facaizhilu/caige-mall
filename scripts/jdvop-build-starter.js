#!/usr/bin/env node
// 生成演示站启动导入快照 lib/suppliers/jdvop/starter-catalog.json(只调用只读查询接口:searchAllCategory / searchGoodsList / searchGoodsDetail / getSimilarSkuInfoList)。
// 快照含商品名、图片、图文详情图片、规格、类目(不含价格:启动导入时批量查实时价格与可售),演示站启动导入不再逐个调详情接口。
// 选品:按「当前允许上架」的三级类目逐类分页浏览,按本站分类设目标数,各三级类目轮流取;跳过禁售/不在允许范围/加工蛋品与加工农产品/数码非自营/无价/同款其他规格。
// 用法(经中转,本机无需密钥): JDVOP_MODE=live JDVOP_RELAY_URL=… JDVOP_RELAY_TOKEN=… [JDVOP_STARTER_CACHE=进度文件] node scripts/jdvop-build-starter.js
const fs = require('fs'), path = require('path'), os = require('os');
process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'jdvop-starter-'));
require('../lib/seed')(false);
const db = require('../lib/db'), client = require('../lib/suppliers/jdvop/client'), C = require('../lib/suppliers/jdvop/compliance'), J = require('../lib/suppliers/jdvop/service');
// 本站分类 → 目标商品数(京东商品池里在售合规的不足时取到多少算多少);未列出的本站分类取 DEFAULT
const TARGET = { 新鲜水果: 80, 新鲜蔬菜: 40, 鲜蛋: 25, 手机配件: 70, 影音耳机: 60, 电脑配件: 70, 电脑组件: 40, 网络设备: 50 }, DEFAULT = 25;
// 不进演示清单的允许类目(软件/虚拟商品、工业品、服务等)
const EXCLUDE = /软件|工业品|服务|游戏软件|充值|会员/;
const cacheFile = process.env.JDVOP_STARTER_CACHE, cache = cacheFile && fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : { pages: {}, details: {} };
let dirty = 0; const save = (force) => { if (cacheFile && (force || ++dirty % 10 === 0)) fs.writeFileSync(cacheFile, JSON.stringify(cache)); };
const call = async (code, data, key) => { if (key && key in cache.details) return cache.details[key]; for (let a = 0; ; a++) { try { const r = await client.call(code, data); if (key) { cache.details[key] = r; save(); } return r; } catch (e) { if (a >= 2 || !e.network) throw e; await new Promise(r => setTimeout(r, 3000)); } } };
const pick = (o, ks) => { const r = {}; for (const k of ks) if (o[k] !== undefined && o[k] !== null && o[k] !== '') r[k] = o[k]; return r; };
(async () => {
  const t0 = Date.now(), idx = await J.categoryIndex(), sites = {};
  for (const c of Object.values(idx).filter(c => c.level === 3)) {
    const p = idx[c.parentId] || {}, pp = idx[p.parentId] || {}, names = [pp.name, p.name, c.name], ps = names.join(' > ');
    if (C.review(names) || EXCLUDE.test(ps)) continue;
    const m = J.mapCategory([pp, p, c].map(x => ({ id: String(x.id), name: x.name }))), site = m && m.category_id ? (db.get('SELECT name FROM categories WHERE id=?', m.category_id) || {}).name : null;
    if (!site) continue;
    (sites[site] = sites[site] || { site, target: TARGET[site] || DEFAULT, cats: [], items: [], rr: 0 }).cats.push({ id: c.id, path: ps, names, page: 0, buf: [], done: false, digital: !/^生鲜/.test(ps) });
  }
  const taken = new Set(), spus = new Set();
  console.error('本站分类 → 允许三级类目数:', Object.values(sites).map(s => `${s.site}:${s.cats.length}`).join(' '));
  async function next(c) { // 取该三级类目下一个候选(必要时翻页)
    while (!c.buf.length && !c.done) {
      c.page++; const key = c.id + ':' + c.page;
      let data = cache.pages[key]; if (!data) { try { data = await client.call('searchGoodsList', { page: c.page, limit: 20, categoryThree: +c.id }); } catch (e) { console.error('  ✘ 浏览', c.path, e.message); c.done = true; break; } cache.pages[key] = { count: data && data.count, list: ((data && data.list) || []).map(g => pick(g, ['skuId', 'skuName', 'sellPrice', 'selfSellType', 'yn', 'categoryOneName', 'categoryTwoName', 'categoryThreeName'])) }; data = cache.pages[key]; save(); }
      const list = data.list || []; if (!list.length || c.page * 20 >= (data.count || 0) || c.page >= 8) c.done = true;
      for (const g of list) {
        if (!(+g.sellPrice > 0) || String(g.yn) === '0' || taken.has(String(g.skuId))) continue;
        if (c.digital && +g.selfSellType !== 1) continue; // 数码类首批只开放京东自营
        if (C.review([g.categoryOneName, g.categoryTwoName, g.categoryThreeName], g.skuName)) continue;
        c.buf.push(g);
      }
    }
    return c.buf.shift() || null;
  }
  // 轮流:每轮每个本站分类各取 1 款,分类内各三级类目轮流
  for (let round = 0, active = true; active; round++) {
    active = false;
    for (const s of Object.values(sites)) {
      if (s.items.length >= s.target) continue;
      for (let tries = 0; tries < s.cats.length; tries++) {
        const c = s.cats[s.rr++ % s.cats.length]; if (c.done && !c.buf.length) continue;
        const g = await next(c); if (!g) continue;
        const id = String(g.skuId); if (taken.has(id)) continue;
        let raw; try { raw = await call('searchGoodsDetail', { skuId: id }, 'd' + id); } catch (e) { console.error('  ✘ 详情', id, e.message); continue; }
        const d = raw && raw.detail ? raw.detail : raw; if (!d) continue;
        const pth = [d.category_one, d.category_two, d.category_three].map(x => idx[String(x)] || { name: '' }), names = pth.map(x => x.name);
        if (C.excludedSku(id) || C.review(names, d.skuName || d.spuName) || (c.digital && +d.selfSellType !== 1) || +d.skuState === 0) { taken.add(id); continue; }
        if (d.spuId && spus.has(String(d.spuId))) { taken.add(id); continue; }
        let sims = []; try { sims = await call('getSimilarSkuInfoList', { skuId: id }, 's' + id) || []; } catch (e) { sims = []; }
        sims = sims.filter(x => !taken.has(String(x.sku_id)) && !C.excludedSku(x.sku_id) && !C.review(names, x.skuName) && !(+x.sellPrice > C.maxPrice())); // 合规审查剔除 + 单价上限
        if (!sims.length && +d.sellPrice > C.maxPrice()) { taken.add(id); continue; }
        [id, ...sims.map(x => String(x.sku_id))].forEach(x => taken.add(x)); if (d.spuId) spus.add(String(d.spuId));
        const introImgs = J.introImages(d), dd = pick(d, ['skuName', 'spuName', 'spuId', 'category_one', 'category_two', 'category_three', 'imagePath', 'defaultImagePath', 'productArea', 'weight', 'saleUnit', 'warrantDesc', 'wareInfo', 'brand_name', 'selfSellType', 'color', 'size', 'skuState']);
        dd.imageList = (d.imageList || []).slice(0, 8).map(i => pick(i, ['shortPath', 'isPrimary', 'orderSort']));
        dd.categoryAttrList = (d.categoryAttrList || []).slice(0, 12).map(a => ({ cateAttrName: a.cateAttrName, cateAttrValList: (a.cateAttrValList || []).slice(0, 6) }));
        dd.introImgs = introImgs; if (!introImgs.length) dd.introText = C.stripJd(String(d.introduce || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 1500);
        s.items.push({ skuId: id, site: s.site, path: c.path, d: dd, sims: sims.slice(0, 12).map(x => pick(x, ['sku_id', 'label', 'imgUrl', 'imgPath', 'returnRuleType', 'skuName'])) });
        active = true; break;
      }
      if (s.items.length < s.target && s.cats.some(c => !c.done || c.buf.length)) active = true;
    }
    if (round % 10 === 0) { save(true); console.error(`  第 ${round} 轮:`, Object.values(sites).map(s => `${s.site} ${s.items.length}/${s.target}`).join(' '), `${Math.round((Date.now() - t0) / 1000)}s`); }
  }
  save(true);
  const order = [], S = Object.values(sites); for (let r = 0; S.some(s => s.items[r]); r++) for (const s of S) if (s.items[r]) order.push(s.items[r]);
  const counts = Object.fromEntries(S.map(s => [s.site, s.items.length]));
  fs.writeFileSync(path.join(__dirname, '../lib/suppliers/jdvop/starter-catalog.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), counts, items: order }));
  console.log(`写入 ${order.length} 款商品(含同款规格 SKU ${order.reduce((n, x) => n + 1 + x.sims.filter(y => String(y.sku_id) !== x.skuId).length, 0)} 个):`, JSON.stringify(counts), `用时 ${Math.round((Date.now() - t0) / 1000)}s`);
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1); });
