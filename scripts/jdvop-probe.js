#!/usr/bin/env node
// 京东货盘(来一票)真实接口只读探测:只调用免费查询接口(余额/分类/商品列表/详情/价格/可售/地址),绝不下单。
// 用法(在白名单服务器上): node scripts/jdvop-probe.js [/etc/yunnong/jdvop.env] [--import] [--q=选品关键词] [--sku=商品ID[,商品ID...]]
//   --import:另外在临时库里走一遍「后台选品浏览 + 导入一个允许类目的 SKU + 价格/可售刷新」(只读供应商接口,不写正式库)
// 只打印摘要(数量/样例名称/错误码),不打印任何密钥。
const fs = require('fs'), path = require('path'), os = require('os');
const args = process.argv.slice(2), envFile = args.find(a => !a.startsWith('--')) || '/etc/yunnong/jdvop.env', doImport = args.includes('--import') || args.some(a => a.startsWith('--sku=')), skuArg = (args.find(a => a.startsWith('--sku=')) || '').slice(6), qArg = (args.find(a => a.startsWith('--q=')) || '').slice(4) || '数据线';
for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !line.trim().startsWith('#')) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
process.env.JDVOP_MODE = 'live';
process.env.DATA_DIR = process.env.PROBE_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'jdvop-probe-'));
const SECRETS = ['JDVOP_TENANT', 'JDVOP_APPKEY', 'JDVOP_APPSECRET'].map(k => process.env[k]).filter(v => v && v.length >= 6);
const mask = s => { s = String(s); for (const v of SECRETS) s = s.split(v).join('***'); return s; };
const out = (...a) => console.log(mask(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')));
const client = require('../lib/suppliers/jdvop/client');
const { status } = require('../lib/suppliers/jdvop/config');
const short = (v, n = 400) => { const s = JSON.stringify(v); return s && s.length > n ? s.slice(0, n) + '…' : s; };
async function step(name, fn) {
  try { const r = await fn(); out(`✔ ${name}:`, r); return r; }
  catch (e) { out(`✘ ${name}: code=${e.code ?? ''} msg=${e.message}`); return null; }
}
(async () => {
  out('config', status());
  await step('customerBalance 余额', async () => ({ balance: await client.balance() }));
  const cats = await step('searchAllCategory 分类', async () => {
    const l = await client.call('searchAllCategory', {}) || [];
    const lv = {}; for (const c of l) lv[c.groupLevel] = (lv[c.groupLevel] || 0) + 1;
    return { total: l.length, byLevel: lv, sample: l.filter(c => String(c.groupLevel) === '1').slice(0, 8).map(c => c.groupName) };
  });
  const goods = await step('searchGoodsList 商品列表', async () => {
    const d = await client.call('searchGoodsList', { page: 1, limit: 10 });
    global.__goods = d; const list = (d && (d.goodsList || d.list || d.records || d.data)) || (Array.isArray(d) ? d : []);
    return { keys: d && typeof d === 'object' ? Object.keys(d) : typeof d, total: d && (d.total ?? d.totalCount ?? d.count), n: list.length, sample: list.slice(0, 5).map(g => ({ skuId: g.skuId, name: (g.skuName || g.name || '').slice(0, 40), price: g.sellPrice ?? g.price, jd: g.jdPrice ?? g.retail })) };
  });
  const list = (() => { const d = global.__goods; return (d && (d.goodsList || d.list || d.records || d.data)) || (Array.isArray(d) ? d : []); })();
  const skus = list.slice(0, 3).map(g => String(g.skuId)).filter(Boolean);
  if (skus[0]) await step('searchGoodsDetail 详情 ' + skus[0], async () => {
    const d = await client.call('searchGoodsDetail', { skuId: skus[0] });
    return { keys: d && Object.keys(d).slice(0, 40), name: d && (d.skuName || d.name), state: d && (d.state ?? d.saleState), brand: d && d.brandName, imgs: d && d.imageList && d.imageList.length, sample: short(d, 300) };
  });
  if (skus.length) {
    await step('getSellPrice 价格', async () => (await client.call('getSellPrice', { skuIds: skus.join(',') }) || []).map(p => ({ skuId: p.skuId, sellPrice: p.sellPrice, retail: p.retail ?? p.jdPrice })));
    await step('checkSkuSaleList 可售', async () => short(await client.call('checkSkuSaleList', { skuIds: skus.join(',') })));
    await step('getSimilarSkuInfoList 规格', async () => short(await client.call('getSimilarSkuInfoList', { skuId: skus[0] }), 300));
  }
  const area = await step('changeArea 地址转换', async () => await client.call('changeArea', { addressDetailStr: '海南省海口市龙华区国贸路1号' }));
  await step('searchAddress 一级地址', async () => { const l = await client.call('searchAddress', { level: 1 }); return { n: Array.isArray(l) ? l.length : typeof l, sample: short(Array.isArray(l) ? l.slice(0, 3) : l, 200) }; });
  if (area && area.provinceId) {
    await step('checkArea 地址校验', async () => short(await client.call('checkArea', { provinceId: +area.provinceId, cityId: +area.cityId, countyId: +area.countyId, townId: +area.townId || 0 })));
    if (skus.length) {
      const geo = { provinceId: +area.provinceId, cityId: +area.cityId, countyId: +area.countyId, townId: +area.townId || 0 };
      await step('checkAreaLimitList 区域可售', async () => short(await client.call('checkAreaLimitList', { skuId: skus.join(','), skuNum: '1', skuNumInfoList: skus.map(s => ({ skuId: s, skuNumber: 1 })), ...geo })));
      await step('querySkuFreight 运费', async () => short(await client.call('querySkuFreight', { ...geo, skuInfo: skus.slice(0, 1).map(s => ({ skuId: s, skuNum: 1 })) })));
    }
  }
  if (doImport) {
    require('../lib/seed')(false); // 临时库:演示数据(分类/设置),不碰正式库
    const J = require('../lib/suppliers/jdvop'), db = require('../lib/db');
    const b = await step('service.browse 选品浏览「' + qArg + '」', async () => { const x = await J.browse({ q: qArg, limit: 10 }); global.__b = x; return { count: x.count, n: x.list.length, cats1: x.cats1.length, sample: x.list.slice(0, 3).map(g => ({ skuId: g.skuId, name: g.skuName.slice(0, 30), sale: g.sale, blocked: g.blocked ? (g.blocked.group || 'notAllowed') : null })) }; });
    const cands = skuArg ? skuArg.split(',') : (b ? global.__b.list.filter(g => !g.blocked).slice(0, 4).map(g => g.skuId) : []);
    let done = false;
    for (const id of cands) {
      const r = await step('service.importSku 导入 ' + id, async () => J.importSku(id));
      if (r && r.productId) {
        const p = db.get('SELECT id,name,price,status,supplier_cat,images,supports_7day_return,return_rule_text FROM products WHERE id=?', r.productId), sk = db.all('SELECT supplier_sku,price,cost_price,stock,spec_text FROM skus WHERE product_id=?', r.productId);
        out('  导入结果:', { name: p.name, price: p.price, status: p.status, cat: p.supplier_cat, supports7: p.supports_7day_return, returnRule: p.return_rule_text, imgs: JSON.parse(p.images || '[]').length, skus: sk.slice(0, 4) });
        await step('service.refreshProducts 刷新价格/可售', async () => J.refreshProducts({ productIds: [r.productId] }));
        done = true; break;
      }
    }
    if (!done) out('  没有可导入的 SKU(均被合规规则拦截或不可售)');
  }
})().catch(e => { out('fatal', e.message); process.exit(1); });
