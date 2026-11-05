// 违禁词检查:词表保存在 settings.banned_words(每行一个,后台可编辑)。
// 商品新增/编辑时提示(不阻止保存);后续批量导入商品时也应调用 checkProduct() 给出同样的提示。
const db = require('./db');

// 默认违禁/敏感词清单(后台「违禁词检查」可编辑,每行一个)
// 「全国联保」「假一赔十」「财哥严选」:合规审查 G6,通用商品模板不得使用(联保仅限确有厂家联保的数码家电,严选仅限自营品牌商品,赔付承诺须可兑现)
const ADDED_WORDS = ['全国联保', '假一赔十', '财哥严选'];
// 合规审查(2026-11):供应商商品标题常见的极限词/排名/背书/功效宣称(导入时由 sanitize() 自动清理,残留则进待审核)
const CLAIM_WORDS = ['TOP榜', '金榜', '热销', '旗舰级', '特级', '果王', '神器', '万能', '同款', '包赔', '爆款', '无抗生素', '无激素', '无菌', '沙门氏菌', '孕妇', '国家地理标志', '可生食', '欧盟标准', '地标', '严选'];
const DEFAULT_WORDS = ['返佣', '收益', '佣金', '分销', '团队', '下线', '层级', '分红', '躺赚', '日赚', '稳赚', '积分提现', '最', '第一', '国家级', '100%', '顶级', '极品', ...ADDED_WORDS, ...CLAIM_WORDS];
const BANNED_DEFAULT = DEFAULT_WORDS.join('\n');

function words() {
  const svc = require('./svc');
  const raw = svc.S('banned_words');
  return String(raw == null ? BANNED_DEFAULT : raw).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}
const strip = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
/** 返回 [{field, word, snippet}] */
function check(fields) {
  const list = words(), hits = [];
  for (const [field, text] of Object.entries(fields)) {
    const t = strip(text);
    for (const w of list) {
      const i = t.indexOf(w);
      if (i >= 0) hits.push({ field, word: w, snippet: t.slice(Math.max(0, i - 8), i + w.length + 8).trim() });
    }
  }
  return hits;
}
const FIELD_LABEL = { name: '名称', subtitle: '副标题', description: '详情', spec: '规格' };
function checkProduct(p, skus) {
  return check({ name: p.name, subtitle: p.subtitle, description: p.description, spec: (skus || []).map(s => s.spec_text).join(' ') });
}
function summarize(hits) {
  const byWord = {};
  for (const h of hits) (byWord[h.word] = byWord[h.word] || new Set()).add(FIELD_LABEL[h.field] || h.field);
  return Object.entries(byWord).map(([w, f]) => `「${w}」(${[...f].join('、')})`).join(' ');
}
function scanAll() {
  return db.all('SELECT id, name, subtitle, description, status FROM products ORDER BY id DESC').map(p => {
    const hits = checkProduct(p, db.all('SELECT spec_text FROM skus WHERE product_id=?', p.id));
    return hits.length ? { ...p, hits, summary: summarize(hits) } : null;
  }).filter(Boolean);
}
// 供应商标题/规格/详情文字清理:去掉违禁词与宣称短语,保留商品(只改本站文案,不改京东详情图片)
const SANITIZE_RULES = [
  [/[【\[(（]([^】\]）)]{0,20}?(TOP|榜|第[一1]|热销|全网|爆款|同款|推荐|销量|冠军|万能|神器)[^】\]）)]{0,20}?)[】\]）)]/gi, ''],
  [/(?<![A-Za-z])TOP\s*\d*(?![A-Za-z])/gi, ''], [/[^\s【】,，|｜/]{0,3}榜(第[\d一二三]+名)?/g, ''], [/第[一1]名?(?![代天次批层])/g, ''],
  [/全网热销|热销\s*[\d.]+\s*[万千百Ww]+\+?|热销/g, ''], [/爆款/g, ''],
  [/(田嘉瑞)?(明星|王菲|网红|徐福烩饭)?同款/g, ''], [/(苹果)?旗舰店|旗舰级|旗舰/g, ''], [/特级|果王|神器|万能|极品|顶级|国家级/g, ''],
  [/包赔/g, ''], [/无菌蛋(?=[\s礼生]|$)|无抗生素|无激素|无抗(养殖)?|(不含|无)沙门氏菌|无菌/g, ''], [/(低糖)?孕妇(水果|专用|可吃)?/g, ''], [/国家地理标志(保护)?产品?/g, ''], [/(达到)?可生食(鸡蛋)?标准|可生食/g, ''], [/欧盟标准/g, ''], [/地标(认证|产品)?/g, ''], [/严选/g, ''],
  [/最(?=新款|新)/g, ''], [/最/g, ''], [/100%/g, ''],
];
function sanitize(text) {
  let t = String(text == null ? '' : text);
  for (const [re, to] of SANITIZE_RULES) t = t.replace(re, to);
  return t.replace(/[【\[(（]\s*[|｜,，、\s]*[】\])）]/g, '').replace(/[【\[]\s*[|｜]\s*/g, '【').replace(/\s*[|｜]\s*[】\]]/g, '】')
    .replace(/[#＃]+/g, ' ').replace(/(\s*[,，、]\s*){2,}/g, ' ').replace(/\s{2,}/g, ' ').replace(/^[\s,，、|｜/]+|[\s,，、|｜/]+$/g, '').trim();
}
/** 只清理 HTML 标签之间的文字(属性/图片地址不动) */
const sanitizeHtml = html => String(html || '').replace(/>([^<]+)</g, (m, t) => '>' + (t.trim() ? sanitize(t) : t) + '<');
module.exports = { sanitize, sanitizeHtml, CLAIM_WORDS, BANNED_DEFAULT, DEFAULT_WORDS, ADDED_WORDS, words, check, checkProduct, summarize, scanAll, FIELD_LABEL };
