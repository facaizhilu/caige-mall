// mock 适配器:按文档示例结构返回「像真的一样」的数据,不发出任何网络请求。
// 状态(订单/售后/商品调价下架/预存款)保存在 jdvop_mock_state 表中,以便后台「模拟」按钮推进并触发回调。
const crypto = require('crypto');
const db = require('../../db');

// ---------- 演示分类(京东分类 ID 体系;名称仅为演示) ----------
const CATS = [
  [15901, 0, 1, '家庭清洁/纸品'], [15902, 15901, 2, '清洁纸品'], [15909, 15902, 3, '卷纸'], [15910, 15902, 3, '抽纸'],
  [1320, 0, 1, '食品饮料'], [36722, 1320, 2, '牛奶乳品'], [36835, 36722, 3, '纯牛奶'], [36836, 36722, 3, '植物蛋白饮料'], [1583, 1320, 2, '休闲食品'], [1590, 1583, 3, '坚果炒货'], [1591, 1583, 3, '膨化食品'],
  [12218, 0, 1, '生鲜'], [12221, 12218, 2, '水果'], [12236, 12221, 3, '苹果'], [12222, 12218, 2, '海鲜水产'], [12240, 12222, 3, '虾类'],
  [737, 0, 1, '家用电器'], [752, 737, 2, '厨房小电'], [881, 752, 3, '电压力锅'], [758, 752, 3, '电水壶'], [13702, 752, 3, '空气炸锅'],
  [1315, 0, 1, '服饰内衣'], [1343, 1315, 2, '女装'], [1354, 1343, 3, '衬衫'],
  [16750, 0, 1, '个人护理'], [16752, 16750, 2, '洗发护发'], [16760, 16752, 3, '洗发水'], [16754, 16750, 2, '口腔护理'], [16764, 16754, 3, '牙膏'],
  [670, 0, 1, '电脑、办公'], [686, 670, 2, '外设产品'], [690, 686, 3, '鼠标'], [691, 686, 3, '键盘'],
  [1318, 0, 1, '运动户外'], [12099, 1318, 2, '运动鞋包'], [9756, 12099, 3, '跑步鞋'],
  [9192, 0, 1, '医药保健'], [9193, 9192, 2, '中西药品'], [9200, 9193, 3, '感冒用药'],
  [12259, 0, 1, '酒类'], [12260, 12259, 2, '白酒'], [12261, 12260, 3, '浓香型白酒'],
  // 2026-10-17 曾按「首批开放」准备的箱包/厨具餐具/文具/美妆护肤演示类目:按 2026-10-19 实际登记的经营范围已不在范围内(保留用于展示拦截)
  [17329, 0, 1, '箱包皮具'], [2575, 17329, 2, '功能箱包'], [2578, 2575, 3, '双肩包'],
  [6196, 0, 1, '厨具'], [6197, 6196, 2, '烹饪锅具'], [6199, 6197, 3, '炒锅'], [6219, 6196, 2, '餐具'], [6223, 6219, 3, '碗'],
  [729, 670, 2, '文具'], [2603, 729, 3, '笔类'],
  [1316, 0, 1, '美妆护肤'], [1381, 1316, 2, '面部护肤'], [1391, 1381, 3, '面霜'],
  [9987, 0, 1, '手机通讯'], [830, 9987, 2, '手机配件'], [13658, 830, 3, '数据线'], [13657, 830, 3, '移动电源'], [652, 0, 1, '数码'], [828, 652, 2, '影音娱乐'], [842, 828, 3, '蓝牙耳机'],
  // 允许清单内(经营范围:电子产品/计算机及辅助设备/网络设备、食用农产品)
  [866, 830, 3, '手机壳'], [13659, 830, 3, '充电器'], [829, 652, 2, '数码配件'], [845, 829, 3, '存储卡'], [843, 828, 3, '蓝牙音箱'],
  [699, 670, 2, '网络产品'], [700, 699, 3, '路由器'], [693, 686, 3, '移动硬盘'],
  [12237, 12221, 3, '芒果'], [13553, 12218, 2, '蔬菜'], [13554, 13553, 3, '叶菜类'], [13586, 12218, 2, '蛋品'], [13587, 13586, 3, '鸡蛋'],
  // 用于展示拦截:数码整机(=手机)、办公设备(仅租赁)、预包装食品(待变更+备案)、对讲机
  [653, 9987, 2, '手机'], [655, 653, 3, '手机'], [716, 670, 2, '办公设备'], [717, 716, 3, '打印机'], [1584, 1320, 2, '粮油调味'], [2675, 1584, 3, '大米'], [12428, 9987, 2, '对讲机'], [12429, 12428, 3, '对讲机']
].map(([id, parentId, level, name]) => ({ id, parentId, level, name }));
const catById = Object.fromEntries(CATS.map(c => [c.id, c]));
// 三级分类 → [一级, 二级]
const pathOf = c3 => { const c = catById[c3], p = catById[c.parentId]; return [p.parentId, p.id, c.id]; };

