#!/usr/bin/env node
/* 把汇总结果写进 Actions 运行摘要（$GITHUB_STEP_SUMMARY） */
import { existsSync, readFileSync, appendFileSync } from 'node:fs';

const PATH = process.env.OUTPUT || 'data/summary.json';
const TARGET = process.env.GITHUB_STEP_SUMMARY;

if (!existsSync(PATH)) {
  console.log('（未生成 summary.json，可能还没配置 ORG 变量）');
  process.exit(0);
}
if (!TARGET) {
  console.log('（不在 Actions 环境里，跳过运行摘要）');
  process.exit(0);
}

const data = JSON.parse(readFileSync(PATH, 'utf8'));
const students = data.students || [];
const lastWeek = (data.weeks || []).slice(-1)[0];
const weekKey = lastWeek ? lastWeek.key : '';

let md = `\n### 汇总结果：${students.length} 名学生 · 最新周次 ${weekKey || '—'}\n\n`;
md += '| 学生 | 仓库 | 本周文件 | 最近推送 |\n|---|---|---|---|\n';
for (const s of students) {
  const entry = weekKey ? (s.weeks || {})[weekKey] : null;
  const n = entry && entry.files ? entry.files.length : 0;
  md += `| ${s.name || ''} | ${s.repo} | ${n ? n + ' 个' : '未提交'} | ${(s.pushed_at || '—').slice(0, 10)} |\n`;
}
appendFileSync(TARGET, md);
console.log('运行摘要已写入');
