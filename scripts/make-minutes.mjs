/**
 * make-minutes.mjs — 从索引自动生成每周组会纪要（HTML，可直接给老师看）
 *
 * 用法：node scripts/make-minutes.mjs [--index data/index.json] [--out minutes]
 * 输出：minutes/2026-W47.html + minutes/index.html
 *
 * 规则：每人一句话，口吻沿用现有纪要（"X汇报了……"）。
 * 素材只用 PPT 文本索引，不编造没看到的内容；没提交的人如实写"未提交材料"。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const INDEX = flag('index', 'data/index.json');
const CONFIG = flag('config', 'config/meeting.json');
const OUT = flag('out', 'minutes');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function pad(n) { return (n < 10 ? '0' : '') + n; }

function weekMonday(weekKey) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return null;
  const year = +m[1], week = +m[2];
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4.getTime());
  const dow = (jan4.getDay() + 6) % 7;
  monday.setDate(jan4.getDate() - dow + (week - 1) * 7);
  return monday;
}

function meetingDate(weekKey, cfg) {
  const monday = weekMonday(weekKey);
  if (!monday) return null;
  const WD = { 周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 0, 星期天: 0 };
  const wd = WD[cfg['默认开会日']] != null ? WD[cfg['默认开会日']] : 6;
  const hm = String(cfg['默认开会时间'] || '19:00').split(':');
  const d = new Date(monday.getTime());
  d.setDate(d.getDate() + (wd === 0 ? 6 : wd - 1));
  d.setHours(+hm[0], +hm[1] || 0, 0, 0);
  return d;
}

function pickPoint(text) {
  const body = String(text || '').replace(/^【第\d+页】/, '');
  const parts = body.split(/[·•]/).map((s) => s.trim()).filter((s) => s.length >= 4);
  if (!parts.length) return body.slice(0, 60);
  const withNum = parts.filter((p) => /\d/.test(p));
  return (withNum[0] || parts[0]).slice(0, 80);
}

function summarize(file) {
  const slides = (file.slidesText || []).slice();
  if (!slides.length) return '（无可提取文字）';
  const points = [];
  for (const s of slides.slice(1, 4)) {
    const p = pickPoint(s);
    if (p && points.indexOf(p) < 0) points.push(p);
  }
  if (!points.length) points.push(pickPoint(slides[0]));
  return points.slice(0, 2).join('；');
}

function pageHtml({ week, cfg, meet, rows, total }) {
  const dateStr = meet ? `${meet.getFullYear()}年${meet.getMonth() + 1}月${meet.getDate()}日` : '（日期待定）';
  const people = rows.map((r) => esc(r.name) + (r.has ? '' : '（未提交材料）')).join('、');
  const body = rows.map((r) => {
    if (!r.has) return `<p class="p miss">${esc(r.name)}本周未提交材料。</p>`;
    return `<p class="p">${esc(r.name)}汇报了${esc(summarize(r.file))}。</p>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>组会纪要 · ${esc(week)}</title>
<style>
  body{margin:0;background:#f6f8fa;color:#1f2328;font:15px/1.9 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC",Helvetica,Arial,sans-serif}
  .sheet{max-width:760px;margin:24px auto;background:#fff;border:1px solid #d1d9e0;border-radius:10px;padding:32px 38px}
  h1{font-size:19px;margin:0 0 18px;font-weight:600}
  .meta{font-size:14.5px;line-height:2;border-bottom:1px solid #eaeef2;padding-bottom:14px;margin-bottom:18px}
  .meta div span{color:#59636e;display:inline-block;min-width:78px}
  .p{text-indent:2em;margin:0 0 10px;font-size:14.5px}
  .p.miss{color:#9a6700;text-indent:2em}
  .foot{margin-top:22px;border-top:1px solid #eaeef2;padding-top:12px;color:#59636e;font-size:12.5px}
  @media print{body{background:#fff}.sheet{border:0;margin:0;padding:0}}
</style>
</head>
<body>
<div class="sheet">
  <h1>组会纪要 · ${esc(week)}</h1>
  <div class="meta">
    <div><span>开会日期：</span>${esc(dateStr)}</div>
    <div><span>开会地点：</span>${esc(cfg['地点'] || '')}</div>
    <div><span>开始时间：</span>${esc(cfg['默认开会时间'] || '')}</div>
    <div><span>结束时间：</span>—</div>
    <div><span>参会人员：</span>${people}</div>
  </div>
${body}
  <div class="foot">
    本周应交 ${total} 人，实收 ${rows.filter((r) => r.has).length} 人。内容由各人 PPT 文字自动提取，图片与图表请看原件。<br>
    生成时间 ${new Date().toLocaleString('zh-CN')}
  </div>
</div>
</body>
</html>
`;
}

async function main() {
  const cfg = JSON.parse(await readFile(CONFIG, 'utf8'));
  const idx = JSON.parse(await readFile(INDEX, 'utf8'));
  const roster = ((cfg['名单'] || {})['学生']) || [];
  const weeks = new Set();
  for (const f of idx.files || []) if (f.week) weeks.add(f.week);
  if (!weeks.size) {
    console.error('索引里没有带周次的文件，先跑 node scripts/build-index.mjs');
    process.exit(1);
  }

  await mkdir(OUT, { recursive: true });
  const built = [];

  for (const week of [...weeks].sort()) {
    const files = (idx.files || []).filter((f) => f.week === week);
    const rows = [];
    const seen = new Set();
    for (const n of roster) {
      const f = files.find((x) => (x.student || '').trim() === n);
      rows.push({ name: n, has: !!f, file: f || null });
      seen.add(n);
    }
    for (const f of files) {
      const n = (f.student || '').trim();
      if (n && !seen.has(n)) rows.push({ name: n, has: true, file: f });
    }

    const meet = meetingDate(week, cfg);
    const html = pageHtml({ week, cfg, meet, rows, total: roster.length });
    await writeFile(join(OUT, `${week}.html`), html, 'utf8');
    built.push({ week, got: rows.filter((r) => r.has).length, total: roster.length, meet });
    console.log(`✓ ${week}  实收 ${rows.filter((r) => r.has).length}/${roster.length}`);
  }

  const listHtml = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>组会纪要 · 全部</title>
<style>
 body{margin:0;background:#f6f8fa;color:#1f2328;font:14px/1.7 -apple-system,"Segoe UI","Noto Sans SC",sans-serif}
 .wrap{max-width:760px;margin:24px auto;padding:0 16px}
 h1{font-size:19px}
 table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d1d9e0;border-radius:10px;overflow:hidden}
 td,th{padding:10px 12px;border-bottom:1px solid #eef1f4;text-align:left;font-size:13.5px}
 th{background:#f0f3f6;font-size:12.5px}
 a{color:#0969da;text-decoration:none}
 .dim{color:#9aa4ae}
</style></head>
<body><div class="wrap">
<h1>组会纪要 · 全部</h1>
<table><thead><tr><th>周次</th><th>开会日期</th><th>实收</th><th>纪要</th></tr></thead><tbody>
${built.map((b) => `<tr><td>${esc(b.week)}</td><td>${b.meet ? (b.meet.getMonth() + 1) + '月' + b.meet.getDate() + '日' : '<span class="dim">—</span>'}</td><td>${b.got}/${b.total}</td><td><a href="./${esc(b.week)}.html">打开</a></td></tr>`).join('\n')}
</tbody></table>
<p class="dim" style="margin-top:14px">生成时间 ${new Date().toLocaleString('zh-CN')} · 数据来源 ${esc(INDEX)}</p>
</div></body></html>`;
  await writeFile(join(OUT, 'index.html'), listHtml, 'utf8');
  console.log(`\n已生成 ${built.length} 份纪要 + 目录：${OUT}/index.html`);
}

main().catch((e) => { console.error(e); process.exit(1); });
