import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowClockwise,
  ArrowRight,
  Cards,
  SquaresFour,
  ArrowSquareOut,
  Copy,
  FolderOpen,
  PencilSimple,
  Plus,
  PushPin,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import type { CSSProperties, DragEvent, MouseEvent } from 'react';
import type { BookmarkView } from '../../stores/desktop-store';
import {
  addBookmarkToDesktop,
  moveBookmarkToDesktop,
  removeBookmarkFromDesktop,
  reimportBookmarks,
  reorderBookmarks,
  togglePinBookmark,
  useActiveDesktop,
  useDesktopBookmarkViews,
  useWorkspace,
  workspaceStore,
} from '../../stores/desktop-store';
import { LinksEditor, cleanLinks } from './LinksEditor';
import type { BookmarkLink } from '../../types/bookmark';
import { useStore } from '../../stores/create-store';
import { patchSettings, useSettings } from '../../stores/settings-store';
import { setSettingsOpen, pushToast } from '../../stores/ui-store';
import { categoryOf, reorderIds } from '../../features/bookmarks/tree';
import { openUrl } from '../../services/browser-api';
import { prettyUrl } from '../../utils/url';
import { BookmarkTile } from './BookmarkTile';
import { FolderTile } from './FolderTile';
import { FolderView } from './FolderView';
import { Modal } from '../ui/Modal';
import { isServerMode } from '../../services/server-mode';

const DRAG_TYPE = 'application/x-glassdesk-bookmark';

interface DragPayload {
  itemId: string;
  desktopId: string;
  kind: 'bookmark' | 'folder';
}

interface ContextState {
  view: BookmarkView;
  x: number;
  y: number;
}

