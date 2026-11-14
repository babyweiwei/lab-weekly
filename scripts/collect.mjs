#!/usr/bin/env node
/* 汇总学生私有仓库的每周汇报 → data/summary.json
   运行环境：GitHub Actions（ubuntu）。也可本地跑：ORG_READ_TOKEN=xxx ORG=lab node scripts/collect.mjs
   环境变量：
     ORG                 组织或用户名（必填）
     ORG_READ_TOKEN      有这些私有仓库 Contents 读权限的 token（必填）
     REPO_PREFIX         仓库名前缀，默认 weekly-
     WEEKS               汇总最近多少周，默认 24
     INCLUDE_PROGRESS    1 = 把每周 README/进展 的一小段文字放进 summary（公开仓库慎用），默认 0
     INCLUDE_MESSAGE     1 = 带上提交说明，默认 0
     ROSTER              可选，roster.json 路径（自定义学生名单与仓库映射）
     GITHUB_API          GitHub API 地址，默认 https://api.github.com（GitHub Enterprise 可改）
     OUTPUT              输出路径，默认 data/summary.json
*/
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const API = (process.env.GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
const ORG = process.env.ORG || '';
const TOKEN = process.env.ORG_READ_TOKEN || process.env.GITHUB_TOKEN || '';
const PREFIX = process.env.REPO_PREFIX || 'weekly-';
const WEEKS = Math.max(4, Math.min(52, parseInt(process.env.WEEKS || '24', 10) || 24));
const INCLUDE_PROGRESS = process.env.INCLUDE_PROGRESS === '1';
const INCLUDE_MESSAGE = process.env.INCLUDE_MESSAGE === '1';
const OUTPUT = process.env.OUTPUT || 'data/summary.json';
const PPT_EXT = ['pptx', 'ppt', 'pdf', 'key'];

const pad2 = (n) => String(n).padStart(2, '0');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function isoWeekOf(date) {
  const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { year: t.getUTCFullYear(), week: Math.ceil(((t - yearStart) / 86400000 + 1) / 7) };
}

function startOfWeekMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - (day - 1));
  return d;
}

function buildWeeks(count) {
  const monday = startOfWeekMonday(new Date());
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = addDays(monday, -i * 7);
    const iso = isoWeekOf(start);
    out.push({
      key: `${iso.year}-W${pad2(iso.week)}`,
      start: start.toISOString(),
      end: addDays(start, 6).toISOString(),
    });
  }
  return out;
}

function normKey(k) {
  const m = /^(\d{4})-W(\d{1,2})$/.exec(String(k).trim());
  return m ? `${m[1]}-W${pad2(+m[2])}` : null;
}

async function gh(path) {
  const url = path.startsWith('http') ? path : API + path;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${TOKEN}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'lab-weekly-collector',
      },
    });
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') {
        const reset = Number(res.headers.get('x-ratelimit-reset') || 0) * 1000;
        const wait = Math.min(60000, Math.max(1000, reset - Date.now() + 1000));
        console.warn(`触发限流，等待 ${wait}ms 后重试…`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
    }
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); if (j.message) msg = j.message; } catch { /* ignore */ }
      const err = new Error(`${res.status} ${msg} (${url})`);
      err.status = res.status;
      throw err;
    }
    return res;
  }
  throw new Error(`请求失败（重试后仍失败）：${url}`);
}

async function ghJson(path) {
  const res = await gh(path);
  return res.json();
}

async function ghText(path) {
  const res = await gh(path);
  return res.text();
}

