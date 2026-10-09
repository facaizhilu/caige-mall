// 违禁词检查:词表保存在 settings.banned_words(每行一个,后台可编辑)。
// 商品新增/编辑时提示(不阻止保存);后续批量导入商品时也应调用 checkProduct() 给出同样的提示。
const db = require('./db');

// 默认违禁/敏感词清单(后台「违禁词检查」可编辑,每行一个)
// 「全国联保」「假一赔十」「财哥严选」:合规审查 G6,通用商品模板不得使用(联保仅限确有厂家联保的数码家电,严选仅限自营品牌商品,赔付承诺须可兑现)
const ADDED_WORDS = ['全国联保', '假一赔十', '财哥严选'];
const DEFAULT_WORDS = ['返佣', '收益', '佣金', '分销', '团队', '下线', '层级', '分红', '躺赚', '日赚', '稳赚', '积分提现', '最', '第一', '国家级', '100%', '顶级', '极品', ...ADDED_WORDS];
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
module.exports = { BANNED_DEFAULT, DEFAULT_WORDS, ADDED_WORDS, words, check, checkProduct, summarize, scanAll, FIELD_LABEL };