export function BookmarkGrid() {
  const desktop = useActiveDesktop();
  const views = useDesktopBookmarkViews();
  const settings = useSettings();
  const workspace = useWorkspace();
  const hasPermission = useStore(workspaceStore, (state) => state.hasBookmarkPermission);
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);
  const dragRef = useRef<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean } | null>(null);
  const [context, setContext] = useState<ContextState | null>(null);
  const [editTarget, setEditTarget] = useState<BookmarkView | null>(null);
  const [linkTarget, setLinkTarget] = useState<BookmarkView | null>(null);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [folderStack, setFolderStack] = useState<string[]>([]);

  useEffect(() => {
    setDropTarget(null);
    setDragPayload(null);
    dragRef.current = null;
    setContext(null);
    setFolderStack([]);
  }, [desktop?.id]);

  if (!desktop) return null;

  const missingCount = views.filter((view) => view.missing).length;
  const bookmarkCount = views.reduce(
    (total, view) =>
      total + (view.missing ? 0 : view.kind === 'folder' ? view.count ?? 0 : 1),
    0,
  );
  const folderCount = views.filter((view) => view.kind === 'folder' && !view.missing).length;
  const pinned = new Set(settings.dockPinnedBookmarkIds);
  const columns = settings.bookmarkColumns ?? 2;
  const compactColumns = Math.max(3, Math.min(columns, 4));

  function handleDragStart(view: BookmarkView, event: DragEvent<HTMLElement>) {
    if (!desktop) return;
    const payload: DragPayload = {
      itemId: view.id,
      desktopId: desktop.id,
      kind: view.kind,
    };
    dragRef.current = payload;
    setDragPayload(payload);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', view.url || view.title);
  }

  function handleDragEnd() {
    dragRef.current = null;
    setDragPayload(null);
    setDropTarget(null);
  }

  function handleDragOver(view: BookmarkView, event: DragEvent<HTMLElement>) {
    if (!dragRef.current || !desktop) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    setDropTarget({ id: view.id, after });
  }

  function handleDrop(view: BookmarkView, event: DragEvent<HTMLElement>) {
    if (!desktop) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = dragRef.current;
    handleDragEnd();
    if (!payload) return;
    if (payload.desktopId !== desktop.id) {
      if (payload.kind === 'folder') return;
      moveBookmarkToDesktop(payload.itemId, payload.desktopId, desktop.id);
      return;
    }
    if (payload.itemId === view.id) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    reorderBookmarks(
      desktop.id,
      reorderIds(desktop.bookmarkIds, payload.itemId, view.id, after),
    );
  }

  function handleGridDrop(event: DragEvent<HTMLDivElement>) {
    if (!desktop) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const payload = dragRef.current;
    handleDragEnd();
    if (!payload) return;
    if (payload.desktopId !== desktop.id) {
      if (payload.kind === 'folder') return;
      moveBookmarkToDesktop(payload.itemId, payload.desktopId, desktop.id);
      return;
    }
    const next = desktop.bookmarkIds.filter((id) => id !== payload.itemId);
    next.push(payload.itemId);
    reorderBookmarks(desktop.id, next);
  }

  function openContext(view: BookmarkView, event: MouseEvent<HTMLElement> | { x: number; y: number }) {
    if (view.kind === 'folder') return;
    const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : event;
    setContext({ view, x: point.x, y: point.y });
  }

  async function refresh() {
    setRefreshing(true);
    await reimportBookmarks();
    setRefreshing(false);
  }

  /** 云端模式彻底删除书签：删 D1 记录 + 摘掉 Dock 固定，桌面由同步自动剪除。 */
  async function handleDeleteBookmark(view: BookmarkView) {
    try {
      const res = await fetch(`/api/bookmarks/${view.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (settings.dockPinnedBookmarkIds.includes(view.id)) {
        patchSettings({
          dockPinnedBookmarkIds: settings.dockPinnedBookmarkIds.filter((id) => id !== view.id),
        });
      }
      await reimportBookmarks();
      pushToast('书签已删除。', 'success');
    } catch {
      pushToast('删除失败，请重试。', 'error');
    }
  }

  const libraryItems = isServerMode()
    ? [...workspace.liveBookmarks.values()]
        .filter((meta) => !desktop.bookmarkIds.includes(meta.id))
        .map((meta) => ({
          id: meta.id,
          title: meta.title,
          url: meta.url,
          catelog: categoryOf(meta),
        }))
    : [];

  const others = workspace.desktops.filter((item) => item.id !== desktop.id);

  return (
    <section
      className="bookmarks-section"
      aria-label={`${desktop.name}的书签`}
      data-columns={columns}
      data-view={settings.bookmarkViewMode}
      style={
        {
          '--bookmark-columns': columns,
          '--bookmark-columns-compact': compactColumns,
        } as CSSProperties
      }
    >
      <header className="bookmarks-head">
        <div>
          <h2 className="bookmarks-title">
            <img
              className="bookmarks-title__folder"
              src="/icons/mac/folder.png"
              alt=""
              width={20}
              height={20}
              draggable={false}
            />
            {desktop.name}
          </h2>
          <div className="bookmarks-meta">
            <span>{bookmarkCount} 个书签</span>
            {folderCount > 0 ? <span>· {folderCount} 个文件夹</span> : null}
            {missingCount > 0 ? (
              <span className="bookmarks-meta__warning">
                <WarningCircle size={12} weight="fill" />
                {missingCount} 个已失效
              </span>
            ) : null}
            {desktop.missingSource ? (
              <span className="bookmarks-meta__warning">来源文件夹不可用</span>
            ) : null}
          </div>
        </div>
        <div className="bookmarks-actions">
          <div className="view-toggle" role="group" aria-label="书签显示方式">
            <button
              type="button"
              className="view-toggle__btn"
              aria-pressed={settings.bookmarkViewMode === 'icons'}
              title="图标视图"
              onClick={() => patchSettings({ bookmarkViewMode: 'icons' })}
            >
              <SquaresFour size={13} />
              图标
            </button>
            <button
              type="button"
              className="view-toggle__btn"
              aria-pressed={settings.bookmarkViewMode === 'cards'}
              title="卡片视图"
              onClick={() => patchSettings({ bookmarkViewMode: 'cards' })}
            >
              <Cards size={13} />
              卡片
            </button>
          </div>
          {desktop.sourceFolderId ? (
            <button
              type="button"
              className="btn btn--glass btn--small bookmarks-refresh"
              aria-label="重新导入书签并刷新网站图标"
              title="重新导入书签并刷新网站图标"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <ArrowClockwise size={13} className={refreshing ? 'spin' : undefined} />
              重新导入
            </button>
          ) : null}
        </div>
      </header>

      {!hasPermission && !workspace.isDemo ? (
        <div className="notice notice--warning">
          <WarningCircle size={15} weight="fill" />
          <span>
            无法读取浏览器书签，当前显示的是上次保存的布局。请在扩展管理页确认 GlassDesk
            拥有书签权限，然后重新打开新标签页。
          </span>
        </div>
      ) : null}

      {views.length > 0 ? (
        <div
          className="bookmark-grid"
          data-dragging={dragPayload ? 'true' : undefined}
          onDragOver={(event) => {
            if (dragRef.current) event.preventDefault();
          }}
          onDrop={handleGridDrop}
        >
          {views.map((view) =>
            view.kind === 'folder' ? (
              <FolderTile
                key={view.id}
                view={view}
                variant={settings.bookmarkViewMode === 'cards' ? 'card' : 'tile'}
                desktopId={desktop.id}
                dragging={dragPayload?.itemId === view.id}
                dropPosition={
                  dropTarget?.id === view.id ? (dropTarget.after ? 'after' : 'before') : null
                }
                onOpen={(folderId) => setFolderStack([folderId])}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              />
            ) : (
              <BookmarkTile
                key={view.id}
                view={view}
                variant={settings.bookmarkViewMode === 'cards' ? 'card' : 'tile'}
                desktopId={desktop.id}
                pinned={pinned.has(view.id)}
                dragging={dragPayload?.itemId === view.id}
                dropPosition={
                  dropTarget?.id === view.id ? (dropTarget.after ? 'after' : 'before') : null
                }
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onContextMenu={openContext}
                onChooseLinks={(v) => setLinkTarget(v)}
              />
            ),
          )}
          {isServerMode() ? (
            <button
              type="button"
              className={`bookmark-add${settings.bookmarkViewMode === 'cards' ? ' bookmark-add--card' : ''}`}
              onClick={() => setCreating(true)}
            >
              <Plus size={settings.bookmarkViewMode === 'cards' ? 18 : 24} weight="bold" />
              <span>添加书签</span>
            </button>
          ) : null}
        </div>
      ) : (
        <EmptyBookmarks
          hasPermission={hasPermission}
          isDemo={workspace.isDemo}
          missingSource={desktop.missingSource === true}
          fromFolder={desktop.sourceFolderId !== null}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
        />
      )}

      {folderStack.length > 0 ? (
        <FolderView
          stack={folderStack}
          onPush={(folderId) =>
            setFolderStack((current) =>
              current[current.length - 1] === folderId ? current : [...current, folderId],
            )
          }
          onPop={() => setFolderStack((current) => current.slice(0, -1))}
          onClose={() => setFolderStack([])}
        />
      ) : null}

      {context ? (
        <BookmarkContextMenu
          context={context}
          currentDesktopId={desktop.id}
          others={others}
          pinned={pinned.has(context.view.id)}
          onClose={() => setContext(null)}
          onEdit={
            isServerMode() ? () => setEditTarget(context.view) : undefined
          }
          onDelete={
            isServerMode() ? () => void handleDeleteBookmark(context.view) : undefined
          }
        />
      ) : null}

      {linkTarget ? (
        <LinkChooserModal view={linkTarget} onClose={() => setLinkTarget(null)} />
      ) : null}

      {editTarget ? (
        <BookmarkEditModal
          view={editTarget}
          categories={[desktop.name, ...others.map((o) => o.name)]}
          onClose={() => setEditTarget(null)}
        />
      ) : null}

      {creating ? (
        <BookmarkEditModal
          view={null}
          categories={[desktop.name, ...others.map((o) => o.name)]}
          defaultCategory={desktop.name}
          onClose={() => setCreating(false)}
          libraryItems={libraryItems}
          onPickLibrary={(id) => {
            addBookmarkToDesktop(desktop.id, id);
            setCreating(false);
          }}
        />
      ) : null}
    </section>
  );
}

interface EmptyBookmarksProps {
  hasPermission: boolean;
  isDemo: boolean;
  missingSource: boolean;
  fromFolder: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}

function EmptyBookmarks({
  hasPermission,
  isDemo,
  missingSource,
  fromFolder,
  refreshing,
  onRefresh,
}: EmptyBookmarksProps) {
  let title = '这个桌面还是空的';
  let text = '可以把其他桌面的书签拖到下方的桌面指示点，或在设置里从书签文件夹创建一个桌面。';
  if (!hasPermission && !isDemo) {
    title = '需要书签权限';
    text = '授予书签权限后，文件夹会自动变成可以左右切换的桌面。你也可以先使用便签、倒计时和搜索。';
  } else if (missingSource) {
    title = '来源文件夹已不存在';
    text = '浏览器里的原始文件夹被删除或移动了。布局仍然保留，重新导入可以从当前书签中恢复。';
  } else if (fromFolder) {
    title = '这个文件夹还没有书签';
    text = '在浏览器书签管理器里添加书签后，回到这里点击重新导入。';
  }

  return (
    <div className="bookmark-empty">
      <div>
        <div className="bookmark-empty__title">{title}</div>
        <p className="bookmark-empty__text">{text}</p>
      </div>
      <div className="bookmark-empty__actions">
        {fromFolder || missingSource ? (
          <button
            type="button"
            className="btn btn--glass btn--small"
            onClick={onRefresh}
            disabled={refreshing}
          >
            <ArrowClockwise size={13} />
            {refreshing ? '导入中…' : '重新导入书签'}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--primary btn--small"
          onClick={() => setSettingsOpen(true, 'desktops')}
        >
          管理桌面
        </button>
      </div>
    </div>
  );
}

interface BookmarkContextMenuProps {
  context: ContextState;
  currentDesktopId: string;
  others: Array<{ id: string; name: string }>;
  pinned: boolean;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function BookmarkContextMenu({
  context,
  currentDesktopId,
  others,
  pinned,
  onClose,
  onEdit,
  onDelete,
}: BookmarkContextMenuProps) {
  const [armDelete, setArmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const { view } = context;

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    }, 0);
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    };
    const handleScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      closeRef.current();
    };
    const handleResize = () => closeRef.current();
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const x = Math.max(10, Math.min(context.x, window.innerWidth - 248));
  const y = Math.max(10, Math.min(context.y, window.innerHeight - 300));

  return createPortal(
    <div
      ref={menuRef}
      className="context-menu glass glass--material"
      style={{ left: x, top: y, maxHeight: Math.max(180, window.innerHeight - y - 16) }}
      role="menu"
      aria-label={view.title}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="context-menu__path">
        {view.missing ? '书签已失效' : prettyUrl(view.url)}
      </div>
      <button
        type="button"
        className="context-menu__item"
        role="menuitem"
        disabled={view.missing}
        onClick={() => {
          onClose();
          openUrl(view.url);
        }}
      >
        <ArrowRight size={14} />
        打开
      </button>
      <button
        type="button"
        className="context-menu__item"
        role="menuitem"
        disabled={view.missing}
        onClick={() => {
          onClose();
          openUrl(view.url, true);
        }}
      >
        <ArrowSquareOut size={14} />
        在新标签页打开
      </button>
      {view.links?.length ? (
        <>
          <div className="context-menu__sep" />
          <div className="context-menu__label">其他入口</div>
          {view.links.map((link) => (
            <button
              key={link.url}
              type="button"
              className="context-menu__item"
              role="menuitem"
              onClick={() => {
                onClose();
                openUrl(link.url, true);
              }}
            >
              <ArrowSquareOut size={14} />
              {link.label || prettyUrl(link.url)}
            </button>
          ))}
        </>
      ) : null}
      {onEdit ? (
        <button
          type="button"
          className="context-menu__item"
          role="menuitem"
          disabled={view.missing}
          onClick={() => {
            onClose();
            onEdit();
          }}
        >
          <PencilSimple size={14} />
          编辑书签
        </button>
      ) : null}
      <button
        type="button"
        className="context-menu__item"
        role="menuitem"
        disabled={view.missing}
        onClick={() => {
          togglePinBookmark(view.id);
          onClose();
        }}
      >
        <PushPin size={14} weight={pinned ? 'fill' : 'regular'} />
        {pinned ? '取消固定到 Dock' : '固定到 Dock'}
      </button>

      {others.length > 0 ? (
        <>
          <div className="context-menu__sep" />
          <div className="context-menu__label">移动到</div>
          <div className="context-menu__scroll scroll-area">
            {others.map((desktop) => (
              <button
                key={desktop.id}
                type="button"
                className="context-menu__item"
                role="menuitem"
                onClick={() => {
                  moveBookmarkToDesktop(view.id, currentDesktopId, desktop.id);
                  onClose();
                }}
              >
                <FolderOpen size={14} />
                {desktop.name}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <div className="context-menu__sep" />
      <button
        type="button"
        className="context-menu__item"
        role="menuitem"
        onClick={() => {
          removeBookmarkFromDesktop(currentDesktopId, view.id);
          onClose();
        }}
      >
        <Trash size={14} />
        从桌面移除
      </button>
      {onDelete ? (
        <button
          type="button"
          className="context-menu__item context-menu__item--danger"
          role="menuitem"
          disabled={view.missing}
          onClick={() => {
            if (armDelete) {
              onDelete();
              onClose();
            } else {
              setArmDelete(true);
            }
          }}
        >
          <Trash size={14} />
          {armDelete ? '确认删除？将从书签库彻底删除' : '删除书签'}
        </button>
      ) : null}
      <button
        type="button"
        className="context-menu__item"
        role="menuitem"
        disabled={!view.url}
        onClick={() => {
          void navigator.clipboard
            .writeText(view.url)
            .then(() => pushToast('链接已复制。', 'success'))
            .catch(() => pushToast('复制失败，请检查剪贴板权限。', 'error'));
          onClose();
        }}
      >
        <Copy size={14} />
        复制链接
      </button>
    </div>,
    document.body,
  );
}


/** 多链接书签的入口选择弹窗：主链接 + 全部副链接，点哪个开哪个（新标签）。 */
export function LinkChooserModal({ view, onClose }: { view: BookmarkView; onClose: () => void }) {
  const entries: Array<{ label: string; url: string; primary: boolean }> = [
    { label: '主链接', url: view.url, primary: true },
    ...(view.links ?? []).map((link) => ({
      label: link.label || prettyUrl(link.url),
      url: link.url,
      primary: false,
    })),
  ];
  return (
    <Modal open onClose={onClose} label={`选择入口：${view.title}`} className="modal--confirm">
      <div className="link-chooser">
        <h3 className="modal__title">{view.title}</h3>
        <p className="link-chooser__hint">这个服务有 {entries.length} 个入口，点一个打开：</p>
        {entries.map((entry) => (
          <div key={entry.url} className="link-chooser__row">
            <button
              type="button"
              className="link-chooser__open"
              onClick={() => {
                openUrl(entry.url, true);
                onClose();
              }}
            >
              <span className="link-chooser__label">
                {entry.label}
                {entry.primary ? <span className="link-chooser__badge">主</span> : null}
              </span>
              <span className="link-chooser__url">{prettyUrl(entry.url)}</span>
              <ArrowSquareOut size={15} />
            </button>
            <button
              type="button"
              className="link-chooser__copy"
              aria-label={`复制链接：${entry.label}`}
              title="复制链接"
              onClick={() => {
                void navigator.clipboard
                  .writeText(entry.url)
                  .then(() => pushToast('链接已复制。', 'success'))
                  .catch(() => pushToast('复制失败，请检查剪贴板权限。', 'error'));
              }}
            >
              <Copy size={14} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}

interface LibraryItem {
  id: string;
  title: string;
  url: string;
  catelog: string;
}

/** 云端模式下就地编辑单个书签：名称 / 网址 / 备注 / 分类，保存走 /api/bookmarks PUT 并重拉书签树。 */
export function BookmarkEditModal({
  view,
  categories,
  defaultCategory,
  onClose,
  libraryItems,
  onPickLibrary,
}: {
  view: BookmarkView | null;
  categories: string[];
  defaultCategory?: string;
  onClose: () => void;
  libraryItems?: LibraryItem[];
  onPickLibrary?: (id: string) => void;
}) {
  const [name, setName] = useState(view?.title ?? '');
  const [url, setUrl] = useState(view?.url ?? '');
  const [desc, setDesc] = useState(view?.desc ?? '');
  const [tag, setTag] = useState(view?.tag ?? '');
  const [links, setLinks] = useState<BookmarkLink[]>(view?.links ?? []);
  const [catelog, setCatelog] = useState(view?.path[view.path.length - 1] ?? defaultCategory ?? categories[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'new' | 'library'>('new');
  const [libQuery, setLibQuery] = useState('');
  const showTabs = !view && Boolean(libraryItems) && Boolean(onPickLibrary);
  const libFiltered = (libraryItems ?? []).filter((item) => {
    const q = libQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      item.title.toLowerCase().includes(q) ||
      item.url.toLowerCase().includes(q) ||
      item.catelog.toLowerCase().includes(q)
    );
  });

  const save = async () => {
    if (busy) return;
    const n = name.trim();
    const u = url.trim();
    if (!n || !u) {
      setError('名称和网址不能为空。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const payload = JSON.stringify({ name: n, url: u, desc: desc.trim(), tag: tag.trim(), links: cleanLinks(links), catelog });
      const res = view
        ? await fetch(`/api/bookmarks/${view.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          })
        : await fetch('/api/bookmarks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
          });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reimportBookmarks();
      pushToast(view ? '书签已更新。' : '书签已添加。', 'success');
      onClose();
    } catch {
      setError('保存失败，请重试。');
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} label={view ? `编辑书签：${view.title}` : '添加书签'} className="modal--confirm">
      {showTabs ? (
        <div className="bookmark-edit__tabs" role="tablist" aria-label="添加方式">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'new'}
            className="bookmark-edit__tab"
            data-active={tab === 'new'}
            onClick={() => setTab('new')}
          >
            新建书签
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'library'}
            className="bookmark-edit__tab"
            data-active={tab === 'library'}
            onClick={() => setTab('library')}
          >
            从书签库添加
          </button>
        </div>
      ) : null}
      {showTabs && tab === 'library' ? (
        <div className="lib-picker">
          <h3 className="modal__title bookmark-edit__title">从书签库添加</h3>
          <input
            className="lib-picker__search"
            value={libQuery}
            onChange={(e) => setLibQuery(e.target.value)}
            placeholder="搜索书签库（不在当前桌面的）"
            autoFocus
          />
          <div className="lib-picker__list">
            {libFiltered.length === 0 ? (
              <p className="lib-picker__empty">没有可添加的书签（库里的都已经在这个桌面上了）。</p>
            ) : (
              libFiltered.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="lib-picker__row"
                  onClick={() => onPickLibrary?.(item.id)}
                >
                  <span className="lib-picker__name">{item.title}</span>
                  {item.catelog ? <span className="lib-picker__cat">{item.catelog}</span> : null}
                  <span className="lib-picker__url">{prettyUrl(item.url)}</span>
                </button>
              ))
            )}
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--glass btn--small" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      ) : (
      <form
        className="bookmark-edit"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h3 className="modal__title bookmark-edit__title">{view ? '编辑书签' : '添加书签'}</h3>
        <label className="bookmark-edit__field">
          <span>名称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </label>
        <label className="bookmark-edit__field">
          <span>网址</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" placeholder="https://" />
        </label>
        <label className="bookmark-edit__field">
          <span>备注（卡片视图显示）</span>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="一句话说明这个站点" />
        </label>
        <label className="bookmark-edit__field">
          <span>标签（可打多个，顿号分隔）</span>
          <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="如：mini、EO（顶部搜索里点标签筛选）" maxLength={60} />
        </label>
        <div className="bookmark-edit__field">
          <span>副链接（同一服务的其他入口，可空）</span>
          <LinksEditor links={links} onChange={setLinks} />
        </div>
        <label className="bookmark-edit__field">
          <span>分类</span>
          <select value={catelog} onChange={(e) => setCatelog(e.target.value)}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="bookmark-edit__error">{error}</p> : null}
        <div className="modal__actions">
          <button type="button" className="btn btn--glass btn--small" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn--primary btn--small" disabled={busy}>
            {busy ? '保存中…' : view ? '保存' : '添加'}
          </button>
        </div>
      </form>
      )}
    </Modal>
  );
}
