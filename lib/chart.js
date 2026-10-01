// 轻量服务端 SVG 图表(无外部依赖)
const esc = require('./util').esc;
function niceMax(v) { if (v <= 0) return 10; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function fmtN(n) { return n >= 10000 ? (n / 10000).toFixed(1) + '万' : (n % 1 ? n.toFixed(1) : String(n)); }
// series: [{name,color,values,type:'bar'|'line'}]
function trend({ labels, series, width = 760, height = 260, unit = '' }) {
  const m = { l: 52, r: 16, t: 24, b: 34 }, W = width - m.l - m.r, H = height - m.t - m.b;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const n = labels.length, step = W / Math.max(1, n);
  let g = '';
  for (let i = 0; i <= 4; i++) { const y = m.t + H - H * i / 4; g += `<line x1="${m.l}" x2="${m.l + W}" y1="${y}" y2="${y}" stroke="#eceef2"/><text x="${m.l - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#9aa1ad">${fmtN(max * i / 4)}</text>`; }
  const skip = Math.ceil(n / 12);
  labels.forEach((l, i) => { if (i % skip === 0) g += `<text x="${m.l + step * i + step / 2}" y="${height - 12}" text-anchor="middle" font-size="11" fill="#9aa1ad">${esc(l)}</text>`; });
  const bars = series.filter(s => s.type !== 'line'), lines = series.filter(s => s.type === 'line');
  bars.forEach((s, si) => {
    const bw = Math.min(28, step * 0.6 / bars.length);
    s.values.forEach((v, i) => { const h = H * v / max, x = m.l + step * i + (step - bw * bars.length) / 2 + bw * si; g += `<rect x="${x}" y="${m.t + H - h}" width="${bw}" height="${h}" rx="3" fill="${s.color}"><title>${esc(labels[i])} ${esc(s.name)}: ${v}${unit}</title></rect>`; });
  });
  lines.forEach(s => {
    const pts = s.values.map((v, i) => [m.l + step * i + step / 2, m.t + H - H * v / max]);
    g += `<polyline fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" points="${pts.map(p => p.join(',')).join(' ')}"/>` + pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="3.5" fill="#fff" stroke="${s.color}" stroke-width="2"><title>${esc(labels[i])} ${esc(s.name)}: ${s.values[i]}</title></circle>`).join('');
  });
  const legend = series.map((s, i) => `<g transform="translate(${m.l + i * 120},8)"><rect width="12" height="12" rx="3" fill="${s.color}"/><text x="18" y="10" font-size="12" fill="#5b6270">${esc(s.name)}</text></g>`).join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" style="max-width:${width}px" role="img">${g}${legend}</svg>`;
}
// 横向条形图 items:[{label,value}]
function hbar(items, { color = '#d4202a', width = 520, unit = '' } = {}) {
  const max = Math.max(1, ...items.map(i => i.value)), rowH = 30, lw = 120, h = items.length * rowH + 6;
  const rows = items.map((it, i) => { const w = (width - lw - 70) * it.value / max; return `<text x="${lw - 8}" y="${i * rowH + 19}" text-anchor="end" font-size="12" fill="#5b6270">${esc(String(it.label).slice(0, 9))}</text><rect x="${lw}" y="${i * rowH + 6}" width="${Math.max(2, w)}" height="18" rx="4" fill="${color}" opacity="${1 - i * 0.05}"/><text x="${lw + w + 6}" y="${i * rowH + 19}" font-size="12" fill="#1f2329">${fmtN(it.value)}${unit}</text>`; }).join('');
  return `<svg viewBox="0 0 ${width} ${h}" width="100%" style="max-width:${width}px">${rows}</svg>`;
}
function donut(items, size = 180) {
  const total = items.reduce((a, i) => a + i.value, 0) || 1, colors = ['#d4202a', '#f2a93b', '#2a5bd7', '#16a34a', '#7c3aed', '#9aa1ad', '#0ea5e9'];
  let a0 = -Math.PI / 2, paths = ''; const r = size / 2 - 4, ri = r * 0.6, c = size / 2;
  items.forEach((it, i) => { if (!it.value) return; const a1 = a0 + 2 * Math.PI * it.value / total, large = a1 - a0 > Math.PI ? 1 : 0; const f = (a, rr) => `${c + rr * Math.cos(a)},${c + rr * Math.sin(a)}`;
    if (it.value === total) paths += `<circle cx="${c}" cy="${c}" r="${(r + ri) / 2}" fill="none" stroke="${colors[i % 7]}" stroke-width="${r - ri}"/>`; else paths += `<path d="M${f(a0, r)} A${r},${r} 0 ${large} 1 ${f(a1, r)} L${f(a1, ri)} A${ri},${ri} 0 ${large} 0 ${f(a0, ri)} Z" fill="${colors[i % 7]}"><title>${esc(it.label)}: ${it.value}</title></path>`; a0 = a1; });
  const leg = items.map((it, i) => `<div style="display:flex;gap:8px;align-items:center;font-size:13px"><i style="width:10px;height:10px;border-radius:3px;background:${colors[i % 7]}"></i>${esc(it.label)} <b>${it.value}</b> <span style="color:#9aa1ad">(${Math.round(it.value / total * 100)}%)</span></div>`).join('');
  return `<div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${paths}<text x="${c}" y="${c + 6}" text-anchor="middle" font-size="20" font-weight="700" fill="#1f2329">${total}</text></svg><div style="display:grid;gap:6px">${leg}</div></div>`;
}
module.exports = { trend, hbar, donut };
