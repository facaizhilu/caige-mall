process.env.TZ = process.env.TZ || 'Asia/Shanghai';
const crypto = require('crypto');
const pad = n => String(n).padStart(2, '0');
const fmtDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const now = () => fmtDate();
const today = () => now().slice(0, 10);
const parseDate = s => new Date(String(s).replace(' ', 'T'));
const offset = (ms) => fmtDate(new Date(Date.now() + ms));
const round2 = n => Math.round((+n + Number.EPSILON) * 100) / 100;
const money = n => '¥' + round2(n || 0).toFixed(2);
const num = (v, d = 0) => { const n = parseFloat(v); return isNaN(n) ? d : n; };
const int = (v, d = 0) => { const n = parseInt(v, 10); return isNaN(n) ? d : n; };

const ORDER_STATUS = { unpaid: '待付款', paid: '待发货', shipped: '待收货', completed: '已完成', cancelled: '已取消', refunded: '已退款' };
const AFTERSALE_STATUS = { pending: '待审核', approved_return: '待买家寄回', returned: '待商家收货', refunded: '已退款', exchanged: '已换货', rejected: '已拒绝', cancelled: '已撤销' };
const PAY_METHOD = { wechat: '微信支付(模拟)', alipay: '支付宝(模拟)', balance: '模拟支付', points: '积分兑换' }; // balance 仅用于历史演示订单,余额功能已下线
const AFTERSALE_TYPE = { refund: '仅退款', refund_return: '退货退款', no_reason: '7天无理由退货', quality: '质量问题退换货' };
const PERMS = { dashboard: '数据概览', product: '商品/分类/品牌/运费', order: '订单/售后/发票', review: '评价管理', member: '会员/等级/分销/云商卡', marketing: '营销(优惠券/秒杀/拼团/积分商城/Banner/热搜)', content: '文章/公告/帮助', service: '客服', stats: '统计报表/数据导出', system: '管理员/角色/日志/系统设置' };

function paginate(sql, params, page, size = 15) {
  const db = require('./db');
  page = Math.max(1, int(page, 1));
  const total = db.prepare(`SELECT COUNT(*) c FROM (${sql})`).get(...params).c;
  const pages = Math.max(1, Math.ceil(total / size));
  page = Math.min(page, pages);
  const rows = db.prepare(`${sql} LIMIT ${size} OFFSET ${(page - 1) * size}`).all(...params);
  return { rows, total, pages, page, size };
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const csvCell = v => { if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) v = "'" + v; v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const toCSV = (header, rows) => '\ufeff' + [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n');
const randCode = (n = 6) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');
const orderNo = () => now().replace(/[-: ]/g, '') + randCode(4);
const maskPhone = p => (p || '').replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
const isPhone = p => /^1[3-9]\d{9}$/.test(p || '');
const genImg = (t, a, b, v = 0, n = '') => `/img/gen.svg?t=${encodeURIComponent(t)}&a=${a}&b=${b}&v=${v}&n=${encodeURIComponent(n)}`;
const firstImg = images => { try { const a = JSON.parse(images || '[]'); return a[0] || genImg('财', 'd4202a', 'f2a93b'); } catch (e) { return genImg('财', 'd4202a', 'f2a93b'); } };
const jsonArr = s => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
function timeAgo(s) { const d = (Date.now() - parseDate(s)) / 1000; if (d < 60) return '刚刚'; if (d < 3600) return Math.floor(d / 60) + '分钟前'; if (d < 86400) return Math.floor(d / 3600) + '小时前'; if (d < 86400 * 30) return Math.floor(d / 86400) + '天前'; return String(s).slice(0, 10); }

module.exports = { now, today, parseDate, offset, fmtDate, round2, money, num, int, ORDER_STATUS, AFTERSALE_STATUS, AFTERSALE_TYPE, PAY_METHOD, PERMS, paginate, esc, csvCell, toCSV, randCode, orderNo, maskPhone, isPhone, genImg, firstImg, jsonArr, timeAgo };