// ---------- 演示商品(约 40 个 SKU;价格固定,便于测试) ----------
// [skuId, spuId, 名称, 三级分类, 结算价, 京东价, 图, returnRuleType, 重量kg, 规格标签, 附加]
const RAW = [
  ['900001001', '900001001', '加厚四层有芯卷纸 200g×27卷 整箱装', 15909, 71.3, 79.9, 'roll', 1, 6.19],
  ['900001002', '900001002', '柔韧三层抽纸 100抽×24包 家庭装', 15910, 44.5, 49.9, 'box', 2, 3.2],
  ['900002001', '900002001', '全脂纯牛奶 250ml×16盒 礼盒装', 36835, 46.82, 79.9, 'carton', 2, 4.3],
  ['900002002', '900002002', '低糖燕麦植物奶 1L×6盒', 36836, 58.6, 69, 'carton-2', 2, 6.4],
  ['900007001', '900007001', '每日混合坚果 25g×30袋', 1590, 98, 129, 'nuts', 2, 0.9],
  ['900007002', '900007002', '原味薯片 量贩装 70g×6袋', 1591, 30.5, 39.9, 'chips', 2, 0.5, null, { inStock: false }],
  ['900003001', '900003001', '红富士苹果 5kg 单果200g以上', 12236, 55, 69.9, 'fruit', 0, 5.5],
  ['900003002', '900003002', '冷冻去壳大虾仁 500g', 12240, 47.5, 59.9, 'shrimp', 0, 0.6],
  ['900004001', '900004001', '智能电压力锅 5L 双胆', 881, 352, 399, 'pot', 5, 7],
  ['900004002', '900004002', '不锈钢电热水壶 1.7L', 758, 108, 129, 'kettle', 1, 1.3],
  ['900004003', '900004003', '无油空气炸锅 4.5L', 13702, 262, 299, 'fryer', 1, 4.6, null, { restrict: [26] }],
  ['900006001', '900006001', '氨基酸控油洗发水 750ml', 16760, 52, 69.9, 'bottle', 2, 0.85],
  ['900006002', '900006002', '清新薄荷牙膏 120g×3支', 16764, 22.8, 29.9, 'tube', 2, 0.45],
  ['900009001', '900009001', '办公无线静音鼠标 销量第一', 690, 61, 79, 'mouse', 1, 0.15],
  ['900009002', '900009002', '87键机械键盘 青轴', 691, 199, 259, 'keyboard', 1, 1.1],
  ...['39', '40', '41'].map((s, i) => [`90000810${i + 1}`, '900008100', `轻量缓震跑步鞋 ${s}码`, 9756, 238, 299, 'shoe', 4, 0.8, { 尺码: s }]),
  ['900010001', '900010001', '感冒清热颗粒 10袋', 9200, 15, 19.8, 'box', 0, 0.2],
  ['900011001', '900011001', '浓香型白酒 52度 500ml', 12261, 168, 199, 'bottle', 0, 1.1],
  // 经营范围外(箱包/厨具/餐具/文具/护肤)演示商品:用于展示拦截
  ...['黑色', '深灰'].flatMap((c, ci) => ['小号', '中号', '大号'].map((z, zi) => [`90000510${ci * 3 + zi + 1}`, '900005100', `商务双肩包 大容量 ${c} ${z}`, 2578, 140.39, 139, ci ? 'bag-grey' : 'bag', 1, 1.1, { 颜色: c, 尺寸: z }])),
  ['900013001', '900013001', '不粘炒锅 30cm 少油烟', 6199, 65, 75, 'wok', 1, 1.6],
  ['900013002', '900013002', '陶瓷饭碗 4.5英寸 10只装', 6223, 39.9, 49.9, 'bowl', 1, 2.2],
  ['900014001', '900014001', '按动中性笔 0.5mm 黑色 12支', 2603, 15.9, 19.9, 'pen', 1, 0.2],
  ['900015001', '900015001', '保湿补水面霜 50g', 1391, 69, 89, 'jar', 2, 0.15],
  ...['1米', '2米'].map((l, i) => [`90001600${i + 1}`, '900016001', `Type-C 快充数据线 ${l}`, 13658, 19.9 + i * 5, 25.9 + i * 5, 'cable', 1, 0.05, { 长度: l }]),
  ['900016003', '900016003', '移动电源 10000mAh', 13657, 79, 99, 'powerbank', 1, 0.25, null, { self: 0 }],
  ['900016004', '900016004', '入耳式蓝牙耳机', 842, 99, 129, 'earbuds', 0, 0.1],
  // 允许清单内的演示商品(数码配件 / 电脑外设与网络设备 / 食用农产品),演示环境自动导入后上架
  ...['黑色', '雾蓝'].map((c, i) => [`90001700${i + 1}`, '900017001', `磨砂防摔手机壳 ${c}`, 866, 36.39, 36, i ? 'case-blue' : 'case', 1, 0.05, { 颜色: c }]),
  ['900017004', '900017004', '20W PD 快充充电器', 13659, 45, 59, 'powerbank', 1, 0.1],
  ['900017005', '900017005', 'microSD 存储卡 128GB', 845, 52, 69, 'sdcard', 2, 0.02],
  ['900017006', '900017006', '便携蓝牙音箱 防水', 843, 119, 149, 'speaker', 1, 0.5],
  ['900017007', '900017007', '双频千兆无线路由器', 700, 159, 199, 'router', 1, 0.6],
  ['900017008', '900017008', '移动硬盘 1TB USB3.0', 693, 289, 349, 'hdd', 2, 0.25],
  ['900018001', '900018001', '海南金煌芒果 5斤装', 12237, 49, 59.9, 'mango', 0, 2.6],
  ['900018002', '900018002', '新鲜菠菜 500g', 13554, 6.5, 8.9, 'veg', 0, 0.55],
  ['900018003', '900018003', '新鲜鸡蛋 30枚装', 13587, 28, 35.9, 'egg', 0, 1.8],
  // 用于展示拦截:整机(=手机)、打印机(办公设备仅租赁)、大米(预包装食品)、对讲机
  ['900019001', '900019001', '5G 智能手机 8+256GB', 655, 1699, 1999, 'phone', 1, 0.4],
  ['900019002', '900019002', '黑白激光打印机', 717, 699, 799, 'printer', 1, 6.5],
  ['900019003', '900019003', '东北大米 5kg', 2675, 39, 49.9, 'rice', 0, 5.1],
  ['900019004', '900019004', '民用对讲机 一对装', 12429, 149, 199, 'phone', 1, 0.5],
  // 经营范围外类目(服饰)保留为演示数据,用于展示禁售拦截
  ...['白色', '雾霾蓝'].flatMap((c, ci) => ['S', 'M', 'L'].map((s, si) => [`90001210${ci * 3 + si + 1}`, '900012100', `女士系带短袖衬衫 雪纺 ${c} ${s}`, 1354, 140.39, 139, ci ? 'shirt-blue' : 'shirt', 1, 0.3, { 颜色: c, 尺码: s }]))
];
const RULE_TEXT = { 0: '', 1: '支持7天无理由退货', 2: '支持7天无理由退货（拆封后不支持）', 4: '支持7天无理由退货（使用后不支持）', 5: '支持7天无理由退货（安装后不支持）' };
const SKUS = RAW.map(([skuId, spuId, name, c3, sellPrice, retail, img, rr, weight, label, extra]) => {
  const [c1, c2] = pathOf(c3);
  return { skuId, spuId, skuName: name, c1, c2, c3, sellPrice, retail, imagePath: 'mock-demo/' + img + '.png', returnRuleType: rr, weight, label: label || null, brandName: '韵农甄选', ...(extra || {}) };
});
const skuById = Object.fromEntries(SKUS.map(s => [s.skuId, s]));

