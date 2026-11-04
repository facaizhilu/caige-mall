// 商城 ↔ 白名单服务器中转(relay)之间的请求认证:HMAC-SHA256 + 时间戳 + 随机串(防重放)。
// 共享令牌本身从不在网络上传输;中转服务器校验签名、时间窗(默认 ±60 秒)与随机串唯一性。
// 规范串:METHOD \n PATH \n 时间戳(毫秒) \n 随机串 \n SHA256(body) 十六进制
const crypto = require('crypto');
const H = { ts: 'x-relay-ts', nonce: 'x-relay-nonce', sig: 'x-relay-sig' };
const sha256 = s => crypto.createHash('sha256').update(s || '').digest('hex');
function canonical(method, path, ts, nonce, body) { return [String(method).toUpperCase(), path, String(ts), String(nonce), sha256(body)].join('\n'); }
function hmac(token, str) { return crypto.createHmac('sha256', String(token)).update(str).digest('hex'); }
/** 生成请求头(客户端用) */
function signHeaders(token, method, path, body = '', now = Date.now(), nonce = crypto.randomBytes(16).toString('hex')) {
  return { 'X-Relay-Ts': String(now), 'X-Relay-Nonce': nonce, 'X-Relay-Sig': hmac(token, canonical(method, path, now, nonce, body)) };
}
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
/** 防重放缓存:同一随机串在时间窗内只能用一次 */
function nonceCache(ttlMs = 180000, max = 50000) {
  const m = new Map();
  return { seen(n, now = Date.now()) {
    for (const [k, t] of m) { if (t > now && m.size <= max) break; m.delete(k); } // Map 按插入顺序:先清理过期/超量
    if (m.has(n)) return true; m.set(n, now + ttlMs); return false;
  }, size: () => m.size };
}
/** 校验(中转服务器用)。headers 为小写键;返回 { ok, reason } */
function verify(token, method, path, body, headers, cache, { now = Date.now(), windowMs = 60000 } = {}) {
  if (!token || String(token).length < 32) return { ok: false, reason: 'server_token_missing' };
  const ts = headers[H.ts], nonce = headers[H.nonce], sig = headers[H.sig];
  if (!ts || !nonce || !sig) return { ok: false, reason: 'missing_headers' };
  if (!/^\d{13}$/.test(ts) || Math.abs(now - Number(ts)) > windowMs) return { ok: false, reason: 'stale_ts' };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce) || !/^[0-9a-f]{64}$/.test(sig)) return { ok: false, reason: 'bad_format' };
  if (!safeEq(sig, hmac(token, canonical(method, path, ts, nonce, body)))) return { ok: false, reason: 'bad_sig' };
  if (cache && cache.seen(nonce, now)) return { ok: false, reason: 'replay' };
  return { ok: true };
}
module.exports = { signHeaders, verify, nonceCache, canonical, safeEq, HEADERS: H };
