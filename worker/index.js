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
async function gateSignKey(env) {
  const stored = await env.NAV_AUTH.get('site_password');
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
  const err = error ? `<p class="error">${error}</p>` : '';
  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>豆豆书签 · 需要密码</title><link rel="icon" type="image/png" href="/logo.png">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
    background: #0a1128 url('/wallpaper.jpg') center / cover no-repeat fixed; color: #e6e9f2; }
  .card { width: 100%; max-width: 360px; text-align: center; padding: 32px 28px; border-radius: 22px;
    background: rgb(22 25 32 / 52%); -webkit-backdrop-filter: blur(32px) saturate(1.8); backdrop-filter: blur(32px) saturate(1.8);
    border: 1px solid rgb(255 255 255 / 14%); box-shadow: 0 30px 64px -26px rgb(0 0 0 / 74%); }
  .card img { width: 54px; height: 54px; border-radius: 14px; }
  h1 { font-size: 20px; font-weight: 650; margin: 14px 0 6px; }
  .sub { font-size: 12.5px; color: rgb(230 233 242 / 62%); margin-bottom: 20px; }
  input { width: 100%; height: 40px; border-radius: 10px; border: 1px solid rgb(255 255 255 / 18%);
    background: rgb(255 255 255 / 8%); color: #fff; padding: 0 12px; font-size: 14px; outline: none; }
  input:focus { border-color: #0a84ff; box-shadow: 0 0 0 3px rgb(10 132 255 / 25%); }
  button { width: 100%; height: 40px; margin-top: 12px; border: none; border-radius: 10px; cursor: pointer;
    background: #0a84ff; color: #fff; font-size: 14px; font-weight: 600; }
  button:hover { background: #0077ed; }
  .error { color: #ff9f0a; font-size: 12.5px; margin-bottom: 12px; }
</style></head>
<body><form class="card" method="POST" action="/gate">
  <img src="/logo.png" alt="">
  <h1>豆豆书签</h1><p class="sub">输入访问密码进入你的桌面</p>
  ${err}
  <input type="password" name="password" placeholder="访问密码" autocomplete="current-password" autofocus>
  <button type="submit">进入</button>
</form></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function handleGate(request, env) {
  if (request.method !== 'POST') return gatePage();
  const form = await request.formData();
  const submitted = String(form.get('password') || '');
  const stored = await env.NAV_AUTH.get('site_password');
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
    env.DB.prepare('SELECT id, name, url, desc, logo, catelog, sort_order, in_dock FROM sites ORDER BY catelog, sort_order ASC, id ASC').all(),
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
    const r = await env.DB.prepare('INSERT INTO sites (name, url, desc, logo, catelog, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(name, url, String(b.desc || ''), b.logo ? String(b.logo) : null, catelog, (max?.m || 0) + 10).run();
    return json({ ok: true, id: r.meta.last_row_id });
  }
  const bm = path.match(/^\/api\/bookmarks\/(\d+)$/);
  if (bm && request.method === 'PUT') {
    const b = await readJsonBody(request);
    const cur = await env.DB.prepare('SELECT * FROM sites WHERE id = ?').bind(bm[1]).first();
    if (!cur) return json({ error: 'not found' }, 404);
    await env.DB.prepare('UPDATE sites SET name = ?, url = ?, desc = ?, catelog = ?, sort_order = ? WHERE id = ?')
      .bind(String(b.name ?? cur.name), String(b.url ?? cur.url), String(b.desc ?? cur.desc ?? ''), String(b.catelog ?? cur.catelog), Number(b.sort_order ?? cur.sort_order), bm[1]).run();
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
  const siteRows = await env.DB.prepare('SELECT id, name, url, desc, logo, catelog, sort_order FROM sites ORDER BY sort_order ASC, id ASC').all();
  const folders = new Map();
  const ensure = (name) => {
    if (!folders.has(name)) folders.set(name, { id: `cat:${name}`, title: name, children: [] });
    return folders.get(name);
  };
  for (const r of orderRows.results || []) ensure(r.catelog);
  for (const s of siteRows.results || []) {
    ensure(s.catelog).children.push({ id: String(s.id), title: s.name, url: s.url });
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
    const apiRes = await handleApi(request, env, path);
    if (apiRes) return apiRes;
    if (path === '/api/tree') return json({ tree: await buildTree(env) });
    if (path === '/api/storage') {
      if (request.method === 'PUT') {
        const text = await request.text();
        if (text.length > 900000) return json({ error: 'too large' }, 413);
        await env.NAV_AUTH.put(STORAGE_KEY, text);
        return json({ ok: true });
      }
      const v = await env.NAV_AUTH.get(STORAGE_KEY);
      return new Response(v || '{}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (path === '/' || path === '/newtab.html') return serveIndex(request, env);
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 404 && request.method === 'GET' && !path.includes('.')) return serveIndex(request, env);
    return asset;
  },
};