// ---------- 状态 ----------
const st = {
  get(kind, k) { const r = db.get('SELECT data FROM jdvop_mock_state WHERE kind=? AND k=?', kind, String(k)); return r ? JSON.parse(r.data) : null; },
  set(kind, k, v) { db.exec1('INSERT OR REPLACE INTO jdvop_mock_state(kind,k,data) VALUES(?,?,?)', kind, String(k), JSON.stringify(v)); return v; },
  all(kind) { return db.all('SELECT k, data FROM jdvop_mock_state WHERE kind=?', kind).map(r => JSON.parse(r.data)); },
  seq(name) { const v = (st.get('seq', name) || 0) + 1; st.set('seq', name, v); return v; }
};
const ov = id => st.get('sku', id) || {};
/** 后台「模拟供应商调价/下架」 */
function setSkuOverride(skuId, patch) { return st.set('sku', skuId, { ...ov(skuId), ...patch }); }
function skuNow(id) { const s = skuById[String(id)]; if (!s) return null; return { ...s, ...ov(s.skuId) }; }
const balance = () => { const b = st.get('balance', 'v'); return b == null ? 5000 : b; };
const setBalance = v => st.set('balance', 'v', Math.round(v * 100) / 100);

const OK = data => ({ code: 200, msg: '操作成功', error: false, success: true, warn: false, data: data === undefined ? null : data });
const ERR = (msg, code = 500) => ({ code, msg, error: true, success: false, warn: false, data: null });
const r2 = n => Math.round(n * 100) / 100;
const h = (s, mod) => parseInt(crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 8), 16) % mod;

