// 京东货盘(来一票)接口客户端:签名、全局限流、调用日志(脱敏)、mock/live 切换
const db = require('../../db');
const { cfg, missing, INTERFACE_TYPE } = require('./config');
const { sign, nonce } = require('./sign');
const limiter = require('./limiter');
const relayAuth = require('./relay-auth');
const mock = require('./mock');

class SupplierError extends Error {
  constructor(msg, { code, interfaceCode, network } = {}) { super(msg); this.code = code; this.interfaceCode = interfaceCode; this.network = !!network; }
}
// ---- 日志脱敏:签名、AppKey、手机号、姓名、详细地址 ----
const SECRET_KEYS = /^(signature|appKey|appSecret|tenantAppId|password|token)$/i;
const PII_KEYS = /^(consigneeMobile|phone|cpin|consigneeName|name|consigneeAddress|afsDetail|backDetail|addressDetailStr)$/;
function redact(v, key) {
  if (v == null) return v;
  if (key && SECRET_KEYS.test(key)) return '***';
  if (key && PII_KEYS.test(key) && typeof v === 'string') return /^1\d{10}$/.test(v) ? v.slice(0, 3) + '****' + v.slice(-4) : v.slice(0, 1) + '***';
  if (Array.isArray(v)) return v.map(x => redact(x));
  if (typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = redact(x, k); return o; }
  return v;
}
const clip = (s, n = 6000) => { s = typeof s === 'string' ? s : JSON.stringify(s); return s && s.length > n ? s.slice(0, n) + '…(截断)' : s; };
function logCall(row) {
  try {
    const U = require('../../util');
    db.exec1('INSERT INTO supplier_call_logs(supplier,mode,interface_code,ok,code,msg,duration_ms,request,response,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)', 'jdvop', row.mode, row.interfaceCode, row.ok ? 1 : 0, String(row.code ?? ''), String(row.msg || '').slice(0, 300), row.ms, clip(redact(row.request)), clip(redact(row.response)), U.now());
    db.exec1("DELETE FROM supplier_call_logs WHERE id IN (SELECT id FROM supplier_call_logs ORDER BY id DESC LIMIT -1 OFFSET 20000)"); // 只保留最近 2 万条
  } catch (e) { console.error('[jdvop] 写调用日志失败', e.message); }
}
const isOk = r => r && (String(r.code) === '200') && r.success !== false && r.error !== true;
// 来一票限流:超出 QPS 时返回 {code:500, msg:"QPS超限"};这类错误自动等待重试,不当作业务失败
const isQpsLimited = r => r && !isOk(r) && /QPS|QPM|限流|频繁/i.test(String(r.msg || ''));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** 构造 live 请求(导出给测试使用;不发送) */
function buildRequest(interfaceCode, data, c = cfg(), now = Date.now(), nonceStr = nonce()) {
  const timestamp = String(now); // 13 位毫秒
  const type = c.interfaceType || INTERFACE_TYPE;
  const { signature } = sign({ timestamp, nonceStr, interfaceType: type, interfaceCode, appKey: c.appKey, appSecret: c.appSecret });
  const url = `${c.baseUrl}/api/v1/${encodeURIComponent(c.tenant)}/${encodeURIComponent(c.appKey)}/${encodeURIComponent(type)}`;
  return { url, body: { interfaceCode, timestamp, nonceStr, signature, data: { type: c.apiType, ...(data || {}) } } };
}

/** 中转模式:请求 relay(签名由 relay 在白名单服务器上完成),返回解析后的上游 JSON */
async function relayFetch(c, method, p, bodyObj, interfaceCode) {
  const body = bodyObj ? JSON.stringify(bodyObj) : '';
  const headers = relayAuth.signHeaders(c.relayToken, method, p, body);
  if (body) headers['Content-Type'] = 'application/json';
  let r; try { r = await fetch(c.relayUrl + p, { method, headers, body: body || undefined, signal: AbortSignal.timeout(c.timeoutMs + 20000) }); } // relay 端可能排队
  catch (e) { throw new SupplierError('网络错误(中转):' + e.message, { interfaceCode, network: true }); }
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { return { code: r.status, msg: 'HTTP ' + r.status + ' 中转非 JSON 响应' }; }
}

