'use strict';
// 活动专区「邀三位好友下单」:服务 + HTTP 测试。只在 run-ac.js 创建的全新临时演示库上运行。
if(process.env.DEMO_MODE!=='1'||!process.env.DATA_DIR||!process.env.AC_TEST_FRESH)throw Error('Requires isolated demo DATA_DIR from test/run-ac.js');
if(!require('fs').existsSync(require('path').join(process.env.DATA_DIR,'.ac-test-only')))throw Error('Missing fresh harness marker');
const db=require('../lib/db'),svc=require('../lib/svc'),AC=require('../lib/ac'),U=require('../lib/util'),bcrypt=require('bcryptjs'),B=require('../lib/banned');
const base=process.argv[2];if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base||''))throw Error('Local synthetic server required');
let passed=0,failed=0;const ok=(v,n,extra)=>{v?passed++:failed++;console.log((v?'PASS ':'FAIL ')+n+(v||extra===undefined?'':' :: '+extra));};
class C{constructor(){this.k={};this.t='';}async req(m,p,b){const headers={Cookie:Object.entries(this.k).map(([k,v])=>k+'='+v).join('; ')};let body;if(b){body=new URLSearchParams({_csrf:this.t,...b});headers['Content-Type']='application/x-www-form-urlencoded';}const r=await fetch(base+p,{method:m,headers,body,redirect:'manual'});for(const c of r.headers.getSetCookie()){const [kv]=c.split(';'),i=kv.indexOf('=');this.k[kv.slice(0,i)]=kv.slice(i+1);}const text=await r.text(),t=text.match(/name="csrf" content="([a-f0-9]+)"/)||text.match(/name="_csrf" value="([a-f0-9]+)"/);if(t)this.t=t[1];return {status:r.status,text,loc:r.headers.get('location'),type:r.headers.get('content-type')};}get(p){return this.req('GET',p);}post(p,b={}){return this.req('POST',p,b);}
 async login(ph){await this.get('/login');await this.post('/login',{phone:ph,password:'ac-test-only'});const c=await this.get('/consent');if(c.status===200)await this.post('/consent',{agree:'1',next:'/'});await this.get('/');}
 async admin(u,p){await this.get('/admin/login');await this.post('/admin/login',{username:u,password:p});await this.get('/admin/password');await this.post('/admin/password/skip');}}