// ---------- 地址 ----------
const PROV = { 北京: 1, 上海: 2, 天津: 3, 重庆: 4, 河北: 5, 山西: 6, 河南: 7, 辽宁: 8, 吉林: 9, 黑龙江: 10, 内蒙古: 11, 江苏: 12, 山东: 13, 安徽: 14, 浙江: 15, 福建: 16, 湖北: 17, 湖南: 18, 广东: 19, 广西: 20, 江西: 21, 四川: 22, 海南: 23, 贵州: 24, 云南: 25, 西藏: 26, 陕西: 27, 甘肃: 28, 青海: 29, 宁夏: 30, 新疆: 31 };
const REMOTE = [26, 31, 29];
function changeArea({ addressDetailStr }) {
  const s = String(addressDetailStr || '');
  if (!s || /无法识别/.test(s)) return ERR('地址解析失败,请检查详细地址');
  const pn = Object.keys(PROV).find(p => s.startsWith(p)); if (!pn) return ERR('地址解析失败:未识别省份');
  const rest = s.slice(pn.length).replace(/^(省|市|维吾尔自治区|壮族自治区|回族自治区|自治区)/, '');
  const m = rest.match(/^(.+?(市|州|盟|地区))?(.+?(区|县|市|旗|镇|街道))?(.*)$/) || [];
  const cityName = m[1] || pn + '市', countyName = m[3] || '城区';
  const provinceId = PROV[pn], cityId = 1000 + h(pn + cityName, 8000), countyId = 10000 + h(cityName + countyName, 40000), townId = /无四级/.test(s) ? 0 : 50000 + h(s, 10000);
  return OK({ townName: townId ? '城区街道' : '', nationName: '中国', cityName, countyId, nationId: 4744, provinceName: pn, cityId, townId, provinceId, countyName });
}
function checkArea(d) { return d.provinceId && d.cityId && d.countyId ? OK(null) : ERR('四级地址无效'); }
function areaLimit(d) {
  const list = d.skuNumInfoList && d.skuNumInfoList.length && d.skuNumInfoList[0].skuId ? d.skuNumInfoList.map(x => String(x.skuId)) : String(d.skuId || '').split(',').filter(Boolean);
  return OK(list.map(id => {
    const s = skuNow(id); if (!s) return { skuId: id, isSell: false, returnRuleStr: '', returnRuleType: 0, noReasonToReturn: 0, areaRestrict: false, inStock: false };
    const restrict = (s.restrict || []).includes(+d.provinceId);
    return { skuId: id, isSell: s.saleState !== 0, returnRuleStr: RULE_TEXT[s.returnRuleType] || '', returnRuleType: s.returnRuleType, noReasonToReturn: s.returnRuleType ? 1 : 0, areaRestrict: restrict, inStock: s.inStock !== false && !restrict };
  }));
}
// 运费(演示规则,单位按「元」处理 — 文档未说明单位,见 TODO):商品金额满 59 元免基础运费,否则 6 元;偏远地区每单 +10
function freight(d) {
  const items = (d.skuInfo || []).map(x => ({ s: skuNow(x.skuId), n: +x.skuNum || 1 })).filter(x => x.s);
  const total = items.reduce((a, x) => a + x.s.sellPrice * x.n, 0);
  const base = items.length && total < 59 ? 6 : 0, remote = REMOTE.includes(+d.provinceId) && items.length ? 10 : 0;
  return OK({ baseFreight: String(base), remoteRegionFreight: String(remote), totalFreight: String(base + remote), remoteRegionSkuIdList: remote ? items.map(x => ({ skuId: x.s.skuId })) : [], continueWeightFreight: '0' });
}

// ---------- 商品 ----------
const goodsOf = s => ({ skuId: +s.skuId, brandName: s.brandName, categoryOne: s.c1, categoryOneName: catById[s.c1].name, categoryTwo: s.c2, categoryTwoName: catById[s.c2].name, categoryThree: s.c3, categoryThreeName: catById[s.c3].name, selfSellType: s.self === 0 ? 0 : 1, logisticsType: 1, skuName: s.skuName, imagePath: s.imagePath, yn: s.saleState === 0 ? 2 : 1, sellPrice: s.sellPrice, retail: s.retail });
function searchGoodsList(d) {
  let list = SKUS.map(s => skuNow(s.skuId)).filter(s => s.removed !== true);
  const seen = new Set(); list = list.filter(s => (seen.has(s.spuId) ? false : seen.add(s.spuId))); // 同一 spu 只返回一个 sku(与文档一致)
  if (d.categoryOne) list = list.filter(s => s.c1 === +d.categoryOne);
  if (d.categoryTwo) list = list.filter(s => s.c2 === +d.categoryTwo);
  if (d.categoryThree) list = list.filter(s => s.c3 === +d.categoryThree);
  if (d.skuName) list = list.filter(s => s.skuName.includes(String(d.skuName)));
  if (+d.sort === 2) list.sort((a, b) => a.sellPrice - b.sellPrice); else if (+d.sort === 3) list.sort((a, b) => b.sellPrice - a.sellPrice);
  const page = Math.max(1, +d.page || 1), limit = Math.min(100, Math.max(1, +d.limit || 20));
  const agg = {}; for (const s of list) for (const [lv, id] of [[1, s.c1], [3, s.c3]]) { const k = lv + ':' + id; agg[k] = agg[k] || { cateLevel: lv, cateSkuCount: 0, parentCategoryId: catById[id].parentId, cateField: lv === 1 ? 'cid1' : 'catid', cateName: catById[id].name, categoryId: id, cateWeight: 0 }; agg[k].cateSkuCount++; }
  return OK({ count: Math.min(3000, list.length), list: list.slice((page - 1) * limit, page * limit).map(goodsOf), searchCategoryInfo: Object.values(agg), extAttrAggList: null });
}
function detail(d) {
  const s = skuNow(d.skuId); if (!s || s.removed) return ERR('商品不存在或不在商品池');
  const img = 'https://img13.360buyimg.com/n12/s800x800_' + s.imagePath;
  return OK({ detail: {
    brand_name: s.brandName, category: `${s.c1};${s.c2};${s.c3}`, category_one: String(s.c1), category_two: String(s.c2), category_three: String(s.c3),
    categoryAttrList: [{ cateAttrName: '产地', cateAttrSort: 1, cateAttrValList: ['中国大陆'] }, { cateAttrName: '适用场景', cateAttrSort: 2, cateAttrValList: ['家用'] }],
    color: s.label ? Object.values(s.label).join(' ') : '', giveawayType: 0, height: '200', imagePath: s.imagePath, defaultImagePath: img,
    imageList: [{ created: 1746775085246, id: 6038343760 + h(s.skuId, 1000), imgType: 0, isPrimary: 1, modified: 1746775085246, orderSort: 0, position: 0, shortPath: img, skuId: s.skuId, yn: 1 }],
    introduce: "<style>.ssd-module-wrap{width:750px}</style><div class='ssd-module-wrap'><p>京东自营 正品行货</p></div>", introduceApp: '', introducePc: '', introduceWechat: '[]', introduceImgList: [],
    length: '300', logisticsType: 1, productArea: '中国大陆', retail: String(s.retail), saleUnit: '件', saveEnergyType: 0, selfSellType: s.self === 0 ? 0 : 1, sellPrice: s.sellPrice, seoModel: s.skuName.split(' ')[0], size: s.label && s.label.尺码 || '',
    sku_id: s.skuId, is_main: s.skuId === s.spuId || s.skuId.endsWith('1') ? 1 : 0, deliveryTime: 0, skuName: s.skuName, skuState: s.saleState === 0 ? 0 : 1, lowestBuy: 1, skuType: 1, specificParam: '', spuId: +s.spuId, spuName: s.skuName,
    taxCode: '1060102030000000000', taxRatePercentage: 13, wareInfo: `${s.skuName.split(' ')[0]} ×1;京东物流仓配发货`, warrantDesc: '以商品说明为准', weight: String(s.weight), width: '200', capacity: ''
  } });
}
function similar(d) {
  const s0 = skuNow(d.skuId); if (!s0 || s0.removed) return ERR('商品不存在或不在商品池');
  const group = SKUS.filter(s => s.spuId === s0.spuId).map(s => skuNow(s.skuId)).filter(s => !s.removed);
  return OK(group.map(s => { const img = 'https://img13.360buyimg.com/n12/s800x800_' + s.imagePath; return { imgList: [img], imgPath: s.imagePath, imgUrl: img, label: s.label || { 规格: '默认' }, logisticsType: '京东配送', retail: s.retail.toFixed(2), returnRuleType: s.returnRuleType, saleState: s.saleState === 0 ? 0 : 1, selfType: '京东自营', sellPrice: s.sellPrice, skuName: s.skuName, sku_id: s.skuId }; }));
}
function sellPrice(d) {
  return OK(String(d.skuIds || '').split(',').filter(Boolean).slice(0, 100).map(id => { const s = skuNow(id); return !s || s.removed ? { skuId: id, sellPrice: -1, retail: -1 } : { skuId: id, sellPrice: s.sellPrice, retail: s.retail, taxRate: 13 }; }));
}
function saleList(d) { return OK(String(d.skuIds || '').split(',').filter(Boolean).map(id => { const s = skuNow(id); return { sku_id: +id, saleState: s && !s.removed && s.saleState !== 0 ? 1 : 0 }; })); }

