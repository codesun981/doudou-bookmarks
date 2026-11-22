// 豆豆书签（GlassDesk 基座）Worker：整站密码门 + 书签树 API + 布局云存储 + 静态托管。
// 数据复用星境的 D1（starrealm-db）与 KV（NAV_AUTH）：书签、密码零迁移。
// KV 降写改造（2026-11-21，与星境 gate.js 同方案）：门会话改为无状态签名令牌
// （过期时间.HMAC 签名，密钥取站点密码），图标缓存改 Cache API，壁纸改存 R2。
const GATE_COOKIE = 'nav_gate_session';
const GATE_TTL = 60 * 60 * 24 * 30; // 30 天
const STORAGE_KEY = 'glassdesk:storage:v1';

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function b64urlEncode(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
// 站点密码（2026-11-21 迁 Worker Secret）：env.SITE_PASSWORD 优先，KV 仅作迁移期兜底。
async function sitePassword(env) {
  if (env.SITE_PASSWORD) return env.SITE_PASSWORD;
  try { return await env.NAV_AUTH.get('site_password'); } catch { return null; }
}
async function gateSignKey(env) {
  const stored = await sitePassword(env);
  if (!stored) return null;
  return crypto.subtle.importKey('raw', new TextEncoder().encode(stored), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function validateGate(request, env) {
  const token = parseCookies(request.headers.get('Cookie') || '')[GATE_COOKIE];
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const key = await gateSignKey(env);
  if (!key) return false;
  try {
    const sig = b64urlDecode(token.slice(dot + 1));
    return await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(`gate.${exp}`));
  } catch { return false; }
}
function gatePage(error = '') {
  // 锁屏式登录页（2026-11-21 按用户要求换成 Mac 版同款）：壁纸满屏 + 顶部大时钟/日期 +
  // 圆形头像 + 胶囊密码框；提交契约与旧版一致（POST /gate，字段 password）。
  const err = error ? `<p class="hint">${error}</p>` : '';
  const shake = error ? ' shake' : '';
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>我的站点</title><link rel="icon" type="image/png" href="/logo.png">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; }
  body { min-height: 100dvh; overflow: hidden; position: relative;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #0a1128 url('/wallpaper.jpg') center / cover no-repeat fixed; color: #fff;
    -webkit-font-smoothing: antialiased; }
  body::after { content: ''; position: absolute; inset: 0; background: rgb(10 12 24 / 18%); pointer-events: none; }
  .clock { position: absolute; top: max(7vh, 44px); left: 0; right: 0; text-align: center; z-index: 2;
    animation: rise 900ms cubic-bezier(.22,1,.36,1) both; text-shadow: 0 2px 24px rgb(0 0 0 / 35%); }
  .clock .date { font-size: clamp(15px, 2.2vw, 19px); font-weight: 550; color: rgb(255 255 255 / 92%); letter-spacing: .01em; }
  .clock .time { font-size: clamp(64px, 11vw, 104px); font-weight: 700; line-height: 1.04; letter-spacing: -0.015em; }
  .lock { position: absolute; left: 0; right: 0; bottom: max(9vh, 56px); z-index: 2; display: flex; flex-direction: column; align-items: center;
    animation: rise 900ms 120ms cubic-bezier(.22,1,.36,1) both; }
  .avatar { width: 92px; height: 92px; border-radius: 50%; object-fit: cover;
    box-shadow: 0 10px 34px rgb(0 0 0 / 42%), 0 0 0 1px rgb(255 255 255 / 22%); }
  .name { margin-top: 13px; font-size: 21px; font-weight: 600; text-shadow: 0 1px 12px rgb(0 0 0 / 45%); }
  .field { margin-top: 15px; position: relative; display: flex; align-items: center; }
  .pill { display: flex; align-items: center; width: 196px; height: 34px; border-radius: 999px; padding: 0 14px;
    background: rgb(255 255 255 / 26%); -webkit-backdrop-filter: blur(18px) saturate(1.6); backdrop-filter: blur(18px) saturate(1.6);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 14%); transition: box-shadow 160ms ease, background 160ms ease; }
  .pill:focus-within { background: rgb(255 255 255 / 34%); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 30%), 0 0 0 4px rgb(255 255 255 / 14%); }
  .pill input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: #fff;
    font-size: 13.5px; text-align: center; letter-spacing: .02em; }
  .pill input::placeholder { color: rgb(255 255 255 / 78%); }
  .go { position: absolute; left: calc(100% + 8px); top: 50%; width: 34px; height: 34px; flex: none; border: none; border-radius: 50%; cursor: pointer; color: #fff;
    background: rgb(255 255 255 / 30%); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
    display: flex; align-items: center; justify-content: center; opacity: 0; transform: translateY(-50%) scale(.8); pointer-events: none;
    transition: opacity 160ms ease, transform 160ms ease, background 160ms ease; }
  .go.on { opacity: 1; transform: translateY(-50%) scale(1); pointer-events: auto; }
  .go:hover { background: rgb(255 255 255 / 44%); }
  .go svg { width: 15px; height: 15px; }
  .hint { margin-top: 13px; font-size: 12.5px; color: rgb(255 255 255 / 88%); text-shadow: 0 1px 8px rgb(0 0 0 / 50%); min-height: 16px; }
  .shake { animation: shake 480ms ease both; }
  @keyframes shake { 0%,100% { transform: translateX(0); } 18% { transform: translateX(-13px); } 38% { transform: translateX(11px); } 58% { transform: translateX(-8px); } 78% { transform: translateX(6px); } }
  @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-height: 560px) { .clock { top: 26px; } .lock { bottom: 30px; } .avatar { width: 68px; height: 68px; } }
