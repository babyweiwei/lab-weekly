/* search.js — 读 data/index.json，在浏览器里做本地检索（中文二元组 + 英文词）；窗口内不向任何第三方发请求 */
(function () {
  var INDEX_URL = 'data/index.json';

  var $ = function (id) { return document.getElementById(id); };

  function tokenize(text) {
    var out = [];
    var lower = String(text || '').toLowerCase();
    var words = lower.match(/[a-z0-9][a-z0-9._+-]*/g) || [];
    for (var i = 0; i < words.length; i++) if (words[i].length >= 2) out.push(words[i]);
    var runs = lower.match(/[\u4e00-\u9fff]+/g) || [];
    for (var r = 0; r < runs.length; r++) {
      if (runs[r].length === 1) out.push(runs[r]);
      for (var j = 0; j < runs[r].length - 1; j++) out.push(runs[r].slice(j, j + 2));
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function highlight(text, terms) {
    var out = escapeHtml(text);
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      if (!t || t.length < 2) continue;
      var re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      out = out.replace(re, function (m) { return '<mark>' + m + '</mark>'; });
    }
    return out;
  }

  var docs = [];
  var meta = null;

  function load() {
    return fetch(INDEX_URL, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('索引不存在：请先运行 node scripts/build-index.mjs 并推送 data/index.json');
      return res.json();
    }).then(function (payload) {
      meta = payload;
      docs = [];
      var files = payload.files || [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var texts = f.slidesText || [];
        for (var k = 0; k < texts.length; k++) {
          docs.push({ f: f, text: texts[k], slide: k + 1, tokens: tokenize(texts[k]) });
        }
      }
      var df = new Map();
      dcnt(docs, df);
      meta._df = df;
      meta._N = docs.length;
      var weeks = (payload.stats && payload.stats.weeks && payload.stats.weeks.length) ? payload.stats.weeks.join(' ') : '';
      $('stat').textContent = '索引 ' + files.length + ' 个文件 / ' + meta._N + ' 页 / ' +
        (payload.stats ? payload.stats.chars : 0) + ' 字' +
        (weeks ? ' · 周次 ' + weeks : '') +
        ' · 生成于 ' + new Date(payload.generated_at).toLocaleString();
    });
  }

  function dcnt(arr, df) {
    for (var i = 0; i < arr.length; i++) {
      var uniq = new Set(arr[i].tokens);
      uniq.forEach(function (t) { df.set(t, (df.get(t) || 0) + 1); });
    }
  }

  function search(q) {
    var terms = Array.from(new Set(tokenize(q)));
    if (!terms.length) return [];
    var N = meta._N;
    function idf(t) { return Math.log(1 + N / (1 + (meta._df.get(t) || 0))); }
    var scored = [];
    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      var tf = new Map();
      for (var j = 0; j < d.tokens.length; j++) tf.set(d.tokens[j], (tf.get(d.tokens[j]) || 0) + 1);
      var score = 0, hit = [];
      for (var k = 0; k < terms.length; k++) {
        var c = tf.get(terms[k]) || 0;
        if (!c) continue;
        hit.push(terms[k]);
        score += (1 + Math.log(c)) * idf(terms[k]);
        if ((d.f.title || '').toLowerCase().indexOf(terms[k]) >= 0) score *= 1.4;
        if (d.slide === 1) score *= 1.15;
      }
      if (hit.length >= 2) score *= 1.3;
      if (score > 0) scored.push({ d: d, score: score, hit: hit });
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored;
  }

  function render(q) {
    var list = $('results');
    if (!q.trim()) {
      list.innerHTML = '<p class="hint">输入关键词，例如「梯度」「分子」「baseline」「数据清洗」。</p>';
      return;
    }
    var rows = search(q).slice(0, 30);
    if (!rows.length) {
      list.innerHTML = '<p class="hint">没有命中。试试换一个更短或更具体的词。</p>';
      return;
    }
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var f = rows[i].d.f;
      var who = escapeHtml(f.student || f.file);
      var week = escapeHtml(f.week || '未标周次');
      var file = escapeHtml(f.file);
      html += '<article class="hit">' +
        '<div class="hit-head">' +
        '<span class="rank">' + (i + 1) + '</span>' +
        '<b>' + who + '</b>' +
        '<span class="tag">' + week + '</span>' +
        '<span class="file">' + file + ' · 第 ' + rows[i].d.slide + ' 页</span>' +
        '</div>' +
        '<p class="hit-text">' + highlight(rows[i].d.text, rows[i].hit) + '</p>' +
        '</article>';
    }
    list.innerHTML = html;
  }

  $('q').addEventListener('input', function (e) { render(e.target.value); });

  load().then(function () {
    $('stat').classList.remove('hidden');
    var t = new URLSearchParams(location.search).get('q');
    if (t) { $('q').value = t; render(t); } else { render(''); }
  }).catch(function (err) {
    $('stat').textContent = err.message;
    $('stat').classList.remove('hidden');
  });
})();
