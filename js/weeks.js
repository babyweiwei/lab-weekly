/* weeks.js — 学期总览：每一周一行，看得到日期、状态、收了几份、谁没交 */
(function () {
  var CONFIG_URL = 'config/meeting.json';
  var INDEX_URL = 'data/index.json';
  var WEEKDAYS = { 周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 0, 星期天: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return t.getUTCFullYear() + '-W' + pad(Math.ceil(((t - ys) / 86400000 + 1) / 7));
  }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function parseDate(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }

  function meetingOf(cfg, monday) {
    var wd = WEEKDAYS[cfg['默认开会日']] != null ? WEEKDAYS[cfg['默认开会日']] : 6;
    var hm = String(cfg['默认开会时间'] || '19:00').split(':');
    var d = new Date(monday.getTime());
    var offset = wd === 0 ? 6 : wd - 1;
    d.setDate(d.getDate() + offset);
    d.setHours(+hm[0], +hm[1] || 0, 0, 0);
    return d;
  }

  function boot() {
    var today = new Date();

    fetch(CONFIG_URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('配置读取失败');
      return r.json();
    }).then(function (cfg) {
      var sem = cfg['学期'] || { 起始周一: '2026-09-07', 周数: 18 };
      var start = parseDate(sem['起始周一'] || '2026-09-07');
      var total = sem['周数'] || 18;
      var roster = (cfg['名单'] && cfg['名单']['学生']) || [];
      var links = cfg['链接'] || {};
      var overrides = cfg['本周临时调整'] || {};

      return fetch(INDEX_URL, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { files: [] }; })
        .then(function (idx) { return { cfg: cfg, sem: sem, start: start, total: total, roster: roster, links: links, overrides: overrides, idx: idx || { files: [] } }; });
    }).then(function (S) {
      var rows = [];
      for (var i = 0; i < S.total; i++) {
        var monday = new Date(S.start.getTime());
        monday.setDate(monday.getDate() + i * 7);
        var wk = isoWeek(monday);
        var ov = S.overrides[wk];
        var meet = meetingOf(ov ? Object.assign({}, S.cfg, ov) : S.cfg, monday);
        var lead = (ov && ov['截止提前小时'] != null) ? ov['截止提前小时'] : (S.cfg['截止提前小时'] || 2);
        var deadline = new Date(meet.getTime() - lead * 3600000);

        var files = (S.idx.files || []).filter(function (f) { return f.week === wk; });
        var gotNames = files.map(function (f) { return (f.student || '').trim(); }).filter(Boolean);
        var missing = S.roster.filter(function (n) { return gotNames.indexOf(n) < 0; });

        var state = deadline < today ? 'past' : (meet.toDateString() === today.toDateString() || (today >= monday && today < new Date(monday.getTime() + 7 * 86400000)) ? 'now' : 'future');

        rows.push({
          wk: wk, monday: monday, meet: meet, deadline: deadline, state: state,
          files: files, got: files.length, missing: missing, rosterSize: S.roster.length,
          folder: S.links['根文件夹'] || '', minutes: S.links['纪要'] || ''
        });
      }

      var nowRow = rows.filter(function (r) { return r.state === 'now'; })[0];
      var past = rows.filter(function (r) { return r.state === 'past'; });
      var gotTotal = rows.reduce(function (n, r) { return n + r.got; }, 0);
      $('stat').textContent = '本学期 ' + S.total + ' 周（' + rows[0].wk + ' → ' + rows[rows.length - 1].wk + '）· 已过 ' +
        past.length + ' 周 · 索引内累计材料 ' + gotTotal + ' 份 · 应交 ' + S.rosterSize + ' 人/周';

      var html = rows.map(function (r) {
        var cls = 'row ' + r.state;
        var badge = r.state === 'now' ? '<span class="badge now">本周</span>' : (r.state === 'past' ? '<span class="badge past">已过</span>' : '<span class="badge">未到</span>');
        var mat = r.got ? '<b>' + r.got + '</b> 份' : '<span class="dim">0 份</span>';
        var miss = r.rosterSize ? (r.got ? (r.missing.length ? esc(r.missing.join('、')) : '<span class="ok">全齐</span>') : '<span class="dim">未核对</span>') : '<span class="dim">名单未填</span>';
        var open = (r.folder ? '<a class="mini" href="' + esc(r.folder) + '" target="_blank" rel="noopener">材料夹</a>' : '<span class="dim">—</span>') +
                   (r.minutes ? '<a class="mini" href="' + esc(r.minutes) + '" target="_blank" rel="noopener">纪要</a>' : '');
        return '<tr class="' + cls + '">' +
          '<td class="wk">' + r.wk + '<div class="muted2">' + md(r.monday) + '–' + md(new Date(r.monday.getTime() + 6 * 86400000)) + '</div></td>' +
          '<td>' + (r.meet.getMonth() + 1) + '/' + r.meet.getDate() + ' ' + pad(r.meet.getHours()) + ':' + pad(r.meet.getMinutes()) +
          '<div class="muted2">截止 ' + (r.deadline.getMonth() + 1) + '/' + r.deadline.getDate() + ' ' + pad(r.deadline.getHours()) + ':' + pad(r.deadline.getMinutes()) + '</div></td>' +
          '<td>' + badge + '</td>' +
          '<td>' + mat + '</td>' +
          '<td class="miss">' + miss + '</td>' +
          '<td>' + open + '</td>' +
          '</tr>';
      }).join('');

      $('tbody').innerHTML = html;
      if (nowRow) $('nowline').textContent = '本周 ' + nowRow.wk + '：组会 ' + (nowRow.meet.getMonth() + 1) + '月' + nowRow.meet.getDate() + '日 ' +
        pad(nowRow.meet.getHours()) + ':' + pad(nowRow.meet.getMinutes()) + '，截止 ' + pad(nowRow.deadline.getHours()) + ':' + pad(nowRow.deadline.getMinutes()) + '。';
    }).catch(function (err) {
      $('stat').textContent = '读取失败：' + err.message;
    });
  }

  boot();
})();
