// 线下门店优惠卡:置顶展示的非商品条目(不进购物车/订单/积分/供应商同步),「购买」直接进入在线客服由客服办理
const svc = require('./svc');
const FIELDS = [
  ['storecard_nature', '卡的性质'], ['storecard_stores', '适用门店'], ['storecard_valid', '有效期'],
  ['storecard_excluded', '不参与折扣'], ['storecard_stack', '优惠叠加'], ['storecard_usage', '使用方式'], ['storecard_refund', '退卡规则'], ['storecard_provider', '优惠提供方'], ['storecard_tips', '温馨提示'],
];
const DEFAULTS = {
  storecard_on: '1', storecard_name: '线下门店优惠卡', storecard_price: '', storecard_price_unit: '1年',
  storecard_intro: '韵农甄选线下门店优惠卡，持卡在我们的线下门店消费享7.5折（例外商品见下方说明）；具体办理方式、价格和适用门店请咨询客服。',
  storecard_image: '/static/img/storecard/main.jpg', storecard_detail_image: '/static/img/storecard/detail.jpg',
  storecard_nature: '折扣资格卡，卡内不存钱、不能充值', storecard_stores: '全国韵农甄选线下门店均可使用，门店名单和地址见本页下方的门店列表', storecard_valid: '自开卡之日起 1 年', storecard_excluded: '烟草、特价或促销商品、购物卡和礼品卡，以及门店标明「不参与折扣」的商品', storecard_stack: '不与门店其他折扣同时使用', storecard_usage: '结账时出示商城会员账号中的优惠卡；一卡一人，不可转借', storecard_refund: '如需退卡，请联系在线客服办理', storecard_provider: '由海南韵农科技有限公司及合作门店提供', storecard_tips: '本卡为折扣卡，不可充值或储值，不可兑换现金，仅限本人使用', storecard_store_list: '',
};
const KEYS = Object.keys(DEFAULTS);
const PENDING = '待确认';
// 售价:后台填写才显示「¥xx / 1年」,留空显示「到店或联系客服办理」
function priceOf(s) { const n = Number(String(s.storecard_price || '').trim()); return String(s.storecard_price || '').trim() && isFinite(n) && n > 0 ? (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, '') : ''; }
function get() {
  const s = svc.settings(), v = k => (s[k] != null && s[k] !== '' ? String(s[k]) : (k === 'storecard_on' || k === 'storecard_name' || k === 'storecard_image' || k === 'storecard_intro' || k === 'storecard_detail_image' ? DEFAULTS[k] : ''));
  return {
    on: v('storecard_on') === '1', name: v('storecard_name'), intro: v('storecard_intro'), image: ver(v('storecard_image')), detailImage: v('storecard_detail_image') === 'none' ? '' : ver(v('storecard_detail_image')),
    badge: '7.5折', price: priceOf(s), cardPrice: priceOf(s) ? '¥' + priceOf(s) : '', priceText: priceOf(s) ? '¥' + priceOf(s) + ' / ' + (String(s.storecard_price_unit || '').trim().replace(/^\/\s*/, '') || '1年') : '到店或联系客服办理', tagline: '全国韵农甄选线下门店均可使用，到店消费享七五折（不参与折扣的商品除外，门店列表见下方）',
    stores: String(s.storecard_store_list || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const [name, ...a] = l.split(/[|｜]/); return { name: name.trim(), addr: a.join(' ').trim() }; }),
    info: FIELDS.map(([k, label]) => ({ key: k, label, value: v(k) || PENDING, pending: !v(k) })),
  };
}
// 内置图片加版本号防缓存(换图时递增)
const IMG_VER = '3';
function ver(u) { return /^\/static\/img\/storecard\/[\w.-]+$/.test(u) ? u + '?v=' + IMG_VER : u; }
const safeImg = u => /^\/(static|uploads)\/[\w./-]+$/.test(String(u || '').trim()) || /^https:\/\/[\w.-]+\/[\w./%-]+$/.test(String(u || '').trim());
module.exports = { get, FIELDS, DEFAULTS, KEYS, PENDING, safeImg };
