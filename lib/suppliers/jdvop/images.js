// 供应商图片转存到本站(不盗链):public/uploads/supplier/<sha1>.<ext>;失败时使用设计稿占位图
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const U = require('../../util');
const DIR = path.join(__dirname, '..', '..', '..', 'public', 'uploads', 'supplier');
const MAX = 3 * 1024 * 1024;
const extOf = (ct, url) => /png/.test(ct || '') || /\.png(\?|$)/i.test(url) ? 'png' : /webp/.test(ct || '') || /\.webp(\?|$)/i.test(url) ? 'webp' : 'jpg';
/** 图片 URL:相对路径按文档拼 n12(无水印大图)域名;协议相对地址补 https */
function imageUrl(p) {
  p = String(p || '').trim(); if (!p) return '';
  if (/^https?:\/\//i.test(p)) return p.replace(/^http:/i, 'https:'); if (p.startsWith('//')) return 'https:' + p;
  return 'https://img13.360buyimg.com/n12/' + p.replace(/^\/+/, '');
}
async function store(url, { mode } = {}) {
  fs.mkdirSync(DIR, { recursive: true });
  const name = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20);
  for (const e of ['jpg', 'png', 'webp']) if (fs.existsSync(path.join(DIR, `${name}.${e}`))) return { ok: true, path: `/uploads/supplier/${name}.${e}` };
  try {
    let buf, ext;
    const local = mode === 'mock' ? require('./mock').localImage(url) : null; // mock:演示图在本地,模拟「下载」
    if (local) { buf = fs.readFileSync(local); ext = 'png'; }
    else {
      if (!/^https:\/\//i.test(url)) throw new Error('仅下载 https 图片');
      const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || !/^image\/(jpe?g|png|webp)/.test(ct)) throw new Error('HTTP ' + r.status + ' ' + ct);
      buf = Buffer.from(await r.arrayBuffer()); ext = extOf(ct, url);
    }
    if (!buf.length || buf.length > MAX) throw new Error('图片大小异常');
    fs.writeFileSync(path.join(DIR, `${name}.${ext}`), buf);
    return { ok: true, path: `/uploads/supplier/${name}.${ext}` };
  } catch (e) { return { ok: false, path: U.PLACEHOLDER, error: e.message }; }
}
module.exports = { store, imageUrl, DIR };
