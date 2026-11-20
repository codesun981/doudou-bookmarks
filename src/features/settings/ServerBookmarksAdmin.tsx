import { useCallback, useEffect, useState } from 'react';
import { reimportBookmarks } from '../../stores/desktop-store';

// 豆豆书签（fork）：云端书签管理——增删改查走 Worker 的 /api（D1），
// 改完调 reimportBookmarks 让桌面按新书签树重新同步。
interface SiteRow {
  id: number;
  name: string;
  url: string;
  desc: string | null;
  catelog: string;
  sort_order: number;
}
interface CategoryRow {
  catelog: string;
  sort_order: number;
}
interface AdminData {
  sites: SiteRow[];
  categories: CategoryRow[];
}

const CSS = `
.sv-wrap { display: flex; flex-direction: column; gap: 18px; font-size: 13px; color: var(--text-primary, #f2f4f8); }
.sv-card { border: 1px solid rgb(255 255 255 / 9%); border-radius: 14px; padding: 14px 16px; background: rgb(255 255 255 / 3%); }
.sv-card h3 { font-size: 13px; font-weight: 650; margin: 0 0 10px; }
.sv-row { display: flex; align-items: center; gap: 8px; padding: 7px 0; border-top: 1px solid rgb(255 255 255 / 6%); }
.sv-row:first-of-type { border-top: none; }
.sv-name { font-weight: 600; white-space: nowrap; }
.sv-url { color: rgb(235 240 250 / 55%); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.sv-input, .sv-select { height: 30px; border-radius: 8px; border: 1px solid rgb(255 255 255 / 14%); background: rgb(255 255 255 / 6%); color: inherit; padding: 0 8px; font-size: 12.5px; outline: none; min-width: 0; }
.sv-input:focus, .sv-select:focus { border-color: #0a84ff; }
.sv-btn { height: 30px; padding: 0 12px; border-radius: 8px; border: none; cursor: pointer; font-size: 12.5px; font-weight: 600; background: #0a84ff; color: #fff; white-space: nowrap; }
.sv-btn.ghost { background: rgb(255 255 255 / 10%); color: inherit; font-weight: 500; }
.sv-btn.danger { background: #ff3b30; color: #fff; }
.sv-btn:disabled { opacity: .45; cursor: default; }
.sv-grid { display: grid; grid-template-columns: 1fr 1.4fr; gap: 8px; }
.sv-note { color: rgb(235 240 250 / 50%); font-size: 12px; line-height: 1.55; }
.sv-error { color: #ff9f0a; font-size: 12.5px; }
.sv-cat { font-size: 12px; font-weight: 700; letter-spacing: .02em; color: rgb(235 240 250 / 75%); margin: 12px 0 2px; }
`;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
}