</style></head>
<body>
  <div class="clock"><div class="date" id="date"></div><div class="time" id="time"></div></div>
  <form class="lock${shake}" method="POST" action="/gate">
    <img class="avatar" src="/logo.png" alt="">
    <div class="name">豆豆</div>
    <div class="field">
      <label class="pill"><input type="password" name="password" placeholder="输入密码" autocomplete="current-password" autofocus></label>
      <button class="go" type="submit" aria-label="进入"><svg viewBox="0 0 16 16" fill="none"><path d="M2 8h11M9 3.5 13.5 8 9 12.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
    </div>
    ${err || '<p class="hint"></p>'}
  </form>
<script>
  var timeEl = document.getElementById('time'), dateEl = document.getElementById('date');
  function tick() {
    var d = new Date();
    timeEl.textContent = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    dateEl.textContent = d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
  }
  tick(); setInterval(tick, 10000);
  var input = document.querySelector('input[name="password"]'), go = document.querySelector('.go');
  input.addEventListener('input', function () { go.classList.toggle('on', input.value.length > 0); });
</script>
</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function handleGate(request, env) {
  if (request.method !== 'POST') return gatePage();
  const form = await request.formData();
  const submitted = String(form.get('password') || '');
  const stored = await sitePassword(env);
  if (!stored) return gatePage('站点密码尚未设置');
  const [a, b] = await Promise.all([sha256Hex(submitted), sha256Hex(stored)]);
  if (!safeEqual(a, b)) return gatePage('密码不对，再试一次');
  const key = await gateSignKey(env);
  if (!key) return gatePage('站点密码尚未设置');
  const exp = Math.floor(Date.now() / 1000) + GATE_TTL;
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`gate.${exp}`));
  const token = `${exp}.${b64urlEncode(new Uint8Array(sig))}`;
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `${GATE_COOKIE}=${token}; Path=/; Max-Age=${GATE_TTL}; HttpOnly; SameSite=Lax; Secure`,
    },
  });
}

