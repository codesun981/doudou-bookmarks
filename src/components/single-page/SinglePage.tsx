import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { CaretDown, FolderOpen, Plus } from '@phosphor-icons/react';
import type { BookmarkMeta } from '../../types/bookmark';
import type { BookmarkView } from '../../stores/desktop-store';
import {
  getSearchableBookmarks,
  reimportBookmarks,
  useWorkspace,
} from '../../stores/desktop-store';
import { patchSettings, useSettings } from '../../stores/settings-store';
import { pushToast } from '../../stores/ui-store';
import { isServerMode } from '../../services/server-mode';
import { openUrl } from '../../services/browser-api';
import { BookmarkTile } from '../bookmark-grid/BookmarkTile';
import { categoryOf } from '../../features/bookmarks/tree';
import { BookmarkEditModal, LinkChooserModal } from '../bookmark-grid/BookmarkGrid';
import { Segmented } from '../ui/Controls';

/** 分区顺序：按打开频率（用户 2026-11-21 批准的推荐序），新分类追加在后。 */
export const PREFERRED_ORDER = ['我的站点', '工具服务', '1Panel', '3x-ui', '内网服务'];
const COLLAPSE_KEY = 'glassdesk:single-collapsed:v1';

function metaToView(meta: BookmarkMeta): BookmarkView {
  return {
    id: meta.id,
    kind: 'bookmark',
    title: meta.title,
    url: meta.url,
    path: meta.path,
    missing: false,
    desc: meta.desc,
    tag: meta.tag,
    deploy: meta.deploy,
    links: meta.links,
  };
}

