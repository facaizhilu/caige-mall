// 演示数据。用法: node lib/seed.js [--reset]   (server 启动时若库为空会自动调用)
// 演示会员(手机号、昵称、积分、成长值、等级)
const SEED_MEMBERS = [['13800000001', '韵农粉丝', 3200, 5200, 2], ['13800000002', '小美', 800, 600, 1], ['13800000003', '老王', 120, 0, 0], ['13900000004', '阿杰', 2600, 9000, 3], ['13700000005', '晓雯', 450, 80, 0], ['13600000006', '大壮', 60, 3100, 2], ['13500000007', '丽丽', 1000, 1200, 1]];
const db = require('./db');
const bcrypt = require('bcryptjs');
const U = require('./util');
const svc = require('./svc');
const { now, genImg } = U;
const { RETURN_HELP, CLOUD_HELP, SEED_DESC } = require('./seed-texts');

function seed(reset) {
  if (reset) {
    const tables = db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").map(r => r.name);
    for (const t of tables) db.exec(`DELETE FROM ${t}`);
    try { db.exec('DELETE FROM sqlite_sequence'); } catch (e) {}
  }
  if (db.get('SELECT COUNT(*) n FROM admins').n > 0) return false;
  const ins = (t, o) => { const k = Object.keys(o); return db.prepare(`INSERT INTO ${t}(${k}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map(x => o[x])).lastInsertRowid; };
  const dayAgo = (d, h = 10) => { const x = new Date(Date.now() - d * 86400000); x.setHours(h, Math.floor(Math.random() * 60), 0); return U.fmtDate(x); };

  db.transaction(() => {
    for (const [k, v] of Object.entries({ shop_name: '韵农甄选' })) svc.setSetting(k, v);
    // 角色 & 管理员
    const rSuper = ins('roles', { name: '超级管理员', permissions: 'all', remark: '拥有全部权限' });
    const rOps = ins('roles', { name: '运营专员', permissions: 'dashboard,product,review,marketing,content,stats', remark: '商品/营销/内容运营' });
    const rCs = ins('roles', { name: '客服专员', permissions: 'dashboard,order,review,member,service', remark: '订单售后与客服' });
    ins('admins', { username: 'admin', password_hash: bcrypt.hashSync('admin123', 10), name: '超级管理员', role_id: rSuper, created_at: now() });
    ins('admins', { username: 'ops', password_hash: bcrypt.hashSync('ops123456', 10), name: '运营小王', role_id: rOps, created_at: now() });
    ins('admins', { username: 'kefu', password_hash: bcrypt.hashSync('kefu123456', 10), name: '客服小李', role_id: rCs, created_at: now() });

    // 会员等级
    [['普通会员', 0, 100, '#8c8c8c'], ['白银会员', 500, 98, '#7d8fa3'], ['黄金会员', 2000, 95, '#d4a017'], ['钻石会员', 8000, 90, '#3aa6d8']].forEach((l, i) => ins('member_levels', { name: l[0], min_growth: l[1], discount: l[2], color: l[3], sort: i, remark: l[2] < 100 ? `享 ${l[2] / 10} 折会员价` : '注册即享' }));

    // 运费模板
    ins('shipping_templates', { name: '全国包邮模板(满99包邮)', free_over: 99, rules: JSON.stringify({ base: 8, remote_provinces: '新疆维吾尔自治区,西藏自治区', remote_fee: 18 }), remark: '默认模板:基础运费¥8,满¥99包邮,新疆西藏¥18' });
    ins('shipping_templates', { name: '大件商品模板', free_over: 2000, rules: JSON.stringify({ base: 30, remote_provinces: '新疆维吾尔自治区,西藏自治区', remote_fee: 80 }), remark: '大件基础运费¥30,满¥2000包邮' });
    ins('shipping_templates', { name: '全场包邮', free_over: 0.01, rules: JSON.stringify({ base: 0 }), remark: '商家承担运费' });

    // 分类:仅经营范围内(2026-10-19 实际登记):数码电子/电脑及配件/网络设备、食用农产品(新鲜水果/蔬菜/鲜蛋,鲜活易腐不支持7天无理由)
    const cats = {};
    ['数码电脑', '新鲜农产品'].forEach((n, i) => cats[n] = ins('categories', { name: n, sort: i, icon: ['📱', '🍎'][i] }));
    const sub = {};
    [['手机通讯', '数码电脑'], ['手机配件', '数码电脑'], ['影音耳机', '数码电脑'], ['智能穿戴', '数码电脑'], ['电脑整机', '数码电脑'], ['电脑配件', '数码电脑'], ['网络设备', '数码电脑'], ['新鲜水果', '新鲜农产品'], ['新鲜蔬菜', '新鲜农产品'], ['鲜蛋', '新鲜农产品']].forEach(([n, p], i) => sub[n] = ins('categories', { name: n, parent_id: cats[p], sort: i, no_7day: p === '新鲜农产品' ? 1 : 0 }));
    // 品牌
    const br = {};
    [['韵农甄选', '#b8231c']] /* 演示商品不再使用虚构品牌,统一「韵农甄选」 */.forEach(([n, c], i) => br[n] = ins('brands', { name: n, color: c, sort: i, description: n + '品牌官方旗舰' }));

    // 商品
    const P = [ // 顺序即商品 ID(测试与活动演示按 ID 引用);全部为经营范围内类目
      require('./seed-texts').DEMO_ACCESSORY_ROW,
      require('./seed-texts').DEMO_LAPTOP_REPLACE_ROW,
      ['星河 降噪蓝牙耳机 Air', '主动降噪 · 30h 续航 · 通透模式', '影音耳机', '星河', 299, 499, 1, 1, 1, 1, '颜色:白色|黑色|粉色', [[299, 120]], '7c3aed', 'f0abfc', '🎧'],
      ['华岳 无线静音键鼠套装', '2.4G 无线 · 静音按键 · 长续航', '电脑配件', '华岳', 159, 299, 1, 0, 1, 0, '颜色:黑色|白色;版本:标准版|充电版|蓝牙双模|商务版', [[159, 40]], '0ea5e9', 'e0f2fe', '⌨️'],
      ['星河 磁吸无线充电器 15W', '磁吸对位 · 15W 快充 · 过温保护', '手机配件', '星河', 229, 399, 1, 1, 1, 0, '颜色:白色|黑色;规格:单充|二合一|三合一', [[229, 30]], 'ec4899', 'fde68a', '🔋'],
      ['星河 移动电源 10000mAh', '22.5W 快充 · 双口输出 · 电量显示', '手机配件', '星河', 128, 198, 1, 0, 1, 0, '容量:10000mAh|20000mAh(大容量)', [[128, 80], [219, 50]], 'f472b6', 'fef3c7', '🔌'],
      ['星河 桌面手机支架 铝合金', '多角度调节 · 稳固防滑 · 折叠便携', '手机配件', '星河', 89.9, 129, 1, 1, 1, 0, '款式:升降折叠款|基础款', [[89.9, 200], [49.9, 150]], 'b45309', 'fbbf24', '📲'],
      ['韵农甄选 烟台红富士苹果 5斤装', '脆甜多汁 · 产地直发 · 坏果包赔', '新鲜水果', '韵农甄选', 39.9, 59.9, 1, 1, 0, 0, '规格:5斤(约8-10个)|10斤', [[39.9, 300], [72, 100]], 'dc2626', 'fca5a5', '🍎'],
      ['华岳 Wi-Fi 6 双频无线路由器', '千兆网口 · 双频并发 · 穿墙覆盖', '网络设备', '华岳', 299, 599, 1, 0, 1, 1, '版本:AX3000|AX5400;颜色:白色|黑色', [[299, 40], [349, 40]], '64748b', 'e2e8f0', '📶'],
      ['华岳 Type-C 编织快充数据线', '60W 快充 · 编织线身 · 耐弯折', '手机配件', '华岳', 39, 69, 1, 0, 0, 0, '长度:2米|1米', [[39, 90], [29, 90]], '374151', '9ca3af', '🔗'],
      ['疾风 87键机械键盘 热插拔', '热插拔轴体 · 全键无冲 · Type-C 有线', '电脑配件', '疾风', 359, 599, 1, 1, 1, 0, '轴体:红轴|青轴;配色:黑色|白色|灰色|蓝色', [[359, 20]], '111827', 'ef4444', '⌨️'],
      ['疾风 电竞鼠标垫 加大款', '细面顺滑 · 防滑底 · 精密锁边', '电脑配件', '疾风', 69, 129, 1, 0, 1, 0, '尺寸:70×30cm|80×30cm|90×40cm;颜色:黑色|灰色|红色', [[69, 25]], '16a34a', 'bbf7d0', '🖱️'],
      ['华岳 智能手表 S2 运动版', '血氧心率监测 · 14天续航 · 5ATM防水', '智能穿戴', '华岳', 599, 899, 1, 0, 1, 1, '颜色:黑|银;表带:硅胶|尼龙', [[599, 50]], '0f766e', '5eead4', '⌚'],
      ['田园记 散养新鲜鸡蛋 30枚', '当日鲜蛋 · 产地直发 · 破损包赔', '鲜蛋', '田园记', 49.9, 69.9, 1, 0, 1, 0, '规格:30枚|15枚', [[49.9, 200], [27.9, 150]], 'e08a1e', 'fde68a', '🥚'],
      ['韵农甄选 新鲜时令蔬菜组合 3斤装', '当季时蔬 · 产地直发 · 坏损包赔', '新鲜蔬菜', '韵农甄选', 29.9, 39.9, 1, 0, 1, 0, '规格:3斤装|5斤装', [[29.9, 100], [45.9, 80]], '2e9e6b', 'bbf7d0', '🥬'],
      ...require('./seed-texts').DEMO_PRODUCE_ROWS
    ];
    const prodIds = [];
    const descHtml = SEED_DESC;
    P.forEach((p, i) => {
      const [name0, sub_, cat, , price, mkt, , hot, nw, tpl, specStr, skuPrices, c1, c2, emoji] = p;
      const name = require('./seed-texts').plainDemoName(name0), brand = '韵农甄选';
      const images = [0, 1, 2, 3].map(v => genImg(emoji, c1, c2, v, name.slice(0, 20)));
      const pid = ins('products', { name, subtitle: sub_, category_id: sub[cat], brand_id: br[brand], price, market_price: null, /* 演示数据不虚构划线原价(明码标价规定) */ stock: 0, description: descHtml(name), images: JSON.stringify(images), is_hot: 0, is_new: 0, /* 「热卖」「新品」标签按真实销量/上架时间自动判定,不再人工预置 */ template_id: tpl || 1, spec_names: specStr.split(';').map(s => s.split(':')[0]).join(','), sort: require('./seed-texts').DEMO_PICK_SORT[name0] || 100 - i, created_at: dayAgo(60 - i * 5) });
      prodIds.push(pid);
      const specs = specStr.split(';').map(s => { const [k, v] = s.split(':'); return [k, v.split('|')]; });
      let combos = [{}];
      for (const [k, vs] of specs) combos = combos.flatMap(c => vs.map(v => ({ ...c, [k]: v })));
      combos.slice(0, 12).forEach((attrs, ci) => {
        const sp = skuPrices[Math.min(ci % skuPrices.length, skuPrices.length - 1)];
        const idx = specs.length ? Math.floor(ci / Math.max(1, combos.length / skuPrices.length)) : 0;
        const pr = skuPrices[Math.min(idx, skuPrices.length - 1)];
        ins('skus', { product_id: pid, attrs: JSON.stringify(attrs), spec_text: Object.values(attrs).join(' / '), price: pr[0], stock: Math.max(5, Math.floor(pr[1] / combos.length * skuPrices.length)), code: `CG${String(pid).padStart(3, '0')}${String(ci + 1).padStart(2, '0')}` });
      });
      db.exec1('UPDATE products SET stock=(SELECT SUM(stock) FROM skus WHERE product_id=?), price=(SELECT MIN(price) FROM skus WHERE product_id=?) WHERE id=?', pid, pid, pid);
    });
    // 库存预警演示
    db.exec1('UPDATE skus SET stock=3 WHERE product_id=? AND id=(SELECT MIN(id) FROM skus WHERE product_id=?)', prodIds[10], prodIds[10]);
    db.exec1('UPDATE products SET stock=(SELECT SUM(stock) FROM skus WHERE product_id=?) WHERE id=?', prodIds[10], prodIds[10]);

    // Banner
    require('./seed-texts').DEMO_BANNERS.forEach((b, i) => ins('banners', { ...b, sort: i }));

    // 优惠券
    const cp = {};
    cp.new = ins('coupons', { name: '新人专享券', threshold: 0, amount: 10, total: 9999, per_limit: 1, valid_days: 30, description: '新注册会员自动到账,无门槛', created_at: now() });
    cp.a = ins('coupons', { name: '满99减10', threshold: 99, amount: 10, total: 500, per_limit: 2, valid_days: 15, description: '全场通用', created_at: now() });
    cp.b = ins('coupons', { name: '满299减40', threshold: 299, amount: 40, total: 300, per_limit: 1, valid_days: 15, description: '全场通用', created_at: now() });
    cp.c = ins('coupons', { name: '数码专享满1000减100', threshold: 1000, amount: 100, total: 100, per_limit: 1, valid_days: 20, category_id: cats['数码家电'] === undefined ? 0 : 0, description: '全场通用大额券', created_at: now() });
    cp.d = ins('coupons', { name: '新鲜水果满59减8', threshold: 59, amount: 8, total: 200, per_limit: 3, valid_days: 7, category_id: sub['新鲜水果'], description: '仅限新鲜水果分类商品', created_at: now() });

    // 积分商城
    // 积分商城(演示,仅经营范围内:数码配件 / 新鲜农产品 / 优惠券;均标记 is_demo)
    // [名称, 图标, 积分, 类型, 优惠券, 库存, 分类, 每人限兑](积分商品一律包邮)
    [['满30减5 优惠券', '🎟️', 300, 'coupon', cp.a, 500, 0, 0], ['蓝牙小音箱', '🔊', 3000, 'goods', 0, 20, sub['影音耳机'], 1], ['Type-C 数据线 1米', '🔗', 800, 'goods', 0, 100, sub['手机配件'], 2], ['桌面手机支架', '📲', 1500, 'goods', 0, 50, sub['手机配件'], 0], ['满299减40券', '🎫', 1200, 'coupon', cp.b, 100, 0, 1], ['海南金煌芒果 2斤装', '🥭', 2000, 'goods', 0, 30, sub['新鲜水果'], 1]].forEach((g, i) => ins('points_goods', { name: g[0], image: genImg(g[1], 'fbf6ec', 'f3e7cf', i, g[0].slice(0, 20)), points: g[2], type: g[3], coupon_id: g[4], stock: g[5], sort: i, category_id: g[6], per_user_limit: g[7], is_demo: 1, description: g[3] === 'coupon' ? '兑换后优惠券立即到账' : g[6] === sub['新鲜水果'] ? '产地直发新鲜水果,兑换后由客服安排发货' : '实物礼品,兑换后由客服安排发货(演示)' }));

    // 热搜词
    ['手机', '耳机', '数据线', '键盘', '苹果', '鸡蛋', '笔记本', '路由器'].forEach((w, i) => ins('keywords', { word: w, hits: 1000 - i * 100, is_hot: 1, sort: i }));

    // 文章
    const art = (category, topic, title, content, sort = 0) => ins('articles', { category, topic, title, content, sort, created_at: dayAgo(Math.floor(Math.random() * 10)) });
    art('notice', '公告', '韵农甄选正式上线,新人福利大放送', '<p>韵农甄选正式上线!新注册会员即送 100 积分及新人券。</p><p>更多活动请关注首页。</p>');
    art('notice', '公告', '国庆期间发货与客服安排', '<p>国庆假期(10月1日-10月7日)期间订单照常发货,客服在线时间 9:00-22:00。</p>');
    art('help', '新手指南', '如何注册与登录', '<p>使用手机号+密码即可注册。也支持「短信验证码登录」(短信通道接入前验证码会在页面直接展示)。</p>', 1);
    art('help', '新手指南', '如何下单购买', '<p>选择商品和规格 → 加入购物车 → 去结算 → 选择收货地址 → 选择支付方式→ 完成。</p>', 2);
    art('help', '支付与优惠', '积分与优惠券使用说明', '<p>积分可在积分专区兑换商品,具体以《积分规则》页面公示为准。优惠券需满足门槛,每单限用一张。</p>', 3);
    art('help', '支付与优惠', '支付方式说明', '<p>支持微信支付。</p>', 4);
    art('help', '配送与售后', '运费规则', '<p>单笔订单满 ¥99 包邮;未满收取 ¥8;新疆、西藏地区运费 ¥18。大件商品运费另计。</p>', 5);
    art('help', '配送与售后', '退款退货政策', RETURN_HELP, 6);
    art('help', '配送与售后', '发票说明', '<p>支持个人及企业电子发票,订单支付后可在订单详情申请。</p>', 7);
    art('about', '关于', '关于韵农甄选', '<p>韵农甄选由海南韵农科技有限公司运营,甄选好物,货真价实。</p>');

    // 会员:仅保留可登录的演示账号,不预置任何积分、订单、收藏、足迹、优惠券、地址等会员行为数据
    const pw = bcrypt.hashSync('123456', 10);
    const users = [];
    SEED_MEMBERS.forEach(([phone, nick], i) => {
      const id = ins('users', { phone, password_hash: pw, nickname: nick, points: 0, growth: 0, level_id: 1, invite_code: String(100001 + i), created_at: dayAgo(60 - i * 6) });
      users.push(id); svc.refreshLevel(id);
    });
    // 秒杀 & 拼团
    const sk = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prodIds[2]);
    ins('seckills', { product_id: prodIds[2], sku_id: sk.id, price: 199, stock: 30, sold: 0, start_at: U.offset(-3600000), end_at: U.offset(6 * 3600000), limit_per_user: 1 });
    const sk2 = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prodIds[7]);
    ins('seckills', { product_id: prodIds[7], sku_id: sk2.id, price: 19.9, stock: 50, sold: 0, start_at: U.offset(-3600000), end_at: U.offset(6 * 3600000), limit_per_user: 2 });
    const sk3 = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prodIds[11]);
    ins('seckills', { product_id: prodIds[11], sku_id: sk3.id, price: 39, stock: 20, sold: 0, start_at: U.offset(3 * 3600000), end_at: U.offset(9 * 3600000), limit_per_user: 1 });
    const g1 = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prodIds[6]);
    const gb1 = ins('groupbuys', { product_id: prodIds[6], sku_id: g1.id, price: 69.9, size: 2, hours: 24 });
    const g2 = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prodIds[5]);
    ins('groupbuys', { product_id: prodIds[5], sku_id: g2.id, price: 99, size: 3, hours: 48 });
    // -------- 云商卡卡种配置(不预置任何会员开卡记录) --------
    for (const [k, v] of Object.entries(svc.cloud.CLOUD_DEFAULTS)) svc.setSetting(k, v);
    const cardDefs = [
      ['白银月卡', 'silver', 'month', 199, 10], ['白银季卡', 'silver', 'quarter', 499, 20], ['白银年卡', 'silver', 'year', 1599, 30],
      ['黄金月卡', 'gold', 'month', 399, 40], ['黄金季卡', 'gold', 'quarter', 999, 50], ['黄金年卡', 'gold', 'year', 2999, 60]
    ];
    cardDefs.forEach(d => ins('cloud_card_types', { name: d[0], tier: d[1], duration: d[2], activation_fee: d[3], status: 1, sort: d[4], remark: '线下办理' }));
    const invCoupon = ins('coupons', { name: '邀请好友首单券', threshold: 59, amount: 8, total: 9999, per_limit: 1, valid_days: 30, description: '通过邀请注册的新会员首单可用', created_at: now() });
    svc.setSetting('invite_coupon_id', invCoupon);
    art('help', '会员权益', '云商卡会员权益说明', CLOUD_HELP, 8);
  })();
  svc.recalcSales(); // 销量只按真实订单计算,不预置
  console.log('✔ 演示数据已生成');
  return true;
}
module.exports = seed;
module.exports.SEED_MEMBERS = SEED_MEMBERS;
if (require.main === module) { seed(process.argv.includes('--reset')); }
