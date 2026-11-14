/* 用本地 mock 的 GitHub API 跑一遍 scripts/collect.mjs，验证汇总产物结构与字段 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(import.meta.dirname, 'tmp');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const week = (() => {
  const d = new Date();
  const day = d.getDay() || 7;
  const monday = new Date(d); monday.setHours(0, 0, 0, 0); monday.setDate(d.getDate() - (day - 1));
  const t = new Date(Date.UTC(monday.getFullYear(), monday.getMonth(), monday.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
})();

const repos = [
  { name: 'weekly-zhangsan', owner: { login: 'lab' }, default_branch: 'main', pushed_at: '2026-11-13T10:00:00Z' },
  { name: 'weekly-lisi', owner: { login: 'lab' }, default_branch: 'master', pushed_at: '2026-11-12T10:00:00Z' },
];

const treeOf = (name) => ({
  tree: [
    { type: 'blob', path: `${week}/组会汇报-${name}.pptx`, size: 3456789, sha: 'sha-' + name },
    { type: 'blob', path: `${week}/README.md`, size: 120, sha: 'sha-md-' + name },
    { type: 'blob', path: `2020-W01/old.pptx`, size: 1, sha: 'old' },
    { type: 'tree', path: week, sha: 'x' },
  ],
});

const server = createServer((req, res) => {
  const url = req.url;
  const json = (v, code = 200) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(v));
  };
  if (url.startsWith('/orgs/lab/repos')) return json(repos);
  if (url.match(/^\/repos\/lab\/weekly-\w+\/git\/trees\//)) {
    const name = url.split('/')[3];
    return json(treeOf(name));
  }
  if (url.match(/^\/repos\/lab\/weekly-\w+\/commits/)) {
    return json([{ sha: 'abcdef1234567890', commit: { author: { date: '2026-11-13T12:00:00Z' }, message: 'add report\n\nbody' } }]);
  }
  if (url.match(/^\/repos\/lab\/weekly-\w+\/contents\//)) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('## 本周进展\n- 完成实验 A\n');
  }
  json({ message: 'not found', url }, 404);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const output = path.join(outDir, 'summary.json');
// 注意：必须用异步 spawn —— spawnSync 会阻塞事件循环，同进程里的 mock server 就没法响应了
const child = spawn(process.execPath, [path.join(root, 'scripts/collect.mjs')], {
  env: {
    ...process.env,
    GITHUB_API: `http://127.0.0.1:${port}`,
    ORG: 'lab',
    ORG_READ_TOKEN: 'fake',
    REPO_PREFIX: 'weekly-',
    WEEKS: '24',
    INCLUDE_PROGRESS: '1',
    INCLUDE_MESSAGE: '1',
    OUTPUT: output,
  },
});

let stdout = '';
let stderr = '';
child.stdout.on('data', (d) => { stdout += d; });
child.stderr.on('data', (d) => { stderr += d; });

const code = await new Promise((r) => child.on('close', r));
server.close();

console.log(stdout.trim());
if (code !== 0) {
  console.error(stderr);
  process.exit(1);
}

const data = JSON.parse(readFileSync(output, 'utf8'));
const fail = [];
const check = (name, cond, extra = '') => {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? ` → ${extra}` : ''));
  if (!cond) fail.push(name);
};

check('2 名学生', data.students.length === 2, String(data.students.length));
check('owner/prefix 正确', data.owner === 'lab' && data.prefix === 'weekly-');
check('weeks 数量 24', data.weeks.length === 24, String(data.weeks.length));

const s = data.students.find((x) => x.repo === 'lab/weekly-zhangsan');
check('学生对象存在', !!s);
check('姓名去前缀', s.name === 'zhangsan', s.name);
check('分支被记录', s.branch === 'main', s.branch);
check('本周有 pptx', !!s.weeks[week] && s.weeks[week].files.length === 1, JSON.stringify(Object.keys(s.weeks)));
check('提交日期存在', !!(s.weeks[week] && s.weeks[week].commit && s.weeks[week].commit.date));
check('提交说明被包含', s.weeks[week].commit.message === 'add report', s.weeks[week].commit.message);
check('进展文字被包含', (s.weeks[week].progress || '').includes('完成实验 A'), s.weeks[week].progress);
check('文件链接指向 blob', s.weeks[week].files[0].url.includes('/blob/main/'), s.weeks[week].files[0].url);
check('过期周次被裁掉', !s.weeks['2020-W01']);

const lisi = data.students.find((x) => x.repo === 'lab/weekly-lisi');
check('master 分支仓库可用', lisi.branch === 'master');

if (fail.length) {
  console.error('\n失败项：' + fail.join(', '));
  process.exit(1);
}
console.log('\n汇总脚本验证通过');
