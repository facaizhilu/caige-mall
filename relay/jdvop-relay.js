#!/usr/bin/env node
// 京东 VOP(来一票)接口中转服务 —— 部署在已加白名单 IP 的服务器上。
// · AppKey / AppSecret / 租户号只在本服务器的环境文件里,由中转在服务器端签名,永不离开服务器;
// · 商城 → 中转:HMAC-SHA256(共享令牌)+ 时间戳(±60s)+ 随机串防重放,常量时间比较;
// · 只放行商城用到的接口;会扣预存款/产生费用的下单、售后类接口默认禁止(RELAY_ALLOW_ORDERS=1 才放行);
// · 全局串行 + 1.1s 间隔(上游 QPS=1),排队上限;单 IP 限流;连续认证失败的 IP 临时封禁;
// · 日志只记录 时间/IP/接口名/上游返回码/耗时,不记录请求体、凭证、签名。
// 无第三方依赖(Node ≥ 18)。环境变量见 relay/README.md。
'use strict';
const http = require('http');
const path = require('path');
const { cfg, missing, INTERFACE_TYPE } = require(path.join(__dirname, '../lib/suppliers/jdvop/config'));
const { sign, nonce } = require(path.join(__dirname, '../lib/suppliers/jdvop/sign'));
const auth = require(path.join(__dirname, '../lib/suppliers/jdvop/relay-auth'));

const READ_CODES = new Set(['searchAllCategory', 'searchGoodsList', 'searchGoodsDetail', 'getSellPrice', 'getSimilarSkuInfoList',
  'checkSkuSaleList', 'checkAreaLimitList', 'checkArea', 'changeArea', 'searchAddress', 'querySkuFreight',
  'getOrderDetail', 'queryDeliveryInfo', 'queryOrderCancelEnable', 'queryAfs', 'queryAfsEnable', 'queryAfsLogisticsInfo']);
const ORDER_CODES = new Set(['submitOrder', 'confirmOrder', 'cancelOrder', 'updateSendInfo', 'createAfs', 'cancelAfs', 'confirmAfs']);

function settings(e = process.env) {
  return {
    port: parseInt(e.RELAY_PORT || '8080', 10), host: e.RELAY_HOST || '0.0.0.0', token: e.RELAY_TOKEN || '',
    allowOrders: e.RELAY_ALLOW_ORDERS === '1',
    allowIps: String(e.RELAY_ALLOW_IPS || '').split(',').map(s => s.trim()).filter(Boolean),
    minIntervalMs: Math.max(1000, parseInt(e.RELAY_MIN_INTERVAL_MS || '1100', 10) || 1100),
    queueMax: Math.max(1, parseInt(e.RELAY_QUEUE_MAX || '40', 10) || 40),
    perIpPerMin: Math.max(1, parseInt(e.RELAY_PER_IP_PER_MIN || '90', 10) || 90),
    windowMs: Math.max(5000, parseInt(e.RELAY_WINDOW_MS || '60000', 10) || 60000),
    maxBody: 64 * 1024
  };
}

