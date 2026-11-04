#!/usr/bin/env node
// 生成演示站启动自动导入清单 lib/suppliers/jdvop/starter-skus.js(只调用只读查询接口:searchAllCategory / searchGoodsList)。
// 按「当前允许上架」的三级类目逐个浏览,每类挑若干款(跳过禁售/加工蛋制品/无价格/同款重复),各类目轮流排序(先保证每个类目都有货)。
// 用法(经中转,本机无需密钥): JDVOP_MODE=live JDVOP_RELAY_URL=… JDVOP_RELAY_TOKEN=… node scripts/jdvop-build-starter.js [总数上限=190]
const fs = require('fs'), path = require('path'), os = require('os');
process.env.DATA_DIR = process.env.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'jdvop-starter-'));
const MAX = parseInt(process.argv[2] || '190', 10);
require('../lib/seed')(false);
const client = require('../lib/suppliers/jdvop/client'), C = require('../lib/suppliers/jdvop/compliance');
// 各大类每个三级类目取几款;不在这里的允许类目(软件/工业品/服务等)不进演示清单
const QUOTA = [[/^生鲜 > 水果 > /, 3], [/^生鲜 > 蔬菜 > /, 12], [/^生鲜 > .* > (蛋类|蛋品|禽蛋|鲜蛋)$/, 8],
  [/^手机通讯 > 手机配件 > /, 2], [/^数码 > (数码配件|影音娱乐) > /, 2], [/^电脑、办公 > (外设产品|电脑组件|网络产品) > /, 2], [/^电脑、办公 > 游戏设备 > 游戏耳机$/, 2]];
const GROUP = p => /^生鲜 > 水果/.test(p) ? '水果' : /^生鲜 > 蔬菜/.test(p) ? '蔬菜' : /蛋/.test(p) ? '蛋类' : /网络产品/.test(p) ? '网络设备' : /^电脑/.test(p) ? '电脑配件' : '数码配件';
(async () => {
  const all = await client.call('searchAllCategory', {}) || [], by = {}; all.forEach(c => by[c.id] = c);
  const cats = [];
  for (const c of all.filter(c => String(c.groupLevel) === '3')) {
    const p = by[c.parentId] || {}, pp = by[p.parentId] || {}, names = [pp.groupName, p.groupName, c.groupName], ps = names.join(' > ');
    if (C.review(names)) continue; const q = QUOTA.find(([re]) => re.test(ps)); if (!q) continue;
    cats.push({ id: c.id, path: ps, names, quota: q[1] });
  }
  const cache = process.env.JDVOP_STARTER_CACHE, cached = cache && fs.existsSync(cache) ? JSON.parse(fs.readFileSync(cache, 'utf8')) : null;
  console.error(`允许且纳入演示的三级类目 ${cats.length} 个,开始浏览…`);
  for (const c of cats) {
    if (cached && cached[c.id]) { c.picks = cached[c.id].slice(0, c.quota); continue; }
    let data; try { data = await client.call('searchGoodsList', { page: 1, limit: 30, categoryThree: +c.id }); } catch (e) { console.error('  ✘', c.path, e.message); c.picks = []; continue; }
    const seen = new Set(); c.picks = [];
    for (const g of (data && data.list) || []) {
      if (c.picks.length >= c.quota) break;
      if (!(+g.sellPrice > 0) || String(g.yn) === '0') continue;
      if (C.review([g.categoryOneName, g.categoryTwoName, g.categoryThreeName], g.skuName)) continue;
      const key = (g.brandName || '') + '|' + C.stripJd(g.skuName || '').replace(/\s+/g, '').slice(0, 10); if (seen.has(key)) continue; seen.add(key); // 同款不同规格只取一个(导入时会带上其他规格)
      c.picks.push({ skuId: String(g.skuId), name: C.stripJd(g.skuName || '').slice(0, 30) });
    }
    console.error(`  ${c.path}: 共 ${data ? data.count : 0},选 ${c.picks.length}`);
  }
  if (cache && !cached) fs.writeFileSync(cache, JSON.stringify(Object.fromEntries(cats.map(c => [c.id, c.picks]))));
  // 超出总数上限:先删数码类目里的第 2 款起(从后往前),农产品类目尽量保留
  for (let total = cats.reduce((n, c) => n + c.picks.length, 0); total > MAX; total--) {
    const dig = cats.filter(c => !/^生鲜/.test(c.path) && c.picks.length > 1), pool = dig.length ? dig : cats, top = Math.max(...pool.map(c => c.picks.length));
    pool.filter(c => c.picks.length === top).pop().picks.pop();
  }
  // 轮流排序:第 1 轮每类取 1 个,第 2 轮…(先保证每个类目都有货;农产品类目排在前面)
  const order = [...cats.filter(c => /^生鲜/.test(c.path)), ...cats.filter(c => !/^生鲜/.test(c.path))], out = [];
  for (let r = 0; out.length < MAX && order.some(c => c.picks.length > r); r++) for (const c of order) if (c.picks[r] && out.length < MAX) out.push({ ...c.picks[r], path: c.path, group: GROUP(c.path) });
  const cnt = {}; out.forEach(x => cnt[x.group] = (cnt[x.group] || 0) + 1);
  const file = path.join(__dirname, '../lib/suppliers/jdvop/starter-skus.js');
  fs.writeFileSync(file, `// 演示站(live + DEMO_MODE=1)启动时后台自动导入的真实商品 SKU(走正常导入与合规校验;缺货/下架/不合规的自动跳过)。
// 由 scripts/jdvop-build-starter.js 生成(${new Date().toISOString().slice(0, 10)}):覆盖全部允许类目的三级类目,轮流排序。可用环境变量 JDVOP_STARTER_SKUS=逗号分隔 覆盖。
// 分组数量:${JSON.stringify(cnt)};原粮(米/杂粮)在供应商侧均属「粮油调味」预包装食品,按当前经营范围禁售,未列入。
module.exports = { SKUS: [
${out.map(x => `  '${x.skuId}', // [${x.group}] ${x.path.split(' > ').pop()} · ${x.name.replace(/[\\r\\n'*/]/g, ' ')}`).join('\n')}
] };
`);
  console.log(`写入 ${out.length} 个 SKU:`, JSON.stringify(cnt), '三级类目有货', cats.filter(c => c.picks.length).length, '/', cats.length);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