// ---------- 订单 ----------
function submitOrder(d) {
  if (!d.outOrderSn) return ERR('outOrderSn 不能为空');
  const ex = st.all('order').find(o => o.outOrderSn === d.outOrderSn && o.status !== 4);
  if (ex) return OK({ orderId: ex.orderId, orderSn: ex.orderSn, deductionPrice: ex.deductionPrice }); // TODO:真实接口重复第三方单号的行为未说明
  if (/测试失败/.test(d.consigneeName || '') || /测试失败/.test(d.remark || '')) return ERR('预存款余额不足', 500);
  const lines = []; for (const x of d.skuInfo || []) { const s = skuNow(x.skuId); if (!s || s.removed || s.saleState === 0) return ERR(`商品${x.skuId}不可售`); if (s.inStock === false || (s.restrict || []).includes(+d.provinceId)) return ERR(`商品${x.skuId}在该地区无货或不支持配送`); lines.push({ s, n: +x.skuNum || 1 }); }
  if (!lines.length) return ERR('skuInfo 不能为空');
  const skuTotal = r2(lines.reduce((a, x) => a + x.s.sellPrice * x.n, 0));
  const fr = +freight({ skuInfo: d.skuInfo, provinceId: d.provinceId }).data.totalFreight;
  const fee = r2(skuTotal * 0.02), deduction = r2(skuTotal + fr + fee);
  if (balance() < deduction) return ERR('预存款余额不足');
  setBalance(balance() - deduction);
  const no = st.seq('order');
  const o = { orderId: 'MOCKMALL' + String(no).padStart(10, '0'), orderSn: String(880000000000 + no), outOrderSn: d.outOrderSn, status: 2, skuTotal, freight: fr, chargeFee: fee, deductionPrice: deduction,
    consignee: { name: d.consigneeName, mobile: d.consigneeMobile, provinceId: d.provinceId, cityId: d.cityId, countyId: d.countyId, townId: d.townId, address: d.consigneeAddress },
    lines: lines.map(x => ({ skuId: x.s.skuId, skuName: x.s.skuName, imagePath: x.s.imagePath, num: x.n, price: x.s.sellPrice, c1: x.s.c1 })), children: [], createdAt: Date.now() };
  st.set('order', o.orderSn, o);
  return OK({ orderId: o.orderId, orderSn: o.orderSn, deductionPrice: deduction });
}
const findOrder = d => { const o = d.orderSn ? st.get('order', d.orderSn) : null; return o && (!d.outOrderSn || o.outOrderSn === d.outOrderSn) ? o : null; };
const findChild = sn => { for (const o of st.all('order')) { const c = o.children.find(c => c.childOrderSn === String(sn)); if (c) return { o, c }; } const o = st.get('order', sn); return o ? { o, c: null } : null; };
function confirmOrder(d) { const o = findOrder(d); if (!o) return ERR('订单不存在'); if (o.status === 4) return ERR('订单已取消'); o.status = 3; o.confirmedAt = Date.now(); st.set('order', o.orderSn, o); return OK(null); }
function cancelOrder(d) {
  const o = findOrder(d); if (!o) return ERR('订单不存在'); if (o.status === 4) return OK(null);
  if (o.children.some(c => c.tracking)) return ERR('订单已发货,无法直接取消,请联系客服拦截或由顾客拒收');
  const wasConfirmed = o.status === 3; o.status = 4; o.children.forEach(c => { c.status = 4; }); st.set('order', o.orderSn, o); setBalance(balance() + o.deductionPrice);
  o._pendingPush = { type: wasConfirmed ? 16 : 12, childOrderSn: o.children[0] ? o.children[0].childOrderSn : o.orderSn, pOrderSn: o.orderSn }; st.set('order', o.orderSn, o);
  return OK(null);
}
function orderDetail(d) {
  const o = findOrder(d); if (!o) return ERR('订单不存在');
  const ci = o.consignee, mk = (c, l) => ({ childOrderSn: c ? c.childOrderSn : o.orderSn, skuId: l.skuId, skuName: l.skuName, imagePath: l.imagePath, price: null, totalPrice: null, skuNum: l.num, skuPrice: l.price.toFixed(2), childOrderStatus: c ? c.status : o.status, chargeFee: r2(l.price * l.num * 0.02).toFixed(2), singleChargeFee: r2(l.price * 0.02).toFixed(2), skuSplitFreight: '0.00', singleSkuSplitFreight: '0.00', skuTotalPrice: r2(l.price * l.num).toFixed(2), isReceipt: c && c.receipt ? 1 : 2, deliveredStatus: c ? (c.delivered ? 1 : c.tracking ? 2 : 3) : 3 });
  const detail = o.children.length ? o.children.flatMap(c => o.lines.filter(l => c.skuIds.includes(l.skuId)).map(l => mk(c, l))) : o.lines.map(l => mk(null, l));
  return OK({ settlementPrice: o.deductionPrice, orderInfo: { outOrderSn: o.outOrderSn, orderSn: o.orderSn, skuTotalPrice: o.skuTotal.toFixed(2), skuTotalFreight: o.freight.toFixed(2), chargeFee: o.chargeFee.toFixed(2), consigneeName: ci.name, consigneeProvinceId: ci.provinceId, consigneeCityId: ci.cityId, consigneeCountyId: ci.countyId, consigneeTownId: ci.townId, consigneeAddress: ci.address, consigneeZip: '000000', consigneeMobile: ci.mobile, orderStatus: o.status }, orderDetail: detail });
}
function delivery(d) {
  const f = findChild(d.childOrderSn); if (!f || !f.c) return ERR('子订单不存在');
  return OK({ trackInfoList: f.c.tracks || [], logisticInfoList: f.c.tracking ? [{ deliveryOrderId: f.c.tracking }] : [] });
}
function cancelEnable(d) { return OK(String(d.orderSn || '').split(',').filter(Boolean).map(sn => { const f = findChild(sn); const shipped = f && (f.c ? !!f.c.tracking : f.o.children.some(c => c.tracking)); return { reasonMessage: shipped ? '订单已出库' : '', reasonCode: shipped ? '1' : '', cancelFlag: !!f && !shipped && f.o.status !== 4, jdOrderId: sn }; })); }
function confirmReceive(d) { const f = findChild(d.childOrderSn); if (!f || !f.c) return ERR('子订单不存在'); f.c.receipt = true; st.set('order', f.o.orderSn, f.o); return OK(null); }

