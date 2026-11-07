'use strict';
// Isolated, synthetic data only. Run on a fresh DATA_DIR with DEMO_MODE=1.
if(process.env.DEMO_MODE!=='1'||!process.env.DATA_DIR)throw Error('Use DEMO_MODE=1 and a fresh isolated DATA_DIR');
const db=require('../lib/db');if(db.get('SELECT COUNT(*) n FROM users').n)throw Error('Refusing to test on an existing user database');const svc=require('../lib/svc');
let passed=0,failed=0,seq=0;const t='2026-11-07 12:00:00';
const ok=(v,label)=>{if(v){passed++;console.log('PASS '+label)}else{failed++;console.error('FAIL '+label)}};
const uid=(ref,extra={})=>svc.createUser({phone:'130'+String(++seq).padStart(8,'0'),password_hash:'synthetic-only',nickname:'inv-'+seq,referrerCode:ref?db.get('SELECT invite_code FROM users WHERE id=?',ref).invite_code:undefined,...extra});
const points=id=>db.get('SELECT points FROM users WHERE id=?',id).points;
const order=(user,opts={})=>Number(db.exec1("INSERT INTO orders(order_no,user_id,status,type,pay_amount,created_at,completed_at)VALUES(?,?,'completed',?,?,?,?)",'INV'+(++seq),user,opts.type||'normal',opts.pay==null?50:opts.pay,t,t).lastInsertRowid);
const reward=id=>db.get('SELECT * FROM invite_rewards WHERE invitee_id=? ORDER BY id DESC',id);
const schedule=id=>svc.inviteOnComplete({id});
const due=()=>db.exec1("UPDATE invite_rewards SET due_at='2000-01-01 00:00:00' WHERE status='pending'");
svc.setSetting('register_points','0');svc.setSetting('invite_points','288');svc.setSetting('invite_window_days','7');
const a=uid(),b=uid(a),c=uid(b);ok(points(a)===0&&points(b)===0,'registration never rewards inviter');
const co=order(c);schedule(co);schedule(co);ok(db.get('SELECT COUNT(*) n FROM invite_rewards WHERE invitee_id=?',c).n===1,'duplicate completion creates one pending reward');
ok(reward(c).referrer_id===b&&!reward(b),'C only schedules direct B, not ancestor A');
svc.settleInvites();ok(reward(c).status==='pending'&&points(b)===0,'observation window honored');
due();svc.settleInvites();svc.settleInvites();ok(points(b)===288&&points(a)===0&&points(c)===0,'A-B-C chain pays B only, once');
schedule(co);schedule(order(c));ok(db.get('SELECT COUNT(*) n FROM invite_rewards WHERE invitee_id=?',c).n===1,'repeat/second order cannot reward again');
schedule(order(b));due();svc.settleInvites();ok(points(a)===288&&points(b)===288,'A receives B order only; no C reward rolls upstream');
ok(db.get('SELECT COUNT(*) n FROM users WHERE referrer_id=?',a).n===1,'A direct-friend count excludes C');
const chronological=uid(a),early=order(chronological),later=order(chronological);db.exec1("UPDATE orders SET status='shipped' WHERE id=?",early);schedule(later);ok(!reward(chronological),'second order completed early cannot substitute for first paid order');db.exec1("UPDATE orders SET status='completed' WHERE id=?",early);schedule(early);ok(reward(chronological).order_id===early,'actual first order can reward after a later order completed');db.exec1("UPDATE invite_rewards SET status='cancelled' WHERE invitee_id=?",chronological);
const paidSequence=uid(a),createdFirst=order(paidSequence),paidFirst=order(paidSequence);db.exec1("UPDATE orders SET paid_at='2026-11-07 13:00:00' WHERE id=?",createdFirst);db.exec1("UPDATE orders SET paid_at='2026-11-07 12:00:00' WHERE id=?",paidFirst);schedule(createdFirst);ok(!reward(paidSequence),'creation order cannot override payment order');schedule(paidFirst);ok(reward(paidSequence).order_id===paidFirst,'first actual payment determines first order');db.exec1("UPDATE invite_rewards SET status='cancelled' WHERE invitee_id=?",paidSequence);
const z=uid(a);schedule(order(z,{pay:0}));ok(!reward(z),'zero-pay order excluded');schedule(order(z,{type:'points',pay:6}));ok(!reward(z),'points exchange with shipping payment excluded');schedule(order(z));ok(reward(z).status==='pending','first cash product order after zero/points order remains eligible');
const p=uid(a),po=order(p);schedule(po);svc.refundOrder(po,'synthetic partial',false,{amount:1,aftersale:true});ok(reward(p).status==='cancelled','partial refund cancels pending invitation reward');schedule(po);ok(db.get('SELECT COUNT(*) n FROM invite_rewards WHERE invitee_id=?',p).n===1,'partial refund cannot reschedule cancelled reward');
const f=uid(a),fo=order(f);schedule(fo);svc.refundOrder(fo,'synthetic full');ok(reward(f).status==='cancelled','full refund cancels pending reward');
const h=uid(a),ho=order(h);schedule(ho);const af=Number(db.exec1("INSERT INTO aftersales(order_id,user_id,type,status,created_at)VALUES(?,?,'refund','pending',?)",ho,h,t).lastInsertRowid);due();svc.settleInvites();ok(reward(h).status==='pending','ongoing aftersale holds due reward');db.exec1("UPDATE aftersales SET status='rejected' WHERE id=?",af);svc.settleInvites();ok(reward(h).status==='granted','rejected aftersale without refund releases due reward');
for(const state of ['approved_return','returned']){const u=uid(a),o=order(u);schedule(o);db.exec1("INSERT INTO aftersales(order_id,user_id,type,status,created_at)VALUES(?,?,'return',?,?)",o,u,state,t);due();svc.settleInvites();ok(reward(u).status==='pending',state+' aftersale also holds reward');}
const d=uid(a),od=order(d);schedule(od);db.exec1('UPDATE users SET status=0 WHERE id=?',d);due();svc.settleInvites();ok(reward(d).status==='cancelled','disabled invitee receives no reward');
const r=uid(),u=uid(r),ou=order(u);schedule(ou);db.exec1('UPDATE users SET status=0 WHERE id=?',r);due();svc.settleInvites();ok(reward(u).status==='cancelled','disabled inviter receives no reward');
const cc=uid(a),oc=order(cc);schedule(oc);db.exec1('UPDATE users SET cancelled_at=? WHERE id=?',t,cc);due();svc.settleInvites();ok(reward(cc).status==='cancelled','cancelled invitee receives no reward');
const m=uid(a),om=order(m);schedule(om);db.exec1('UPDATE users SET referrer_id=? WHERE id=?',b,m);due();svc.settleInvites();ok(reward(m).status==='cancelled','tampered/rebound relation cannot settle old reward');
const self=uid();db.exec1('UPDATE users SET referrer_id=id WHERE id=?',self);schedule(order(self));ok(!reward(self),'corrupt self-reference cannot earn reward');
const fake=uid(a),fakeO=order(fake);db.exec1("UPDATE orders SET status='shipped' WHERE id=?",fakeO);schedule(fakeO);ok(!reward(fake),'forged completion object cannot bypass stored order state');
const cnt=db.get('SELECT COUNT(*) n FROM users').n;
try{uid(undefined,{referrerCode:'NO-CODE'});ok(false,'invalid code rejected')}catch{ok(true,'invalid code rejected')}
try{uid(r);ok(false,'disabled inviter code rejected')}catch{ok(true,'disabled inviter code rejected')}
ok(db.get('SELECT COUNT(*) n FROM users').n===cnt,'invalid registration leaves no partial account');
try{uid(b,{phone:db.get('SELECT phone FROM users WHERE id=?',c).phone});ok(false,'duplicate phone rejected')}catch{ok(true,'duplicate phone rejected')}
ok(db.get('SELECT referrer_id FROM users WHERE id=?',c).referrer_id===b,'duplicate registration cannot rebind existing account');
const cp=Number(db.exec1("INSERT INTO coupons(name,status,total,per_limit,valid_days)VALUES('新人测试',1,100,1,30)").lastInsertRowid);svc.setSetting('invite_coupon_id',String(cp));const gifted=uid(a);ok(db.get('SELECT COUNT(*) n FROM user_coupons WHERE user_id=? AND coupon_id=?',gifted,cp).n===1,'same invite/newcomer coupon is not duplicated');
db.exec1("CREATE TRIGGER invite_test_coupon_fail BEFORE INSERT ON user_coupons BEGIN SELECT RAISE(ABORT,'synthetic gift failure'); END");const n0=db.get('SELECT COUNT(*) n FROM users').n;try{uid(a);ok(false,'registration transaction fails atomically')}catch{ok(true,'registration transaction fails atomically')}ok(db.get('SELECT COUNT(*) n FROM users').n===n0,'failed gift rolls back user and relationship');db.exec1('DROP TRIGGER invite_test_coupon_fail');
svc.setSetting('invite_points','377');const configurable=uid(a);schedule(order(configurable));ok(reward(configurable).points===377,'new reward snapshots backend-configured amount');svc.setSetting('invite_points','288');ok(reward(configurable).points===377,'later config changes do not rewrite existing reward');db.exec1("UPDATE invite_rewards SET status='cancelled' WHERE invitee_id=?",configurable);
(async()=>{
 const {spawn}=require('child_process');const v=uid(a),o=order(v);
 const wave=async code=>{const results=await Promise.all(Array.from({length:5},()=>new Promise(resolve=>{
   const cp=spawn(process.execPath,['-e',code],{cwd:require('path').resolve(__dirname,'..'),env:process.env,stdio:['ignore','ignore','pipe']});let err='';cp.stderr.on('data',d=>err+=d);cp.on('exit',c=>resolve({c,err}));
 })));ok(results.every(r=>r.c===0),'concurrent workers finish without lock errors');for(const r of results)if(r.c)console.error(r.err);};
 await wave(`require('./lib/svc').inviteOnComplete({id:${o}})`);
 ok(db.get('SELECT COUNT(*) n FROM invite_rewards WHERE invitee_id=?',v).n===1,'concurrent completion creates exactly one reward');
 due();const baseline=points(a);await wave("require('./lib/svc').settleInvites()");
 ok(points(a)===baseline+288&&reward(v).status==='granted','concurrent settlement grants exactly once');
 console.log(`invites: ${passed} passed, ${failed} failed`);process.exit(failed?1:0);
})().catch(e=>{console.error(e);process.exit(1)});
