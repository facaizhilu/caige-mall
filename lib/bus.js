// 客服消息推送层(与传输方式无关):业务代码只调用 pub();各传输适配器(当前为 SSE,见 lib/push-sse.js;
// 以后可加 WebSocket 适配器供小程序 wx.connectSocket 使用)通过 subscribe() 订阅。单实例部署,进程内实现。
const { EventEmitter } = require('events');
const bus = new EventEmitter(); bus.setMaxListeners(0);
/** 发布事件。type: msg | recall | edit | read | enter(会员进入客服页,仅推给后台,不落库);sender: user | staff | bot | system;extra 附加字段 */
function pub(uid, type, id, sender, extra) { try { bus.emit('chat', Object.assign({}, extra || {}, { uid: Number(uid), type, id: Number(id) || 0, sender: sender || '', ts: Date.now() })); } catch (e) {} }
// 会员进入客服页:同一会员 30 秒内只提醒一次(内存节流,不写数据库)
const lastEnter = new Map();
function enter(uid, name, from) { const k = Number(uid), t = Date.now(); if (t - (lastEnter.get(k) || 0) < 30000) return false; lastEnter.set(k, t); if (lastEnter.size > 5000) lastEnter.clear(); pub(k, 'enter', 0, 'user', { name: String(name || '').slice(0, 40), from: from || '' }); return true; }
/** 订阅事件:filter(evt) 为真时调用 cb(evt);返回取消订阅函数 */
function subscribe(filter, cb) { const on = e => { if (filter(e)) cb(e); }; bus.on('chat', on); return () => bus.off('chat', on); }
/** 订阅范围:会员只看自己的会话;客服(后台)看全部 */
const scopes = { member: uid => e => e.uid === Number(uid) && e.type !== 'enter', staff: () => () => true };
module.exports = { pub, subscribe, scopes, enter };