// ---------- 售后 ----------
function afsEnable(d) {
  const f = findChild(d.childOrderSn); if (!f || !f.c) return ERR('子订单不存在');
  return OK(String(d.skuIds || '').split(',').filter(Boolean).map(id => { const l = f.o.lines.find(l => l.skuId === id && f.c.skuIds.includes(id)); const used = st.all('afs').filter(a => a.childOrderSn === f.c.childOrderSn && a.skuId === id && a.applyStatus !== 7 && a.afsStatus !== 3).reduce((s, a) => s + a.skuNum, 0); const can = !!l && !!f.c.tracking && l.num - used > 0;
    return { skuId: +id, enable: can ? 1 : 2, num: can ? l.num - used : 0, supportedAfsTypes: [{ text: '退货', value: 1 }, { text: '换货', value: 2 }], supportedPickupTypes: [{ text: '客户发货', value: 3 }, { text: '客户送货', value: 2 }, { text: '上门取件', value: 1 }] }; }));
}
function createAfs(d) {
  if (!d.afsSn || String(d.afsSn).length > 20) return ERR('afsSn 不能为空且最多 20 位'); if (!d.questionImg) return ERR('售后申请图片不能为空');
  if (![1, 2].includes(+d.afsType)) return ERR('售后类型无效'); if (![1, 2, 3].includes(+d.pickType)) return ERR('取件方式无效');
  if (st.get('afs', d.afsSn)) return ERR('售后单号已存在');
  const en = afsEnable({ childOrderSn: d.childOrderSn, skuIds: String(d.skuId) }); if (!en.success) return en; const e = en.data[0];
  if (e.enable !== 1 || +d.skuNum > e.num) return ERR('该商品不可申请售后或数量超出');
  const f = findChild(d.childOrderSn), l = f.o.lines.find(l => l.skuId === String(d.skuId));
  st.set('afs', d.afsSn, { afsSn: d.afsSn, orderNo: d.orderNo, childOrderSn: String(d.childOrderSn), skuId: String(d.skuId), skuNum: +d.skuNum, afsType: +d.afsType, pickType: +d.pickType, afsStatus: 1, applyStatus: 1, refundStatus: 1, refundTime: 0, applyDate: Math.floor(Date.now() / 1000), price: l.price });
  return OK(null);
}
const AFS_TXT = { afsType: { 1: '退货退款', 2: '换货' }, pickType: { 1: '上门取件', 2: '客户送货', 3: '客户发货' }, afsStatus: { 1: '申请中', 2: '售后成功', 3: '售后失败' }, applyStatus: { 1: '待审核', 2: '已审核', 3: '已收货', 4: '已处理', 5: '已确认', 6: '已完成', 7: '已取消' }, refundStatus: { 1: '无退款', 2: '待退款', 3: '退款成功' } };
function queryAfs(d) {
  const a = st.get('afs', d.afsSn); if (!a) return OK([]);
  return OK([{ childOrderSn: a.childOrderSn, skuId: a.skuId, skuNum: a.skuNum, afsStatus: a.afsStatus, afsType: a.afsType, pickType: a.pickType, applyStatus: a.applyStatus, refundStatus: a.refundStatus, refundTime: a.refundTime, applyDate: a.applyDate, afsTypeText: AFS_TXT.afsType[a.afsType], pickTypeText: AFS_TXT.pickType[a.pickType], afsStatusText: AFS_TXT.afsStatus[a.afsStatus], applyStatusText: AFS_TXT.applyStatus[a.applyStatus], refundStatusText: AFS_TXT.refundStatus[a.refundStatus], afsAddressList: a.pickType === 1 ? [] : [{ afterServiceReceiver: '演示售后仓', afterServiceAddress: '演示省演示市售后中心 1 号', afterServicePhone: '400-000-0000' }] }]);
}
function afsUpdate(d, fn) { const a = st.get('afs', d.afsSn); if (!a || (d.childOrderSn && a.childOrderSn !== String(d.childOrderSn))) return ERR('售后单不存在'); fn(a); st.set('afs', a.afsSn, a); return OK(null); }

