// 导入合规:类目禁售清单、京东字样清理、违禁词检查
// 禁售清单(后台可编辑,settings.jdvop_blocklist):每行「分组名:关键词1,关键词2」,关键词与供应商一/二/三级分类名称做包含匹配
const BLOCKLIST_DEFAULT = [
  '药品:药品,中西药,医药,处方药,非处方药,中药饮片,感冒用药',
  '医疗器械:医疗器械,医疗器材,护理器械,计生用品,隐形眼镜',
  '保健食品:保健食品,营养保健,保健品,滋补,膳食营养补充',
  '酒类:酒类,白酒,葡萄酒,啤酒,洋酒,黄酒,养生酒,酒水',
  '图书/出版物:图书,出版物,音像,杂志,期刊,电子书,教材',
  '烟草:烟草,香烟,电子烟,雪茄,烟具',
  '需3C认证类:家用电器,厨房小电,生活电器,大家电,个护电器,手机通讯,电脑整机,笔记本,平板电脑,电源,充电器,插座,插线板,电线电缆,灯具照明,儿童安全座椅,电动车,汽车用品'
].join('\n');
function blocklist() {
  const raw = require('../../svc').S('jdvop_blocklist');
  return String(raw == null ? BLOCKLIST_DEFAULT : raw).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const i = l.search(/[::]/); const group = i > 0 ? l.slice(0, i).trim() : l; const kws = (i > 0 ? l.slice(i + 1) : l).split(/[,,、\s]+/).map(s => s.trim()).filter(Boolean);
    return { group, kws };
  });
}
/** names: 供应商分类名称数组 → 命中的禁售分组 {group, kw} 或 null */
function blockedBy(names) {
  const text = (names || []).filter(Boolean).join(' / ');
  for (const b of blocklist()) for (const k of b.kws) if (text.includes(k)) return { group: b.group, kw: k };
  return null;
}
// 面向顾客的文案:去掉「京东 / 京东自营 / 京东物流 / 京东配送」等字样(不展示上游渠道)
function stripJd(s) {
  return String(s == null ? '' : s)
    .replace(/感谢您在京东购物[,,。!!]*(欢迎再次光临[。!!]*)?/g, '')
    .replace(/京东(自营|物流|快递|配送|仓|超市|商城|到家|旗舰店|官方)?/g, '')
    .replace(/\bJD\s*(\.com)?\b/gi, '')
    .replace(/[【\[]\s*[】\]]/g, '').replace(/\s{2,}/g, ' ').trim();
}
// 物流轨迹清理:同上,并把「京东【xx营业部】」等改写为中性的「【xx营业部】」
const stripTrace = s => stripJd(s) || '物流状态更新';
module.exports = { BLOCKLIST_DEFAULT, blocklist, blockedBy, stripJd, stripTrace };
