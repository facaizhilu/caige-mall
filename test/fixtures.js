// 测试夹具:种子不再预置任何会员行为数据,测试需要的地址/订单/售后/发票/拼团/云商卡/邀请记录等在此自行创建。
// 用法:require('./fixtures')()  —— 直接写入 DATA_DIR 下的库(服务端同库运行),幂等:已建过则跳过。
const db = require('../lib/db');
const U = require('../lib/util');
const svc = require('../lib/svc');
const { now } = U;
const { SEED_MEMBERS } = require('../lib/seed');
module.exports = function setupFixtures() {
  if (db.get("SELECT 1 FROM settings WHERE key='test_fixtures_done'")) return;
  const ins = (t, o) => { const k = Object.keys(o); return db.prepare(`INSERT INTO ${t}(${k}) VALUES(${k.map(() => '?').join(',')})`).run(...k.map(x => o[x])).lastInsertRowid; };
  const dayAgo = (d, h = 10) => { const x = new Date(Date.now() - d * 86400000); x.setHours(h, Math.floor(Math.random() * 60), 0); return U.fmtDate(x); };
  const prodIds = db.all('SELECT id FROM products ORDER BY id LIMIT 13').map(r => r.id);
  const cpBy = n => db.get('SELECT id FROM coupons WHERE name=?', n).id;
  const cp = { new: cpBy('新人专享券'), a: cpBy('满99减10'), b: cpBy('满299减40') };
  db.transaction(() => {
    const users = [];
    SEED_MEMBERS.forEach(([phone, nick, pts], i) => {
      const id = db.get('SELECT id FROM users WHERE phone=?', phone).id;
      users.push(id);
      db.exec1('UPDATE users SET points=?, referrer_id=? WHERE id=?', pts, i >= 4 ? users[0] : null, id);
      db.exec1('INSERT INTO points_log(user_id,delta,balance,reason,created_at) VALUES(?,?,?,?,?)', id, pts, pts, '测试初始积分', dayAgo(50));
    });
    const addrs = [['海南省', '海口市', '龙华区', '滨海大道 8 号 1203'], ['浙江省', '杭州市', '西湖区', '文三路 398 号东部软件园 5 楼'], ['北京市', '北京市', '朝阳区', '望京 SOHO T3 座 2808'], ['四川省', '成都市', '武侯区', '天府大道北段 1700 号'], ['上海市', '上海市', '浦东新区', '陆家嘴环路 1000 号'], ['湖北省', '武汉市', '洪山区', '光谷步行街 A 座 1601'], ['江苏省', '南京市', '鼓楼区', '中山路 18 号德基大厦']];
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
      const prod = db.get('SELECT * FROM products WHERE id=?', prodIds[(i * 3) % 13]); // 只用前 13 个商品(历史订单分布保持不变)
      const sku = db.get('SELECT * FROM skus WHERE product_id=? ORDER BY id LIMIT 1', prod.id);
      const qty = 1 + (i % 3 === 0 ? 1 : 0);
      const addr = db.get('SELECT * FROM addresses WHERE user_id=? LIMIT 1', uid);
      const t = dayAgo(st === 'unpaid' ? 0 : Math.max(1, 29 - i * 1.3 | 0), 9 + (i % 12));
      const goods = U.round2(sku.price * qty), fr = goods >= 99 ? 0 : 8;
      const oid = ins('orders', { order_no: t.replace(/[-: ]/g, '') + String(1000 + seq++), user_id: uid, status: st, goods_amount: goods, freight: fr, pay_amount: goods + fr, pay_method: st === 'unpaid' || st === 'cancelled' ? null : ['wechat', 'alipay', 'wechat'][i % 3], paid_at: st === 'unpaid' || st === 'cancelled' ? null : t, receiver: addr.name, phone: addr.phone, province: addr.province, city: addr.city, district: addr.district, detail: addr.detail, express_company: ['shipped', 'completed'].includes(st) ? ['顺丰速运', '中通快递', '京东物流', '圆通速递'][i % 4] : null, tracking_no: ['shipped', 'completed'].includes(st) ? 'SF' + (1000000000 + i * 7919) : null, shipped_at: ['shipped', 'completed'].includes(st) ? t : null, completed_at: st === 'completed' ? t : null, cancelled_at: st === 'cancelled' ? t : null, cancel_reason: st === 'cancelled' ? '用户取消' : null, points_awarded: st === 'completed' ? Math.floor(goods + fr) : 0, growth_awarded: st === 'completed' ? Math.floor(goods + fr) : 0, created_at: t });
      ins('order_items', { order_id: oid, product_id: prod.id, sku_id: sku.id, name: prod.name, spec_text: sku.spec_text, image: U.firstImg(prod.images), price: sku.price, qty });
      db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, t, '订单已提交');
      if (st !== 'unpaid' && st !== 'cancelled') db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, t, '订单支付成功');
      if (['shipped', 'completed'].includes(st)) { db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, t, '商家已发货'); db.exec1('INSERT INTO traces(order_id,time,text) VALUES(?,?,?)', oid, t, '包裹已到达分拨中心'); }
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
    ins('aftersales', { order_id: co.id, user_id: co.user_id, type: 'refund_return', reason: '商品与描述不符', description: '颜色与描述不符,申请退货退款', amount: co.pay_amount, status: 'pending', created_by: 'kefu', created_at: now(), updated_at: now() });
    const gb1 = db.get('SELECT id FROM groupbuys ORDER BY id LIMIT 1').id, g1 = db.get('SELECT * FROM skus WHERE id=(SELECT sku_id FROM groupbuys WHERE id=?)', gb1);
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
    ins('invoices', { order_id: io.id, user_id: io.user_id, type: 'company', title: '海南韵农科技有限公司', tax_no: '91440300MA5XXXXXXX', email: 'fin@example.com', amount: io.pay_amount, created_at: now() });

    // -------- 云商卡演示数据:线下销售、后台开通 --------
    const cardDefs = [[0, 'silver'], [1, 'silver'], [2, 'silver'], [3, 'gold'], [4, 'gold'], [5, 'gold']];
    const cardTypeIds = db.all('SELECT id FROM cloud_card_types ORDER BY id').map(r => r.id);
    const openCard = (uid, ti, start, end, amount, staff, note) => {
      db.exec1('UPDATE users SET cloud_tier=?, cloud_start=?, cloud_end=?, cloud_card_type_id=? WHERE id=?', cardDefs[ti][1], start, end, cardTypeIds[ti], uid);
      ins('cloud_card_sales', { user_id: uid, action: 'open', card_type_id: cardTypeIds[ti], amount, sale_date: start.slice(0, 10), staff, receipt_note: note, start_at: start, end_at: end, admin_id: 1, created_at: start });
    };
    // 韵农粉丝:黄金年卡;小美:白银月卡;老王:已过期(便于后台筛选)
    openCard(users[0], 5, dayAgo(10).slice(0, 10) + ' 00:00:00', U.offset(355 * 86400000).slice(0, 10) + ' 23:59:59', 2999, '门店-张店长', '收据 NO.0001');
    openCard(users[1], 0, dayAgo(5).slice(0, 10) + ' 00:00:00', U.offset(25 * 86400000).slice(0, 10) + ' 23:59:59', 199, '客服-小林', '已开电子发票');
    openCard(users[2], 0, dayAgo(60).slice(0, 10) + ' 00:00:00', dayAgo(30).slice(0, 10) + ' 23:59:59', 199, '门店-张店长', '');
    // 邀请首单券 & 邀请奖励演示(晓雯/大壮/丽丽 的邀请人是 韵农粉丝)
    for (const [k, uid] of [[0, users[4]], [1, users[5]]]) {
      const o = db.get("SELECT id, completed_at FROM orders WHERE user_id=? AND status='completed' ORDER BY id LIMIT 1", uid);
      if (!o) continue;
      if (k === 0) ins('invite_rewards', { referrer_id: users[0], invitee_id: uid, order_id: o.id, points: 100, status: 'granted', due_at: dayAgo(3), granted_at: dayAgo(3), created_at: dayAgo(10) });
      else ins('invite_rewards', { referrer_id: users[0], invitee_id: uid, order_id: o.id, points: 100, status: 'pending', due_at: U.offset(4 * 86400000), created_at: dayAgo(3) });
      if (k === 0) svc.addPoints(users[0], 100, '邀请好友首单奖励(' + U.maskPhone(db.get('SELECT phone FROM users WHERE id=?', uid).phone) + ')');
    }
    svc.setSetting('test_fixtures_done', '1');
  })();
  svc.recalcSales();
};
