// 京东货盘(来一票 VOP)配置:只从环境变量读取,绝不在代码/数据库/仓库中保存密钥。
// JDVOP_BASE_URL   接口根地址(含 /cgi-bin 之类前缀,由来一票商务提供;live 模式必须是 https)
// JDVOP_TENANT     租户号
// JDVOP_APPKEY     AppKey(Base64,不含末尾 ==)
// JDVOP_APPSECRET  AppSecret(32 位 hex,用作 AES IV)
// JDVOP_MODE       mock | live(默认 mock)
// 可选:JDVOP_API_TYPE(V1/V2,默认 V2)、JDVOP_MIN_INTERVAL_MS(限流间隔,live 默认 1000,mock 默认 50)、
//      JDVOP_SIGN_CODE_FIELD(type|code,签名中 interfaceCode 取值,见 sign.js)、JDVOP_CALLBACK_TOKEN(回调地址 ?token= 校验)、
//      JDVOP_CALLBACK_TENANT_APP_ID(回调 tenantAppId 校验值)、JDVOP_ALLOW_HTTP=1(仅调试允许 http)、JDVOP_TIMEOUT_MS
const INTERFACE_TYPE = 'jd_mall_interface';
function cfg() {
  const e = process.env;
  const mode = (e.JDVOP_MODE || 'mock').toLowerCase() === 'live' ? 'live' : 'mock';
  return {
    mode,
    baseUrl: String(e.JDVOP_BASE_URL || '').replace(/\/+$/, ''),
    tenant: e.JDVOP_TENANT || '',
    appKey: e.JDVOP_APPKEY || '',
    appSecret: e.JDVOP_APPSECRET || '',
    apiType: (e.JDVOP_API_TYPE || 'V2').toUpperCase() === 'V1' ? 'V1' : 'V2',
    minIntervalMs: Math.max(0, parseInt(e.JDVOP_MIN_INTERVAL_MS || (mode === 'live' ? '1000' : '50'), 10) || 0),
    timeoutMs: Math.max(1000, parseInt(e.JDVOP_TIMEOUT_MS || '15000', 10) || 15000),
    callbackToken: e.JDVOP_CALLBACK_TOKEN || '',
    callbackTenantAppId: e.JDVOP_CALLBACK_TENANT_APP_ID || '',
    allowHttp: e.JDVOP_ALLOW_HTTP === '1',
    interfaceType: INTERFACE_TYPE
  };
}
/** live 模式下缺少的配置项(用于后台提示;不返回任何值本身) */
function missing(c = cfg()) {
  const m = [];
  if (!c.baseUrl) m.push('JDVOP_BASE_URL'); else if (!/^https:\/\//i.test(c.baseUrl) && !c.allowHttp) m.push('JDVOP_BASE_URL(必须 https)');
  if (!c.tenant) m.push('JDVOP_TENANT'); if (!c.appKey) m.push('JDVOP_APPKEY'); if (!c.appSecret) m.push('JDVOP_APPSECRET');
  return m;
}
/** 已配置状态(仅布尔/掩码,供后台展示) */
function status(c = cfg()) {
  const mask = v => v ? (v.length <= 4 ? '****' : v.slice(0, 2) + '****' + v.slice(-2)) : '(未设置)';
  return { mode: c.mode, apiType: c.apiType, baseUrl: c.baseUrl ? c.baseUrl.replace(/\/\/([^/]+).*/, '//$1/…') : '(未设置)', tenant: mask(c.tenant), appKey: c.appKey ? '已设置' : '(未设置)', appSecret: c.appSecret ? '已设置' : '(未设置)', callbackToken: c.callbackToken ? '已设置' : '(未设置)', minIntervalMs: c.minIntervalMs, missing: c.mode === 'live' ? missing(c) : [] };
}
module.exports = { cfg, missing, status, INTERFACE_TYPE };
