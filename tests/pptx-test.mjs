import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const root = path.resolve(import.meta.dirname, '..');
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://example.test/',
  runScripts: 'dangerously',
});
const { window } = dom;
window.JSZip = JSZip; // 免去 CDN 加载
window.eval(readFileSync(path.join(root, 'js/pptx.js'), 'utf8'));

const buf = readFileSync(path.join(import.meta.dirname, 'test.pptx'));
const slides = await window.PPTX.parse(buf);

const fail = [];
const check = (n, c, e = '') => { console.log((c ? 'PASS ' : 'FAIL ') + n + (e ? ` → ${e}` : '')); if (!c) fail.push(n); };

check('解析出 2 页（按页序）', slides.length === 2, String(slides.length));
check('页码排序正确（1 在 3 前）', slides[0].index === 1 && slides[1].index === 3, slides.map((s) => s.index).join(','));
check('标题页 3 段', slides[0].paragraphs.length === 3, JSON.stringify(slides[0].paragraphs));
check('中文与中文标点保留', slides[0].paragraphs[0] === '张三 · 2026-W46 组会汇报', slides[0].paragraphs[0]);
check('实体解码 & < >', slides[0].paragraphs[2] === 'R&D 进展 <第一版>', slides[0].paragraphs[2]);
check('同段多 run 合并', slides[1].paragraphs[3] === '· 单元测试通过率 98%', slides[1].paragraphs[3]);
check('空段落被跳过', slides[1].paragraphs.length === 4, JSON.stringify(slides[1].paragraphs));

if (fail.length) { console.error('\n失败项：' + fail.join(', ')); process.exit(1); }
console.log('\npptx 解析验证通过');
