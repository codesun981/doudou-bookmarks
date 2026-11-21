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
<title>豆豆书签</title><link rel="icon" type="image/png" href="/logo.png">
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
  .field { margin-top: 15px; display: flex; align-items: center; gap: 8px; }
  .pill { display: flex; align-items: center; width: 196px; height: 34px; border-radius: 999px; padding: 0 14px;
    background: rgb(255 255 255 / 26%); -webkit-backdrop-filter: blur(18px) saturate(1.6); backdrop-filter: blur(18px) saturate(1.6);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 14%); transition: box-shadow 160ms ease, background 160ms ease; }
  .pill:focus-within { background: rgb(255 255 255 / 34%); box-shadow: inset 0 0 0 1px rgb(255 255 255 / 30%), 0 0 0 4px rgb(255 255 255 / 14%); }
  .pill input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; color: #fff;
    font-size: 13.5px; text-align: center; letter-spacing: .02em; }
  .pill input::placeholder { color: rgb(255 255 255 / 78%); }
  .go { width: 34px; height: 34px; flex: none; border: none; border-radius: 50%; cursor: pointer; color: #fff;
    background: rgb(255 255 255 / 30%); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px);
    display: flex; align-items: center; justify-content: center; opacity: 0; transform: scale(.8); pointer-events: none;
    transition: opacity 160ms ease, transform 160ms ease, background 160ms ease; }
  .go.on { opacity: 1; transform: scale(1); pointer-events: auto; }
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


// ---- 书签/分类 CRUD（设置页「书签管理」与日后 COCO 代管共用） ----
async function adminData(env) {
  const [sites, cats] = await Promise.all([
    env.DB.prepare('SELECT id, name, url, desc, tag, logo, catelog, sort_order, in_dock FROM sites ORDER BY catelog, sort_order ASC, id ASC').all(),
    env.DB.prepare('SELECT catelog, sort_order FROM category_orders ORDER BY sort_order ASC').all(),
  ]);
  return { sites: sites.results || [], categories: cats.results || [] };
}
async function readJsonBody(request) {
  try { return await request.json(); } catch { return {}; }
}
async function handleApi(request, env, path) {
  if (path === '/api/admin/data' && request.method === 'GET') return json(await adminData(env));
  if (path === '/api/bookmarks' && request.method === 'POST') {
    const b = await readJsonBody(request);
    const name = String(b.name || '').trim();
    const url = String(b.url || '').trim();
    const catelog = String(b.catelog || '').trim();
    if (!name || !url || !catelog) return json({ error: 'name/url/catelog 必填' }, 400);
    const max = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM sites WHERE catelog = ?').bind(catelog).first();
    const r = await env.DB.prepare('INSERT INTO sites (name, url, desc, tag, logo, catelog, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(name, url, String(b.desc || ''), String(b.tag || ''), b.logo ? String(b.logo) : null, catelog, (max?.m || 0) + 10).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const bm = path.match(/^\/api\/bookmarks\/(\d+)$/);
  if (bm && request.method === 'PUT') {
    const b = await readJsonBody(request);
    const cur = await env.DB.prepare('SELECT * FROM sites WHERE id = ?').bind(bm[1]).first();
    if (!cur) return json({ error: 'not found' }, 404);
    await env.DB.prepare('UPDATE sites SET name = ?, url = ?, desc = ?, tag = ?, catelog = ?, sort_order = ? WHERE id = ?')
      .bind(String(b.name ?? cur.name), String(b.url ?? cur.url), String(b.desc ?? cur.desc ?? ''), String(b.tag ?? cur.tag ?? ''), String(b.catelog ?? cur.catelog), Number(b.sort_order ?? cur.sort_order), bm[1]).run();
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
    return json({ ok: true });
  }
  if (cm && request.method === 'DELETE') {
    const name = decodeURIComponent(cm[1]);
    const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM sites WHERE catelog = ?').bind(name).first();
    if ((used?.n || 0) > 0) return json({ error: '分类下还有书签，先移走或删掉它们' }, 409);
    await env.DB.prepare('DELETE FROM category_orders WHERE catelog = ?').bind(name).run();
    return json({ ok: true });
  }
  return null;
}

// ---- UI 状态存储（2026-11-21 由 KV 迁 D1）+ 全局数据版本号 ----
let _tablesReady = false;
async function ensureTables(env) {
  if (_tablesReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS ui_state (id INTEGER PRIMARY KEY, blob TEXT NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL)').run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
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
        headers: { 'Content-Type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/jpeg', 'Cache-Control': 'public, max-age=3600' },
      });
    }
  } catch { /* 读 R2 失败时回退默认壁纸 */ }
  return new Response(null, { status: 302, headers: { Location: '/wallpapers/deep-blue.jpg' } });
}
// D1 书签 → GlassDesk 的 BookmarkNode 树：根 → 分类文件夹 → 书签叶子
async function buildTree(env) {
  const orderRows = await env.DB.prepare('SELECT catelog, sort_order FROM category_orders ORDER BY sort_order ASC').all();
  const siteRows = await env.DB.prepare('SELECT id, name, url, desc, tag, logo, catelog, sort_order FROM sites ORDER BY sort_order ASC, id ASC').all();
  const folders = new Map();
  const ensure = (name) => {
    if (!folders.has(name)) folders.set(name, { id: `cat:${name}`, title: name, children: [] });
    return folders.get(name);
  };
  for (const r of orderRows.results || []) ensure(r.catelog);
  for (const s of siteRows.results || []) {
    ensure(s.catelog).children.push({ id: String(s.id), title: s.name, url: s.url, desc: s.desc || '', tag: s.tag || '' });
  }
  return [{ id: 'root', title: '豆豆书签', children: [...folders.values()] }];
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
};
