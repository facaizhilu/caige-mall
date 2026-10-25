// 客服消息推送层(与传输方式无关):业务代码只调用 pub();各传输适配器(当前为 SSE,见 lib/push-sse.js;
// 以后可加 WebSocket 适配器供小程序 wx.connectSocket 使用)通过 subscribe() 订阅。单实例部署,进程内实现。
const { EventEmitter } = require('events');
const bus = new EventEmitter(); bus.setMaxListeners(0);
/** 发布事件。type: msg | recall | edit | read;sender: user | staff | bot | system */
function pub(uid, type, id, sender) { try { bus.emit('chat', { uid: Number(uid), type, id: Number(id) || 0, sender: sender || '', ts: Date.now() }); } catch (e) {} }
/** 订阅事件:filter(evt) 为真时调用 cb(evt);返回取消订阅函数 */
function subscribe(filter, cb) { const on = e => { if (filter(e)) cb(e); }; bus.on('chat', on); return () => bus.off('chat', on); }
/** 订阅范围:会员只看自己的会话;客服(后台)看全部 */
const scopes = { member: uid => e => e.uid === Number(uid), staff: () => () => true };
module.exports = { pub, subscribe, scopes };