const ICON_PALETTE = ['#5e5ce6', '#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#64d2ff', '#ac8e68'];
function letterSvg(letter, seedText) {
  let h = 0;
  for (let i = 0; i < seedText.length; i++) h = (h * 31 + seedText.charCodeAt(i)) >>> 0;
  const c = ICON_PALETTE[h % ICON_PALETTE.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0.72"/></linearGradient></defs><rect width="128" height="128" rx="26" fill="url(#g)"/><text x="64" y="66" font-family="-apple-system, 'PingFang SC', sans-serif" font-size="58" font-weight="600" fill="#fff" text-anchor="middle" dominant-baseline="central">${letter}</text></svg>`;
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=604800' } });
}
// 站点图标：D1 显式 logo → 站点 apple-touch-icon → favicon.ico → 首字色块。
// 缓存走 Cache API（边缘缓存，不计 KV 次数；2026-11-21 由 KV 缓存迁出）。
async function serveIcon(request, env, ctx) {
  const target = new URL(request.url).searchParams.get('url') || '';
  let page;
  try { page = new URL(target); } catch { return letterSvg('?', target); }
  const host = page.hostname;
  const row = await env.DB.prepare('SELECT name, logo FROM sites WHERE url = ?').bind(target).first();
  const displayName = row?.name || host;
  if (row?.logo === 'letter') return letterSvg([...displayName][0] || '?', displayName);
  const cache = caches.default;
  const cacheKey = new Request(`https://desk.aioosi.com/icon-cache/${encodeURIComponent(host)}`, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  const sources = [];
  if (row?.logo && /^https?:\/\//.test(row.logo)) sources.push(row.logo);
  sources.push(`${page.origin}/apple-touch-icon.png`, `${page.origin}/favicon.ico`);
  for (const src of sources) {
    try {
      const res = await fetch(src, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15' },
        signal: AbortSignal.timeout(5000),
        redirect: 'follow',
      });
      const ct = res.headers.get('Content-Type') || '';
      if (res.ok && ct.startsWith('image/')) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 0 && buf.byteLength < 2_000_000) {
          const resp = new Response(buf, { headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=604800' } });
          if (ctx) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
          return resp;
        }
      }
    } catch { /* 换下一个来源 */ }
  }
  return letterSvg([...displayName][0] || '?', displayName);
}


// ---- 多链接（2026-11-21）：一条书签 = 一个服务，url 为主链接，links 存副链接组 [{label,url}] ----
function parseLinks(raw) {
  try {
    const a = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw;
    if (!Array.isArray(a)) return [];
    return a
      .filter((x) => x && typeof x.url === 'string' && /^https?:\/\//i.test(x.url))
      .map((x) => ({ label: String(x.label || '').slice(0, 30), url: String(x.url) }))
      .slice(0, 10);
  } catch { return []; }
}
function linksJson(v, fallbackRaw) {
  if (v === undefined) return fallbackRaw || '[]';
  return JSON.stringify(parseLinks(v));
}

// ---- 书签/分类 CRUD（设置页「书签管理」与日后 COCO 代管共用） ----
async function readExtraTags(env) {
  const r = await env.DB.prepare("SELECT value FROM meta WHERE key = 'extra_tags'").first();
  try {
    const v = JSON.parse(r?.value || '[]');
    return Array.isArray(v) ? v.filter((t) => typeof t === 'string' && t) : [];
  } catch { return []; }
}
async function writeExtraTags(env, tags) {
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('extra_tags', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(tags)).run();
}
async function adminData(env) {
  const [sites, cats] = await Promise.all([
    env.DB.prepare('SELECT id, name, url, desc, tag, deploy, links, logo, catelog, sort_order, in_dock, folder_hint FROM sites ORDER BY catelog, sort_order ASC, id ASC').all(),
    env.DB.prepare('SELECT catelog, sort_order, in_single FROM category_orders ORDER BY sort_order ASC').all(),
  ]);
  return {
    sites: (sites.results || []).map((s) => ({ ...s, links: parseLinks(s.links) })),
    categories: (cats.results || []).map((c) => ({ ...c, in_single: c.in_single === 1 ? 1 : 0 })),
    extraTags: await readExtraTags(env),
  };
}
async function readJsonBody(request) {
  try { return await request.json(); } catch { return {}; }
}

// ---- 浏览器同步插件（2026-11-22）：设备令牌鉴权，只开 ingest 端点 ----
// 令牌明文只在用户手里；云端 meta.sync_token_hash 只存 SHA-256 哈希。
async function syncTokenOk(request, env) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return false;
  await ensureTables(env);
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'sync_token_hash'").first();
  if (!row || !row.value) return false;
  return safeEqual(await sha256Hex(m[1].trim()), row.value);
}
let _ingestSchemaReady = false;
async function ensureIngestSchema(env) {
  if (_ingestSchemaReady) return;
  await ensureTables(env);
  try { await env.DB.prepare("ALTER TABLE sites ADD COLUMN folder_hint TEXT DEFAULT ''").run(); } catch { /* 列已存在 */ }
  _ingestSchemaReady = true;
}
const INBOX_CATEGORY = '导入箱';
function normalizeUrlForDedupe(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
    let s = u.toString();
    if (u.pathname === '/' && !u.search) s = s.replace(/\/$/, '');
    return s;
  } catch { return null; }
}
async function ingestItems(env, items) {
  await ensureIngestSchema(env);
  const rows = await env.DB.prepare('SELECT id, url, links, catelog FROM sites').all();
  const byNorm = new Map();
  for (const r of rows.results || []) {
    const n = normalizeUrlForDedupe(r.url);
    if (n && !byNorm.has(n)) byNorm.set(n, r);
    for (const l of parseLinks(r.links)) {
      const nl = normalizeUrlForDedupe(l.url);
      if (nl && !byNorm.has(nl)) byNorm.set(nl, r);
    }
  }
  const cat = await env.DB.prepare('SELECT catelog FROM category_orders WHERE catelog = ?').bind(INBOX_CATEGORY).first();
  if (!cat) {
    const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM category_orders').first();
    await env.DB.prepare('INSERT INTO category_orders (catelog, sort_order, in_single) VALUES (?, ?, 0)').bind(INBOX_CATEGORY, (max?.m || 0) + 10).run();
  }
  let sort = (await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM sites WHERE catelog = ?').bind(INBOX_CATEGORY).first())?.m || 0;
  let added = 0, skipped = 0, updated = 0;
  const seen = new Set();
  for (const it of items.slice(0, 500)) {
    const rawUrl = String(it?.url || '').trim().slice(0, 1000);
    const norm = normalizeUrlForDedupe(rawUrl);
    if (!norm || seen.has(norm)) { skipped++; continue; }
    seen.add(norm);
    const folder = String(it.folder || '').slice(0, 200);
    const title = String(it.title || '').trim().slice(0, 120);
    const existing = byNorm.get(norm);
    if (existing) {
      // 还在导入箱：补上/更新原文件夹线索；已归类的与副链接命中的一律不动
      if (existing.catelog === INBOX_CATEGORY && folder) {
        await env.DB.prepare('UPDATE sites SET folder_hint = ? WHERE id = ?').bind(folder, existing.id).run();
        updated++;
      } else skipped++;
      continue;
    }
    sort += 10;
    let host = norm;
    try { host = new URL(norm).hostname; } catch { /* 用全串兜底 */ }
    await env.DB.prepare('INSERT INTO sites (name, url, desc, tag, deploy, links, logo, catelog, sort_order, folder_hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(title || host, rawUrl, '', '', '', '[]', null, INBOX_CATEGORY, sort, folder).run();
    added++;
  }
  if (added || updated) await bumpDataVersion(env);
  return { added, skipped, updated };
}
async function handleIngest(request, env, path) {
  if (!(await syncTokenOk(request, env))) return json({ error: 'unauthorized' }, 401);
  if (path === '/api/ingest/ping' && request.method === 'GET') return json({ ok: true });
  if (path === '/api/ingest' && request.method === 'POST') {
    const b = await readJsonBody(request);
    return json({ ok: true, ...(await ingestItems(env, [b])) });
  }
  if (path === '/api/ingest/batch' && request.method === 'POST') {
    const b = await readJsonBody(request);
    return json({ ok: true, ...(await ingestItems(env, Array.isArray(b.items) ? b.items : [])) });
  }
  return json({ error: 'not found' }, 404);
}
async function handleApi(request, env, path) {
  if (path === '/api/admin/data' && request.method === 'GET') return json(await adminData(env));
  if (path === '/api/tags' && request.method === 'POST') {
    const b = await readJsonBody(request);
    const name = String(b.name || '').trim().replace(/[、,，;；]/g, '');
    if (!name || name.length > 20) return json({ error: '标签名不合法' }, 400);
    const cur = await readExtraTags(env);
    if (!cur.includes(name)) {
      cur.push(name);
      await writeExtraTags(env, cur);
      await bumpDataVersion(env);
    }
    return json({ ok: true, extraTags: cur });
  }
  if (path.startsWith('/api/tags/') && request.method === 'DELETE') {
    const name = decodeURIComponent(path.slice('/api/tags/'.length));
    const cur = await readExtraTags(env);
    const next = cur.filter((t) => t !== name);
    if (next.length !== cur.length) {
      await writeExtraTags(env, next);
      await bumpDataVersion(env);
    }
    return json({ ok: true, extraTags: next });
  }
  if (path === '/api/bookmarks' && request.method === 'POST') {
    const b = await readJsonBody(request);
    const name = String(b.name || '').trim();
    const url = String(b.url || '').trim();
    const catelog = String(b.catelog || '').trim();
    if (!name || !url || !catelog) return json({ error: 'name/url/catelog 必填' }, 400);
    const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM sites WHERE catelog = ?').bind(catelog).first();
    const r = await env.DB.prepare('INSERT INTO sites (name, url, desc, tag, deploy, links, logo, catelog, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(name, url, String(b.desc || ''), String(b.tag || ''), String(b.deploy || ''), linksJson(b.links), b.logo ? String(b.logo) : null, catelog, (max?.m || 0) + 10).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const bm = path.match(/^\/api\/bookmarks\/(\d+)$/);
  if (bm && request.method === 'PUT') {
    const b = await readJsonBody(request);
    const cur = await env.DB.prepare('SELECT * FROM sites WHERE id = ?').bind(bm[1]).first();
    if (!cur) return json({ error: 'not found' }, 404);
    await env.DB.prepare('UPDATE sites SET name = ?, url = ?, desc = ?, tag = ?, deploy = ?, links = ?, catelog = ?, sort_order = ? WHERE id = ?')
      .bind(String(b.name ?? cur.name), String(b.url ?? cur.url), String(b.desc ?? cur.desc ?? ''), String(b.tag ?? cur.tag ?? ''), String(b.deploy ?? cur.deploy ?? ''), linksJson(b.links, cur.links), String(b.catelog ?? cur.catelog), Number(b.sort_order ?? cur.sort_order), bm[1]).run();
    return json({ ok: true });
  }
  if (bm && request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(bm[1]).run();
    return json({ ok: true });
  }
  if (path === '/api/categories' && request.method === 'POST') {
    const b = await readJsonBody(request);
    const name = String(b.name || '').trim();
    if (!name) return json({ error: 'name 必填' }, 400);
    const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM category_orders').first();
    await env.DB.prepare('INSERT OR IGNORE INTO category_orders (catelog, sort_order) VALUES (?, ?)').bind(name, (max?.m || 0) + 10).run();
    return json({ ok: true });
  }
  const cm = path.match(/^\/api\/categories\/(.+)$/);
  if (cm && request.method === 'PUT') {
    const b = await readJsonBody(request);
    const name = decodeURIComponent(cm[1]);
    if (b.sort_order != null) {
      await env.DB.prepare('INSERT INTO category_orders (catelog, sort_order) VALUES (?, ?) ON CONFLICT(catelog) DO UPDATE SET sort_order = excluded.sort_order')
        .bind(name, Number(b.sort_order)).run();
    }
    if (b.in_single != null) {
      const cur = await env.DB.prepare('SELECT sort_order FROM category_orders WHERE catelog = ?').bind(name).first();
      if (cur) {
        await env.DB.prepare('UPDATE category_orders SET in_single = ? WHERE catelog = ?').bind(b.in_single ? 1 : 0, name).run();
      } else {
        const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM category_orders').first();
        await env.DB.prepare('INSERT INTO category_orders (catelog, sort_order, in_single) VALUES (?, ?, ?)')
          .bind(name, (max?.m || 0) + 10, b.in_single ? 1 : 0).run();
      }
    }
    return json({ ok: true });
  }
  if (cm && request.method === 'DELETE') {
    const name = decodeURIComponent(cm[1]);
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM sites WHERE catelog = ?').bind(name).first();
    if ((used?.n || 0) > 0) return json({ error: '分类下还有书签，先移走或删掉它们' }, 409);
    await env.DB.prepare('DELETE FROM category_orders WHERE catelog = ?').bind(name).run();
    return json({ ok: true });
  }
  // ---- 站点体检（2026-11-22）：CF 侧探活，结果存 health_checks；内网/自家站有护栏 ----
  if (path === '/api/healthcheck' && request.method === 'GET') {
    await ensureTables(env);
    const rows = (await env.DB.prepare('SELECT site_id, status, detail, checked_at, fail_streak FROM health_checks').all()).results || [];
    const prot = (await env.DB.prepare('SELECT s.id FROM sites s JOIN category_orders c ON c.catelog = s.catelog WHERE c.in_single = 1').all()).results || [];
    return json({ ok: true, results: rows, protectedIds: prot.map((r) => r.id) });
  }
  if (path === '/api/healthcheck' && request.method === 'POST') {
    await ensureTables(env);
    const b = await readJsonBody(request);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isFinite).slice(0, 20);
    if (ids.length === 0) return json({ error: 'ids 必填' }, 400);
    const singleCats = await hcSingleCats(env);
    const out = [];
    await Promise.all(ids.map(async (id) => {
      const site = await env.DB.prepare('SELECT id, url, catelog FROM sites WHERE id = ?').bind(id).first();
      if (!site) { out.push({ id, status: 'skipped', detail: '书签不存在' }); return; }
      out.push(await checkSiteHealth(env, site, singleCats));
    }));
    return json({ ok: true, results: out });
  }
  if (path === '/api/healthcheck/verify' && request.method === 'POST') {
    // 点击自愈：用户浏览器亲自探活成功后回报，清掉受限/失效标记（fail_streak 归零）。
    await ensureTables(env);
    const b = await readJsonBody(request);
    const id = Number(b.id);
    if (!Number.isFinite(id)) return json({ error: 'id 必填' }, 400);
    const site = await env.DB.prepare('SELECT id FROM sites WHERE id = ?').bind(id).first();
    if (!site) return json({ error: 'not found' }, 404);
    const now = Date.now();
    await env.DB.prepare("INSERT INTO health_checks (site_id, status, detail, checked_at, fail_streak) VALUES (?, 'alive', '用户浏览器验证可达', ?, 0) ON CONFLICT(site_id) DO UPDATE SET status = excluded.status, detail = excluded.detail, checked_at = excluded.checked_at, fail_streak = 0")
      .bind(id, now).run();
    return json({ ok: true });
  }
  if (path === '/api/healthcheck/run-daily' && request.method === 'POST') {
    // 与 cron 定时任务共用同一份轮测逻辑（每天测最久未测的约 20 个，约半月轮完一圈）。
    const checked = await runDailyHealthSlice(env);
    return json({ ok: true, checked });
  }
  if (path === '/api/bookmarks/batch-delete' && request.method === 'POST') {
    // 服务端护栏（与 UI 双保险）：只删「体检连续两次判死」的条目；自家站（一页分类）永不删。
    await ensureTables(env);
    const b = await readJsonBody(request);
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isFinite).slice(0, 500);
    const singleRows = (await env.DB.prepare('SELECT catelog FROM category_orders WHERE in_single = 1').all()).results || [];
    const singleCats = new Set(singleRows.map((r) => r.catelog));
    let deleted = 0;
    const refused = [];
    for (const id of ids) {
      const site = await env.DB.prepare('SELECT id, catelog FROM sites WHERE id = ?').bind(id).first();
      if (!site) { refused.push({ id, reason: '不存在' }); continue; }
      if (singleCats.has(site.catelog)) { refused.push({ id, reason: '自家站不可删' }); continue; }
      const hc = await env.DB.prepare('SELECT status, fail_streak FROM health_checks WHERE site_id = ?').bind(id).first();
      if (!hc || hc.status !== 'dead' || (hc.fail_streak || 0) < 2) {
        refused.push({ id, reason: '未连续两次体检失败' });
        continue;
      }
      const r = await env.DB.prepare('DELETE FROM sites WHERE id = ?').bind(id).run();
      if (r.meta.changes) {
        deleted++;
        await env.DB.prepare('DELETE FROM health_checks WHERE site_id = ?').bind(id).run();
      }
    }
    return json({ ok: true, deleted, refused });
  }
  // ---- 订阅到期（方案 A，2026-11-22）：与旧 sub 站共享同一 KV，只读写 'subscriptions' 键 ----
  if (path === '/api/subs' && request.method === 'GET') {
    return json({ ok: true, subscriptions: await readSubs(env) });
  }
  if (path === '/api/subs' && request.method === 'POST') {
    const b = await readJsonBody(request);
    const sub = sanitizeSub(b, null);
    if (!sub) return json({ error: '名称和到期日必填' }, 400);
    const list = await readSubs(env);
    const now = new Date().toISOString();
    const created = { ...sub, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    list.push(created);
    await writeSubs(env, list);
    return json({ ok: true, subscription: created });
  }
  const subm = path.match(/^\/api\/subs\/(.+)$/);
  if (subm && request.method === 'PUT') {
    const id = decodeURIComponent(subm[1]);
    const list = await readSubs(env);
    const idx = list.findIndex((s) => String(s.id) === id);
    if (idx < 0) return json({ error: 'not found' }, 404);
    const b = await readJsonBody(request);
    const merged = sanitizeSub(b, list[idx]);
    if (!merged) return json({ error: '名称和到期日必填' }, 400);
    list[idx] = { ...list[idx], ...merged, updatedAt: new Date().toISOString() };
    await writeSubs(env, list);
    return json({ ok: true, subscription: list[idx] });
  }
  if (subm && request.method === 'DELETE') {
    const id = decodeURIComponent(subm[1]);
    const list = await readSubs(env);
    const next = list.filter((s) => String(s.id) !== id);
    if (next.length !== list.length) await writeSubs(env, next);
    return json({ ok: true });
  }
  return null;
}

// ---- 站点体检探针 ----
// 体检在 CF 网络侧进行：内网/tailnet/本地地址根本够不着，查了必误判，直接跳过。
function hcSkipReason(site) {
  if (site.catelog === '内网服务') return '内网分类，跳过';
  let u;
  try { u = new URL(site.url); } catch { return '网址无效，跳过'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '非 http(s)，跳过';
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local')) return '本地地址，跳过';
  if (/^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(h)) return '内网地址，跳过';
  return null;
}
const HC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';
async function hcFetchOnce(url, method) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': HC_UA, Accept: 'text/html,application/xhtml+xml,*/*' },
    });
    try { await res.body?.cancel(); } catch { /* 只看状态行 */ }
    return res.status;
  } finally {
    clearTimeout(timer);
  }
}
// 分类口径：2xx/3xx 存活；401/403/429 受限（有响应=活着）；其余与网络错误 = 疑似失效。
async function hcProbe(url) {
  let code = null;
  let err = '';
  try {
    code = await hcFetchOnce(url, 'HEAD');
    if (code === 405 || code === 501) code = await hcFetchOnce(url, 'GET');
  } catch (e1) {
    err = e1 && e1.name === 'AbortError' ? '超时' : '连不上';
    try { code = await hcFetchOnce(url, 'GET'); err = ''; } catch { /* 保持 err */ }
  }
  if (code == null) return { status: 'dead', detail: err || '连不上' };
  if (code >= 200 && code < 400) return { status: 'alive', detail: `HTTP ${code}` };
  if (code === 401 || code === 403 || code === 429) return { status: 'restricted', detail: `HTTP ${code}（站点活着，只是拦了机房访问）` };
  return { status: 'dead', detail: `HTTP ${code}` };
}

// ---- 体检共用逻辑（手动分批 / 每日轮测 / cron 三处共用） ----
async function hcSingleCats(env) {
  const rows = (await env.DB.prepare('SELECT catelog FROM category_orders WHERE in_single = 1').all()).results || [];
  return new Set(rows.map((r) => r.catelog));
}
async function checkSiteHealth(env, site, singleCats) {
  const prot = singleCats.has(site.catelog);
  const skip = hcSkipReason(site);
  if (skip) return { id: site.id, status: 'skipped', detail: skip, protected: prot };
  const r = await hcProbe(site.url);
  const prev = await env.DB.prepare('SELECT fail_streak FROM health_checks WHERE site_id = ?').bind(site.id).first();
  const streak = r.status === 'dead' ? (prev?.fail_streak || 0) + 1 : 0;
  const now = Date.now();
  await env.DB.prepare('INSERT INTO health_checks (site_id, status, detail, checked_at, fail_streak) VALUES (?, ?, ?, ?, ?) ON CONFLICT(site_id) DO UPDATE SET status = excluded.status, detail = excluded.detail, checked_at = excluded.checked_at, fail_streak = excluded.fail_streak')
    .bind(site.id, r.status, r.detail, now, streak).run();
  return { id: site.id, status: r.status, detail: r.detail, checked_at: now, fail_streak: streak, protected: prot };
}
// 每日轮测：从未测过的优先、其次最久未测，一次 20 个（CF 免费版单次运行子请求上限 50，必须切片）。
// 281 个站点约 14 天轮完一圈 ≈ 每站半月一测；fail_streak 跨轮累计，「连续两次失败才可删」自然成立。
async function runDailyHealthSlice(env) {
  await ensureTables(env);
  const singleCats = await hcSingleCats(env);
  const rows = (await env.DB.prepare(
    'SELECT s.id, s.url, s.catelog FROM sites s LEFT JOIN health_checks h ON h.site_id = s.id ORDER BY (h.checked_at IS NULL) DESC, h.checked_at ASC LIMIT 20'
  ).all()).results || [];
  await Promise.all(rows.map((site) => checkSiteHealth(env, site, singleCats)));
  return rows.length;
}

// ---- 订阅数据（旧 sub 站 KV 的 'subscriptions' 键；'config' 含密码/token，绝不读取） ----
async function readSubs(env) {
  if (!env.SUBS) return [];
  try {
    const raw = await env.SUBS.get('subscriptions');
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
async function writeSubs(env, list) {
  await env.SUBS.put('subscriptions', JSON.stringify(list));
}
const SUB_UNITS = new Set(['day', 'month', 'year']);
function sanitizeSub(b, cur) {
  const name = String(b.name ?? cur?.name ?? '').trim().slice(0, 80);
  const expiryRaw = String(b.expiryDate ?? cur?.expiryDate ?? '').trim();
  if (!name || !/^\d{4}-\d{2}-\d{2}/.test(expiryRaw)) return null;
  const startRaw = String(b.startDate ?? cur?.startDate ?? '').trim();
  const unitRaw = b.periodUnit ?? cur?.periodUnit;
  const pv = Math.round(Number(b.periodValue ?? cur?.periodValue ?? 1));
  const rd = Math.round(Number(b.reminderDays ?? cur?.reminderDays ?? 30));
  return {
    name,
    customType: String(b.customType ?? cur?.customType ?? '').trim().slice(0, 20),
    startDate: /^\d{4}-\d{2}-\d{2}/.test(startRaw) ? startRaw.slice(0, 10) : '',
    expiryDate: expiryRaw.slice(0, 10),
    periodValue: Number.isFinite(pv) ? Math.min(999, Math.max(1, pv)) : 1,
    periodUnit: SUB_UNITS.has(unitRaw) ? unitRaw : 'year',
    autoRenew: b.autoRenew == null ? Boolean(cur?.autoRenew) : Boolean(b.autoRenew),
    reminderDays: Number.isFinite(rd) ? Math.min(365, Math.max(0, rd)) : 30,
    notes: String(b.notes ?? cur?.notes ?? '').slice(0, 500),
    isActive: b.isActive == null ? (cur?.isActive !== false) : Boolean(b.isActive),
  };
}

// ---- UI 状态存储（2026-11-21 由 KV 迁 D1）+ 全局数据版本号 ----
let _tablesReady = false;
async function ensureTables(env) {
  if (_tablesReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ui_state (id INTEGER PRIMARY KEY, blob TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS health_checks (site_id INTEGER PRIMARY KEY, status TEXT NOT NULL, detail TEXT, checked_at INTEGER NOT NULL, fail_streak INTEGER NOT NULL DEFAULT 0)').run();
  _tablesReady = true;
}
async function getMetaInt(env, key) {
  const r = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first();
  return r ? Number(r.value) || 0 : 0;
}
async function bumpDataVersion(env) {
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('data_version', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT)").run();
}
async function getStorageRow(env) {
  await ensureTables(env);
  const row = await env.DB.prepare('SELECT blob, version FROM ui_state WHERE id = 1').first();
  if (row) return row;
  // 首次读：把 KV 里的旧 blob 原样迁入 D1（version=1），KV 键保留作回滚兜底。
  let blob = '{}';
  try { blob = (await env.NAV_AUTH.get(STORAGE_KEY)) || '{}'; } catch { /* KV 读失败就空对象起步 */ }
  await env.DB.prepare('INSERT OR IGNORE INTO ui_state (id, blob, version, updated_at) VALUES (1, ?, 1, ?)').bind(blob, Date.now()).run();
  return { blob, version: 1 };
}

// ---- 图床（cfimg / CloudFlare-ImgBed）图库代理 ----
// 只读适配：用图床自带的 API Token（list 权限）调它的 /api/manage/list，
// token 存 Worker Secret（IMGBED_TOKEN），不进浏览器、不改图床任何东西。
const IMGBED_ORIGIN = 'https://cfimg.pages.dev';
const IMGBED_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp']);
async function serveImgbedList(request, env, ctx) {
  if (!env.IMGBED_TOKEN) return json({ configured: false, files: [], total: 0 });
  const u = new URL(request.url);
  const start = Math.max(0, Number(u.searchParams.get('start')) || 0);
  const count = Math.min(100, Math.max(1, Number(u.searchParams.get('count')) || 60));
  const cache = caches.default;
  const cacheKey = new Request(`https://desk.aioosi.com/imgbed-cache/${start}/${count}`, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  let upstream;
  try {
    upstream = await fetch(`${IMGBED_ORIGIN}/api/manage/list?start=${start}&count=${count}&recursive=true`, {
      headers: { Authorization: `Bearer ${env.IMGBED_TOKEN}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch { return json({ configured: true, error: 'imgbed_unreachable', files: [], total: 0 }, 502); }
  if (upstream.status === 401 || upstream.status === 403) {
    return json({ configured: true, error: 'imgbed_token_invalid', files: [], total: 0 }, 502);
  }
  if (!upstream.ok) return json({ configured: true, error: 'imgbed_error', files: [], total: 0 }, 502);
  const body = await upstream.json().catch(() => null);
  const rawFiles = Array.isArray(body?.files) ? body.files : [];
  const files = [];
  for (const f of rawFiles) {
    const name = String(f?.name || '');
    if (!name) continue;
    const ext = (name.split('.').pop() || '').toLowerCase();
    const mime = String(f?.metadata?.MimeType || f?.metadata?.FileType || '');
    if (!IMGBED_IMAGE_EXTS.has(ext) && !mime.startsWith('image/')) continue;
    const url = `${IMGBED_ORIGIN}/file/${name.split('/').map(encodeURIComponent).join('/')}`;
    files.push({ name, url, ts: Number(f?.metadata?.TimeStamp) || 0 });
  }
  files.sort((a, b) => b.ts - a.ts);
  const payload = JSON.stringify({ configured: true, files: files.map(({ name, url }) => ({ name, url })), total: Number(body?.totalCount) || files.length, returned: rawFiles.length });
  const resp = new Response(payload, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
  if (ctx) ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  return resp;
}

async function serveImgbedUpload(request, env, ctx) {
  if (!env.IMGBED_TOKEN) return json({ configured: false });
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) return json({ error: 'expected_multipart' }, 400);
  let form;
  try { form = await request.formData(); } catch { return json({ error: 'bad_form' }, 400); }
  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'no_file' }, 400);
  const out = new FormData();
  out.append('file', file, file.name || 'upload');
  let upstream;
  try {
    upstream = await fetch(`${IMGBED_ORIGIN}/upload?responseFormat=object`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.IMGBED_TOKEN}` },
      body: out,
      signal: AbortSignal.timeout(60000),
    });
  } catch { return json({ configured: true, error: 'imgbed_unreachable' }, 502); }
  if (upstream.status === 401 || upstream.status === 403) {
    return json({ configured: true, error: 'imgbed_token_invalid' }, 502);
  }
  const body = await upstream.json().catch(() => null);
  if (!upstream.ok || !body) return json({ configured: true, error: 'imgbed_error', status: upstream.status }, 502);
  const item = Array.isArray(body) ? body[0] : body;
  const src = item?.src || item?.url || item?.fileUrl || '';
  if (!src) return json({ configured: true, error: 'imgbed_bad_response' }, 502);
  const url = src.startsWith('http') ? src : `${IMGBED_ORIGIN}${src.startsWith('/') ? '' : '/'}${src}`;
  // 上传成功后清掉图库列表首页缓存，新图立刻可见
  if (ctx) {
    const cacheKey = new Request('https://desk.aioosi.com/imgbed-cache/0/60', { method: 'GET' });
    ctx.waitUntil(caches.default.delete(cacheKey));
  }
  return json({ configured: true, url, name: item?.fileName || item?.name || file.name || '' });
}

async function serveWallpaper(env) {
  // 自定义壁纸存 R2（2026-11-21 由 KV 迁出），没有时回退自带蓝图。
  try {
    const obj = await env.WALLPAPER.get('wallpaper_custom');
    if (obj) {
      return new Response(obj.body, {
        headers: {
          'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg',
          // 2026-11-21：自定义壁纸长缓存（7 天）+ ETag，过期后走协商缓存校验，不再每小时重拉整图
          'Cache-Control': 'public, max-age=604800',
          ...(obj.httpEtag ? { ETag: obj.httpEtag } : {}),
        },
      });
    }
  } catch { /* 读 R2 失败时回退默认壁纸 */ }
  return new Response(null, { status: 302, headers: { Location: '/wallpapers/deep-blue.jpg' } });
}
// D1 书签 → GlassDesk 的 BookmarkNode 树：根 → 分类文件夹 → 书签叶子
async function buildTree(env) {
  const orderRows = await env.DB.prepare('SELECT catelog, sort_order, in_single FROM category_orders ORDER BY sort_order ASC').all();
  const siteRows = await env.DB.prepare('SELECT id, name, url, desc, tag, deploy, links, logo, catelog, sort_order FROM sites ORDER BY sort_order ASC, id ASC').all();
  const folders = new Map();
  const ensure = (name) => {
    if (!folders.has(name)) folders.set(name, { id: `cat:${name}`, title: name, inSingle: false, children: [] });
    return folders.get(name);
  };
  for (const r of orderRows.results || []) ensure(r.catelog).inSingle = r.in_single === 1;
  for (const s of siteRows.results || []) {
    ensure(s.catelog).children.push({ id: String(s.id), title: s.name, url: s.url, desc: s.desc || '', tag: s.tag || '', deploy: s.deploy || '', links: parseLinks(s.links) });
  }
  return [{ id: 'root', title: '我的站点', children: [...folders.values()] }];
}
async function serveIndex(request, env) {
  const res = await env.ASSETS.fetch(new Request(new URL('/newtab.html', request.url), { method: 'GET' }));
  const html = (await res.text()).replace('</head>', '<script>window.__DOUDOU_SERVER__=true;</script></head>');
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/gate') return handleGate(request, env);
    if (path === '/logout') {
      // 锁定：清掉门会话 cookie 后回门页（此前站内无任何锁定入口，2026-11-21 补）
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/gate',
          'Set-Cookie': `${GATE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    if (path.startsWith('/api/ingest')) return handleIngest(request, env, path);
    if (path === '/wallpaper.jpg') return serveWallpaper(env);
    if (!(await validateGate(request, env))) {
      if (path.startsWith('/api/')) return json({ error: 'unauthorized' }, 401);
      if (request.method === 'GET') return new Response(null, { status: 302, headers: { Location: '/gate' } });
      return new Response('需要密码', { status: 401 });
    }
    if (path === '/api/icon') return serveIcon(request, env, ctx);
    if (path === '/api/imgbed/list' && request.method === 'GET') return serveImgbedList(request, env, ctx);
    if (path === '/api/imgbed/upload' && request.method === 'POST') return serveImgbedUpload(request, env, ctx);
    const apiRes = await handleApi(request, env, path);
    if (apiRes) {
      if (request.method !== 'GET' && apiRes.status < 300) {
        try { await ensureTables(env); await bumpDataVersion(env); } catch { /* 版本号失败不阻塞业务 */ }
      }
      return apiRes;
    }
    if (path === '/api/tree') {
      await ensureTables(env);
      return json({ tree: await buildTree(env), version: await getMetaInt(env, 'data_version') });
    }
    if (path === '/api/version') {
      const row = await getStorageRow(env);
      return json({ storage: row.version, data: await getMetaInt(env, 'data_version') });
    }
    if (path === '/api/storage') {
      if (request.method === 'PUT') {
        const body = await readJsonBody(request);
        const data = body && typeof body === 'object' ? body.data : null;
        if (!data || typeof data !== 'object') return json({ error: 'data 必填' }, 400);
        const text = JSON.stringify(data);
        if (text.length > 900000) return json({ error: 'too large' }, 413);
        const row = await getStorageRow(env);
        const base = Number(body.baseVersion);
        if (Number.isFinite(base) && base > 0 && base !== row.version) {
          return json({ error: 'version_conflict', version: row.version }, 409);
        }
        const next = row.version + 1;
        await env.DB.prepare('UPDATE ui_state SET blob = ?, version = ?, updated_at = ? WHERE id = 1').bind(text, next, Date.now()).run();
        return json({ ok: true, version: next });
      }
      const row = await getStorageRow(env);
      let data = {};
      try { data = JSON.parse(row.blob); } catch { data = {}; }
      return json({ version: row.version, data });
    }
    if (path === '/' || path === '/newtab.html') return serveIndex(request, env);
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 404 && request.method === 'GET' && !path.includes('.')) return serveIndex(request, env);
    return asset;
  },
  // 站点状态自动检测：每天 04:17（北京）轮测最久未测的约 20 个站点，约半月轮完一圈。
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyHealthSlice(env).catch(() => {}));
  },
};
