const session = require('express-session');
const db = require('./db');
class SqliteStore extends session.Store {
  constructor(prefix) { super(); this.prefix = prefix; setInterval(() => { try { db.prepare('DELETE FROM sessions WHERE expire < ?').run(Date.now()); } catch (e) {} }, 600000).unref(); }
  get(sid, cb) { try { const r = db.prepare('SELECT sess FROM sessions WHERE sid=? AND expire>?').get(this.prefix + sid, Date.now()); cb(null, r ? JSON.parse(r.sess) : null); } catch (e) { cb(e); } }
  set(sid, sess, cb) { try { const exp = sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 86400000; db.prepare('INSERT OR REPLACE INTO sessions(sid,sess,expire) VALUES(?,?,?)').run(this.prefix + sid, JSON.stringify(sess), exp); cb && cb(null); } catch (e) { cb && cb(e); } }
  destroy(sid, cb) { try { db.prepare('DELETE FROM sessions WHERE sid=?').run(this.prefix + sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, sess, cb) { this.set(sid, sess, cb); }
}
module.exports = SqliteStore;
