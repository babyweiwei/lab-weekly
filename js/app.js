/* 组会汇报看板 — 主逻辑
   数据来源三种：
   1. demo     本地演示数据
   2. summary  由 GitHub Actions 定时生成的 data/summary.json（默认，无需登录）
   3. live     浏览器带 Token 直连 GitHub API（可选，能页面内预览私有 PPT） */
(function () {
  'use strict';

  const CFG_KEY = 'lab-weekly-cfg-v1';
  const API = 'https://api.github.com';
  const STATUS_TEXT = { ok: '按时提交', late: '迟交', todo: '待提交', miss: '未提交', future: '未开始' };

  const cfg = {
    owner: '',
    prefix: 'weekly-',
    weeks: 12,
    token: '',
    deadline: 'sunday',
  };

  const state = {
    mode: null,      // demo | summary | live
    weeks: [],       // 24 周，渲染时按 cfg.weeks 切片
    students: [],
    generatedAt: null,
    filter: '',
    accounts: {},
    busy: false,
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  /* ---------------- 日期 / 周 ---------------- */
  const pad2 = (n) => String(n).padStart(2, '0');
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

  function isoWeekOf(date) {
    const t = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return { year: t.getUTCFullYear(), week };
  }

  function startOfWeekMonday(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay() || 7;      // 1=周一 ... 7=周日
    d.setDate(d.getDate() - (day - 1));
    return d;
  }

  function buildWeeks(count) {
    const monday = startOfWeekMonday(new Date());
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const start = addDays(monday, -i * 7);
      const iso = isoWeekOf(start);
      const end = addDays(start, 6);
      out.push({
        key: `${iso.year}-W${pad2(iso.week)}`,
        start,
        end,
        label: `W${pad2(iso.week)}`,
        dateLabel: `${pad2(start.getMonth() + 1)}/${pad2(start.getDate())}`,
        endLabel: `${pad2(end.getMonth() + 1)}/${pad2(end.getDate())}`,
      });
    }
    return out;
  }

  function deadlineOf(week) {
    if (cfg.deadline === 'none') return null;
    if (cfg.deadline === 'meeting') {
      const d = addDays(week.end, 1);
      d.setHours(9, 0, 0, 0);   // 周一 09:00 组会前
      return d;
    }
    const d = new Date(week.end);
    d.setHours(23, 59, 59, 0);   // 周日 23:59
    return d;
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    const y = d.getFullYear();
    return `${y}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function relTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '';
    const diff = Date.now() - t;
    const m = Math.round(diff / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return `${m} 分钟前`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} 小时前`;
    const d = Math.round(h / 24);
    if (d < 30) return `${d} 天前`;
    return fmtDate(iso).slice(0, 10);
  }

  /* ---------------- 配置 ---------------- */
  function loadCfg() {
    try {
      const raw = localStorage.getItem(CFG_KEY);
      if (raw) Object.assign(cfg, JSON.parse(raw));
    } catch (e) { /* 忽略损坏的配置 */ }
  }
  function saveCfg() {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { /* 隐私模式可能禁用 */ }
  }

  /* ---------------- 提示 ---------------- */
  let toastTimer = null;
  function toast(msg, isErr) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (isErr ? ' err' : '');
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isErr ? 5000 : 3200);
  }

  /* ---------------- 并发控制 ---------------- */
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    });
    await Promise.all(workers);
    return out;
  }

  /* ---------------- GitHub API ---------------- */
  async function gh(path, opt) {
    opt = opt || {};
    const res = await fetch(path.startsWith('http') ? path : API + path, {
      headers: {
        Accept: opt.accept || 'application/vnd.github+json',
        Authorization: 'Bearer ' + cfg.token,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) {
      let msg = res.statusText;
      try {
        const j = await res.json();
        if (j && j.message) msg = j.message;
      } catch (e) { /* 非 JSON 响应 */ }
      const err = new Error(`${res.status} ${msg}`);
      err.status = res.status;
      throw err;
    }
    return opt.raw ? res : res.json();
  }

  async function listRepos(owner) {
    try {
      return await gh(`/orgs/${owner}/repos?per_page=100&type=all&sort=pushed`);
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    // 个人账号：/users 接口只返回公开仓库，私有仓库要走 /user/repos 再按 owner 过滤
    try {
      const mine = await gh('/user/repos?per_page=100&visibility=all&sort=pushed');
      const filtered = (mine || []).filter((r) => (r.owner && r.owner.login) === owner);
      if (filtered.length) return filtered;
    } catch (e) { /* 继续尝试公开列表 */ }
    return await gh(`/users/${owner}/repos?per_page=100&sort=pushed`);
  }

  function normKey(k) {
    const m = /^(\d{4})-W(\d{1,2})$/.exec(String(k).trim());
    if (!m) return null;
    return `${m[1]}-W${pad2(+m[2])}`;
  }

  async function scanRepo(repo, weeks) {
    const owner = repo.owner && repo.owner.login ? repo.owner.login : cfg.owner;
    const branch = repo.default_branch || 'main';
    const treeRes = await gh(`/repos/${owner}/${repo.name}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
    const files = (treeRes.tree || []).filter((t) => t.type === 'blob');

    const entries = {};
    for (const f of files) {
      const i = f.path.lastIndexOf('/');
      if (i < 0) continue;
      const key = normKey(f.path.slice(0, i).split('/')[0]);
      if (!key) continue;
      if (!entries[key]) entries[key] = { files: [], docs: [] };
      const name = f.path.slice(i + 1);
      const ext = (name.split('.').pop() || '').toLowerCase();
      const url = `https://github.com/${owner}/${repo.name}/blob/${branch}/` +
        f.path.split('/').map(encodeURIComponent).join('/');
      const item = { name, path: f.path, size: f.size, sha: f.sha, url };
      if (['pptx', 'ppt', 'pdf', 'key'].includes(ext)) entries[key].files.push(item);
      else if (ext === 'md') entries[key].docs.push(item);
    }

    const keys = Object.keys(entries).filter((k) => entries[k].files.length && weeks.some((w) => w.key === k));
    await mapLimit(keys, 3, async (key) => {
      try {
        const commits = await gh(`/repos/${owner}/${repo.name}/commits?path=${encodeURIComponent(key)}&per_page=1`);
        if (commits && commits.length) {
          const c = commits[0];
          entries[key].commit = {
            date: c.commit.author ? c.commit.author.date : c.commit.committer.date,
            sha: (c.sha || '').slice(0, 7),
            message: (c.commit.message || '').split('\n')[0],
          };
        }
      } catch (e) { /* 空仓库或无提交，忽略 */ }
    });

    return {
      login: (repo.owner && repo.owner.login) || owner,
      name: repo.name.replace(new RegExp('^' + cfg.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), '') || repo.name,
      repo: `${owner}/${repo.name}`,
      repoName: repo.name,
      branch,
      url: `https://github.com/${owner}/${repo.name}`,
      pushedAt: repo.pushed_at,
      weeks: entries,
    };
  }

  /* ---------------- 状态计算 ---------------- */
  function filesOf(st, key) {
    const e = st.weeks && st.weeks[key];
    return e && e.files ? e.files : [];
  }

  function statusOf(st, week) {
    const now = new Date();
    const files = filesOf(st, week.key);
    if (week.start > now) return 'future';
    if (!files.length) {
      return week.end >= now ? 'todo' : 'miss';
    }
    const entry = st.weeks[week.key];
    const dl = deadlineOf(week);
    if (!dl) return 'ok';
    const d = entry.commit && entry.commit.date ? new Date(entry.commit.date) : null;
    if (!d || isNaN(d)) return 'ok';
    return d > dl ? 'late' : 'ok';
  }

  /* ---------------- 数据加载 ---------------- */
  function resetView() {
    state.mode = null;
    state.students = [];
    state.generatedAt = null;
    $('gate').hidden = false;
    $('board').hidden = true;
  }

  function loadDemo() {
    state.weeks = buildWeeks(24);
    const data = window.buildDemoData(state.weeks);
    state.mode = 'demo';
    state.students = data.students;
    state.generatedAt = data.generated_at;
    renderAll();
  }

  function applySummary(json) {
    state.mode = 'summary';
    state.weeks = buildWeeks(24);
    state.generatedAt = json.generated_at || null;
    state.students = (json.students || []).map((s) => ({
      login: s.login || '',
      name: s.name || s.login || s.repo || '',
      repo: s.repo || '',
      repoName: (s.repo || '').split('/').pop(),
      branch: s.branch || 'main',
      url: s.url || (s.repo ? 'https://github.com/' + s.repo : ''),
      pushedAt: s.pushed_at || null,
      weeks: s.weeks || {},
    }));
    if (json.owner) cfg.owner = cfg.owner || json.owner;
    if (json.prefix) cfg.prefix = json.prefix;
    renderAll();
  }

  async function loadLive(quiet) {
    if (!cfg.token) throw new Error('未配置 Token');
    if (!cfg.owner) throw new Error('请先在设置中填写组织或用户名');
    if (state.busy) return;
    state.busy = true;
    $('btnRefresh').disabled = true;
    try {
      const me = await gh('/user').catch(() => null);
      if (me) state.accounts[me.login] = me;
      const repos = await listRepos(cfg.owner);
      const filtered = (repos || []).filter((r) => r.name.indexOf(cfg.prefix) === 0);
      if (!filtered.length) throw new Error(`没有找到以 ${cfg.prefix} 开头的仓库`);
      state.weeks = buildWeeks(24);
      state.students = await mapLimit(filtered, 4, (r) => scanRepo(r, state.weeks));
      state.students.sort((a, b) => (b.pushedAt || '').localeCompare(a.pushedAt || ''));
      state.mode = 'live';
      state.generatedAt = new Date().toISOString();
      renderAll();
      if (!quiet) toast(`已从 GitHub 拉取 ${state.students.length} 个学生仓库`);
    } finally {
      state.busy = false;
      $('btnRefresh').disabled = false;
    }
  }

  async function boot() {
    loadCfg();
    fillSettings();
    if (location.hash === '#demo') { loadDemo(); return; }
    if (cfg.token) {
      try { await loadLive(true); return; } catch (e) { toast('Token 模式加载失败：' + e.message, true); }
    }
    try {
      const res = await fetch('data/summary.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('summary.json 不存在');
      applySummary(await res.json());
    } catch (e) {
      loadDemo();
      toast('未找到 data/summary.json，已显示演示数据');
    }
  }

  function renderGate() {
    $('gate').hidden = false;
    $('board').hidden = true;
    $('gateHint').innerHTML =
      '当前没有可读的汇总数据（<code>data/summary.json</code>）。<br>' +
      '若你刚 fork 本仓库：先在 Actions 里配置 <code>ORG</code> / <code>ORG_READ_TOKEN</code> 并手动运行一次「汇总并发布看板」，' +
      '详见 <a href="docs/部署指南.md">docs/部署指南.md</a>；也可以点右上角「设置」用手里的 Token 直接连 GitHub。';
  }

  /* ---------------- 渲染 ---------------- */
  function renderAll() {
    $('gate').hidden = true;
    $('board').hidden = false;

    const oldBanner = document.getElementById('demoBanner');
    if (oldBanner) oldBanner.remove();
    if (state.mode === 'demo') {
      const b = document.createElement('div');
      b.id = 'demoBanner';
      b.style.cssText = 'background:#ddf4ff;border:1px solid #b6e3ff;color:#0a3069;border-radius:6px;padding:8px 12px;font-size:12px;margin-bottom:14px';
      b.innerHTML = '当前显示的是<b>演示数据</b>。按 <a href="docs/部署指南.md">部署指南</a> 配好 ORG 与 Token 后刷新即显示真实汇总。';
      $('kpis').before(b);
    }
    renderWho();
    renderKpis();
    renderMatrix();
    renderWeekCards();
    $('footMode').textContent = state.mode === 'live'
      ? ' · 当前为 Token 实时模式'
      : state.mode === 'demo'
        ? ' · 当前为演示数据'
        : ' · 数据更新于 ' + (state.generatedAt ? fmtDate(state.generatedAt) : '未知');
  }

  function renderWho() {
    const me = Object.values(state.accounts)[0];
    const el = $('who');
    if (state.mode === 'live' && me) {
      el.hidden = false;
      $('whoAvatar').src = me.avatar_url || '';
      $('whoName').textContent = me.login;
    } else if (state.mode === 'summary' && cfg.owner) {
      el.hidden = false;
      $('whoAvatar').src = `https://github.com/${encodeURIComponent(cfg.owner)}.png?size=64`;
      $('whoName').textContent = cfg.owner;
    } else {
      el.hidden = true;
    }
  }

  function currentWeek() {
    return state.weeks[state.weeks.length - 1];
  }

  function initialOf(s) {
    const n = (s.name || s.login || '?').trim();
    return n ? n.slice(0, 1).toUpperCase() : '?';
  }

  function renderKpis() {
    const w = currentWeek();
    const total = state.students.length;
    const submitted = state.students.filter((s) => statusOf(s, w) === 'ok' || statusOf(s, w) === 'late').length;
    const late = state.students.filter((s) => statusOf(s, w) === 'late').length;
    const recent = state.weeks.slice(-4);
    let ok = 0, expected = 0, recentLate = 0;
    state.students.forEach((s) => recent.forEach((wk) => {
      if (wk.start > new Date()) return;
      expected++;
      const st = statusOf(s, wk);
      if (st === 'ok') ok++;
      if (st === 'late') recentLate++;
    }));
    const rate = expected ? Math.round((ok / expected) * 100) : 0;
    let pptCount = 0;
    state.students.forEach((s) => {
      Object.keys(s.weeks || {}).forEach((k) => { pptCount += filesOf(s, k).length; });
    });

    $('kpis').innerHTML = `
      <div class="kpi"><div class="k">学生</div><div class="v">${total}</div><div class="d">${esc(cfg.prefix)}* 私有仓库</div></div>
      <div class="kpi"><div class="k">本周已提交</div><div class="v ${submitted === total && total ? 'green' : submitted ? 'amber' : 'red'}">${submitted}/${total}</div><div class="d">${w.label} · 截止 ${cfg.deadline === 'none' ? '不判定' : esc(cfg.deadline === 'meeting' ? '周一 09:00' : '周日 23:59')}</div></div>
      <div class="kpi"><div class="k">近 4 周按时率</div><div class="v ${rate >= 80 ? 'green' : rate >= 50 ? 'amber' : 'red'}">${rate}%</div><div class="d">${recentLate ? `近 4 周迟交 ${recentLate} 次` : '近 4 周全部按时'}</div></div>
      <div class="kpi"><div class="k">累计汇报文件</div><div class="v">${pptCount}</div><div class="d">PPT / PDF / Keynote</div></div>`;
  }

  function visibleWeeks() {
    return state.weeks.slice(-cfg.weeks);
  }

  function renderMatrix() {
    const weeks = visibleWeeks();
    const kw = state.filter.trim().toLowerCase();
    const rows = state.students.filter((s) => !kw ||
      (s.name || '').toLowerCase().includes(kw) ||
      (s.login || '').toLowerCase().includes(kw) ||
      (s.repo || '').toLowerCase().includes(kw));

    const head = `<thead><tr><th>学生 / 仓库</th>${
      weeks.map((w) => `<th><span class="wk">${w.label}</span><span class="dt">${w.dateLabel}</span></th>`).join('')
    }</tr></thead>`;

    const body = `<tbody>${rows.map((s) => {
      const cells = weeks.map((w) => {
        const st = statusOf(s, w);
        const has = filesOf(s, w.key).length;
        const tip = `${s.name || s.login} · ${w.key} · ${STATUS_TEXT[st]}${has ? ` · ${has} 个文件` : ''}`;
        return `<td class="cell"><span class="sq ${st}${has ? ' has' : ''}" data-stu="${esc(s.repo)}" data-wk="${w.key}" title="${esc(tip)}"></span></td>`;
      }).join('');
      return `<tr><td>
        <div class="stu">
          <span class="avatar">${esc(initialOf(s))}<img loading="lazy" src="https://github.com/${encodeURIComponent(s.login)}.png?size=48" alt="" onerror="this.style.display='none'"></span>
          <div style="min-width:0">
            <span class="stu-name">${esc(s.name || s.login)}</span>
            <span class="stu-repo" title="${esc(s.repo)}">${esc(s.repoName || s.repo)}</span>
          </div>
        </div></td>${cells}</tr>`;
    }).join('')}</tbody>`;

    $('matrix').innerHTML = head + body;
    $('matrixSub').textContent = `共 ${rows.length} 名学生 · ${weeks[0].key} ~ ${weeks[weeks.length - 1].key}`;

    if (!rows.length) {
      $('matrix').innerHTML = head + `<tbody><tr><td colspan="${weeks.length + 1}"><div class="empty">没有匹配的学生</div></td></tr></tbody>`;
    }
  }

  function renderWeekCards() {
    const w = currentWeek();
    const kw = state.filter.trim().toLowerCase();
    const rows = state.students.filter((s) => !kw ||
      (s.name || '').toLowerCase().includes(kw) ||
      (s.login || '').toLowerCase().includes(kw) ||
      (s.repo || '').toLowerCase().includes(kw));

    const order = { late: 0, todo: 1, miss: 2, ok: 3, future: 4 };
    rows.sort((a, b) => order[statusOf(a, w)] - order[statusOf(b, w)]);

    $('weekTitle').textContent = `${w.label} 本周进展`;
    $('weekSub').textContent = `${w.dateLabel} – ${w.endLabel} · 截止 ${
      cfg.deadline === 'none' ? '不判定迟到' : cfg.deadline === 'meeting' ? '周一 09:00' : '周日 23:59'}`;

    $('weekCards').innerHTML = rows.map((s) => {
      const st = statusOf(s, w);
      const entry = s.weeks[w.key] || {};
      const files = entry.files || [];
      const progress = (entry.progress || '').trim();
      const fileRows = files.slice(0, 3).map((f) => `
        <div class="file-row">
          <span class="file-icon">📑</span>
          <a class="file-name" href="${esc(f.url)}" target="_blank" rel="noopener" title="${esc(f.name)}">${esc(f.name)}</a>
          <span class="fsize">${fmtSize(f.size)}</span>
        </div>`).join('');

      return `<div class="wcard">
        <div class="wcard-head">
          <div class="wcard-who">
            <span class="avatar">${esc(initialOf(s))}<img loading="lazy" src="https://github.com/${encodeURIComponent(s.login)}.png?size=64" alt="" onerror="this.style.display='none'"></span>
            <span class="stu-name">${esc(s.name || s.login)}</span>
          </div>
          <span class="badge ${st}">${STATUS_TEXT[st]}</span>
        </div>
        <div class="wcard-meta">
          ${files.length ? `<span>${files.length} 个文件</span>` : '<span>暂无文件</span>'}
          ${entry.commit ? `<span>${relTime(entry.commit.date)}</span><span class="muted">${esc(entry.commit.sha || '')}</span>` : ''}
        </div>
        ${fileRows ? `<div class="wcard-files">${fileRows}</div>` : ''}
        <div class="wcard-progress">${progress ? esc(progress) : '<span class="muted">（仓库里没有 README / 进展说明）</span>'}</div>
        <div class="wcard-actions">
          <button class="btn" data-open="${esc(s.repo)}" data-wk="${w.key}">查看详情</button>
          <a class="btn ghost" href="${esc(s.url)}" target="_blank" rel="noopener">打开仓库</a>
        </div>
      </div>`;
    }).join('');

    if (!rows.length) {
      $('weekCards').innerHTML = '<div class="empty">没有匹配的学生</div>';
    }
  }

  /* ---------------- 详情 ---------------- */
  function findStudent(repo) {
    return state.students.find((s) => s.repo === repo);
  }

  function openDetail(repo, weekKey) {
    const s = findStudent(repo);
    if (!s) return;
    const week = state.weeks.find((w) => w.key === weekKey) || currentWeek();
    const st = statusOf(s, week);
    const entry = s.weeks[weekKey] || {};
    const files = entry.files || [];
    const progress = (entry.progress || '').trim();

    $('detailTitle').textContent = `${s.name || s.login} · ${week.key}`;
    $('detailSub').innerHTML =
      `<span class="badge ${st}">${STATUS_TEXT[st]}</span> ` +
      `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.repo)}</a>` +
      (entry.commit ? ` · ${esc(entry.commit.sha || '')} · ${fmtDate(entry.commit.date)}` : '');

    const fileHtml = files.length
      ? `<div class="file-list">${files.map((f, i) => `
          <div class="file-item">
            <span class="file-icon">📑</span>
            <span class="fname" title="${esc(f.path)}">${esc(f.name)}</span>
            <span class="fsize">${fmtSize(f.size)}</span>
            <button class="btn" data-preview="${i}">页面内预览</button>
            <a class="btn ghost" href="${esc(f.url)}" target="_blank" rel="noopener">在 GitHub 打开</a>
          </div>`).join('')}</div>`
      : `<div class="empty">这一周没有找到 PPT / PDF 文件</div>`;

    const commitHtml = entry.commit
      ? `<div class="commit-box">
          <div class="cm">${esc(entry.commit.message || '（无提交说明）')}</div>
          <div>${esc(entry.commit.sha || '')} · ${fmtDate(entry.commit.date)} · ${relTime(entry.commit.date)}</div>
         </div>`
      : `<div class="empty">没有提交记录</div>`;

    $('detailBody').innerHTML = `
      <section><div class="sec-title">汇报文件</div>${fileHtml}</section>
      <section><div class="sec-title">本周进展</div>
        ${progress ? `<div class="progress-box">${esc(progress)}</div>` :
          `<div class="empty">仓库里没有 README.md / 进展.md，建议让学生每周写一份进展说明</div>`}
      </section>
      <section><div class="sec-title">最近提交</div>${commitHtml}</section>
      <section id="previewSec" hidden>
        <div class="sec-title">PPT 内容预览</div>
        <div id="previewBody"></div>
      </section>`;

    $('detailBody').querySelectorAll('[data-preview]').forEach((btn) => {
      btn.addEventListener('click', () => previewFile(s, files[+btn.dataset.preview]));
    });

    $('detailOverlay').hidden = false;
  }

  function closeOverlay(id) {
    $(id).hidden = true;
  }

  async function previewFile(student, file) {
    const sec = $('previewSec');
    const body = $('previewBody');
    sec.hidden = false;
    if (sec.scrollIntoView) sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    const entry = Object.values(student.weeks || {}).find((e) =>
      (e.files || []).some((f) => f.path === file.path)) || {};
    if (entry.demoSlides) {
      body.innerHTML = renderSlides(entry.demoSlides.slides);
      return;
    }

    if (!/\.pptx$/i.test(file.name)) {
      body.innerHTML = `<div class="empty">${/\.pdf$/i.test(file.name) ? 'PDF 请在 GitHub 或本地查看' : '该格式暂不支持页面内预览'}，可点上方「在 GitHub 打开」。</div>`;
      return;
    }
    if (!cfg.token) {
      body.innerHTML = `<div class="empty">页面内预览私有 PPT 需要一次 GitHub Token（可选）。<br>
        你也可以直接点「在 GitHub 打开」，用已登录的 GitHub 账号查看原件。</div>`;
      return;
    }

    body.innerHTML = '<div class="loading"><span class="spinner"></span>正在解析 PPT 文本…</div>';
    try {
      const owner = student.repo.split('/')[0];
      const repo = student.repo.split('/')[1];
      // 分支来自汇总数据，缺省按 main
      const slides = await window.PPTX.fromGitHub({
        owner, repo, path: file.path, ref: student.branch || 'main', token: cfg.token,
      });
      body.innerHTML = renderSlides(slides);
    } catch (e) {
      body.innerHTML = `<div class="empty">解析失败：${esc(e.message)}<br>
        可以直接下载原件查看，或检查 Token 是否有 Contents 读权限。</div>`;
    }
  }

  function renderSlides(slides) {
    if (!slides || !slides.length) return '<div class="empty">这份 PPT 没有可提取的文字</div>';
    const html = slides.map((s) => {
      const ps = s.paragraphs || [];
      if (!ps.length) return `<div class="slide"><span class="no">${s.index}</span><span class="muted small">（本页无文字，多为图片/图表）</span></div>`;
      const title = ps[0];
      const rest = ps.slice(1).map((p) => {
        const isBullet = /^[·•\-–*]/.test(p);
        return `<li class="${isBullet ? '' : 'lvl1'}">${esc(p.replace(/^[·•\-–*]\s*/, ''))}</li>`;
      }).join('');
      return `<div class="slide"><span class="no">${s.index}</span>
        ${ps.length > 1 ? `<h4>${esc(title)}</h4><ul>${rest}</ul>` : `<ul><li class="lvl1">${esc(title)}</li></ul>`}
      </div>`;
    }).join('');
    return `<div class="slides">${html}</div>
      <p class="muted small" style="margin:10px 0 0">仅提取文字，图片/图表/动画请下载原件查看。</p>`;
  }

  /* ---------------- 设置 ---------------- */
  function fillSettings() {
    $('cfgOwner').value = cfg.owner || '';
    $('cfgPrefix').value = cfg.prefix || '';
    $('cfgToken').value = cfg.token || '';
    $('cfgDeadline').value = cfg.deadline || 'sunday';
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    $('btnSettings').addEventListener('click', () => { fillSettings(); $('settingsOverlay').hidden = false; });
    $('btnLogin').addEventListener('click', () => { fillSettings(); $('settingsOverlay').hidden = false; });
    $('btnDemo').addEventListener('click', () => { loadDemo(); toast('已加载演示数据'); });
    $('btnRefresh').addEventListener('click', async () => {
      if (state.mode === 'live') {
        await loadLive().catch((e) => toast('刷新失败：' + e.message, true));
      } else if (state.mode === 'demo') {
        loadDemo(); toast('演示数据已重置');
      } else if (state.mode === 'summary') {
        try {
          const res = await fetch('data/summary.json', { cache: 'no-store' });
          if (!res.ok) throw new Error('summary.json 不存在');
          applySummary(await res.json());
          toast('已重新读取汇总数据');
        } catch (e) { toast('刷新失败：' + e.message, true); }
      } else {
        boot();
      }
    });

    $('btnSaveCfg').addEventListener('click', async () => {
      cfg.owner = $('cfgOwner').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/.*$/, '');
      cfg.prefix = $('cfgPrefix').value.trim() || 'weekly-';
      cfg.token = $('cfgToken').value.trim();
      cfg.deadline = $('cfgDeadline').value;
      saveCfg();
      closeOverlay('settingsOverlay');
      if (cfg.token) {
        try {
          await loadLive();
        } catch (e) {
          toast('加载失败：' + e.message, true);
        }
      } else {
        try {
          const res = await fetch('data/summary.json', { cache: 'no-store' });
          if (!res.ok) throw new Error('summary.json 不存在');
          applySummary(await res.json());
          toast('已重新读取汇总数据');
        } catch (e) { toast('刷新失败：' + e.message, true); }
      }
    });

    $('btnLogout').addEventListener('click', () => {
      cfg.token = '';
      state.accounts = {};
      saveCfg();
      fillSettings();
      closeOverlay('settingsOverlay');
      resetView();
      boot();
      toast('已退出，Token 已从本机清除');
    });

    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.addEventListener('click', () => closeOverlay(btn.dataset.close));
    });
    document.querySelectorAll('.overlay').forEach((ov) => {
      ov.addEventListener('click', (e) => { if (e.target === ov) ov.hidden = true; });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeOverlay('settingsOverlay');
        closeOverlay('detailOverlay');
      }
    });

    $('filter').addEventListener('input', (e) => {
      state.filter = e.target.value;
      renderMatrix();
      renderWeekCards();
    });
    $('weekCount').addEventListener('change', (e) => {
      cfg.weeks = +e.target.value || 12;
      saveCfg();
      renderMatrix();
    });

    $('matrix').addEventListener('click', (e) => {
      const sq = e.target.closest('.sq.has');
      if (!sq) return;
      openDetail(sq.dataset.stu, sq.dataset.wk);
    });
    $('weekCards').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-open]');
      if (!btn) return;
      openDetail(btn.dataset.open, btn.dataset.wk);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();
    $('weekCount').value = String(cfg.weeks || 12);
    boot();
    window.addEventListener('hashchange', () => {
      if (location.hash === '#demo') loadDemo();
    });
  });
})();
