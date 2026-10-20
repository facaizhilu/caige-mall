const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const ejs = require('ejs');
const db = require('./lib/db');
const U = require('./lib/util');
const svc = require('./lib/svc');
const { RETURN_HELP, CLOUD_HELP, SEED_DESC_EDITS, CLOUD_HELP_EDIT, CLOUD_HELP_EDIT2 } = require('./lib/seed-texts');
const banned = require('./lib/banned');
const SqliteStore = require('./lib/session-store');

if (db.get('SELECT COUNT(*) n FROM admins').n === 0) require('./lib/seed')(false);
// 前台已下线账户余额:旧库中的相关帮助文案同步更新(幂等)
db.exec1("UPDATE articles SET title='支付方式说明', content='<p>本站为演示站点,支持微信支付(模拟)与支付宝(模拟),不产生真实扣款。</p>' WHERE category='help' AND title='余额充值说明'");
db.exec1("UPDATE articles SET content=REPLACE(content, '款项原路退回账户余额。', '款项原路退回(演示环境为模拟退款)。') WHERE category='help' AND content LIKE '%原路退回账户余额%'");
// 隐私政策 / 用户协议(文章形式,后台可编辑)
require('./lib/policies').ensurePolicies(db, U.now);
require('./lib/policies').ensurePointsRules(db, U.now);
svc.cloud.ensureDefaults();
// 一次性迁移(用 settings 标记,避免覆盖后台后续修改)
(function oneTimeMigrations() {
  const done = k => !!db.get('SELECT 1 FROM settings WHERE key=?', 'migr_' + k);
  const mark = k => db.exec1('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)', 'migr_' + k, U.now());
  if (!done('no7_fresh')) { // 鲜活易腐类分类默认不支持七天无理由
    db.exec1("UPDATE categories SET no_7day=1 WHERE name='水果生鲜' OR name LIKE '%蔬菜%' OR name LIKE '%鲜活%' OR name LIKE '%海鲜%'");
    mark('no7_fresh');
  }
  if (!done('return_help_v2')) {
    db.exec1("UPDATE articles SET content=? WHERE category='help' AND title='退款退货政策'", RETURN_HELP);
    db.exec1("UPDATE articles SET content=REPLACE(content,'<p>本站为演示站点,支持微信支付(模拟)与支付宝(模拟),不产生真实扣款。</p>','<p>本站为演示站点,支持微信支付(模拟)与支付宝(模拟),不产生真实扣款。本平台不提供账户余额与充值功能;积分仅限本账户使用,不可转让、不可提现。</p>') WHERE category='help' AND title='支付方式说明'");
    mark('return_help_v2');
  }
  if (!done('batch3_texts')) { // 云商卡改为线下办理、取消分销/推三返一后,同步旧库中的展示文案
    db.exec1("UPDATE banners SET subtitle='会员价 · 包邮 · 签到加赠积分,线下办理' WHERE link='/me/cloud'");
    db.exec1("UPDATE articles SET content=? WHERE category='help' AND title='云商卡会员权益说明'", CLOUD_HELP);
    db.exec1("UPDATE articles SET title='积分规则说明(旧)', status=0 WHERE category='help' AND title LIKE '%分销%'");
    db.exec1("UPDATE articles SET content=REPLACE(REPLACE(content,'<td>计算与展示积分、会员权益、每日返积分及兑换记录</td>','<td>计算与展示积分、会员等级与云商卡权益(会员价、包邮、签到加赠积分)</td>'),'<td>计算邀请奖励与分销佣金</td>','<td>计算邀请好友首单积分奖励</td>') WHERE category='policy' AND topic='privacy'");
    db.exec1("UPDATE articles SET content='<p>积分可在下单时抵扣部分金额,抵扣比例与单笔上限以《积分规则》页面公示为准。优惠券需满足门槛,每单限用一张。</p>' WHERE category='help' AND title='积分与优惠券使用说明'");
    db.exec1("UPDATE articles SET content=REPLACE(content,'<b>积分仅限本账户使用,不可转让、不可提现、不可兑换现金</b>','<b>积分仅限本账户使用,不可购买、不可转让、不可提现、不可兑换现金</b>,具体以《积分规则》为准') WHERE category='policy' AND topic='terms'");
    mark('batch3_texts');
  }
  if (!done('v11_compliance')) { // 合规审查报告 v1.1 修订:同步旧库中的展示文案与协议(仅替换仍为原文的内容)
    db.transaction(() => {
      // G1:顶部公告与首页 Banner 的包邮口径与运费模板一致
      const ann = svc.S('announcement');
      if (ann === '🎉 财哥商城开业大吉!新人注册即送积分与优惠券,全场满99元包邮') svc.setSetting('announcement', svc.ANNOUNCEMENT);
      else if (ann && ann.includes('全场满99元包邮')) svc.setSetting('announcement', ann.split('全场满99元包邮').join('普通商品满99元包邮(大件、偏远地区除外,以商品页标示为准)'));
      db.exec1("UPDATE banners SET subtitle=REPLACE(subtitle,'全场满99包邮','普通商品满99元包邮(大件、偏远地区除外)') WHERE subtitle LIKE '%全场满99包邮%'");
      // D1:积分规则中没有「每周五积分翻倍」活动,下线该公告(保留记录,status=0)
      db.exec1("UPDATE articles SET status=0 WHERE category='notice' AND title LIKE '%积分翻倍%'");
      // C1/G6:商品详情通用模板去掉「财哥严选」「假一赔十」「7天无理由退换」「全国联保」(退货政策以商品页「服务」栏按商品实际显示)
      for (const [o, n] of SEED_DESC_EDITS) db.exec1('UPDATE products SET description=REPLACE(description,?,?) WHERE instr(description,?)>0', o, n, o);
      // G6:「财哥严选」不再作为品牌名使用
      if (!db.get("SELECT 1 FROM brands WHERE name='财哥'")) db.exec1("UPDATE brands SET name='财哥', description='财哥品牌官方旗舰' WHERE name='财哥严选'");
      db.exec1("UPDATE products SET name=REPLACE(name,'财哥严选 ','财哥 ') WHERE name LIKE '财哥严选 %'");
      // G6:违禁词表补充(后台已编辑过的词表只追加缺少的词)
      const bw = svc.S('banned_words');
      if (bw != null) { const have = new Set(String(bw).split(/\r?\n/).map(x => x.trim())); const add = banned.ADDED_WORDS.filter(w => !have.has(w)); if (add.length) svc.setSetting('banned_words', String(bw).replace(/\s*$/, '') + '\n' + add.join('\n')); }
      // 店主要求:云商卡签到加赠改为按连续签到天数递增(第 1 天 25,每连续 1 天 +2),取消每月上限;有效期不变
      svc.setSetting('cloud_signin_extra', '25'); svc.setSetting('cloud_signin_extra_step', '2');
      db.exec1("DELETE FROM settings WHERE key='cloud_signin_extra_cap'");
      db.exec1("UPDATE articles SET content=REPLACE(content,?,?) WHERE category='help' AND instr(content,?)>0", CLOUD_HELP_EDIT[0], CLOUD_HELP_EDIT[1], CLOUD_HELP_EDIT[0]);
      // A2/A3/A4/A11/B1/H1/D2:隐私政策、用户协议、积分规则修订,并提升协议版本号使老用户重新确认
      // (全新安装时正文已是新版、版本默认 1.1,不会重复提升)
      const ed = require('./lib/policies').applyV11Edits(db), changed = ed.privacy + ed.terms;
      const m = String(svc.S('policy_version') || '1.0').match(/^(\d+)\.(\d+)$/);
      if (changed && m) { svc.setSetting('policy_version', m[1] + '.' + (+m[2] + 1)); console.log('协议已修订,版本号提升为 v' + svc.S('policy_version')); }
      mark('v11_compliance');
    })();
  }
  if (!done('v11b_policy')) { // v1.1 补充修订:供应商代发标注、头像昵称说明(v1.1 尚未被确认,原地更新、不提升版本号;对 v1.0 旧库在上一步之后执行)
    require('./lib/policies').applyV11bEdits(db);
    // 店主要求:云商卡签到加赠每天封顶 35(25 起每连续 1 天 +2)
    svc.setSetting('cloud_signin_extra_max', '35');
    db.exec1("UPDATE articles SET content=REPLACE(content,?,?) WHERE category='help' AND instr(content,?)>0", CLOUD_HELP_EDIT2[0], CLOUD_HELP_EDIT2[1], CLOUD_HELP_EDIT2[0]);
    mark('v11b_policy');
  }
  if (!done('v3_compliance')) { // 合规审查 v3:前台文案去「秒杀」、修正繁体字副标题、活动已售数按真实订单重算
    db.transaction(() => {
      db.exec1("UPDATE articles SET content=REPLACE(content,'(秒杀、拼团商品不可使用)','(活动价、拼团商品不可使用)') WHERE instr(content,'(秒杀、拼团商品不可使用)')>0");
      db.exec1("UPDATE banners SET title='活动专区 · 主题活动', subtitle='活动商品与价格以活动页面公示为准' WHERE title LIKE '%秒杀%' OR subtitle LIKE '%手慢无%'");
      db.exec1("UPDATE banners SET link='/activity' WHERE link='/seckill'");
      db.exec1("UPDATE products SET subtitle='60S 长绒棉 · 透气亲肤' WHERE subtitle='60S 长绒棉 · 親肤透气 · 亲肤柔软'");
      db.exec1("UPDATE products SET is_hot=0, is_new=0");
      db.exec1("UPDATE seckills SET sold=COALESCE((SELECT SUM(oi.qty) FROM orders o JOIN order_items oi ON oi.order_id=o.id WHERE o.type='seckill' AND o.promo_id=seckills.id AND o.status NOT IN ('cancelled','refunded')),0)");
      mark('v3_compliance');
    })();
  }
  if (!done('brand_yunnong')) { // 品牌更名「财哥商城」→「韵农甄选」:只替换仍等于旧默认值的设置/文案,后台改过的不动
    const T = require('./lib/seed-texts');
    db.transaction(() => {
      if (svc.S('shop_name') === T.BRAND_OLD) svc.setSetting('shop_name', T.BRAND_NEW);
      if (svc.S('announcement') === T.OLD_ANNOUNCEMENT) svc.setSetting('announcement', svc.ANNOUNCEMENT);
      db.exec1("UPDATE banners SET title=? WHERE title=?", T.BRAND_NEW + ' 开业大吉', T.BRAND_OLD + ' 开业大吉');
      for (const [cat, ot, oc, nt, nc] of T.BRAND_ARTICLES) db.exec1('UPDATE articles SET title=?, content=? WHERE category=? AND title=? AND content=?', nt, nc, cat, ot, oc);
      for (const [o, n] of T.BRAND_TEXT_EDITS) db.exec1('UPDATE articles SET content=REPLACE(content,?,?) WHERE instr(content,?)>0', o, n, o);
      db.exec1("UPDATE traces SET text=REPLACE(text,'感谢您在财哥商城购物','感谢您在韵农甄选购物') WHERE instr(text,'感谢您在财哥商城购物')>0");
      mark('brand_yunnong');
    })();
  }
  if (!done('points_img_ivory_20261020')) { // 积分商品演示图:橙/红底 → 米白底(仅原生成图)
    db.exec1("UPDATE points_goods SET image=REPLACE(REPLACE(REPLACE(REPLACE(image,'a=f59e0b','a=fbf6ec'),'b=fde68a','b=f3e7cf'),'a=b8231c','a=fbf6ec'),'b=e9b84f','b=f3e7cf') WHERE instr(image,'/img/gen.svg')=1");
    // 演示生成图上的商品名原先被截断(8/6 字),改为完整名称(生成器自动缩字号/折行)
    for (const t of ['products', 'points_goods']) for (const r of db.all(`SELECT id, name, ${t === 'products' ? 'images' : 'image'} v FROM ${t} WHERE instr(${t === 'products' ? 'images' : 'image'}, '/img/gen.svg')>0`)) {
      const nv = r.v.replace(/([?&]n=)([^&"]*)/g, (m, k, n) => { let d = ''; try { d = decodeURIComponent(n); } catch (e) { return m; } return d && r.name.startsWith(d) ? k + encodeURIComponent(r.name.slice(0, 20)) : m; });
      if (nv !== r.v) db.exec1(`UPDATE ${t} SET ${t === 'products' ? 'images' : 'image'}=? WHERE id=?`, nv, r.id);
    }
    mark('points_img_ivory_20261020');
  }
  if (!done('brand_hainan_20261020')) { // 去除旧「财哥」品牌与深圳地址:仅替换仍等于旧默认值的设置/演示数据,后台改过的不动
    db.transaction(() => {
      if (svc.S('slogan') === '好货不贵,财源广进') svc.setSetting('slogan', '韵农甄选 · 新鲜好物');
      if (['广东省深圳市南山区科技园', '广东省深圳市南山区科技园财哥大厦 18 层'].includes(svc.S('address'))) svc.setSetting('address', '海南韵农科技有限公司 · 海南省海口市龙华区');
      db.exec1("UPDATE products SET name='华岳 Type-C 编织快充数据线' WHERE name='财哥 Type-C 编织快充数据线'");
      db.exec1("UPDATE points_goods SET name='华岳 Type-C 数据线' WHERE name='财哥 Type-C 数据线'");
      const hy = db.get("SELECT id FROM brands WHERE name='华岳'"), cg = db.get("SELECT id FROM brands WHERE name='财哥'");
      if (cg) { if (hy) db.exec1('UPDATE products SET brand_id=? WHERE brand_id=? AND name=?', hy.id, cg.id, '华岳 Type-C 编织快充数据线'); db.exec1("UPDATE brands SET name='韵农', description='韵农品牌官方旗舰' WHERE id=? AND description='财哥品牌官方旗舰' AND NOT EXISTS (SELECT 1 FROM brands WHERE name='韵农')", cg.id); }
      db.exec1("UPDATE users SET nickname='韵农粉丝' WHERE nickname='财哥粉丝'");
      db.exec1("UPDATE points_goods SET image=REPLACE(REPLACE(image,'f59e0b','b8231c'),'fde68a','e9b84f') WHERE is_demo=1 AND instr(image,'f59e0b')>0");
      mark('brand_hainan_20261020');
    })();
  }
  if (!done('scope_20261019') && process.env.DEMO_MODE === '1') { // 演示库:按 2026-10-19 实际登记的经营范围,下架范围外的「原始演示自营商品」(按种子原名精确匹配,后台新建/改名的不动),隐藏范围外演示分类
    const T = require('./lib/seed-texts');
    db.transaction(() => {
      const ph = a => a.map(() => '?').join(',');
      const n = db.prepare(`UPDATE products SET status=0 WHERE supplier IS NULL AND status=1 AND name IN (${ph(T.OLD_SEED_OUT_OF_SCOPE)})`).run(...T.OLD_SEED_OUT_OF_SCOPE).changes;
      for (const [o, nw] of [['数码家电', '数码电脑'], ['食品生鲜', '新鲜农产品'], ['水果生鲜', '新鲜水果']]) db.exec1('UPDATE categories SET name=? WHERE name=?', nw, o);
      for (const c of db.all(`SELECT id FROM categories WHERE status=1 AND name IN (${ph(T.OLD_SEED_OUT_OF_SCOPE_CATS)})`, ...T.OLD_SEED_OUT_OF_SCOPE_CATS)) {
        const ids = [c.id, ...db.all('SELECT id FROM categories WHERE parent_id=?', c.id).map(x => x.id)];
        if (!db.get(`SELECT 1 FROM products WHERE status=1 AND category_id IN (${ph(ids)})`, ...ids)) db.exec1('UPDATE categories SET status=0 WHERE id=?', c.id);
      }
      for (const [o, nw] of T.OLD_SEED_RENAMES.keywords) db.exec1('UPDATE keywords SET word=? WHERE word=?', nw, o);
      for (const [o, nw, emoji] of T.OLD_SEED_RENAMES.points) db.exec1('UPDATE points_goods SET name=?, image=? WHERE name=?', nw, U.genImg(emoji, 'f59e0b', 'fde68a', 0, nw.slice(0, 6)), o);
      const fruit = db.get("SELECT id FROM categories WHERE name='新鲜水果' AND parent_id>0");
      if (fruit) db.exec1("UPDATE coupons SET name='新鲜水果满59减8', description='仅限新鲜水果分类商品', category_id=? WHERE name='食品生鲜满59减8'", fruit.id);
      if (n) console.log(`[scope] 演示库:已下架 ${n} 个经营范围外的演示自营商品`);
      mark('scope_20261019');
    })();
  }
  if (!done('icp_demo_qiong')) { // 演示备案号占位改为「琼ICP备…(演示)」:仅当仍为旧默认值
    const T = require('./lib/seed-texts');
    if (svc.S('icp') === T.OLD_ICP) svc.setSetting('icp', T.NEW_ICP);
    mark('icp_demo_qiong');
  }
  if (!done('home_picks_produce') && process.env.DEMO_MODE === '1') { // 演示库:原演示整机手机(未改动:原名+原副标题+自营)替换为数码配件;补充两款新鲜水果;好物精选排序以新鲜农产品为主。后台改过的不动
    const T = require('./lib/seed-texts');
    db.transaction(() => {
      const ph = db.get('SELECT id FROM products WHERE supplier IS NULL AND name=? AND subtitle=?', T.OLD_SEED_PHONE.name, T.OLD_SEED_PHONE.subtitle);
      const catId = n => (db.get('SELECT id FROM categories WHERE name=? AND parent_id>0', n) || {}).id;
      const brandId = n => (db.get('SELECT id FROM brands WHERE name=?', n) || {}).id || null;
      const imgs = r => JSON.stringify([0, 1, 2, 3].map(v => U.genImg(r[14], r[12], r[13], v, r[0].slice(0, 8))));
      const specsOf = r => r[10].split(';').map(x => { const [k, v] = x.split(':'); return [k, v.split('|')]; });
      const combosOf = r => { let c = [{}]; for (const [k, vs] of specsOf(r)) c = c.flatMap(o => vs.map(v => ({ ...o, [k]: v }))); return c; };
      const skuPrice = (r, ci, n) => r[11][Math.min(Math.floor(ci / Math.max(1, n / r[11].length)), r[11].length - 1)];
      if (ph && catId(T.DEMO_ACCESSORY_ROW[2])) {
        const r = T.DEMO_ACCESSORY_ROW, combos = combosOf(r);
        db.exec1('UPDATE products SET name=?, subtitle=?, category_id=?, images=?, spec_names=?, sort=? WHERE id=?', r[0], r[1], catId(r[2]), imgs(r), specsOf(r).map(x => x[0]).join(','), T.DEMO_PICK_SORT[r[0]], ph.id);
        db.all('SELECT id FROM skus WHERE product_id=? ORDER BY id', ph.id).forEach((k, i) => {
          if (i < combos.length) { const pr = skuPrice(r, i, combos.length); db.exec1('UPDATE skus SET attrs=?, spec_text=?, price=? WHERE id=?', JSON.stringify(combos[i]), Object.values(combos[i]).join(' / '), pr[0], k.id); }
          else db.exec1('UPDATE skus SET stock=0 WHERE id=?', k.id);
        });
        db.exec1('UPDATE products SET stock=(SELECT SUM(stock) FROM skus WHERE product_id=?), price=(SELECT MIN(price) FROM skus WHERE product_id=? AND stock>0) WHERE id=?', ph.id, ph.id, ph.id);
        for (const r of T.DEMO_PRODUCE_ROWS) {
          if (!catId(r[2]) || db.get('SELECT 1 FROM products WHERE name=?', r[0])) continue;
          const cs = combosOf(r);
          const pid = db.prepare('INSERT INTO products(name,subtitle,category_id,brand_id,price,stock,description,images,is_hot,is_new,template_id,spec_names,sort,created_at) VALUES(?,?,?,?,?,0,?,?,0,0,1,?,?,?)').run(r[0], r[1], catId(r[2]), brandId(r[3]), r[4], T.SEED_DESC(r[0]), imgs(r), specsOf(r).map(x => x[0]).join(','), T.DEMO_PICK_SORT[r[0]] || 0, U.now()).lastInsertRowid;
          cs.forEach((a, ci) => { const pr = skuPrice(r, ci, cs.length); db.prepare('INSERT INTO skus(product_id,attrs,spec_text,price,stock,code) VALUES(?,?,?,?,?,?)').run(pid, JSON.stringify(a), Object.values(a).join(' / '), pr[0], Math.max(5, Math.floor(pr[1] / cs.length * r[11].length)), 'CG' + String(pid).padStart(3, '0') + String(ci + 1).padStart(2, '0')); });
          db.exec1('UPDATE products SET stock=(SELECT SUM(stock) FROM skus WHERE product_id=?), price=(SELECT MIN(price) FROM skus WHERE product_id=?) WHERE id=?', pid, pid, pid);
        }
        for (const [n, so] of Object.entries(T.DEMO_PICK_SORT)) db.exec1('UPDATE products SET sort=? WHERE supplier IS NULL AND name=? AND sort<=100', so, n);
        console.log('[demo] 好物精选演示商品已更新为以新鲜农产品为主');
      }
      mark('home_picks_produce');
    })();
  }
  if (!done('demo_laptop_accessory') && process.env.DEMO_MODE === '1') { // 演示库:原演示整机「华岳 轻薄本」(未改动:原名+原副标题+自营)替换为电脑配件(同一 ID);后台改过的不动
    const T = require('./lib/seed-texts');
    db.transaction(() => {
      const lp = db.get('SELECT id FROM products WHERE supplier IS NULL AND name=? AND subtitle=?', T.OLD_SEED_LAPTOP.name, T.OLD_SEED_LAPTOP.subtitle);
      const r = T.DEMO_LAPTOP_REPLACE_ROW;
      const cat = db.get('SELECT id FROM categories WHERE name=? AND parent_id>0', r[2]);
      if (lp && cat) {
        const specs = r[10].split(';').map(x => { const [k, v] = x.split(':'); return [k, v.split('|')]; });
        let combos = [{}]; for (const [k, vs] of specs) combos = combos.flatMap(o => vs.map(v => ({ ...o, [k]: v })));
        const imgs = JSON.stringify([0, 1, 2, 3].map(v => U.genImg(r[14], r[12], r[13], v, r[0].slice(0, 8))));
        db.exec1('UPDATE products SET name=?, subtitle=?, category_id=?, images=?, spec_names=?, description=? WHERE id=?', r[0], r[1], cat.id, imgs, specs.map(x => x[0]).join(','), T.SEED_DESC(r[0]), lp.id);
        const ex = db.all('SELECT id FROM skus WHERE product_id=? ORDER BY id', lp.id);
        combos.forEach((a, i) => {
          const pr = r[11][Math.min(Math.floor(i / Math.max(1, combos.length / r[11].length)), r[11].length - 1)];
          if (ex[i]) db.exec1('UPDATE skus SET attrs=?, spec_text=?, price=? WHERE id=?', JSON.stringify(a), Object.values(a).join(' / '), pr[0], ex[i].id);
          else db.prepare('INSERT INTO skus(product_id,attrs,spec_text,price,stock,code) VALUES(?,?,?,?,?,?)').run(lp.id, JSON.stringify(a), Object.values(a).join(' / '), pr[0], 10, 'CG' + String(lp.id).padStart(3, '0') + String(i + 1).padStart(2, '0') + 'M');
        });
        ex.slice(combos.length).forEach(k => db.exec1('UPDATE skus SET stock=0 WHERE id=?', k.id));
        db.exec1('UPDATE products SET stock=(SELECT SUM(stock) FROM skus WHERE product_id=?), price=(SELECT MIN(price) FROM skus WHERE product_id=? AND stock>0) WHERE id=?', lp.id, lp.id, lp.id);
        console.log('[demo] 演示整机「华岳 轻薄本」已替换为电脑配件');
      }
      mark('demo_laptop_accessory');
    })();
  }
  if (!done('home_carousel_banners')) { // 首页恢复轮播:旧库若仍是未改动过的旧默认 Banner(无图片),替换为合规演示 Banner;后台已改动过的不动
    const T = require('./lib/seed-texts');
    db.transaction(() => {
      const rows = db.all('SELECT title, image FROM banners');
      if (rows.length && rows.every(b => !b.image && T.OLD_SEED_BANNER_TITLES.includes(b.title))) {
        db.exec1('DELETE FROM banners');
        T.DEMO_BANNERS.forEach((b, i) => db.prepare('INSERT INTO banners(title,subtitle,image,link,bg1,bg2,sort,status) VALUES(?,?,?,?,?,?,?,1)').run(b.title, b.subtitle, b.image, b.link, b.bg1, b.bg2, i));
      }
      mark('home_carousel_banners');
    })();
  }
  if (!done('brand_nanshanju_20261020')) { // 演示品牌「南山居」(近似真实品牌)→「韵农甄选」:仅改原种子品牌与以「南山居 」开头的演示商品名
    db.transaction(() => {
      const has = db.get("SELECT id FROM brands WHERE name='韵农甄选'"), old = db.get("SELECT id FROM brands WHERE name='南山居' AND description='南山居品牌官方旗舰'");
      if (old) { if (has) db.exec1('UPDATE products SET brand_id=? WHERE brand_id=?', has.id, old.id), db.exec1('UPDATE brands SET status=0 WHERE id=?', old.id); else db.exec1("UPDATE brands SET name='韵农甄选', description='韵农甄选品牌官方旗舰' WHERE id=?", old.id); }
      for (const r of db.all("SELECT id, name, images FROM products WHERE name LIKE '南山居 %'")) db.exec1('UPDATE products SET name=?, images=? WHERE id=?', '韵农甄选 ' + r.name.slice(4), String(r.images || '').split(encodeURIComponent('南山居')).join(encodeURIComponent('韵农甄选')), r.id);
      mark('brand_nanshanju_20261020');
    })();
  }
  if (!done('bot_sender_24h_20261020')) { // 演示种子的「24 小时发货」提示属于自动回复,不是人工客服
    db.exec1("UPDATE messages SET sender='bot' WHERE sender='staff' AND content='您好,订单将在24小时内为您安排发货哦~'");
    mark('bot_sender_24h_20261020');
  }
  if (!done('policy_v12_svc_images')) { // 隐私政策增加「售后图片」条目;仅替换仍为原文的段落,有改动时协议版本 +0.1,老用户下次登录重新确认
    const n = require('./lib/policies').applyV12Edits(db), m = String(svc.S('policy_version') || '1.1').match(/^(\d+)\.(\d+)$/);
    if (n && m) { svc.setSetting('policy_version', m[1] + '.' + (+m[2] + 1)); console.log('隐私政策已修订(售后图片),版本号提升为 v' + svc.S('policy_version')); }
    mark('policy_v12_svc_images');
  }
  if (!done('all_7day_20261020')) { // 常规商品(含生鲜)均支持七天无理由:清除分类/商品「不支持」旧标记,协议与帮助文同步(改动时协议版本 +0.1)
    db.exec1('UPDATE categories SET no_7day=0 WHERE no_7day=1'); db.exec1('UPDATE products SET no_reason_return=1 WHERE no_reason_return=0');
    const [o, nw] = require('./lib/seed-texts').RETURN_HELP_7DAY_EDIT;
    for (const a of db.all("SELECT id, content FROM articles WHERE category='help' AND title='退款退货政策'")) if (String(a.content).includes(o)) db.exec1('UPDATE articles SET content=? WHERE id=?', a.content.split(o).join(nw), a.id);
    const n = require('./lib/policies').applyV13Edits(db), m = String(svc.S('policy_version') || '1.1').match(/^(\d+)\.(\d+)$/);
    if (n && m) { svc.setSetting('policy_version', m[1] + '.' + (+m[2] + 1)); console.log('用户协议已修订(七天无理由),版本号提升为 v' + svc.S('policy_version')); }
    mark('all_7day_20261020');
  }
  if (!done('demo_plain_names_20261020')) { // 去除全部虚构演示品牌:自营演示商品/积分商品名去品牌前缀(仅匹配原种子默认名),品牌统一「韵农甄选」,生成图文字同步;供应商商品不动
    const T = require('./lib/seed-texts');
    db.transaction(() => {
      let yn = db.get("SELECT id FROM brands WHERE name='韵农甄选'"); if (!yn) yn = { id: db.exec1("INSERT INTO brands(name,description,color,sort,status) VALUES('韵农甄选','韵农甄选品牌官方旗舰','#b8231c',0,1)").lastInsertRowid };
      db.exec1('UPDATE brands SET status=1 WHERE id=?', yn.id);
      const swapImg = (v, o, n) => String(v || '').split(encodeURIComponent(o)).join(encodeURIComponent(n));
      for (const r of db.all("SELECT id, name, images, description FROM products WHERE supplier IS NULL")) {
        if (!T.DEMO_BRAND_PREFIX.test(r.name)) continue;
        const nn = T.plainDemoName(r.name); if (nn === r.name) continue;
        const desc = r.description === T.SEED_DESC(r.name) ? T.SEED_DESC(nn) : r.description;
        db.exec1('UPDATE products SET name=?, images=?, description=? WHERE id=?', nn, swapImg(r.images, r.name, nn), desc, r.id);
        db.exec1('UPDATE order_items SET name=?, image=REPLACE(image,?,?) WHERE product_id=? AND name=?', nn, encodeURIComponent(r.name), encodeURIComponent(nn), r.id, r.name);
      }
      for (const [o, n] of T.POINTS_PLAIN) for (const g of db.all('SELECT id, image FROM points_goods WHERE name=?', o)) db.exec1('UPDATE points_goods SET name=?, image=? WHERE id=?', n, swapImg(g.image, o.slice(0, 20), n).split(encodeURIComponent(o.slice(0, 6))).join(encodeURIComponent(n)), g.id);
      for (const b of T.DEMO_OLD_BRANDS) for (const ob of db.all('SELECT id FROM brands WHERE name=? AND description=?', b, b + '品牌官方旗舰')) { db.exec1('UPDATE products SET brand_id=? WHERE brand_id=? AND supplier IS NULL', yn.id, ob.id); db.exec1('UPDATE brands SET status=0 WHERE id=?', ob.id); }
      mark('demo_plain_names_20261020');
    })();
  }
})();

const app = express();
const PORT = process.env.PORT || 3000;
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- 静态资源 & 占位图 ----
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use('/uploads', express.static(path.join(__dirname, 'public', 'uploads')));
app.get('/img/gen.svg', (req, res) => {
  const hex = s => /^[0-9a-fA-F]{6}$/.test(s) ? '#' + s : '#d4202a';
  const a = hex(req.query.a), b = hex(req.query.b), v = parseInt(req.query.v) || 0;
  const t = U.esc(String(req.query.t || '韵').slice(0, 4)), n = U.esc(String(req.query.n || '').slice(0, 14));
  const angle = [[0, 0, 1, 1], [1, 0, 0, 1], [0, 1, 1, 0], [0.5, 0, 0.5, 1]][v % 4];
  const shapes = [
    `<circle cx="520" cy="120" r="170" fill="#fff" opacity=".13"/><circle cx="90" cy="520" r="130" fill="#fff" opacity=".1"/>`,
    `<rect x="-60" y="380" width="700" height="140" fill="#fff" opacity=".12" transform="rotate(-12 300 450)"/><circle cx="500" cy="140" r="90" fill="#fff" opacity=".15"/>`,
    `<circle cx="100" cy="100" r="150" fill="#fff" opacity=".13"/><circle cx="500" cy="500" r="200" fill="#fff" opacity=".1"/>`,
    `<polygon points="600,0 600,300 300,0" fill="#fff" opacity=".14"/><polygon points="0,600 0,350 250,600" fill="#fff" opacity=".12"/>`
  ][v % 4];
  // 浅色底(如积分商品米白底)用深红文字/金色装饰;名称按长度自动缩字号,超过 9 字折两行,保证不被裁切
  const lum = h => { const n = parseInt(h.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * (n >> 8 & 255) + 0.114 * (n & 255)) / 255; };
  const light = (lum(a) + lum(b)) / 2 > 0.75, ink = light ? '#9e1712' : '#fff', deco = light ? '#c48f2f' : '#fff';
  const raw = String(req.query.n || '').slice(0, 20);
  let cut = Math.ceil(raw.length / 2); { let best = -1; for (let k = 1; k < raw.length - 1; k++) if (raw[k] === ' ' && Math.abs(k - raw.length / 2) <= 4 && (best < 0 || Math.abs(k - raw.length / 2) < Math.abs(best - raw.length / 2))) best = k; if (best > 0) cut = best; }
  const lines = raw.length > 9 ? [raw.slice(0, cut).trim(), raw.slice(cut).trim()] : (raw ? [raw] : []);
  const fs = lines.length ? Math.min(44, Math.floor(520 / Math.max(...lines.map(l => [...l].length)))) : 0;
  const ty = lines.length === 2 ? [470, 470 + fs + 8] : [500];
  const names = lines.map((l, k) => `<text x="300" y="${ty[k]}" font-size="${fs}" font-weight="700" text-anchor="middle" font-family="Noto Sans CJK SC,PingFang SC,Microsoft YaHei,sans-serif" fill="${ink}" opacity=".95">${U.esc(l)}</text>`).join('');
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600"><defs><linearGradient id="g" x1="${angle[0]}" y1="${angle[1]}" x2="${angle[2]}" y2="${angle[3]}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/>${light ? shapes.replace(/fill="#fff"/g, 'fill="' + deco + '"') : shapes}<text x="300" y="${n ? (lines.length === 2 ? 300 : 330) : 365}" font-size="${n ? 190 : 230}" text-anchor="middle" font-family="Noto Color Emoji,Apple Color Emoji,Segoe UI Emoji,Noto Sans CJK SC,sans-serif" fill="${ink}">${t}</text>${names}<text x="580" y="585" font-size="22" text-anchor="end" font-family="Noto Sans CJK SC,PingFang SC,Microsoft YaHei,sans-serif" fill="${ink}" opacity=".45">韵农甄选</text></svg>`);
});
app.get('/favicon.ico', (req, res) => res.sendFile(path.join(__dirname, 'public', 'favicon.ico'), { maxAge: '1d' }));
app.get('/apple-touch-icon.png', (req, res) => res.sendFile(path.join(__dirname, 'public', 'img', 'apple-touch-icon.png'), { maxAge: '1d' }));

// 查询参数一律为字符串(?q[]=1 / ?q[a]=1 之类的数组/对象取最后一个字符串值或置空),避免列表/搜索页 500
app.use((req, res, next) => { const q = req.query; for (const k of Object.keys(q)) { const v = q[k]; if (Array.isArray(v)) { const last = v.filter(x => typeof x === 'string').pop(); q[k] = last === undefined ? '' : last; } else if (v && typeof v === 'object') q[k] = ''; } next(); });
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// ---- 上传(仅登录用户/管理员,图片白名单) ----
const upload = multer({
  storage: multer.diskStorage({
    destination: path.join(__dirname, 'public', 'uploads'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(5).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 9 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype) && /\.(png|jpe?g|gif|webp)$/i.test(file.originalname))
});
fs.mkdirSync(path.join(__dirname, 'public', 'uploads'), { recursive: true });
function multipart(isAuthed) {
  return (req, res, next) => {
    if (!(req.headers['content-type'] || '').startsWith('multipart/form-data')) return next();
    if (!isAuthed(req)) return res.status(403).send('请先登录');
    upload.any()(req, res, err => { if (err) return res.status(400).send('上传失败:' + U.esc(err.message)); next(); });
  };
}
const filesOf = (req, field) => (req.files || []).filter(f => f.fieldname === field).map(f => '/uploads/' + f.filename);

// ---- CSRF (session token, 表单隐藏域/请求头) ----
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(16).toString('hex');
  res.locals.csrf = req.session.csrf;
  if (['POST', 'PUT', 'DELETE'].includes(req.method)) {
    const tok = (req.body && req.body._csrf) || req.headers['x-csrf-token'];
    if (!tok || tok !== req.session.csrf) return res.status(403).send('<meta charset="utf-8"><h3>页面已过期或请求非法(CSRF 校验失败),请返回刷新后重试。</h3>');
  }
  next();
}

// ---- 渲染助手(布局) ----
function pageRenderer(layout) {
  return (req, res, next) => {
    res.page = (view, data = {}) => {
      const locals = { ...app.locals, ...res.locals, ...data, req };
      ejs.renderFile(path.join(__dirname, 'views', view + '.ejs'), locals, { views: [path.join(__dirname, 'views')] }, (e, body) => {
        if (e) return next(e);
        ejs.renderFile(path.join(__dirname, 'views', (data.layout || layout) + '.ejs'), { ...locals, body }, (e2, html) => e2 ? next(e2) : res.send(html));
      });
    };
    next();
  };
}
app.locals.U = U; app.locals.demo = process.env.DEMO_MODE === '1'; app.locals.money = U.money; app.locals.ORDER_STATUS = U.ORDER_STATUS; app.locals.PAY_METHOD = U.PAY_METHOD;
// 划线原价:仅在填写且高于售价时展示(《明码标价和禁止价格欺诈规定》)
// 商品标签自动判定:「新品」按上架时间,「热卖」按真实销量(products.sales 仅由真实订单计算)
app.locals.prodTag = (p, s) => { const nd = U.int(s.new_days, 30), ht = U.int(s.hot_sales_threshold, 10); if (nd > 0 && p.created_at && p.created_at >= U.offset(-nd * 86400000)) return '新品'; if (ht > 0 && +p.sales >= ht) return '热卖'; return ''; };
app.locals.showMkt = (mkt, price) => mkt != null && +mkt > 0 && +mkt > +price;
app.locals.AFTERSALE_STATUS = U.AFTERSALE_STATUS; app.locals.AFTERSALE_TYPE = U.AFTERSALE_TYPE; app.locals.PERMS = U.PERMS; app.locals.regions = require('./lib/regions');
app.locals.qs = (req, over) => { const q = { ...req.query, ...over }; return '?' + Object.entries(q).filter(([, v]) => v !== '' && v != null).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); };

// 会话 Cookie:path=/、lax、生产(HTTPS,Render 代理后 trust proxy=1)下 secure;前台 rolling 30 天,会话存 SQLite(sessions 表)
const cookieBase = { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' ? 'auto' : false, maxAge: 30 * 86400000 };
const secret = process.env.SESSION_SECRET || 'caige-mall-demo-secret-change-me';

// ================= 后台 /admin(独立会话、独立布局) =================
const adminSession = session({ name: 'cg_admin.sid', secret, resave: false, saveUninitialized: false, store: new SqliteStore('a:'), cookie: { ...cookieBase, maxAge: 8 * 3600000, path: '/admin' } });
const adminRouter = express.Router();
adminRouter.use(adminSession);
adminRouter.use(multipart(req => !!req.session.admin));
adminRouter.use(csrf);
adminRouter.use(pageRenderer('admin/layout'));
adminRouter.use((req, res, next) => { res.locals.admin = req.session.admin || null; res.locals.shop = svc.settings(); res.locals.flash = req.session.flash; delete req.session.flash; res.locals.filesOf = filesOf; next(); });
require('./routes/admin')(adminRouter, { filesOf });
app.use('/admin', adminRouter);
app.use('/admin', (req, res) => res.status(404).send('后台页面不存在'));

// ================= 供应商回调(无会话/CSRF;按文档校验并回查接口确认) =================
const jdvop = require('./lib/suppliers/jdvop');
app.post('/api/suppliers/jdvop/callback', async (req, res) => {
  try {
    const r = await jdvop.handleCallback(req.body, { query: req.query });
    if (!r.ok) return res.status(r.status || 400).json({ code: r.status || 400, msg: r.msg });
    res.json({ code: 200, msg: 'success' }); // TODO(文档未说明):回调应答格式待确认
  } catch (e) { console.error('[jdvop] callback', e); res.status(500).json({ code: 500, msg: 'error' }); }
});

// ================= 前台 =================
app.use(session({ name: 'cg.sid', secret, resave: false, saveUninitialized: false, store: new SqliteStore('s:'), rolling: true, cookie: cookieBase }));
// 前台 HTML 不缓存:避免手机浏览器返回/前进缓存(bfcache/代理缓存)展示登录前的旧页面(底栏「我的」指向 /login)造成「被退出登录」的错觉
app.use((req, res, next) => { if (req.method === 'GET' && !req.path.startsWith('/static')) res.set('Cache-Control', 'private, no-cache, no-store, must-revalidate'); next(); });
// 前台不提供任何图片/文件上传(评价、售后、客服均为纯文字),不挂载 multipart 解析
app.use(csrf);
app.use(pageRenderer('shop/layout'));
app.use((req, res, next) => {
  res.locals.shop = svc.settings();
  res.locals.flash = req.session.flash; delete req.session.flash;
  res.locals.user = null; res.locals.cartCount = 0;
  if (req.session.uid) {
    const u = db.get('SELECT u.*, l.name level_name, l.color level_color, l.discount level_discount FROM users u LEFT JOIN member_levels l ON l.id=u.level_id WHERE u.id=?', req.session.uid);
    if (!u || !u.status) { req.session.uid = null; } else {
      res.locals.user = u; req.user = u;
      res.locals.cartCount = db.get('SELECT COALESCE(SUM(qty),0) n FROM cart WHERE user_id=?', u.id).n;
      // 未同意当前版本《用户协议》《隐私政策》的老用户:先完成一次性确认
      if (u.consent_version !== (svc.S('policy_version') || '1.1') && !/^\/(consent|privacy|terms|logout)(\/|$|\?)/.test(req.path)) {
        if (req.method === 'GET') return res.redirect('/consent?next=' + encodeURIComponent(req.originalUrl));
        return res.status(403).redirect('/consent');
      }
    }
  }
  res.locals.navCats = db.all('SELECT * FROM categories WHERE parent_id=0 AND status=1 ORDER BY sort,id');
  res.locals.hotWords = db.all('SELECT word FROM keywords WHERE is_hot=1 ORDER BY sort,hits DESC LIMIT 8').map(r => r.word);
  res.locals.filesOf = filesOf;
  const ab = db.get("SELECT id FROM articles WHERE category='about' LIMIT 1"); res.locals.aboutId = ab ? ab.id : 0;
  next();
});
require('./routes/shop')(app, { filesOf });

app.use((req, res) => res.status(404).page('shop/error', { title: '页面不存在', code: 404, message: '您访问的页面不存在或已下架' }));
app.use((err, req, res, next) => { console.error(err); if (res.headersSent) return next(err); res.status(500).send('<meta charset="utf-8"><h3>服务器开小差了:' + U.esc(err.message) + '</h3><a href="/">返回首页</a>'); });

setInterval(svc.sweep, 60000).unref(); svc.sweep();
// 供应商定时任务:待推送订单、状态轮询兜底(回调只推一次不重试)、价格/可售定时刷新
setInterval(() => jdvop.tick(), Math.max(5000, U.int(process.env.JDVOP_TICK_MS, 60000))).unref();
if (require.main === module) app.listen(PORT, () => { console.log(`\n🛒 韵农甄选(caige-mall)已启动:  前台 http://localhost:${PORT}/   后台 http://localhost:${PORT}/admin  (admin / admin123)\n`); setImmediate(() => { try { const rc = jdvop.recheckCategories(); if (rc.delisted) console.log(`[jdvop] 类目复检:自动下架 ${rc.delisted} 个不在允许范围的供应商商品`); } catch (e) { console.error('[jdvop] recheck', e); } jdvop.demoSeed().catch(e => console.error('[jdvop] demoSeed', e)); }); });
module.exports = app;