async function listRepos(org) {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    let batch;
    try {
      batch = await ghJson(`/orgs/${org}/repos?per_page=100&page=${page}&type=all&sort=pushed`);
    } catch (e) {
      if (e.status === 404 && page === 1) {
        batch = await ghJson(`/users/${org}/repos?per_page=100&page=${page}&sort=pushed`);
      } else throw e;
    }
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

function decodeName(repoName) {
  return repoName.startsWith(PREFIX) ? repoName.slice(PREFIX.length) : repoName;
}

async function scanRepo(repo, weeks, rosterEntry) {
  const owner = repo.owner?.login || ORG;
  const branch = repo.default_branch || 'main';
  let tree;
  try {
    tree = await ghJson(`/repos/${owner}/${repo.name}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  } catch (e) {
    console.warn(`  跳过 ${owner}/${repo.name}：${e.message}`);
    return null;
  }

  const byWeek = {};
  for (const item of tree.tree || []) {
    if (item.type !== 'blob') continue;
    const idx = item.path.lastIndexOf('/');
    if (idx < 0) continue;
    const key = normKey(item.path.slice(0, idx).split('/')[0]);
    if (!key) continue;
    const name = item.path.slice(idx + 1);
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!byWeek[key]) byWeek[key] = { files: [], docs: [] };
    const entryFile = {
      name,
      path: item.path,
      size: item.size || 0,
      sha: item.sha,
      url: `https://github.com/${owner}/${repo.name}/blob/${branch}/` + item.path.split('/').map(encodeURIComponent).join('/'),
    };
    if (PPT_EXT.includes(ext)) byWeek[key].files.push(entryFile);
    else if (ext === 'md') byWeek[key].docs.push(entryFile);
  }

  const validKeys = Object.keys(byWeek).filter((k) => weeks.some((w) => w.key === k));
  for (const key of validKeys) {
    try {
      const commits = await ghJson(`/repos/${owner}/${repo.name}/commits?path=${encodeURIComponent(key)}&per_page=1`);
      if (commits?.length) {
        const c = commits[0];
        byWeek[key].commit = {
          date: c.commit?.author?.date || c.commit?.committer?.date,
          sha: (c.sha || '').slice(0, 7),
          ...(INCLUDE_MESSAGE ? { message: (c.commit?.message || '').split('\n')[0].slice(0, 120) } : {}),
        };
      }
    } catch (e) {
      console.warn(`  取 ${key} 提交记录失败：${e.message}`);
    }

    if (INCLUDE_PROGRESS) {
      const doc = byWeek[key].docs.find((d) => /^(README|进展|readme|progress)/i.test(d.name));
      if (doc) {
        try {
          const text = await ghText(`/repos/${owner}/${repo.name}/contents/` +
            doc.path.split('/').map(encodeURIComponent).join('/') + `?ref=${encodeURIComponent(branch)}`);
          byWeek[key].progress = text.replace(/\r/g, '').trim().slice(0, 400);
        } catch (e) { /* 没有进展文档就算了 */ }
      }
    }
    delete byWeek[key].docs;
  }

  return {
    login: rosterEntry?.login || owner,
    name: rosterEntry?.name || decodeName(repo.name),
    repo: `${owner}/${repo.name}`,
    url: `https://github.com/${owner}/${repo.name}`,
    branch,
    pushed_at: repo.pushed_at,
    weeks: Object.fromEntries(validKeys.map((k) => [k, byWeek[k]])),
  };
}

async function main() {
  if (!TOKEN) throw new Error('缺少 ORG_READ_TOKEN');

  const weeks = buildWeeks(WEEKS);
  console.log(`汇总 ${ORG} 下以 ${PREFIX} 开头的仓库，最近 ${WEEKS} 周…`);

  let roster = null;
  if (process.env.ROSTER) {
    try {
      roster = JSON.parse(await readFile(process.env.ROSTER, 'utf8'));
      console.log(`读取自定义名单：${roster.length} 人`);
    } catch (e) {
      console.warn(`roster 读取失败：${e.message}`);
    }
  }

  if (!ORG && !(roster && roster.length)) throw new Error('缺少 ORG（组织或用户名），也没有可用的 roster.json');

  let repos;
  if (roster && roster.length) {    // 自定义名单：仓库可以分散在不同 owner 下
    repos = roster.map((r) => {
      const [owner, name] = r.repo.split('/');
      return {
        name,
        owner: { login: owner },
        default_branch: r.branch || 'main',
        pushed_at: null,
      };
    });
  } else {
    try {
      repos = await listRepos(ORG);
    } catch (e) {
      if (e.status !== 404) throw e;
      // 个人账号：/users 只给公开仓库，私有仓库从 /user/repos 过滤
      const mine = await ghJson('/user/repos?per_page=100&visibility=all&sort=pushed');
      repos = mine.filter((r) => (r.owner?.login || '') === ORG);
    }
    repos = (repos || []).filter((r) => r.name.startsWith(PREFIX));
  }
  console.log(`找到 ${repos.length} 个仓库`);

  const students = [];
  for (const repo of repos) {
    const rosterEntry = roster?.find((r) => r.repo === `${repo.owner.login || ORG}/${repo.name}`);
    console.log(`- ${repo.owner?.login || ORG}/${repo.name}`);
    const st = await scanRepo(repo, weeks, rosterEntry);
    if (st) students.push(st);
  }

  students.sort((a, b) => (b.pushed_at || '').localeCompare(a.pushed_at || ''));

  const payload = {
    generated_at: new Date().toISOString(),
    owner: ORG || 'roster',
    prefix: PREFIX,
    weeks: weeks.map((w) => ({ key: w.key, start: w.start, end: w.end })),
    students,
  };

  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`已写入 ${OUTPUT}：${students.length} 名学生`);
}

main().catch((e) => {
  console.error('汇总失败：' + e.message);
  process.exit(1);
});