/** 调用业务接口,成功返回 data,失败抛出 SupplierError */
async function call(interfaceCode, data = {}) {
  const c = cfg();
  return limiter.schedule(async () => {
    const t0 = Date.now(); let resp, reqLog;
    try {
      if (c.mode === 'mock') {
        reqLog = { interfaceCode, data: { type: c.apiType, ...data } };
        resp = mock.handle(interfaceCode, { type: c.apiType, ...data });
      } else {
        const miss = missing(c); if (miss.length) throw new SupplierError('供应商接口未配置:' + miss.join('、'), { interfaceCode });
        for (let attempt = 0; ; attempt++) {
          if (c.relayUrl) {
            reqLog = { relay: true, interfaceCode, data: { type: c.apiType, ...data } };
            resp = await relayFetch(c, 'POST', '/v1/call', { interfaceCode, data }, interfaceCode);
            if (!isQpsLimited(resp) || attempt >= c.qpsRetries) break;
            await sleep(Math.max(1200, c.minIntervalMs) * (attempt + 1)); continue;
          }
          const { url, body } = buildRequest(interfaceCode, data, c); // 每次重试重新生成时间戳/随机串/签名
          reqLog = { url: url.replace(encodeURIComponent(c.appKey), '***').replace(encodeURIComponent(c.tenant), '{tenant}'), ...body };
          let r; try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(c.timeoutMs) }); }
          catch (e) { throw new SupplierError('网络错误:' + e.message, { interfaceCode, network: true }); }
          const text = await r.text();
          try { resp = JSON.parse(text); } catch (e) { resp = { code: r.status, msg: 'HTTP ' + r.status + ' 非 JSON 响应', raw: text.slice(0, 500) }; }
          if (!isQpsLimited(resp) || attempt >= c.qpsRetries) break;
          logCall({ mode: c.mode, interfaceCode, ok: false, code: resp.code, msg: resp.msg + '(自动重试)', ms: Date.now() - t0, request: reqLog, response: resp });
          await sleep(Math.max(1200, c.minIntervalMs) * (attempt + 1));
        }
      }
      const ok = isOk(resp);
      logCall({ mode: c.mode, interfaceCode, ok, code: resp && resp.code, msg: resp && resp.msg, ms: Date.now() - t0, request: reqLog, response: resp });
      // TODO:文档无错误码表,目前仅以 code=200 判断成功,其余原样把 msg 展示给后台
      if (!ok) throw new SupplierError((resp && resp.msg) || '供应商接口返回错误', { code: resp && resp.code, interfaceCode });
      return resp.data;
    } catch (e) {
      if (!(e instanceof SupplierError)) e = new SupplierError(e.message, { interfaceCode });
      if (!resp) logCall({ mode: c.mode, interfaceCode, ok: false, code: e.network ? 'NET' : 'ERR', msg: e.message, ms: Date.now() - t0, request: reqLog || { interfaceCode, data }, response: null });
      throw e;
    }
  }, c.minIntervalMs);
}

/** 租户余额:GET /api/v1/customerBalance/{租户号}(文档未写鉴权方式) */
async function balance() {
  const c = cfg();
  return limiter.schedule(async () => {
    const t0 = Date.now(); let resp;
    try {
      if (c.mode === 'mock') resp = mock.getBalance();
      else {
        const miss = missing(c); if (miss.length) throw new SupplierError('供应商接口未配置:' + miss.join('、'));
        // 实测(2026-11-04):GET 无需签名;未充值时 data 为空字符串 "",按 0 处理
        for (let attempt = 0; ; attempt++) {
          if (c.relayUrl) {
            resp = await relayFetch(c, 'GET', '/v1/balance', null, 'customerBalance');
            if (!isQpsLimited(resp) || attempt >= c.qpsRetries) break;
            await sleep(Math.max(1200, c.minIntervalMs) * (attempt + 1)); continue;
          }
          let r; try { r = await fetch(`${c.baseUrl}/api/v1/customerBalance/${encodeURIComponent(c.tenant)}?tenantCode=${encodeURIComponent(c.tenant)}`, { signal: AbortSignal.timeout(c.timeoutMs) }); }
          catch (e) { throw new SupplierError('网络错误:' + e.message, { interfaceCode: 'customerBalance', network: true }); }
          const text = await r.text();
          try { resp = JSON.parse(text); } catch (e) { resp = { code: r.status, msg: 'HTTP ' + r.status + ' 非 JSON 响应' }; }
          if (!isQpsLimited(resp) || attempt >= c.qpsRetries) break;
          await sleep(Math.max(1200, c.minIntervalMs) * (attempt + 1));
        }
      }
      const ok = isOk(resp); logCall({ mode: c.mode, interfaceCode: 'customerBalance', ok, code: resp.code, msg: resp.msg, ms: Date.now() - t0, request: { tenantCode: '{tenant}' }, response: resp });
      if (!ok) throw new SupplierError(resp.msg || '查询余额失败', { code: resp.code, interfaceCode: 'customerBalance' });
      const v = parseFloat(resp.data); return isNaN(v) ? 0 : v;
    } catch (e) { if (!resp) logCall({ mode: c.mode, interfaceCode: 'customerBalance', ok: false, code: 'ERR', msg: e.message, ms: Date.now() - t0, request: {}, response: null }); throw e instanceof SupplierError ? e : new SupplierError(e.message); }
  }, c.minIntervalMs);
}
module.exports = { call, balance, buildRequest, redact, isOk, isQpsLimited, SupplierError };
