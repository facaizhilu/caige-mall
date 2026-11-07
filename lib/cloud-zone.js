// A separate entitlement and session gate; never accepts another customer's phone.
const db=require('./db'),U=require('./util'),crypto=require('crypto');
const DENIED='您不是云商会员，暂无体验资格';
function member(uid){return db.get('SELECT id,phone,status,cancelled_at,cloud_zone_enabled,cloud_zone_version FROM users WHERE id=?',uid);}
function eligible(u){return !!(u&&u.status&&!u.cancelled_at&&u.cloud_zone_enabled===1);}
const phoneHash=p=>crypto.createHash('sha256').update(String(p)).digest('hex');
function allowed(uid,g){const u=member(uid);return eligible(u)&&!!g&&g.uid===u.id&&g.version===u.cloud_zone_version&&g.phoneHash===phoneHash(u.phone)&&g.expires>Date.now();}
function enter(uid,phone){
 return db.transaction(()=>{
  const stamp=Date.now(),r=db.get('SELECT * FROM cloud_zone_attempts WHERE user_id=?',uid);
  if(r&&r.reset_at>stamp&&r.attempts>=5)return {ok:false,msg:'尝试次数较多，请10分钟后再试'};
  db.exec1('INSERT INTO cloud_zone_attempts(user_id,attempts,reset_at)VALUES(?,1,?) ON CONFLICT(user_id) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END',uid,stamp+600000,stamp,stamp);
  if(!U.isPhone(phone))return {ok:false,msg:'请输入正确的手机号'};
  const u=member(uid);if(!u||phone!==u.phone)return {ok:false,msg:'请输入本账号绑定的手机号'};
  if(!eligible(u))return {ok:false,msg:DENIED};
  db.exec1('DELETE FROM cloud_zone_attempts WHERE user_id=?',uid);
  return {ok:true,gate:{uid:u.id,version:u.cloud_zone_version,phoneHash:phoneHash(u.phone),expires:stamp+1800000}};
 }).immediate();
}
function setMember(uid,on){
 const u=member(uid);if(!u||u.cancelled_at||!u.status)return false;
 db.exec1('UPDATE users SET cloud_zone_enabled=?,cloud_zone_version=cloud_zone_version+1 WHERE id=? AND status=1 AND cancelled_at IS NULL',on?1:0,uid);return true;
}
module.exports={member,eligible,allowed,enter,setMember,DENIED};