// ---------- 分类/地址 ----------
function categories(d) {
  let list = CATS; if (d.groupLevel) list = list.filter(c => String(c.level) === String(d.groupLevel)); if (d.groupName) list = list.filter(c => c.name.includes(d.groupName));
  return OK(list.map(c => ({ id: c.id, parentId: c.parentId, groupName: c.name, groupLevel: String(c.level) })));
}
function searchAddress(d) { const lv = +d.level || 1; if (lv <= 1) return OK(Object.entries(PROV).map(([n, id]) => ({ areaId: id, areaName: n, level: 1 }))); return OK([1, 2, 3].map(i => ({ areaId: (+d.area_id || 0) * 10 + i, areaName: `演示${lv === 2 ? '市' : '区'}${i}`, level: lv }))); }

const HANDLERS = {
  searchAllCategory: categories, searchGoodsList, searchGoodsDetail: detail, getSimilarSkuInfoList: similar, getSellPrice: sellPrice, checkSkuSaleList: saleList,
  skuDeliveryTime: d => { const s = skuNow(d.skuId); if (!s) return ERR('商品不存在'); const days = REMOTE.includes(+d.provinceId) ? 4 : 1; const dt = new Date(Date.now() + days * 86400000); return OK({ arrivalDays: days, deliverDays: 0, predictContent: `预计 ${days} 天内送达`, predictDate: dt.toISOString().slice(0, 10) }); },
  changeArea, searchAddress, changeLatLng: () => OK({ townName: '城区街道', nationName: '中国', cityName: '杭州市', countyId: 38518, nationId: 4744, provinceName: '江苏', cityId: 972, townId: 53708, provinceId: 12, countyName: '演示区' }),
  checkArea, checkAreaLimitList: areaLimit, querySkuFreight: freight,
  submitOrder, confirmOrder, cancelOrder, confirmReceiveByOrder: confirmReceive, getOrderDetail: orderDetail, queryDeliveryInfo: delivery, queryOrderCancelEnable: cancelEnable,
  queryAfsEnable: afsEnable, createAfs, cancelAfs: d => afsUpdate(d, a => { if (a.applyStatus >= 3) throw new Error('已收货不可取消'); a.applyStatus = 7; }),
  updateSendInfo: d => afsUpdate(d, a => { a.express = { code: d.expressCode, company: d.expressCompany }; }), confirmAfs: d => afsUpdate(d, a => { a.applyStatus = 6; }), queryAfs
};
/** 与真实接口相同的调用约定:返回文档格式的响应 JSON */
function handle(interfaceCode, data) {
  const fn = HANDLERS[interfaceCode]; if (!fn) return ERR('未知接口 ' + interfaceCode, 404);
  try { return fn(data || {}); } catch (e) { return ERR(e.message); }
}
function getBalance() { return { data: balance().toFixed(5), code: 200, msg: '查询成功', error: false, success: true, warn: false }; }

