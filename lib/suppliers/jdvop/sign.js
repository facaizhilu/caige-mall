// 签名:严格按《接口中心 / 公共参数》实现
//   明文 = ["timestamp=..", "nonceStr=..", "interfaceCode=.."] 按 Unicode 码点升序排序后用 & 连接
//   密文 = Base64( AES/CBC/PKCS5Padding( 明文, key = Base64Decode(appKey + "=="), iv = HexDecode(appSecret) ) )
//   appKey 解码后 16 字节 → AES-128-CBC
const crypto = require('crypto');

/**
 * 【文档歧义集中在此函数】签名明文里 interfaceCode= 后面放什么?
 * - 公共参数表写「interfaceCode 不参与签名」,签名规则又列出 interfaceCode 参与签名,且其示例值为
 *   「接口类型标识」(movie_interface / food_interface),而不是请求体里的接口编码(如 searchGoodsList)。
 * - 我们按「签名规则 + Java/PHP 示例」实现:默认取接口类型 jd_mall_interface。
 * - TODO(待来一票确认并给出完整算例):若实测签名错误,可设 JDVOP_SIGN_CODE_FIELD=code 改为取接口编码,无需改代码。
 * - TODO:时间戳文档要求 13 位毫秒,Java 示例却是 10 位;我们用 13 位(Date.now())。
 * - TODO:排序规则写「按 Unicode 码点」;三个 key 都是 ASCII,JS 默认排序(UTF-16 码元)与码点排序结果一致。
 */
function signInterfaceValue(interfaceType, interfaceCode, field = process.env.JDVOP_SIGN_CODE_FIELD) {
  return field === 'code' ? interfaceCode : interfaceType;
}
function plaintext({ timestamp, nonceStr, interfaceValue }) {
  return [`timestamp=${timestamp}`, `nonceStr=${nonceStr}`, `interfaceCode=${interfaceValue}`].sort().join('&');
}
function aesKey(appKey) {
  const key = Buffer.from(String(appKey) + '==', 'base64');
  if (![16, 24, 32].includes(key.length)) throw new Error(`AppKey 解码后长度 ${key.length} 字节,不是有效的 AES 密钥(期望 16 字节)`);
  return key;
}
function aesIv(appSecret) {
  if (!/^[0-9a-fA-F]{32}$/.test(String(appSecret))) throw new Error('AppSecret 需为 32 位十六进制字符串(作为 16 字节 IV)');
  return Buffer.from(appSecret, 'hex');
}
function encrypt(text, appKey, appSecret) {
  const key = aesKey(appKey), iv = aesIv(appSecret);
  const c = crypto.createCipheriv(`aes-${key.length * 8}-cbc`, key, iv); // Node 默认 PKCS#7 填充(= Java PKCS5Padding)
  return Buffer.concat([c.update(Buffer.from(text, 'utf8')), c.final()]).toString('base64');
}
function sign({ timestamp, nonceStr, interfaceType, interfaceCode, appKey, appSecret, field }) {
  const pt = plaintext({ timestamp, nonceStr, interfaceValue: signInterfaceValue(interfaceType, interfaceCode, field) });
  return { plaintext: pt, signature: encrypt(pt, appKey, appSecret) };
}
const nonce = () => crypto.randomBytes(16).toString('hex');
module.exports = { sign, plaintext, encrypt, signInterfaceValue, nonce };