export function ServerBookmarksAdmin() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', url: '', desc: '', catelog: '' });
  const [newCategory, setNewCategory] = useState('');
  const [editing, setEditing] = useState<SiteRow | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api('/api/admin/data');
      if (!res.ok) throw new Error('加载失败');
      setData((await res.json()) as AdminData);
      setError('');
    } catch {
      setError('书签数据加载失败，刷新页面再试。');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshAll = useCallback(async () => {
    await load();
    await reimportBookmarks();
  }, [load]);

  async function mutate(fn: () => Promise<Response>, failMsg: string) {
    setBusy(true);
    try {
      const res = await fn();
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || failMsg);
        return;
      }
      setError('');
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div className="sv-wrap">
        <style>{CSS}</style>
        {error ? <p className="sv-error">{error}</p> : <p className="sv-note">正在加载云端书签…</p>}
      </div>
    );
  }

  const categoryNames = data.categories.map((c) => c.catelog);
  const allCategories = [...new Set([...categoryNames, ...data.sites.map((s) => s.catelog)])];
  const grouped = allCategories.map((cat) => ({
    cat,
    items: data.sites.filter((s) => s.catelog === cat),
  }));

  return (
    <div className="sv-wrap">
      <style>{CSS}</style>
      {error ? <p className="sv-error">{error}</p> : null}

      <div className="sv-card">
        <h3>添加书签</h3>
        <div className="sv-grid">
          <input className="sv-input" placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="sv-input" placeholder="https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <input className="sv-input" placeholder="描述（可空）" value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} />
          <select className="sv-select" value={form.catelog} onChange={(e) => setForm({ ...form, catelog: e.target.value })}>
            <option value="">选分类…</option>
            {allCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="sv-btn"
            disabled={busy || !form.name || !form.url || !form.catelog}
            onClick={() =>
              void mutate(async () => {
                const res = await api('/api/bookmarks', { method: 'POST', body: JSON.stringify(form) });
                if (res.ok) setForm({ name: '', url: '', desc: '', catelog: form.catelog });
                return res;
              }, '添加失败')
            }
          >
            添加到桌面
          </button>
        </div>
      </div>

      <div className="sv-card">
        <h3>全部书签（{data.sites.length}）</h3>
        {grouped.map(({ cat, items }) => (
          <div key={cat}>
            <div className="sv-cat">{cat}</div>
            {items.map((site) =>
              editing?.id === site.id ? (
                <div className="sv-row" key={site.id}>
                  <input className="sv-input" style={{ width: 110 }} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <input className="sv-input" style={{ flex: 1 }} value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} />
                  <select className="sv-select" value={editing.catelog} onChange={(e) => setEditing({ ...editing, catelog: e.target.value })}>
                    {allCategories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button className="sv-btn" disabled={busy} onClick={() => void mutate(async () => {
                    const res = await api(`/api/bookmarks/${site.id}`, { method: 'PUT', body: JSON.stringify(editing) });
                    if (res.ok) setEditing(null);
                    return res;
                  }, '保存失败')}>保存</button>
                  <button className="sv-btn ghost" onClick={() => setEditing(null)}>取消</button>
                </div>
              ) : (
                <div className="sv-row" key={site.id}>
                  <span className="sv-name">{site.name}</span>
                  <span className="sv-url">{site.url}</span>
                  <button className="sv-btn ghost" onClick={() => setEditing(site)}>编辑</button>
                  <button
                    className="sv-btn danger"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`删除「${site.name}」？`)) {
                        void mutate(() => api(`/api/bookmarks/${site.id}`, { method: 'DELETE' }), '删除失败');
                      }
                    }}
                  >
                    删除
                  </button>
                </div>
              ),
            )}
          </div>
        ))}
      </div>

      <div className="sv-card">
        <h3>分类</h3>
        {data.categories.map((c) => {
          const count = data.sites.filter((s) => s.catelog === c.catelog).length;
          return (
            <div className="sv-row" key={c.catelog}>
              <span className="sv-name">{c.catelog}</span>
              <span className="sv-url">{count} 条</span>
              <input
                className="sv-input"
                style={{ width: 64 }}
                type="number"
                defaultValue={c.sort_order}
                title="排序值（小在前）"
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v !== c.sort_order) {
                    void mutate(() => api(`/api/categories/${encodeURIComponent(c.catelog)}`, { method: 'PUT', body: JSON.stringify({ sort_order: v }) }), '排序保存失败');
                  }
                }}
              />
              <button
                className="sv-btn danger"
                disabled={busy || count > 0}
                title={count > 0 ? '分类下还有书签，不能删' : '删除空分类'}
                onClick={() => {
                  if (window.confirm(`删除空分类「${c.catelog}」？`)) {
                    void mutate(() => api(`/api/categories/${encodeURIComponent(c.catelog)}`, { method: 'DELETE' }), '删除失败');
                  }
                }}
              >
                删除
              </button>
            </div>
          );
        })}
        <div className="sv-row">
          <input className="sv-input" style={{ flex: 1 }} placeholder="新分类名" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
          <button
            className="sv-btn"
            disabled={busy || !newCategory.trim()}
            onClick={() =>
              void mutate(async () => {
                const res = await api('/api/categories', { method: 'POST', body: JSON.stringify({ name: newCategory.trim() }) });
                if (res.ok) setNewCategory('');
                return res;
              }, '新建分类失败')
            }
          >
            新建分类
          </button>
        </div>
        <p className="sv-note" style={{ marginTop: 8 }}>
          新分类先在这里建好，再往里加书签，桌面会自动多出一页。分类改名暂未开放（会牵动桌面映射），需要改名找 COCO 处理。
        </p>
      </div>
    </div>
  );
}
