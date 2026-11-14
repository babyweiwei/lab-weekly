import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import path from 'node:path';

const mode = process.argv[2] || 'demo';
const root = path.resolve(import.meta.dirname, '..');
let html = readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="[^"]+"><\/script>/g, '');

const summary = mode === 'summary'
  ? JSON.parse(readFileSync(path.join(import.meta.dirname, 'tmp/summary.json'), 'utf8'))
  : null;

const dom = new JSDOM(html, {
  url: mode === 'demo' ? 'https://example.test/#demo' : 'https://example.test/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
});
const { window } = dom;

window.fetch = async (u) => {
  if (summary && String(u).includes('data/summary.json')) {
    return { ok: true, json: async () => summary, text: async () => JSON.stringify(summary) };
  }
  throw new Error('unexpected fetch: ' + u);
};

for (const f of ['js/pptx.js', 'js/demo.js', 'js/app.js']) {
  window.eval(readFileSync(path.join(root, f), 'utf8'));
}
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
await new Promise((r) => setTimeout(r, 400));

const $ = (id) => window.document.getElementById(id);
const fail = [];
const check = (name, cond, extra = '') => {
  if (!cond) fail.push(name);
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ` → ${extra}` : ''));
};

check('看板已显示', $('board').hidden === false);
check('KPI 4 张卡', $('kpis').querySelectorAll('.kpi').length === 4);

const rows = $('matrix').querySelectorAll('tbody tr');
console.log('INFO 矩阵行数 =', rows.length, '| 卡片数 =', $('weekCards').querySelectorAll('.wcard').length);
check('矩阵行数 = 学生数', rows.length === (summary ? summary.students.length : 6), String(rows.length));

if (summary) {
  check('表格里出现 zhangsan 仓库', $('matrix').textContent.includes('weekly-zhangsan'));
  const sq = $('matrix').querySelector('.sq.has');
  check('有可点格子', !!sq, sq ? sq.dataset.wk : '无');
  if (sq) {
    sq.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    check('详情打开', $('detailOverlay').hidden === false);
    check('文件名正确渲染', $('detailBody').textContent.includes('.pptx'));
    check('进展文字可见', $('detailBody').textContent.includes('完成实验 A'));
    const pv = $('detailBody').querySelector('[data-preview]');
    pv.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    check('无 Token 时提示去 GitHub 看原件', $('previewBody').textContent.includes('GitHub'), $('previewBody').textContent.slice(0, 60));
  }
}

if (fail.length) {
  console.error('\n失败项：\n- ' + fail.join('\n- '));
  process.exit(1);
}
console.log('\n全部通过');
