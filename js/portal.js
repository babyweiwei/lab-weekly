/* portal.js — 入口页：读 config/meeting.json 定本周参数，读 data/index.json 给摘要 */
(function () {
  var CONFIG_URL = 'config/meeting.json';
  var INDEX_URL = 'data/index.json';
  var WEEKDAYS = { 周一: 1, 周二: 2, 周三: 3, 周四: 4, 周五: 5, 周六: 6, 周日: 0, 星期天: 0 };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    var n = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + '-W' + pad(n);
  }

  function nextMeeting(cfg, now) {
    var wd = WEEKDAYS[cfg['默认开会日']] != null ? WEEKDAYS[cfg['默认开会日']] : 6;
    var hm = String(cfg['默认开会时间'] || '19:00').split(':');
    var hh = +hm[0], mm = +hm[1] || 0;
    var d = new Date(now.getTime());
    d.setHours(hh, mm, 0, 0);
    var diff = (wd - d.getDay() + 7) % 7;
    if (diff === 0 && now > d) diff = 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function weekOverrides(cfg, weekKey) {
    var all = cfg['本周临时调整'] || {};
    return all[weekKey] || null;
  }

  function fmt(d) {
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function durText(ms) {
    if (ms <= 0) return '已截止';
    var h = Math.floor(ms / 3600000);
    if (h < 1) return Math.max(1, Math.round(ms / 60000)) + ' 分钟后截止';
    if (h < 48) return h + ' 小时后截止';
    return Math.floor(h / 24) + ' 天后截止';
  }

  function link(id, url, fallback) {
    var el = $(id);
    if (!el) return;
    if (url) {
      el.href = url;
      el.classList.remove('disabled');
      el.removeAttribute('aria-disabled');
      el.title = '';
    } else if (fallback) {
      el.href = fallback;
      el.classList.remove('disabled');
      el.removeAttribute('aria-disabled');
      el.classList.add('fallback');
      el.title = '管理员还没填腾讯文档链接，先带你到腾讯文档首页';
    } else {
      el.href = '#';
      el.classList.add('disabled');
      el.setAttribute('aria-disabled', 'true');
      el.title = '管理员还没填这个链接';
    }
  }

  function renderSummary(idx, weekKey) {
    var box = $('summary');
    if (!idx || !idx.files) { box.innerHTML = '<p class="muted">索引还没建。</p>'; return; }
    var list = idx.files.filter(function (f) { return f.week === weekKey; });
    if (!list.length) {
      box.innerHTML = '<p class="muted">本周还没有可读的材料（索引里没有校对过的 PPT 文本）。后台文件在腾讯文档里照常可看。</p>';
      return;
    }
    var html = '<ul class="wk">';
    list.forEach(function (f) {
      var who = esc(f.student || f.file);
      var t = esc(f.title || '（无标题）');
      var first = (f.slidesText || []).slice(1, 3).join(' ');
      html += '<li><b>' + who + '</b><span class="t">' + t + '</span>' +
        '<p class="snip">' + esc(first.slice(0, 140)) + '</p></li>';
    });
    html += '</ul>';
    box.innerHTML = html;
  }

  function boot() {
    var now = new Date();
    var weekKey = isoWeek(now);
    $('week').textContent = weekKey;
    $('today').textContent = fmt(now);

    fetch(CONFIG_URL, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('配置读取失败');
      return r.json();
    }).then(function (cfg) {
      var meet = nextMeeting(cfg, now);
      var wk = isoWeek(meet);
      var ov = weekOverrides(cfg, wk);
      var hh = (ov && ov['开会时间']) || cfg['默认开会时间'] || '19:00';
      var place = (ov && ov['地点']) || cfg['地点'] || '';
      var lead = (ov && ov['截止提前小时'] != null) ? ov['截止提前小时'] : (cfg['截止提前小时'] || 2);
      meet = nextMeeting({
        '默认开会日': (ov && ov['开会日']) || cfg['默认开会日'],
        '默认开会时间': hh
      }, now);

      var deadline = new Date(meet.getTime() - lead * 3600000);
      $('week').textContent = wk;
      $('meeting').textContent = fmt(meet) + (place ? ' · ' + place : '') + (ov ? '（本周临时调整）' : '');
      $('deadline').textContent = fmt(deadline) + ' · ' + durText(deadline - now);
      $('rule').textContent = '文件名：' + String(cfg['提交规范']['文件命名']).replace('{周次}', wk) +
        '　超过 ' + (cfg['提交规范']['单文件上限MB'] || 10) + 'MB 先存 PDF';

      var links = cfg['链接'] || {};
      link('l-folder', links['本周文件夹'], 'https://docs.qq.com/');
      link('l-form', links['进展收集表'], 'https://docs.qq.com/');
      link('l-minutes', links['纪要'], 'https://docs.qq.com/');
      link('l-search', links['检索页'] || 'search.html');
      link('l-config', links['参数配置'] || CONFIG_URL);
      $('folder-name').textContent = links['本周文件夹'] ? '' : '（未配链接，先带去腾讯文档）';

      var roster = (cfg['名单'] && cfg['名单']['学生']) || [];
      $('roster').innerHTML = roster.length
        ? roster.map(function (n) { return '<span class="who">' + esc(n) + '</span>'; }).join('')
        : '<span class="muted">名单未填</span>';

      return fetch(INDEX_URL, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; });
    }).then(function (idx) { renderSummary(idx, $('week').textContent); })
      .catch(function (err) {
        $('meeting').textContent = '读取失败：' + err.message;
      });
  }

  boot();
})();
