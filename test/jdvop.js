// 供应商(京东货盘 / 来一票 VOP)对接测试:签名、mock 导入、前台展示、合规、结算校验、推单、回调幂等、售后、混合订单
// 用法:与 smoke/flows 相同(全新库 + DEMO_MODE=1,DATA_DIR 与服务端一致);mock 模式,不需要任何密钥
const base = process.argv[2] || 'http://localhost:' + (process.env.PORT || 3000);
const fs = require('fs'), path = require('path');
const db = require('../lib/db');
const J = require('../lib/suppliers/jdvop');
let pass = 0, fail = 0;
const ok = (c, n, x) => { c ? (pass++, console.log('  ✔', n)) : (fail++, console.log('  ✘', n, x === undefined ? '' : String(x).slice(0, 400))); };
class C { constructor(b) { this.k = {}; this.t = ''; this.b = b || base; }
  async req(m, p, body, o = {}) { const h = { Cookie: Object.entries(this.k).map(([a, b]) => a + '=' + b).join('; ') }; let b; if (body && !o.raw) { const u = new URLSearchParams(); u.append('_csrf', this.t); for (const [k, v] of Object.entries(body)) [].concat(v).forEach(x => u.append(k, x)); b = u.toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; } if (o.raw) { b = o.raw; h['Content-Type'] = 'application/json'; } if (o.json) h.Accept = 'application/json';
    const r = await fetch(this.b + p, { method: m, headers: h, body: b, redirect: 'manual' }); for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); this.k[kv.slice(0, i)] = kv.slice(i + 1); }
    const text = await r.text(); const mm = text.match(/name="csrf" content="([0-9a-f]+)"/) || text.match(/name="_csrf" value="([0-9a-f]+)"/); if (mm) this.t = mm[1]; return { status: r.status, loc: r.headers.get('location'), text }; }
  get(p) { return this.req('GET', p); } post(p, b, o) { return this.req('POST', p, b || {}, o); }
  async login(phone, pw) { await this.get('/login'); const r = await this.post('/login', { phone, password: pw }); const c = await this.get('/consent'); if (c.status === 200) await this.post('/consent', { agree: '1', next: '/' }); await this.get('/'); return r; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(100); } return fn(); }
const itemsRaw = t => (t.match(/name="items" value='([^']+)'/) || [, '[]'])[1].replace(/&#34;/g, '"');
const prodOf = sku => db.get('SELECT p.* FROM skus s JOIN products p ON p.id=s.product_id WHERE s.supplier_sku=?', String(sku));
const skuOf = sku => db.get('SELECT * FROM skus WHERE supplier_sku=?', String(sku));
const soOf = oid => db.get('SELECT * FROM supplier_orders WHERE order_id=?', oid);
const stripTags = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

