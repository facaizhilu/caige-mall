// 演示数据。用法: node lib/seed.js [--reset]   (server 启动时若库为空会自动调用)
const db = require('./db');
const bcrypt = require('bcryptjs');
const U = require('./util');
const svc = require('./svc');
const { now, genImg } = U;
const { RETURN_HELP, CLOUD_HELP } = require('./seed-texts');

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
    for (const [k, v] of Object.entries({ shop_name: '财哥商城' })) svc.setSetting(k, v);
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

    // 分类
    const cats = {};
    ['数码家电', '服饰鞋包', '美妆个护', '食品生鲜', '家居日用', '运动户外'].forEach((n, i) => cats[n] = ins('categories', { name: n, sort: i, icon: ['📱', '👕', '💄', '🍎', '🏠', '⚽'][i] }));
    const sub = {};
    [['手机通讯', '数码家电'], ['电脑办公', '数码家电'], ['男装', '服饰鞋包'], ['女装', '服饰鞋包'], ['护肤', '美妆个护'], ['零食坚果', '食品生鲜'], ['水果生鲜', '食品生鲜'], ['家纺', '家居日用'], ['厨房', '家居日用'], ['运动鞋服', '运动户外']].forEach(([n, p], i) => sub[n] = ins('categories', { name: n, parent_id: cats[p], sort: i, no_7day: n === '水果生鲜' ? 1 : 0 }));
    // 品牌
    const br = {};
    [['星河', '#2a5bd7'], ['华岳', '#d4202a'], ['南山居', '#2e9e6b'], ['丝语', '#c2579a'], ['田园记', '#e08a1e'], ['云朵家', '#5b6ee1'], ['疾风', '#111827'], ['财哥严选', '#b8860b']].forEach(([n, c], i) => br[n] = ins('brands', { name: n, color: c, sort: i, description: n + '品牌官方旗舰' }));

    // 商品
    const P = [
      ['星河 X1 Pro 5G 智能手机 12+256GB', '骁龙旗舰芯片 · 1亿像素影像 · 5000mAh 长续航', '手机通讯', '星河', 3999, 4599, 1, 1, 1, 2, '颜色:星空黑|冰川银;内存:12+256GB|16+512GB', [[3999, 60], [4499, 40]], 'd4202a', 'f2a93b', '📱'],
      ['华岳 轻薄本 14英寸 i7 16G 512G', '2.8K 护眼屏 · 1.2kg 轻薄 · 全天候续航', '电脑办公', '华岳', 5499, 6299, 1, 0, 2, 2, '颜色:银色|深空灰', [[5499, 30]], '1e3a8a', '60a5fa', '💻'],
      ['星河 降噪蓝牙耳机 Air', '主动降噪 · 30h 续航 · 通透模式', '手机通讯', '星河', 299, 499, 1, 1, 1, 1, '颜色:白色|黑色|粉色', [[299, 120]], '7c3aed', 'f0abfc', '🎧'],
      ['男士商务休闲纯棉衬衫', '60支长绒棉 · 免烫抗皱 · 四季可穿', '男装', '财哥严选', 159, 299, 1, 0, 1, 0, '颜色:白色|浅蓝;尺码:M|L|XL|XXL', [[159, 40]], '0ea5e9', 'e0f2fe', '👔'],
      ['丝语 法式碎花连衣裙', '雪纺面料 · 收腰显瘦 · 度假风', '女装', '丝语', 229, 399, 1, 1, 1, 0, '颜色:碎花粉|碎花蓝;尺码:S|M|L', [[229, 30]], 'ec4899', 'fde68a', '👗'],
      ['丝语 玻尿酸补水保湿面霜 50g', '24h 锁水 · 敏感肌可用 · 温和不刺激', '护肤', '丝语', 128, 198, 1, 0, 1, 0, '规格:50g|100g(家庭装)', [[128, 80], [219, 50]], 'f472b6', 'fef3c7', '🧴'],
      ['田园记 每日坚果礼盒 30包', '6种坚果科学配比 · 独立小包装', '零食坚果', '田园记', 89.9, 129, 1, 1, 1, 0, '规格:30包礼盒|15包尝鲜', [[89.9, 200], [49.9, 150]], 'b45309', 'fbbf24', '🥜'],
      ['南山居 烟台红富士苹果 5斤装', '脆甜多汁 · 产地直发 · 坏果包赔', '水果生鲜', '南山居', 39.9, 59.9, 1, 1, 0, 0, '规格:5斤(约8-10个)|10斤', [[39.9, 300], [72, 100]], 'dc2626', 'fca5a5', '🍎'],
      ['云朵家 A类母婴级纯棉四件套', '60S 长绒棉 · 親肤透气 · 亲肤柔软', '家纺', '云朵家', 299, 599, 1, 0, 1, 1, '尺寸:1.5米床|1.8米床;颜色:云朵灰|奶油白', [[299, 40], [349, 40]], '64748b', 'e2e8f0', '🛏️'],
      ['财哥严选 不粘炒锅 32cm', '麦饭石涂层 · 少油烟 · 燃气电磁通用', '厨房', '财哥严选', 99, 169, 1, 0, 0, 0, '规格:32cm|28cm', [[99, 90], [79, 90]], '374151', '9ca3af', '🍳'],
      ['疾风 超轻透气跑步鞋', '飞织鞋面 · 回弹中底 · 马拉松级缓震', '运动鞋服', '疾风', 359, 599, 1, 1, 1, 0, '颜色:黑红|灰蓝;尺码:40|41|42|43', [[359, 20]], '111827', 'ef4444', '👟'],
      ['疾风 速干运动T恤 男女同款', '凉感速干 · 防紫外线 · 反光logo', '运动鞋服', '疾风', 69, 129, 1, 0, 1, 0, '颜色:黑|白|荧光绿;尺码:M|L|XL', [[69, 25]], '16a34a', 'bbf7d0', '🎽'],
      ['华岳 智能手表 S2 运动版', '血氧心率监测 · 14天续航 · 5ATM防水', '电脑办公', '华岳', 599, 899, 1, 0, 1, 1, '颜色:黑|银;表带:硅胶|尼龙', [[599, 50]], '0f766e', '5eead4', '⌚']
    ];
    const prodIds = [];
    const descHtml = (n, e) => `<p><strong>${n}</strong></p><p>财哥严选,品质保障。本商品为演示数据,图片为本地生成的占位图。</p><ul><li>正品保证,假一赔十</li><li>7天无理由退换(特殊商品除外)</li><li>全国联保,极速发货</li></ul>`;
    P.forEach((p, i) => {
      const [name, sub_, cat, brand, price, mkt, , hot, nw, tpl, specStr, skuPrices, c1, c2, emoji] = p;
      const images = [0, 1, 2, 3].map(v => genImg(emoji, c1, c2, v, name.slice(0, 8)));
      const pid = ins('products', { name, subtitle: sub_, category_id: sub[cat], brand_id: br[brand], price, market_price: null, /* 演示数据不虚构划线原价(明码标价规定) */ stock: 0, sales: 50 + Math.floor(Math.random() * 900), description: descHtml(name), images: JSON.stringify(images), is_hot: hot, is_new: nw, template_id: tpl || 1, spec_names: specStr.split(';').map(s => s.split(':')[0]).join(','), sort: 100 - i, created_at: dayAgo(30 - i) });
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
    [['财哥商城 开业大吉', '新人礼包 100 积分 + 新人券,全场满99包邮', '/products', 'b91c1c', 'f59e0b'], ['限时秒杀 · 爆款低至5折', '每日准点开抢,手慢无', '/seckill', '7f1d1d', 'ef4444'], ['拼团享低价', '2人成团,好友一起买更便宜', '/groupbuy', '9a3412', 'fbbf24'], ['积分商城 好礼兑不停', '签到赚积分,免费换好礼', '/points-mall', '831843', 'f472b6']].forEach((b, i) => ins('banners', { title: b[0], subtitle: b[1], link: b[2], bg1: '#' + b[3], bg2: '#' + b[4], sort: i }));

    // 优惠券
    const cp = {};
    cp.new = ins('coupons', { name: '新人专享券', threshold: 0, amount: 10, total: 9999, per_limit: 1, valid_days: 30, description: '新注册会员自动到账,无门槛', created_at: now() });
    cp.a = ins('coupons', { name: '满99减10', threshold: 99, amount: 10, total: 500, per_limit: 2, valid_days: 15, description: '全场通用', created_at: now() });
    cp.b = ins('coupons', { name: '满299减40', threshold: 299, amount: 40, total: 300, per_limit: 1, valid_days: 15, description: '全场通用', created_at: now() });
    cp.c = ins('coupons', { name: '数码专享满1000减100', threshold: 1000, amount: 100, total: 100, per_limit: 1, valid_days: 20, category_id: cats['数码家电'] === undefined ? 0 : 0, description: '全场通用大额券', created_at: now() });
    cp.d = ins('coupons', { name: '食品生鲜满59减8', threshold: 59, amount: 8, total: 200, per_limit: 3, valid_days: 7, category_id: sub['零食坚果'], description: '仅限零食坚果分类商品', created_at: now() });

    // 积分商城
    [['满30减5 优惠券', '🎟️', 300, 'coupon', cp.a, 500], ['星河蓝牙小音箱', '🔊', 3000, 'goods', 0, 20], ['财哥定制帆布袋', '👜', 800, 'goods', 0, 100], ['不锈钢保温杯', '🥤', 1500, 'goods', 0, 50], ['满299减40券', '🎫', 1200, 'coupon', cp.b, 100]].forEach((g, i) => ins('points_goods', { name: g[0], image: genImg(g[1], 'f59e0b', 'fde68a', i, g[0].slice(0, 6)), points: g[2], type: g[3], coupon_id: g[4], stock: g[5], sort: i, description: g[3] === 'coupon' ? '兑换后优惠券立即到账' : '实物礼品,兑换后由客服安排发货(演示)' }));

    // 热搜词
    ['手机', '耳机', '连衣裙', '坚果', '苹果', '跑步鞋', '笔记本', '面霜'].forEach((w, i) => ins('keywords', { word: w, hits: 1000 - i * 100, is_hot: 1, sort: i }));

    // 文章
    const art = (category, topic, title, content, sort = 0) => ins('articles', { category, topic, title, content, sort, created_at: dayAgo(Math.floor(Math.random() * 10)) });
    art('notice', '公告', '财哥商城正式上线,新人福利大放送', '<p>财哥商城正式上线!新注册会员即送 100 积分及新人券。</p><p>更多活动请关注首页。</p>');
    art('notice', '公告', '国庆期间发货与客服安排', '<p>国庆假期(10月1日-10月7日)期间订单照常发货,客服在线时间 9:00-22:00。</p>');
    art('notice', '活动', '会员日 · 每周五积分翻倍', '<p>每周五签到及购物积分翻倍(演示活动文案)。</p>');
    art('help', '新手指南', '如何注册与登录', '<p>使用手机号+密码即可注册。也支持「短信验证码登录」(演示环境验证码会在页面直接展示,不会真实发送短信)。</p>', 1);
    art('help', '新手指南', '如何下单购买', '<p>选择商品和规格 → 加入购物车 → 去结算 → 选择收货地址 → 选择支付方式(演示为模拟支付)→ 完成。</p>', 2);
    art('help', '支付与优惠', '积分与优惠券使用说明', '<p>积分可在下单时抵扣部分金额,抵扣比例与单笔上限以《积分规则》页面公示为准。优惠券需满足门槛,每单限用一张。</p>', 3);
    art('help', '支付与优惠', '支付方式说明', '<p>本站为演示站点,支持微信支付(模拟)与支付宝(模拟),不产生真实扣款。</p>', 4);
    art('help', '配送与售后', '运费规则', '<p>单笔订单满 ¥99 包邮;未满收取 ¥8;新疆、西藏地区运费 ¥18。大件商品运费另计。</p>', 5);
    art('help', '配送与售后', '退款退货政策', RETURN_HELP, 6);
    art('help', '配送与售后', '发票说明', '<p>支持个人及企业电子发票,订单支付后可在订单详情申请。</p>', 7);
    art('about', '关于', '关于财哥商城', '<p>财哥商城是一个演示性质的综合电商平台,取「财源滚滚,货真价实」之意。</p><p>本站所有数据均为虚构,支付为模拟支付。</p>');

    // 会员
    const pw = bcrypt.hashSync('123456', 10);
    const users = [];
    [['13800000001', '财哥粉丝', 3200, 5200, 2], ['13800000002', '小美', 800, 600, 1], ['13800000003', '老王', 120, 0, 0], ['13900000004', '阿杰', 2600, 9000, 3], ['13700000005', '晓雯', 450, 80, 0], ['13600000006', '大壮', 60, 3100, 2], ['13500000007', '丽丽', 1000, 1200, 1]].forEach(([phone, nick, pts, growth, lv], i) => {
      const id = ins('users', { phone, password_hash: pw, nickname: nick, gender: ['男', '女', '保密'][i % 3], points: pts, growth, level_id: 1, invite_code: String(100001 + i), created_at: dayAgo(60 - i * 6), last_login: dayAgo(i) , referrer_id: i >= 4 ? 1 : null });
      users.push(id); svc.refreshLevel(id);
      db.exec1('INSERT INTO points_log(user_id,delta,balance,reason,created_at) VALUES(?,?,?,?,?)', id, pts, pts, '初始积分', dayAgo(50));
    });
    const addrs = [['广东省', '深圳市', '南山区', '科技园南区 8 栋 1203'], ['浙江省', '杭州市', '西湖区', '文三路 398 号东部软件园 5 楼'], ['北京市', '北京市', '朝阳区', '望京 SOHO T3 座 2808'], ['四川省', '成都市', '武侯区', '天府大道北段 1700 号'], ['上海市', '上海市', '浦东新区', '陆家嘴环路 1000 号'], ['湖北省', '武汉市', '洪山区', '光谷步行街 A 座 1601'], ['江苏省', '南京市', '鼓楼区', '中山路 18 号德基大厦']];
    users.forEach((uid, i) => { ins('addresses', { user_id: uid, name: ['张财', '李美', '王大', '陈杰', '周雯', '吴壮', '孙丽'][i], phone: '1380000' + String(1000 + i), province: addrs[i][0], city: addrs[i][1], district: addrs[i][2], detail: addrs[i][3], is_default: 1 }); });
    ins('addresses', { user_id: users[0], name: '张财', phone: '13800000001', province: '广东省', city: '广州市', district: '天河区', detail: '珠江新城华夏路 30 号', is_default: 0 });
    // 优惠券分发
    for (const uid of users.slice(0, 5)) { svc.grantCoupon(uid, cp.new, true); svc.grantCoupon(uid, cp.a, true); }
    svc.grantCoupon(users[0], cp.b, true);
    // 收藏、足迹
    [[0, 0], [0, 2], [0, 6], [1, 4], [1, 5]].forEach(([u, p]) => { db.exec1('INSERT OR IGNORE INTO favorites VALUES(?,?,?)', users[u], prodIds[p], dayAgo(3)); });
    [[0, 0], [0, 1], [0, 3]].forEach(([u, p], i) => db.exec1('INSERT OR IGNORE INTO history VALUES(?,?,?)', users[u], prodIds[p], dayAgo(i)));
    // 签到
    db.exec1('INSERT INTO signins(user_id,day,points,streak) VALUES(?,?,?,?)', users[0], U.offset(-86400000).slice(0, 10), 6, 2);
    db.exec1('UPDATE users SET signin_streak=2,last_signin=? WHERE id=?', U.offset(-86400000).slice(0, 10), users[0]);

    // 订单(历史 30 天)
    const statuses = ['completed', 'completed', 'completed', 'completed', 'shipped', 'paid', 'paid', 'unpaid', 'cancelled', 'completed', 'completed', 'completed', 'paid', 'shipped', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed', 'completed'];
    let seq = 0;
    statuses.forEach((st, i) => {
      const uid = users[i % users.length];
      const prod = db.get('SELECT * FROM products WHERE id=?', prodIds[(i * 3) % prodIds.length]);
      const sku = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prod.id);
      const qty = 1 + (i % 3 === 0 ? 1 : 0);
      const addr = db.get('SELECT * FROM addresses WHERE user_id=? LIMIT 1', uid);
      const t = dayAgo(st === 'unpaid' ? 0 : Math.max(1, 29 - i * 1.3 | 0), 9 + (i % 12));
      const goods = U.round2(sku.price * qty), fr = goods >= 99 ? 0 : 8;
      const oid = ins('orders', { order_no: t.replace(/[-: ]/g, '') + String(1000 + seq++), user_id: uid, status: st, goods_amount: goods, freight: fr, pay_amount: goods + fr, pay_method: st === 'unpaid' || st === 'cancelled' ? null : ['wechat', 'alipay', 'wechat'][i % 3], paid_at: st === 'unpaid' || st === 'cancelled' ? null : t, receiver: addr.name, phone: addr.phone, province: addr.province, city: addr.city, district: addr.district, detail: addr.detail, express_company: ['shipped', 'completed'].includes(st) ? ['顺丰速运', '中通快递', '京东物流', '圆通速递'][i % 4] : null, tracking_no: ['shipped', 'completed'].includes(st) ? 'SF' + (1000000000 + i * 7919) : null, shipped_at: ['shipped', 'completed'].includes(st) ? t : null, completed_at: st === 'completed' ? t : null, cancelled_at: st === 'cancelled' ? t : null, cancel_reason: st === 'cancelled' ? '用户取消' : null, points_awarded: st === 'completed' ? Math.floor(goods + fr) : 0, growth_awarded: st === 'completed' ? Math.floor(goods + fr) : 0, created_at: t });
      ins('order_items', { order_id: oid, product_id: prod.id, sku_id: sku.id, name: prod.name, spec_text: sku.spec_text, image: U.firstImg(prod.images), price: sku.price, qty });
      db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, t, '订单已提交');
      if (st !== 'unpaid' && st !== 'cancelled') db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, t, '订单支付成功');
      if (['shipped', 'completed'].includes(st)) { db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, t, '商家已发货'); db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, t, '包裹已到达【分拨中心】'); }
      if (st === 'completed') db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, t, '买家已确认收货,交易完成');
      if (st === 'unpaid') db.exec1('UPDATE orders SET created_at=? WHERE id=?', now(), oid);
      if (st === 'completed' && i % 2 === 0) {
        const itemId = db.get('SELECT id FROM order_items WHERE order_id=?', oid).id;
        const contents = ['质量很好,物流很快,包装也很用心,下次还会再来!', '性价比超高,和描述一致,客服态度也很好。', '东西收到了,非常满意,推荐给大家!', '做工精细,用起来很舒服,五星好评。'];
        ins('reviews', { product_id: prod.id, order_id: oid, order_item_id: itemId, user_id: uid, rating: [5, 5, 4, 5][i % 4], content: contents[i % 4], status: i % 6 === 0 ? 'pending' : 'approved', created_at: t });
        db.exec1('UPDATE order_items SET reviewed=1 WHERE id=?', itemId);
      }
    });
    // 一个售后申请
    const co = db.get("SELECT * FROM orders WHERE status='completed' ORDER BY id DESC LIMIT 1");
    ins('aftersales', { order_id: co.id, user_id: co.user_id, type: 'refund_return', reason: '商品与描述不符', description: '尺码偏小,申请退货退款', amount: co.pay_amount, status: 'pending', created_by: 'kefu', created_at: now(), updated_at: now() });
    // 秒杀 & 拼团
    const sk = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prodIds[2]);
    ins('seckills', { product_id: prodIds[2], sku_id: sk.id, price: 199, stock: 30, sold: 12, start_at: U.offset(-3600000), end_at: U.offset(6 * 3600000), limit_per_user: 1 });
    const sk2 = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prodIds[7]);
    ins('seckills', { product_id: prodIds[7], sku_id: sk2.id, price: 19.9, stock: 50, sold: 33, start_at: U.offset(-3600000), end_at: U.offset(6 * 3600000), limit_per_user: 2 });
    const sk3 = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prodIds[11]);
    ins('seckills', { product_id: prodIds[11], sku_id: sk3.id, price: 39, stock: 20, sold: 0, start_at: U.offset(3 * 3600000), end_at: U.offset(9 * 3600000), limit_per_user: 1 });
    const g1 = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prodIds[6]);
    const gb1 = ins('groupbuys', { product_id: prodIds[6], sku_id: g1.id, price: 69.9, size: 2, hours: 24 });
    const g2 = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prodIds[5]);
    ins('groupbuys', { product_id: prodIds[5], sku_id: g2.id, price: 99, size: 3, hours: 48 });
    // 一个进行中的团(发起人老王免支付演示:直接造一个已支付订单)
    const gu = users[2], ga = db.get('SELECT * FROM addresses WHERE user_id=?', gu);
    const gid = ins('groups', { groupbuy_id: gb1, leader_id: gu, need: 2, joined: 1, status: 'open', expire_at: U.offset(20 * 3600000), created_at: now() });
    const gp = db.get('SELECT * FROM products WHERE id=?', prodIds[6]);
    const goid = ins('orders', { order_no: U.orderNo() + '9', user_id: gu, type: 'group', status: 'paid', goods_amount: 69.9, pay_amount: 69.9, pay_method: 'wechat', paid_at: now(), receiver: ga.name, phone: ga.phone, province: ga.province, city: ga.city, district: ga.district, detail: ga.detail, group_id: gid, promo_id: gb1, created_at: now() });
    ins('order_items', { order_id: goid, product_id: gp.id, sku_id: g1.id, name: gp.name, spec_text: g1.spec_text, image: U.firstImg(gp.images), price: 69.9, qty: 1 });
    ins('group_members', { group_id: gid, user_id: gu, order_id: goid });
    db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', goid, now(), '拼团中,还差1人成团');
    // 发票
    const io = db.get("SELECT * FROM orders WHERE status='completed' LIMIT 1 OFFSET 1");
    ins('invoices', { order_id: io.id, user_id: io.user_id, type: 'company', title: '深圳市财哥科技有限公司', tax_no: '91440300MA5XXXXXXX', email: 'fin@example.com', amount: io.pay_amount, created_at: now() });
    // 客服留言
    ins('messages', { user_id: users[0], sender: 'user', content: '你好,请问手机什么时候发货?', created_at: now() });
    ins('messages', { user_id: users[0], sender: 'staff', content: '您好,订单将在24小时内为您安排发货哦~', created_at: now(), is_read: 0 });
    ins('messages', { user_id: users[1], sender: 'user', content: '可以开发票吗?', created_at: now() });

    // -------- 云商卡演示数据:线下销售、后台开通 --------
    for (const [k, v] of Object.entries(svc.cloud.CLOUD_DEFAULTS)) svc.setSetting(k, v);
    const cardDefs = [
      ['白银月卡', 'silver', 'month', 199, 10], ['白银季卡', 'silver', 'quarter', 499, 20], ['白银年卡', 'silver', 'year', 1599, 30],
      ['黄金月卡', 'gold', 'month', 399, 40], ['黄金季卡', 'gold', 'quarter', 999, 50], ['黄金年卡', 'gold', 'year', 2999, 60]
    ];
    const cardTypeIds = cardDefs.map(d => ins('cloud_card_types', { name: d[0], tier: d[1], duration: d[2], activation_fee: d[3], status: 1, sort: d[4], remark: '线下办理' }));
    const openCard = (uid, ti, start, end, amount, staff, note) => {
      db.exec1('UPDATE users SET cloud_tier=?, cloud_start=?, cloud_end=?, cloud_card_type_id=? WHERE id=?', cardDefs[ti][1], start, end, cardTypeIds[ti], uid);
      ins('cloud_card_sales', { user_id: uid, action: 'open', card_type_id: cardTypeIds[ti], amount, sale_date: start.slice(0, 10), staff, receipt_note: note, start_at: start, end_at: end, admin_id: 1, created_at: start });
    };
    // 财哥粉丝:黄金年卡;小美:白银月卡;老王:已过期(便于后台筛选)
    openCard(users[0], 5, dayAgo(10).slice(0, 10) + ' 00:00:00', U.offset(355 * 86400000).slice(0, 10) + ' 23:59:59', 2999, '门店-张店长', '收据 NO.0001');
    openCard(users[1], 0, dayAgo(5).slice(0, 10) + ' 00:00:00', U.offset(25 * 86400000).slice(0, 10) + ' 23:59:59', 199, '客服-小林', '已开电子发票');
    openCard(users[2], 0, dayAgo(60).slice(0, 10) + ' 00:00:00', dayAgo(30).slice(0, 10) + ' 23:59:59', 199, '门店-张店长', '');
    // 邀请首单券 & 邀请奖励演示(晓雯/大壮/丽丽 的邀请人是 财哥粉丝)
    const invCoupon = ins('coupons', { name: '邀请好友首单券', threshold: 59, amount: 8, total: 9999, per_limit: 1, valid_days: 30, description: '通过邀请注册的新会员首单可用', created_at: now() });
    svc.setSetting('invite_coupon_id', invCoupon);
    for (const [k, uid] of [[0, users[4]], [1, users[5]]]) {
      const o = db.get("SELECT id, completed_at FROM orders WHERE user_id=? AND status='completed' ORDER BY id LIMIT 1", uid);
      if (!o) continue;
      if (k === 0) ins('invite_rewards', { referrer_id: users[0], invitee_id: uid, order_id: o.id, points: 100, status: 'granted', due_at: dayAgo(3), granted_at: dayAgo(3), created_at: dayAgo(10) });
      else ins('invite_rewards', { referrer_id: users[0], invitee_id: uid, order_id: o.id, points: 100, status: 'pending', due_at: U.offset(4 * 86400000), created_at: dayAgo(3) });
      if (k === 0) svc.addPoints(users[0], 100, '邀请好友首单奖励(' + U.maskPhone(db.get('SELECT phone FROM users WHERE id=?', uid).phone) + ')');
    }
    // Banner
    ins('banners', { title: '云商卡 · 会员权益', subtitle: '会员价 · 包邮 · 签到加赠积分,线下办理', link: '/me/cloud', bg1: '#b45309', bg2: '#f2a93b', sort: 4 });
    art('help', '会员权益', '云商卡会员权益说明', CLOUD_HELP, 8);
  })();
  console.log('✔ 演示数据已生成');
  return true;
}
module.exports = seed;
if (require.main === module) { seed(process.argv.includes('--reset')); }
