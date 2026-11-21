import { useCallback, useEffect, useState } from 'react';
import { addBookmarkToDesktop, reimportBookmarks, workspaceStore } from '../../stores/desktop-store';
import { useStore } from '../../stores/create-store';
import { LinksEditor, cleanLinks } from '../../components/bookmark-grid/LinksEditor';
import type { BookmarkLink } from '../../types/bookmark';
import { DotsSixVertical } from '@phosphor-icons/react';
import { pushToast } from '../../stores/ui-store';
import { TagChips, splitTagString } from '../../components/bookmark-grid/TagChips';
import { ConfirmDialog } from '../../components/ui/Modal';

// 豆豆书签（fork）：云端管理三页——书签 / 分类 / 标签，分别走 Worker 的 /api（D1），
// 改完调 reimportBookmarks 让桌面与一页按新书签树重新同步。
interface SiteRow {
  id: number;
  name: string;
  url: string;
  desc: string | null;
  tag: string | null;
  deploy: string | null;
  links: BookmarkLink[];
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
  extraTags?: string[];
}

function collectKnownTags(data: AdminData): string[] {
  const counts = new Map<string, number>();
  for (const s of data.sites) {
    for (const t of splitTagString(s.tag)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const fromSites = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t]) => t);
  const extra = (data.extraTags ?? []).filter((t) => !counts.has(t));
  return [...fromSites, ...extra];
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
.sv-tag { font-size: 11px; font-weight: 600; color: #ffd60a; background: rgb(255 214 10 / 13%); border: 1px solid rgb(255 214 10 / 25%); padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
.sv-deploy { font-size: 11px; font-weight: 600; color: #cbd5e1; background: rgb(148 163 184 / 16%); border: 1px solid rgb(148 163 184 / 30%); padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
.sv-links-chip { font-size: 11px; font-weight: 600; color: #7db4ff; background: rgb(80 140 255 / 13%); border: 1px solid rgb(120 170 255 / 30%); padding: 1px 7px; border-radius: 999px; white-space: nowrap; }
.sv-links-row { padding: 2px 0 10px 4px; }
.sv-place { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; padding: 6px 0 10px 4px; font-size: 12px; color: rgb(235 240 250 / 60%); }
.sv-place .sv-btn { height: 26px; font-size: 12px; }
.sv-grip { display: inline-flex; align-items: center; color: rgb(235 240 250 / 38%); cursor: grab; padding: 2px 0; touch-action: none; }
.sv-grip:active { cursor: grabbing; }
.sv-cat-row.is-dragging { opacity: .35; }
.sv-cat-row.is-over { box-shadow: inset 0 2px 0 #0a84ff; }
`;

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init });
}

function useAdminData() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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

  return { data, error, busy, setBusy, setError, load, refreshAll, mutate };
}

function LoadingShell({ error }: { error: string }) {
  return (
    <div className="sv-wrap">
      <style>{CSS}</style>
      {error ? <p className="sv-error">{error}</p> : <p className="sv-note">正在加载云端书签…</p>}
    </div>
  );
}

/* ---------------- 书签页 ---------------- */

export function ServerBookmarksAdmin() {
  const { data, error, busy, mutate } = useAdminData();
  const [form, setForm] = useState({ name: '', url: '', desc: '', tag: '', catelog: '' });
  const [formLinks, setFormLinks] = useState<BookmarkLink[]>([]);
  const [editing, setEditing] = useState<SiteRow | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [placingId, setPlacingId] = useState<number | null>(null);
  const desktops = useStore(workspaceStore, (s) => s.desktops);

  if (!data) return <LoadingShell error={error} />;

  const categoryNames = data.categories.map((c) => c.catelog);
  const allCategories = [...new Set([...categoryNames, ...data.sites.map((s) => s.catelog)])];
  const grouped = allCategories.map((cat) => ({
    cat,
    items: data.sites.filter((s) => s.catelog === cat),
  }));
  const knownTags = collectKnownTags(data);

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
          <input className="sv-input" placeholder="标签（可打多个，顿号分隔）" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
          <select className="sv-select" value={form.catelog} onChange={(e) => setForm({ ...form, catelog: e.target.value })}>
            <option value="">选分类…</option>
            {allCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        {knownTags.length > 0 ? (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span className="sv-note" style={{ paddingTop: 4, whiteSpace: 'nowrap' }}>点选已有标签：</span>
            <TagChips value={form.tag} onChange={(tag) => setForm({ ...form, tag })} known={knownTags} />
          </div>
        ) : null}
        <div style={{ marginTop: 8 }}>
          <LinksEditor links={formLinks} onChange={setFormLinks} />
        </div>
        <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            className="sv-btn"
            disabled={busy || !form.name || !form.url || !form.catelog}
            onClick={() =>
              void mutate(async () => {
                const res = await api('/api/bookmarks', { method: 'POST', body: JSON.stringify({ ...form, links: cleanLinks(formLinks) }) });
                if (res.ok) {
                  setForm({ name: '', url: '', desc: '', tag: '', catelog: form.catelog });
                  setFormLinks([]);
                }
                return res;
              }, '添加失败')
            }
          >
            添加书签
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
                <div key={site.id}>
                  <div className="sv-row">
                    <input className="sv-input" style={{ width: 110 }} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                    <input className="sv-input" style={{ flex: 1 }} value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} />
                    <input className="sv-input" style={{ width: 120 }} placeholder="标签（顿号分隔）" value={editing.tag ?? ''} onChange={(e) => setEditing({ ...editing, tag: e.target.value })} />
                    <select className="sv-select" value={editing.catelog} onChange={(e) => setEditing({ ...editing, catelog: e.target.value })}>
                      {allCategories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    <button className="sv-btn" disabled={busy} onClick={() => void mutate(async () => {
                      const res = await api(`/api/bookmarks/${site.id}`, { method: 'PUT', body: JSON.stringify({ ...editing, links: cleanLinks(editing.links ?? []) }) });
                      if (res.ok) setEditing(null);
                      return res;
                    }, '保存失败')}>保存</button>
                    <button className="sv-btn ghost" onClick={() => setEditing(null)}>取消</button>
                  </div>
                  <div className="sv-links-row">
                    <LinksEditor links={editing.links ?? []} onChange={(links) => setEditing({ ...editing, links })} />
                    <TagChips value={editing.tag ?? ''} onChange={(tag) => setEditing({ ...editing, tag })} known={knownTags} />
                  </div>
                </div>
              ) : (
                <div key={site.id}>
                  <div className="sv-row">
                    <span className="sv-name">{site.name}</span>
                    {site.tag ? <span className="sv-tag">{site.tag}</span> : null}
                    {site.links?.length ? <span className="sv-links-chip">{site.links.length + 1} 个入口</span> : null}
                    <span className="sv-url">{site.url}</span>
                    <button className="sv-btn ghost" onClick={() => setPlacingId(placingId === site.id ? null : site.id)}>上桌</button>
                    <button className="sv-btn ghost" onClick={() => setEditing({ ...site, links: site.links ?? [] })}>编辑</button>
                    {confirming === `bm:${site.id}` ? (
                      <>
                        <button className="sv-btn danger" disabled={busy} onClick={() => { setConfirming(null); void mutate(() => api(`/api/bookmarks/${site.id}`, { method: 'DELETE' }), '删除失败'); }}>确认删除</button>
                        <button className="sv-btn ghost" onClick={() => setConfirming(null)}>取消</button>
                      </>
                    ) : (
                      <button className="sv-btn danger" disabled={busy} onClick={() => setConfirming(`bm:${site.id}`)}>
                        删除
                      </button>
                    )}
                  </div>
                  {placingId === site.id ? (
                    <div className="sv-place">
                      <span>放到桌面：</span>
                      {desktops.filter((d) => !d.bookmarkIds.includes(String(site.id))).length === 0 ? (
                        <span>已在全部桌面上</span>
                      ) : (
                        desktops
                          .filter((d) => !d.bookmarkIds.includes(String(site.id)))
                          .map((d) => (
                            <button
                              key={d.id}
                              className="sv-btn ghost"
                              onClick={() => {
                                addBookmarkToDesktop(d.id, String(site.id));
                                setPlacingId(null);
                              }}
                            >
                              {d.name}
                            </button>
                          ))
                      )}
                      <button className="sv-btn ghost" onClick={() => setPlacingId(null)}>收起</button>
                    </div>
                  ) : null}
                </div>
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 分类页 ---------------- */

export function ServerCategoriesAdmin() {
  const { data, error, busy, setBusy, setError, load, refreshAll, mutate } = useAdminData();
  const [newCategory, setNewCategory] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [catOrder, setCatOrder] = useState<string[]>([]);
  const [dragCat, setDragCat] = useState<string | null>(null);
  const [overCat, setOverCat] = useState<string | null>(null);
  const [armedCat, setArmedCat] = useState<string | null>(null);

  useEffect(() => {
    if (data && !dragCat) {
      setCatOrder([...data.categories].sort((a, b) => a.sort_order - b.sort_order).map((c) => c.catelog));
    }
  }, [data, dragCat]);

  async function persistCategoryOrder(names: string[]) {
    if (!data) return;
    setBusy(true);
    try {
      for (let i = 0; i < names.length; i++) {
        const cat = data.categories.find((c) => c.catelog === names[i]);
        const v = (i + 1) * 10;
        if (cat && cat.sort_order !== v) {
          const res = await api(`/api/categories/${encodeURIComponent(names[i])}`, { method: 'PUT', body: JSON.stringify({ sort_order: v }) });
          if (!res.ok) throw new Error('save failed');
        }
      }
      setError('');
      await refreshAll();
    } catch {
      setError('排序保存失败，请重试。');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <LoadingShell error={error} />;

  const orderedCats = catOrder
    .map((name) => data.categories.find((c) => c.catelog === name))
    .filter((c): c is CategoryRow => Boolean(c));
  for (const c of data.categories) {
    if (!catOrder.includes(c.catelog)) orderedCats.push(c);
  }

  return (
    <div className="sv-wrap">
      <style>{CSS}</style>
      {error ? <p className="sv-error">{error}</p> : null}

      <div className="sv-card">
        <h3>分类（{orderedCats.length}）</h3>
        {orderedCats.map((c) => {
          const count = data.sites.filter((s) => s.catelog === c.catelog).length;
          return (
            <div
              className={`sv-row sv-cat-row${dragCat === c.catelog ? ' is-dragging' : ''}${overCat === c.catelog && dragCat && dragCat !== c.catelog ? ' is-over' : ''}`}
              key={c.catelog}
              draggable={armedCat === c.catelog}
              onDragStart={(e) => { setDragCat(c.catelog); e.dataTransfer.effectAllowed = 'move'; }}
              onDragOver={(e) => { if (dragCat) { e.preventDefault(); setOverCat(c.catelog); } }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragCat && dragCat !== c.catelog) {
                  const next = [...catOrder];
                  next.splice(next.indexOf(dragCat), 1);
                  next.splice(next.indexOf(c.catelog), 0, dragCat);
                  setCatOrder(next);
                  void persistCategoryOrder(next);
                }
                setDragCat(null); setOverCat(null); setArmedCat(null);
              }}
              onDragEnd={() => { setDragCat(null); setOverCat(null); setArmedCat(null); }}
            >
              <span
                className="sv-grip"
                title="拖动调整顺序"
                onMouseDown={() => setArmedCat(c.catelog)}
                onMouseUp={() => { if (!dragCat) setArmedCat(null); }}
              >
                <DotsSixVertical size={14} />
              </span>
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
              {confirming === `cat:${c.catelog}` ? (
                <>
                  <button className="sv-btn danger" disabled={busy} onClick={() => { setConfirming(null); void mutate(() => api(`/api/categories/${encodeURIComponent(c.catelog)}`, { method: 'DELETE' }), '删除失败'); }}>确认删除</button>
                  <button className="sv-btn ghost" onClick={() => setConfirming(null)}>取消</button>
                </>
              ) : (
                <button
                  className="sv-btn danger"
                  disabled={busy || count > 0}
                  title={count > 0 ? '分类下还有书签，不能删' : '删除空分类'}
                  onClick={() => setConfirming(`cat:${c.catelog}`)}
                >
                  删除
                </button>
              )}
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
          分类顺序按住行首的拖动手柄上下拖动即可调整（数字框也能直接改），一页全览的分区顺序会跟着变。新分类先在这里建好，再往里加书签。分类改名暂未开放（会牵动桌面映射），需要改名找 COCO 处理。
        </p>
      </div>
    </div>
  );
}

/* ---------------- 标签页 ---------------- */

const TAG_SPLIT = /[、,，;；]/;
const splitTags = splitTagString;

export function ServerTagsAdmin() {
  const { data, error, busy, setBusy, setError, load, refreshAll, mutate } = useAdminData();
  const [renaming, setRenaming] = useState<{ from: string; value: string } | null>(null);
  const [newTag, setNewTag] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<{ tag: string; count: number } | null>(null);

  async function updateSites(match: (segs: string[]) => string[] | null): Promise<boolean> {
    if (!data) return false;
    for (const site of data.sites) {
      const next = match(splitTags(site.tag));
      if (next === null) continue;
      const res = await api(`/api/bookmarks/${site.id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...site, tag: next.join('、'), links: site.links ?? [] }),
      });
      if (!res.ok) return false;
    }
    return true;
  }

  async function renameTag(from: string, to: string) {
    if (!data) return;
    setBusy(true);
    try {
      const ok = await updateSites((segs) =>
        segs.includes(from) ? [...new Set(segs.map((s) => (s === from ? to : s)))] : null,
      );
      if (!ok) throw new Error('save failed');
      if ((data.extraTags ?? []).includes(from)) {
        await api('/api/tags', { method: 'POST', body: JSON.stringify({ name: to }) });
        await api(`/api/tags/${encodeURIComponent(from)}`, { method: 'DELETE' });
      }
      setError('');
      pushToast('标签已改名。', 'success');
      await refreshAll();
    } catch {
      setError('改名失败，请重试。');
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function deleteTag(tag: string) {
    if (!data) return;
    setBusy(true);
    try {
      const ok = await updateSites((segs) => (segs.includes(tag) ? segs.filter((s) => s !== tag) : null));
      if (!ok) throw new Error('save failed');
      await api(`/api/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' });
      setError('');
      pushToast('标签已删除。', 'success');
      await refreshAll();
    } catch {
      setError('删除失败，请重试。');
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <LoadingShell error={error} />;

  const counts = new Map<string, number>();
  for (const site of data.sites) {
    for (const t of splitTags(site.tag)) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const rows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag, count]) => ({ tag, count }));
  for (const t of data.extraTags ?? []) {
    if (!counts.has(t)) rows.push({ tag: t, count: 0 });
  }

  return (
    <div className="sv-wrap">
      <style>{CSS}</style>
      {error ? <p className="sv-error">{error}</p> : null}

      <div className="sv-card">
        <h3>全部标签（{rows.length}）</h3>
        <div className="sv-row">
          <input
            className="sv-input"
            style={{ flex: 1 }}
            placeholder="新标签名（先建好，添加书签时就能点选）"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
          />
          <button
            className="sv-btn"
            disabled={busy || !newTag.trim()}
            onClick={() => {
              const name = newTag.trim().replace(TAG_SPLIT, '');
              if (!name) return;
              if (rows.some((r) => r.tag === name)) {
                pushToast('这个标签已经有了。', 'info');
                setNewTag('');
                return;
              }
              setNewTag('');
              void mutate(
                () => api('/api/tags', { method: 'POST', body: JSON.stringify({ name }) }),
                '新建标签失败',
              );
            }}
          >
            新建标签
          </button>
        </div>
        {rows.length === 0 ? <p className="sv-note">还没有标签。先在上面新建一个，或在书签的编辑里打上标签。</p> : null}
        {rows.map(({ tag, count }) => (
          <div className="sv-row" key={tag}>
            <span className="sv-tag">{tag}</span>
            <span className="sv-url">{count > 0 ? `${count} 条书签` : '未使用'}</span>
            {renaming?.from === tag ? (
              <>
                <input
                  className="sv-input"
                  style={{ width: 130 }}
                  value={renaming.value}
                  autoFocus
                  onChange={(e) => setRenaming({ from: tag, value: e.target.value })}
                />
                <button
                  className="sv-btn"
                  disabled={busy}
                  onClick={() => {
                    const to = renaming.value.trim().replace(TAG_SPLIT, '');
                    setRenaming(null);
                    if (!to || to === tag) return;
                    void renameTag(tag, to);
                  }}
                >
                  保存
                </button>
                <button className="sv-btn ghost" onClick={() => setRenaming(null)}>取消</button>
              </>
            ) : (
              <>
                <button className="sv-btn ghost" disabled={busy} onClick={() => setRenaming({ from: tag, value: tag })}>改名</button>
                <button className="sv-btn danger" disabled={busy} onClick={() => setDeleteTarget({ tag, count })}>删除</button>
              </>
            )}
          </div>
        ))}
        <p className="sv-note" style={{ marginTop: 8 }}>
          标签是贴在书签上的贴纸：改名或删除会同步到所有带这个标签的书签，删除前会弹窗提醒影响范围。改名成一个已有的标签，等于把两个标签合并。
        </p>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`删除标签「${deleteTarget?.tag ?? ''}」？`}
        body={
          deleteTarget && deleteTarget.count > 0
            ? `会把这个标签从 ${deleteTarget.count} 条书签上摘掉。书签本身不会被删除，之后也可以重新打上。`
            : '这个标签还没有书签在用，删除后会从标签库里移除。'
        }
        confirmLabel="删除"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const t = deleteTarget;
          setDeleteTarget(null);
          if (t) void deleteTag(t.tag);
        }}
      />
    </div>
  );
}