// ---------- 模拟推进(后台按钮 / 定时器)→ 产生与文档一致的回调报文 ----------
const cb = data => ({ tenantAppId: 'MOCK-TENANT-APP', interfaceTypeCode: 'jd_mall_interface', interfaceCode: 'orderPush', data: { createTime: new Date().toISOString().slice(0, 19).replace('T', ' '), ...data } });
const TRACKS = ['您提交了订单,请等待系统确认', '您的订单已经进入仓库准备出库', '您的订单已经打印完成', '打包完成', '您的订单在京东【杭州分拣中心】分拣完成', '您的订单已到达京东【杭州营业部】', '您的订单正在配送途中,请您耐心等待'];
/** action: split | ship | deliver | complete | cancelled(取消后推送) | afs_approve | afs_refund | afs_reject ; 返回要推送的回调报文数组 */
function simulate(action, { orderSn, afsSn } = {}) {
  const out = [];
  if (action.startsWith('afs_')) {
    const a = st.get('afs', afsSn); if (!a) throw new Error('售后单不存在');
    if (action === 'afs_approve') { a.applyStatus = 2; }
    if (action === 'afs_receive') { a.applyStatus = 3; }
    if (action === 'afs_reject') { a.applyStatus = 4; a.afsStatus = 3; }
    if (action === 'afs_refund') { a.applyStatus = 4; a.afsStatus = 2; a.refundStatus = 3; a.refundTime = Math.floor(Date.now() / 1000); const amt = r2(a.price * a.skuNum); setBalance(balance() + amt); out.push(cb({ type: 119, childOrderSn: a.childOrderSn, afsSn: a.afsSn, refundAmount: amt.toFixed(2) })); }
    st.set('afs', a.afsSn, a); return out;
  }
  const o = st.get('order', orderSn); if (!o) throw new Error('供应商订单不存在');
  if (o._pendingPush) { out.push(cb(o._pendingPush)); delete o._pendingPush; st.set('order', o.orderSn, o); if (action === 'cancelled') return out; }
  if (o.status !== 3) return out;
  if (action === 'split' && !o.children.length) {
    const groups = {}; for (const l of o.lines) (groups[l.c1] = groups[l.c1] || []).push(l.skuId); // 按一级类目(演示:不同仓)拆单
    o.children = Object.values(groups).map((ids, i) => ({ childOrderSn: String(+o.orderSn * 10 + i + 1), skuIds: ids, status: 3, tracks: [{ trackContent: TRACKS[0], trackOperator: '客户', trackMsgTime: Date.now() }] }));
    out.push(cb({ type: 11, pOrderSn: o.orderSn }));
  }
  if (action === 'ship') { if (!o.children.length) out.push(...simulate('split', { orderSn })); const o2 = st.get('order', orderSn); for (const c of o2.children) if (!c.tracking && c.status !== 4) { c.tracking = 'MK' + String(c.childOrderSn).slice(-10); c.status = 7; c.tracks.push(...TRACKS.slice(1).map((t, i) => ({ trackContent: t, trackOperator: '系统', trackMsgTime: Date.now() + i }))); out.push(cb({ type: 13, childOrderSn: c.childOrderSn })); } st.set('order', orderSn, o2); return out; }
  if (action === 'deliver') { for (const c of o.children) if (c.tracking && !c.delivered) { c.delivered = true; c.tracks.push({ trackContent: '您的订单已签收。感谢您在京东购物,欢迎再次光临。', trackOperator: '配送员', trackMsgTime: Date.now() }); out.push(cb({ type: 14, childOrderSn: c.childOrderSn })); } }
  if (action === 'complete') { for (const c of o.children) if (c.delivered && c.status !== 1) { c.status = 1; out.push(cb({ type: 10, childOrderSn: c.childOrderSn })); } }
  st.set('order', o.orderSn, o);
  return out;
}
/** 定时器:把已确认的演示订单往前推进一步(后台设置开启「演示订单自动推进」时) */
function autoStep(orderSn) { const o = st.get('order', orderSn); if (!o || o.status !== 3) return []; if (!o.children.length) return simulate('split', { orderSn }); if (o.children.some(c => !c.tracking)) return simulate('ship', { orderSn }); if (o.children.some(c => !c.delivered)) return simulate('deliver', { orderSn }); return simulate('complete', { orderSn }); }
const localImage = p => { const m = String(p).match(/mock-demo\/([a-z0-9-]+\.png)$/); return m ? require('path').join(__dirname, '..', '..', '..', 'public', 'img', 'supplier-demo', m[1]) : null; };
module.exports = { handle, getBalance, simulate, autoStep, setSkuOverride, skuNow, SKUS, CATS, localImage, state: st };
