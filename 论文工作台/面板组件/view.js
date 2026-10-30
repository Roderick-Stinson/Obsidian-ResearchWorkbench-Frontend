// 论文工作台 · 单面板。数据来自后端接口（约定见 论文工作台/后端约定/数据格式约定.md）；vault 里只读写阅读笔记和面板配置。
const DIR = input?.componentDir || [dv.current().file.folder, '面板组件'].filter(Boolean).join('/');
const CONFIG_FILE = DIR + '/config.json';
const RESEARCH_PAGE = [dv.current().file.folder, '我的研究领域.md'].filter(Boolean).join('/');
const root = dv.container.createDiv({ cls: 'rpd-root' });
let disposed = false;

// ---------- 小工具 ----------
const H = (p, tag, cls, text) => { const e = p.createEl(tag, { cls: cls || undefined }); if (text != null) e.setText(String(text)); return e; };
const btn = (p, text, cls, fn) => { const b = H(p, 'button', 'rpd-btn ' + (cls || ''), text); b.type = 'button'; b.addEventListener('click', fn); return b; };
const chip = (p, text, on, fn) => { const b = H(p, 'button', 'rpd-chip' + (on ? ' is-on' : ''), text); b.type = 'button'; b.addEventListener('click', fn); return b; };
const open = (path, split) => app.workspace.openLinkText(path, '', !!split);
const enc = encodeURIComponent;
const num = v => v == null ? '—' : String(v);
let toastEl, toastTimer;
function toast(msg) { toastEl.setText(msg); toastEl.addClass('is-show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.removeClass('is-show'), 3200); }
// 时区跟后端一致（后端的 PWB_TZ，默认后端所在机器的时区）；连不上后端时用本机时区。
let TZ_NAME;
const ymd = d => new Intl.DateTimeFormat('en-CA', { timeZone: TZ_NAME, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const fmtTime = v => { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toLocaleString('zh-CN', { timeZone: TZ_NAME, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : String(v || '—'); };
function extLink(p, url, text) { const a = H(p, 'a', 'external-link', text); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
function paperRef(p, ref) { if (ref?.url) return extLink(p, ref.url, ref.title); if (ref?.id?.startsWith('arxiv-')) return extLink(p, 'https://arxiv.org/abs/' + ref.id.slice(6), ref.title); return H(p, 'span', '', ref?.title || '—'); }
function fileLink(parent, path, title) {
  const a = H(parent, 'a', 'internal-link rpd-row-t', title); a.href = path; a.dataset.href = path;
  a.addEventListener('click', e => { e.preventDefault(); open(path, e.ctrlKey || e.metaKey); });
  return a;
}
const sec = (p, title, sub) => { const s = H(p, 'section', 'rpd-sec'); const h = H(s, 'div', 'rpd-sec-head'); H(h, 'h2', '', title); if (sub) H(h, 'span', 'rpd-muted', sub); return s; };
const empty = (p, t) => H(p, 'p', 'rpd-empty', t);
function table(c, head, rows) {
  const t = H(H(c, 'div', 'rpd-table-wrap'), 'table', 'rpd-table');
  const tr = H(H(t, 'thead'), 'tr'); head.forEach(h => H(tr, 'th', '', h));
  const tb = H(t, 'tbody'); rows.forEach(r => { const row = H(tb, 'tr'); r.forEach(cell => { const td = H(row, 'td'); if (cell instanceof Function) cell(td); else td.setText(String(cell)); }); });
  return t;
}
const star = (p, n, set, label) => {
  const w = H(p, 'span', 'rpd-stars'); if (label) w.setAttribute('aria-label', label);
  for (let i = 1; i <= 5; i++) { const s = H(w, 'button', 'rpd-star' + (i <= n ? ' is-on' : ''), '★'); s.type = 'button'; s.addEventListener('click', () => set(i === n ? 0 : i)); }
  return w;
};
const obsidian = (() => { try { return require('obsidian'); } catch (e) { return null; } })();
async function renderMd(el, markdown) {
  if (obsidian?.MarkdownRenderer) { try { await obsidian.MarkdownRenderer.render(app, markdown, el, dv.current().file.path, dv.component || new obsidian.Component()); return; } catch (e) {} }
  H(el, 'pre', 'rpd-md-plain', markdown);
}

// ---------- 连接后端（地址和 token 存在 config.json） ----------
const DEFAULT_CONFIG = { apiBase: 'http://127.0.0.1:8765/api/v1', token: '', noteTemplate: '论文工作台/模板/精读笔记.md' };
let CFG = { ...DEFAULT_CONFIG }, configError = '';
try { if (await app.vault.adapter.exists(CONFIG_FILE)) CFG = { ...DEFAULT_CONFIG, ...JSON.parse(await app.vault.adapter.read(CONFIG_FILE)) }; } catch (e) { configError = 'config.json 读取失败，已使用默认地址：' + e.message; }
async function saveConfig(next) { CFG = { ...DEFAULT_CONFIG, ...next }; await app.vault.adapter.write(CONFIG_FILE, JSON.stringify(CFG, null, 2)); }
const requestUrlFn = obsidian?.requestUrl || globalThis.requestUrl || null;
class BackendError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
let online = null;
async function http(method, path, { body, headers, raw } = {}) {
  const url = CFG.apiBase.replace(/\/+$/, '') + path;
  const h = { ...(headers || {}) };
  if (CFG.token) h.Authorization = 'Bearer ' + CFG.token;
  if (body !== undefined) h['Content-Type'] = raw ? 'application/octet-stream' : 'application/json';
  const payload = body === undefined ? undefined : raw ? body : JSON.stringify(body);
  let status, text;
  try {
    if (requestUrlFn) { const res = await requestUrlFn({ url, method, headers: h, body: payload, contentType: h['Content-Type'], throw: false }); status = res.status; text = res.text; }
    else { const res = await fetch(url, { method, headers: h, body: payload }); status = res.status; text = await res.text(); }
  } catch (e) { online = false; throw new BackendError(0, 'offline', '连不上后端：' + CFG.apiBase); }
  online = true;
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) {}
  if (status >= 200 && status < 300) return data;
  throw new BackendError(status, data?.error?.code || 'http_' + status, data?.error?.message || '后端返回 ' + status);
}
function errorText(e) {
  if (!e) return '未知错误';
  if (e.status === 0) return '连不上后端（' + CFG.apiBase + '）。请先启动后端：cd ~/PaperWorkbench && .venv/bin/python -m pwb serve';
  if (e.status === 401) return 'token 缺失或错误，请在“设置 → 后端连接”里修改。';
  return e.message;
}
// GET 结果缓存在 Obsidian 本地存储里（不写进 vault），后端连不上时显示上次的数据。
const CACHE_KEY = 'rpd-api-cache';
let cache = {}; try { cache = JSON.parse(app.loadLocalStorage(CACHE_KEY) || '{}') || {}; } catch (e) {}
function saveCache() { try { const keys = Object.keys(cache).sort((a, b) => cache[b].at - cache[a].at); keys.slice(80).forEach(k => delete cache[k]); app.saveLocalStorage(CACHE_KEY, JSON.stringify(cache)); } catch (e) {} }
async function get(path) {
  try { const data = await http('GET', path); cache[path] = { at: Date.now(), data }; saveCache(); return { data }; }
  catch (e) {
    if (e.status === 0 && cache[path]) return { data: cache[path].data, cachedAt: cache[path].at, error: e };
    if (e.status === 404) { delete cache[path]; saveCache(); }
    return { data: null, error: e };
  }
}
// 把 get 的结果落到页面上：有数据返回数据；没生成过或出错时显示提示并返回 null。
function shown(c, res, what) {
  if (res.cachedAt && !c.querySelector(':scope > .rpd-offline')) H(c, 'p', 'rpd-warn rpd-offline', '离线 · 显示上次同步于 ' + fmtTime(res.cachedAt) + ' 的数据');
  if (res.data) return res.data;
  empty(c, res.error?.status === 404 ? what + '还没生成。后端流水线跑过之后这里会显示。' : errorText(res.error));
  return null;
}
async function act(fn, ok) { try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(errorText(e)); return null; } }

// ---------- 后台任务（按钮 → 后端执行，约定第 6 节） ----------
async function startTask(type, params, label) {
  const key = globalThis.crypto?.randomUUID?.() || String(Date.now()) + Math.random();
  const task = await act(() => http('POST', '/tasks', { body: { type, params }, headers: { 'Idempotency-Key': key } }));
  if (!task) return;
  toast('已提交：' + label);
  const poll = async () => {
    if (disposed) return;
    let t; try { t = await http('GET', '/tasks/' + enc(task.id)); } catch (e) { return setTimeout(poll, 5000); }
    if (t.status === 'done') { toast(label + ' 完成' + (t.message ? '：' + t.message : '')); render(); }
    else if (t.status === 'failed') toast(label + ' 失败：' + (t.error || '未知原因'));
    else setTimeout(poll, 3000);
  };
  setTimeout(poll, 1500);
}

// 后端目前能执行的任务（/health 的 taskTypes）。还没实现的按钮显示成“即将上线”、点不了，免得点了才知道不行。
let TASK_TYPES = null;
function taskBtn(parent, label, cls, type, run) {
  if (TASK_TYPES && !TASK_TYPES.includes(type)) {
    const b = btn(parent, label + '（即将上线）', cls + ' is-pending', () => {}); b.disabled = true; b.title = '后端还没实现这个功能';
    return b;
  }
  return btn(parent, label, cls, run);
}
// 后台长任务（PDF 下载、DBLP 核实）的进度，首页和设置页都显示。
const JOB_STATUS = { idle: ['未运行', 'soft'], running: ['进行中', 'accent'], stalled: ['停滞', 'warn'], done: ['已完成', 'good'] };
function jobsPanel(parent, res) {
  const items = res.data?.items || [];
  const running = items.filter(j => j.status === 'running').length;
  const box = H(parent, 'details', 'rpd-overview-panel rpd-home-alerts'); if (running) box.open = true;
  H(box, 'summary', '', '后台任务 · ' + (running ? running + ' 项进行中' : '没有进行中的'));
  if (!items.length) return empty(box, errorText(res.error));
  items.forEach(j => {
    const row = H(box, 'div', 'rpd-job');
    const head = H(row, 'div', 'rpd-row'); H(head, 'strong', 'rpd-row-t', j.name); H(head, 'span', 'rpd-tag ' + JOB_STATUS[j.status][1], JOB_STATUS[j.status][0]);
    if (j.updatedAt) H(head, 'span', 'rpd-muted', '更新于 ' + fmtTime(j.updatedAt));
    if (j.progress && j.progress.total) { const track = H(row, 'div', 'rpd-progress-track'); H(track, 'div', 'rpd-progress-fill').style.width = Math.min(100, j.progress.done / j.progress.total * 100) + '%'; }
    H(row, 'p', 'rpd-muted', j.message);
  });
}

// ---------- 我的标记（评分、标记、相关性、关注、阅读队列） ----------
const FLAGS = ['已读', '收藏', '复现'];
// 讨论状态由我自己定义，后端原样保存。
const DISCUSSION = ['参考论文', '待讨论', '讨论中', '已读', '初读完成', '已收敛', '待回访'];
let queueIds = null;
async function loadQueue() { const res = await get('/me/queue'); queueIds = res.data?.paperIds || queueIds || []; return queueIds; }
async function patchUser(paper, patch, redraw) {
  const user = await act(() => http('PATCH', '/me/papers/' + enc(paper.id), { body: patch }));
  if (user) { paper.user = user; redraw(); }
}
async function addToQueue(id) {
  const ids = await loadQueue();
  if (ids.includes(id)) return toast('已在阅读队列');
  const q = await act(() => http('PUT', '/me/queue', { body: { paperIds: [...ids, id] } }), '已加入阅读队列');
  if (q) queueIds = q.paperIds;
}
function userControls(bar, paper, redraw) {
  const u = paper.user;
  star(bar, u.rating, v => patchUser(paper, { rating: v }, redraw), '我的评价');
  FLAGS.forEach(k => { const on = u.flags.includes(k); chip(bar, k, on, () => patchUser(paper, { flags: on ? u.flags.filter(f => f !== k) : [...u.flags, k] }, redraw)); });
  ['相关', '不相关'].forEach(k => chip(bar, k, u.relevance === k, () => patchUser(paper, { relevance: u.relevance === k ? null : k }, redraw)));
  chip(bar, u.watched ? '已重点关注' : '重点关注', u.watched, () => patchUser(paper, { watched: !u.watched }, redraw));
}
// 收录时没拿到标题的论文，title 就是它的 ID（约定 5.5）：显示“未知标题”和原文链接，让你认出是哪篇再补上。
const titleKnown = p => !!p.title && p.title !== p.id;
// 先论文原题，后面才是 AI 写的中文结论式标题（zhLine）和总结；没拿到原题的才用中文标题顶上。
const paperTitle = p => titleKnown(p) ? p.title : p.titleZh || '未知标题';
const zhLine = (el, p) => { if (p.titleZh && titleKnown(p) && p.titleZh !== p.title) H(el, 'div', 'rpd-zh', p.titleZh); };
function sourceUrl(id) {
  if (id.startsWith('openreview-')) return 'https://openreview.net/forum?id=' + id.slice(11);
  if (id.startsWith('arxiv-')) return 'https://arxiv.org/abs/' + id.slice(6);
  return null;
}
function titleTools(parent, p, done) {
  const url = sourceUrl(p.id);
  if (!titleKnown(p)) { H(parent, 'span', 'rpd-tag warn', '收录时没拿到标题'); if (url) extLink(parent, url, '在 ' + (p.id.startsWith('arxiv-') ? 'arXiv' : 'OpenReview') + ' 打开，看看是哪篇'); }
  btn(parent, titleKnown(p) ? '改标题' : '填写标题', titleKnown(p) ? 'rpd-ghost' : '', () => {
    if (parent.querySelector('.rpd-kw-form')) return;
    const form = H(parent, 'div', 'rpd-kw-form');
    const title = H(form, 'input', 'rpd-input'); title.placeholder = '论文标题'; title.value = titleKnown(p) ? p.title : '';
    const venue = H(form, 'input', 'rpd-input'); venue.placeholder = '会议 / 期刊（可选），例如 AAAI 2027 投稿'; venue.value = p.venue || '';
    const bar = H(form, 'div', 'rpd-tools');
    const go = async () => {
      if (!title.value.trim()) return toast('请填写标题');
      const body = { title: title.value.trim() }; if (venue.value.trim() !== (p.venue || '')) body.venue = venue.value.trim();
      const updated = await act(() => http('PATCH', '/papers/' + enc(p.id), { body }), '已保存标题');
      if (updated) { Object.assign(p, { title: updated.title, venue: updated.venue }); done(); }
    };
    btn(bar, '保存', 'rpd-primary', go); btn(bar, '取消', 'rpd-ghost', () => form.remove());
    title.addEventListener('keydown', e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') form.remove(); });
    title.focus();
  });
}
function openPdf(id) {
  if (CFG.token) return toast('设置了 token 后暂不支持直接打开 PDF');
  window.open(CFG.apiBase.replace(/\/+$/, '') + '/papers/' + enc(id) + '/pdf');
}

// ---------- 阅读笔记（vault 里的真实数据，用 frontmatter 的 paper_id 关联论文） ----------
const NOTE_DIR = '论文阅读/论文笔记整理/';
let notes = [];
async function loadNotes() {
  const src = dv.pages().where(p => p.file.ext === 'md' && !p.file.path.startsWith('Templates/') && !p.file.path.startsWith('论文工作台/模板/') &&(p.file.path.startsWith(NOTE_DIR) || p.file.tags.includes('#paper'))).array();
  notes = src.map(p => ({ path: p.file.path, file: p.file.name, name: p.file.name.replace(/- /g, ': '), status: String(p.status || '未分类'), paperId: p.paper_id ? String(p.paper_id) : '',
    rating: Number.isInteger(Number(p.rating)) && Number(p.rating) >= 0 && Number(p.rating) <= 5 && p.rating !== '' && p.rating != null ? Number(p.rating) : null,
    sync: p.sync !== false && String(p.sync).toLowerCase() !== 'false', mtime: p.file.mtime?.toMillis?.() || 0 }));
  notes.sort((a, b) => b.mtime - a.mtime);
}
const noteFor = id => notes.find(n => n.paperId === id);
async function setFM(path, key, val) {
  const f = app.vault.getAbstractFileByPath(path);
  if (!f) throw Error('笔记不存在');
  await app.fileManager.processFrontMatter(f, fm => { fm[key] = val; });
}
// 论文中稿换了 ID 时，把笔记里的 paper_id 改成新 ID（约定 3.3）。
async function resolveNoteIds() {
  // 只送论文 ID；写成链接的由同步笔记时后端换成 ID（一个不合格的 ID 会让整次请求 400）
  const ids = [...new Set(notes.map(n => n.paperId).filter(id => /^[a-z][a-z0-9]*-[A-Za-z0-9._-]+$/.test(id)))];
  if (!ids.length) return;
  let res; try { res = await http('POST', '/papers/resolve', { body: { ids: ids.slice(0, 500) } }); } catch (e) { return; }
  for (const n of notes) { const next = res.ids[n.paperId]; if (next && next !== n.paperId) { try { await setFM(n.path, 'paper_id', next); n.paperId = next; } catch (e) {} } }
}
// ---------- 阅读笔记同步给后端（约定 5.18）：后端不读 vault，由面板读出来、按小节发过去，推荐时参考 ----------
const OWN_DIR = '我的论文/';  // 你对自己工作的思考，永远不发
// 去掉 frontmatter、%% 注释、模板里没填的占位行（“- 优点：”、空列表项、空公式、空提示框、和模板一字不差的行）和没填的表格，
// 按标题切开；空的小节不要。template 是模板里的行（Set），没有模板时为空。
function noteSections(text, template = new Set()) {
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[^\n]*\n?/, '').replace(/%%[\s\S]*?%%/g, '');
  const out = []; let cur = { heading: '', level: 0, lines: [] }, fence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    const m = !fence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) { cur = { heading: m[2].trim(), level: m[1].length, lines: [] }; out.push(cur); } else cur.lines.push(line);
  }
  return out.map(sec => ({ heading: sec.heading.slice(0, 200), level: sec.level, text: cleanSection(sec.lines, template) })).filter(sec => sec.text).slice(0, 200);
}
function cleanSection(lines, template) {
  const kept = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {  // 一张表：没有哪一行数据填了两格以上就整张不要
      const table = []; while (i < lines.length && /^\s*\|/.test(lines[i])) table.push(lines[i++]); i--;
      const cells = r => r.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
      if (table.slice(2).some(r => cells(r).filter(Boolean).length >= 2)) kept.push(...table);
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line)) {  // 公式块：里面没写东西就整块不要
      let j = i + 1; while (j < lines.length && !/^\s*\$\$\s*$/.test(lines[j])) j++;
      if (lines.slice(i + 1, j).every(l => !l.trim())) { i = j; continue; }
    }
    if (/^\s*([-*+]|\d+[.)])\s*$/.test(line) || /^\s*[-*+]\s*(\*\*)?[^：:*]{0,30}(\*\*)?[：:]\s*$/.test(line) || /^\s*>\s*$/.test(line)) continue;
    const callout = /^\s*>\s*\[![^\]]+\]/.test(line);
    if (callout && !/^\s*>\s*\S/.test(lines[i + 1] || '')) continue;  // 正文没写的提示框
    if (!callout && template.has(line.trim())) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
let notesSync = null;
// 先比对后端存的每篇笔记的路径和修改时间，有变化才把全部笔记发过去（后端整体替换）。force 时不比对。
function syncNotes(force) {
  if (notesSync) return notesSync;
  notesSync = (async () => {
    try {
      const local = notes.filter(n => n.paperId && n.sync && !n.path.startsWith(OWN_DIR));
      const remote = await http('GET', '/me/notes');
      const sig = list => list.map(n => n.path + '\u0000' + n.mtime).sort().join('\n');
      if (!force && sig(local) === sig([...remote.items, ...remote.skipped])) return remote;
      const tf = app.vault.getAbstractFileByPath(CFG.noteTemplate || DEFAULT_CONFIG.noteTemplate);
      const template = new Set(tf ? (await app.vault.cachedRead(tf)).replace(/%%[\s\S]*?%%/g, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean) : []);
      const payload = [];
      for (const n of local) {
        const f = app.vault.getAbstractFileByPath(n.path); if (!f) continue;
        payload.push({ paperId: n.paperId, path: n.path, title: n.file || n.name, status: n.status === '未分类' ? null : n.status, rating: n.rating,
          mtime: n.mtime, sections: noteSections(await app.vault.cachedRead(f), template) });
      }
      const res = await http('PUT', '/me/notes', { body: { notes: payload } });
      // 笔记里写的是链接或旧 ID 的，换成论文库里的 ID（约定 3.3）
      for (const n of local) { const next = res.sync?.ids?.[n.paperId]; if (next && next !== n.paperId) { try { await setFM(n.path, 'paper_id', next); n.paperId = next; } catch (e) {} } }
      if (res.sync?.queued?.length) toast('从笔记的“要追的论文”加进阅读队列 ' + res.sync.queued.length + ' 篇');
      return res;
    } catch (e) { if (force) toast('笔记没同步成功：' + errorText(e)); return null; } finally { notesSync = null; }
  })();
  return notesSync;
}
async function ensureFolder(path) {
  let current = '';
  for (const part of path.split('/')) {
    current = current ? current + '/' + part : part;
    if (!app.vault.getAbstractFileByPath(current)) { try { await app.vault.createFolder(current); } catch (error) { if (!app.vault.getAbstractFileByPath(current)) throw error; } }
  }
}
// 按模板（设置页里可改路径）生成笔记：{{title}} / {{date}} / {{time}} 的写法和 Obsidian 自带的「模板」插件一致，
// 再把论文信息填进模板里空着的「- 链接：」「- 作者 / 会议：」两行（模板里没有这两行就不填）。找不到模板时返回 null。
async function templateText(paper) {
  const f = app.vault.getAbstractFileByPath(CFG.noteTemplate || DEFAULT_CONFIG.noteTemplate);
  if (!f) return null;
  const m = window.moment();
  let text = (await app.vault.read(f)).replace(/{{\s*(title|date|time)\s*(?::([^}]*))?}}/gi, (_, key, fmt) => {
    key = key.toLowerCase();
    return key === 'title' ? (paper.title || paper.id) : m.format(fmt?.trim() || (key === 'date' ? 'YYYY-MM-DD' : 'HH:mm'));
  });
  const fill = (label, value) => {
    if (!value) return;
    const re = new RegExp('^(\\s*[-*] ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[：:])[ \\t]*$', 'm');
    text = text.replace(re, (_, head) => head + value);
  };
  const authors = paper.authors?.length ? paper.authors.slice(0, 3).join(', ') + (paper.authors.length > 3 ? ' 等' : '') : '';
  const venue = [paper.venue, paper.year && !String(paper.venue || '').includes(String(paper.year)) ? paper.year : ''].filter(Boolean).join(' ');
  fill('链接', paper.urls?.source || paper.versions?.[0]?.url || paper.url || '');
  fill('作者 / 会议', [authors, venue].filter(Boolean).join(' · '));
  return text;
}
async function createPaperNote(paper, body) {
  try {
    await loadNotes();
    const existing = noteFor(paper.id);
    if (existing) { open(existing.path); return; }
    try { paper = { ...paper, ...(await http('GET', '/papers/' + enc(paper.id))) }; } catch (e) {}  // 卡片上的字段不全，取完整的论文信息；取不到就用卡片上的
    await ensureFolder(NOTE_DIR.replace(/\/$/, ''));
    // 文件名不能有冒号：写成“- ”（读笔记时再显示回“: ”），引号等去掉
    const safeName = String((titleKnown(paper) && paper.title) || paper.titleZh || paper.id).replace(/\s*:\s*/g, '- ').replace(/[\\/*?"<>|#^[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || paper.id;
    let path = NOTE_DIR + safeName + '.md', suffix = 2;
    while (app.vault.getAbstractFileByPath(path)) path = NOTE_DIR + safeName + '-' + suffix++ + '.md';
    const fromTemplate = body ? null : await templateText(paper);
    const text = fromTemplate ?? ['---', 'tags:', '  - paper', 'status: 待读', '---', '', '# ' + (paper.title || paper.id), '', body || ['## 粗读摘要', '', '', '## 精读记录', ''].join('\n')].join('\n');
    const file = await app.vault.create(path, text);
    // paper_id 等字段不依赖模板怎么写：模板里删了也会补上
    await app.fileManager.processFrontMatter(file, fm => {
      fm.paper_id = paper.id;
      const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? [fm.tags] : [];
      if (!tags.includes('paper')) fm.tags = [...tags, 'paper'];
      if (!fm.status) fm.status = '待读';
    });
    await loadNotes(); open(path);
    toast(fromTemplate || body ? '已创建阅读笔记' : '找不到模板 ' + (CFG.noteTemplate || DEFAULT_CONFIG.noteTemplate) + '，已按内置格式创建阅读笔记');
  } catch (e) { toast('无法创建阅读笔记：' + e.message); }
}
function noteButton(bar, paper) {
  const note = noteFor(paper.id);
  if (note) btn(bar, '阅读笔记', 'rpd-ghost', () => open(note.path)); else btn(bar, '建阅读笔记', 'rpd-ghost', () => createPaperNote(paper));
}

// ---------- 实验记录（vault 里的真实数据） ----------
const EXPERIMENT_DIR = '实验记录/';
let experiments = [];
function loadExperiments() {
  experiments = dv.pages().where(p => p.file.ext === 'md' && !p.file.path.startsWith('Templates/') && !p.file.path.startsWith('论文工作台/模板/') &&(p.file.path.startsWith(EXPERIMENT_DIR) || p.type === 'experiment' || p.file.tags.includes('#experiment'))).array().map(p => ({
    path: p.file.path, title: String(p.title || p.file.name), server: String(p.server || '未填写'), status: String(p.status || '未分类'), summary: String(p.summary || ''), updated: p.file.mtime?.toMillis?.() || 0
  })).sort((a, b) => b.updated - a.updated);
}
async function createExperimentRecord() {
  try {
    await ensureFolder(EXPERIMENT_DIR.replace(/\/$/, ''));
    const base = EXPERIMENT_DIR + '实验记录-' + ymd(new Date());
    let path = base + '.md', suffix = 2;
    while (app.vault.getAbstractFileByPath(path)) path = base + '-' + suffix++ + '.md';
    await app.vault.create(path, ['---', 'type: experiment', 'status: 待记录', 'server: ""', 'summary: ""', '---', '', '# 远端实验记录', '', '## 实验目标', '', '## 服务器与配置', '', '## 运行记录', '', '## 结果与结论', ''].join('\n'));
    open(path); toast('已创建实验记录');
  } catch (e) { toast('无法创建实验记录：' + e.message); }
}
const ALERT_STATUS = ['失败', '异常', '待处理', '待关注'];

// ---------- 本人论文与 PDF（存在后端论文库；vault 里的“我的论文/”是你的思考笔记，不上传） ----------
function pickPdf() {
  return new Promise(resolve => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'application/pdf,.pdf';
    input.addEventListener('change', () => resolve(input.files?.[0] || null)); input.click();
  });
}
async function uploadPdf(paperId, file) {
  file = file || await pickPdf();
  if (!file) return null;
  toast('正在上传 ' + file.name + '…');
  const content = await file.arrayBuffer();
  return act(() => http('PUT', '/papers/' + enc(paperId) + '/pdf', { body: content, raw: true }), '已上传 PDF');
}
// 添加论文：本人论文或关注论文。给了 arXiv / OpenReview 链接的，标题可以不填，后端在后台补全信息、下载 PDF。
function addPaperForm(parent, mark) {
  const form = H(parent, 'div', 'rpd-kw-form');
  const url = H(form, 'input', 'rpd-input'); url.placeholder = 'arXiv / OpenReview 链接（已在论文库里的会直接加上标记）';
  const title = H(form, 'input', 'rpd-input'); title.placeholder = mark === 'own' ? '论文标题（有 arXiv 链接时可不填；没有链接的稿子必填）' : '论文标题（有 arXiv 链接时可不填）';
  const bar = H(form, 'div', 'rpd-tools'); let file = null;
  const fileLabel = H(bar, 'span', 'rpd-muted', '未选 PDF');
  btn(bar, '选择 PDF', '', async () => { file = await pickPdf(); fileLabel.setText(file ? file.name : '未选 PDF'); });
  btn(bar, '添加', 'rpd-primary', async () => {
    const link = url.value.trim(), name = title.value.trim();
    if (!link && !name) return toast('请填写链接或标题');
    const body = { [mark]: true }; if (link) body.url = link; if (name) body.title = name;
    const paper = await act(() => http('POST', '/papers', { body }), link && !file ? '已添加，后台正在补全信息、下载 PDF，稍后刷新' : '已添加');
    if (!paper) return;
    if (file) await uploadPdf(paper.id, file);
    render();
  });
  btn(bar, '取消', 'rpd-ghost', () => form.remove());
  url.focus();
}

// ---------- 页签状态 ----------
let tab = input?.page === 'research' ? 'research' : 'home';
const T = {
  issue: { date: null, q: '' },
  watched: { q: '', status: '全部' },
  teams: { q: '' },
  lib: { q: '', sort: 'relevance', rating: '', watched: false, f: {}, open: {}, page: 0 },
  must: { tier: '全部', period: '全部' },
  map: { sec: '发展史', stream: null },
  res: { cat: null, full: false, abl: false, view: '效果' },
  hot: { platform: '全部' },
  research: { origin: 'all' }
};

// ---------- 各页签（都是异步的：先取数据再画） ----------
const R = {};
R.home = async c => {
  const [overview, brief, pipeline, jobs] = await Promise.all([get('/overview'), get('/brief'), get('/pipeline'), get('/jobs'), loadQueue()]);
  const head = H(c, 'div', 'rpd-home-heading'); const left = H(head, 'div'); H(left, 'h2', 'rpd-issue-h', '研究总览');
  H(left, 'p', 'rpd-muted', brief.data ? '简报更新于 ' + fmtTime(brief.data.updatedAt) : '等待后端生成每日简报');
  btn(head, '刷新', '', () => render());
  const b = brief.data, o = overview.data;
  if (b && b.date !== ymd(new Date())) H(c, 'p', 'rpd-warn', '以下是 ' + b.date + ' 的简报；“今日”指该日期。');
  const localRead = notes.filter(n => n.status === '已读').length;
  const rate = notes.length ? (localRead / notes.length * 100).toFixed(1) + '%' : '—';
  const stats = H(c, 'div', 'rpd-stats rpd-home-stats');
  [['论文库总数', num(o?.paperTotal), '后端论文库'], ['与我相关', num(o?.relevantTotal), '检索判定为核心相关或相关'], ['今日新收录', num(b?.newCount), b ? b.date : '—'], ['今日精选', num(b?.pickedCount), b ? b.date : '—'], ['已读笔记', localRead, '本地阅读笔记'], ['阅读进度', rate, '按本地笔记计算']]
    .forEach(([name, value, hint]) => { const box = H(stats, 'div', 'rpd-stat'); H(box, 'span', 'rpd-stat-l', name); H(box, 'span', 'rpd-stat-n', value); H(box, 'span', 'rpd-stat-hint', hint); });

  const daily = H(c, 'section', 'rpd-overview-panel'); H(H(daily, 'div', 'rpd-panel-head'), 'h3', '', '每日研究简报');
  if (shown(daily, brief, '每日简报')) {
    if (b.summary) H(daily, 'p', 'rpd-brief-intro', b.summary);
    b.highlights.forEach(item => {
      const entry = H(daily, 'div', 'rpd-brief-item'); H(entry, 'strong', '', item.title); H(entry, 'p', 'rpd-sum', item.text);
      const line = H(entry, 'div', 'rpd-brief-sources'); H(line, 'span', 'rpd-muted', '相关论文：'); item.sources.forEach((ref, i) => { paperRef(line, ref); if (i < item.sources.length - 1) H(line, 'span', 'rpd-muted', ' · '); });
    });
    if (b.weekly) { const w = H(daily, 'div', 'rpd-brief-weekly'); H(w, 'strong', '', '本周脉络'); H(w, 'p', 'rpd-sum', b.weekly.summary); H(w, 'span', 'rpd-muted', '来源：' + b.weekly.period.start + ' 至 ' + b.weekly.period.end + ' 周报'); }
  }
  if (b?.accepted?.length) {
    const acc = H(c, 'section', 'rpd-overview-panel'); const ah0 = H(acc, 'div', 'rpd-panel-head'); H(ah0, 'h3', '', '新中稿'); H(ah0, 'span', 'rpd-progress-value', b.accepted.length + ' 篇');
    H(acc, 'p', 'rpd-muted', '“中稿了”是论文库里的预印本查到了正式发表记录；“新入库”是每周按你的检索方向查到的新中稿论文，已直接进论文库。');
    const list = b.accepted.length > 6 ? H(acc, 'details', 'rpd-home-more') : acc; if (list !== acc) H(list, 'summary', '', '展开全部');
    b.accepted.forEach(a => { const row = H(list, 'div', 'rpd-row'); H(row, 'span', 'rpd-tag ' + (a.kind === 'new' ? 'accent' : 'good'), a.kind === 'new' ? '新入库' : '中稿了'); paperRef(H(row, 'span', 'rpd-row-t'), a.paper); H(row, 'span', 'rpd-muted', a.venue); });
  }
  if (b) {
    const picks = H(c, 'section', 'rpd-overview-panel'); const ph = H(picks, 'div', 'rpd-panel-head'); H(ph, 'h3', '', '今日精选'); H(ph, 'span', 'rpd-progress-value', b.pickedCount + ' 篇');
    if (!b.picks.length) empty(picks, '今天暂无精选论文。');
    b.picks.forEach(p => { const row = H(picks, 'div', 'rpd-home-paper'); paperRef(row, p); if (p.titleZh && p.titleZh !== p.title) H(row, 'div', 'rpd-zh', p.titleZh); if (p.reason) H(row, 'p', 'rpd-muted', '入选理由：' + p.reason); if (p.summary) H(row, 'p', 'rpd-sum', p.summary); });
    btn(picks, '查看完整论文推荐', 'rpd-ghost', () => goTab('issue'));
    const added = H(c, 'section', 'rpd-overview-panel'); const ah = H(added, 'div', 'rpd-panel-head'); H(ah, 'h3', '', '今日新收录论文'); H(ah, 'span', 'rpd-progress-value', b.newCount + ' 篇');
    if (!b.todayNew.length) empty(added, '今天暂无新收录论文。');
    else { const list = H(added, 'details', 'rpd-home-more'); H(list, 'summary', '', '展开今日论文'); b.todayNew.forEach((p, i) => { const row = H(list, 'div', 'rpd-home-paper'); const hd = H(row, 'div', 'rpd-home-paper-head'); H(hd, 'span', 'rpd-home-index', String(i + 1).padStart(2, '0')); const body = H(hd, 'div', 'rpd-home-paper-body'); paperRef(body, p); if (p.titleZh && p.titleZh !== p.title) H(body, 'div', 'rpd-zh', p.titleZh); if (p.summary) H(body, 'p', 'rpd-sum', p.summary); if (p.publishedAt) H(body, 'span', 'rpd-muted', '发表：' + p.publishedAt); }); }
  }

  const queue = H(c, 'details', 'rpd-overview-panel rpd-home-alerts'); H(queue, 'summary', '', '阅读队列 · ' + queueIds.length + ' 篇');
  if (!queueIds.length) empty(queue, '阅读队列为空。');
  const queued = await Promise.all(queueIds.map(id => get('/papers/' + enc(id))));
  queued.forEach((res, i) => {
    const row = H(queue, 'div', 'rpd-row'); const p = res.data;
    H(row, 'span', 'rpd-row-t', p ? paperTitle(p) : queueIds[i]);
    if (p) noteButton(row, p);
    btn(row, '移出', 'rpd-ghost', async () => { const q = await act(() => http('PUT', '/me/queue', { body: { paperIds: queueIds.filter(x => x !== queueIds[i]) } })); if (q) { queueIds = q.paperIds; render(); } });
  });

  jobsPanel(c, jobs);
  const flagged = experiments.filter(e => ALERT_STATUS.includes(e.status));
  const attention = pipeline.data?.attention || [];
  const alerts = H(c, 'details', 'rpd-overview-panel rpd-home-alerts'); H(alerts, 'summary', '', '实验与流程状态 · ' + (flagged.length + attention.length) + ' 项待关注');
  flagged.forEach(e => { const row = H(alerts, 'div', 'rpd-row'); fileLink(row, e.path, e.title); H(row, 'span', 'rpd-tag warn', e.status); H(row, 'span', 'rpd-muted', e.server); });
  attention.forEach(item => { const row = H(alerts, 'div', 'rpd-row'); H(row, 'span', 'rpd-tag ' + (item.severity === 'info' ? 'soft' : 'warn'), item.severity === 'error' ? '错误' : item.severity === 'warn' ? '注意' : '提示'); H(row, 'strong', 'rpd-row-t', item.title); H(row, 'span', 'rpd-muted', item.summary); });
  if (!flagged.length && !attention.length) empty(alerts, pipeline.data ? '暂无需要处理的实验或流程事项。' : '流水线状态：' + (pipeline.error?.status === 404 ? '还没有运行记录。' : errorText(pipeline.error)));
  const run = pipeline.data?.latestRun;
  if (run) {
    const steps = H(c, 'details', 'rpd-overview-panel rpd-home-alerts'); H(steps, 'summary', '', '流程明细 · ' + run.date + ' · ' + ({ running: '运行中', ok: '全部成功', partial: '部分失败', failed: '失败' }[run.status] || run.status));
    run.steps.forEach(s => { const row = H(steps, 'div', 'rpd-row'); H(row, 'span', 'rpd-tag ' + (s.status === 'failed' ? 'warn' : s.status === 'ok' ? 'good' : 'soft'), { pending: '等待', running: '运行中', ok: '完成', failed: '失败', skipped: '跳过' }[s.status]); H(row, 'span', 'rpd-row-t', s.name); if (s.error) H(row, 'span', 'rpd-muted', s.error); if (s.status === 'failed') taskBtn(row, '重跑', 'rpd-ghost', 'retry-step', () => startTask('retry-step', { runId: run.runId, step: s.key }, '重跑「' + s.name + '」')); });
  }
};

R.experiments = async c => {
  H(c, 'h2', 'rpd-issue-h', '实验记录');
  H(c, 'p', 'rpd-lead', '实验在远端服务器运行；这里记录配置、运行状态、结果与结论。');
  const actions = H(c, 'div', 'rpd-tools');
  btn(actions, '新建实验记录', 'rpd-primary', createExperimentRecord);
  btn(actions, '刷新', '', () => { loadExperiments(); render(); });
  const section = sec(c, '我的实验记录', experiments.length + ' 条 · vault 中“实验记录/”或带 #experiment / type: experiment 的笔记');
  if (!experiments.length) empty(section, '暂无实验记录。');
  experiments.forEach(e => { const card = H(section, 'article', 'rpd-card'); const header = H(card, 'div', 'rpd-card-head'); fileLink(header, e.path, e.title); H(header, 'span', 'rpd-tag ' + (ALERT_STATUS.includes(e.status) ? 'warn' : 'soft'), e.status); const meta = H(card, 'div', 'rpd-meta'); H(meta, 'span', '', '服务器：' + e.server); if (e.updated) H(meta, 'span', '', '更新：' + new Date(e.updated).toLocaleString('zh-CN')); if (e.summary) H(card, 'p', 'rpd-sum', e.summary); });
  const repro = sec(c, '复现配置组', '后端汇总的复现结果与论文数字的差距');
  const data = shown(repro, await get('/experiments'), '复现配置组');
  if (data) {
    if (!data.reproGroups.length) empty(repro, '暂无复现配置组。');
    else table(repro, ['配置组', '论文', 'Run', '状态', '容差内', '差得最多'], data.reproGroups.map(g => [g.name, td => g.paper ? paperRef(td, g.paper) : td.setText('—'), g.runCount, g.status, g.withinTolerance + ' / ' + g.total + (g.missing ? '（' + g.missing + ' 项没跑）' : ''), g.worstDiffs.map(d => d.metric + ' ' + (d.delta > 0 ? '+' : '') + d.delta).join('，') || '—']));
  }
};

const CATEGORY = { core: ['核心', '与你的关键词树直接匹配'], adjacent: ['邻近', '和你标为相关的论文有引用关系，但不在你的关键词里'], trending: ['热点', '一级领域里增长快、讨论多，不看关键词'] };
function recCard(el, p, redraw) {
  const head = H(el, 'div', 'rpd-card-head');
  H(head, 'h3', 'rpd-card-title', p.titleEn || p.titleZh);
  H(head, 'span', 'rpd-quality', '质量 ' + p.quality.score.toFixed(1));
  if (p.titleEn && p.titleZh && p.titleZh !== p.titleEn) H(el, 'div', 'rpd-zh', p.titleZh);
  H(el, 'p', 'rpd-sum', p.summary);
  const why = H(el, 'p', 'rpd-reason'); H(why, 'span', 'rpd-tag accent', CATEGORY[p.category][0]); H(why, 'span', '', ' ' + p.reason);
  const meta = H(el, 'div', 'rpd-meta');
  extLink(meta, p.url, p.id); H(meta, 'span', '', p.publishedAt);
  if (p.institutions?.length) H(meta, 'span', 'rpd-inst', p.institutions.join(' · '));
  H(meta, 'span', '', '被引 ' + num(p.citations.count));
  if (p.codeUrl) extLink(meta, p.codeUrl, '代码'); if (p.hfUpvotes) H(meta, 'span', 'rpd-tag', '🤗 ' + p.hfUpvotes);
  if (p.picked) H(meta, 'span', 'rpd-tag good', '今日精选');
  (p.sources || []).forEach(s => H(meta, 'span', 'rpd-tag soft', s));
  if (p.matchedKeywords.length) { const tags = H(el, 'div', 'rpd-tags'); p.matchedKeywords.forEach(k => H(tags, 'span', 'rpd-tag soft', k.label)); }
  const bar = H(el, 'div', 'rpd-bar');
  userControls(bar, p, redraw);
  btn(bar, queueIds?.includes(p.id) ? '已在队列' : '加入阅读队列', 'rpd-ghost', async () => { await addToQueue(p.id); redraw(); });
  noteButton(bar, p);
  deepReadButtons(bar, el, p);
}
function deepReadButtons(bar, el, p) {
  btn(bar, '查看精读', 'rpd-ghost', async () => {
    const box = el.querySelector('.rpd-deep-read') || H(el, 'div', 'rpd-deep-read'); box.empty();
    let d; try { d = await http('GET', '/papers/' + enc(p.id) + '/deep-read'); } catch (e) { box.remove(); return toast(e.status === 404 ? '还没有精读，可以点“生成精读”' : errorText(e)); }
    const tools = H(box, 'div', 'rpd-tools'); H(tools, 'span', 'rpd-muted', 'AI 精读 · ' + fmtTime(d.generatedAt));
    btn(tools, '存为阅读笔记', '', () => createPaperNote(p, d.markdown)); btn(tools, '收起', 'rpd-ghost', () => box.remove());
    await renderMd(H(box, 'div', 'rpd-md'), d.markdown);
  });
  taskBtn(bar, '生成精读', 'rpd-ghost', 'deep-read', () => startTask('deep-read', { paperId: p.id }, '精读 ' + p.id));
}
// ---------- 作者机构与关注的人（约定 5.19） ----------
let followKeys = null;
async function loadFollows(force) {
  if (followKeys && !force) return followKeys;
  try { followKeys = new Set((await http('GET', '/me/follows')).people.map(p => p.key)); } catch (e) { followKeys = followKeys || new Set(); }
  return followKeys;
}
// 关注 / 取消关注一个人；institution 是机构 key（团队页用上级机构，论文作者用他自己的机构）。
async function toggleFollow(person, institution) {
  const on = followKeys?.has(person.key);
  const r = await act(() => on ? http('DELETE', '/me/follows/' + enc(person.key))
    : http('PUT', '/me/follows/' + enc(person.key), { body: { name: person.name, openalexId: /^A\d+$/.test(person.key) ? person.key : null, institution: institution || null } }),
    on ? '已取消关注' : '已关注 ' + person.name + '，他的新论文会进每日推荐');
  if (r) followKeys = new Set(r.people.map(p => p.key));
  return !!r;
}
// 论文卡片下展开每位作者的机构（✉ 是通讯作者），可以直接关注某位作者。
async function authorsBox(el, id) {
  const old = el.querySelector('.rpd-authors'); if (old) { old.remove(); return; }
  const box = H(el, 'div', 'rpd-authors'); H(box, 'p', 'rpd-muted', '加载中…');
  let p; try { [p] = await Promise.all([http('GET', '/papers/' + enc(id)), loadFollows()]); } catch (e) { box.empty(); H(box, 'p', 'rpd-muted', errorText(e)); return; }
  box.empty();
  if (!p.authorsDetail) { H(box, 'p', 'rpd-muted', '还没整理这篇的作者机构（每天推荐时会补；也可以在“团队”页点“整理作者机构”）。作者：' + (p.authors.join('、') || '—')); return; }
  const src = p.affiliations?.sources || [];
  H(box, 'p', 'rpd-muted', '来源：' + (src.map(x => ({ openalex: 'OpenAlex', pdf: 'PDF 第一页' }[x])).join(' + ') || '没查到') + (src.includes('pdf') ? '' : '（没读 PDF，不知道通讯作者）'));
  p.authorsDetail.forEach(a => {
    const row = H(box, 'div', 'rpd-row');
    H(row, 'strong', '', a.name + (a.corresponding ? ' ✉' : ''));
    H(row, 'span', 'rpd-muted', a.affiliations.map(f => [f.parent, f.nameZh || f.name, f.unit].filter(Boolean).join(' · ')).join('；') || '机构不明');
    const draw = () => { const b = row.querySelector('.rpd-follow'); if (b) b.remove(); const c = chip(row, followKeys.has(a.personKey) ? '已关注' : '关注', followKeys.has(a.personKey), async () => { if (await toggleFollow({ key: a.personKey, name: a.name }, a.affiliations[0]?.key)) draw(); }); c.addClass('rpd-follow'); };
    draw();
  });
}

// 团队：按机构聚合论文库，看哪些团队在做和你一样的方向，挑要关注的人。
R.teams = async c => {
  const t = T.teams;
  H(c, 'h2', 'rpd-issue-h', '团队');
  H(c, 'p', 'rpd-muted', '按作者机构聚合论文库里的论文：越和你的方向相关的论文权重越高，排在前面的机构就是和你做同样内容的团队。每个机构里按当通讯作者 / 末位作者的次数列出人，点“关注”后他们的新论文会进每日推荐。');
  const bar = H(c, 'div', 'rpd-tools');
  const search = H(bar, 'input', 'rpd-search'); search.type = 'search'; search.placeholder = '搜机构、人名、院系 / 实验室'; search.value = t.q;
  search.addEventListener('change', () => { t.q = search.value.trim(); render(); });
  taskBtn(bar, '整理作者机构', '', 'rebuild-affiliations', () => startTask('rebuild-affiliations', {}, '整理作者机构（OpenAlex + 读 PDF 第一页，全库要一阵子）'));
  const [res, fol] = await Promise.all([get('/teams?limit=80' + (t.q ? '&q=' + enc(t.q) : '')), get('/me/follows')]);
  if (fol.data) followKeys = new Set(fol.data.people.map(p => p.key));
  const fs = sec(c, '关注的人', (fol.data?.people.length || 0) + ' 位 · 他们的新论文会进每日推荐（邻近类）');
  if (fol.data && !fol.data.people.length) empty(fs, '还没关注任何人。在下面的机构里，或论文卡片的“作者与机构”里点“关注”。');
  (fol.data?.people || []).forEach(p => { const row = H(fs, 'div', 'rpd-row'); H(row, 'strong', '', p.name); H(row, 'span', 'rpd-muted', p.institutionName || '');
    btn(row, '取消关注', 'rpd-ghost', async () => { if (await toggleFollow(p)) render(); }); });
  const data = shown(c, res, '团队');
  if (!data) return;
  const cov = data.coverage;
  H(c, 'p', 'rpd-muted', '论文库 ' + cov.papers + ' 篇里 ' + cov.withAffiliations + ' 篇有机构信息' + (cov.withAffiliations < cov.papers ? '；其余的每天推荐时补一些，想一次补完点“整理作者机构”。' : '。') + ' 共 ' + data.total + ' 个机构。');
  if (!data.items.length) empty(c, t.q ? '没有符合的机构。' : '还没有机构信息。点“整理作者机构”。');
  const cards = H(c, 'div', 'rpd-cards');
  data.items.forEach(g => mount(cards, (el, g, redraw) => {
    const head = H(el, 'div', 'rpd-card-head'); H(head, 'h3', 'rpd-card-title', g.nameZh || g.name);
    H(head, 'span', 'rpd-quality', g.paperCount + ' 篇');
    if (g.nameZh && g.nameZh !== g.name) H(el, 'div', 'rpd-en', g.name);
    const meta = H(el, 'div', 'rpd-meta'); if (g.country) H(meta, 'span', '', g.country); if (g.latestYear) H(meta, 'span', '', '最近 ' + g.latestYear);
    g.units.forEach(u => H(meta, 'span', 'rpd-tag soft', u));
    if (g.keywords.length) { const tags = H(el, 'div', 'rpd-tags'); g.keywords.forEach(k => H(tags, 'span', 'rpd-tag topic', k.label + ' ' + k.count)); }
    const people = H(el, 'div', 'rpd-team-people');
    g.people.forEach(p => {
      const row = H(people, 'div', 'rpd-row'); H(row, 'strong', '', p.name);
      H(row, 'span', 'rpd-muted', p.paperCount + ' 篇' + (p.correspondingCount ? ' · 通讯作者 ' + p.correspondingCount : '') + (p.lastAuthorCount ? ' · 末位 ' + p.lastAuthorCount : ''));
      chip(row, p.followed ? '已关注' : '关注', p.followed, async () => { if (await toggleFollow(p, g.key)) { p.followed = !p.followed; redraw(); } });
    });
    const line = H(el, 'div', 'rpd-brief-sources'); H(line, 'span', 'rpd-muted', '论文：');
    g.papers.forEach((ref, i) => { if (i) H(line, 'span', 'rpd-muted', ' · '); paperRef(line, ref); });
  }, g));
};

// 卡片自带重画函数：改了评分、标记后只重画这一张，不重新拉整页数据。
function mount(parent, draw, data, cls) { const holder = H(parent, 'article', cls || 'rpd-card'); const redraw = () => { holder.empty(); draw(holder, data, redraw); }; redraw(); return holder; }

R.issue = async c => {
  H(c, 'h2', 'rpd-issue-h', '论文推荐');
  H(c, 'p', 'rpd-muted', '按与你的研究兴趣的关系分三类，不设比例，找到多少就是多少。标“相关 / 不相关”会用来整理你的关键词树。');
  const top = H(c, 'div', 'rpd-tools');
  taskBtn(top, '立刻刷新今天的推荐', '', 'run-daily', () => startTask('run-daily', {}, '刷新今天的推荐'));
  H(top, 'span', 'rpd-muted', '平时每天按“设置 → 每日推荐”里的时间自动运行；全文速读较慢，可能要几十分钟。');
  const index = await get('/recommendations');
  if (index.error?.status === 404) return empty(c, '还没有任何一期推荐。点“立刻刷新今天的推荐”，或等到设置的时间自动运行。');
  const issues = shown(c, index, '推荐')?.issues;
  if (!issues) return;
  if (!issues.length) return empty(c, '还没有任何一期推荐。');
  if (!T.issue.date || !issues.some(i => i.date === T.issue.date)) T.issue.date = issues[0].date;
  const tools = H(c, 'div', 'rpd-tools');
  const select = H(tools, 'select', 'rpd-select'); select.setAttribute('aria-label', '选择日期');
  issues.forEach(i => { const o = H(select, 'option', '', i.date + ' · ' + (i.counts.core + i.counts.adjacent + i.counts.trending) + ' 篇'); o.value = i.date; });
  select.value = T.issue.date; select.addEventListener('change', () => { T.issue.date = select.value; render(); });
  const search = H(tools, 'input', 'rpd-search'); search.type = 'search'; search.placeholder = '搜索这一期'; search.value = T.issue.q;
  const [day] = await Promise.all([get('/recommendations/' + T.issue.date), loadQueue()]);
  const data = shown(c, day, T.issue.date + ' 的推荐');
  if (!data) return;
  const list = H(c, 'div');
  function fill() {
    list.empty(); const q = T.issue.q.toLowerCase();
    Object.entries(CATEGORY).forEach(([key, [name, hint]]) => {
      const papers = data.papers.filter(p => p.category === key && (p.titleZh + ' ' + p.titleEn + ' ' + p.summary + ' ' + p.id).toLowerCase().includes(q));
      const s = sec(list, name + ' · ' + papers.length + ' 篇', hint);
      if (!papers.length) empty(s, q ? '没有符合搜索的论文。' : '这一类今天没有找到论文。');
      papers.forEach(p => mount(s, recCard, p));
    });
  }
  search.addEventListener('input', () => { T.issue.q = search.value; fill(); });
  fill();
};

// 关注论文表格里的可编辑单元格（和 Base 一样直接在表里改）。改过的字段后端会记下，自动流程不再覆盖。
const PUB_STATUS = ['已发表', '已录用', '投稿中', '预印本', '待核实'];
async function savePaperField(p, field, value) {
  const updated = await act(() => http('PATCH', '/papers/' + enc(p.id), { body: { [field]: value } }), '已保存');
  if (updated) p[field] = updated[field];
  return !!updated;
}
function selectCell(td, options, value, emptyLabel, save) {
  const select = H(td, 'select', 'rpd-select rpd-cell');
  const all = emptyLabel != null ? ['', ...options] : [...options];
  if (value && !all.includes(value)) all.push(value);
  all.forEach(v => { H(select, 'option', '', v || emptyLabel).value = v; });
  select.value = value;
  select.addEventListener('change', async () => { select.disabled = true; if (!(await save(select.value))) select.value = value; else value = select.value; select.disabled = false; });
}
function inputCell(td, value, placeholder, save, cls) {
  const input = H(td, 'input', 'rpd-input rpd-cell ' + (cls || '')); input.value = value || ''; input.placeholder = placeholder;
  let saved = input.value;
  const commit = async () => { const v = input.value.trim(); if (v === saved) return; input.disabled = true; if (await save(v)) saved = v; else input.value = saved; input.disabled = false; };
  input.addEventListener('change', commit);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = saved; input.blur(); } });
}
R.watched = async c => {
  H(c, 'h2', 'rpd-issue-h', '关注论文');
  H(c, 'p', 'rpd-muted', '你标为“重点关注”的论文。表里的讨论状态、发表状态、发表来源、年份、第一作者都可以直接改；你改过的内容，自动流程不会再覆盖。');
  const bar = H(c, 'div', 'rpd-tools');
  const search = H(bar, 'input', 'rpd-search'); search.type = 'search'; search.placeholder = '搜索标题、作者、年份或来源'; search.value = T.watched.q;
  const filter = H(bar, 'select', 'rpd-select'); filter.setAttribute('aria-label', '筛选讨论状态');
  ['全部', ...DISCUSSION].forEach(value => { const option = H(filter, 'option', '', value); option.value = value; }); filter.value = T.watched.status;
  btn(bar, '刷新', '', () => render());
  btn(bar, '添加关注论文', 'rpd-primary', () => addPaperForm(formSlot, 'watched'));
  const formSlot = H(c, 'div');
  const res = await get('/papers?watched=true&limit=200');
  const data = shown(c, res, '关注论文');
  if (!data) return;
  const count = H(c, 'p', 'rpd-count'); const list = H(c, 'div');
  function fill() {
    list.empty(); const query = T.watched.q.trim().toLowerCase();
    const rows = data.items.filter(p => (T.watched.status === '全部' || p.user.discussionStatus === T.watched.status) && [p.title, p.titleZh, p.id, p.firstAuthor, p.year, p.venue, p.publicationStatus].join(' ').toLowerCase().includes(query));
    count.setText('重点关注 · ' + rows.length + ' / ' + data.total + ' 篇');
    if (!rows.length) return empty(list, data.items.length ? '没有符合条件的关注论文。' : '还没有重点关注的论文。点“添加关注论文”贴上链接，或在论文推荐、论文库里点“重点关注”。整理关键词时会读这些论文的 PDF。');
    table(list, ['论文', '讨论状态', '发表状态', '发表来源', '年份', '第一作者', '被引', '资料'], rows.map(p => [
      td => { H(td, 'div', 'rpd-row-t', paperTitle(p)); zhLine(td, p); titleTools(H(td, 'div', 'rpd-tools'), p, fill); },
      td => selectCell(td, DISCUSSION, p.user.discussionStatus || '', '未设置', async v => { const u = await act(() => http('PATCH', '/me/papers/' + enc(p.id), { body: { discussionStatus: v || null } }), '讨论状态已保存'); if (u) p.user = u; return !!u; }),
      td => selectCell(td, PUB_STATUS, p.publicationStatus, null, v => savePaperField(p, 'publicationStatus', v)),
      td => inputCell(td, p.venue, '如 ICML 2025', v => savePaperField(p, 'venue', v)),
      td => inputCell(td, p.year == null ? '' : String(p.year), '年份', v => { if (v && !/^\d{4}$/.test(v)) { toast('年份要是四位数字'); return false; } return savePaperField(p, 'year', v ? Number(v) : null); }, 'rpd-cell-year'),
      td => inputCell(td, p.firstAuthor, '第一作者', v => savePaperField(p, 'firstAuthor', v)),
      num(p.citations.count),
      td => { const tools = H(td, 'div', 'rpd-cell-links'); if (p.hasPdf) btn(tools, 'PDF', 'rpd-link', () => openPdf(p.id)); else if (p.urls?.pdf) extLink(tools, p.urls.pdf, 'PDF'); const src = p.urls?.source || sourceUrl(p.id); if (src) extLink(tools, src, '原文'); const note = noteFor(p.id); btn(tools, note ? '笔记' : '建笔记', 'rpd-link', () => note ? open(note.path) : createPaperNote(p)); btn(tools, '取消关注', 'rpd-link', async () => { const u = await act(() => http('PATCH', '/me/papers/' + enc(p.id), { body: { watched: false } }), '已取消关注'); if (u) render(); }); }
    ]));
  }
  search.addEventListener('input', () => { T.watched.q = search.value; fill(); });
  filter.addEventListener('change', () => { T.watched.status = filter.value; fill(); });
  fill();
};

// ---------- 论文库（照原面板：分面筛选 + 卡片） ----------
const RELEVANCE = { core: '核心相关', related: '相关', none: '未判定' };
const LIB_SORTS = [['relevance', '核心相关优先'], ['newest', '最新'], ['citations', '被引最多'], ['rating', '我的评价'], ['added', '最近加入']];
const LIB_FACETS = [['topic', '方向'], ['venue', '会议 / 期刊'], ['year', '年份'], ['status', '发表状态'], ['relevance', '相关程度']];
const LIB_PAGE = 50;
function sourceLabel(p) {
  if (p.id.startsWith('arxiv-')) return 'arXiv ' + p.id.slice(6);
  if (p.id.startsWith('openreview-')) return 'OpenReview';
  if (p.id.startsWith('acl-')) return 'ACL Anthology';
  if (p.id.startsWith('doi-')) return 'DOI';
  return '原文';
}
function libCard(el, p, redraw) {
  const head = H(el, 'div', 'rpd-card-head');
  H(head, 'h3', 'rpd-card-title', paperTitle(p));
  if (p.libraryRelevance) H(head, 'span', 'rpd-quality' + (p.libraryRelevance === 'core' ? '' : ' is-soft'), RELEVANCE[p.libraryRelevance]);
  zhLine(el, p);
  if (!titleKnown(p)) titleTools(H(el, 'div', 'rpd-tools'), p, redraw);
  if (p.summary) H(el, 'p', 'rpd-sum', p.summary);
  const meta = H(el, 'div', 'rpd-meta');
  if (p.venue) H(meta, 'span', 'rpd-venue', p.venue);
  if (p.publicationStatus !== '已发表') H(meta, 'span', 'rpd-tag warn', p.publicationStatus === '待核实' ? '会议待核实' : p.publicationStatus);
  const src = p.urls?.source || sourceUrl(p.id);
  if (src) extLink(meta, src, sourceLabel(p));
  if (p.firstAuthor) H(meta, 'span', '', p.firstAuthor + (p.year ? ' · ' + p.year : ''));
  if (p.institutions?.length) H(meta, 'span', 'rpd-inst', p.institutions.join(' · '));
  btn(meta, '作者与机构', 'rpd-link', () => authorsBox(el, p.id));
  if (p.citations?.count != null) H(meta, 'span', '', '被引 ' + p.citations.count);
  if (p.hasPdf) btn(meta, 'PDF', 'rpd-link', () => openPdf(p.id)); else if (p.urls?.pdf) extLink(meta, p.urls.pdf, 'PDF');
  if (p.urls?.code) extLink(meta, p.urls.code, '代码');
  if (p.user.own) H(meta, 'span', 'rpd-tag accent', '本人论文');
  const note = noteFor(p.id); if (note) H(meta, 'span', 'rpd-tag soft', '笔记：' + note.status);
  const bar = H(el, 'div', 'rpd-lib-bar');
  const tags = H(bar, 'div', 'rpd-lib-tags'); p.topics.forEach(t => H(tags, 'span', 'rpd-tag topic', t));
  const acts = H(bar, 'div', 'rpd-lib-acts');
  star(acts, p.user.rating, v => patchUser(p, { rating: v }, redraw), '我的评价');
  chip(acts, p.user.watched ? '已关注' : '关注', p.user.watched, () => patchUser(p, { watched: !p.user.watched }, redraw));
  btn(acts, queueIds?.includes(p.id) ? '已在队列' : '加入队列', 'rpd-ghost', async () => { await addToQueue(p.id); redraw(); });
  noteButton(acts, p);
  const more = H(acts, 'details', 'rpd-more'); H(more, 'summary', '', '更多');
  const menu = H(more, 'div', 'rpd-more-menu');
  chip(menu, p.user.own ? '✓ 本人论文' : '标为本人论文', p.user.own, () => patchUser(p, { own: !p.user.own }, redraw));
  deepReadButtons(menu, el, p);
  btn(menu, p.hasPdf ? '替换 PDF' : '上传 PDF', 'rpd-ghost', async () => { if (await uploadPdf(p.id)) { p.hasPdf = true; redraw(); } });
  if (titleKnown(p)) titleTools(menu, p, redraw);
  H(menu, 'div', 'rpd-muted', 'ID：' + p.id);
}
R.lib = async c => {
  const t = T.lib;
  H(c, 'h2', 'rpd-issue-h', '论文库');
  const intro = H(c, 'p', 'rpd-muted', '收录判断是否属于你的研究方向（核心相关 / 相关），每篇都有 AI 生成的中文标题和一句话总结，以原文为准。');
  const bar = H(c, 'div', 'rpd-tools rpd-lib-toolbar');
  const search = H(bar, 'input', 'rpd-search rpd-lib-search'); search.type = 'search'; search.placeholder = '搜标题、摘要、速读、作者'; search.value = t.q;
  const sortSel = H(bar, 'select', 'rpd-select'); sortSel.setAttribute('aria-label', '排序');
  LIB_SORTS.forEach(([v, l]) => { H(sortSel, 'option', '', l).value = v; }); sortSel.value = t.sort;
  const rateSel = H(bar, 'select', 'rpd-select'); rateSel.setAttribute('aria-label', '我的评价');
  [['', '我的评价：全部'], ['unrated', '未评价'], ['3', '★3 及以上'], ['4', '★4 及以上'], ['5', '★5']].forEach(([v, l]) => { H(rateSel, 'option', '', l).value = v; }); rateSel.value = t.rating;
  const wl = H(bar, 'label', 'rpd-check'); const wcb = H(wl, 'input'); wcb.type = 'checkbox'; wcb.checked = t.watched; H(wl, 'span', '', '只看重点关注');
  const facetBox = H(c, 'div', 'rpd-facets');
  await loadQueue();
  const list = H(c, 'div');
  const query = () => {
    const qs = ['limit=' + LIB_PAGE, 'cursor=' + t.page * LIB_PAGE, 'facets=true', 'sort=' + t.sort];
    if (t.q) qs.push('q=' + enc(t.q)); if (t.rating) qs.push('rating=' + t.rating); if (t.watched) qs.push('watched=true');
    Object.entries(t.f).forEach(([k, v]) => { if (v) qs.push(k + '=' + enc(v)); });
    return '/papers?' + qs.join('&');
  };
  const facetLabel = (k, v) => k === 'relevance' ? RELEVANCE[v] || v : v;
  async function fill() {
    const res = await get(query());
    list.empty(); facetBox.empty();
    const data = shown(list, res, '论文库');
    if (!data) return;
    LIB_FACETS.forEach(([k, name]) => {
      const values = data.facets?.[k] || [];
      if (!values.length) return;
      const row = H(facetBox, 'div', 'rpd-facet'); H(row, 'span', 'rpd-facet-l', name);
      const limit = t.open[k] ? values.length : 12;
      values.slice(0, limit).forEach(v => chip(row, facetLabel(k, v.label) + ' ' + v.count, t.f[k] === v.label, () => { t.f[k] = t.f[k] === v.label ? '' : v.label; t.page = 0; fill(); }));
      if (values.length > 12) btn(row, t.open[k] ? '收起' : '更多 ' + (values.length - 12), 'rpd-link', () => { t.open[k] = !t.open[k]; fill(); });
    });
    const active = Object.values(t.f).some(Boolean) || t.q || t.rating || t.watched;
    const from = data.total ? t.page * LIB_PAGE + 1 : 0, to = t.page * LIB_PAGE + data.items.length;
    const count = H(list, 'div', 'rpd-count'); count.setText('共 ' + data.total + ' 篇' + (data.total ? '，第 ' + from + '–' + to + ' 篇' : ''));
    if (active) btn(count, '清除筛选', 'rpd-link', () => { t.f = {}; t.q = ''; t.rating = ''; t.watched = false; t.page = 0; render(); });
    if (!data.items.length) empty(list, active ? '没有符合条件的论文。' : '论文库是空的。');
    const cards = H(list, 'div', 'rpd-cards');
    data.items.forEach(p => mount(cards, libCard, p));
    const pages = Math.ceil(data.total / LIB_PAGE);
    if (pages > 1) {
      const pager = H(list, 'div', 'rpd-tools rpd-pager');
      btn(pager, '上一页', '', () => { t.page--; fill(); list.scrollIntoView(); }).disabled = t.page === 0;
      H(pager, 'span', 'rpd-muted', '第 ' + (t.page + 1) + ' / ' + pages + ' 页');
      btn(pager, '下一页', '', () => { t.page++; fill(); list.scrollIntoView(); }).disabled = t.page >= pages - 1;
    }
    const unlinked = active || t.page ? [] : notes.filter(n => !n.paperId);
    if (unlinked.length) { const sNotes = sec(list, '其他阅读笔记', '没有关联论文（frontmatter 里没有 paper_id）'); unlinked.forEach(n => { const row = H(sNotes, 'div', 'rpd-row'); fileLink(row, n.path, n.name); H(row, 'span', 'rpd-tag soft', n.status); }); }
  }
  let timer;
  search.addEventListener('input', () => { t.q = search.value.trim(); t.page = 0; clearTimeout(timer); timer = setTimeout(fill, 300); });
  sortSel.addEventListener('change', () => { t.sort = sortSel.value; t.page = 0; fill(); });
  rateSel.addEventListener('change', () => { t.rating = rateSel.value; t.page = 0; fill(); });
  wcb.addEventListener('change', () => { t.watched = wcb.checked; t.page = 0; fill(); });
  await fill();
};

R.must = async c => {
  H(c, 'h2', 'rpd-issue-h', '经典与必读');
  const tools = H(c, 'div', 'rpd-tools');
  taskBtn(tools, '重新整理', '', 'rebuild-classics', () => startTask('rebuild-classics', {}, '重新整理经典与必读'));
  const data = shown(c, await get('/classics'), '经典与必读');
  if (!data) return;
  const r = data.rules;
  H(tools, 'span', 'rpd-muted', '经典：被论文库 ' + r.libraryPapers + ' 篇里至少 ' + r.libraryCitationMin + ' 篇引用的工作（不限年份）；必读：论文库里核心相关的论文按发表年份分段，逐篇判断，符合标准的都选、不限篇数；新作不和老论文比被引。整理于 ' + fmtTime(data.generatedAt) + '。');
  const when = it => [it.date && it.date !== '0000' ? it.date : null, it.venue || null].filter(Boolean).join(' · ');
  const evidence = e => [e.libraryCitations != null ? '论文库里 ' + e.libraryCitations + ' 篇引用' : null, e.citations != null ? '总被引 ' + e.citations : null,
    e.baselineCount != null ? '被 ' + e.baselineCount + ' 篇当作对比方法' : null, e.githubStars != null ? '★' + e.githubStars : null].filter(Boolean).join(' · ') || '—';
  const ROLE_CLS = { 开创: 'good', 奠基: 'accent', 代表: 'soft' };
  if (data.startHere.length) {
    const s = sec(c, '从这里读起', '建议按这个顺序读');
    const g = H(s, 'div', 'rpd-grid');
    data.startHere.forEach((it, i) => { const k = H(g, 'div', 'rpd-tile'); H(k, 'span', 'rpd-muted', String(i + 1).padStart(2, '0') + (when(it) ? ' · ' + when(it) : '')); paperRef(H(k, 'strong'), it.paper); H(k, 'p', '', it.why); });
  }
  const routes = sec(c, '经典工作', data.routes.reduce((n, rt) => n + rt.items.length, 0) + ' 篇 · 按技术路线');
  data.routes.forEach(route => {
    const box = H(routes, 'details', 'rpd-route'); box.open = route.name !== '通用基础（大模型与通用方法）';
    const sum = H(box, 'summary'); H(sum, 'strong', '', route.name); H(sum, 'span', 'rpd-muted', ' · ' + route.items.length + ' 篇');
    if (route.intro) H(box, 'p', 'rpd-muted', route.intro);
    route.items.forEach(it => {
      const row = H(box, 'div', 'rpd-classic'); const hd = H(row, 'div', 'rpd-classic-h');
      H(hd, 'span', 'rpd-tag ' + (ROLE_CLS[it.role] || 'soft'), it.role); paperRef(H(hd, 'strong'), it.paper); if (when(it)) H(hd, 'span', 'rpd-muted', when(it));
      if (it.why) H(row, 'p', 'rpd-sum', it.why);
      H(row, 'div', 'rpd-muted', evidence(it.evidence));
    });
  });
  const must = sec(c, '必读论文', data.mustRead.length + ' 篇 · 论文库里核心相关的，按发表年份分段');
  const periods = [...new Set(data.mustRead.map(m => m.period).filter(Boolean))];
  if (!periods.includes(T.must.period)) T.must.period = '全部';
  if (periods.length) { const fp = H(must, 'div', 'rpd-tools'); ['全部', ...periods].forEach(p => chip(fp, p === '全部' ? '全部年份' : p, T.must.period === p, () => { T.must.period = p; render(); })); }
  const ft = H(must, 'div', 'rpd-tools'); ['全部', 'CCF-A 会议', 'CCF-A 期刊', '其他'].forEach(t => chip(ft, t, T.must.tier === t, () => { T.must.tier = t; render(); }));
  const rows = data.mustRead.filter(m => (T.must.tier === '全部' || m.venueTier === T.must.tier) && (T.must.period === '全部' || m.period === T.must.period));
  if (!rows.length) empty(must, '没有符合条件的必读论文。');
  else table(must, ['分段', '时间', '会议 / 期刊', '论文', '为什么必读', '依据'], rows.map(m => [m.period || '—', m.date && m.date !== '0000' ? m.date : '—', m.venue || '—', td => paperRef(td, m.paper), m.why, evidence(m.evidence)]));
};

R.map = async c => {
  H(c, 'h2', 'rpd-issue-h', '研究领域发展史');
  const tools = H(c, 'div', 'rpd-tools');
  ['发展史', '热点演变', '热点变化', '评测与基线', '空白与其它发现', '分类'].forEach(s => chip(tools, s, T.map.sec === s, () => { T.map.sec = s; render(); }));
  taskBtn(tools, '重新整理', '', 'rebuild-map', () => startTask('rebuild-map', {}, '重新整理领域发展史'));
  const data = shown(c, await get('/map'), '领域发展史');
  if (!data) return;
  H(c, 'p', 'rpd-muted', '整理于 ' + fmtTime(data.generatedAt) + ' · 以论文原文为准');
  if (T.map.sec === '发展史') {
    H(c, 'p', 'rpd-lead', data.intro);
    data.stages.forEach(stage => { const block = H(c, 'div', 'rpd-stage'); const header = H(block, 'div', 'rpd-stage-h'); H(header, 'span', 'rpd-year', stage.period); H(header, 'h3', '', stage.title); H(block, 'p', 'rpd-muted', stage.description); stage.milestones.forEach(m => { const row = H(block, 'div', 'rpd-miles'); H(row, 'span', 'rpd-mile-d', m.date + (m.venue ? ' ' + m.venue : '')); const t = H(row, 'span'); paperRef(t, m.paper); H(t, 'span', '', '：' + m.text); }); });
  } else if (T.map.sec === '热点演变') {
    const hots = Array.isArray(data.hotspots) ? data.hotspots : data.hotspots ? [{ stream: 'main', name: 'arXiv', ...data.hotspots }] : [];
    if (hots.length > 1) {
      if (!hots.some(h => h.stream === T.map.stream)) T.map.stream = hots[0].stream;
      const bar = H(c, 'div', 'rpd-tools'); hots.forEach(h => chip(bar, h.name, T.map.stream === h.stream, () => { T.map.stream = h.stream; render(); }));
    }
    hotspotTimeline(c, hots.find(h => h.stream === T.map.stream) || hots[0]);
  }
  else if (T.map.sec === '热点变化') table(c, ['论文库方向', '趋势', '变化', '论文数', '说明'], data.trends.map(t => [t.direction, { up: '上升', down: '下降', flat: '持平' }[t.trend], (t.changePct > 0 ? '+' : '') + t.changePct + '%', '近 ' + t.windowDays + ' 天 ' + t.paperCount + ' 篇', t.note]));
  else if (T.map.sec === '评测与基线') table(c, ['名称', '类型', '使用', '说明'], data.benchmarksAndBaselines.map(b => [b.name, b.kind === 'benchmark' ? '评测集' : '基线', '被 ' + b.usedByCount + ' 篇使用', b.note]));
  else if (T.map.sec === '空白与其它发现') table(c, ['问题', '类型', '证据', '说明', '出处'], data.gaps.map(g => [g.title, g.kind === 'gap' ? '空白' : '发现', g.metric, g.note, td => g.sources.forEach((s, i) => { if (i) H(td, 'span', '', '、'); paperRef(td, s); })]));
  else table(c, ['技术路线', '论文数', '说明'], data.categories.map(k => [k.name, k.paperCount + ' 篇', k.note]));
};

// 全领域热点演变：每个热点一行，按起势时间排；小图是它每月占 arXiv 论文流的比例（三个月平均）。
const hotspotTimeline = (c, hot) => {
  if (!hot || !hot.items.length) return empty(c, '还没有全领域论文数据：在后端的 profile.json 里配置 streams，运行 pwb feed 取 arXiv 论文后，再点“重新整理”。');
  const months = hot.months;
  H(c, 'p', 'rpd-muted', '数据：' + hot.source + '，' + months[0] + ' 到 ' + months[months.length - 1] + ' 共 ' + hot.totals.reduce((a, b) => a + b, 0) + ' 篇。按起势时间（三个月平均占比从早期基线涨到峰值的四分之一）排序；词组是从数据里找出来的，大模型只负责归类。右边的小图是 ' + months[0] + ' 到 ' + months[months.length - 1] + ' 每月占比，各自按自己的峰值缩放，鼠标停在上面看每月篇数。');
  const share = h => h.counts.map((n, i) => hot.totals[i] ? n / hot.totals[i] : 0).map((x, i, a) => { const w = a.slice(Math.max(0, i - 2), i + 1); return w.reduce((p, q) => p + q, 0) / w.length; });
  hot.items.forEach(h => {
    const row = H(c, 'div', 'rpd-hot');
    const head = H(row, 'div', 'rpd-hot-h');
    H(head, 'strong', '', h.name);
    H(head, 'span', 'rpd-muted', h.onset + ' 起势 · ' + h.peak + ' 峰值 · 最近占 ' + h.recentSharePct + '%');
    const W = 240, Hh = 36, xs = share(h), max = Math.max(...xs, 0.0001);  // 每条按自己的峰值缩放，看的是什么时候起来
    const pts = xs.map((x, i) => (i * W / Math.max(1, xs.length - 1)).toFixed(1) + ',' + (Hh - x / max * (Hh - 2)).toFixed(1)).join(' ');
    const svg = row.createSvg ? row.createSvg('svg') : row.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh); svg.setAttribute('class', 'rpd-spark'); svg.setAttribute('preserveAspectRatio', 'none');
    const line = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'polyline'));
    line.setAttribute('points', pts); line.setAttribute('fill', 'none'); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1.5'); line.setAttribute('vector-effect', 'non-scaling-stroke');
    const t = svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'title')); t.textContent = months.map((m, i) => m + ' ' + h.counts[i] + ' 篇').join('\n');
    if (h.summary) H(row, 'p', 'rpd-sum', h.summary);
    H(row, 'div', 'rpd-muted', '词组：' + h.terms.join('、'));
    if (h.examples.length) { const ex = H(row, 'div', 'rpd-muted'); H(ex, 'span', '', '最近的代表论文：'); h.examples.forEach((p, i) => { if (i) H(ex, 'span', '', '；'); paperRef(ex, p); }); }
  });
};

R.hot = async c => {
  H(c, 'h2', 'rpd-issue-h', '社区热点');
  H(c, 'p', 'rpd-muted', '各平台上的领域讨论，只收录带原始链接的内容。');
  const bar = H(c, 'div', 'rpd-tools');
  ['全部', 'X / Twitter', '微信公众号', '小红书', '知乎', '其他'].forEach(p => chip(bar, p, T.hot.platform === p, () => { T.hot.platform = p; render(); }));
  const data = shown(c, await get('/hotspots' + (T.hot.platform === '全部' ? '' : '?platform=' + enc(T.hot.platform))), '社区热点');
  if (!data) return;
  if (!data.items.length) empty(c, '暂无该平台的热点。');
  data.items.forEach(item => {
    const card = H(c, 'article', 'rpd-card'); H(card, 'h3', 'rpd-card-title', item.title); H(card, 'p', 'rpd-sum', item.summary);
    const meta = H(card, 'div', 'rpd-meta'); H(meta, 'span', 'rpd-tag accent', item.platform); if (item.author) H(meta, 'span', '', item.author); if (item.publishedAt) H(meta, 'span', '', '发布：' + fmtTime(item.publishedAt)); H(meta, 'span', '', '收集：' + fmtTime(item.collectedAt));
    const m = item.metrics; [['赞', m.likes], ['转发', m.reposts], ['评论', m.comments]].forEach(([k, v]) => { if (v != null) H(meta, 'span', '', k + ' ' + v); });
    if (item.relatedPapers.length) { const line = H(card, 'div', 'rpd-brief-sources'); H(line, 'span', 'rpd-muted', '提到的论文：'); item.relatedPapers.forEach((ref, i) => { if (i) H(line, 'span', 'rpd-muted', ' · '); paperRef(line, ref); }); }
    extLink(card, item.url, '查看原始讨论');
  });
};

R.res = async c => {
  const t = T.res;
  H(c, 'h2', 'rpd-issue-h', '结果表');
  H(c, 'p', 'rpd-muted', '各 benchmark 上所有方法的数字；每个数字带评测规模和出处。底座模型不同的数字不能直接比。');
  const index = shown(c, await get('/results'), '结果表');
  if (!index) return;
  const cats = index.categories.filter(k => k.benchmarks.length);
  if (!cats.length) return empty(c, '还没有任何 benchmark 的结果。');
  if (!t.cat || !cats.some(k => k.name === t.cat)) t.cat = cats[0].name;
  const tools = H(c, 'div', 'rpd-tools'); cats.forEach(k => chip(tools, k.name, t.cat === k.name, () => { t.cat = k.name; render(); }));
  const t2 = H(c, 'div', 'rpd-tools'); ['效果', '成本'].forEach(k => chip(t2, k, t.view === k, () => { t.view = k; render(); }));
  [['full', '只看全量评测'], ['abl', '显示消融']].forEach(([k, l]) => { const lab = H(t2, 'label', 'rpd-check'); const cb = H(lab, 'input'); cb.type = 'checkbox'; cb.checked = t[k]; H(lab, 'span', '', l); cb.addEventListener('change', () => { t[k] = cb.checked; render(); }); });
  const benches = cats.find(k => k.name === t.cat).benchmarks;
  const results = await Promise.all(benches.map(b => get('/results/' + enc(b.key))));
  results.forEach((res, i) => {
    const s = sec(c, benches[i].name);
    const b = shown(s, res, benches[i].name + ' 的结果');
    if (!b) return;
    s.querySelector('.rpd-sec-head').createEl('span', { cls: 'rpd-muted', text: b.stats.methodCount + ' 个方法 · ' + b.stats.paperCount + ' 篇论文 · ' + b.benchmark.split + (b.benchmark.fullSize ? ' 全量 ' + b.benchmark.fullSize : '') });
    const rows = b.entries.filter(e => (!t.full || e.scale.type === 'full') && (t.abl || !e.isAblation));
    const scale = e => e.scale.type === 'full' ? '全量' + (e.scale.n ? ' ' + e.scale.n : '') : e.scale.type === 'subset' ? '子集' + (e.scale.n ? ' ' + e.scale.n : '') : '未注明';
    const code = e => ({ open: '已开源' + (e.code.stars != null ? ' ★' + e.code.stars : ''), anonymous: '匿名仓库', none: '未开源', unknown: '—' }[e.code.status]);
    const source = e => td => { H(td, 'span', '', e.source.type === 'original' ? '原论文 ' : '转引自 '); paperRef(td, e.source.paper); if (e.source.location) H(td, 'span', 'rpd-muted', ' · ' + e.source.location); };
    if (!rows.length) return empty(s, '没有符合条件的结果。');
    if (t.view === '效果') table(s, ['方法', b.benchmark.metric.name + (b.benchmark.metric.higherIsBetter ? ' ↑' : ' ↓'), '评测规模', '底座模型', '代码', '数字出处'], rows.map(e => [e.method + (e.isAblation ? '（消融）' : ''), e.value, scale(e), e.backboneModel || '—', code(e), source(e)]));
    else { const costed = rows.filter(e => e.cost); if (!costed.length) empty(s, '这些结果都没有报告成本。'); else table(s, ['方法', b.benchmark.metric.name, 'Token', '费用（美元）', 'LLM 调用次数', '数字出处'], costed.map(e => [e.method, e.value, num(e.cost.tokens), num(e.cost.usd), num(e.cost.llmCalls), source(e)])); }
  });
};

R.idea = async c => {
  H(c, 'h2', 'rpd-issue-h', 'IDEA 与研究空白');
  H(c, 'p', 'rpd-muted', '从已有工作梳理空白，查看 AI 提出的方向，并保留正在推进的研究线。');
  const [ideas, notesRes] = await Promise.all([get('/ideas'), get('/me/idea-notes')]);
  const data = shown(c, ideas, 'IDEA 梳理');
  if (!data) return;
  const myNotes = notesRes.data?.notes || {};
  const sources = list => td => list.forEach((s, i) => { if (i) H(td, 'span', '', '、'); paperRef(td, s); });
  const methods = sec(c, '现有方法与研究内容', '对照问题、方法、证据和尚未覆盖的部分');
  if (data.methods.length) table(methods, ['研究问题 / 方向', '现有方法', '已有证据', '未覆盖 / 局限', '出处'], data.methods.map(m => [m.topic, m.method, m.evidence || '—', m.gap || '—', sources(m.sources)]));
  else empty(methods, '方法梳理表还没有内容。');
  const ai = sec(c, 'AI 总结的 IDEA 和研究空白');
  if (!data.aiIdeas.length) empty(ai, '暂无 AI 总结的 IDEA。');
  data.aiIdeas.forEach(item => { const card = H(ai, 'article', 'rpd-card'); H(card, 'h3', 'rpd-card-title', item.title); H(card, 'p', 'rpd-sum', item.summary); if (item.evidence) H(card, 'p', 'rpd-muted', item.evidence); const line = H(card, 'div', 'rpd-brief-sources'); H(line, 'span', 'rpd-muted', '依据：'); sources(item.sources)(line); });
  const discussions = sec(c, '讨论中的 IDEA');
  if (!data.discussions.length) empty(discussions, '暂无讨论记录。');
  data.discussions.forEach(item => { const card = H(discussions, 'article', 'rpd-card'); H(card, 'h3', 'rpd-card-title', item.title); H(card, 'p', 'rpd-sum', item.summary); if (item.next) H(card, 'p', 'rpd-muted', '下一步：' + item.next); });
  const lines = sec(c, '研究线', data.researchLines.length + ' 条');
  if (!data.researchLines.length) empty(lines, '暂无研究线。');
  data.researchLines.forEach(line => {
    const card = H(lines, 'article', 'rpd-card'); const head = H(card, 'div', 'rpd-card-head'); H(head, 'h3', 'rpd-card-title', line.title); H(head, 'span', 'rpd-tag ' + (line.status === '推进中' ? 'good' : 'soft'), line.status);
    H(card, 'div', 'rpd-meta').setText([line.tag, line.stepCount + ' 步', '审稿 ' + line.reviewCount + ' 次', '开始于 ' + line.startedAt].filter(Boolean).join(' · '));
    H(card, 'p', 'rpd-sum', '问题：' + line.question); if (line.draft) H(card, 'p', 'rpd-muted', '方案：' + line.draft);
    const rv = line.review; if (rv) H(card, 'p', 'rpd-muted', '审稿均分 ' + rv.mean.toFixed(1) + '（重要性 ' + rv.importance + ' · 新颖性 ' + rv.novelty + ' · 深度 ' + rv.depth + ' · 可行性 ' + rv.feasibility + '）' + (rv.note ? ' ' + rv.note : ''));
    if (line.nextSteps.length) { const ul = H(card, 'ul', 'rpd-ul'); line.nextSteps.forEach(s => H(ul, 'li', '', s)); }
    const area = H(card, 'textarea', 'rpd-textarea'); area.value = myNotes[line.id] || ''; area.placeholder = '我的批注（保存到后端）';
    area.addEventListener('change', () => act(() => http('PUT', '/me/idea-notes/' + enc(line.id), { body: { text: area.value } }), '已保存批注'));
  });
};

R.rep = async c => {
  H(c, 'h2', 'rpd-issue-h', '报告');
  const tools = H(c, 'div', 'rpd-tools');
  taskBtn(tools, '生成本周周报', '', 'generate-report', () => {
    const today = new Date(ymd(new Date()) + 'T00:00:00+08:00'); const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 864e5 + 8 * 36e5);
    const start = ymd(monday), end = ymd(new Date(monday.getTime() + 6 * 864e5));
    startTask('generate-report', { type: 'weekly', period: { start, end } }, '生成 ' + start + ' 当周周报');
  });
  const data = shown(c, await get('/reports'), '报告');
  if (!data) return;
  const top = sec(c, '高分论文');
  if (!data.topPapers.length) empty(top, '暂无高分论文。');
  data.topPapers.forEach(r => { const row = H(top, 'div', 'rpd-row'); paperRef(H(row, 'span', 'rpd-row-t'), r.paper); H(row, 'span', 'rpd-tag accent', '分 ' + r.score.toFixed(2)); if (r.reason) H(row, 'span', 'rpd-muted', r.reason); });
  const list = sec(c, '周报 / 月报');
  if (!data.reports.length) empty(list, '还没有报告。');
  data.reports.forEach(r => {
    const item = H(list, 'details', 'rpd-details'); const sum = H(item, 'summary'); H(sum, 'span', 'rpd-tag soft', r.type === 'weekly' ? '周报' : '月报'); H(sum, 'span', '', ' ' + r.title + ' · ' + r.period.start + ' 至 ' + r.period.end);
    let loaded = false;
    item.addEventListener('toggle', async () => {
      if (!item.open || loaded) return; loaded = true;
      const res = await get('/reports/' + enc(r.id)); const body = H(item, 'div', 'rpd-md');
      if (shown(body, res, '报告正文')) await renderMd(body, res.data.markdown);
    });
  });
};

R.inbox = async c => {
  H(c, 'h2', 'rpd-issue-h', '待认领');
  H(c, 'p', 'rpd-muted', 'GPU 服务器上的守护进程在实验启动时自动登记。把每次运行认领到论文、复现配置组或实验记录。');
  const [inbox, repro] = await Promise.all([get('/inbox'), get('/experiments')]);
  const data = shown(c, inbox, '待认领列表');
  if (!data) return;
  if (!data.runs.length) empty(c, '暂无实验运行。');
  const groups = repro.data?.reproGroups || [];
  data.runs.forEach(r => {
    const k = H(c, 'article', 'rpd-card'); H(k, 'code', 'rpd-code', r.command);
    const m = H(k, 'div', 'rpd-meta'); H(m, 'span', 'rpd-tag ' + (r.status === 'failed' ? 'warn' : r.status === 'running' ? 'soft' : 'good'), { running: '运行中', finished: '结束', failed: '失败' }[r.status]);
    [r.runId, r.project, r.host, fmtTime(r.startedAt), r.durationSec != null ? r.durationSec + ' 秒' : null, r.gpu.length ? 'GPU ' + r.gpu.join(',') : null, r.exitCode != null ? '退出码 ' + r.exitCode : null].filter(Boolean).forEach(t => H(m, 'span', '', t));
    if (r.claimedBy) { H(k, 'p', 'rpd-muted', '已认领到：' + { paper: '论文', reproGroup: '复现配置组', experimentNote: '实验记录' }[r.claimedBy.kind] + ' ' + r.claimedBy.id); return; }
    const bar = H(k, 'div', 'rpd-bar');
    const kind = H(bar, 'select', 'rpd-select'); [['experimentNote', '实验记录'], ['reproGroup', '复现配置组'], ['paper', '论文']].forEach(([v, l]) => { const o = H(kind, 'option', '', l); o.value = v; });
    const target = H(bar, 'span');
    let pick = () => '';
    const drawTarget = () => {
      target.empty();
      if (kind.value === 'paper') { const i = H(target, 'input', 'rpd-input'); i.placeholder = '论文 ID，如 arxiv-2610.17613'; pick = () => i.value.trim(); return; }
      const options = kind.value === 'reproGroup' ? groups.map(g => [g.id, g.name]) : experiments.map(e => [e.path, e.title]);
      const s = H(target, 'select', 'rpd-select'); options.forEach(([v, l]) => { const o = H(s, 'option', '', l); o.value = v; }); if (!options.length) H(target, 'span', 'rpd-muted', kind.value === 'reproGroup' ? '没有复现配置组' : '没有实验记录'); pick = () => s.value;
    };
    kind.addEventListener('change', drawTarget); drawTarget();
    taskBtn(bar, '认领', '', 'claim-run', () => { const id = pick(); if (!id) return toast('请先选择认领对象'); startTask('claim-run', { runId: r.runId, target: { kind: kind.value, id } }, '认领 ' + r.runId); });
  });
  if (data.services.length) { const d = H(c, 'details', 'rpd-details'); H(d, 'summary', '', '另有 ' + data.services.length + ' 个推理 / 后台服务，默认折叠'); table(d, ['服务', '服务器', '端口', '命令'], data.services.map(s => [s.name, s.host, num(s.port), s.command])); }
};

const ORIGIN = { user: ['我填写', 'accent'], extracted: ['整理所得', 'soft'], candidate: ['采纳的候选', 'soft'] };
const LEVEL = ['', '一级', '二级', '三级'];
R.research = async c => {
  const t = T.research;
  H(c, 'h2', 'rpd-issue-h', '我的研究领域');
  H(c, 'p', 'rpd-lead', '关键词树由两部分组成：你自己填写的，和根据论文库里你重点关注的论文、本人论文、标为“相关”的论文整理出来的（vault 里的笔记不参与）。任何一级都可以自己添加、改名、写说明、删除；重新整理只替换“整理所得”，你填写的和你固定的都保留。');
  const [res, ownRes] = await Promise.all([get('/me/interests'), get('/papers?own=true&limit=200')]);
  if (!res.data && res.error?.status !== 404) { shown(c, res, '研究领域'); return; }
  if (res.cachedAt) H(c, 'p', 'rpd-warn rpd-offline', '离线 · 显示上次同步于 ' + fmtTime(res.cachedAt) + ' 的数据');
  const tree = res.data || { domains: [], candidates: [], basis: { ownPapers: 0, watchedPapers: 0, relevantPapers: 0 }, overview: '', stale: true, generatedAt: null };
  const save = async (fn, ok) => { if (await act(fn, ok)) render(); };
  // 行内表单：添加下级或编辑本节点，都是“名称 + 说明”。
  const inlineForm = (parent, init, submit) => {
    const form = H(parent, 'div', 'rpd-kw-form');
    const label = H(form, 'input', 'rpd-input rpd-input-inline'); label.placeholder = '关键词'; label.value = init.label || '';
    const summary = H(form, 'input', 'rpd-input'); summary.placeholder = '说明（可选）：这个关键词具体指什么、不包括什么'; summary.value = init.summary || '';
    const bar = H(form, 'div', 'rpd-tools');
    const go = () => { if (!label.value.trim()) return toast('关键词不能为空'); submit(label.value.trim(), summary.value.trim()); };
    btn(bar, '保存', 'rpd-primary', go); btn(bar, '取消', 'rpd-ghost', () => form.remove());
    label.addEventListener('keydown', e => { if (e.key === 'Enter') go(); if (e.key === 'Escape') form.remove(); });
    label.focus();
  };
  const addChild = (parentId, slot) => inlineForm(slot, {}, (label, summary) => save(() => http('POST', '/me/interests/nodes/' + enc(parentId) + '/children', { body: summary ? { label, summary } : { label } }), '已添加“' + label + '”'));
  const visible = node => t.origin === 'all' || (t.origin === 'user' ? node.origin === 'user' : node.origin !== 'user') || (node.children || []).some(visible);

  const tools = H(c, 'div', 'rpd-tools');
  [['all', '全部'], ['user', '我填写的'], ['extracted', '整理所得']].forEach(([k, l]) => chip(tools, l, t.origin === k, () => { t.origin = k; render(); }));
  btn(tools, '添加一级领域', 'rpd-primary', () => addChild('root', rootSlot));
  taskBtn(tools, '重新整理关键词', '', 'rebuild-interests', () => startTask('rebuild-interests', {}, '重新整理关键词'));
  const rootSlot = H(c, 'div');
  if (tree.generatedAt) {
    const status = H(c, 'p', 'rpd-muted');
    status.setText('上次整理：' + fmtTime(tree.generatedAt) + ' · 依据关注论文 ' + (tree.basis.watchedPapers ?? 0) + ' 篇、本人论文 ' + tree.basis.ownPapers + ' 篇、相关论文 ' + tree.basis.relevantPapers + ' 篇' + (tree.stale ? ' · 这些论文有变化，待重新整理' : ''));
  }
  if (tree.overview) H(c, 'p', 'rpd-lead', tree.overview);

  const evidence = (parent, node) => {
    if (!node.evidence.length) return;
    const details = H(parent, 'details', 'rpd-evidence'); H(details, 'summary', '', '依据 · ' + node.evidence.length + ' 处');
    node.evidence.forEach(item => {
      const row = H(details, 'div', 'rpd-evidence-item');
      H(row, 'strong', '', item.title + '（' + item.ref + '）');
      if (item.quote) H(row, 'blockquote', 'rpd-evidence-quote', item.quote);
    });
  };
  const nodeHead = (parent, node, level, tag) => {
    const head = H(parent, 'div', 'rpd-kw-head');
    H(head, tag, level === 1 ? 'rpd-domain-title' : level === 2 ? 'rpd-direction-title' : 'rpd-kw-title', (node.pinned ? '📌 ' : '') + node.label);
    const [name, cls] = ORIGIN[node.origin]; H(head, 'span', 'rpd-tag ' + cls, name);
    const bar = H(head, 'span', 'rpd-node-tools');
    const slot = H(parent, 'div');
    if (level < 3) btn(bar, '添加' + LEVEL[level + 1], 'rpd-ghost', () => addChild(node.id, slot));
    btn(bar, '编辑', 'rpd-ghost', () => inlineForm(slot, node, (label, summary) => {
      const patch = {}; if (label !== node.label) patch.label = label; if (summary !== node.summary) patch.summary = summary;
      if (!Object.keys(patch).length) return render();
      save(() => http('PATCH', '/me/interests/nodes/' + enc(node.id), { body: patch }), node.origin === 'user' ? '已保存' : '已保存，这个关键词转为你填写的');
    }));
    if (node.origin !== 'user') btn(bar, node.pinned ? '取消固定' : '固定', 'rpd-ghost', () => save(() => http('POST', '/me/interests/nodes/' + enc(node.id) + '/' + (node.pinned ? 'unpin' : 'pin'))));
    btn(bar, '删除', 'rpd-ghost', () => {
      const n = (node.children || []).length;
      if (n && !confirm('删除“' + node.label + '”会连同它下面的 ' + n + ' 个关键词一起删除，确定吗？')) return;
      save(() => http('POST', '/me/interests/nodes/' + enc(node.id) + '/remove'), '已删除“' + node.label + '”');
    });
    return slot;
  };

  const treeSec = sec(c, '关键词层级', '一级：领域 → 二级：研究方向 → 三级：具体问题 / 方法');
  const domains = tree.domains.filter(visible);
  if (!tree.domains.length) empty(treeSec, '还没有关键词。点“添加一级领域”自己填写，或等后端根据你关注的论文整理。');
  else if (!domains.length) empty(treeSec, t.origin === 'user' ? '还没有你填写的关键词。' : '还没有整理所得的关键词。');
  domains.forEach(domain => {
    const card = H(treeSec, 'article', 'rpd-domain');
    nodeHead(card, domain, 1, 'h3');
    if (domain.summary) H(card, 'p', 'rpd-sum', domain.summary); evidence(card, domain);
    const branches = H(card, 'div', 'rpd-domain-branches');
    domain.children.filter(visible).forEach(direction => {
      const branch = H(branches, 'section', 'rpd-domain-branch');
      nodeHead(branch, direction, 2, 'h4');
      if (direction.summary) H(branch, 'p', 'rpd-sum', direction.summary); evidence(branch, direction);
      direction.children.filter(visible).forEach(keyword => {
        const item = H(branch, 'div', 'rpd-keyword');
        nodeHead(item, keyword, 3, 'strong');
        if (keyword.summary) H(item, 'p', 'rpd-sum', keyword.summary); evidence(item, keyword);
      });
    });
  });

  await readingProfile(c);
  const cands = sec(c, '候选关键词', tree.candidates.length + ' 个 · 正在兴起、或你笔记里反复提到，还不在你关键词树里的方向');
  if (!tree.candidates.length) empty(cands, '暂无候选关键词。');
  tree.candidates.forEach(cand => {
    const parent = [...tree.domains, ...tree.domains.flatMap(d => d.children)].find(n => n.id === cand.parentId);
    const card = H(cands, 'article', 'rpd-card'); const head = H(card, 'div', 'rpd-card-head'); H(head, 'h3', 'rpd-card-title', cand.label); H(head, 'span', 'rpd-muted', LEVEL[cand.level] + ' · 归入“' + (parent?.label || '?') + '”');
    H(card, 'p', 'rpd-sum', cand.reason);
    H(card, 'p', 'rpd-muted', cand.source === 'notes' ? '来自 ' + cand.growth.paperCount + ' 篇阅读笔记'
      : '近 ' + cand.growth.windowDays + ' 天 ' + cand.growth.paperCount + ' 篇，变化 ' + (cand.growth.changePct > 0 ? '+' : '') + cand.growth.changePct + '%');
    if (cand.examples.length) { const line = H(card, 'div', 'rpd-brief-sources'); H(line, 'span', 'rpd-muted', cand.source === 'notes' ? '出自笔记：' : '代表论文：'); cand.examples.forEach((ref, i) => { if (i) H(line, 'span', 'rpd-muted', ' · '); paperRef(line, ref); }); }
    const bar = H(card, 'div', 'rpd-bar');
    btn(bar, '采纳', 'rpd-primary', () => save(() => http('POST', '/me/interests/candidates/' + enc(cand.id) + '/accept'), '已加入关键词树'));
    btn(bar, '忽略', 'rpd-ghost', () => save(() => http('POST', '/me/interests/candidates/' + enc(cand.id) + '/reject'), '已忽略，不会再推荐'));
  });

  const own = sec(c, '本人论文', '存在后端论文库里；整理关键词时读它们的 PDF 原文');
  const ownTools = H(own, 'div', 'rpd-tools'); const formSlot = H(own, 'div');
  btn(ownTools, '添加本人论文', 'rpd-primary', () => addPaperForm(formSlot, 'own'));
  const owned = shown(own, ownRes, '本人论文');
  if (owned && !owned.items.length) empty(own, '还没有本人论文。点“添加本人论文”，或在论文库里把论文标为“本人论文”。');
  (owned?.items || []).forEach(p => {
    const item = H(own, 'div', 'rpd-own-paper');
    const row = H(item, 'div', 'rpd-row'); H(row, 'strong', 'rpd-row-t', paperTitle(p)); H(row, 'span', 'rpd-muted', [p.id, p.venue].filter(Boolean).join(' · '));
    H(row, 'span', 'rpd-tag ' + (p.hasPdf ? 'good' : 'warn'), p.hasPdf ? '有 PDF' : '缺 PDF，整理时读不到正文');
    btn(row, p.hasPdf ? '替换 PDF' : '上传 PDF', p.hasPdf ? 'rpd-ghost' : '', async () => { if (await uploadPdf(p.id)) render(); });
    titleTools(H(item, 'div', 'rpd-bar'), p, () => render());
  });
};

// 阅读笔记要点：后端从笔记“和我的研究的关系”“想法与疑问”两节整理出来，每日初筛时参考（约定 5.18）。
async function readingProfile(c) {
  const box = sec(c, '阅读笔记要点', '每天推荐前从你的笔记里整理，初筛时和关键词树一起参考');
  const tools = H(box, 'div', 'rpd-tools');
  btn(tools, '立刻同步笔记', '', async () => { await loadNotes(); const r = await syncNotes(true); if (r) { toast('已同步 ' + r.items.length + ' 篇笔记'); render(); } });
  const res = await get('/me/notes');
  if (!shown(box, res, '阅读笔记')) return;
  const d = res.data;
  H(box, 'p', 'rpd-muted', '已同步 ' + d.items.length + ' 篇笔记' + (d.updatedAt ? '（' + fmtTime(d.updatedAt) + '）' : '') + '，其中 ' + d.items.filter(n => n.seed).length + ' 篇算精读过，当邻近推荐的种子。');
  if (d.skipped.length) { const w = H(box, 'div', 'rpd-warn'); H(w, 'span', '', d.skipped.length + ' 篇笔记没用上：'); d.skipped.forEach(sk => { const row = H(w, 'div', 'rpd-row'); fileLink(row, sk.path, sk.path.split('/').pop().replace(/\.md$/, '')); H(row, 'span', 'rpd-muted', sk.reason); }); }
  if (!d.profile) { empty(box, '还没有整理过：写好笔记里“和我的研究的关系”或“想法与疑问”，下次每日推荐时整理（也可以在流程明细里重跑“整理阅读笔记”）。'); return; }
  H(box, 'p', 'rpd-sum', d.profile.summary);
  [['interest', '你关心的'], ['doubt', '你存疑的']].forEach(([kind, label]) => {
    const pts = d.profile.points.filter(p => p.kind === kind); if (!pts.length) return;
    H(box, 'h4', '', label);
    const ul = H(box, 'ul', 'rpd-list');
    pts.forEach(p => { const li = H(ul, 'li'); H(li, 'span', '', p.text); p.papers.slice(0, 3).forEach(ref => { H(li, 'span', 'rpd-muted', ' · '); paperRef(li, ref); }); });
  });
  H(box, 'p', 'rpd-muted', '整理于 ' + fmtTime(d.profile.generatedAt));
}

// 每日推荐设置：改一项存一项（只提交改了的那部分，后端合并）。研究方向的文字（论文流的检索词等）在后端的 data/profile.json。
async function recommendSettings(c) {
  const box = sec(c, '每日推荐', '流程怎么跑；检索词、方向说明在后端的 data/profile.json 里改');
  const res = await get('/settings/recommend');
  if (!shown(box, res, '每日推荐设置')) return;
  const s = res.data;
  const put = async (patch, ok) => { const r = await act(() => http('PUT', '/settings/recommend', { body: patch }), ok || '已保存'); if (r) Object.assign(s, r); return !!r; };
  const group = title => { const g = H(box, 'div', 'rpd-set-group'); H(g, 'h4', '', title); return g; };
  const check = (g, label, value, patch) => { const lab = H(H(g, 'div', 'rpd-set-row'), 'label', 'rpd-check'); const cb = H(lab, 'input'); cb.type = 'checkbox'; cb.checked = value; H(lab, 'span', '', label);
    cb.addEventListener('change', async () => { if (!(await put(patch(cb.checked)))) cb.checked = !cb.checked; }); };
  const number = (g, label, value, min, max, patch, step) => { const f = H(g, 'label', 'rpd-field rpd-field-inline'); H(f, 'span', '', label); const i = H(f, 'input', 'rpd-input rpd-input-num');
    i.type = 'number'; i.min = min; i.max = max; i.step = step || 1; i.value = value; let saved = value;
    i.addEventListener('change', async () => { const v = Number(i.value); if (!Number.isFinite(v) || v < min || v > max) { toast(label + '要在 ' + min + '–' + max + ' 之间'); i.value = saved; return; }
      if (await put(patch(v))) saved = v; else i.value = saved; }); };
  const multi = (g, label, options, value, patch) => { const row = H(g, 'div', 'rpd-field rpd-field-inline'); H(row, 'span', '', label); const cur = new Set(value);
    options.forEach(([k, name]) => { const lab = H(row, 'label', 'rpd-check'); const cb = H(lab, 'input'); cb.type = 'checkbox'; cb.checked = cur.has(k); H(lab, 'span', '', name);
      cb.addEventListener('change', async () => { cb.checked ? cur.add(k) : cur.delete(k); if (!(await put(patch(options.map(o => o[0]).filter(x => cur.has(x)))))) { cb.checked = !cb.checked; cb.checked ? cur.add(k) : cur.delete(k); } }); }); };
  const text = (g, label, value, patch) => { const f = H(g, 'label', 'rpd-field rpd-field-inline'); H(f, 'span', '', label); const i = H(f, 'input', 'rpd-input'); i.value = value; let saved = value;
    i.addEventListener('change', async () => { const v = i.value.trim(); if (!v) { toast(label + '不能为空'); i.value = saved; return; } if (await put(patch(v))) saved = v; else i.value = saved; }); };
  const CATS = [['core', '核心'], ['adjacent', '邻近'], ['trending', '热点']];

  let g = group('运行');
  check(g, '每天定时运行', s.schedule.enabled, v => ({ schedule: { enabled: v } }));
  const tf = H(g, 'label', 'rpd-field rpd-field-inline'); H(tf, 'span', '', '运行时间（' + (TZ_NAME || '后端所在时区') + '）'); const time = H(tf, 'input', 'rpd-input rpd-input-num'); time.type = 'time'; time.value = s.schedule.time;
  time.addEventListener('change', async () => { if (!(await put({ schedule: { time: time.value } }))) time.value = s.schedule.time; });
  number(g, '错过后最多补几天', s.schedule.maxCatchupDays, 1, 30, v => ({ schedule: { maxCatchupDays: v } }));
  const wf = H(g, 'label', 'rpd-field rpd-field-inline'); H(wf, 'span', '', '每周任务在'); const wd = H(wf, 'select', 'rpd-select');
  ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].forEach((n, i) => { const o = H(wd, 'option', '', n); o.value = String(i + 1); }); wd.value = String(s.schedule.weeklyDay);
  wd.addEventListener('change', () => put({ schedule: { weeklyDay: Number(wd.value) } }));
  H(g, 'p', 'rpd-muted', '后端要一直开着才会定时运行；错过了（比如电脑在睡眠）会在醒来后补跑。开机自启：在后端运行 python -m pwb service install。');

  g = group('来源');
  if (s.profileProblem) H(g, 'p', 'rpd-warn', s.profileProblem);
  s.streams.forEach(st => check(g, 'arXiv · ' + st.name + '（' + st.query + '）', s.sources.streams[st.key] !== false, v => ({ sources: { streams: { [st.key]: v } } })));
  check(g, 'Hugging Face 每日论文（每天的全部论文都参与初筛）', s.sources.huggingface, v => ({ sources: { huggingface: v } }));

  g = group('初筛与分类');
  number(g, '每批给大模型几篇', s.screen.batchSize, 5, 100, v => ({ screen: { batchSize: v } }));
  number(g, '取几篇“不相关”当反例', s.screen.negativeExamples, 0, 200, v => ({ screen: { negativeExamples: v } }));
  multi(g, '邻近的种子论文', [['own', '本人论文'], ['watched', '关注论文'], ['relevant', '标为相关'], ['library', '论文库核心论文']], s.adjacent.seeds, v => ({ adjacent: { seeds: v } }));
  number(g, '邻近回看几天', s.adjacent.lookbackDays, 1, 30, v => ({ adjacent: { lookbackDays: v } }));
  number(g, 'Hugging Face 点赞达到多少算热点', s.trending.minHfUpvotes, 0, 10000, v => ({ trending: { minHfUpvotes: v } }));
  check(g, '命中正在上涨的热点（领域发展史 → 热点演变）也算热点', s.trending.useHotspots, v => ({ trending: { useHotspots: v } }));
  number(g, '命中正在上涨热点的，点赞达到多少算热点', s.trending.hotspotMinHfUpvotes, 0, 10000, v => ({ trending: { hotspotMinHfUpvotes: v } }));
  number(g, '热点每天最多几篇（按点赞取）', s.trending.maxPerDay, 0, 500, v => ({ trending: { maxPerDay: v } }));

  g = group('速读与精选');
  multi(g, '读全文的类别', CATS, s.skim.fullText, v => ({ skim: { fullText: v } }));
  number(g, '每天全文速读最多几篇（其余只看摘要）', s.skim.maxFullTextPerDay, 0, 500, v => ({ skim: { maxFullTextPerDay: v } }));
  number(g, '每天精选几篇', s.pick.max, 0, 30, v => ({ pick: { max: v } }));
  [['relevance', '相关程度'], ['quality', '质量分'], ['hf', '点赞'], ['code', '有代码']].forEach(([k, n]) => number(g, '打分权重 · ' + n, s.pick.weights[k], 0, 1, v => ({ pick: { weights: { [k]: v } } }), 0.05));
  multi(g, '直接进论文库的类别（不勾就要你标“相关”才进）', CATS, s.library.autoAdd, v => ({ library: { autoAdd: v } }));

  g = group('作者机构与关注的人');
  check(g, '每天给新进论文库的论文补作者机构（OpenAlex）', s.authors.daily, v => ({ authors: { daily: v } }));
  check(g, '同时读 PDF 第一页，认出通讯作者、补上 OpenAlex 没有的机构（用大模型）', s.authors.readPdf, v => ({ authors: { readPdf: v } }));
  number(g, '每天最多补几篇（全库一次补完用“团队”页的“整理作者机构”）', s.authors.maxPerDay, 0, 1000, v => ({ authors: { maxPerDay: v } }));
  check(g, '关注的人的新论文进每日推荐（邻近类）', s.authors.followRecommend, v => ({ authors: { followRecommend: v } }));

  g = group('阅读笔记');
  H(g, 'p', 'rpd-muted', '面板把阅读笔记按小节同步给后端；下面三个小节名要和模板（' + (CFG.noteTemplate || DEFAULT_CONFIG.noteTemplate) + '）里的标题一致，改了模板标题就改这里。');
  check(g, '整理笔记里的要点，初筛时参考（回应了你关心的问题，没命中关键词也算核心；用了你存疑的思路，精选分打折）', s.notes.screening, v => ({ notes: { screening: v } }));
  text(g, '“关心什么”读这一节', s.notes.sections.relation, v => ({ notes: { sections: { relation: v } } }));
  text(g, '“想法和存疑”读这一节', s.notes.sections.ideas, v => ({ notes: { sections: { ideas: v } } }));
  check(g, '精读过的论文当邻近推荐的种子（新论文引用了它就推出来）', s.notes.asSeeds, v => ({ notes: { asSeeds: v } }));
  multi(g, '算“精读过”的状态', [['粗读', '粗读'], ['精读', '精读'], ['已读', '已读']], s.notes.seedStatuses, v => ({ notes: { seedStatuses: v } }));
  number(g, '或者评分达到（0 表示不看评分）', s.notes.seedMinRating, 0, 5, v => ({ notes: { seedMinRating: v } }));
  check(g, '把这一节里的论文加进阅读队列（写链接或论文 ID；每篇只加一次）', s.notes.followToQueue, v => ({ notes: { followToQueue: v } }));
  text(g, '“要追的论文”读这一节', s.notes.sections.follow, v => ({ notes: { sections: { follow: v } } }));
  check(g, '从笔记里提候选关键词（在“我的研究领域”里采纳或忽略）', s.notes.candidates, v => ({ notes: { candidates: v } }));

  g = group('每周');
  check(g, '新中稿入库（按领域检索的检索词和会议清单查新中稿，筛选通过的直接入库）', s.weekly.newAccepted, v => ({ weekly: { newAccepted: v } }));
  check(g, '更新领域发展史和热点演变', s.weekly.map, v => ({ weekly: { map: v } }));
  check(g, '更新经典与必读（要重新取参考文献，较慢）', s.weekly.classics, v => ({ weekly: { classics: v } }));
}

R.set = async c => {
  const conn = sec(c, '后端连接', '保存在 ' + CONFIG_FILE);
  if (configError) H(conn, 'p', 'rpd-warn', configError);
  const f1 = H(conn, 'label', 'rpd-field'); H(f1, 'span', '', '后端地址');
  const base = H(f1, 'input', 'rpd-input'); base.value = CFG.apiBase;
  const f2 = H(conn, 'label', 'rpd-field'); H(f2, 'span', '', 'token（本机运行时留空；迁到服务器后必须设置）');
  const token = H(f2, 'input', 'rpd-input'); token.type = 'password'; token.value = CFG.token;
  const tools = H(conn, 'div', 'rpd-tools'); const result = H(conn, 'p', 'rpd-muted');
  btn(tools, '保存', 'rpd-primary', async () => { try { await saveConfig({ ...CFG, apiBase: base.value.trim() || DEFAULT_CONFIG.apiBase, token: token.value.trim() }); toast('已保存后端连接'); render(); } catch (e) { toast('保存失败：' + e.message); } });
  btn(tools, '测试连接', '', async () => { try { const h = await http('GET', '/health'); result.setText('已连接 · 后端版本 ' + h.version + ' · ' + fmtTime(h.time)); } catch (e) { result.setText(errorText(e)); } updateStatus(); });
  if (!requestUrlFn) H(conn, 'p', 'rpd-muted', '当前环境没有 Obsidian 的 requestUrl，改用 fetch 访问后端。');

  const noteSec = sec(c, '阅读笔记', '「建阅读笔记」按这个模板生成笔记，存到 ' + NOTE_DIR);
  const f3 = H(noteSec, 'label', 'rpd-field'); H(f3, 'span', '', '模板路径（vault 里的相对路径）');
  const tpl = H(f3, 'input', 'rpd-input'); tpl.value = CFG.noteTemplate;
  const noteTools = H(noteSec, 'div', 'rpd-tools');
  btn(noteTools, '保存', 'rpd-primary', async () => { try { await saveConfig({ ...CFG, noteTemplate: tpl.value.trim() || DEFAULT_CONFIG.noteTemplate }); toast('已保存模板路径'); render(); } catch (e) { toast('保存失败：' + e.message); } });
  btn(noteTools, '打开模板', '', () => app.vault.getAbstractFileByPath(tpl.value.trim()) ? open(tpl.value.trim()) : toast('找不到 ' + tpl.value.trim()));

  const prefs = sec(c, '推荐偏好');
  const p = await get('/me/preferences');
  if (shown(prefs, p, '推荐偏好')) {
    const lab = H(prefs, 'label', 'rpd-check'); const cb = H(lab, 'input'); cb.type = 'checkbox'; cb.checked = p.data.needCode; H(lab, 'span', '', '只推荐有开源代码的论文');
    cb.addEventListener('change', async () => { const r = await act(() => http('PUT', '/me/preferences', { body: { needCode: cb.checked } }), '已保存推荐偏好'); if (!r) cb.checked = !cb.checked; });
  }
  await recommendSettings(c);
  const engineSec = sec(c, '大模型引擎', '后端整理关键词等工作时调用的模型，可随时切换');
  const llmRes = await get('/settings/llm');
  const save = async (fn, ok) => { if (await act(fn, ok)) render(); };
  if (shown(engineSec, llmRes, '引擎设置')) {
    const cfg = llmRes.data;
    cfg.engines.forEach(e => {
      const row = H(engineSec, 'div', 'rpd-engine' + (cfg.engine === e.key ? ' is-on' : ''));
      const lab = H(row, 'label', 'rpd-check'); const radio = H(lab, 'input'); radio.type = 'radio'; radio.name = 'rpd-engine'; radio.checked = cfg.engine === e.key; radio.disabled = !e.ready; H(lab, 'strong', '', e.name);
      H(row, 'span', 'rpd-tag ' + (e.ready ? 'good' : 'warn'), e.ready ? '可用' : '不可用');
      H(row, 'span', 'rpd-muted', e.detail);
      const model = H(row, 'input', 'rpd-input rpd-input-inline'); model.placeholder = e.defaultModel ? '模型，默认 ' + e.defaultModel : '模型（留空用该工具的默认模型）'; model.value = e.model && e.model !== e.defaultModel ? e.model : '';
      const saveEngine = () => save(() => http('PUT', '/settings/llm', { body: { engine: e.key, model: model.value.trim() || null } }), '已切换到 ' + e.name);
      radio.addEventListener('change', saveEngine);
      model.addEventListener('change', () => { if (cfg.engine === e.key) saveEngine(); });
    });
    H(engineSec, 'p', 'rpd-muted', 'API key 只在后端配置（环境变量或后端 data/secrets.json），不经过面板。');
  }
  const [pipeline, tasks, jobs] = await Promise.all([get('/pipeline'), get('/tasks?limit=15'), get('/jobs')]);
  jobsPanel(c, jobs);
  const manual = sec(c, '说明书：系统每天自己在做什么', '时间按 ' + (TZ_NAME || '本机时区'));
  if (shown(manual, pipeline, '系统日程')) table(manual, ['时间', '发生什么', '在面板哪里看'], pipeline.data.schedule.map(s => [s.when, s.what, s.panel || '—']));
  const recent = sec(c, '最近的后台任务');
  if (shown(recent, tasks, '任务列表')) {
    if (!tasks.data.items.length) empty(recent, '还没有提交过任务。');
    else table(recent, ['提交时间', '任务', '状态', '说明'], tasks.data.items.map(t => [fmtTime(t.createdAt), t.type, { queued: '排队中', running: '运行中', done: '完成', failed: '失败' }[t.status], t.error || t.message || '—']));
  }
};

// ---------- 外壳 ----------
const header = H(root, 'header', 'rpd-header');
const hl = H(header, 'div', 'rpd-heading'); H(hl, 'div', 'rpd-eyebrow', 'LOCAL RESEARCH DESK'); const titleEl = H(hl, 'h1', 'rpd-title');
const hr = H(header, 'div', 'rpd-status'); const pill = H(hr, 'span', 'rpd-pill off', '正在连接后端'); const pillHint = H(hr, 'span', 'rpd-muted', CFG.apiBase);
function updateStatus() {
  pill.setText(online === true ? '后端已连接' : online === false ? '后端未连接' : '正在连接后端');
  pill.toggleClass('on', online === true); pill.toggleClass('off', online !== true); pillHint.setText(CFG.apiBase);
}
const nav = H(root, 'nav', 'rpd-nav');
const NAV = [['home', '首页'], ['experiments', '实验记录'], ['issue', '论文推荐'], ['watched', '关注论文'], ['teams', '团队'], ['lib', '论文库'], ['must', '经典与必读'], ['map', '领域发展史'], ['hot', '热点'], ['res', '结果表'], ['idea', 'IDEA'], ['research', '我的研究领域'], ['rep', '报告'], ['inbox', '待认领'], ['set', '设置']];
const content = H(root, 'main', 'rpd-content');
toastEl = document.body.createDiv({ cls: 'rpd-toast' });
function goTab(next) { tab = next; render(); }
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  titleEl.setText(tab === 'research' ? '我的研究领域' : '实验工作台 · 论文');
  nav.empty(); NAV.forEach(([k, l]) => { const b = H(nav, 'button', 'rpd-navbtn' + (tab === k ? ' is-active' : ''), l); b.type = 'button'; b.addEventListener('click', () => { if (k === 'research' && dv.current().file.path !== RESEARCH_PAGE) { open(RESEARCH_PAGE); return; } goTab(k); }); });
  const next = createDiv({ cls: 'rpd-page' });
  const loading = content.childElementCount ? null : H(content, 'p', 'rpd-muted', '加载中…');
  try { await R[tab](next); } catch (e) { empty(next, '页面出错：' + e.message); console.error(e); }
  if (seq !== renderSeq || disposed) return;
  loading?.remove(); content.empty(); content.appendChild(next); updateStatus();
}
await Promise.all([loadNotes(), loadExperiments()]);
try { const h = await http('GET', '/health'); TASK_TYPES = h.taskTypes || null; TZ_NAME = h.timezone || undefined; } catch (e) {}
render();
resolveNoteIds().then(() => syncNotes());

// 笔记或实验记录变化时，只重画依赖它们的页签（防抖，避免边打字边刷新）。
// 阅读笔记改了，停下来 10 秒后同步给后端。
let localTimer, syncTimer;
const ref = app.metadataCache.on('changed', file => {
  const isNote = file.path.startsWith(NOTE_DIR) || notes.some(n => n.path === file.path);
  if (disposed || !(isNote || file.path.startsWith(EXPERIMENT_DIR))) return;
  clearTimeout(localTimer);
  localTimer = setTimeout(async () => { await Promise.all([loadNotes(), loadExperiments()]); if (!disposed && ['home', 'experiments', 'lib', 'watched', 'research'].includes(tab)) render(); }, 1000);
  if (isNote) { clearTimeout(syncTimer); syncTimer = setTimeout(async () => { if (disposed) return; await loadNotes(); syncNotes(); }, 10000); }
});
const observer = new MutationObserver(() => { if (!root.isConnected) { disposed = true; app.metadataCache.offref(ref); observer.disconnect(); toastEl.remove(); } });
observer.observe(document.body, { childList: true, subtree: true });
