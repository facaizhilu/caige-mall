// 客服会话:图片/订单卡片消息、图片校验(按文件头魔数)、180 天自动清理
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const db = require('./db'), U = require('./util');
const DIR = path.join(__dirname, '..', 'public', 'uploads', 'svc');
fs.mkdirSync(DIR, { recursive: true });
const MAX_BYTES = 5 * 1024 * 1024, MAX_FILES = 3, RETAIN_DAYS = 180;
// 按文件头识别真实类型(不信任客户端 mimetype / 扩展名)
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (/^GIF8[79]a$/.test(buf.slice(0, 6).toString('latin1'))) return 'gif';
  return null;
}
/** 校验并保存一组图片(Buffer[]);返回 { ok, urls } 或 { ok:false, msg } */
function saveImages(bufs) {
  if (!bufs.length) return { ok: false, msg: '请选择图片' };
  if (bufs.length > MAX_FILES) return { ok: false, msg: `一次最多发送 ${MAX_FILES} 张图片` };
  const exts = [];
  for (const b of bufs) { if (b.length > MAX_BYTES) return { ok: false, msg: '单张图片不能超过 5MB' }; const e = sniff(b); if (!e) return { ok: false, msg: '仅支持 JPG/PNG/WebP/GIF 图片' }; exts.push(e); }
  const urls = bufs.map((b, i) => { const f = Date.now() + '-' + crypto.randomBytes(6).toString('hex') + '.' + exts[i]; fs.writeFileSync(path.join(DIR, f), b); return '/uploads/svc/' + f; });
  return { ok: true, urls };
}
const fileOf = url => /^\/uploads\/svc\/[\w.-]+$/.test(url) ? path.join(DIR, path.basename(url)) : null;
function addMessage(uid, sender, kind, content, payload) {
  return db.prepare('INSERT INTO messages(user_id,sender,content,created_at,is_read,kind,payload) VALUES(?,?,?,?,0,?,?)').run(uid, sender, content, U.now(), kind, payload ? JSON.stringify(payload) : null).lastInsertRowid;
}
/** 会话最后一条消息超过 180 天:删除该会话中的图片文件并将消息标记为已清理 */
function purgeImages(nowTs = Date.now()) {
  const cutoff = U.fmtDate(new Date(nowTs - RETAIN_DAYS * 86400000)); let n = 0;
  for (const u of db.all("SELECT user_id FROM messages GROUP BY user_id HAVING MAX(created_at) < ? AND SUM(kind='image' AND payload IS NOT NULL) > 0", cutoff)) {
    for (const m of db.all("SELECT id, payload FROM messages WHERE user_id=? AND kind='image' AND payload IS NOT NULL", u.user_id)) {
      let imgs = []; try { imgs = JSON.parse(m.payload).images || []; } catch (e) {}
      for (const url of imgs) { const f = fileOf(url); if (f) { try { fs.unlinkSync(f); n++; } catch (e) {} } }
      db.exec1("UPDATE messages SET payload=NULL, content='[图片已按保存期限删除]' WHERE id=?", m.id);
    }
  }
  return n;
}
const parse = m => { let p = null; try { p = m.payload ? JSON.parse(m.payload) : null; } catch (e) {} return { ...m, kind: m.kind || 'text', data: p }; };
module.exports = { sniff, saveImages, addMessage, purgeImages, parse, MAX_BYTES, MAX_FILES, RETAIN_DAYS, DIR };