const pw=bcrypt.hashSync('ac-test-only',4);let seq=0;
const user=(nick)=>{const phone='1308222'+String(++seq).padStart(4,'0');const id=Number(svc.createUser({phone,password_hash:pw,nickname:nick}));const n=seq;db.exec1('INSERT INTO addresses(user_id,name,phone,province,city,district,detail,is_default) VALUES(?,?,?,?,?,?,?,1)',id,nick,'1397777'+String(n).padStart(4,'0'),'海南省','海口市','龙华区','测试路'+n+'号');return {id,phone,nick};};
const P=db.get("SELECT p.id, s.id sk, s.sku_id FROM products p JOIN seckills s ON s.product_id=p.id WHERE p.name='【测试】红富士苹果'");
const addrOf=uid=>db.get('SELECT * FROM addresses WHERE user_id=? ORDER BY id LIMIT 1',uid);
const buy=(uid,{code,qty=1,addr,payer,couponId}={})=>{const r=svc.createOrder(uid,{items:[{sku_id:P.sku_id,qty}],promo:{type:'seckill',id:P.sk},address:addr||addrOf(uid),acCode:code,couponId});if(!r.ok)throw Error('order: '+r.msg);if(payer)db.exec1('UPDATE orders SET payer_id=? WHERE id=?',payer,r.id);const p=svc.payOrder(r.id,uid,'wechat');if(!p.ok)throw Error('pay: '+p.msg);return r.id;};
const camp=oid=>db.get('SELECT * FROM ac_campaigns WHERE order_id=?',oid);
const frow=oid=>db.get('SELECT * FROM ac_friends WHERE order_id=?',oid);
const msgs=(uid,like)=>db.get("SELECT COUNT(*) n FROM messages WHERE user_id=? AND sender='system' AND content LIKE ?",uid,'%'+like+'%').n;
(async()=>{
 ok(!!P,'DEMO_MODE seeds 自营 ¥1 test product in 活动专区');
 const tp=db.get('SELECT * FROM products WHERE id=?',P.id);ok(tp.activity_only===1&&!tp.supplier&&tp.price===1&&tp.market_price==null&&tp.ship_from.includes('自营')&&tp.aftersale_text,'test product: activity-only, no supplier, no strikethrough price, after-sale rule');
 ok(B.checkProduct(tp,[]).length===0,'test product passes banned-word check');
 const cfg=AC.cfg();ok(cfg.title==='好物一起买，邀三位好友下单，你这单我们请'&&cfg.note==='仅限活动专区商品，好友下单付款即计入，详见活动规则'&&cfg.subtitle===''&&cfg.cap===100&&cfg.days===30&&cfg.couponDays===30,'default copy and settings');
 ok(!/免单|奖励|返/.test(cfg.shareTitle)&&B.check({a:cfg.title,b:cfg.note,c:cfg.shareTitle}).length===0&&!/越分享|全额返还/.test(cfg.title+cfg.note),'copy passes banned-word check; share title has no reward wording');
 ok(svc.S('policy_version')==='1.2','privacy policy version bumped to 1.2');
 const g=new C();let r=await g.get('/privacy');ok(r.text.includes('邀请活动风控信息（收货地址、收货手机号、微信支付付款人标识、活动订单状态）')&&r.text.includes('计算邀请好友积分奖励及活动专区邀请免单专享券')&&r.text.includes('180 天删除或匿名化')&&!r.text.includes('计算邀请好友首单积分奖励'),'privacy policy rows updated');
 r=await g.get('/activity');ok(r.text.includes('id="acBanner"')&&r.text.includes('#EEF8F2')&&r.text.includes('font-size:17px')&&r.text.includes('<a href="/activity/rules">活动规则</a>')&&r.text.includes('① 买活动专区商品')&&r.text.includes('先选一件活动专区商品下单，就能开始邀请')&&!/限时|倒计时/.test(r.text.slice(r.text.indexOf('id="acBanner"'),r.text.indexOf('acList'))),'guest banner + 3 steps + toast for no-order users');
 r=await g.get('/activity/rules');{const R=AC.rules(),t=r.text;ok(R.items.length===11,'rules: 11 items');
  const need=[['活动对象','不限新老用户'],['参与方式','我的免单'],['好友计入','不限金额'],['计入限制','好友的一笔订单只计入一位邀请人'],['免单券发放','单张最高 ¥100.00'],['专享券使用','30 天内有效，仅限活动专区商品使用，不与其他优惠叠加，不可兑换现金'],['退款处理','冻结'],['风控审核','3 个工作日内出结果'],['个人信息','默认头像和打码手机号'],['进度通知','站内消息'],['活动咨询','「我的」→「在线客服」']];
  need.forEach(([h,w],n)=>ok(t.includes('<li><b>'+h+'：</b>')&&R.items[n][0]===h&&R.items[n][1].includes(w)&&t.includes(w),'rules item '+(n+1)+' '+h+' contains 「'+w+'」'));
  ok(t.includes('活动主办：海南韵农科技有限公司'),'rules body names 活动主办');ok(!t.slice(t.indexOf('ac-rules'),t.indexOf('返回活动专区')).includes('待公布'),'no 待公布 placeholder in rules');
  svc.setSetting('service_phone','0898-12345678');ok(AC.rules().items[10][1].includes('0898-12345678'),'configured customer-service phone used when set');svc.setSetting('service_phone','');}

 const I=user('邀请人甲'),F1=user('友一'),F2=user('友二'),F3=user('友三'),F4=user('友四'),F5=user('友五'),F6=user('友六');
 // non-activity order with code is excluded
 const io=buy(I.id,{qty:3});const c=camp(io);
 ok(c&&c.status==='open'&&c.user_id===I.id&&c.expire_at.slice(0,10)===U.fmtDate(new Date(Date.now()+30*864e5)).slice(0,10),'paid activity order creates open campaign with 30-day deadline');
 const normalSku=db.get("SELECT s.id FROM skus s JOIN products p ON p.id=s.product_id WHERE p.activity_only=0 AND p.status=1 AND p.supplier IS NULL AND s.stock>5 AND p.cloud_zone=0 AND p.id NOT IN (SELECT product_id FROM seckills) LIMIT 1");
 const no=svc.createOrder(F6.id,{items:[{sku_id:normalSku.id,qty:1}],address:addrOf(F6.id),acCode:c.code,no7Confirmed:true});svc.payOrder(no.id,F6.id,'wechat');
 ok(!db.get('SELECT ac_campaign_id FROM orders WHERE id=?',no.id).ac_campaign_id&&!frow(no.id)&&!camp(no.id),'non-activity product order neither counts nor creates a campaign');
 // HTTP attribution: link sets cookie, friend fills nothing
 const f1=new C();await f1.login(F1.phone);r=await f1.get('/activity?ac='+c.code);ok(f1.k.ac===c.code,'invite link stores code automatically');
 r=await f1.post('/order/create',{sku_id:P.sku_id,qty:1,promo_type:'activity',promo_id:P.sk,address_id:addrOf(F1.id).id,no7_confirm:'1'});const o1=+((r.loc||'').match(/order\/(\d+)/)||[])[1];
 ok(o1&&db.get('SELECT ac_campaign_id FROM orders WHERE id=?',o1).ac_campaign_id===c.id&&!frow(o1),'friend order attributed via cookie; unpaid order not shown yet');
 svc.payOrder(o1,F1.id,'wechat');ok(frow(o1).state==='counted'&&AC.progress(c.id).counted===1,'friend counts immediately on payment');
 ok(msgs(I.id,'已计入 1/3')===1&&camp(io).unread===1,'inviter notified on count; unread flag set');
 r=await f1.get('/order/'+o1);ok(r.text.includes('已为好友助力')&&!r.text.slice(r.text.indexOf('已为好友助力')-80,r.text.indexOf('已为好友助力')+20).includes('免单'),'friend sees 已为好友助力 note without reward wording');
 // self and duplicate
 const so=buy(I.id,{code:c.code});ok(frow(so).state==='void'&&frow(so).reason==='本人下单不计入'&&msgs(I.id,'本人下单不计入')===1,'self order not counted, notified with reason');
 const d1=buy(F1.id,{code:c.code});ok(frow(d1).state==='void'&&frow(d1).reason==='该好友已计入过','same friend counts once');
 // fraud → review → admin approve
 const fo=buy(F2.id,{code:c.code,addr:{...addrOf(F2.id),phone:db.get('SELECT phone FROM orders WHERE id=?',io).phone}});
 ok(frow(fo).state==='review'&&/收货手机号与邀请人相同/.test(frow(fo).flag)&&msgs(I.id,'人工审核')===1,'receiver phone match → manual review + notification');
 const fa=buy(F5.id,{code:c.code,addr:{...addrOf(I.id),name:'x',phone:'13966660000'}});ok(frow(fa).state==='review'&&/收货地址与邀请人相同/.test(frow(fa).flag),'address match → review');
 const fp=buy(F6.id,{code:c.code,payer:'openid-same'});db.exec1("UPDATE orders SET payer_id='openid-same' WHERE id=?",io);ok(AC.fraudFlag(c,db.get('SELECT * FROM orders WHERE id=?',fp)).includes('付款人与邀请人相同'),'payer id match detected');
 db.exec1("UPDATE ac_friends SET state='void',reason='测试' WHERE order_id=?",fp);
 const adm=new C();await adm.admin('admin','admin123');
 r=await adm.get('/admin/ac?status=review');ok(r.status===200&&r.text.includes('待人工审核（2）'),'admin review queue lists flagged friends');
 r=await adm.post('/admin/ac/friend/'+frow(fo).id+'/review',{approve:'1'});ok(frow(fo).state==='counted'&&msgs(I.id,'审核通过，已计入 2/3')===1&&db.get("SELECT 1 FROM admin_logs WHERE action='邀好友免单审核通过'"),'admin approve counts friend, notifies, logs');
 r=await adm.post('/admin/ac/friend/'+frow(fa).id+'/review',{approve:'0'});ok(frow(fa).state==='void'&&frow(fa).reason==='审核未通过，未计入'&&msgs(I.id,'审核未通过')===1,'admin reject → 未计入 with reason');
 // refund before 3/3
 const o3=buy(F3.id,{code:c.code});ok(camp(io).status==='done','3 paid friends → done');
 // undo for refund-before test: use a second campaign
 const I2=user('邀请人乙'),io2=buy(I2.id,{qty:2}),c2=camp(io2);
 const a1=buy(F1.id,{code:c2.code});const a2=buy(F2.id,{code:c2.code});ok(AC.progress(c2.id).counted===2,'second inviter at 2/3');
 svc.refundOrder(a2,'商家取消:测试');ok(frow(a2).state==='void'&&frow(a2).reason==='好友已退款，未计入'&&AC.progress(c2.id).counted===1&&msgs(I2.id,'已退款，未计入，当前 1/3')===1,'friend refund before 3/3 → 未计入, progress drops, notified');
 const cc=db.get('SELECT * FROM ac_campaigns WHERE id=?',c.id),uc=db.get('SELECT uc.*,c.amount,c.scope FROM user_coupons uc JOIN coupons c ON c.id=uc.coupon_id WHERE uc.id=?',cc.user_coupon_id);
 ok(uc&&uc.amount===3&&uc.scope==='activity'&&cc.reward_amount===3&&msgs(I.id,'你这单的免单券已到账')===1&&cc.popup===1,'coupon = paid amount (¥3), activity-only, notified + popup');
 ok(uc.expire_at.slice(0,10)===U.fmtDate(new Date(Date.now()+30*864e5)).slice(0,10),'coupon valid 30 days');
 // counts agree across pages (inviter I)
 const ic=new C();await ic.login(I.phone);
 r=await ic.get('/me');ok(r.text.includes('id="acEntry"')&&/acEntry[^]*?qbadge/.test(r.text.slice(r.text.indexOf('acEntry'),r.text.indexOf('acEntry')+400)),'red dot on 我的免单 when unread');
 r=await ic.get('/me/free');const free=r.text;ok(free.includes('你这单的免单券已到账')&&free.includes('已计入 <b style="color:#2E9E5B">3</b>/3'),'popup on reaching 3; 我的免单 shows 3/3');
 ok(free.includes(U.maskPhone(F1.phone))&&free.includes('mark-green.svg')&&!free.includes('友**')&&!free.includes('友一')&&!free.includes(F1.phone)&&!free.includes(db.get('SELECT order_no FROM orders WHERE id=?',o1).order_no)&&!free.includes('测试路'),'inviter page shows default avatar + masked phone only: no nickname, full phone, friend order no. or address');
 ok(db.get("SELECT COUNT(*) n FROM messages WHERE user_id=? AND sender='system' AND content LIKE ?",I.id,'%好友 '+U.maskPhone(F1.phone)+' 已下单付款%').n>=1&&!db.get("SELECT 1 FROM messages WHERE user_id=? AND content LIKE '%活动专区邀请%' AND (content LIKE '%友一%' OR content LIKE '%友**%' OR content LIKE ?)",I.id,'%'+F1.phone+'%'),'inviter messages use masked phone, never nickname or full phone');
 ok(AC.progress(c.id).slots.every(x=>x.k==='empty'||/^\d{3}\*{4}\d{4}$/.test(x.who)),'progress slots carry masked phone');
 ok(free.includes('本人下单不计入')&&free.includes('该好友已计入过')&&free.includes('审核未通过，未计入'),'progress lists every attributed order incl. not-counted with reasons');
 r=await ic.get('/me/free');ok(!r.text.includes('id="acPop"'),'popup shown only once');r=await ic.get('/me');ok(!/acEntry[^]*?qbadge/.test(r.text.slice(r.text.indexOf('acEntry'),r.text.indexOf('acEntry')+300)),'red dot cleared after viewing');
 const i2c=new C();await i2c.login(I2.phone);
 const p2=AC.progress(c2.id);r=await i2c.get('/activity');const bn=(r.text.match(/已有 (\d+) 位好友计入，还差 (\d+) 位/)||[]);
 const od=await i2c.get('/order/'+io2),fr=await i2c.get('/me/free');
 const ad=await adm.get('/admin/ac?q='+db.get('SELECT order_no FROM orders WHERE id=?',io2).order_no),au=await adm.get('/admin/ac/user/'+I2.id);
 ok(+bn[1]===p2.counted&&+bn[2]===p2.left&&od.text.includes('已计入 <b style="color:#2E9E5B">'+p2.counted+'</b>/3')&&fr.text.includes('已计入 <b style="color:#2E9E5B">'+p2.counted+'</b>/3')&&ad.text.includes('<b class="ac-prog">'+p2.counted+'/3</b>')&&au.text.includes('进度 '+p2.counted+'/3')&&au.text.includes('<dd id="sumCounted">'+p2.counted+'</dd>'),'banner, order card, 我的免单, admin list and admin user page show identical counts',[bn[1],p2.counted].join());
 ok(od.text.includes('id="acCard"')&&od.text.includes('去邀请')&&(od.text.match(/class="ac-slot /g)||[]).length===3,'order detail shows invite card with 3 slots');
 ok(au.text.includes('<dd id="sumInvited">2</dd>')&&au.text.includes(U.maskPhone(F1.phone))&&!au.text.includes('>'+F1.phone+'<')&&au.text.includes('好友已退款，未计入'),'admin detail: summary, masked phones, reasons');
 r=await adm.post('/admin/ac/user/'+I2.id+'/reveal/'+frow(a1).id);ok(JSON.parse(r.text).phone===F1.phone&&db.get("SELECT 1 FROM admin_logs WHERE action='显示好友完整手机号'"),'显示 reveals full phone and logs');
 r=await adm.get('/admin/ac/user/'+I2.id+'/export');ok(/text\/csv/.test(r.type)&&r.text.includes(U.maskPhone(F1.phone))&&!r.text.includes(F1.phone)&&db.get("SELECT 1 FROM admin_logs WHERE action='导出活动邀请详情'")&&db.get("SELECT 1 FROM admin_logs WHERE action='查看活动邀请详情'"),'CSV export masked; view/export logged');
 r=await adm.get('/admin/members');ok(r.text.includes('/admin/ac/user/')&&r.text.includes('活动邀请详情'),'member list has 活动邀请详情 button');
 const opsRole=db.get("SELECT role_id FROM admins WHERE username='ops'").role_id;const ops=new C();await ops.admin('ops','ops123456');
 r=await ops.get('/admin/ac/user/'+I2.id);ok(r.status===403,'role without member perm cannot open invite detail');r=await ops.get('/admin/ac');ok(r.status===200,'marketing role can open campaign admin');
 const kf=new C();await kf.admin('kefu','kefu123456');r=await kf.get('/admin/ac');ok(r.status===403,'role without marketing perm cannot open campaign admin');
 // coupon usage rules
 const qa=svc.quote(I.id,{items:[{sku_id:P.sku_id,qty:5}],promo:{type:'seckill',id:P.sk},address:addrOf(I.id),couponId:uc.id});ok(qa.couponDiscount===3,'专享券 usable on activity order');
 const qn=svc.quote(I.id,{items:[{sku_id:normalSku.id,qty:1}],address:addrOf(I.id),couponId:uc.id});ok(qn.couponDiscount===0&&qn.couponNote.includes('仅限活动专区'),'专享券 not usable on normal products');
 r=await g.get('/coupons');ok(!r.text.includes('活动专区专享券'),'专享券 never listed in coupon center');
 r=await ic.post('/checkout',{sku_id:P.sku_id,qty:1,promo_type:'activity',promo_id:P.sk,no7_ok:'1'});ok(r.text.includes('活动专区专享券')&&!r.text.includes('name="use_points"'),'checkout offers 专享券 for activity order, no points');
 // friend refund after coupon issued (unused) → revoke
 const agree=async(cl,oid,n,label)=>{const a=await cl.get('/activity'),b=await cl.get('/me/free'),o=await cl.get('/order/'+oid);const cnt=x=>(x.match(/已计入 <b style="color:#2E9E5B">(\d+)<\/b>\/3/)||[])[1];const lit=x=>(x.match(/class="ac-slot ok"/g)||[]).length;const ban=a.text.slice(a.text.indexOf('id="acBanner"'),a.text.indexOf('class="ac-steps"'));return {a:a.text,ban,b:b.text,o:o.text,ok:+cnt(b.text.slice(b.text.indexOf('id="ac'+camp(oid).id+'"')))===n&&+cnt(o.text)===n&&lit(ban)===n};};
 db.exec1("UPDATE ac_campaigns SET status='expired' WHERE user_id=? AND order_id<>?",I.id,io); // 只保留本单,便于核对横幅(横幅优先显示邀请中的单)
 let s0=await agree(ic,io,3,'done');ok(s0.ok&&s0.ban.includes('免单券已到账')&&s0.ban.includes('href="/me/coupons">去使用')&&!s0.ban.includes('先选一件'),'completed: banner 3 lit slots + 免单券已到账 + 去使用; matches order card and 我的免单');
 svc.refundOrder(o3,'商家取消:测试');ok(db.get('SELECT status FROM user_coupons WHERE id=?',uc.id).status==='frozen'&&camp(io).status==='frozen'&&AC.progress(c.id).counted===2&&msgs(I.id,'免单券已冻结，再邀 1 位')===1,'friend refund after issue: unused coupon frozen, 2/3, notified');
 ok(svc.quote(I.id,{items:[{sku_id:P.sku_id,qty:1}],promo:{type:'seckill',id:P.sk},address:addrOf(I.id),couponId:uc.id}).couponDiscount===0,'frozen coupon cannot be used');
 s0=await agree(ic,io,2,'frozen');ok(s0.ok&&s0.ban.includes('免单券已冻结，再邀 1 位好友下单即可恢复')&&s0.ban.includes('>去邀请</a>')&&s0.o.includes('免单券已冻结')&&s0.b.includes('免单券已冻结')&&!s0.ban.includes('先选一件'),'frozen: banner/order card/我的免单 agree (2 lit) with frozen note and 去邀请');
 r=await ic.get('/me/coupons');ok(r.text.includes('已冻结'),'我的优惠券 shows frozen coupon');
 const o4=buy(F4.id,{code:c.code});const c3=camp(io);ok(c3.status==='done'&&c3.user_coupon_id===uc.id&&db.get('SELECT status FROM user_coupons WHERE id=?',uc.id).status==='unused'&&msgs(I.id,'免单券已恢复')===1,'refill to 3/3 → frozen coupon restored + notified');
 s0=await agree(ic,io,3,'done2');ok(s0.ok&&s0.ban.includes('去使用'),'restored: all pages agree at 3/3');
 const use=buy(I.id,{couponId:c3.user_coupon_id});ok(db.get('SELECT status FROM user_coupons WHERE id=?',c3.user_coupon_id).status==='used','inviter used coupon');ok(!camp(use),'order paid with 专享券 does not start a new round');
 r=await ic.get('/activity');{const ban=r.text.slice(r.text.indexOf('id="acBanner"'),r.text.indexOf('class="ac-steps"'));ok(!ban.includes('去使用')&&ban.includes('再买一件活动专区商品，就能开始新一轮邀请')&&!ban.includes('先选一件')&&!ban.includes('class="ac-slot'),'coupon used: banner reverts to initial 去邀请, prompts next round (not 先下单)');}
 ok(AC.banner(I.id).mode!=='none','user with qualifying orders never gets the 先下单 mode');
 svc.refundOrder(o4,'商家取消:测试');ok(db.get('SELECT status FROM user_coupons WHERE id=?',c3.user_coupon_id).status==='used'&&/已使用/.test(camp(io).review_note)&&msgs(I.id,'平台将人工审核')===1,'friend refund after coupon used → no clawback, flagged for admin review');
 r=await adm.get('/admin/ac?status=review');ok(r.text.includes('标记已处理'),'admin sees used-coupon review note');
 // inviter refund → void
 svc.refundOrder(io2,'商家取消:测试');ok(camp(io2).status==='void'&&msgs(I2.id,'本单邀请活动已失效')===1,'inviter refund voids campaign + notification');
 const late=buy(F3.id,{code:c2.code});ok(!frow(late)&&AC.progress(c2.id).counted===1,'orders on void campaign never count');
 // 30-day expiry
 const I3=user('邀请人丙'),io3=buy(I3.id),c4=camp(io3);buy(F1.id,{code:c4.code});
 db.exec1("UPDATE ac_campaigns SET expire_at='2000-01-01 00:00:00' WHERE id=?",c4.id);const lo=buy(F2.id,{code:c4.code});
 ok(frow(lo).state==='void'&&frow(lo).reason==='已超过30天','friend order after 30 days → 已超过30天');
 svc.sweep();ok(camp(io3).status==='expired'&&msgs(I3.id,'本单邀请活动已结束（已计入 1/3）')===1,'expired campaign closed by sweep + notification');
 // cross-campaign dedupe for same inviter
 const io5=buy(I3.id),c5=camp(io5),dup=buy(F1.id,{code:c5.code});ok(frow(dup).reason==='该好友已计入过','friend counted for an inviter cannot count again in that inviter’s other order');
 // cap
 svc.setSetting('ac_cap','2');const I4=user('邀请人丁'),io6=buy(I4.id,{qty:5}),c6=camp(io6);buy(F1.id,{code:c6.code});buy(F2.id,{code:c6.code});buy(F3.id,{code:c6.code});ok(camp(io6).reward_amount===2,'coupon capped at configured cap');svc.setSetting('ac_cap','100');
 // settings validation
 r=await adm.post('/admin/ac/settings',{ac_on:'1',ac_title:cfg.title,ac_subtitle:'',ac_note:cfg.note,ac_share_title:'邀好友免单',ac_days:'30',ac_cap:'100',ac_coupon_days:'30',ac_review_days:'3'});ok(db.get("SELECT value FROM settings WHERE key='ac_share_title'").value===cfg.shareTitle,'share title with 免单 rejected');
 r=await adm.post('/admin/ac/settings',{ac_on:'1',ac_title:cfg.title,ac_subtitle:'一起逛逛活动专区',ac_note:cfg.note,ac_share_title:cfg.shareTitle,ac_days:'30',ac_cap:'88',ac_coupon_days:'30',ac_review_days:'3'});ok(db.get("SELECT value FROM settings WHERE key='ac_cap'").value==='88'&&db.get("SELECT 1 FROM admin_logs WHERE action='修改邀好友免单设置'"),'valid settings saved and logged');
 r=await g.get('/activity');ok(r.text.includes('<div class="acb-sub">一起逛逛活动专区</div>'),'optional subtitle shown when set');r=await g.get('/activity/rules');ok(r.text.includes('¥88.00'),'rules page follows cap setting');
 r=await adm.post('/admin/ac/settings',{ac_on:'1',ac_title:cfg.title,ac_subtitle:'',ac_note:cfg.note,ac_share_title:cfg.shareTitle,ac_days:'30',ac_cap:'100',ac_coupon_days:'30',ac_review_days:'3'});
 r=await g.get('/activity');ok(!r.text.includes('class="acb-sub"'),'empty subtitle hidden');
 // poster
 r=await ic.get('/me/free/'+c.id+'/poster');ok(r.status===200&&r.text.includes('qrcode.js')&&r.text.includes(c.code)&&!r.text.slice(r.text.indexOf('<canvas')).includes('免单'),'poster page with QR, no 免单 wording');
 r=await f1.get('/me/free/'+c.id+'/poster');ok(r.status===404,'cannot open another user’s poster');
 // old user must re-consent after policy bump
 const old=user('老用户');db.exec1("UPDATE users SET consent_at='2026-10-01 00:00:00', consent_version='1.1' WHERE id=?",old.id);const oc=new C();await oc.get('/login');await oc.post('/login',{phone:old.phone,password:'ac-test-only'});r=await oc.get('/me');ok(r.status===302&&(r.loc||'').startsWith('/consent'),'policy bump forces re-confirmation');
 console.log(`ac: ${passed} passed, ${failed} failed`);process.exit(failed?1:0);
})().catch(e=>{console.error(e);console.log(`ac: ${passed} passed, ${failed+1} failed`);process.exit(1)});