async function putBookmark(id: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch(`/api/bookmarks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function renumberSection(items: BookmarkMeta[]) {
  for (let i = 0; i < items.length; i++) {
    await putBookmark(items[i].id, { sort_order: (i + 1) * 10 });
  }
}

interface MenuState {
  view: BookmarkView;
  x: number;
  y: number;
}

export function SinglePage() {
  const workspace = useWorkspace();
  const settings = useSettings();
  const server = isServerMode();
  const all = useMemo(() => getSearchableBookmarks(workspace), [workspace]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const [linkTarget, setLinkTarget] = useState<BookmarkView | null>(null);
  const [editing, setEditing] = useState<BookmarkView | null>(null);
  const [creatingCat, setCreatingCat] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [menuArmed, setMenuArmed] = useState(false);
  const dragRef = useRef<{ id: string; cat: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const [activeSec, setActiveSec] = useState<string | null>(null);

  const sections = useMemo(() => {
    const byCat = new Map<string, BookmarkMeta[]>();
    for (const meta of all) {
      const cat = categoryOf(meta);
      const list = byCat.get(cat) ?? [];
      list.push(meta);
      byCat.set(cat, list);
    }
    const names = [
      ...PREFERRED_ORDER.filter((n) => byCat.has(n)),
      ...[...byCat.keys()].filter((n) => !PREFERRED_ORDER.includes(n)),
    ];
    return names.map((name) => ({ name, items: byCat.get(name) ?? [] }));
  }, [all]);
  const categories = useMemo(() => sections.map((s) => s.name), [sections]);

  // 一页白名单：首次出现的新分类——若白名单已初始化，自动排除（只进多桌面）。
  const known = settings.singleKnownCategories;
  const excluded = settings.singleExcludedCategories;
  useEffect(() => {
    if (!categories.length) return;
    const unseen = categories.filter((c) => !known.includes(c));
    if (!unseen.length) return;
    if (known.length === 0) {
      patchSettings({ singleKnownCategories: categories });
    } else {
      patchSettings({
        singleKnownCategories: [...known, ...unseen],
        singleExcludedCategories: [...new Set([...excluded, ...unseen])],
      });
    }
  }, [categories, known, excluded]);

  const visibleSections = useMemo(
    () => sections.filter((s) => !excluded.includes(s.name)),
    [sections, excluded],
  );
  const visibleItems = useMemo(
    () => visibleSections.flatMap((s) => s.items),
    [visibleSections],
  );

  const displaySections = visibleSections.map((s) => ({ ...s, shown: s.items }));

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('wheel', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('wheel', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const secKey = displaySections.map((s) => s.name).join('|');
  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveSec(e.target.getAttribute('data-sec'));
        }
      },
      { root, rootMargin: '-140px 0px -60% 0px' },
    );
    sectionRefs.current.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [secKey]);

  const scrollToSec = (name: string) => {
    setCollapsed((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
    requestAnimationFrame(() => {
      sectionRefs.current.get(name)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const toggleCollapsed = (name: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const handleDrop = async (targetCat: string, targetItems: BookmarkMeta[], targetId: string) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    if (!drag || drag.id === targetId) return;
    const targetIndex = targetItems.findIndex((m) => m.id === targetId);
    if (targetIndex < 0) return;
    if (drag.cat === targetCat) {
      const from = targetItems.findIndex((m) => m.id === drag.id);
      if (from < 0 || from === targetIndex) return;
      const next = [...targetItems];
      const [moved] = next.splice(from, 1);
      next.splice(targetIndex, 0, moved);
      await renumberSection(next);
    } else {
      const sourceSection = sections.find((s) => s.name === drag.cat);
      const moved = sourceSection?.items.find((m) => m.id === drag.id);
      if (!moved) return;
      const ok = await putBookmark(moved.id, { catelog: targetCat });
      if (!ok) {
        pushToast('移动失败，请重试。', 'error');
        return;
      }
      const next = [...targetItems];
      next.splice(targetIndex, 0, moved);
      await renumberSection(next);
      pushToast(`已移到「${targetCat}」。`, 'success');
    }
    await reimportBookmarks();
  };

  const handleDelete = async (view: BookmarkView) => {
    try {
      const res = await fetch(`/api/bookmarks/${view.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('delete failed');
      await reimportBookmarks();
      pushToast('书签已删除。', 'success');
    } catch {
      pushToast('删除失败，请重试。', 'error');
    }
    setMenu(null);
  };

  const openMenu = (view: BookmarkView, event: MouseEvent<HTMLElement> | { x: number; y: number }) => {
    const point = 'x' in event ? event : { x: event.clientX, y: event.clientY };
    setMenuArmed(false);
    setMenu({
      view,
      x: Math.min(point.x, window.innerWidth - 248),
      y: Math.min(point.y, window.innerHeight - 340),
    });
  };

  const scrollTimer = useRef<number>(0);
  const handleScroll = () => {
    const el = pageRef.current;
    if (!el) return;
    el.classList.add('single-page--scrolling');
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => el.classList.remove('single-page--scrolling'), 140);
  };

  return (
    <div className="single-page" ref={pageRef} onScroll={handleScroll}>
      <div className="single-page__head">
        <div>
          <h1 className="single-page__title">豆豆书签</h1>
          <p className="single-page__sub">自家服务全览 · {visibleItems.length} 个书签 · 拖动可排序、跨区拖动改分类</p>
        </div>
        <Segmented
          label="书签显示方式"
          value={settings.bookmarkViewMode}
          options={[
            { value: 'cards', label: '卡片' },
            { value: 'icons', label: '图标' },
          ]}
          onChange={(value) => patchSettings({ bookmarkViewMode: value as typeof settings.bookmarkViewMode })}
        />
      </div>

      <div className="single-sticky">
        <nav className="single-nav" aria-label="分类导航">
          {displaySections.map((s) => (
            <button
              key={s.name}
              type="button"
              className="single-nav__chip"
              data-active={activeSec === s.name}
              onClick={() => scrollToSec(s.name)}
            >
              {s.name}
              <span className="single-nav__count">{s.items.length}</span>
            </button>
          ))}
        </nav>
      </div>

      {displaySections.map((section) => {
        const isCollapsed = collapsed.has(section.name);
        return (
          <section
            key={section.name}
            className="single-section"
            data-sec={section.name}
            ref={(el) => {
              if (el) sectionRefs.current.set(section.name, el);
              else sectionRefs.current.delete(section.name);
            }}
          >
            <header className="single-section__head">
              <button
                type="button"
                className="single-section__toggle"
                onClick={() => toggleCollapsed(section.name)}
                aria-expanded={!isCollapsed}
              >
                <FolderOpen size={19} weight="fill" className="single-section__folder" />
                <span className="single-section__name">{section.name}</span>
                <span className="single-section__count">{section.items.length} 个书签</span>
                <CaretDown
                  size={15}
                  className={`single-section__caret${isCollapsed ? ' single-section__caret--closed' : ''}`}
                />
              </button>
            </header>
            {isCollapsed ? null : (
              <div className={`single-grid single-grid--${settings.bookmarkViewMode}`}>
                {section.shown.map((meta) => {
                  const view = metaToView(meta);
                  return (
                    <BookmarkTile
                      key={meta.id}
                      view={view}
                      variant={settings.bookmarkViewMode === 'cards' ? 'card' : 'tile'}
                      desktopId={`section:${section.name}`}
                      dragging={draggingId === meta.id}
                      onDragStart={(v) => {
                        dragRef.current = { id: v.id, cat: section.name };
                        setDraggingId(v.id);
                      }}
                      onDragEnd={() => {
                        dragRef.current = null;
                        setDraggingId(null);
                      }}
                      onDragOver={(_v, e: DragEvent<HTMLElement>) => e.preventDefault()}
                      onDrop={(v) => void handleDrop(section.name, section.items, v.id)}
                      onContextMenu={server ? openMenu : undefined}
                      onChooseLinks={(v) => setLinkTarget(v)}
                    />
                  );
                })}
                {server ? (
                  <button
                    type="button"
                    className="single-add"
                    onClick={() => setCreatingCat(section.name)}
                  >
                    <Plus size={18} />
                    <span>添加书签</span>
                  </button>
                ) : null}
              </div>
            )}
          </section>
        );
      })}
      {linkTarget ? <LinkChooserModal view={linkTarget} onClose={() => setLinkTarget(null)} /> : null}
      {editing ? (
        <BookmarkEditModal
          view={editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {creatingCat ? (
        <BookmarkEditModal
          view={null}
          categories={categories}
          defaultCategory={creatingCat}
          onClose={() => setCreatingCat(null)}
        />
      ) : null}

      {menu ? (
        <div
          className="context-menu glass glass--material"
          style={{ left: menu.x, top: menu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          role="menu"
        >
          <div className="context-menu__path">{menu.view.title}</div>
          <button
            type="button"
            className="context-menu__item"
            onClick={() => {
              openUrl(menu.view.url, true);
              setMenu(null);
            }}
          >
            在新标签页打开
          </button>
          <button
            type="button"
            className="context-menu__item"
            onClick={() => {
              void navigator.clipboard
                .writeText(menu.view.url)
                .then(() => pushToast('网址已复制。', 'success'))
                .catch(() => pushToast('复制失败，请重试。', 'error'));
              setMenu(null);
            }}
          >
            复制网址
          </button>
          {menu.view.links?.length ? (
            <>
              <div className="context-menu__sep" />
              <div className="context-menu__label">其他入口</div>
              {menu.view.links.map((link) => (
                <button
                  key={link.url}
                  type="button"
                  className="context-menu__item"
                  onClick={() => {
                    openUrl(link.url, true);
                    setMenu(null);
                  }}
                >
                  {link.label}
                </button>
              ))}
            </>
          ) : null}
          <div className="context-menu__sep" />
          <button
            type="button"
            className="context-menu__item"
            onClick={() => {
              setEditing(menu.view);
              setMenu(null);
            }}
          >
            编辑书签
          </button>
          <button
            type="button"
            className="context-menu__item context-menu__item--danger"
            onClick={() => {
              if (menuArmed) void handleDelete(menu.view);
              else setMenuArmed(true);
            }}
          >
            {menuArmed ? '确认删除？将从书签库彻底删除' : '删除书签'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