(async () => {
  console.log('== 签名(已知向量,openssl enc -aes-128-cbc 交叉验证;仅测试值,非真实密钥) ==');
  const S = J.sign;
  const TK = 'VEVTVEtFWTBURVNUS0VZMA', TS = '54455354495630305445535449563030'; // base64("TESTKEY0TESTKEY0") 去掉 ==;hex("TESTIV00TESTIV00")
  let v = S.sign({ timestamp: 1700000000000, nonceStr: 'testnonce0001', interfaceType: 'jd_mall_interface', interfaceCode: 'searchGoodsList', appKey: TK, appSecret: TS });
  ok(v.plaintext === 'interfaceCode=jd_mall_interface&nonceStr=testnonce0001&timestamp=1700000000000', '签名明文:三项按码点排序后 & 连接(默认取接口类型)', v.plaintext);
  ok(v.signature === '2oFd2n3oLiVLK3F8h0X5x62k466/DRkrhw4TRkSYwnI1wdcdRSsUgznDIl7pATCKIUtUXp3JHGx9xebJF0RBifDzzDQwv1FkVnGqqX+Gh30=', 'AES-128-CBC/PKCS5 + Base64 签名与 openssl 一致', v.signature);
  v = S.sign({ timestamp: 1700000000000, nonceStr: 'testnonce0001', interfaceType: 'jd_mall_interface', interfaceCode: 'searchGoodsList', appKey: TK, appSecret: TS, field: 'code' });
  ok(v.signature === 'vVrnkpKqROaulYjMuckdQHU6nEUy4g4WjrHHG1ymEi/cPb7Bv0OvhCufhea5iGaostQepZAauou3R6BI617mLFKRRwhLbN5Sg0wQTi+YSjU=', '歧义开关 JDVOP_SIGN_CODE_FIELD=code:改用接口编码签名');
  let threw = false; try { S.encrypt('x', 'abc', TS); } catch (e) { threw = true; } ok(threw, 'AppKey 解码长度不对时报错');
  const br = J.client.buildRequest('searchGoodsList', { page: 1 }, { baseUrl: 'https://api.example.test', tenant: 'T1', appKey: TK, appSecret: TS, apiType: 'V2' }, 1700000000000, 'testnonce0001');
  ok(br.url === `https://api.example.test/api/v1/T1/${TK}/jd_mall_interface` && br.body.timestamp === '1700000000000' && br.body.timestamp.length === 13 && br.body.data.type === 'V2' && br.body.interfaceCode === 'searchGoodsList' && br.body.signature.length > 20, '请求地址/公共参数/13 位时间戳/data.type', JSON.stringify(br));
  const red = JSON.stringify(J.client.redact({ appKey: TK, appSecret: TS, signature: 'abc', data: { consigneeMobile: '13800001001', consigneeName: '李美' } }));
  ok(!red.includes(TK) && !red.includes(TS) && !red.includes('13800001001') && !red.includes('abc"'), '日志脱敏:密钥/签名/手机号', red);
  ok(J.config.cfg().mode === 'mock', '默认 mock 模式(无需密钥)');
  const src = ['config.js', 'client.js', 'sign.js', 'mock.js', 'service.js'].map(f => fs.readFileSync(path.join(__dirname, '..', 'lib', 'suppliers', 'jdvop', f), 'utf8')).join('\n');
  ok(!/appSecret\s*[:=]\s*['"][0-9a-f]{16,}/i.test(src) && !/appKey\s*[:=]\s*['"][A-Za-z0-9+/]{16,}/.test(src), '代码中没有硬编码密钥');

  const adm = new C(), a = new C(), g = new C();
  await adm.get('/admin/login'); await adm.post('/admin/login', { username: 'admin', password: 'admin123' }); await adm.get('/admin/password'); await adm.post('/admin/password/skip'); await adm.get('/admin');
  await a.login('13800000002', '123456');

  console.log('== 演示环境启动自动导入(mock + DEMO_MODE=1) ==');
  const seedDone = await waitFor(() => /^done/.test((db.get("SELECT value FROM settings WHERE key='jdvop_demo_seed'") || {}).value || ''), 30000);
  ok(seedDone, '服务启动后异步自动导入 mock 商品(不阻塞启动)', (db.get("SELECT value FROM settings WHERE key='jdvop_demo_seed'") || {}).value);
  const seeded = db.all("SELECT * FROM products WHERE supplier='jdvop'");
  ok(seeded.filter(p => p.status === 1 && p.supplier_state === 'ok').length >= 10, '自动导入的合规商品已上架', seeded.length);
  ok(!db.get("SELECT 1 FROM skus WHERE supplier_sku IN ('900010001','900011001','900004001','900004002','900004003','900002001','900007001','900012101','900008101','900003002')"), '自动导入同样执行禁售类目拦截(药品/酒类/家电/预包装食品/服饰/运动/冷冻水产未导入)');
  ok(!db.get("SELECT 1 FROM skus WHERE supplier_sku IN ('900001001','900001002','900005101','900013001','900013002','900014001','900015001','900006001','900006002')"), '经营范围外(日用百货/纸品/箱包/厨具餐具/文具/护肤/个护)不再导入(2026-10-19 实际登记范围)');
  ok(!db.get("SELECT 1 FROM skus WHERE supplier_sku IN ('900019001','900019002','900019003','900019004')"), '整机(=手机)/打印机(办公设备仅租赁)/大米(预包装食品)/对讲机不导入');
  ok(['900016001', '900017001', '900017004', '900017005', '900017006', '900017007', '900017008', '900009002', '900003001', '900018001', '900018002', '900018003'].every(k => { const p = prodOf(k); return p && p.status === 1 && p.supplier_state === 'ok'; }), '允许清单内演示商品(数码配件/电脑外设/网络设备/新鲜水果蔬菜鲜蛋)已导入上架');
  ok(['900003001', '900018001', '900018002', '900018003'].every(k => { const p = prodOf(k); return p.is_perishable === 1 && p.no_reason_return === 0; }), '食用农产品标记鲜活易腐、不支持7天无理由');
  ok(!db.get("SELECT 1 FROM skus WHERE supplier_sku IN ('900016003','900016004')") && db.get("SELECT 1 FROM skus WHERE supplier_sku='900016001'"), '数码类只导入自营且支持7天无理由的商品(配件可导入,非自营/不支持7天无理由不导入)');
  const seededMouse = seeded.find(p => p.name.includes('鼠标'));
  ok(seededMouse && seededMouse.status === 0 && seededMouse.supplier_state === 'pending_review', '自动导入的违禁词商品为待审核/下架', JSON.stringify(seededMouse));
  ok(seeded.some(p => p.name === '磨砂防摔手机壳') && seeded.some(p => p.name === 'Type-C 快充数据线'), '多规格商品名去掉规格值(颜色/长度)', seeded.map(p => p.name).join('|'));
  ok(new Set(seeded.map(p => p.supplier_spu)).size === seeded.length && db.get("SELECT COUNT(*) n FROM skus s JOIN products p ON p.id=s.product_id WHERE p.supplier='jdvop'").n === db.get("SELECT COUNT(DISTINCT supplier_sku) n FROM skus WHERE supplier_sku IS NOT NULL").n, '每个商品(SPU)只导入一次,SKU 不重复', seeded.length);
  let r = await g.get('/products'); ok(r.text.includes('class="tag demo">演示'), '新部署打开「全部商品」即可看到供应商演示商品');
  const again = await J.demoSeed(); ok(again && again.skipped, '已有供应商商品时不再自动导入(重启不重复)', JSON.stringify(again));
  const m0 = process.env.JDVOP_MODE; process.env.JDVOP_MODE = 'live'; ok(!J.demoSeedEnabled(), 'live 模式绝不自动导入'); process.env.JDVOP_MODE = m0 === undefined ? '' : m0; if (m0 === undefined) delete process.env.JDVOP_MODE;
  const d0 = process.env.DEMO_MODE; process.env.DEMO_MODE = '0'; ok(!J.demoSeedEnabled(), '非演示环境不自动导入'); process.env.DEMO_MODE = d0;

  console.log('== 选品浏览 / 导入 ==');
  r = await adm.get('/admin/jdvop');
  ok(r.status === 200 && r.text.includes('导入所选') && r.text.includes('卷纸'), '「供应商商品」页可浏览商品(商品池同步照常,含范围外商品)', r.status);
  ok(r.text.includes('禁售:药品') && r.text.includes('禁售:酒类') && r.text.includes('禁售:家用电器') && r.text.includes('禁售:预包装食品') && r.text.includes('禁售:服饰鞋帽') && r.text.includes('禁售:日用百货') && r.text.includes('禁售:箱包'), '禁售类目在选品页标记(药品/酒类/家电/预包装食品/服饰/日用百货/箱包)');
  ok(r.text.includes('未开放:不在允许上架范围'), '不在允许清单的类目标记「未开放」');
  {
    const CC = require('../lib/suppliers/jdvop/compliance');
    ok(CC.blockedBy(['手机通讯', '手机', '手机']) && !CC.blockedBy(['手机通讯', '手机配件', '数据线']), '「=手机」只拦整机,不拦手机配件');
    console.log('== 允许清单(经营范围 2026-10-19)==');
    ok(CC.review(['家庭清洁/纸品', '清洁纸品', '卷纸']) && CC.review(['日用百货', '收纳用品', '收纳箱']) && CC.review(['厨具', '烹饪锅具', '炒锅']), '日用百货/纸品/厨具 → 拒绝');
    ok(!CC.review(['手机通讯', '手机配件', '手机壳']) && CC.allowedBy(['手机通讯', '手机配件', '手机壳']).group === '数码配件', '手机壳 → 通过(数码配件)');
    ok(CC.review(['手机通讯', '手机', '手机']) && CC.review(['手机通讯', '手机', '手机']).group.startsWith('数码整机'), '=手机(整机)→ 拒绝');
    ok(!CC.review(['生鲜', '水果', '苹果']) && CC.isFarmProduce(['生鲜', '水果', '苹果']) && !CC.review(['生鲜', '蔬菜', '叶菜类']) && !CC.review(['生鲜', '蛋品', '鸡蛋']) && !CC.review(['生鲜', '原粮', '玉米原粮']), '新鲜水果/蔬菜/鲜蛋/原粮 → 通过(食用农产品,鲜活易腐)');
    const snack = CC.review(['食品饮料', '休闲食品', '膨化食品']);
    ok(snack && snack.food && snack.group.startsWith('预包装食品'), '零食 → 拒绝(预包装食品组,下一批优先开放)', JSON.stringify(snack));
    ok(['大米', '食用油', '茶叶', '坚果炒货', '蜂蜜', '地方特产'].every(n => { const x = CC.review(['食品饮料', '粮油调味', n]); return x && x.food; }) && CC.review(['生鲜', '水果', '果干']).food && CC.review(['生鲜', '水果', '冷冻水果']).food, '大米面粉/食用油/茶叶/坚果炒货/蜂蜜/特产/果干/冷冻 → 预包装食品组');
    ok(CC.review(['电脑、办公', '文具', '笔类']) && CC.review(['电脑、办公', '文具', '笔类']).group.startsWith('文具'), '文具 → 拒绝');
    const prn = CC.review(['电脑、办公', '办公设备', '打印机']); ok(prn && prn.group.startsWith('办公设备(仅租赁'), '打印机 → 拒绝(办公设备仅租赁,待变更)', JSON.stringify(prn));
    ok(CC.review(['电脑、办公', '办公设备', '投影机']) && CC.review(['电脑、办公', '办公设备', '碎纸机']), '投影/碎纸机 → 拒绝');
    ok(!CC.review(['电脑、办公', '外设产品', '鼠标']) && !CC.review(['电脑、办公', '网络产品', '路由器']) && !CC.review(['数码', '数码配件', '存储卡']) && !CC.review(['数码', '影音娱乐', '蓝牙耳机']), '键鼠/路由器/存储卡/耳机 → 通过');
    ok(CC.review(['手机通讯', '对讲机', '对讲机']) && CC.review(['数码', '智能设备', '无人机']) && CC.review(['家用电器', '个护电器', '电动牙刷']) && CC.review(['美妆护肤', '面部护肤', '面霜']) && CC.review(['箱包皮具', '功能箱包', '双肩包']), '对讲机/无人机/个护电器/化妆品/箱包 → 拒绝');
    const shrimp = CC.review(['生鲜', '海鲜水产', '虾类']); ok(shrimp && shrimp.notAllowed, '不在允许清单(海鲜水产)→ 拒绝「不在允许上架范围」', JSON.stringify(shrimp));
    ok(!CC.scopeWarning(['数码电脑', '手机通讯']) && !CC.scopeWarning(['数码电脑', '电脑整机']) && !CC.scopeWarning(['新鲜农产品', '新鲜水果']) && CC.scopeWarning(['家居日用', '厨房']) && CC.scopeWarning(['美妆个护', '护肤']) && CC.scopeWarning(['食品生鲜', '零食坚果']) && CC.scopeWarning(['服饰鞋包', '男装']), '自营类目提示:数码/整机/新鲜水果不提示,日用/护肤/零食/服饰提示');
  }
  r = await adm.get('/admin/jdvop?q=' + encodeURIComponent('大米') + '&rv=food'); ok(r.text.includes('东北大米') && r.text.includes('禁售:预包装食品'), '选品页可单独筛选「预包装食品(待变更+备案)」');
  r = await adm.get('/admin/jdvop?q=' + encodeURIComponent('大米') + '&rv=ok'); ok(!r.text.includes('东北大米'), '「可上架」筛选不含预包装食品');
  r = await adm.get('/admin/jdvop?cat1=17329'); ok(r.text.includes('双肩包') && !r.text.includes('卷纸'), '按分类筛选');
  r = await adm.post('/admin/jdvop/import', { sku: ['900016001', '900017001', '900003001', '900016004', '900009001', '900010001', '900011001', '900004001', '900006001', '900001001', '900014001', '900019001', '900019002', '900007002'] });
  ok(db.get("SELECT COUNT(*) n FROM skus WHERE supplier_sku='900016001'").n === 1 && db.get("SELECT COUNT(*) n FROM skus WHERE supplier_sku='900017001'").n === 1, '重复导入不会产生重复商品');
  const impMsg = r.loc ? (await adm.get(r.loc)).text : ''; ok(impMsg.includes('已导入'), '重复导入提示「已导入」');
  const roll = prodOf('900016001'), shirt = prodOf('900017001'), mouse = prodOf('900009001');
  ok(roll && roll.supplier === 'jdvop' && roll.status === 1 && roll.supplier_state === 'ok', '导入:supplier=jdvop,已上架', JSON.stringify(roll));
  const rs = skuOf('900016001'); const pct = 10;
  ok(rs.cost_price === 19.9 && rs.price === Math.max(25.9, Math.ceil(19.9 * 1.1 * 100 - 1e-6) / 100), '成本=结算价,售价=max(参考价, 成本×1.1)', JSON.stringify(rs));
  ok(roll.market_price === null, '不设置划线价(market_price 为空)');
  const imgs = JSON.parse(roll.images); ok(imgs.length && imgs[0].startsWith('/uploads/supplier/') && fs.existsSync(path.join(__dirname, '..', 'public', imgs[0])), '图片转存到本站 /uploads/supplier', roll.images);
  ok(shirt && db.get('SELECT COUNT(*) n FROM skus WHERE product_id=?', shirt.id).n === 2 && shirt.spec_names.includes('颜色'), '同款多规格合并为一个商品(2 个 SKU)');
  const ss = skuOf('900017001'); ok(ss.price === Math.ceil(ss.cost_price * 1.1 * 100 - 1e-6) / 100 && ss.price > ss.supplier_retail, '成本高于参考价时按成本加价', JSON.stringify(ss));
  ok(roll.no_reason_return === 1, 'returnRuleType>0 → 支持7天无理由');
  ok(!(roll.description || '').includes('京东') && (roll.description || '').includes('包装清单'), '详情文案已去除「京东」字样');
  console.log('== 合规:禁售类目 / 违禁词 ==');
  ok(!prodOf('900010001') && !prodOf('900011001') && !prodOf('900004001') && !prodOf('900007002'), '禁售类目(药品/酒类/家电/零食)不能导入');
  ok(!prodOf('900001001') && !prodOf('900014001') && !prodOf('900019002') && !prodOf('900019001') && !prodOf('900006001'), '日用百货/文具/打印机/整机/个护 手动导入同样被拦截');
  ok(impMsg.includes('办公设备(仅租赁') && impMsg.includes('文具/办公用品'), '导入结果提示打印机/文具的拦截原因');
  ok(!prodOf('900016004') && impMsg.includes('不支持7天无理由'), '数码类不支持7天无理由 → 不能导入并提示原因');
  ok(impMsg.includes('禁售类目'), '导入结果提示禁售原因');
  ok(mouse && mouse.status === 0 && mouse.supplier_state === 'pending_review' && /第一/.test(mouse.supplier_review_note), '违禁词命中 → 导入为待审核/下架,并记录原因', JSON.stringify(mouse));
  r = await adm.get('/admin/jdvop/products'); ok(r.text.includes('待审核') && r.text.includes('第一'), '后台已导入列表显示审核原因');
  await adm.post('/admin/products/' + mouse.id + '/toggle'); ok(db.get('SELECT status FROM products WHERE id=?', mouse.id).status === 0, '待审核商品不能直接上架');
  await adm.post('/admin/products/batch', { ids: [String(mouse.id)], action: 'on' }); ok(db.get('SELECT status FROM products WHERE id=?', mouse.id).status === 0, '批量上架也被拦截');
  const msku = db.all('SELECT * FROM skus WHERE product_id=?', mouse.id);
  const save = name => adm.post('/admin/products/save', { id: String(mouse.id), name, subtitle: '供应商直发', category_id: String(mouse.category_id), brand_id: '0', template_id: '1', weight: '0.5', spec_names: mouse.spec_names, sort: '0', status: '1', description: mouse.description, images_keep: JSON.parse(mouse.images), sku_id: msku.map(s => String(s.id)), sku_spec: msku.map(s => s.spec_text), sku_price: msku.map(() => '1'), sku_stock: msku.map(() => '5'), sku_code: msku.map(() => '') });
  await save('办公无线静音鼠标 销量第一 款');
  ok(db.get('SELECT status, supplier_state FROM products WHERE id=?', mouse.id).supplier_state === 'pending_review' && db.get('SELECT status FROM products WHERE id=?', mouse.id).status === 0, '仍含违禁词时保存后不能上架');
  await save('办公无线静音鼠标');
  const m2 = db.get('SELECT * FROM products WHERE id=?', mouse.id), m2s = db.get('SELECT * FROM skus WHERE product_id=?', mouse.id);
  ok(m2.supplier_state === 'ok' && m2.status === 1 && !m2.supplier_review_note, '人工修改文案后复检通过,可上架', JSON.stringify(m2));
  ok(m2s.price === msku[0].price && m2s.supplier_sku === msku[0].supplier_sku, '供应商商品价格不随编辑表单修改(按加价规则)');

  console.log('== 前台「全部商品」 ==');
  const parentCat = db.get('SELECT parent_id FROM categories WHERE id=?', roll.category_id).parent_id;
  // 在「全部商品」中逐页查找(列表按综合排序 + 分页/无限滚动)
  const findIn = async (url, needle) => { for (let pgn = 1; pgn <= 30; pgn++) { const x = await g.get(url + (url.includes('?') ? '&' : '?') + 'page=' + pgn); if (x.text.includes(needle)) return x; if (!x.text.includes('class="pcard"')) return null; } return null; };
  r = await findIn('/products', '/product/' + roll.id + '"'); const ownHit = await findIn('/products', 'Type-C 编织快充数据线 2米');
  ok(r && ownHit, '/products 中供应商商品与自营商品混排');
  ok(r && /class="tag demo">演示<\/span>[^<]*<\/div>/.test(r.text) && r.text.includes(roll.name), 'DEMO 模式商品卡显示「演示」');
  r = await g.get('/products?cat=' + parentCat); ok(r.text.includes(roll.name), '供应商商品出现在一级分类标签');
  r = await g.get('/products?cat=' + roll.category_id); ok(r.text.includes(roll.name), '出现在映射后的二级分类');
  r = await g.get('/products?q=' + encodeURIComponent('快充数据线')); ok(r.text.includes(roll.name), '搜索可找到供应商商品');
  for (const s of ['price_asc', 'price_desc', 'sales', 'new']) { r = await findIn('/products?sort=' + s, '/product/' + roll.id + '"'); ok(r, '排序 ' + s + ' 下可见'); }
  { const sp = db.get("SELECT id, supplier_brand FROM products WHERE supplier IS NOT NULL AND status=1 LIMIT 1"); if (sp) { const x = await g.get('/product/' + sp.id); const h1 = (x.text.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || ''; ok(sp.supplier_brand && x.text.includes('<dt>品牌</dt><dd class="pd-brand">' + sp.supplier_brand + '</dd>') && !h1.includes(sp.supplier_brand), '供应商商品品牌仅显示为参数行「品牌」'); } }
  r = await g.get('/products?sort=price_asc&q=' + encodeURIComponent('数据线')); const ix = [r.text.indexOf('/product/' + roll.id + '"'), r.text.indexOf('Type-C 编织快充数据线 2米')];
  ok(ix[0] > 0 && ix[1] > 0 && ix[0] < ix[1], '价格升序与自营商品混排(¥25.9 供应商数据线排在 ¥29 起的自营数据线之前)', ix);
  r = await g.get('/products?q=' + encodeURIComponent('感冒')); ok(!r.text.includes('感冒'.repeat(1) + '灵'), '禁售商品前台不可见');
  r = await g.get('/product/' + roll.id); const plain = stripTags(r.text);
  ok(r.text.includes('由供应商发货') && r.text.includes('class="tag demo"'), '商品页显示「由供应商发货」「演示」');
  ok(!plain.includes('京东') && !/JD/.test(plain), '商品页无「京东」字样');
  r = await g.get('/product/' + shirt.id); ok(!r.text.includes('class="mkt"') && !r.text.includes('¥' + Number(skuOf('900017001').supplier_retail).toFixed(2)), '不展示供应商参考价/划线价');
  r = await g.get('/products'); ok(!stripTags(r.text).includes('京东'), '列表页无「京东」字样');

  console.log('== 结算校验 ==');
  r = await a.post('/checkout', { sku_id: String(rs.id), qty: '3' }); const its = itemsRaw(r.text);
  ok(r.text.includes('确认订单') && r.text.includes('由供应商发货') && r.text.includes('含供应商发货运费'), '结算页标注供应商发货与运费', r.status);
  let q = JSON.parse((await a.post('/api/quote', { items: its, address_id: '2' }, { json: true })).text);
  ok(q.ok && q.freight === 0 && q.supplierErrors.length === 0, '满额免运费(供应商运费查询)', JSON.stringify(q));
  r = await a.post('/checkout', { sku_id: String(skuOf('900017005').id), qty: '1' }); const itsSmall = itemsRaw(r.text);
  const svcX = require('../lib/svc'), cloudFree = require('../lib/cloud').freeShippingFor(db.get('SELECT * FROM users WHERE id=2'));
  q = JSON.parse((await a.post('/api/quote', { items: itsSmall, address_id: '2' }, { json: true })).text); ok(q.ok && q.freight === (cloudFree ? 0 : 6), '不满额收取供应商运费 ¥6(云商卡会员包邮则为 0,由本店承担)', JSON.stringify(q));
  const b = new C(); await b.login('13800000003', '123456'); const bFree = require('../lib/cloud').freeShippingFor(db.get('SELECT * FROM users WHERE id=3'));
  r = await b.post('/checkout', { sku_id: String(skuOf('900017005').id), qty: '1' });
  q = JSON.parse((await b.post('/api/quote', { items: itemsRaw(r.text), address_id: '3' }, { json: true })).text); ok(q.ok && q.freight === (bFree ? 0 : 6), '另一用户:供应商运费 ¥' + (bFree ? 0 : 6), JSON.stringify(q));
  q = JSON.parse((await b.post('/api/quote', { items: itemsRaw(r.text), address_id: 'new', province: '西藏自治区', city: '拉萨市', district: '城关区', detail: '北京中路 1 号' }, { json: true })).text); ok(q.ok && q.freight === (bFree ? 0 : 16), '偏远地区运费 ¥16', JSON.stringify(q));
  q = JSON.parse((await a.post('/api/quote', { items: itsSmall, address_id: 'new', province: '浙江省', city: '杭州市', district: '西湖区', detail: '无法识别的地址' }, { json: true })).text);
  ok(q.ok && q.supplierErrors.some(e => e.includes('地址无法识别')), '无法识别的地址 → 清晰错误', JSON.stringify(q));
  await adm.post('/admin/jdvop/mock/sku', { sku: '900017005', saleState: '0' });
  q = JSON.parse((await a.post('/api/quote', { items: itsSmall, address_id: '2' }, { json: true })).text); ok(q.supplierErrors.some(e => e.includes('暂不可售')), '供应商不可售 → 提示', JSON.stringify(q));
  r = await a.post('/order/create', { items: itsSmall, address_id: '2' }); ok(r.loc === '/cart' && !db.get("SELECT 1 FROM order_items WHERE supplier_sku='900017005'"), '不可售时无法下单');
  await adm.post('/admin/jdvop/mock/sku', { sku: '900017005', saleState: '1' });
  await adm.post('/admin/jdvop/mock/sku', { sku: '900016001', sellPrice: '30' });
  q = JSON.parse((await a.post('/api/quote', { items: its, address_id: '2' }, { json: true })).text);
  ok(q.supplierErrors.some(e => e.includes('价格已更新为 ¥33.00')) && skuOf('900016001').price === 33, '实时价格校验:成本上涨 → 更新售价并提示', JSON.stringify(q));
  await adm.post('/admin/jdvop/mock/sku', { sku: '900016001', sellPrice: '19.9' });
  q = JSON.parse((await a.post('/api/quote', { items: its, address_id: '2' }, { json: true })).text);
  ok(skuOf('900016001').price === 25.9, '成本回落后售价恢复');

  console.log('== 下单 → 支付后推送供应商 ==');
  const bal0 = +J.mock.getBalance().data;
  r = await a.post('/order/create', { items: its, address_id: '2' }); const oid = +(r.loc || '').match(/order\/(\d+)/)[1];
  ok(oid && !soOf(oid), '下单后未支付:不推送供应商');
  ok(db.get("SELECT COUNT(*) n FROM order_items WHERE order_id=? AND supplier='jdvop' AND supplier_sku='900016001' AND cost_price=19.9", oid).n === 1, '订单商品记录供应商 SKU 与成本');
  await a.post('/order/' + oid + '/pay', { method: 'wechat' });
  let so = await waitFor(() => { const x = soOf(oid); return x && x.status === 'confirmed' ? x : null; });
  ok(so && so.order_sn && so.deduction_price > 0, '支付后自动 预下单+确认订单', JSON.stringify(soOf(oid)));
  ok(+J.mock.getBalance().data < bal0, '供应商预存款已扣减(mock)');
  r = await adm.get('/admin/orders/' + oid); ok(r.text.includes('供应商发货') && r.text.includes(so.order_sn) && r.text.includes('无需手动发货'), '后台订单页显示供应商单号/状态');
  r = await adm.post('/admin/orders/' + oid + '/ship', { company: '中通快递', tracking_no: 'ZT1234567890' }); ok(db.get('SELECT status FROM orders WHERE id=?', oid).status === 'paid', '供应商订单不能手动发货');
  r = await adm.post('/admin/orders/' + oid + '/cancel', { reason: 'x' }); ok(db.get('SELECT status FROM orders WHERE id=?', oid).status === 'paid', '已推送供应商的订单不能直接取消退款(需走供应商取消)');

  console.log('== 回调:拆单/发货/签收、幂等、校验 ==');
  await adm.post('/admin/jdvop/orders/' + so.id + '/simulate', { action: 'ship' });
  const pk = db.all("SELECT * FROM order_packages WHERE order_id=? AND source='jdvop'", oid);
  ok(pk.length >= 1 && JSON.parse(pk[0].tracking_nos).length === 1, '发货回调 → 包裹与运单号', JSON.stringify(pk));
  ok(db.get('SELECT status FROM orders WHERE id=?', oid).status === 'shipped', '全部包裹发出 → 订单待收货');
  r = await a.get('/order/' + oid); ok(r.text.includes('包裹 1') && r.text.includes('供应商物流') && r.text.includes(JSON.parse(pk[0].tracking_nos)[0]), '前台订单显示包裹与运单号');
  r = await a.get('/order/' + oid + '/logistics'); ok(!stripTags(r.text).includes('京东') && !r.text.includes('模拟物流更新'), '物流页无「京东」字样、无演示轨迹按钮');
  const cbBody = JSON.stringify({ tenantAppId: 'MOCK-TENANT-APP', interfaceTypeCode: 'jd_mall_interface', interfaceCode: 'orderPush', data: { type: 14, childOrderSn: pk[0].child_order_sn, createTime: '2026-10-17 10:00:00' } });
  const n0 = db.get('SELECT COUNT(*) n FROM supplier_callbacks').n, t0 = db.get('SELECT COUNT(*) n FROM traces WHERE order_id=?', oid).n;
  let c1 = await g.req('POST', '/api/suppliers/jdvop/callback', null, { raw: cbBody }), c2 = await g.req('POST', '/api/suppliers/jdvop/callback', null, { raw: cbBody });
  ok(c1.status === 200 && JSON.parse(c1.text).code === 200 && c2.status === 200, '回调接口应答 code=200', c1.text);
  ok(db.get('SELECT COUNT(*) n FROM supplier_callbacks').n === n0 + 1, '重复回调只记录一次(幂等)');
  const t1 = db.get('SELECT COUNT(*) n FROM traces WHERE order_id=?', oid).n; await g.req('POST', '/api/suppliers/jdvop/callback', null, { raw: cbBody });
  ok(db.get('SELECT COUNT(*) n FROM traces WHERE order_id=?', oid).n === t1, '重复回调不会重复处理');
  let bad = await g.req('POST', '/api/suppliers/jdvop/callback', null, { raw: JSON.stringify({ interfaceTypeCode: 'other', data: { type: 13 } }) }); ok(bad.status === 403, '非法回调被拒绝', bad.status);
  bad = await g.req('POST', '/api/suppliers/jdvop/callback', null, { raw: '{}' }); ok(bad.status === 403, '空报文被拒绝');
  await adm.post('/admin/jdvop/orders/' + so.id + '/simulate', { action: 'deliver' });
  ok(db.get("SELECT delivered FROM order_packages WHERE order_id=? AND source='jdvop'", oid).delivered === 1, '签收回调(以查询结果为准)');

  console.log('== 售后:先查可售后再创建,供应商退款后才退顾客 ==');
  const pkg = db.get("SELECT * FROM order_packages WHERE order_id=? AND source='jdvop'", oid);
  r = await adm.post('/admin/orders/' + oid + '/jdvop-aftersale', { package_id: String(pkg.id), sku: '900016001', qty: '1', afs_type: '1', pick_type: '1', reason: '商品破损', image_urls: '' });
  ok(!db.get('SELECT 1 FROM aftersales WHERE order_id=?', oid), '缺少问题图片 → 不提交');
  r = await adm.post('/admin/orders/' + oid + '/jdvop-aftersale', { package_id: String(pkg.id), sku: '900016001', qty: '5', afs_type: '1', pick_type: '1', reason: '商品破损', image_urls: 'https://example.com/a.jpg' });
  ok(!db.get('SELECT 1 FROM aftersales WHERE order_id=?', oid), '超出可售后数量 → 供应商校验拦截');
  r = await adm.post('/admin/orders/' + oid + '/jdvop-aftersale', { package_id: String(pkg.id), sku: '900016001', qty: '1', afs_type: '1', pick_type: '1', reason: '商品破损', image_urls: 'https://example.com/a.jpg' });
  const as = db.get('SELECT * FROM aftersales WHERE order_id=?', oid);
  ok(as && as.supplier === 'jdvop' && as.supplier_afs_sn && as.supplier_afs_sn.length <= 20 && as.status === 'pending' && as.amount === 25.9, '创建供应商售后单(afsSn ≤20 位)', JSON.stringify(as));
  r = await adm.post('/admin/aftersales/' + as.id + '/handle', { action: 'approve' }); ok(db.get('SELECT status FROM aftersales WHERE id=?', as.id).status === 'pending', '供应商售后不能走手动审核/退款');
  await adm.post('/admin/jdvop/aftersales/' + as.id + '/sim-afs_approve'); ok(db.get('SELECT status FROM aftersales WHERE id=?', as.id).status === 'approved_return', '供应商审核通过 → 同步状态');
  ok(db.get('SELECT status FROM orders WHERE id=?', oid).status === 'shipped' && !db.get("SELECT 1 FROM traces WHERE order_id=? AND text LIKE '%部分退款%'", oid), '供应商退款前不给顾客退款');
  await adm.post('/admin/jdvop/aftersales/' + as.id + '/sim-afs_refund');
  const as2 = db.get('SELECT * FROM aftersales WHERE id=?', as.id);
  ok(as2.status === 'refunded' && Math.abs(as2.refund_cash - 25.9) < 0.001 && as2.supplier_refunded_at && as2.supplier_refund_amount > 0, '收到 119 退款回调且查询确认 → 自动退款给顾客', JSON.stringify(as2));
  const refunds = db.get("SELECT COUNT(*) n FROM traces WHERE order_id=? AND text LIKE '%退款%'", oid).n;
  const afsCb = db.get("SELECT payload FROM supplier_callbacks WHERE type='119' ORDER BY id DESC").payload;
  await g.req('POST', '/api/suppliers/jdvop/callback', null, { raw: afsCb }); await J.poll();
  ok(db.get("SELECT COUNT(*) n FROM traces WHERE order_id=? AND text LIKE '%退款%'", oid).n === refunds, '重复退款回调/轮询不会重复退款');
  ok(db.get("SELECT COUNT(*) n FROM messages WHERE user_id=2 AND content LIKE ?", '%售后单 #' + as.id + '%退款已完成%').n === 1, '退款通知顾客一次');

  console.log('== 推单失败 → 自动退款 + 告警 ==');
  r = await a.post('/checkout', { sku_id: String(skuOf('900017005').id), qty: '1' }); const itsF = itemsRaw(r.text);
  r = await a.post('/order/create', { items: itsF, address_id: '2', remark: '测试失败' }); const foid = +(r.loc || '').match(/order\/(\d+)/)[1];
  await a.post('/order/' + foid + '/pay', { method: 'alipay' });
  const fso = await waitFor(() => { const x = soOf(foid); return x && x.status === 'failed' ? x : null; });
  ok(fso && /余额不足/.test(fso.error), '供应商下单失败被标记', JSON.stringify(soOf(foid)));
  ok(db.get('SELECT status FROM orders WHERE id=?', foid).status === 'refunded', '自动全额退款给顾客');
  ok(db.get('SELECT COUNT(*) n FROM supplier_alerts WHERE order_id=? AND resolved=0', foid).n >= 1, '后台告警');
  r = await adm.get('/admin/jdvop/settings'); ok(r.text.includes('下单失败') && r.text.includes('预存款余额'), '设置页显示告警与余额');

  console.log('== 混合购物车:自营 + 供应商,分开发货 ==');
  const own = db.get('SELECT * FROM skus WHERE product_id=4 LIMIT 1');
  const mixItems = JSON.stringify([{ sku_id: own.id, qty: 1 }, { sku_id: skuOf('900017002').id, qty: 1 }]);
  r = await a.post('/checkout', { items: mixItems }); ok(r.text.includes('确认订单') && r.text.includes('由供应商发货'), '混合结算页');
  r = await a.post('/order/create', { items: mixItems, address_id: '2' }); const moid = +(r.loc || '').match(/order\/(\d+)/)[1];
  const mo = db.get('SELECT * FROM orders WHERE id=?', moid);
  ok(mo && mo.freight === 0 && mo.supplier_freight === 0, '混合订单:自营满额包邮 + 供应商满额免运费', JSON.stringify(mo));
  await a.post('/order/' + moid + '/pay', { method: 'wechat' });
  const mso = await waitFor(() => { const x = soOf(moid); return x && x.status === 'confirmed' ? x : null; });
  ok(mso && db.get('SELECT COUNT(*) n FROM order_items WHERE order_id=? AND supplier IS NULL', moid).n === 1, '只把供应商商品推送供应商');
  const supAmt = skuOf('900017002').price, disc = mo.level_discount + mo.coupon_discount + mo.points_discount;
  ok(Math.abs(mso.sale_amount - Math.round((supAmt - disc * supAmt / mo.goods_amount) * 100) / 100) < 0.011, '记录供应商部分顾客实付(折扣按金额分摊)', mso.sale_amount);
  r = await adm.post('/admin/orders/' + moid + '/ship', { company: '中通快递', tracking_no: 'ZT5550001111' });
  ok(db.get('SELECT status, own_shipped_at FROM orders WHERE id=?', moid).status === 'paid' && db.get('SELECT own_shipped_at FROM orders WHERE id=?', moid).own_shipped_at, '自营部分发货后仍为待发货(等供应商)');
  await adm.post('/admin/jdvop/orders/' + mso.id + '/simulate', { action: 'ship' });
  ok(db.get('SELECT status FROM orders WHERE id=?', moid).status === 'shipped', '供应商也发货后 → 待收货');
  r = await a.get('/order/' + moid); ok(r.text.includes('包裹 2') && r.text.includes('ZT5550001111') && r.text.includes('商家发货'), '前台分包裹显示(自营 + 供应商)');

  console.log('== 取消供应商订单 → 回调后退款 ==');
  r = await a.post('/checkout', { sku_id: String(skuOf('900017007').id), qty: '1' }); const itsC = itemsRaw(r.text);
  r = await a.post('/order/create', { items: itsC, address_id: '2' }); const coid = +(r.loc || '').match(/order\/(\d+)/)[1];
  await a.post('/order/' + coid + '/pay', { method: 'wechat' });
  const cso = await waitFor(() => { const x = soOf(coid); return x && x.status === 'confirmed' ? x : null; });
  await adm.post('/admin/jdvop/orders/' + cso.id + '/cancel', { reason: '缺货' });
  const cso2 = await waitFor(() => { const x = soOf(coid); return x && x.status === 'cancelled' ? x : null; });
  ok(cso2 && db.get('SELECT status FROM orders WHERE id=?', coid).status === 'refunded', '取消 → 取消回调 → 自动退款', JSON.stringify(soOf(coid)));

  console.log('== 价格/可售刷新:自动下架与恢复;禁售清单可编辑 ==');
  const tissue = prodOf('900017005');
  await adm.post('/admin/jdvop/mock/sku', { sku: '900017005', removed: '1' });
  await adm.post('/admin/jdvop/refresh');
  let tp = db.get('SELECT * FROM products WHERE id=?', tissue.id); ok(tp.status === 0 && tp.supplier_state === 'auto_delisted', '移出商品池 → 自动下架', JSON.stringify(tp));
  await adm.post('/admin/products/' + tissue.id + '/toggle'); ok(db.get('SELECT status FROM products WHERE id=?', tissue.id).status === 0, '供应商不可售时不能手动上架');
  await adm.post('/admin/jdvop/mock/sku', { sku: '900017005', removed: '0' }); await adm.post('/admin/jdvop/refresh');
  tp = db.get('SELECT * FROM products WHERE id=?', tissue.id); ok(tp.status === 1 && tp.supplier_state === 'ok', '恢复可售 → 自动上架');
  const blk = db.get("SELECT value FROM settings WHERE key='jdvop_blocklist'").value, alw = db.get("SELECT value FROM settings WHERE key='jdvop_allowlist'").value;
  ok(blk === J.compliance.BLOCKLIST_DEFAULT && alw === J.compliance.ALLOWLIST_DEFAULT, '全新库:禁售/允许清单为当前默认');
  const SET = { jdvop_markup_mode: 'max_retail_cost', jdvop_markup_pct: '10', jdvop_sync_hours: '6', jdvop_poll_minutes: '10', jdvop_virtual_stock: '200', jdvop_max_push_attempts: '3' };
  await adm.post('/admin/jdvop/settings', { ...SET, jdvop_blocklist: blk.split('\n').filter(l => !l.startsWith('家用电器')).join('\n'), jdvop_allowlist: alw + '\n测试家电:厨房小电' });
  await adm.post('/admin/jdvop/import', { sku: ['900004001'] }); const fryer = prodOf('900004001'), apple = prodOf('900003001');
  ok(fryer && fryer.status === 1, '后台可编辑允许/禁售清单(加入允许组并去掉家电禁售组后可导入家电)');
  ok(apple && apple.is_perishable === 1 && apple.no_reason_return === 0 && apple.status === 1, '新鲜水果(食用农产品)已上架,不支持7天无理由');
  await adm.post('/admin/jdvop/settings', { ...SET, jdvop_blocklist: blk, jdvop_allowlist: alw });
  let f2 = db.get('SELECT * FROM products WHERE id=?', fryer.id);
  ok(f2.status === 0 && f2.supplier_state === 'blocked', '恢复清单后保存 → 立即复检,已导入的家电自动下架', JSON.stringify(f2));
  await adm.post('/admin/jdvop/refresh'); f2 = db.get('SELECT * FROM products WHERE id=?', fryer.id);
  ok(f2.status === 0 && f2.supplier_state === 'blocked' && db.get('SELECT status FROM products WHERE id=?', apple.id).status === 1, '刷新后仍为禁售下架,允许类目(新鲜水果)不受影响', JSON.stringify(f2));
  await adm.post('/admin/products/' + fryer.id + '/toggle'); ok(db.get('SELECT status FROM products WHERE id=?', fryer.id).status === 0, '禁售商品不能上架');
  console.log('== 规则收紧:已上架商品自动下架,规则放开后恢复 ==');
  const caseP = prodOf('900017001'); ok(caseP.status === 1, '手机壳已上架');
  await adm.post('/admin/jdvop/settings', { ...SET, jdvop_blocklist: blk, jdvop_allowlist: alw.split('\n').filter(l => !l.startsWith('数码配件')).join('\n') });
  let cp2 = db.get('SELECT * FROM products WHERE id=?', caseP.id);
  ok(cp2.status === 0 && cp2.supplier_state === 'blocked' && /经营范围外/.test(cp2.supplier_review_note || ''), '允许清单移除「数码配件」→ 已上架手机壳自动下架并记录原因', JSON.stringify(cp2));
  r = await adm.get('/admin/jdvop/settings'); ok(r.text.includes('自动下架'), '保存提示复检与自动下架数量');
  await adm.post('/admin/products/' + caseP.id + '/toggle'); ok(db.get('SELECT status FROM products WHERE id=?', caseP.id).status === 0, '不在允许范围的商品不能手动上架');
  await adm.post('/admin/products/batch', { ids: [String(caseP.id)], action: 'on' }); ok(db.get('SELECT status FROM products WHERE id=?', caseP.id).status === 0, '批量上架同样被拦截');
  await adm.post('/admin/jdvop/settings', { ...SET, jdvop_blocklist: blk, jdvop_allowlist: alw });
  ok(db.get('SELECT status FROM products WHERE id=?', caseP.id).status === 0, '规则放开后不立即上架(需刷新确认可售)');
  await adm.post('/admin/jdvop/refresh'); cp2 = db.get('SELECT * FROM products WHERE id=?', caseP.id);
  ok(cp2.status === 1 && cp2.supplier_state === 'ok' && !cp2.supplier_review_note, '刷新确认可售后自动恢复上架', JSON.stringify(cp2));
  ok(prodOf('900016001').status === 1 && prodOf('900003001').status === 1, '同组数据线也已恢复,食用农产品全程不受影响');
  r = await adm.get('/admin/jdvop/settings'); ok(r.text.includes('name="jdvop_allowlist"') && r.text.includes('2026-10-19') && r.text.includes('只允许数码') && r.text.includes('办公设备经营范围仅为租赁'), '设置页显示允许清单/禁售清单编辑器与说明');
  r = await adm.get('/admin/jdvop/mapping?rv=ok'); ok(r.status === 200 && r.text.includes('预包装食品·待经营范围变更+食品备案'), '分类映射页可按审核结果筛选(含预包装食品组)');
  console.log('== 自营商品:类目超范围仅提示不拦截 ==');
  const tp0 = db.get('SELECT id FROM categories WHERE parent_id=0 ORDER BY id LIMIT 1').id;
  const outCat = db.exec1("INSERT INTO categories(name,parent_id,sort,status) VALUES('日用百货(测试)',?,99,1)", tp0).lastInsertRowid;
  r = await adm.get('/admin/products/quick'); ok(r.text.includes('data-scope=') && r.text.includes('class="flash warn scope-hint" hidden'), '快速上架页:超范围分类带提示数据(选择后显示提示)');
  r = await adm.post('/admin/products/quick', { name: '测试收纳盒', subtitle: '', category_id: String(outCat), template_id: '1', price: '9.9', stock: '10', brand_id: '0' });
  const qp = db.get("SELECT * FROM products WHERE name='测试收纳盒'");
  ok(qp && qp.status === 1 && (r.loc || '').includes('/admin/products/' + qp.id + '/edit'), '超范围分类自营商品仍可保存(非拦截)', r.loc);
  r = await adm.get(r.loc); ok(r.text.includes('经营范围提示') && r.text.includes('日用百货'), '保存后与编辑页显示经营范围提示');
  r = await adm.get('/admin/products/' + roll.id + '/edit'); ok(!/class="flash warn scope-hint"(?! hidden)/.test(r.text), '供应商商品编辑页不显示自营类目提示');
  r = await adm.get('/admin/products/1/edit'); ok(r.text.includes('class="flash warn scope-hint" hidden'), '范围内分类(手机通讯)不提示');
  db.exec1('DELETE FROM skus WHERE product_id=?', qp.id); db.exec1('DELETE FROM products WHERE id=?', qp.id); db.exec1('DELETE FROM categories WHERE id=?', outCat);
  ok(db.get('SELECT status FROM products WHERE id=1').status === 1, '自营商品不被供应商规则自动处理');

  console.log('== 后台页面 ==');
  for (const p of ['/admin/jdvop/products', '/admin/jdvop/mapping', '/admin/jdvop/settings', '/admin/jdvop/logs', '/admin/jdvop/reconcile', '/admin/aftersales/' + as.id, '/admin/orders/' + moid]) { r = await adm.get(p); ok(r.status === 200 && !r.text.includes('服务器开小差'), '后台页面 ' + p, r.status); }
  r = await adm.get('/admin/jdvop/reconcile'); ok(r.text.includes(mo.order_no) && r.text.includes('毛利'), '对账页:每单成本 vs 售价');
  const rec = J.reconcile(); const rr = rec.rows.find(x => x.order_id === foid); ok(rr && rr.cost === 0 && rr.custRefund === rr.sale_amount && rr.margin === 0, '失败订单对账:无成本、已全额退款');
  r = await adm.get('/admin/jdvop/logs'); ok(r.text.includes('submitOrder') && r.text.includes('confirmOrder') && !r.text.includes('13800001001'), '接口日志记录每次调用且手机号脱敏');
  ok(db.get('SELECT COUNT(*) n FROM supplier_call_logs').n > 20, '调用日志已写入');
  r = await adm.get('/admin/jdvop/mapping'); const mp = db.get("SELECT * FROM supplier_category_map WHERE supplier_cat_id='13658'");
  const otherCat = db.get('SELECT id FROM categories WHERE parent_id>0 AND id<>? ORDER BY id LIMIT 1', mp.category_id).id;
  await adm.post('/admin/jdvop/mapping/13658', { category_id: String(otherCat), apply: '1' });
  ok(db.get('SELECT category_id FROM products WHERE id=?', roll.id).category_id === otherCat && db.get("SELECT reviewed FROM supplier_category_map WHERE supplier_cat_id='13658'").reviewed === 1, '分类映射可编辑并同步到商品');
  r = await g.get('/products?cat=' + otherCat); ok(r.text.includes(roll.name), '修改映射后出现在新分类标签');

  console.log('== 默认清单迁移:旧默认自动升级,管理员改过的保留 ==');
  {
    const migrate = require('../lib/suppliers/jdvop/schema'), CC = J.compliance, setV = (k, v) => db.exec1('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', k, v), getV = k => db.get('SELECT value FROM settings WHERE key=?', k).value;
    const keep = { b: getV('jdvop_blocklist'), a: getV('jdvop_allowlist') };
    setV('jdvop_blocklist', CC.BLOCKLIST_OLD_DEFAULTS[1]); migrate(db); ok(getV('jdvop_blocklist') === CC.BLOCKLIST_DEFAULT, '2026-10-17 版默认禁售清单 → 自动升级为当前默认');
    setV('jdvop_blocklist', CC.BLOCKLIST_OLD_DEFAULTS[0]); migrate(db); ok(getV('jdvop_blocklist') === CC.BLOCKLIST_DEFAULT, '更早版本默认禁售清单 → 自动升级');
    const custom = CC.BLOCKLIST_OLD_DEFAULTS[1] + '\n自定义:测试词';
    setV('jdvop_blocklist', custom); migrate(db); ok(getV('jdvop_blocklist') === custom, '管理员改过的禁售清单保留不动');
    setV('jdvop_allowlist', '自定义允许:鼠标'); migrate(db); ok(getV('jdvop_allowlist') === '自定义允许:鼠标', '管理员改过的允许清单保留不动');
    db.exec1("DELETE FROM settings WHERE key='jdvop_allowlist'"); migrate(db); ok(getV('jdvop_allowlist') === CC.ALLOWLIST_DEFAULT, '旧库无允许清单 → 写入默认允许清单');
    setV('jdvop_blocklist', keep.b); setV('jdvop_allowlist', keep.a);
  }

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); console.log(`\n结果: ${pass} 通过, ${fail + 1} 失败`); process.exit(1); });