function createRelay(opt = {}) {
  const S = { ...settings(), ...opt };
  const fetchImpl = opt.fetch || fetch, getCfg = opt.cfg || cfg;
  const nonces = auth.nonceCache(S.windowMs * 3);
  const log = opt.log || ((o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o })));
  // ---- 上游串行队列 ----
  let chain = Promise.resolve(), last = 0, queued = 0;
  function schedule(fn) {
    if (queued >= S.queueMax) return Promise.reject(Object.assign(new Error('busy'), { busy: true }));
    queued++;
    const p = chain.then(async () => { const wait = last + S.minIntervalMs - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait)); try { return await fn(); } finally { last = Date.now(); } });
    chain = p.catch(() => {}).finally(() => { queued--; });
    return p;
  }
  // ---- 单 IP 限流 + 认证失败封禁 ----
  const hits = new Map(), fails = new Map(), banned = new Map();
  function rateOk(ip, now = Date.now()) { const h = (hits.get(ip) || []).filter(t => now - t < 60000); h.push(now); hits.set(ip, h); if (hits.size > 5000) hits.clear(); return h.length <= S.perIpPerMin; }
  function noteFail(ip, now = Date.now()) { const f = (fails.get(ip) || []).filter(t => now - t < 600000); f.push(now); fails.set(ip, f); if (f.length >= 20) { banned.set(ip, now + 3600000); fails.delete(ip); } if (fails.size > 5000) fails.clear(); }
  const isBanned = (ip, now = Date.now()) => { const u = banned.get(ip); if (!u) return false; if (u < now) { banned.delete(ip); return false; } return true; };

  async function upstreamCall(interfaceCode, data) {
    const c = getCfg(), type = c.interfaceType || INTERFACE_TYPE, timestamp = String(Date.now()), nonceStr = nonce();
    const { signature } = sign({ timestamp, nonceStr, interfaceType: type, interfaceCode, appKey: c.appKey, appSecret: c.appSecret });
    const url = `${c.baseUrl}/api/v1/${encodeURIComponent(c.tenant)}/${encodeURIComponent(c.appKey)}/${encodeURIComponent(type)}`;
    const body = { interfaceCode, timestamp, nonceStr, signature, data: { type: c.apiType, ...(data || {}) } };
    const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(c.timeoutMs) });
    return r.text();
  }
  async function upstreamBalance() {
    const c = getCfg();
    const r = await fetchImpl(`${c.baseUrl}/api/v1/customerBalance/${encodeURIComponent(c.tenant)}?tenantCode=${encodeURIComponent(c.tenant)}`, { signal: AbortSignal.timeout(c.timeoutMs) });
    return r.text();
  }

  const send = (res, status, obj) => { const s = typeof obj === 'string' ? obj : JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(s); };
  const upCode = text => { try { const j = JSON.parse(text); return j && j.code; } catch (e) { return 'non-json'; } };

  const server = http.createServer((req, res) => {
    const t0 = Date.now(), ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const url = (req.url || '').split('?')[0];
    const done = (status, obj, extra = {}) => { send(res, status, obj); log({ ip, m: req.method, p: url, s: status, ms: Date.now() - t0, ...extra }); };
    if (req.method === 'GET' && url === '/health') return done(200, { ok: true });
    if (isBanned(ip)) return done(403, { code: 403, msg: 'forbidden' }, { r: 'banned' });
    if (S.allowIps.length && !S.allowIps.includes(ip)) return done(403, { code: 403, msg: 'forbidden' }, { r: 'ip' });
    const route = req.method === 'POST' && url === '/v1/call' ? 'call' : req.method === 'GET' && url === '/v1/balance' ? 'balance' : null;
    if (!route) return done(404, { code: 404, msg: 'not found' });
    if (!rateOk(ip)) return done(429, { code: 429, msg: '中转限流(QPS超限)' }, { r: 'rate' });
    const chunks = []; let size = 0, aborted = false;
    req.on('data', ch => { size += ch.length; if (size > S.maxBody) { aborted = true; done(413, { code: 413, msg: 'too large' }); req.destroy(); } else chunks.push(ch); });
    req.on('end', async () => {
      if (aborted) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      const hdr = { [auth.HEADERS.ts]: req.headers[auth.HEADERS.ts], [auth.HEADERS.nonce]: req.headers[auth.HEADERS.nonce], [auth.HEADERS.sig]: req.headers[auth.HEADERS.sig] };
      const v = auth.verify(S.token, req.method, url, raw, hdr, nonces, { windowMs: S.windowMs });
      if (!v.ok) { noteFail(ip); return done(401, { code: 401, msg: 'unauthorized' }, { r: v.reason }); }
      const miss = missing(getCfg());
      if (miss.length) return done(500, { code: 500, msg: '中转服务器未配置供应商凭证' }, { r: 'cfg' });
      let interfaceCode = 'customerBalance', data;
      if (route === 'call') {
        let j; try { j = JSON.parse(raw); } catch (e) { return done(400, { code: 400, msg: 'bad json' }); }
        interfaceCode = j && j.interfaceCode; data = j && j.data;
        if (typeof interfaceCode !== 'string' || !/^[A-Za-z]{2,40}$/.test(interfaceCode)) return done(400, { code: 400, msg: 'bad interfaceCode' });
        if (data != null && (typeof data !== 'object' || Array.isArray(data))) return done(400, { code: 400, msg: 'bad data' });
        if (ORDER_CODES.has(interfaceCode) && !S.allowOrders) return done(403, { code: 403, msg: `中转服务器未开放下单/售后类接口(${interfaceCode})` }, { c: interfaceCode, r: 'orders_disabled' });
        if (!READ_CODES.has(interfaceCode) && !ORDER_CODES.has(interfaceCode)) return done(403, { code: 403, msg: `接口未在中转白名单内(${interfaceCode})` }, { c: interfaceCode, r: 'not_allowed' });
      }
      try {
        const text = await schedule(() => route === 'call' ? upstreamCall(interfaceCode, data) : upstreamBalance());
        let out = text; try { JSON.parse(text); } catch (e) { out = { code: 502, msg: '上游返回非 JSON 响应' }; }
        done(200, out, { c: interfaceCode, up: upCode(text) });
      } catch (e) {
        if (e.busy) return done(503, { code: 503, msg: '中转排队已满(QPS超限)' }, { c: interfaceCode, r: 'busy' });
        done(502, { code: 502, msg: '中转访问上游失败:' + (e.name === 'TimeoutError' ? '超时' : '网络错误') }, { c: interfaceCode, r: 'upstream' });
      }
    });
  });
  server.headersTimeout = 15000; server.requestTimeout = 30000;
  return { server, settings: S };
}

if (require.main === module) {
  const { server, settings: S } = createRelay();
  if (!S.token || S.token.length < 32) { console.error('RELAY_TOKEN 未设置或过短(至少 32 字符),拒绝启动'); process.exit(1); }
  const miss = missing(cfg());
  if (miss.length) console.error('警告:供应商凭证不完整,缺少', miss.join(','));
  server.listen(S.port, S.host, () => console.log(`[jdvop-relay] listening ${S.host}:${S.port} orders=${S.allowOrders ? 'ENABLED' : 'disabled'} ipAllow=${S.allowIps.length || 'any'}`));
  const stop = () => server.close(() => process.exit(0)); process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
module.exports = { createRelay, READ_CODES, ORDER_CODES };
