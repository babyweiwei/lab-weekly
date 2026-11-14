/* pptx 文本解析：不依赖服务端，在浏览器里解压 pptx（zip）并抽取每页文字。
   仅用于"快速查看这周讲了什么"，图片/图表仍需下载原件。 */
(function () {
  const CDN = [
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
  ];

  let zipLoading = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('load failed: ' + src));
      document.head.appendChild(s);
    });
  }

  async function ensureZip() {
    if (window.JSZip) return window.JSZip;
    if (!zipLoading) {
      zipLoading = (async () => {
        let lastErr = null;
        for (const url of CDN) {
          try {
            await loadScript(url);
            if (window.JSZip) return window.JSZip;
          } catch (e) { lastErr = e; }
        }
        throw lastErr || new Error('无法加载解压组件');
      })();
    }
    return zipLoading;
  }

  function decodeEntities(s) {
    return s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&amp;/g, '&');
  }

  /* 从 slideN.xml 抽取段落文本：按 <a:p> 分段，段内拼接 <a:t> */
  function extractSlideText(xml) {
    const paras = [];
    const pRe = /<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g;
    let m;
    while ((m = pRe.exec(xml)) !== null) {
      const inner = m[1];
      const tRe = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
      let t;
      let text = '';
      while ((t = tRe.exec(inner)) !== null) text += decodeEntities(t[1]);
      text = text.replace(/\s+/g, ' ').trim();
      if (text) paras.push(text);
    }
    return paras;
  }

  /* 判断是否像标题页：前 3 页里字数少、层级高 */
  function guessTitle(paras) {
    return paras.length ? paras[0].slice(0, 80) : '';
  }

  window.PPTX = {
    /* 解析 ArrayBuffer，返回 [{index, paragraphs}] */
    async parse(arrayBuffer) {
      const JSZipLib = await ensureZip();
      const zip = await JSZipLib.loadAsync(arrayBuffer);
      const names = Object.keys(zip.files);
      const slideRe = /^ppt\/slides\/slide(\d+)\.xml$/;
      const slides = names
        .map((n) => ({ n, m: slideRe.exec(n) }))
        .filter((x) => x.m)
        .map((x) => ({ name: x.n, index: +x.m[1] }))
        .sort((a, b) => a.index - b.index);

      const out = [];
      for (const s of slides) {
        const xml = await zip.file(s.name).async('string');
        out.push({ index: s.index, paragraphs: extractSlideText(xml) });
      }
      return out;
    },

    /* 通过 GitHub API 拉取私有文件并解析 */
    async fromGitHub({ owner, repo, path, ref, token, signal }) {
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}` +
        (ref ? `?ref=${encodeURIComponent(ref)}` : '');
      const res = await fetch(url, {
        signal,
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/vnd.github.raw',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      if (!res.ok) throw new Error(`GitHub 返回 ${res.status}（${res.statusText}）`);
      const buf = await res.arrayBuffer();
      return this.parse(buf);
    },

    guessTitle,
  };
})();
