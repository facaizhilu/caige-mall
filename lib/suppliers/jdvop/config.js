// 京东货盘(来一票 VOP)配置:只从环境变量读取,绝不在代码/数据库/仓库中保存密钥。
// JDVOP_BASE_URL   接口根地址(含 /cgi-bin 前缀;live 模式必须是 https)。未设置时按 JDVOP_ENV 取默认:
//                  prod(默认)= https://apiprd.laiyipiao.com.cn/cgi-bin ,test = https://apitest.laiyipiao.com.cn/cgi-bin
//                  (文档「公共参数」页只写了 http://domain.com 占位;2026-11-04 从白名单服务器实测 apiprd 可用)
// JDVOP_TENANT     租户号
// JDVOP_APPKEY     AppKey(Base64,不含末尾 ==)
// JDVOP_APPSECRET  AppSecret(32 位 hex,用作 AES IV)
// JDVOP_MODE       mock | live(默认 mock)
// 可选:JDVOP_API_TYPE(V1/V2,默认 V2)、JDVOP_MIN_INTERVAL_MS(限流间隔,live 默认 1000,mock 默认 50)、
//      JDVOP_SIGN_CODE_FIELD(type|code,签名中 interfaceCode 取值,见 sign.js)、JDVOP_CALLBACK_TOKEN(回调地址 ?token= 校验)、
//      JDVOP_CALLBACK_TENANT_APP_ID(回调 tenantAppId 校验值)、JDVOP_INTERFACE_TYPE(接口类型标识,默认 jd_mall_interface)、
//      JDVOP_QPS_RETRIES(返回「QPS超限」时自动重试次数,默认 2)、JDVOP_ALLOW_HTTP=1(仅调试允许 http)、JDVOP_TIMEOUT_MS
const INTERFACE_TYPE = 'jd_mall_interface';
const BASE_URLS = { prod: 'https://apiprd.laiyipiao.com.cn/cgi-bin', test: 'https://apitest.laiyipiao.com.cn/cgi-bin' };
function cfg() {
  const e = process.env;
  const mode = (e.JDVOP_MODE || 'mock').toLowerCase() === 'live' ? 'live' : 'mock';
  return {
    mode,
    env: (e.JDVOP_ENV || 'prod').toLowerCase() === 'test' ? 'test' : 'prod',
    baseUrl: String(e.JDVOP_BASE_URL || BASE_URLS[(e.JDVOP_ENV || 'prod').toLowerCase() === 'test' ? 'test' : 'prod']).trim().replace(/\/+$/, ''),
    tenant: e.JDVOP_TENANT || '',
    appKey: e.JDVOP_APPKEY || '',
    appSecret: e.JDVOP_APPSECRET || '',
    apiType: (e.JDVOP_API_TYPE || 'V2').toUpperCase() === 'V1' ? 'V1' : 'V2',
    minIntervalMs: Math.max(0, parseInt(e.JDVOP_MIN_INTERVAL_MS || (mode === 'live' ? '1100' : '50'), 10) || 0), // 来一票默认 QPS=1、QPM=100;1000ms 实测偶发「QPS超限」
    qpsRetries: Math.max(0, Math.min(5, parseInt(e.JDVOP_QPS_RETRIES || '2', 10) || 0)),
    timeoutMs: Math.max(1000, parseInt(e.JDVOP_TIMEOUT_MS || '15000', 10) || 15000),
    callbackToken: e.JDVOP_CALLBACK_TOKEN || '',
    callbackTenantAppId: e.JDVOP_CALLBACK_TENANT_APP_ID || '',
    allowHttp: e.JDVOP_ALLOW_HTTP === '1',
    interfaceType: String(e.JDVOP_INTERFACE_TYPE || INTERFACE_TYPE).trim() || INTERFACE_TYPE,
    // 中转模式:经白名单服务器上的 relay 调用,本机无需 AppKey/AppSecret/租户号(见 relay/README.md)
    relayUrl: String(e.JDVOP_RELAY_URL || '').trim().replace(/\/+$/, ''),
    relayToken: e.JDVOP_RELAY_TOKEN || ''
  };
}
/** live 模式下缺少的配置项(用于后台提示;不返回任何值本身) */
function missing(c = cfg()) {
  const m = [];
  if (c.relayUrl) {
    if (!/^https?:\/\/[^/]+/i.test(c.relayUrl)) m.push('JDVOP_RELAY_URL(格式错误)');
    if (!c.relayToken || c.relayToken.length < 32) m.push('JDVOP_RELAY_TOKEN');
    return m;
  }
  if (!c.baseUrl) m.push('JDVOP_BASE_URL'); else if (!/^https:\/\//i.test(c.baseUrl) && !c.allowHttp) m.push('JDVOP_BASE_URL(必须 https)');
  if (!c.tenant) m.push('JDVOP_TENANT'); if (!c.appKey) m.push('JDVOP_APPKEY'); if (!c.appSecret) m.push('JDVOP_APPSECRET');
  return m;
}
/** 已配置状态(仅布尔/掩码,供后台展示) */
function status(c = cfg()) {
  const mask = v => v ? (v.length <= 4 ? '****' : v.slice(0, 2) + '****' + v.slice(-2)) : '(未设置)';
  return { mode: c.mode, apiType: c.apiType, interfaceType: c.interfaceType, baseUrl: c.baseUrl ? c.baseUrl.replace(/\/\/([^/]+).*/, '//$1/…') : '(未设置)', tenant: mask(c.tenant), appKey: c.appKey ? '已设置' : '(未设置)', appSecret: c.appSecret ? '已设置' : '(未设置)', callbackToken: c.callbackToken ? '已设置' : '(未设置)', minIntervalMs: c.minIntervalMs, relay: c.relayUrl ? c.relayUrl.replace(/^(https?:\/\/[^/]+).*/i, '$1') + (c.relayToken ? '(令牌已设置)' : '(令牌未设置)') : '(未使用)', missing: c.mode === 'live' ? missing(c) : [] };
}
module.exports = { cfg, missing, status, INTERFACE_TYPE, BASE_URLS };
